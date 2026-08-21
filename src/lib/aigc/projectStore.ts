import {
  readTextFile,
  writeTextFile,
  renameFile,
  exists,
  createDir,
  readDir,
  removeFile,
  removeDir,
  BaseDirectory,
} from '@tauri-apps/api/fs';

// ─── Architecture ────────────────────────────────────────────────────────
// File-as-source-of-truth, one directory per AIGC project.
//
//   ~/.kunpeng/aigc-memory/projects/projects-index.json
//        → AigcProject[] (lightweight index for the project list)
//   ~/.kunpeng/aigc-memory/projects/<id>/project.json
//        → full project metadata
//   ~/.kunpeng/aigc-memory/projects/<id>/{sources,parsed,prompts,scenes,assets}/
//        → per-stage artifacts (docx, json, images, ...)
// ──────────────────────────────────────────────────────────────────────────

const PROJECTS_DIR = '.kunpeng/aigc-memory/projects';
const INDEX_REL_PATH = `${PROJECTS_DIR}/projects-index.json`;
const INDEX_TMP_REL_PATH = `${PROJECTS_DIR}/projects-index.json.tmp`;

export type AigcProjectStatus =
  | 'draft'
  | 'parsed'
  | 'prompts-ready'
  | 'scenes-ready'
  | 'assets-ready'
  | 'bitable-created'
  | 'video-generating'
  | 'completed';

export type VideoEngine = 'dreamina' | 'rhtv';

export interface AigcProjectSource {
  name: string;
  type: 'docx' | 'md' | 'xlsx' | 'pdf' | 'link';
  size: number;
  uploadedAt: number;
  url?: string;
}

export interface AigcProjectStats {
  shots: number;
  scenes: number;
  assets: number;
  videosCompleted: number;
}

export interface AigcProjectBitable {
  baseToken: string;
  tableId: string;
  url: string;
}

export interface AigcProject {
  id: string;
  name: string;
  slug: string;
  createdAt: number;
  updatedAt: number;
  status: AigcProjectStatus;
  videoEngine: VideoEngine;
  bitable?: AigcProjectBitable;
  sources: AigcProjectSource[];
  stats: AigcProjectStats;
  handoffImports?: {
    // canvas 记录全部导入批次：main 为稳定 id 主批，copies 为时间戳 id 的副本批次。
    // 旧数据是单批 { nodeIds, at, count }（无 main 字段），由读取方归一为 { main }（见 StepHandoff）。
    canvas?: {
      main?: { nodeIds: string[]; at: number; count: number };
      copies?: { nodeIds: string[]; at: number; count: number }[];
    };
    editor?: { clipIds: string[]; at: number; count: number };
  };
}

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function projectDir(id: string): string {
  return `${PROJECTS_DIR}/${id}`;
}

function projectFilePath(id: string): string {
  return `${projectDir(id)}/project.json`;
}

async function ensureProjectsDir(): Promise<void> {
  await createDir(PROJECTS_DIR, { dir: BaseDirectory.Home, recursive: true });
}

// ensureProjectSubdirs 结果缓存：createDir(recursive) 幂等，每个项目每次会话只需确保一次。
// 缓存 Promise 而非完成标记，让并发的首次写入共享同一次执行；
// 失败时逐出缓存，保留下次调用重试的语义。
const ensuredSubdirs = new Map<string, Promise<void>>();

async function ensureProjectSubdirs(id: string): Promise<void> {
  const cached = ensuredSubdirs.get(id);
  if (cached) return cached;
  const task = (async () => {
    const dir = projectDir(id);
    for (const sub of ['', 'sources', 'parsed', 'prompts', 'scenes', 'scenes/anchors', 'scenes/variants', 'assets']) {
      await createDir(sub ? `${dir}/${sub}` : dir, { dir: BaseDirectory.Home, recursive: true });
    }
  })();
  ensuredSubdirs.set(id, task);
  task.catch(() => {
    if (ensuredSubdirs.get(id) === task) ensuredSubdirs.delete(id);
  });
  return task;
}

// ─── slug generation ────────────────────────────────────────────────────
// Strip CJK/whitespace, lowercase, dedupe with -2/-3 suffixes.
function rawSlug(name: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/[一-鿿]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ascii || `proj-${Date.now().toString(36)}`;
}

function uniqueSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

