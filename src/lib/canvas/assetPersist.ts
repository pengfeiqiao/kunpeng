/**
 * assetPersist — write canvas-generated images to disk instead of storing
 * base64 data URIs inside canvas nodes.
 *
 * Why: canvasStore persists all node data. A single
 * `canvas.toDataURL('image/png')` crop can be multiple MB; a handful of them
 * blows the 5-10MB localStorage quota and the entire canvas silently stops
 * persisting. Nodes must only ever hold file paths (rendered via
 * `convertFileSrc`), never raw image bytes.
 */
import { invoke } from '@tauri-apps/api/tauri';
import { writeBinaryFile, createDir } from '@tauri-apps/api/fs';
import { convertFileSrc } from '@tauri-apps/api/tauri';

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; ext: string } {
  const match = dataUrl.match(/^data:image\/(\w+);base64,(.*)$/s);
  if (!match) throw new Error('不是有效的 data:image base64 URL');
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const binStr = atob(match[2]);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
  return { bytes, ext };
}

let counter = 0;

/**
 * Persist an image (data URL or raw bytes) into today's workspace images dir.
 * Returns the absolute file path. Use `convertFileSrc(path)` for display.
 */
export async function saveCanvasImage(
  source: string | Uint8Array,
  namePrefix = 'canvas',
): Promise<string> {
  const workspace = await invoke<string>('ensure_workspace');
  const dir = `${workspace}/images`;
  await createDir(dir, { recursive: true }).catch(() => {});

  let bytes: Uint8Array;
  let ext = 'png';
  if (typeof source === 'string') {
    ({ bytes, ext } = dataUrlToBytes(source));
  } else {
    bytes = source;
  }

  const path = `${dir}/${namePrefix}_${Date.now()}_${++counter}.${ext}`;
  await writeBinaryFile(path, bytes);
  return path;
}

/** Absolute local path → asset URL renderable in <img src>. */
export function toAssetUrl(path: string): string {
  return convertFileSrc(path);
}

export function isDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:image/');
}

/**
 * Migration sweep: walk node data, persist any residual data-URL images to
 * disk and replace them with asset URLs; also reset transient flags
 * (`isGenerating`) that may have been persisted by older builds. Returns the
 * patched nodes array (same reference if nothing changed).
 */
export async function migrateNodeImages<T extends { data?: Record<string, unknown> }>(
  nodes: T[],
): Promise<{ nodes: T[]; changed: boolean }> {
  let changed = false;
  const out: T[] = [];
  for (const node of nodes) {
    const data = node.data;
    if (!data) {
      out.push(node);
      continue;
    }
    let patched: Record<string, unknown> | null = null;
    for (const key of ['referenceImage', 'generatedImageUrl', 'imageUrl']) {
      const val = data[key];
      if (isDataUrl(val)) {
        try {
          const path = await saveCanvasImage(val, 'migrated');
          patched = patched ?? { ...data };
          patched[key] = toAssetUrl(path);
          changed = true;
        } catch {
          // Keep the data URL rather than losing the image; quota pressure
          // remains but content is preserved.
        }
      }
    }
    if (data.isGenerating === true) {
      patched = patched ?? { ...data };
      patched.isGenerating = false;
      changed = true;
    }
    out.push(patched ? { ...node, data: patched } : node);
  }
  return { nodes: changed ? out : nodes, changed };
}
