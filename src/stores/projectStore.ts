/**
 * projectStore — multi-project model (Adobe-style project console).
 *
 * Metadata lives in localStorage ('kunpeng-projects'); each project's canvas
 * is a FILE at ~/.kunpeng/projects/<id>/canvas.json (image data are paths
 * thanks to assetPersist, so files stay small). Switching projects flushes
 * the live canvas to the old project's file, then loads the new one.
 *
 * Migration: on first run, a non-empty legacy global canvas (localStorage
 * 'kunpeng-canvas') becomes the "默认项目".
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeLocalStorage } from '@/lib/safeStorage';
import {
  readTextFile,
  writeTextFile,
  createDir,
  exists,
  removeDir,
  BaseDirectory,
} from '@tauri-apps/api/fs';
import type { Node, Edge } from 'reactflow';
import { nanoid } from 'nanoid';
import { useCanvasStore, repairNodeIntegrity } from './canvasStore';
import { getVideoThumb } from '@/lib/canvas/videoThumbs';

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Cover thumbnail: asset URL of a recent artifact. */
  coverUrl?: string;
  /** Optional link to an existing AIGC project (aigc-memory). */
  aigcProjectId?: string;
}

interface CanvasFile {
  schemaVersion: 1;
  nodes: Node[];
  edges: Edge[];
  updatedAt: number;
}

const PROJECTS_DIR = '.kunpeng/projects';
const projRel = (id: string) => `${PROJECTS_DIR}/${id}`;
const canvasRel = (id: string) => `${projRel(id)}/canvas.json`;

async function readCanvasFile(projectId: string): Promise<CanvasFile | null> {
  try {
    if (!(await exists(canvasRel(projectId), { dir: BaseDirectory.Home }))) return null;
    const raw = await readTextFile(canvasRel(projectId), { dir: BaseDirectory.Home });
    return JSON.parse(raw) as CanvasFile;
  } catch {
    return null;
  }
}

interface QueuedCanvasWrite {
  seq: number;
  nodes: Node[];
  edges: Edge[];
}

interface CanvasWriteQueue {
  nextSeq: number;
  writtenSeq: number;
  pending: QueuedCanvasWrite | null;
  running: Promise<void> | null;
  waiters: { seq: number; resolve: () => void }[];
}

// Each project keeps at most the snapshot currently being written and the
// newest pending snapshot. Intermediate Agent updates are superseded instead
// of retaining full node arrays in an ever-growing Promise chain.
const writeQueues = new Map<string, CanvasWriteQueue>();

async function writeCanvasFile(projectId: string, nodes: Node[], edges: Edge[]): Promise<void> {
  let queue = writeQueues.get(projectId);
  if (!queue) {
    queue = {
      nextSeq: 0,
      writtenSeq: 0,
      pending: null,
      running: null,
      waiters: [],
    };
    writeQueues.set(projectId, queue);
  }

  const seq = ++queue.nextSeq;
  queue.pending = { seq, nodes, edges };
  const completed = new Promise<void>((resolve) => {
    queue!.waiters.push({ seq, resolve });
  });

  if (!queue.running) {
    const activeQueue = queue;
    activeQueue.running = (async () => {
      while (activeQueue.pending) {
        const snapshot = activeQueue.pending;
        activeQueue.pending = null;
        try {
          await createDir(`${projRel(projectId)}/assets`, { dir: BaseDirectory.Home, recursive: true });
          const payload: CanvasFile = {
            schemaVersion: 1,
            nodes: snapshot.nodes,
            edges: snapshot.edges,
            updatedAt: Date.now(),
          };
          await writeTextFile(canvasRel(projectId), JSON.stringify(payload), { dir: BaseDirectory.Home });
        } catch (err) {
          console.warn('[projectStore] writeCanvasFile failed:', err);
        }
        activeQueue.writtenSeq = Math.max(activeQueue.writtenSeq, snapshot.seq);
        const ready = activeQueue.waiters.filter((waiter) => waiter.seq <= activeQueue.writtenSeq);
        activeQueue.waiters = activeQueue.waiters.filter((waiter) => waiter.seq > activeQueue.writtenSeq);
        ready.forEach((waiter) => waiter.resolve());
      }
    })().finally(() => {
      activeQueue.running = null;
      if (!activeQueue.pending && activeQueue.waiters.length === 0) {
        writeQueues.delete(projectId);
      }
    });
  }

  await completed;
}

