/**
 * editorPersist — 剪辑时间轴按项目落盘（~/.kunpeng/aigc-memory/projects/<id>/editor.json）。
 *
 * 项目模式：文件为 source of truth，subscribe + short debounce 自动 flush。
 * 自由模式（无统一项目）：editorStore 原有 localStorage persist（v2 migrate）不动。
 * timeline_* 工具只操作内存态，零改动自动落入项目文件。
 */
import { useEditorStore, DEFAULT_EXPORT_SETTINGS, DEFAULT_FX_TRANSFORM } from '@/stores/editorStore';
import { readProjectFile, writeProjectFile } from '@/lib/aigc/projectStore';
import { safeLocalStorage } from '@/lib/safeStorage';

const ACTIVE_PROJECT_STORAGE_KEY = 'kunpeng-editor-active-project';
const FLUSH_DEBOUNCE_MS = 700;

interface EditorFile {
  /** v2: +overlay/text/fx; v3: +speechAudit; v4: +ripple/track/proxy/workflow; v5: revision */
  schemaVersion: 1 | 2 | 3 | 4 | 5;
  revision?: number;
  clips: unknown[];
  bgm: unknown;
  aspect: string;
  audioTracks: unknown[];
  audioClips: unknown[];
  subtitles: unknown[];
  zoom: number;
  overlayClips?: unknown[];
  textClips?: unknown[];
  fxClips?: unknown[];
  markers?: number[];
  transcripts?: Record<string, unknown>;
  transcriptRowDeletes?: Record<string, boolean>;
  /** v3: 口播审片报告 */
  speechAudit?: unknown;
  exportSettings?: unknown;
  snapEnabled?: boolean;
  /** v3: AI 成片计划卡片流 + 素材分析笔记 */
  plan?: unknown;
  mediaNotes?: Record<string, unknown>;
  /** v4: 剪辑 UI/执行状态，避免重启后回退到旧交互模式 */
  proxyPaths?: Record<string, string>;
  rippleEnabled?: boolean;
  trackStates?: Record<string, unknown>;
  workflowMode?: 'edit' | 'speech' | 'ai';
  speechMinPauseSec?: number;
  updatedAt: number;
}

let activeEditorProjectId: string | null = null;
let switching = false;
let activeSwitchPromise: Promise<void> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;
let lifecycleBound = false;
const projectRevisionCache = new Map<string, number>();

export interface EditorHydrationState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** 本次正在读取或最近一次完成读取的项目；null 表示自由时间轴。 */
  projectId: string | null;
  activeProjectId: string | null;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

let editorHydrationState: EditorHydrationState = {
  status: 'idle',
  projectId: null,
  activeProjectId: null,
};

/** 给 UI 和 Agent 工具读取，避免把尚未水合的初始空 store 当成真实空项目。 */
export function getEditorHydrationState(): EditorHydrationState {
  return { ...editorHydrationState, activeProjectId: activeEditorProjectId };
}

export function getActiveEditorProjectId(): string | null {
  return activeEditorProjectId;
}

function snapshotState(): Omit<EditorFile, 'schemaVersion' | 'updatedAt'> {
  const s = useEditorStore.getState();
  return {
    clips: s.clips,
    bgm: s.bgm,
    aspect: s.aspect,
    audioTracks: s.audioTracks,
    audioClips: s.audioClips,
    subtitles: s.subtitles,
    zoom: s.zoom,
    overlayClips: s.overlayClips,
    textClips: s.textClips,
    fxClips: s.fxClips,
    markers: s.markers,
    transcripts: s.transcripts,
    transcriptRowDeletes: s.transcriptRowDeletes,
    speechAudit: s.speechAudit,
    exportSettings: s.exportSettings,
    snapEnabled: s.snapEnabled,
    plan: s.plan,
    mediaNotes: s.mediaNotes,
    proxyPaths: s.proxyPaths,
    rippleEnabled: s.rippleEnabled,
    trackStates: s.trackStates as Record<string, unknown>,
    workflowMode: s.workflowMode,
    speechMinPauseSec: s.speechMinPauseSec,
  };
}

