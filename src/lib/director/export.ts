import { invoke } from '@tauri-apps/api/tauri';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { createDir, removeDir, writeBinaryFile } from '@tauri-apps/api/fs';
import { nanoid } from 'nanoid';
import { appendArtifact } from '@/lib/artifacts';
import { saveCanvasImage } from '@/lib/canvas/assetPersist';
import { detectFfmpeg } from '@/lib/canvas/videoCompose';
import { defaultNodeStyle } from '@/lib/canvas/layout';
import { useCanvasStore } from '@/stores/canvasStore';
import { useDirectorStore } from '@/stores/directorStore';
import { useRenderQueueStore } from '@/stores/renderQueueStore';
import { hasVideoToolbox, probeRenderedVideo, runFfmpegWithProgress } from '@/lib/editor/composeEngine';
import { dispatchSystemRepairPrompt, FFMPEG_REPAIR_PROMPT } from '@/lib/agent/systemRepair';
import type { DirectorEngine } from './engine';
import { evaluateDirectorFrame, planDuration } from './playback';
import { ASPECT_RATIOS, type AspectId, type DirectorElement, type DirectorOrigin, type DirectorPlan, type DirectorSequenceShot } from './types';

interface CommandResult { stdout: string; stderr: string; exit_code: number }

export interface DirectorExportProgress {
  stage: 'prepare' | 'frames' | 'encode' | 'verify' | 'complete';
  label: string;
  detail?: string;
  percent: number;
}

export interface DirectorVideoExportOptions {
  onProgress?: (progress: DirectorExportProgress) => void;
  signal?: AbortSignal;
  placeOnCanvas?: boolean;
  startSec?: number;
  endSec?: number;
  outputPath?: string;
}