let lastCanvasNodes = useCanvasStore.getState().nodes;
let lastCanvasEdges = useCanvasStore.getState().edges;

function canvasContentChanged(): boolean {
  const state = useCanvasStore.getState();
  if (state.nodes === lastCanvasNodes && state.edges === lastCanvasEdges) {
    return false;
  }
  lastCanvasNodes = state.nodes;
  lastCanvasEdges = state.edges;
  return true;
}

function syncCanvasRefs(): void {
  const state = useCanvasStore.getState();
  lastCanvasNodes = state.nodes;
  lastCanvasEdges = state.edges;
}

function scheduleCanvasFlush(): void {
  const { activeProjectId, switching } = useProjectStore.getState();
  if (!activeProjectId || switching) return;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void useProjectStore.getState().flushActiveCanvas();
  }, 3000);
}

function resetScheduledCanvasFlush(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  syncCanvasRefs();
}

function markCanvasLoaded(): void {
  resetScheduledCanvasFlush();
}

function scheduleIfCanvasChanged(): void {
  if (canvasContentChanged()) {
    scheduleCanvasFlush();
  }
}

function attachCanvasAutoFlush(): void {
  useCanvasStore.subscribe(scheduleIfCanvasChanged);
}

function initializeCanvasAutoFlush(): void {
  attachCanvasAutoFlush();
}

initializeCanvasAutoFlush();

interface ProjectState {
  projects: Project[];
  activeProjectId: string | null;
  /** True while a project switch is loading the target canvas. */
  switching: boolean;

  createProject: (name: string) => Promise<string>;
  renameProject: (id: string, name: string) => void;
  deleteProject: (id: string, deleteFiles?: boolean) => Promise<void>;
  switchProject: (id: string) => Promise<void>;
  /** Flush the live canvas into the active project's file. */
  flushActiveCanvas: () => Promise<void>;
  /** One-time legacy migration + initial project load. Call once at startup. */
  initialize: () => Promise<void>;
  setCover: (id: string, coverUrl: string) => void;
  /** 把画布项目关联到 AIGC 项目（Adobe 式统一项目） */
  linkAigcProject: (id: string, aigcProjectId: string) => void;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      projects: [],
      activeProjectId: null,
      switching: false,

      createProject: async (name) => {
        const id = `proj-${nanoid(10)}`;
        const now = Date.now();
        await createDir(`${projRel(id)}/assets`, { dir: BaseDirectory.Home, recursive: true });
        await writeCanvasFile(id, [], []);
        set((s) => ({
          projects: [...s.projects, { id, name: name.trim() || '未命名项目', createdAt: now, updatedAt: now }],
        }));
        return id;
      },

      renameProject: (id, name) =>
        set((s) => ({
          projects: s.projects.map((p) => (p.id === id ? { ...p, name, updatedAt: Date.now() } : p)),
        })),

      linkAigcProject: (id, aigcProjectId) =>
        set((s) => ({
          projects: s.projects.map((p) => (p.id === id ? { ...p, aigcProjectId } : p)),
        })),

      setCover: (id, coverUrl) =>
        set((s) => ({
          projects: s.projects.map((p) => (p.id === id ? { ...p, coverUrl } : p)),
        })),