async function flushToProject(projectId: string): Promise<void> {
  let prevRevision = projectRevisionCache.get(projectId);
  if (prevRevision == null) {
    try {
      const raw = await readProjectFile(projectId, 'editor.json');
      const parsed = raw ? JSON.parse(raw) as { revision?: unknown } : null;
      const rev = Number(parsed?.revision);
      prevRevision = Number.isFinite(rev) ? rev : 0;
    } catch {
      prevRevision = 0;
    }
  }
  const revision = prevRevision + 1;
  projectRevisionCache.set(projectId, revision);
  const payload: EditorFile = { schemaVersion: 5, revision, ...snapshotState(), updatedAt: Date.now() };
  await writeProjectFile(projectId, 'editor.json', JSON.stringify(payload));
}

export async function flushEditorProjectNow(): Promise<void> {
  if (!activeEditorProjectId || switching) return;
  const pid = activeEditorProjectId;
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  await flushToProject(pid);
}

function hasProjectTimelineContent(): boolean {
  const s = useEditorStore.getState();
  return s.clips.length > 0
    || s.overlayClips.length > 0
    || s.textClips.length > 0
    || s.fxClips.length > 0
    || s.audioClips.length > 0
    || s.subtitles.length > 0
    || Object.keys(s.transcripts).length > 0;
}

function bindLifecycleFlush(): void {
  if (lifecycleBound || typeof window === 'undefined') return;
  lifecycleBound = true;
  const flush = () => { void flushEditorProjectNow(); };
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

function startAutoFlush(): void {
  bindLifecycleFlush();
  if (unsubscribe) return;
  unsubscribe = useEditorStore.subscribe(() => {
    if (!activeEditorProjectId || switching) return;
    if (flushTimer) clearTimeout(flushTimer);
    const pid = activeEditorProjectId;
    safeLocalStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, pid);
    flushTimer = setTimeout(() => { void flushToProject(pid); }, FLUSH_DEBOUNCE_MS);
  });
}

/**
 * 切换剪辑时间轴到指定项目（null = 回自由模式）。
 * flush 旧 → 读新 editor.json → setState；仿 projectStore.switchProject 互斥。
 */
