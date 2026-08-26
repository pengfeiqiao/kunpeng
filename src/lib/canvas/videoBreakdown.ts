/**
 * videoBreakdown — 一键拉片 (TapNow): scene-detect a video, extract key
 * frames, describe each shot with the vision model, emit storyboard nodes.
 */
import { nanoid } from 'nanoid';
import { invoke } from '@tauri-apps/api/tauri';
import { useCanvasStore } from '@/stores/canvasStore';
import { captureSnapshot } from '@/lib/canvas/history';
import { toAssetUrl } from '@/lib/canvas/assetPersist';
import { defaultNodeStyle, textNodeSize } from '@/lib/canvas/layout';
import { detectFfmpeg } from './videoCompose';
import { dmxVisionDescribe } from '@/lib/agent/tools/dmxClient';

interface CommandResult { stdout: string; stderr: string; exit_code: number }

const MAX_SHOTS = 20;
const q = (p: string) => `'${p.replace(/'/g, `'\\''`)}'`;

/** Scene-change timestamps via ffmpeg select=gt(scene,0.3). */
async function detectScenes(ffmpeg: string, path: string): Promise<number[]> {
  const r = await invoke<CommandResult>('execute_command', {
    command: `${ffmpeg} -i ${q(path)} -vf "select='gt(scene,0.3)',showinfo" -f null - 2>&1 | grep 'pts_time' | head -${MAX_SHOTS}`,
    timeoutMs: 120000,
  });
  const times: number[] = [];
  const re = /pts_time:([\d.]+)/g;
  let m;
  while ((m = re.exec(r.stdout + r.stderr)) !== null) times.push(parseFloat(m[1]));
  return times;
}

async function probeDurationSec(ffmpeg: string, path: string): Promise<number> {
  const r = await invoke<CommandResult>('execute_command', {
    command: `${ffmpeg} -i ${q(path)} 2>&1 | grep Duration | head -1`,
    timeoutMs: 15000,
  });
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stdout + r.stderr);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

async function extractFrame(ffmpeg: string, path: string, t: number, outDir: string): Promise<string> {
  const out = `${outDir}/shot_${Date.now()}_${Math.round(t * 100)}.png`;
  const r = await invoke<CommandResult>('execute_command', {
    command: `${ffmpeg} -ss ${t.toFixed(2)} -i ${q(path)} -frames:v 1 -q:v 2 ${q(out)}`,
    timeoutMs: 60000,
  });
  if (r.exit_code !== 0) throw new Error(`抽帧失败 @${t}s`);
  return out;
}

export async function breakdownVideo(nodeId: string, onProgress?: (msg: string) => void): Promise<void> {
  const store = useCanvasStore.getState();
  const node = store.nodes.find((n) => n.id === nodeId);
  const d = node?.data as Record<string, unknown> | undefined;
  const videoPath = d?.localPath as string | undefined;
  if (!node || !videoPath) {
    alert('该视频节点没有本地文件，无法拉片');
    return;
  }

  const ffmpeg = await detectFfmpeg();
  if (!ffmpeg) {
    alert('未检测到 ffmpeg。请先安装（macOS: brew install ffmpeg；Windows: winget install ffmpeg）');
    return;
  }

  onProgress?.('检测场景切换…');
  let times = await detectScenes(ffmpeg, videoPath);
  if (times.length === 0) {
    // No scene cuts → sample 6 evenly spaced frames
    const dur = await probeDurationSec(ffmpeg, videoPath);
    if (dur <= 0) { alert('无法读取视频时长'); return; }
    times = Array.from({ length: 6 }, (_, i) => (dur * (i + 0.5)) / 6);
  }
  times = times.slice(0, MAX_SHOTS);

  if (!window.confirm(`检测到 ${times.length} 个镜头。将抽取 ${times.length} 帧并调用视觉模型逐镜描述（消耗 ${times.length} 次视觉调用）。继续？`)) {
    return;
  }

  const workspace = await invoke<string>('ensure_workspace');
  const outDir = `${workspace}/images`;

  captureSnapshot();
  const baseX = node.position.x;
  const baseY = node.position.y + (node.height ?? 240) + 80;
  const cellW = 200;
  const descriptions: string[] = [];

  for (let i = 0; i < times.length; i++) {
    onProgress?.(`镜头 ${i + 1}/${times.length}：抽帧…`);
    const framePath = await extractFrame(ffmpeg, videoPath, times[i], outDir);

    onProgress?.(`镜头 ${i + 1}/${times.length}：分析画面…`);
    let desc = '';
    try {
      desc = await dmxVisionDescribe(
        framePath,
        '用一行分镜表格式描述这个画面：景别 | 机位角度 | 推测运镜 | 主体与动作 | 光线氛围。直接输出，不要解释。',
      );
    } catch {
      desc = '（视觉分析失败）';
    }
    descriptions.push(`镜头${i + 1} @${times[i].toFixed(1)}s：${desc}`);

    const id = `node-${nanoid(8)}`;
    useCanvasStore.getState().addNode({
      id,
      type: 'image',
      position: { x: baseX + (i % 5) * cellW, y: baseY + Math.floor(i / 5) * 200 },
      style: defaultNodeStyle('image'),
      data: {
        generatedImageUrl: toAssetUrl(framePath),
        localPath: framePath,
        description: desc.slice(0, 120),
        isUploadedImage: true,
      },
    });
    useCanvasStore.getState().onConnect({ source: nodeId, target: id, sourceHandle: null, targetHandle: null });
  }

  // Summary storyboard table as a text node
  const summaryId = `node-${nanoid(8)}`;
  const summaryText = `# 分镜表\n\n${descriptions.join('\n\n')}\n\n> 复刻某镜头运镜时，可直接复制对应行作为视频生成提示词的骨架。`;
  const summarySize = textNodeSize(summaryText);
  useCanvasStore.getState().addNode({
    id: summaryId,
    type: 'text',
    position: { x: baseX - 260, y: baseY },
    style: { width: summarySize.width, height: summarySize.height },
    data: {
      description: '分镜表（拉片结果）',
      generatedContent: summaryText,
    },
  });
  useCanvasStore.getState().onConnect({ source: nodeId, target: summaryId, sourceHandle: null, targetHandle: null });
  onProgress?.('拉片完成');
}
