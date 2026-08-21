import { convertFileSrc } from '@tauri-apps/api/tauri';
import type { XYPosition } from 'reactflow';
import { nanoid } from 'nanoid';
import { useCanvasStore } from '@/stores/canvasStore';
import { captureSnapshot } from '@/lib/canvas/history';
import { defaultNodeStyle } from '@/lib/canvas/layout';

export const CANVAS_MEDIA_EXTENSIONS = [
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'heif',
  'mp4', 'mov', 'webm', 'm4v', 'avi', 'mkv',
  'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus',
];

type MediaKind = 'image' | 'video' | 'audio';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'heif']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'm4v', 'avi', 'mkv']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus']);

function extname(path: string): string {
  const clean = path.split('?')[0].split('#')[0];
  const idx = clean.lastIndexOf('.');
  return idx >= 0 ? clean.slice(idx + 1).toLowerCase() : '';
}

export function detectCanvasMediaKind(path: string): MediaKind | null {
  const ext = extname(path);
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  return null;
}

export function createMediaNodesFromPaths(paths: string[], basePosition: XYPosition): {
  createdIds: string[];
  unsupportedPaths: string[];
} {
  const seen = new Set<string>();
  const items = paths
    .map((path) => ({ path, kind: detectCanvasMediaKind(path) }))
    .filter(({ path }) => {
      if (!path || seen.has(path)) return false;
      seen.add(path);
      return true;
    });

  const supported = items.filter((item): item is { path: string; kind: MediaKind } => Boolean(item.kind));
  const unsupportedPaths = items.filter((item) => !item.kind).map((item) => item.path);
  if (supported.length === 0) return { createdIds: [], unsupportedPaths };

  captureSnapshot();
  const store = useCanvasStore.getState();
  const createdIds: string[] = [];

  supported.forEach(({ path, kind }, i) => {
    const id = `node-${nanoid(8)}`;
    const assetUrl = convertFileSrc(path);
    const fileName = path.split('/').pop() || path;
    const size = defaultNodeStyle(kind)!;
    const position = {
      x: basePosition.x + (i % 3) * (size.width + 52),
      y: basePosition.y + Math.floor(i / 3) * (size.height + 64),
    };

    store.addNode({
      id,
      type: kind,
      position,
      style: size,
      data: kind === 'audio'
        ? { audioUrl: assetUrl, localPath: path, fileName, description: '' }
        : kind === 'video'
        ? {
          generatedVideoUrl: assetUrl,
          localPath: path,
          sourceVideoPath: path,
          mediaRole: 'reference',
          description: '',
        }
        : { referenceImage: assetUrl, localPath: path, isUploadedImage: true, description: '' },
    });
    createdIds.push(id);
  });

  store.setSelectedNodeId(createdIds[createdIds.length - 1] ?? null);
  return { createdIds, unsupportedPaths };
}