async function performEditorProjectSwitch(projectId: string | null): Promise<void> {
  if (
    projectId === activeEditorProjectId
    && editorHydrationState.status === 'ready'
    && editorHydrationState.projectId === projectId
  ) return;
  switching = true;
  editorHydrationState = {
    status: 'loading',
    projectId,
    activeProjectId: activeEditorProjectId,
    startedAt: Date.now(),
  };
  try {
    // 1) flush 旧项目（快照当前 activeId，防 subscribe 串写）
    const prev = activeEditorProjectId;
    const storedProjectBeforeSwitch = localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY);
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (prev) await flushToProject(prev);

    const targetRaw = projectId ? await readProjectFile(projectId, 'editor.json') : null;

    // 自由 ↔ 项目切换时备份/还原 localStorage（项目模式下 persist 中间件
    // 仍会写 'kunpeng-editor'，不隔离会污染自由时间轴）
    if (!prev && projectId) {
      const free = localStorage.getItem('kunpeng-editor');
      if (free) safeLocalStorage.setItem('kunpeng-editor-free', free);
    }
    if (prev && !projectId) {
      const free = localStorage.getItem('kunpeng-editor-free');
      if (free) safeLocalStorage.setItem('kunpeng-editor', free);
      localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
    }

    activeEditorProjectId = projectId;
    if (projectId) safeLocalStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, projectId);

    if (!projectId) {
      // 回自由模式：从 localStorage persist 恢复
      await useEditorStore.persist.rehydrate();
      editorHydrationState = {
        status: 'ready',
        projectId: null,
        activeProjectId: null,
        startedAt: editorHydrationState.startedAt,
        completedAt: Date.now(),
      };
      return;
    }

    // 2) 读目标项目 editor.json。项目文件是 source of truth：只在文件缺失时，
    // 才允许用同项目 localStorage 做一次崩溃恢复，避免把错误内存态写坏项目。
    let raw = targetRaw;
    if (!raw && storedProjectBeforeSwitch === projectId && hasProjectTimelineContent()) {
      const recovered: EditorFile = { schemaVersion: 4, ...snapshotState(), updatedAt: Date.now() };
      raw = JSON.stringify(recovered);
      await writeProjectFile(projectId, 'editor.json', raw);
    }
    let file: EditorFile | null = null;
    try { file = raw ? (JSON.parse(raw) as EditorFile) : null; } catch { file = null; }
    const rev = Number(file?.revision);
    projectRevisionCache.set(projectId, Number.isFinite(rev) ? rev : 0);

    useEditorStore.setState({
      clips: (file?.clips as never) ?? [],
      bgm: (file?.bgm as never) ?? null,
      aspect: (file?.aspect as never) ?? '16:9',
      audioTracks: (file?.audioTracks as never) ?? [],
      audioClips: (file?.audioClips as never) ?? [],
      subtitles: (file?.subtitles as never) ?? [],
      zoom: file?.zoom ?? 40,
      // v1 旧文件缺 v3 字段 → 补默认值
      overlayClips: (file?.overlayClips as never) ?? [],
      textClips: (file?.textClips as never) ?? [],
      fxClips: Array.isArray(file?.fxClips)
        ? (file.fxClips as any[]).map((f) => ({ ...f, transform: f.transform ?? DEFAULT_FX_TRANSFORM })) as never
        : [],
      markers: file?.markers ?? [],
      transcripts: (file?.transcripts as never) ?? {},
      transcriptRowDeletes: file?.transcriptRowDeletes ?? {},
      speechAudit: (file?.speechAudit as never) ?? null,
      exportSettings: (file?.exportSettings as never) ?? { ...DEFAULT_EXPORT_SETTINGS },
      snapEnabled: file?.snapEnabled ?? true,
      proxyPaths: file?.proxyPaths ?? {},
      rippleEnabled: file?.rippleEnabled ?? true,
      trackStates: (file?.trackStates as never) ?? {},
      workflowMode: file?.workflowMode ?? 'edit',
      speechMinPauseSec: file?.speechMinPauseSec ?? 0.8,
      plan: (file?.plan as never) ?? null,
      mediaNotes: (file?.mediaNotes as never) ?? {},
      selectedClipId: null,
      selectedSubtitleId: null,
      selectedAudioClipId: null,
      selectedOverlayId: null,
      selectedTextId: null,
      selectedFxId: null,
      playheadSec: 0,
      isPlaying: false,
    });
    startAutoFlush();
    editorHydrationState = {
      status: 'ready',
      projectId,
      activeProjectId: projectId,
      startedAt: editorHydrationState.startedAt,
      completedAt: Date.now(),
    };
  } catch (error) {
    editorHydrationState = {
      status: 'error',
      projectId,
      activeProjectId: activeEditorProjectId,
      startedAt: editorHydrationState.startedAt,
      completedAt: Date.now(),
      error: error instanceof Error ? error.message : String(error),
    };
    throw error;
  } finally {
    switching = false;
  }
}

/**
 * 串行化项目切换。过去并发调用会因 switching=true 直接返回，调用方误以为
 * 时间轴已经可读；现在后来的调用会等待当前水合完成，再核对或执行目标切换。
 */
export async function switchEditorProject(projectId: string | null): Promise<void> {
  if (activeSwitchPromise) {
    await activeSwitchPromise;
    if (
      projectId === activeEditorProjectId
      && editorHydrationState.status === 'ready'
      && editorHydrationState.projectId === projectId
    ) return;
  }

  const pending = performEditorProjectSwitch(projectId);
  activeSwitchPromise = pending;
  try {
    await pending;
  } finally {
    if (activeSwitchPromise === pending) activeSwitchPromise = null;
  }
}
