/**
 * videoTools — video-deep operations for canvas video nodes.
 *
 * 延长视频: Seedance multimodal natively accepts videoUrls (maxCount 3) —
 * we pass the source video itself as reference with an extension prompt.
 * No ffmpeg / frame extraction needed (official Seedance video-extend path).
 *
 * 对口型: RunningHub has kling-lip-sync (3-step session flow); routed via
 * the agent which can orchestrate identify-face → lip-sync-video with
 * runninghub.py.
 */
import { nanoid } from 'nanoid';
import { useCanvasStore } from '@/stores/canvasStore';
import { captureSnapshot } from '@/lib/canvas/history';
import { generateForNode } from '@/lib/canvasGen';
import { defaultNodeStyle } from '@/lib/canvas/layout';

/** Extend a video: derive a connected video node and generate with the
 * source video as a multimodal reference. */
export async function extendVideo(sourceNodeId: string, seconds = 5): Promise<void> {
  const store = useCanvasStore.getState();
  const src = store.nodes.find((n) => n.id === sourceNodeId);
  if (!src) return;
  const d = src.data as Record<string, unknown>;
  const videoPath = (d.localPath as string) || (d.generatedVideoUrl as string);
  if (!videoPath) return;

  captureSnapshot();
  const newId = `node-${nanoid(8)}`;
  const prompt = `延长 @视频1 的内容：保持场景、人物、光线、运动方向完全一致，自然继续后续 ${seconds} 秒的剧情动作。`;
  store.addNode({
    id: newId,
    type: 'video',
    position: { x: src.position.x + (src.width ?? 360) + 60, y: src.position.y },
    style: defaultNodeStyle('video'),
    data: { description: prompt },
  });
  store.onConnect({ source: sourceNodeId, target: newId, sourceHandle: null, targetHandle: null });
  store.setSelectedNodeId(newId);

  await generateForNode({
    nodeId: newId,
    engineId: 'seedance-2.0',
    prompt,
    referenceUrls: [],
    videoUrls: [videoPath],
    params: { duration: String(seconds) },
    overwrite: true,
  });
}

/** Lip-sync via agent (kling-lip-sync is a 3-step session API — the agent
 * orchestrates it with runninghub.py). */
export function lipSyncViaAgent(videoNodeId: string): void {
  const store = useCanvasStore.getState();
  const node = store.nodes.find((n) => n.id === videoNodeId);
  const d = node?.data as Record<string, unknown> | undefined;
  const videoPath = (d?.localPath as string) || (d?.generatedVideoUrl as string) || '';
  // Connected audio node = the voice track
  const audio = store.edges
    .filter((e) => e.target === videoNodeId)
    .map((e) => store.nodes.find((n) => n.id === e.source))
    .find((n) => n?.type === 'audio');
  const audioPath = (audio?.data as Record<string, unknown> | undefined)?.localPath as string | undefined;

  store.triggerAgentAction(
    'ai-lip-sync',
    videoNodeId,
    `请为节点 ${videoNodeId} 的视频做对口型（lip sync）。
视频文件：${videoPath}
${audioPath ? `音频文件：${audioPath}` : '（未连接音频节点 —— 请询问用户提供音频，或用 kling-lip-sync/tts 合成语音）'}
使用 RunningHub 可灵对口型三步流程（runninghub.py）：
1. kling-lip-sync/identify-face --param videoUrl=<视频> → 获取 sessionId + faceId
2. （若无音频）kling-lip-sync/tts 合成语音 → audioId
3. kling-lip-sync/lip-sync-video --param sessionId/faceId/audioUrl(或audioId)/soundStartTime=0/soundEndTime=<音频时长ms>/soundInsertTime=0
完成后用 canvas_update_node 把结果视频路径写入节点 ${videoNodeId} 的 generatedVideoUrl。`,
  );
}