// ─── Index file ─────────────────────────────────────────────────────────
export async function readProjectsIndex(): Promise<AigcProject[]> {
  try {
    if (!(await exists(INDEX_REL_PATH, { dir: BaseDirectory.Home }))) return [];
    const raw = await readTextFile(INDEX_REL_PATH, { dir: BaseDirectory.Home });
    const parsed = safeParse<AigcProject[]>(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('[projectStore] readProjectsIndex failed:', err);
    return [];
  }
}

async function writeProjectsIndex(projects: AigcProject[]): Promise<void> {
  try {
    await ensureProjectsDir();
    await writeTextFile(
      { path: INDEX_TMP_REL_PATH, contents: JSON.stringify(projects, null, 2) },
      { dir: BaseDirectory.Home },
    );
    await renameFile(INDEX_TMP_REL_PATH, INDEX_REL_PATH, { dir: BaseDirectory.Home });
  } catch (err) {
    console.warn('[projectStore] writeProjectsIndex failed:', err);
  }
}

// ─── Project CRUD ───────────────────────────────────────────────────────
export async function listProjects(): Promise<AigcProject[]> {
  return readProjectsIndex();
}

export async function readProject(id: string): Promise<AigcProject | null> {
  try {
    const path = projectFilePath(id);
    if (!(await exists(path, { dir: BaseDirectory.Home }))) return null;
    const raw = await readTextFile(path, { dir: BaseDirectory.Home });
    const parsed = safeParse<AigcProject>(raw);
    if (!parsed) return null;
    if (parsed.id !== id) {
      console.warn('[projectStore] project id mismatch, repairing in memory:', parsed.id, '=>', id);
      return { ...parsed, id };
    }
    return parsed;
  } catch (err) {
    console.warn('[projectStore] readProject failed:', err);
    return null;
  }
}

export async function writeProject(p: AigcProject): Promise<void> {
  try {
    await ensureProjectSubdirs(p.id);
    const path = projectFilePath(p.id);
    const tmp = `${path}.tmp`;
    await writeTextFile(
      { path: tmp, contents: JSON.stringify({ ...p, updatedAt: Date.now() }, null, 2) },
      { dir: BaseDirectory.Home },
    );
    await renameFile(tmp, path, { dir: BaseDirectory.Home });

    // Sync index entry —— 仅当索引条目（AigcProject 全字段即索引可见字段）实际变化时
    // 才重写 projects-index.json，避免每次 save 都 读+写tmp+rename 整个索引。
    // JSON.stringify 比较不会出现漏报：值不同则串必不同；键序差异只可能多写一次（无害）。
    const idx = await readProjectsIndex();
    const i = idx.findIndex((x) => x.id === p.id);
    if (i >= 0 && JSON.stringify(idx[i]) === JSON.stringify(p)) return;
    if (i >= 0) idx[i] = p;
    else idx.push(p);
    await writeProjectsIndex(idx);
  } catch (err) {
    console.warn('[projectStore] writeProject failed:', err);
  }
}

export async function createProject(name: string): Promise<AigcProject> {
  const idx = await readProjectsIndex();
  const slug = uniqueSlug(rawSlug(name) || 'project', new Set(idx.map((p) => p.slug)));
  const id = `proj-${Date.now().toString(36)}-${slug}`;
  const now = Date.now();
  const project: AigcProject = {
    id,
    name: name.trim() || '未命名项目',
    slug,
    createdAt: now,
    updatedAt: now,
    status: 'draft',
    videoEngine: 'dreamina',
    sources: [],
    stats: { shots: 0, scenes: 0, assets: 0, videosCompleted: 0 },
  };
  await ensureProjectSubdirs(id);
  await writeProject(project);
  return project;
}

export async function deleteProject(id: string): Promise<void> {
  try {
    ensuredSubdirs.delete(id);
    const dir = projectDir(id);
    if (await exists(dir, { dir: BaseDirectory.Home })) {
      await removeDir(dir, { dir: BaseDirectory.Home, recursive: true });
    }
    const idx = await readProjectsIndex();
    await writeProjectsIndex(idx.filter((p) => p.id !== id));
  } catch (err) {
    console.warn('[projectStore] deleteProject failed:', err);
  }
}

// ─── Per-project file ops ───────────────────────────────────────────────
export async function readProjectFile(id: string, relPath: string): Promise<string | null> {
  try {
    const path = `${projectDir(id)}/${relPath}`;
    if (!(await exists(path, { dir: BaseDirectory.Home }))) return null;
    return await readTextFile(path, { dir: BaseDirectory.Home });
  } catch (err) {
    console.warn('[projectStore] readProjectFile failed:', err);
    return null;
  }
}

export async function writeProjectFile(
  id: string,
  relPath: string,
  contents: string,
): Promise<void> {
  try {
    await ensureProjectSubdirs(id);
    const path = `${projectDir(id)}/${relPath}`;
    // Ensure parent dir exists
    const parent = path.substring(0, path.lastIndexOf('/'));
    if (parent) await createDir(parent, { dir: BaseDirectory.Home, recursive: true });
    await writeTextFile({ path, contents }, { dir: BaseDirectory.Home });
  } catch (err) {
    console.warn('[projectStore] writeProjectFile failed:', err);
  }
}

export async function deleteProjectFile(id: string, relPath: string): Promise<void> {
  try {
    const path = `${projectDir(id)}/${relPath}`;
    if (await exists(path, { dir: BaseDirectory.Home })) {
      await removeFile(path, { dir: BaseDirectory.Home });
    }
  } catch (err) {
    console.warn('[projectStore] deleteProjectFile failed:', err);
  }
}

export async function listProjectFiles(id: string, subDir: string): Promise<string[]> {
  try {
    const path = `${projectDir(id)}/${subDir}`;
    if (!(await exists(path, { dir: BaseDirectory.Home }))) return [];
    const entries = await readDir(path, { dir: BaseDirectory.Home });
    return entries.filter((e) => e.name).map((e) => e.name!);
  } catch (err) {
    console.warn('[projectStore] listProjectFiles failed:', err);
    return [];
  }
}

export function projectAbsPath(id: string): string {
  return `~/.kunpeng/aigc-memory/projects/${id}`;
}
