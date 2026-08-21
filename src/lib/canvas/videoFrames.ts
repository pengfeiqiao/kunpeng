/**
 * videoFrames — frame capture from video nodes (TapNow 首尾帧截取同款).
 */
import { nanoid } from 'nanoid';
import { useCanvasStore } from '@/stores/canvasStore';
import { saveCanvasImage, toAssetUrl } from '@/lib/canvas/assetPersist';
import { captureSnapshot } from '@/lib/canvas/history';
import { defaultNodeStyle } from '@/lib/canvas/layout';

/** Draw the video element's current frame and persist it. Returns file path. */
export async function captureFrameAt(videoEl: HTMLVideoElement): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  return saveCanvasImage(canvas.toDataURL('image/png'), 'frame');
}

/** Spawn an image node from a captured frame, connected to the source video. */
export function spawnFrameNode(srcNodeId: string, framePath: string, timeSec: number): string {
  const store = useCanvasStore.getState();
  const src = store.nodes.find((n) => n.id === srcNodeId);
  captureSnapshot();
  const id = `node-${nanoid(8)}`;
  store.addNode({
    id,
    type: 'image',
    position: {
      x: (src?.position.x ?? 100) + (src?.width ?? 360) + 60,
      y: (src?.position.y ?? 100) + Math.random() * 60,
    },
    style: defaultNodeStyle('image'),
    data: {
      generatedImageUrl: toAssetUrl(framePath),
      localPath: framePath,
      description: `取帧 @${timeSec.toFixed(1)}s`,
      isUploadedImage: true,
    },
  });
  store.onConnect({ source: srcNodeId, target: id, sourceHandle: null, targetHandle: null });
  return id;
}
