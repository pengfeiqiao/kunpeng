/**
 * videoToolActions — 视频节点工具栏动作（高清/帧率增强/人声分离/进剪辑/加入 Agent）。
 * upscaler / fps-increaser 走 rhtv 衍生新视频节点；extract-vocal 产出音频建 AudioNode。
 */
import { nanoid } from 'nanoid';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { useCanvasStore } from '@/stores/canvasStore';
import { useChatStore } from '@/stores';
import { useEditorStore } from '@/stores/editorStore';
import { runGeneration } from '@/lib/canvasGen';
import { captureSnapshot } from '@/lib/canvas/history';
import { defaultNodeStyle } from '@/lib/canvas/layout';
import { openCanvasNodeInAgent } from '@/lib/canvas/nodeAgent';

function getNodeVideo(nodeId: string): { url?: string; path?: string; description?: string } {
  const n = useCanvasStore.getState().nodes.find((x) => x.id === nodeId);
  const d = n?.data as Record<string, unknown> | undefined;
  return {
    url: d?.generatedVideoUrl as string | undefined,
    path: d?.localPath as string | undefined,
    description: d?.description as string | undefined,
  };
}

function spawnDerived(sourceNodeId: string, type: 'video' | 'audio', label: string): string {
  const store = useCanvasStore.getState();
  const src = store.nodes.find((n) => n.id === sourceNodeId);
  captureSnapshot();
  const newId = `node-${nanoid(8)}`;
  store.addNode({
    id: newId,
    type,
    position: {
      x: (src?.position.x ?? 200) + (src?.width ?? 280) + 60,
      y: src?.position.y ?? 200,
    },
    style: defaultNodeStyle(type),
    data: { description: label, isGenerating: true },
  });
  store.onConnect({ source: sourceNodeId, target: newId, sourceHandle: null, targetHandle: null });
  store.setSelectedNodeId(newId);
  return newId;
}

/** 帧率增强（rhart-video/video-fps-increaser） */
export async function increaseFps(nodeId: string): Promise<void> {
  const { url, description } = getNodeVideo(nodeId);
  if (!url) return;
  const newId = spawnDerived(nodeId, 'video', `${description?.slice(0, 20) || ''} 帧率增强`);
  const result = await runGeneration({
    engineId: 'video-fps-increaser',
    prompt: 'increase fps',
    videoUrls: [url],
    nodeId: newId,
  });
  const store = useCanvasStore.getState();
  if (result.success && result.resultPaths[0]) {
    store.updateNode(newId, {
      isGenerating: false,
      justCompletedAt: Date.now(),
      generatedVideoUrl: result.resultUrls[0],
      localPath: result.resultPaths[0],
      mediaRole: 'output',
    });
  } else {
    store.updateNode(newId, { isGenerating: false, description: `帧率增强失败: ${result.error?.slice(0, 60) ?? ''}` });
  }
}

// AI 应用通道的分辨率枚举与标准模型不同（无 2K，4K 小写），容灾时映射。
const APP_RESOLUTION_MAP: Record<string, string> = { '720p': '720p', '1080p': '1080p', '2K': '4k', '4K': '4k' };

