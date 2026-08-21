/**
 * imageSplit — grid-image cropping shared by StoryboardSplitter (manual
 * pick) and gridDerive (auto split-all). Crops are written to disk via
 * saveCanvasImage; nodes hold paths only.
 */
import { nanoid } from 'nanoid';
import { useCanvasStore } from '@/stores/canvasStore';
import { saveCanvasImage, toAssetUrl } from '@/lib/canvas/assetPersist';
import { loadImageBitmap } from '@/lib/canvas/imageSource';
import { captureSnapshot } from '@/lib/canvas/history';
import { defaultNodeStyle } from '@/lib/canvas/layout';

export type GridSize = 2 | 3 | 5;

/** Crop one cell of an evenly divided grid; returns the saved file path. */
export async function cropCell(
  img: ImageBitmap,
  grid: GridSize,
  cellIndex: number,
  namePrefix = 'grid',
): Promise<string> {
  const col = cellIndex % grid;
  const row = Math.floor(cellIndex / grid);
  const cw = img.width / grid;
  const ch = img.height / grid;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(cw);
  canvas.height = Math.round(ch);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, col * cw, row * ch, cw, ch, 0, 0, canvas.width, canvas.height);
  return saveCanvasImage(canvas.toDataURL('image/png'), namePrefix);
}

export interface SplitAllOptions {
  /** Per-cell description labels (e.g. ['前5秒','前3秒','后3秒','后5秒']). */
  labels?: string[];
  /** Connect each child back to this node (defaults to sourceNodeId). */
  connectTo?: string;
  namePrefix?: string;
}

/**
 * Split the ENTIRE grid into child image nodes, connected to the source.
 * Children are laid out in grid order to the right of the source node.
 */
export async function splitAll(
  sourceNodeId: string,
  imageUrl: string,
  grid: GridSize,
  opts: SplitAllOptions = {},
): Promise<string[]> {
  const store = useCanvasStore.getState();
  const src = store.nodes.find((n) => n.id === sourceNodeId);
  if (!src) return [];

  // loadImageBitmap 而非 <img>：asset:// 图片画到 canvas 会 tainted，
  // toDataURL 报 "insecure"（跨域）。ImageBitmap 从原始字节创建，干净。
  const img = await loadImageBitmap(imageUrl);
  captureSnapshot();

  const baseX = src.position.x + (src.width ?? 200) + 80;
  const baseY = src.position.y;
  const cellW = 190;
  const cellH = 170;
  const connectTo = opts.connectTo ?? sourceNodeId;
  const newIds: string[] = [];

  for (let i = 0; i < grid * grid; i++) {
    const path = await cropCell(img, grid, i, opts.namePrefix ?? 'grid');
    const col = i % grid;
    const row = Math.floor(i / grid);
    const id = `node-${nanoid(8)}`;
    useCanvasStore.getState().addNode({
      id,
      type: 'image',
      position: { x: baseX + col * cellW, y: baseY + row * cellH },
      style: defaultNodeStyle('image'),
      data: {
        generatedImageUrl: toAssetUrl(path),
        localPath: path,
        description: opts.labels?.[i] ?? `分格 ${i + 1}`,
        isUploadedImage: true,
      },
    });
    useCanvasStore.getState().onConnect({ source: connectTo, target: id, sourceHandle: null, targetHandle: null });
    newIds.push(id);
  }
  img.close();
  return newIds;
}