function abortError(): Error {
  return new Error('已取消导出');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function q(path: string): string {
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

function dataUrlBytes(dataUrl: string): Uint8Array {
  const payload = dataUrl.split(';base64,')[1];
  if (!payload) throw new Error('预演帧编码失败');
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function hdFrameSize(aspect: AspectId): { width: number; height: number } {
  const ratio = ASPECT_RATIOS[aspect];
  const width = ratio >= 1 ? Math.round(1080 * ratio / 2) * 2 : 1080;
  const height = ratio >= 1 ? 1080 : Math.round(1080 / ratio / 2) * 2;
  return { width, height };
}

function canvasPosition(origin: DirectorOrigin, type: 'image' | 'video'): { x: number; y: number } {
  const nodes = useCanvasStore.getState().nodes;
  const source = origin.nodeId ? nodes.find((node) => node.id === origin.nodeId) : undefined;
  if (source) {
    const siblings = nodes.filter((node) => (node.data as Record<string, unknown> | undefined)?.directorOriginNodeId === origin.nodeId);
    return { x: source.position.x + (source.width ?? 320) + 90, y: source.position.y + siblings.length * (type === 'video' ? 240 : 220) };
  }
  const maxX = nodes.length ? Math.max(...nodes.map((node) => node.position.x + (node.width ?? 260))) : 120;
  return { x: maxX + 90, y: nodes.length ? Math.min(...nodes.map((node) => node.position.y)) : 120 };
}

export function spawnIsolatedCanvasOutput(path: string, origin: DirectorOrigin, type: 'image' | 'video', description: string): string | null {
  if (!origin.nodeId) return null;
  const id = `node-${nanoid(8)}`;
  const data = {
    localPath: path,
    description,
    directorOriginNodeId: origin.nodeId,
    directorReferenceIsolated: true,
    ...(type === 'image'
      ? { generatedImageUrl: convertFileSrc(path), isUploadedImage: true }
      : { generatedVideoUrl: convertFileSrc(path), mediaRole: 'output' }),
  };
  useCanvasStore.getState().addNode({ id, type, position: canvasPosition(origin, type), style: defaultNodeStyle(type), data });
  useCanvasStore.getState().setSelectedNodeId(id);
  return id;
}

export async function exportDirectorStill(
  engine: DirectorEngine,
  shot: DirectorSequenceShot,
  origin: DirectorOrigin,
  type: 'still' | 'top-view' | 'path-map' | 'transparent' = 'still',
  placeOnCanvas = false,
): Promise<string> {
  const dataUrl = type === 'transparent'
    ? engine.captureTransparent(shot.aspect, 1920)
    : type === 'top-view'
      ? engine.captureTopView(shot.aspect, 1920, false)
      : type === 'path-map'
        ? engine.captureTopView(shot.aspect, 1920, true)
        : engine.captureShot(shot.aspect, 1920);
  const path = await saveCanvasImage(dataUrl, `director-${type}`);
  await appendArtifact({ path, type: 'image', engine: 'director-previs', prompt: `${origin.title} · ${shot.name}`, projectId: origin.projectId });
  const recordId = `director-export-${nanoid(8)}`;
  useDirectorStore.getState().addExport({ id: recordId, type, path, createdAt: Date.now(), planId: useDirectorStore.getState().activePlanId ?? '', shotId: shot.id });
  if (placeOnCanvas) spawnIsolatedCanvasOutput(path, origin, 'image', `${origin.title} · ${shot.name} · 白模截图`);
  return path;
}

export async function exportDirectorVideo(
  engine: DirectorEngine,
  plan: DirectorPlan,
  elements: DirectorElement[],
  origin: DirectorOrigin,
  options: DirectorVideoExportOptions = {},
): Promise<string> {
  const renderQueue = useRenderQueueStore.getState();
  const jobId = renderQueue.createJob({ kind: 'video', title: `导演预演 · ${plan.name}`, stage: '检查导出环境', detail: '1080p · 24fps · H.264', percent: 0 });
  renderQueue.startJob(jobId);
  const report = (progress: DirectorExportProgress) => {
    options.onProgress?.(progress);
    useRenderQueueStore.getState().updateJob(jobId, { stage: progress.label, detail: progress.detail, percent: progress.percent });
  };
  report({ stage: 'prepare', label: '检查导出环境', detail: '正在检测 FFmpeg 与 H.264 编码器', percent: 1 });
  const ffmpeg = await detectFfmpeg();
  if (!ffmpeg) {
    dispatchSystemRepairPrompt(FFMPEG_REPAIR_PROMPT);
    useRenderQueueStore.getState().finishJob(jobId, 'failed', { error: '未检测到 FFmpeg，已唤起鲲鹏 Agent 自动诊断安装', detail: '请在 Agent 中确认系统维护操作，完成后重新导出' });
    throw new Error('未检测到 FFmpeg。已自动打开鲲鹏 Agent 进行环境诊断与安装；确认维护操作后，回到导演台重新导出。');
  }
  const aspect = plan.shots[0]?.aspect;
  if (!aspect || plan.shots.some((shot) => shot.aspect !== aspect)) {
    const message = '预演方案包含不同画幅，无法编码为同一个标准视频。请先把所有镜头设置为同一画幅。';
    useRenderQueueStore.getState().finishJob(jobId, 'failed', { error: message });
    throw new Error(message);
  }
  const { width: outputWidth, height: outputHeight } = hdFrameSize(aspect);
  const fullDurationSec = planDuration(plan);
  const fps = 24;
  const frameDuration = 1 / fps;
  const rangeStartSec = Math.max(0, Math.min(fullDurationSec - frameDuration, options.startSec ?? 0));
  const rangeEndSec = Math.max(rangeStartSec + frameDuration, Math.min(fullDurationSec, options.endSec ?? fullDurationSec));
  const durationSec = rangeEndSec - rangeStartSec;
  const workspace = await invoke<string>('ensure_workspace');
  const stamp = Date.now();
  // Tauri's webview FS scope can reject newly-created nested workspace paths
  // before they exist. Render disposable PNG frames in the explicitly allowed
  // system temp scope, then atomically move only the verified MP4 to workspace.
  const renderDir = `/tmp/kunpeng-director-render-${stamp}`;
  const frameDir = `${renderDir}/frames`;
  const outPath = options.outputPath || `${workspace}/videos/director-previs-${stamp}.mp4`;
  const partialPath = `${renderDir}/director-previs.partial.mp4`;
  const progressPath = `${renderDir}/ffmpeg-progress.txt`;
  const logPath = `${renderDir}/ffmpeg.log`;
  const exitPath = `${renderDir}/ffmpeg-exit.txt`;
  try {
    await createDir(frameDir, { recursive: true });
  } catch (error) {
    useRenderQueueStore.getState().finishJob(jobId, 'failed', { error: `无法创建导出缓存目录：${error instanceof Error ? error.message : String(error)}` });
    throw error;
  }
  const totalFrames = Math.max(1, Math.ceil(durationSec * fps));

  try {
    report({ stage: 'frames', label: '渲染白模画面', detail: `0/${totalFrames} 帧`, percent: 3 });
    for (let index = 0; index < totalFrames; index++) {
      throwIfAborted(options.signal);
      const time = Math.min(rangeEndSec - 0.001, rangeStartSec + index / fps);
      const frame = evaluateDirectorFrame(plan, elements, time);
      if (!frame) throw new Error(`第 ${index + 1} 帧没有可用镜头状态`);
      engine.syncElements(frame.elements);
      engine.applyCameraPose(frame.camera);
      const dataUrl = engine.captureShot(aspect, outputWidth);
      if (!dataUrl.startsWith('data:image/png;base64,')) throw new Error(`第 ${index + 1} 帧不是有效 PNG`);
      const name = `frame_${String(index + 1).padStart(6, '0')}.png`;
      await writeBinaryFile(`${frameDir}/${name}`, dataUrlBytes(dataUrl));
      if (index % 4 === 0 || index === totalFrames - 1) {
        const percent = 3 + ((index + 1) / totalFrames) * 62;
        report({ stage: 'frames', label: '渲染白模画面', detail: `${index + 1}/${totalFrames} 帧 · ${Math.round(percent)}%`, percent });
      }
      if (index % 12 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }

    throwIfAborted(options.signal);
    const frameCheck = await invoke<CommandResult>('execute_command', {
      command: `file -b --mime-type ${q(`${frameDir}/frame_000001.png`)} ${q(`${frameDir}/frame_${String(totalFrames).padStart(6, '0')}.png`)}`,
      timeoutMs: 10000,
    });
    const frameTypes = frameCheck.stdout.trim().split(/\s+/).filter(Boolean);
    if (frameCheck.exit_code !== 0 || frameTypes.length !== 2 || frameTypes.some((type) => type !== 'image/png')) throw new Error('白模帧文件校验失败，已停止编码');

    const hardware = await hasVideoToolbox(ffmpeg);
    const encoder = hardware
      ? '-c:v h264_videotoolbox -allow_sw 1 -b:v 14M -maxrate 22M -tag:v avc1'
      : '-c:v libx264 -preset fast -crf 18 -tag:v avc1';
    report({ stage: 'encode', label: '编码 MP4', detail: `${hardware ? 'Apple 硬件 H.264' : '软件 H.264'} · ${outputWidth}x${outputHeight} · 24fps`, percent: 66 });
    const command = `${ffmpeg} -y -nostats -progress ${q(progressPath)} -f image2 -framerate ${fps} -start_number 1 -i ${q(`${frameDir}/frame_%06d.png`)} -an ${encoder} -pix_fmt yuv420p -r ${fps} -movflags +faststart -f mp4 ${q(partialPath)}`;
    await runFfmpegWithProgress({
      ffmpeg,
      command,
      timeoutMs: Math.max(600000, totalFrames * 3500),
      progressPath,
      logPath,
      exitPath,
      outputPath: partialPath,
      durationSec,
      stageName: '编码 MP4',
      expectation: { format: 'mp4', width: outputWidth, height: outputHeight, durationSec },
      signal: options.signal,
      onProgress: (progress) => {
        const percent = 66 + Math.max(0, Math.min(1, (progress.percent ?? 0) / 100)) * 27;
        report({ stage: 'encode', label: progress.stage, detail: progress.detail, percent });
      },
    });

    report({ stage: 'verify', label: '校验成片', detail: '检查容器、编码、分辨率、时长与首帧解码', percent: 95 });
    const probe = await probeRenderedVideo(ffmpeg, partialPath, { format: 'mp4', width: outputWidth, height: outputHeight, durationSec });
    const move = await invoke<CommandResult>('execute_command', { command: `mv -f ${q(partialPath)} ${q(outPath)}`, timeoutMs: 30000 });
    if (move.exit_code !== 0) throw new Error(`成片保存失败：${move.stderr.slice(-400)}`);

    await appendArtifact({ path: outPath, type: 'video', engine: 'director-previs', prompt: `${origin.title} · ${plan.name} · ${rangeStartSec.toFixed(2)}-${rangeEndSec.toFixed(2)}s`, projectId: origin.projectId });
    useDirectorStore.getState().addExport({ id: `director-export-${nanoid(8)}`, type: 'previs-video', path: outPath, createdAt: Date.now(), planId: plan.id });
    if (options.placeOnCanvas) spawnIsolatedCanvasOutput(outPath, origin, 'video', `${origin.title} · ${plan.name} · 白模动态预演`);
    report({ stage: 'complete', label: '导出完成', detail: `${probe.codecName.toUpperCase()} · ${probe.width}x${probe.height} · ${probe.durationSec.toFixed(1)}s`, percent: 100 });
    useRenderQueueStore.getState().finishJob(jobId, 'completed', { outputPath: outPath, detail: `${probe.codecName.toUpperCase()} · ${probe.width}x${probe.height}` });
    return outPath;
  } catch (error) {
    const cancelled = options.signal?.aborted || (error instanceof Error && error.message === '已取消导出');
    const failureLogPath = `${workspace}/videos/director-export-failed-${stamp}.log`;
    if (!cancelled) {
      await invoke<CommandResult>('execute_command', {
        command: `if test -f ${q(logPath)}; then cp -f ${q(logPath)} ${q(failureLogPath)}; else printf '%s\n' ${q(error instanceof Error ? error.message : String(error))} > ${q(failureLogPath)}; fi`,
        timeoutMs: 10000,
      }).catch(() => null);
    }
    useRenderQueueStore.getState().finishJob(jobId, cancelled ? 'cancelled' : 'failed', {
      error: error instanceof Error ? error.message : String(error),
      detail: cancelled ? '用户已停止导出' : `失败日志：${failureLogPath}`,
    });
    throw error;
  } finally {
    await removeDir(renderDir, { recursive: true }).catch(() => {});
  }
}
