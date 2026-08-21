/**
 * artifacts — manifest-first artifact index with a directory-scan fallback.
 *
 * manifest.json (per scope) records artifacts with full metadata (engine,
 * prompt, taskId) at generation time; the scanner sweeps workspace/ and
 * projects/<id>/assets/ for files written outside the pipeline (agent bash
 * scripts) and backfills bare entries.
 */
import { readTextFile, exists, BaseDirectory } from '@tauri-apps/api/fs';
import { invoke } from '@tauri-apps/api/tauri';
import { homeDir } from '@tauri-apps/api/path';

export type ArtifactType = 'image' | 'video' | 'audio' | 'doc' | 'other';

export interface ArtifactEntry {
  path: string;
  type: ArtifactType;
  size: number;
  createdAt: number;
  projectId?: string;
  engine?: string;
  prompt?: string;
  taskId?: string;
  /** true when found by the scanner rather than recorded by the pipeline. */
  scanned?: boolean;
}

const MANIFEST_REL = '.kunpeng/artifacts-manifest.json';

export function typeFromPath(path: string): ArtifactType {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (/^(png|jpg|jpeg|webp|gif)$/.test(ext)) return 'image';
  if (/^(mp4|mov|webm)$/.test(ext)) return 'video';
  if (/^(mp3|wav|m4a|flac)$/.test(ext)) return 'audio';
  if (/^(md|txt|pdf|docx|pptx|xlsx)$/.test(ext)) return 'doc';
  return 'other';
}

// ── Manifest (single-writer queue, append semantics) ─────────────────────────
let manifestQueue: Promise<void> = Promise.resolve();

async function readManifest(): Promise<ArtifactEntry[]> {
  try {
    if (!(await exists(MANIFEST_REL, { dir: BaseDirectory.Home }))) return [];
    const raw = await readTextFile(MANIFEST_REL, { dir: BaseDirectory.Home });
    const parsed = JSON.parse(raw) as { entries?: ArtifactEntry[] };
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

export function appendArtifact(entry: Omit<ArtifactEntry, 'size' | 'createdAt'> & { size?: number; createdAt?: number }): Promise<void> {
  const next = manifestQueue.then(async () => {
    const { writeTextFile } = await import('@tauri-apps/api/fs');
    const entries = await readManifest();
    if (entries.some((e) => e.path === entry.path)) return;
    entries.push({
      size: 0,
      createdAt: Date.now(),
      ...entry,
    });
    await writeTextFile(MANIFEST_REL, JSON.stringify({ entries }), { dir: BaseDirectory.Home });
  }).catch((err) => console.warn('[artifacts] append failed:', err));
  manifestQueue = next;
  return next;
}

// ── Scanner ───────────────────────────────────────────────────────────────────
interface FileMeta { path: string; size: number; mtime_ms: number }

/**
 * Merge manifest entries with a fresh directory sweep. Manifest metadata
 * wins for known paths; unknown files become bare scanned entries.
 */
export async function listArtifacts(): Promise<ArtifactEntry[]> {
  const home = await homeDir();
  const scanOpts = { maxEntries: 50000 };
  const [manifest, workspaceFiles, projectFiles, aigcFiles] = await Promise.all([
    readManifest(),
    invoke<FileMeta[]>('scan_dir_meta', { path: `${home}.kunpeng/workspace`, ...scanOpts }).catch(() => [] as FileMeta[]),
    invoke<FileMeta[]>('scan_dir_meta', { path: `${home}.kunpeng/projects`, ...scanOpts }).catch(() => [] as FileMeta[]),
    invoke<FileMeta[]>('scan_dir_meta', { path: `${home}.kunpeng/aigc-memory`, ...scanOpts }).catch(() => [] as FileMeta[]),
  ]);

  const byPath = new Map<string, ArtifactEntry>();
  for (const m of manifest) byPath.set(m.path, m);

  for (const f of [...workspaceFiles, ...projectFiles, ...aigcFiles]) {
    const type = typeFromPath(f.path);
    if (type === 'other') continue; // skip code/tmp noise
    // canvas.json / project.json are not artifacts
    if (f.path.endsWith('.json')) continue;
    const existing = byPath.get(f.path);
    if (existing) {
      if (!existing.size) existing.size = f.size;
      continue;
    }
    const projectMatch = /\.kunpeng\/(?:projects|aigc-memory\/projects)\/([^/]+)\//.exec(f.path);
    byPath.set(f.path, {
      path: f.path,
      type,
      size: f.size,
      createdAt: f.mtime_ms,
      projectId: projectMatch?.[1],
      scanned: true,
    });
  }

  // Scanned-only entries are dropped if the file vanished; manifest entries
  // are trusted (written by our pipeline) so they survive regardless of scan
  // cap — a deleted file will simply fail to render in the UI.
  const liveFiles = new Set([...workspaceFiles, ...projectFiles, ...aigcFiles].map((f) => f.path));
  return [...byPath.values()]
    .filter((e) => !e.scanned || liveFiles.has(e.path))
    .sort((a, b) => b.createdAt - a.createdAt);
}