/** 提升分辨率（标准模型 rhart-video/video-upscaler 主通道，失败容灾 AI 应用） */
export async function upscaleVideo(nodeId: string, targetResolution = '720p'): Promise<void> {
  const { url, description } = getNodeVideo(nodeId);
  if (!url) return;
  const base = description?.slice(0, 20) || '';
  const newId = spawnDerived(nodeId, 'video', `${base} 超分 ${targetResolution}`);
  const store = useCanvasStore.getState();

  let result = await runGeneration({
    engineId: 'video-upscaler',
    prompt: 'upscale video',
    videoUrls: [url],
    params: { targetResolution },
    nodeId: newId,
  });

  // 容灾：只有确定未提交/供应商明确失败时才换通道——提交状态不明就重提
  // 可能两边都扣费（billingSafety 纪律）。快速通道没有 2K 档，2K 映射为 4k。
  const cancelled = (result.error ?? '') === '已取消';
  const fallbackEligible = !result.success
    && !cancelled
    && !result.backgroundPending
    && !result.submissionUncertain
    && (!result.providerTaskId || result.providerFailed === true);
  let fallbackNote = '';
  if (fallbackEligible) {
    const appResolution = APP_RESOLUTION_MAP[targetResolution] ?? '1080p';
    fallbackNote = appResolution !== targetResolution ? `（快速通道无 ${targetResolution} 档，已按 ${appResolution} 提交）` : '（已切换快速通道）';
    result = await runGeneration({
      engineId: 'video-upscaler-app',
      prompt: 'upscale video',
      videoUrls: [url],
      params: { targetResolution: appResolution, targetFps: '30' },
      nodeId: newId,
    });
  }

  if (result.success && result.resultPaths[0]) {
    store.updateNode(newId, {
      isGenerating: false,
      justCompletedAt: Date.now(),
      generatedVideoUrl: result.resultUrls[0],
      localPath: result.resultPaths[0],
      mediaRole: 'output',
      ...(fallbackNote ? { description: `${base} 超分 ${targetResolution}${fallbackNote}` } : {}),
    });
  } else {
    store.updateNode(newId, { isGenerating: false, description: `提升分辨率失败: ${result.error?.slice(0, 60) ?? ''}` });
  }
}

/** 音频分离（rhart-audio/extract-vocal → AudioNode；失败退本地 ffmpeg 抽音轨） */
export async function separateAudio(nodeId: string): Promise<void> {
  const { url, path, description } = getNodeVideo(nodeId);
  if (!url) return;
  const newId = spawnDerived(nodeId, 'audio', `${description?.slice(0, 20) || ''} 音频分离`);
  const store = useCanvasStore.getState();

  const result = await runGeneration({
    engineId: 'extract-vocal',
    prompt: 'extract vocal',
    videoUrls: [url],
    nodeId: newId,
  });
  if (result.success && result.resultPaths[0]) {
    store.updateNode(newId, {
      isGenerating: false,
      justCompletedAt: Date.now(),
      audioUrl: result.resultUrls[0],
      localPath: result.resultPaths[0],
      fileName: result.resultPaths[0].split('/').pop(),
    });
    return;
  }

  // 兜底：本地 ffmpeg 抽完整音轨
  if (path) {
    try {
      const { invoke } = await import('@tauri-apps/api/tauri');
      const { detectFfmpeg } = await import('@/lib/canvas/videoCompose');
      const ffmpeg = await detectFfmpeg();
      if (ffmpeg) {
        const workspace = await invoke<string>('ensure_workspace');
        const out = `${workspace}/audio/extract_${Date.now()}.mp3`;
        const { createDir } = await import('@tauri-apps/api/fs');
        await createDir(`${workspace}/audio`, { recursive: true }).catch(() => {});
        const r = await invoke<{ exit_code: number; stderr: string }>('execute_command', {
          command: `${ffmpeg} -i ${JSON.stringify(path)} -vn -q:a 2 ${JSON.stringify(out)} -y`,
          timeoutMs: 180000,
        });
        if (r.exit_code === 0) {
          store.updateNode(newId, {
            isGenerating: false,
            justCompletedAt: Date.now(),
            audioUrl: convertFileSrc(out),
            localPath: out,
            fileName: out.split('/').pop(),
            description: `${description?.slice(0, 20) || ''} 音轨提取（本地）`,
          });
          return;
        }
      }
    } catch { /* fall through */ }
  }
  store.updateNode(newId, { isGenerating: false, description: `音频分离失败: ${result.error?.slice(0, 60) ?? ''}` });
}

/** 进剪辑：当前视频加入时间轴并跳转剪辑视图 */
export async function sendToEditor(nodeId: string): Promise<void> {
  const { path, description } = getNodeVideo(nodeId);
  if (!path) return;
  await useEditorStore.getState().addClips([{ path, label: description?.slice(0, 24), sourceNodeId: nodeId }]);
  useChatStore.getState().setActiveView('editor');
}

/** 加入 Agent：锁定当前视频节点并打开画布助手。 */
export function sendToAgent(nodeId: string): void {
  openCanvasNodeInAgent(nodeId);
}