      deleteProject: async (id, deleteFiles = false) => {
        const { activeProjectId, projects } = get();
        if (projects.length <= 1) throw new Error('至少保留一个项目');
        if (activeProjectId === id) {
          const fallback = projects.find((p) => p.id !== id);
          if (fallback) await get().switchProject(fallback.id);
        }
        set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }));
        if (deleteFiles) {
          try {
            await removeDir(projRel(id), { dir: BaseDirectory.Home, recursive: true });
          } catch (err) {
            console.warn('[projectStore] removeDir failed:', err);
          }
        }
      },

      flushActiveCanvas: async () => {
        const { activeProjectId } = get();
        if (!activeProjectId) return;
        const { nodes, edges } = useCanvasStore.getState();
        // 空画布保护：内存态为空但磁盘文件非空时跳过写入。quota 满/读失败
        // 会让画布加载为空，3 秒自动 flush 曾把空状态覆写掉用户的真实画布。
        if (nodes.length === 0) {
          const existing = await readCanvasFile(activeProjectId);
          if (existing && existing.nodes.length > 0) {
            console.warn('[projectStore] 跳过空画布覆写（磁盘有', existing.nodes.length, '个节点）:', activeProjectId);
            return;
          }
        }
        await writeCanvasFile(activeProjectId, nodes, edges);
        // Cover: latest image in this project's canvas (generated first,
        // uploaded as fallback) so the console card shows real content.
        let coverUrl: string | undefined;
        for (let i = nodes.length - 1; i >= 0; i--) {
          const d = nodes[i].data as Record<string, unknown> | undefined;
          const url = (d?.generatedImageUrl || d?.referenceImage) as string | undefined;
          if (nodes[i].type === 'image' && url) { coverUrl = url; break; }
        }
        if (!coverUrl) {
          // Video-only canvas: extract a thumbnail in the background — never
          // block the flush (ffmpeg can queue for seconds and switchProject
          // awaits this flush; a hang here froze project switching).
          for (let i = nodes.length - 1; i >= 0; i--) {
            const d = nodes[i].data as Record<string, unknown> | undefined;
            const path = d?.localPath as string | undefined;
            if (nodes[i].type === 'video' && path) {
              const pid = activeProjectId;
              void getVideoThumb(path).then((thumb) => {
                if (thumb) get().setCover(pid, thumb);
              }).catch(() => {});
              break;
            }
          }
        }
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === activeProjectId
              ? { ...p, updatedAt: Date.now(), ...(coverUrl ? { coverUrl } : {}) }
              : p,
          ),
        }));
      },

      switchProject: async (id) => {
        const { activeProjectId, switching } = get();
        if (switching || id === activeProjectId) return;
        set({ switching: true });
        try {
          // 1) Flush current canvas to its project file
          if (activeProjectId) await get().flushActiveCanvas();
          // 2) Load target canvas
          const file = await readCanvasFile(id);
          useCanvasStore.setState({
            nodes: repairNodeIntegrity(file?.nodes ?? []),
            edges: file?.edges ?? [],
            selectedNodeId: null,
          });
          markCanvasLoaded();
          set({ activeProjectId: id });
        } finally {
          set({ switching: false });
        }
      },

      initialize: async () => {
        const { projects, activeProjectId } = get();

        if (projects.length === 0) {
          // First run: migrate the legacy single global canvas into 默认项目.
          const id = `proj-${nanoid(10)}`;
          const now = Date.now();
          await createDir(`${projRel(id)}/assets`, { dir: BaseDirectory.Home, recursive: true });
          const { nodes, edges } = useCanvasStore.getState();
          await writeCanvasFile(id, nodes, edges);
          set({
            projects: [{ id, name: '默认项目', createdAt: now, updatedAt: now }],
            activeProjectId: id,
          });
          return;
        }

        // Subsequent runs: load the active project's canvas from file (file
        // is the source of truth now; legacy canvasStore persist still
        // rehydrates first but gets overwritten here).
        const targetId = activeProjectId ?? projects[0].id;
        const file = await readCanvasFile(targetId);
        if (file) {
          useCanvasStore.setState({ nodes: repairNodeIntegrity(file.nodes), edges: file.edges, selectedNodeId: null });
          markCanvasLoaded();
        }
        if (!activeProjectId) set({ activeProjectId: targetId });
      },
    }),
    {
      name: 'kunpeng-projects',
      storage: createJSONStorage(() => safeLocalStorage),
      partialize: (s) => ({ projects: s.projects, activeProjectId: s.activeProjectId }),
      version: 1,
    },
  ),
);

let flushTimer: ReturnType<typeof setTimeout> | null = null;
