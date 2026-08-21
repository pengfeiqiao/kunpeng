/**
 * snapshot — 机位截图落画布：dataURL → saveCanvasImage → image 节点。
 */
import { nanoid } from 'nanoid';
import { useCanvasStore } from '@/stores/canvasStore';
import { saveCanvasImage, toAssetUrl } from '@/lib/canvas/assetPersist';
import { captureSnapshot } from '@/lib/canvas/history';
import { defaultNodeStyle } from '@/lib/canvas/layout';
import type { DirectorShot } from './types';

let spawnCount = 0;

/** 截图落盘并建画布节点，返回节点 id */
export async function spawnShotNode(
  dataUrl: string,
  _shot: DirectorShot,
  description: string,
): Promise<string> {
  const path = await saveCanvasImage(dataUrl, 'director');
  const store = useCanvasStore.getState();
  captureSnapshot();

  // 放置：画布现有节点包围盒右侧，连拍纵向错位
  const nodes = store.nodes;
  let baseX = 120;
  let baseY = 120;
  if (nodes.length > 0) {
    baseX = Math.max(...nodes.map((n) => n.position.x + (n.width ?? 240))) + 80;
    baseY = Math.min(...nodes.map((n) => n.position.y));
  }
  const id = `node-${nanoid(8)}`;
  store.addNode({
    id,
    type: 'image',
    position: { x: baseX, y: baseY + (spawnCount++ % 8) * 260 },
    style: defaultNodeStyle('image'),
    data: {
      generatedImageUrl: toAssetUrl(path),
      localPath: path,
      description,
      isUploadedImage: true,
    },
  });
  store.setSelectedNodeId(id);
  return id;
}

/** 连拍计数重置（打开导演台时调） */
export function resetSpawnLayout(): void {
  spawnCount = 0;
}
