/**
 * editorStore — state for the standalone editor view (剪辑) and the surface
 * the timeline_* agent tools operate on. Persists clip metadata only.
 *
 * v2: aspect (16:9/9:16), multi audio tracks (bgm/sfx/voice), subtitles.
 * The single video track (`clips`) remains the program spine.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeLocalStorage } from '@/lib/safeStorage';
import { nanoid } from 'nanoid';
import { probeDuration } from '@/lib/canvas/videoCompose';
import { findFxComponent } from '@/lib/editor/fxComponents';
import type { FindingCategory, SpeechAuditReport, SpeechFinding } from '@/lib/editor/speechAudit/types';
import { isEditorAspect, type EditorAspect } from '@/lib/editor/aspect';

export type { EditorAspect } from '@/lib/editor/aspect';

const EDITOR_STORAGE_KEY = 'kunpeng-editor';
const ACTIVE_EDITOR_PROJECT_KEY = 'kunpeng-editor-active-project';

const editorLocalStorage = {
  getItem: (name: string) => {
    if (name === EDITOR_STORAGE_KEY && safeLocalStorage.getItem(ACTIVE_EDITOR_PROJECT_KEY)) {
      return null;
    }
    return safeLocalStorage.getItem(name);
  },
  setItem: (name: string, value: string) => {
    if (name === EDITOR_STORAGE_KEY && safeLocalStorage.getItem(ACTIVE_EDITOR_PROJECT_KEY)) {
      return;
    }
    safeLocalStorage.setItem(name, value);
  },
  removeItem: (name: string) => safeLocalStorage.removeItem(name),
};

/** 调色参数（预览 CSS filter 近似，导出 ffmpeg eq 保真）。各值 -100..100，0=原始 */
export interface ClipFilter {
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  /** 调色预设 id（filterPresets），存档仅作 UI 高亮，导出按四滑杆值 */
  preset?: string;
}

/**
 * 转场类型：'cut' | 'fade' | 任意 ffmpeg xfade transition 名
 * （wipeleft/slideright/circleopen/zoomin…，见 presets/transitionPresets）
 */
export type TransitionType = string;

export interface EditorClip {
  id: string;
  path: string;
  label: string;
  sourceNodeId?: string;
  /** Full media duration (seconds). */
  duration: number;
  /** Trim window. */
  inSec: number;
  outSec: number;
  transitionAfter: { type: TransitionType; duration: number };
  /** 变速 0.1-4，默认 1。时间轴有效时长 = (out-in)/speed */
  speed?: number;
  /** 曲线变速预设 id。约定：曲线只重分配片段内速度，不改变总时长 */
  curvePreset?: string;
  /** 主视频原声音量，0=静音，1=原始，2=放大一倍 */
  volume?: number;
  reversed?: boolean;
  flipH?: boolean;
  rotate?: 0 | 90 | 180 | 270;
  filter?: ClipFilter;
  /** 剪映式“停用片段”：保留时间轴占位，预览/导出不显示原画面。 */
  disabled?: boolean;
}

export interface EditorBgm {
  path: string;
  label: string;
  volume: number; // 0..1
}

export type AudioTrackKind = 'bgm' | 'sfx' | 'voice';

export interface AudioTrack {
  id: string;
  kind: AudioTrackKind;
  muted: boolean;
}

export interface AudioClip {
  id: string;
  trackId: string;
  path: string;
  label: string;
  /** Position on the program timeline. */
  startSec: number;
  duration: number;
  inSec: number;
  outSec: number;
  volume: number; // 0..1
  loop?: boolean;
  /** 淡入淡出时长（秒），导出 afade */
  fadeInSec?: number;
  fadeOutSec?: number;
  /** 来源：导入 / 麦克风录音 / TTS 配音 */
  source?: 'import' | 'record' | 'tts';
  disabled?: boolean;
}

export interface SubtitleCue {
  id: string;
  startSec: number;
  endSec: number;
  text: string;
  style?: { fontSize?: number; color?: string; y?: number };
  disabled?: boolean;
}

// ── v3：画中画 / 花字 / 特效 / 转写 / 导出 ────────────────────────────────────

/** 归一化变换：x/y 为画面比例坐标（0,0=中心，±0.5=半幅边缘），scale 1=等宽 */
export interface OverlayTransform {
  x: number;
  y: number;
  scale: number;
  opacity: number;
  rotation: number; // 度
}

export interface OverlayKeyframe {
  /** 相对片段开始的秒数 */
  t: number;
  x: number;
  y: number;
  scale: number;
  opacity: number;
}

export interface MaskSettings {
  enabled: boolean;
  type: 'rect' | 'circle' | 'linear' | 'mirror';
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  feather: number;
  invert: boolean;
}

/** 画中画片段（trackIndex 0|1 两条叠加轨，0 在上层） */
export interface OverlayClip {
  id: string;
  trackIndex: 0 | 1;
  kind: 'video' | 'image';
  path: string;
  label: string;
  /** Program timeline position. */
  startSec: number;
  duration: number;
  inSec: number;
  outSec: number;
  transform: OverlayTransform;
  /** 关键帧按 t 升序；存在时覆盖 transform 的 x/y/scale/opacity（rotation 不参与插值） */
  keyframes?: OverlayKeyframe[];
  /** 视频画中画音量 */
  volume?: number;
  mask?: MaskSettings;
  disabled?: boolean;
}

/** 花字/文本卡（templateId → presets/textTemplates，HyperFrames 管线渲染） */
export interface TextClip {
  id: string;
  text: string;
  templateId: string;
  startSec: number;
  endSec: number;
  position: 'top' | 'center' | 'bottom' | 'custom';
  /** position='custom' 时的归一化坐标（0,0=中心） */
  customPos?: { x: number; y: number };
  styleOverrides?: { color?: string; accent?: string; fontScale?: number };
  /** 渲染缓存（导出用透明帧序列目录），内容变更时失效 */
  renderCachePath?: string;
  contentHash?: string;
  disabled?: boolean;
}

/** HyperFrames 自由特效（html/css 由组件库实例化或 agent 撰写） */
export interface FxClip {
  id: string;
  label: string;
  html: string;
  css: string;
  /** component 模式溯源（fxComponents 实例化参数，便于再编辑） */
  componentId?: string;
  params?: Record<string, unknown>;
  theme?: string;
  startSec: number;
  duration: number;
  /** 画面内整体变换：像剪映贴纸/特效层一样可拖动、缩放、透明、旋转 */
  transform?: OverlayTransform;
  renderCachePath?: string;
  contentHash?: string;
  disabled?: boolean;
}

export interface TranscriptWord {
  w: string;
  start: number;
  end: number;
  filler?: boolean;
  /** 与前一个词之间的空白毫秒数（豆包词级时间戳；重来/换气的停顿证据） */
  blankMs?: number;
}

export interface TranscriptSentence {
  id: string;
  text: string;
  /** source-relative 秒（相对源媒体，不随时间轴裁剪变化） */
  start: number;
  end: number;
  words: TranscriptWord[];
  deleted?: boolean;
  /** 无人声/无字幕空白伪句（预标记 deleted） */
  silence?: boolean;
}

/** 按源媒体路径存储的词级转写 */
export interface Transcript {
  mediaPath: string;
  language?: string;
  sentences: TranscriptSentence[];
  createdAt: number;
}

/** AI 剪辑计划（OpenStoryline 式可干预卡片流）：提案不动时间轴，用户复核后应用 */
export interface PlanShot {
  id: string;
  /** 镜头标签，如「开场 hook」「产品特写」 */
  label: string;
  sourcePath: string;
  inSec: number;
  outSec: number;
  /** AI 选这段素材的理由（透明可干预） */
  reason: string;
  status: 'pending' | 'applied' | 'rejected';
}

export interface EditPlan {
  id: string;
  title: string;
  createdAt: number;
  shots: PlanShot[];
}

export interface ReferenceTranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface ReferenceFrameNote {
  t: number;
  path: string;
  description?: string;
  source: 'scene' | 'dense' | 'fallback';
}

export interface EditReferenceProfile {
  id: string;
  sourcePath: string;
  title: string;
  duration: number;
  frameCount: number;
  transcriptSegmentCount: number;
  narrativeStructure: string[];
  rhythm: string[];
  camera: string[];
  transitions: string[];
  textAndFx: string[];
  reusablePrinciples: string[];
  editAgentNotes: string;
  createdAt: number;
}

/** 按需素材分析缓存（防重复花钱），随 editor.json 落盘 */
export interface MediaNote {
  /** 抽帧逐帧视觉描述：[秒, 描述] */
  frames: [number, string][];
  referenceId?: string;
  frameNotes?: ReferenceFrameNote[];
  transcriptSegments?: ReferenceTranscriptSegment[];
  referenceProfile?: EditReferenceProfile;
  analysisMode?: 'native' | 'indexed';
  sourceHash?: string;
  transcript?: string;
  duration?: number;
  analyzedAt: number;
  analysisState?: {
    status: 'running' | 'ready' | 'failed';
    stage: string;
    progress?: number;
    error?: string;
    updatedAt: number;
  };
}

export interface EditorRenderError {
  at: number;
  source: 'preview' | 'export' | 'motion-runtime' | 'free-page' | 'unknown';
  message: string;
  fxId?: string;
}

export interface ExportSettings {
  resolution: '720p' | '1080p' | '2k' | '4k';
  fps: 24 | 30 | 60;
  bitrate: 'low' | 'medium' | 'high';
  loudnorm: boolean;
  denoise: boolean;
  format?: 'mp4' | 'mov_alpha';
  encoder?: 'auto' | 'h264' | 'hevc';
  background?: 'black' | 'transparent';
}

export type TimelineTrackKey = 'fx' | 'text' | 'overlay-0' | 'overlay-1' | 'main' | 'subtitle' | `audio-${AudioTrackKind}`;

export interface TimelineTrackState {
  locked?: boolean;
  hidden?: boolean;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  resolution: '1080p', fps: 30, bitrate: 'medium', loudnorm: false, denoise: false,
};

export const EXPORT_RESOLUTIONS: Record<ExportSettings['resolution'], { w: number; h: number }> = {
  '720p': { w: 1280, h: 720 },
  '1080p': { w: 1920, h: 1080 },
  '2k': { w: 2560, h: 1440 },
  '4k': { w: 3840, h: 2160 },
};

interface EditorState {
  clips: EditorClip[];
  /** @deprecated v1 单 BGM；v2 起由 audioClips 承载，保留薄兼容层。 */
  bgm: EditorBgm | null;
  aspect: EditorAspect;
  audioTracks: AudioTrack[];
  audioClips: AudioClip[];
  subtitles: SubtitleCue[];
  transcribing: boolean;
  // v3
  overlayClips: OverlayClip[];
  textClips: TextClip[];
  fxClips: FxClip[];
  /** 踩点标记（program 秒，升序） */
  markers: number[];
  /** 工作流模式（视图预设，不锁功能）：剪辑 / 口播 / AI 成片 */
  workflowMode: 'edit' | 'speech' | 'ai';
  /** 词级转写缓存：源媒体路径 → Transcript（落 editor.json，不进 localStorage） */
  transcripts: Record<string, Transcript>;
  /** 文稿剪辑行级删除标记：row_id → true，避免 sentence_id 误伤重复片段 */
  transcriptRowDeletes: Record<string, boolean>;
  /** 口播审片报告（剪口播面板 + timeline_speech_* 工具共享，落 editor.json） */
  speechAudit: SpeechAuditReport | null;
  /** 预览时跳过 enabled findings 的区间（面板眼睛开关，不真剪即可试听节奏） */
  previewSkipFindings: boolean;
  /** 剪口播面板最短停顿时长阈值（秒）：只处理 ≥ 该值的 pause findings */
  speechMinPauseSec: number;
  /** AI 剪辑计划（null=无计划） */
  plan: EditPlan | null;
  /** PlanPanel 显隐 */
  planPanelOpen: boolean;
  /** 素材分析缓存 */
  mediaNotes: Record<string, MediaNote>;
  /** 原始视频路径 -> 代理视频路径。预览使用代理，最终导出仍使用原片。 */
  proxyPaths: Record<string, string>;
  /** 最近一次预览/渲染错误。给 agent 读取，避免“已添加但黑屏”无法排查。 */
  lastRenderError: EditorRenderError | null;
  exportSettings: ExportSettings;
  snapEnabled: boolean;
  rippleEnabled: boolean;
  trackStates: Partial<Record<TimelineTrackKey, TimelineTrackState>>;
  selectedClipId: string | null;
  selectedSubtitleId: string | null;
  selectedAudioClipId: string | null;
  selectedOverlayId: string | null;
  selectedTextId: string | null;
  selectedFxId: string | null;
  playheadSec: number;
  zoom: number; // px per second
  isPlaying: boolean;

  addClips: (items: { path: string; label?: string; sourceNodeId?: string }[]) => Promise<string[]>;
  removeClip: (id: string) => void;
  reorderClip: (id: string, newIndex: number) => void;
  setOrder: (ids: string[]) => void;
  trimClip: (id: string, inSec?: number, outSec?: number) => void;
  /** Split a clip into two at a program-relative or clip-local second. */
  splitClip: (id: string, atClipSec: number) => string | null;
  setTransition: (id: string, type: TransitionType, duration?: number) => void;
  setBgm: (bgm: EditorBgm | null) => void;
  setAspect: (a: EditorAspect) => void;
  /** 通用主轨片段补丁（变速/调色/翻转等 v3 字段用） */
  updateClip: (id: string, patch: Partial<EditorClip>) => void;

  // v3：画中画
  addOverlayClip: (item: { path: string; kind: 'video' | 'image'; trackIndex?: 0 | 1; label?: string; startSec?: number }) => Promise<string>;
  updateOverlayClip: (id: string, patch: Partial<OverlayClip>) => void;
  removeOverlayClip: (id: string) => void;
  /** 在 t 处打/更新关键帧（±0.05s 视为同帧） */
  setOverlayKeyframe: (id: string, kf: OverlayKeyframe) => void;
  removeOverlayKeyframe: (id: string, t: number) => void;

  // v3：花字 / 特效
  addTextClip: (item: Omit<TextClip, 'id'>) => string;
  updateTextClip: (id: string, patch: Partial<TextClip>) => void;
  removeTextClip: (id: string) => void;
  addFxClip: (item: Omit<FxClip, 'id'>) => string;
  updateFxClip: (id: string, patch: Partial<FxClip>) => void;
  removeFxClip: (id: string) => void;

  // v3：踩点 / 转写 / 导出
  addMarker: (t: number) => void;
  removeMarker: (t: number) => void;
  setMarkers: (ts: number[]) => void;
  setTranscript: (mediaPath: string, transcript: Transcript) => void;
  setPlan: (plan: EditPlan | null) => void;
  setPlanPanelOpen: (open: boolean) => void;
  updatePlanShot: (shotId: string, patch: Partial<PlanShot>) => void;
  setMediaNote: (path: string, note: MediaNote) => void;
  setProxyPath: (sourcePath: string, proxyPath: string | null) => void;
  setLastRenderError: (error: EditorRenderError | null) => void;
  setSentenceDeleted: (mediaPath: string, sentenceId: string, deleted: boolean) => void;
  setTranscriptRowDeleted: (rowId: string, deleted: boolean) => void;
  setSpeechAudit: (report: SpeechAuditReport | null) => void;
  /** 更新单个 finding（勾选切换等） */
  updateSpeechFinding: (id: string, patch: Partial<SpeechFinding>) => void;
  /** 按类别批量切换 findings 的 enabled */
  setSpeechFindingsEnabled: (category: FindingCategory, enabled: boolean) => void;
  setPreviewSkipFindings: (v: boolean) => void;
  setSpeechMinPauseSec: (v: number) => void;
  setExportSettings: (patch: Partial<ExportSettings>) => void;
  setSnapEnabled: (v: boolean) => void;
  setRippleEnabled: (v: boolean) => void;
  setTrackState: (track: TimelineTrackKey, patch: TimelineTrackState) => void;
  selectOverlay: (id: string | null) => void;
  selectText: (id: string | null) => void;
  selectFx: (id: string | null) => void;

  addAudioClip: (kind: AudioTrackKind, item: { path: string; label?: string; startSec?: number; volume?: number; loop?: boolean }) => Promise<string>;
  updateAudioClip: (id: string, patch: Partial<AudioClip>) => void;
  removeAudioClip: (id: string) => void;
  setTrackMuted: (trackId: string, muted: boolean) => void;

  setSubtitles: (cues: SubtitleCue[]) => void;
  addSubtitle: (cue: Omit<SubtitleCue, 'id'>) => string;
  updateSubtitle: (id: string, patch: Partial<SubtitleCue>) => void;
  removeSubtitle: (id: string) => void;
  shiftSubtitles: (fromSec: number, deltaSec: number) => void;
  subtitleAt: (sec: number) => SubtitleCue | null;
  setTranscribing: (t: boolean) => void;

  setPlayhead: (sec: number) => void;
  select: (id: string | null) => void;
  selectSubtitle: (id: string | null) => void;
  selectAudioClip: (id: string | null) => void;
  setZoom: (z: number) => void;
  setWorkflowMode: (m: 'edit' | 'speech' | 'ai') => void;
  setPlaying: (p: boolean) => void;
  clearAll: () => void;
  /** 统一删除当前选中（六类上下文分发）——快捷键与工具栏删除按钮共用。返回是否删了东西 */
  deleteSelected: () => boolean;
  /** 波纹删除当前选中：删除后把后续绝对时间轨整体前移。返回是否删了东西 */
  rippleDeleteSelected: () => boolean;
  /** 播放头处分割所有命中的未锁定轨道对象。返回新对象 id 列表。 */
  splitAtPlayhead: () => string[];

  /** Effective (trimmed) clip duration. */
  clipLength: (c: EditorClip) => number;
  /** Total program duration. */
  totalDuration: () => number;
  /** Compact JSON summary for the agent. */
  getStateSummary: () => string;
}

function newTrack(kind: AudioTrackKind): AudioTrack {
  return { id: `track-${kind}-${nanoid(4)}`, kind, muted: false };
}

function fileBasename(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

async function safeProbeDuration(path: string): Promise<number> {
  try {
    const duration = await probeDuration(path);
    if (Number.isFinite(duration) && duration > 0) return duration;
  } catch (err) {
    console.warn('[editor] probe duration failed', { path, err });
  }
  throw new Error(`无法读取素材真实时长：${fileBasename(path) ?? path}。请检查文件是否完整、格式是否受系统支持。`);
}

export const DEFAULT_FX_TRANSFORM: OverlayTransform = {
  x: 0,
  y: 0,
  scale: 1,
  opacity: 1,
  rotation: 0,
};

export const useEditorStore = create<EditorState>()(
  persist(
    (set, get) => ({
      clips: [],
      bgm: null,
      aspect: '16:9' as EditorAspect,
      audioTracks: [],
      audioClips: [],
      subtitles: [],
      transcribing: false,
      overlayClips: [],
      textClips: [],
      fxClips: [],
      markers: [],
      transcripts: {},
      transcriptRowDeletes: {},
      speechAudit: null,
      previewSkipFindings: false,
      speechMinPauseSec: 0.8,
      exportSettings: DEFAULT_EXPORT_SETTINGS,
      snapEnabled: true,
      rippleEnabled: true,
      trackStates: {},
      workflowMode: 'edit' as const,
      plan: null,
      planPanelOpen: false,
      mediaNotes: {},
      proxyPaths: {},
      lastRenderError: null,
      selectedClipId: null,
      selectedSubtitleId: null,
      selectedAudioClipId: null,
      selectedOverlayId: null,
      selectedTextId: null,
      selectedFxId: null,
      playheadSec: 0,
      zoom: 40,
      isPlaying: false,

      addClips: async (items) => {
        const newIds: string[] = [];
        const newClips: EditorClip[] = [];
        for (const item of items) {
          const duration = await safeProbeDuration(item.path);
          const id = `clip-${nanoid(6)}`;
          newIds.push(id);
          newClips.push({
            id,
            path: item.path,
            label: item.label ?? item.path.split('/').pop() ?? id,
            sourceNodeId: item.sourceNodeId,
            duration,
            inSec: 0,
            outSec: duration,
            transitionAfter: { type: 'cut', duration: 0 },
          });
        }
        set((s) => ({ clips: [...s.clips, ...newClips] }));
        return newIds;
      },

      removeClip: (id) =>
        set((s) => ({
          clips: s.clips.filter((c) => c.id !== id),
          selectedClipId: s.selectedClipId === id ? null : s.selectedClipId,
        })),

      reorderClip: (id, newIndex) =>
        set((s) => {
          const idx = s.clips.findIndex((c) => c.id === id);
          if (idx < 0) return s;
          const next = [...s.clips];
          const [moved] = next.splice(idx, 1);
          next.splice(Math.max(0, Math.min(newIndex, next.length)), 0, moved);
          return { clips: next };
        }),

      setOrder: (ids) =>
        set((s) => {
          const byId = new Map(s.clips.map((c) => [c.id, c]));
          const ordered = ids.map((id) => byId.get(id)).filter((c): c is EditorClip => Boolean(c));
          const missing = s.clips.filter((c) => !ids.includes(c.id));
          return { clips: [...ordered, ...missing] };
        }),

      trimClip: (id, inSec, outSec) =>
        set((s) => ({
          clips: s.clips.map((c) => {
            if (c.id !== id) return c;
            const nIn = inSec != null ? Math.max(0, Math.min(inSec, c.duration - 0.1)) : c.inSec;
            const nOut = outSec != null ? Math.max(nIn + 0.1, Math.min(outSec, c.duration)) : Math.max(c.outSec, nIn + 0.1);
            return { ...c, inSec: nIn, outSec: nOut };
          }),
        })),

      splitClip: (id, atClipSec) => {
        const s = get();
        const idx = s.clips.findIndex((c) => c.id === id);
        if (idx < 0) return null;
        const c = s.clips[idx];
        const cut = c.inSec + Math.max(0.1, Math.min(atClipSec, c.outSec - c.inSec - 0.1));
        const rightId = `clip-${nanoid(6)}`;
        const left: EditorClip = { ...c, outSec: cut, transitionAfter: { type: 'cut', duration: 0 } };
        const right: EditorClip = { ...c, id: rightId, inSec: cut };
        const next = [...s.clips];
        next.splice(idx, 1, left, right);
        set({ clips: next });
        return rightId;
      },

      setTransition: (id, type, duration = 0.5) =>
        set((s) => ({
          clips: s.clips.map((c) =>
            c.id === id ? { ...c, transitionAfter: { type, duration: type === 'cut' ? 0 : duration } } : c,
          ),
        })),

      // v1 兼容层：写 bgm 同步映射到 bgm 音频轨（timeline_add_bgm 等不破坏）
      setBgm: (bgm) => {
        set({ bgm });
        const s = get();
        const bgmTrack = s.audioTracks.find((t) => t.kind === 'bgm');
        if (bgm) {
          const track = bgmTrack ?? newTrack('bgm');
          const existing = s.audioClips.find((a) => a.trackId === track.id);
          const clip: AudioClip = {
            id: existing?.id ?? `aclip-${nanoid(6)}`,
            trackId: track.id,
            path: bgm.path,
            label: bgm.label,
            startSec: 0,
            duration: 0,
            inSec: 0,
            outSec: 0,
            volume: bgm.volume,
            loop: true,
          };
          set({
            audioTracks: bgmTrack ? s.audioTracks : [...s.audioTracks, track],
            audioClips: [...s.audioClips.filter((a) => a.trackId !== track.id), clip],
          });
        } else if (bgmTrack) {
          set({ audioClips: s.audioClips.filter((a) => a.trackId !== bgmTrack.id) });
        }
      },

      setAspect: (a) => set({ aspect: a }),

      addAudioClip: async (kind, item) => {
        const s = get();
        let track = s.audioTracks.find((t) => t.kind === kind);
        if (!track) {
          track = newTrack(kind);
          set({ audioTracks: [...get().audioTracks, track] });
        }
        const duration = await safeProbeDuration(item.path);
        const id = `aclip-${nanoid(6)}`;
        const clip: AudioClip = {
          id,
          trackId: track.id,
          path: item.path,
          label: item.label ?? item.path.split('/').pop() ?? id,
          startSec: item.startSec ?? 0,
          duration,
          inSec: 0,
          outSec: duration,
          volume: item.volume ?? (kind === 'bgm' ? 0.3 : 1),
          loop: item.loop ?? kind === 'bgm',
        };
        set({ audioClips: [...get().audioClips, clip] });
        return id;
      },

      updateAudioClip: (id, patch) =>
        set((s) => ({
          audioClips: s.audioClips.map((a) => (a.id === id ? { ...a, ...patch } : a)),
        })),

      removeAudioClip: (id) =>
        set((s) => ({
          audioClips: s.audioClips.filter((a) => a.id !== id),
          selectedAudioClipId: s.selectedAudioClipId === id ? null : s.selectedAudioClipId,
        })),

      setTrackMuted: (trackId, muted) =>
        set((s) => ({
          audioTracks: s.audioTracks.map((t) => (t.id === trackId ? { ...t, muted } : t)),
        })),

      setSubtitles: (cues) => set({ subtitles: [...cues].sort((a, b) => a.startSec - b.startSec) }),

      addSubtitle: (cue) => {
        const id = `sub-${nanoid(6)}`;
        set((s) => ({
          subtitles: [...s.subtitles, { ...cue, id }].sort((a, b) => a.startSec - b.startSec),
        }));
        return id;
      },

      updateSubtitle: (id, patch) =>
        set((s) => ({
          subtitles: s.subtitles
            .map((c) => (c.id === id ? { ...c, ...patch } : c))
            .sort((a, b) => a.startSec - b.startSec),
        })),

      removeSubtitle: (id) =>
        set((s) => ({
          subtitles: s.subtitles.filter((c) => c.id !== id),
          selectedSubtitleId: s.selectedSubtitleId === id ? null : s.selectedSubtitleId,
        })),

      shiftSubtitles: (fromSec, deltaSec) =>
        set((s) => ({
          subtitles: s.subtitles.map((c) =>
            c.startSec >= fromSec
              ? { ...c, startSec: Math.max(0, c.startSec + deltaSec), endSec: Math.max(0.1, c.endSec + deltaSec) }
              : c,
          ),
        })),

      subtitleAt: (sec) => {
        const { subtitles } = get();
        return subtitles.find((c) => sec >= c.startSec && sec < c.endSec) ?? null;
      },

      setTranscribing: (t) => set({ transcribing: t }),

      // ── v3 actions ──────────────────────────────────────────────────────────

      updateClip: (id, patch) =>
        set((s) => ({ clips: s.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),

      addOverlayClip: async (item) => {
        const isVideo = item.kind === 'video';
        const duration = isVideo ? await safeProbeDuration(item.path) : 4;
        const id = `ovl-${nanoid(6)}`;
        const clip: OverlayClip = {
          id,
          trackIndex: item.trackIndex ?? 0,
          kind: item.kind,
          path: item.path,
          label: item.label ?? item.path.split('/').pop() ?? id,
          startSec: item.startSec ?? get().playheadSec,
          duration,
          inSec: 0,
          outSec: duration,
          // 视频轨 2/3 默认铺满画面；用户可在播放器或参数面板调整位置/大小。
          transform: { x: 0, y: 0, scale: 1, opacity: 1, rotation: 0 },
          volume: isVideo ? 1 : undefined,
        };
        set((s) => ({ overlayClips: [...s.overlayClips, clip] }));
        return id;
      },

      updateOverlayClip: (id, patch) =>
        set((s) => ({ overlayClips: s.overlayClips.map((o) => (o.id === id ? { ...o, ...patch } : o)) })),

      removeOverlayClip: (id) =>
        set((s) => ({
          overlayClips: s.overlayClips.filter((o) => o.id !== id),
          selectedOverlayId: s.selectedOverlayId === id ? null : s.selectedOverlayId,
        })),

      setOverlayKeyframe: (id, kf) =>
        set((s) => ({
          overlayClips: s.overlayClips.map((o) => {
            if (o.id !== id) return o;
            const kfs = (o.keyframes ?? []).filter((k) => Math.abs(k.t - kf.t) > 0.05);
            return { ...o, keyframes: [...kfs, kf].sort((a, b) => a.t - b.t) };
          }),
        })),

      removeOverlayKeyframe: (id, t) =>
        set((s) => ({
          overlayClips: s.overlayClips.map((o) =>
            o.id === id ? { ...o, keyframes: (o.keyframes ?? []).filter((k) => Math.abs(k.t - t) > 0.05) } : o,
          ),
        })),

      addTextClip: (item) => {
        const id = `txt-${nanoid(6)}`;
        set((s) => ({ textClips: [...s.textClips, { ...item, id }].sort((a, b) => a.startSec - b.startSec) }));
        return id;
      },

      updateTextClip: (id, patch) =>
        set((s) => ({
          // 文案/模板/样式变更 → 渲染缓存失效
          textClips: s.textClips.map((t) => (t.id === id
            ? { ...t, ...patch, ...(patch.text !== undefined || patch.templateId !== undefined || patch.styleOverrides !== undefined ? { renderCachePath: undefined, contentHash: undefined } : {}) }
            : t)),
        })),

      removeTextClip: (id) =>
        set((s) => ({
          textClips: s.textClips.filter((t) => t.id !== id),
          selectedTextId: s.selectedTextId === id ? null : s.selectedTextId,
        })),

      addFxClip: (item) => {
        const id = `fx-${nanoid(6)}`;
        set((s) => ({
          fxClips: [
            ...s.fxClips,
            { ...item, transform: item.transform ?? DEFAULT_FX_TRANSFORM, id },
          ].sort((a, b) => a.startSec - b.startSec),
        }));
        return id;
      },

      updateFxClip: (id, patch) =>
        set((s) => ({
          fxClips: s.fxClips.map((f) => {
            if (f.id !== id) return f;
            let merged = { ...f, ...patch };
            if (patch.theme !== undefined && merged.componentId) {
              const comp = findFxComponent(merged.componentId);
              if (comp && merged.params) {
                const built = comp.render(merged.params, patch.theme);
                merged = { ...merged, html: built.html, css: built.css };
              }
            }
            if (
              patch.html !== undefined
              || patch.css !== undefined
              || patch.params !== undefined
              || patch.theme !== undefined
              || patch.duration !== undefined
              || patch.transform !== undefined
            ) {
              merged.renderCachePath = undefined;
              merged.contentHash = undefined;
            }
            return merged;
          }),
        })),

      removeFxClip: (id) =>
        set((s) => ({
          fxClips: s.fxClips.filter((f) => f.id !== id),
          selectedFxId: s.selectedFxId === id ? null : s.selectedFxId,
        })),

      addMarker: (t) =>
        set((s) => (s.markers.some((m) => Math.abs(m - t) < 0.05)
          ? s
          : { markers: [...s.markers, t].sort((a, b) => a - b) })),

      removeMarker: (t) =>
        set((s) => ({ markers: s.markers.filter((m) => Math.abs(m - t) > 0.1) })),

      setMarkers: (ts) => set({ markers: [...ts].sort((a, b) => a - b) }),

      setTranscript: (mediaPath, transcript) =>
        set((s) => ({ transcripts: { ...s.transcripts, [mediaPath]: transcript } })),

      setSentenceDeleted: (mediaPath, sentenceId, deleted) =>
        set((s) => {
          const tr = s.transcripts[mediaPath];
          if (!tr) return s;
          return {
            transcripts: {
              ...s.transcripts,
              [mediaPath]: {
                ...tr,
                sentences: tr.sentences.map((x) => (x.id === sentenceId ? { ...x, deleted } : x)),
              },
            },
          };
        }),

      setTranscriptRowDeleted: (rowId, deleted) =>
        set((s) => {
          const next = { ...s.transcriptRowDeletes };
          if (deleted) next[rowId] = true;
          else delete next[rowId];
          return { transcriptRowDeletes: next };
        }),

      setSpeechAudit: (report) => set({ speechAudit: report }),

      updateSpeechFinding: (id, patch) =>
        set((s) => {
          if (!s.speechAudit) return s;
          return {
            speechAudit: {
              ...s.speechAudit,
              findings: s.speechAudit.findings.map((f) => (f.id === id ? { ...f, ...patch } : f)),
            },
          };
        }),

      setSpeechFindingsEnabled: (category, enabled) =>
        set((s) => {
          if (!s.speechAudit) return s;
          return {
            speechAudit: {
              ...s.speechAudit,
              findings: s.speechAudit.findings.map((f) => (f.category === category ? { ...f, enabled } : f)),
            },
          };
        }),

      setPreviewSkipFindings: (v) => set({ previewSkipFindings: v }),
      setSpeechMinPauseSec: (v) => set({ speechMinPauseSec: Math.max(0.3, Math.min(5, v)) }),

      setExportSettings: (patch) => set((s) => ({ exportSettings: { ...s.exportSettings, ...patch } })),
      setSnapEnabled: (v) => set({ snapEnabled: v }),
      setRippleEnabled: (v) => set({ rippleEnabled: v }),
      setTrackState: (track, patch) =>
        set((s) => ({ trackStates: { ...s.trackStates, [track]: { ...(s.trackStates[track] ?? {}), ...patch } } })),

      setPlayhead: (sec) => set({ playheadSec: Math.max(0, sec) }),
      select: (id) => set({ selectedClipId: id, selectedSubtitleId: null, selectedAudioClipId: null, selectedOverlayId: null, selectedTextId: null, selectedFxId: null }),
      selectSubtitle: (id) => set({ selectedSubtitleId: id, selectedClipId: null, selectedAudioClipId: null, selectedOverlayId: null, selectedTextId: null, selectedFxId: null }),
      selectAudioClip: (id) => set({ selectedAudioClipId: id, selectedClipId: null, selectedSubtitleId: null, selectedOverlayId: null, selectedTextId: null, selectedFxId: null }),
      selectOverlay: (id) => set({ selectedOverlayId: id, selectedClipId: null, selectedSubtitleId: null, selectedAudioClipId: null, selectedTextId: null, selectedFxId: null }),
      selectText: (id) => set({ selectedTextId: id, selectedClipId: null, selectedSubtitleId: null, selectedAudioClipId: null, selectedOverlayId: null, selectedFxId: null }),
      selectFx: (id) => set({ selectedFxId: id, selectedClipId: null, selectedSubtitleId: null, selectedAudioClipId: null, selectedOverlayId: null, selectedTextId: null }),
      setZoom: (z) => set({ zoom: Math.max(10, Math.min(200, z)) }),
      setWorkflowMode: (m) => set({ workflowMode: m }),

      setPlan: (plan) => set({ plan, planPanelOpen: plan != null }),
      setPlanPanelOpen: (open) => set({ planPanelOpen: open }),
      updatePlanShot: (shotId, patch) =>
        set((s) => s.plan
          ? { plan: { ...s.plan, shots: s.plan.shots.map((x) => (x.id === shotId ? { ...x, ...patch } : x)) } }
          : s),
      setMediaNote: (path, note) => set((s) => ({ mediaNotes: { ...s.mediaNotes, [path]: note } })),
      setProxyPath: (sourcePath, proxyPath) => set((s) => {
        const next = { ...s.proxyPaths };
        if (proxyPath) next[sourcePath] = proxyPath;
        else delete next[sourcePath];
        return { proxyPaths: next };
      }),
      setLastRenderError: (error) => set({ lastRenderError: error }),
      setPlaying: (p) => set({ isPlaying: p }),
      clearAll: () => set({
        clips: [], bgm: null, audioClips: [], subtitles: [],
        overlayClips: [], textClips: [], fxClips: [], markers: [], transcripts: {}, transcriptRowDeletes: {}, speechAudit: null,
        lastRenderError: null,
        selectedClipId: null, selectedSubtitleId: null, selectedAudioClipId: null,
        selectedOverlayId: null, selectedTextId: null, selectedFxId: null, playheadSec: 0,
      }),

      deleteSelected: () => {
        const s = get();
        if (s.selectedClipId) { s.removeClip(s.selectedClipId); return true; }
        if (s.selectedOverlayId) { s.removeOverlayClip(s.selectedOverlayId); return true; }
        if (s.selectedTextId) { s.removeTextClip(s.selectedTextId); return true; }
        if (s.selectedFxId) { s.removeFxClip(s.selectedFxId); return true; }
        if (s.selectedSubtitleId) { s.removeSubtitle(s.selectedSubtitleId); return true; }
        if (s.selectedAudioClipId) { s.removeAudioClip(s.selectedAudioClipId); return true; }
        return false;
      },

      rippleDeleteSelected: () => {
        const s = get();
        const shiftAfter = (fromSec: number, deltaSec: number) => {
          set((cur) => ({
            overlayClips: cur.overlayClips.map((o) => (o.startSec >= fromSec ? { ...o, startSec: Math.max(0, o.startSec + deltaSec) } : o)),
            textClips: cur.textClips.map((t) => (t.startSec >= fromSec ? { ...t, startSec: Math.max(0, t.startSec + deltaSec), endSec: Math.max(0.2, t.endSec + deltaSec) } : t)),
            fxClips: cur.fxClips.map((f) => (f.startSec >= fromSec ? { ...f, startSec: Math.max(0, f.startSec + deltaSec) } : f)),
            audioClips: cur.audioClips.map((a) => (a.startSec >= fromSec ? { ...a, startSec: Math.max(0, a.startSec + deltaSec) } : a)),
            subtitles: cur.subtitles.map((c) => (c.startSec >= fromSec ? { ...c, startSec: Math.max(0, c.startSec + deltaSec), endSec: Math.max(0.1, c.endSec + deltaSec) } : c)),
            markers: cur.markers.map((m) => (m >= fromSec ? Math.max(0, m + deltaSec) : m)).filter((m, i, arr) => arr.findIndex((x) => Math.abs(x - m) < 0.05) === i),
          }));
        };
        const rangeOfMain = (id: string): { start: number; end: number } | null => {
          let acc = 0;
          for (const c of s.clips) {
            const len = s.clipLength(c);
            if (c.id === id) return { start: acc, end: acc + len };
            acc += len;
          }
          return null;
        };
        if (s.selectedClipId) {
          const r = rangeOfMain(s.selectedClipId);
          if (!r) return false;
          s.removeClip(s.selectedClipId);
          shiftAfter(r.end, -(r.end - r.start));
          return true;
        }
        if (s.selectedOverlayId) {
          const c = s.overlayClips.find((x) => x.id === s.selectedOverlayId);
          if (!c) return false;
          const dur = Math.max(0.1, c.outSec - c.inSec || c.duration || 0);
          s.removeOverlayClip(c.id); shiftAfter(c.startSec + dur, -dur); return true;
        }
        if (s.selectedTextId) {
          const c = s.textClips.find((x) => x.id === s.selectedTextId);
          if (!c) return false;
          const dur = Math.max(0.2, c.endSec - c.startSec);
          s.removeTextClip(c.id); shiftAfter(c.endSec, -dur); return true;
        }
        if (s.selectedFxId) {
          const c = s.fxClips.find((x) => x.id === s.selectedFxId);
          if (!c) return false;
          s.removeFxClip(c.id); shiftAfter(c.startSec + c.duration, -c.duration); return true;
        }
        if (s.selectedSubtitleId) {
          const c = s.subtitles.find((x) => x.id === s.selectedSubtitleId);
          if (!c) return false;
          const dur = Math.max(0.1, c.endSec - c.startSec);
          s.removeSubtitle(c.id); shiftAfter(c.endSec, -dur); return true;
        }
        if (s.selectedAudioClipId) {
          const c = s.audioClips.find((x) => x.id === s.selectedAudioClipId);
          if (!c) return false;
          const dur = Math.max(0.1, c.outSec - c.inSec || c.duration || 0);
          s.removeAudioClip(c.id); shiftAfter(c.startSec + dur, -dur); return true;
        }
        return false;
      },

      splitAtPlayhead: () => {
        const s = get();
        const t = s.playheadSec;
        const created: string[] = [];
        const locked = (key: TimelineTrackKey) => Boolean(s.trackStates[key]?.locked);
        if (!locked('main')) {
          let acc = 0;
          for (const c of s.clips) {
            const len = s.clipLength(c);
            if (t > acc + 0.08 && t < acc + len - 0.08) {
              const id = s.splitClip(c.id, (t - acc) * (c.speed ?? 1));
              if (id) created.push(id);
              break;
            }
            acc += len;
          }
        }
        set((cur) => {
          const nextText = [...cur.textClips];
          const nextFx = [...cur.fxClips];
          const nextOverlay = [...cur.overlayClips];
          const nextAudio = [...cur.audioClips];
          const nextSub = [...cur.subtitles];

          if (!locked('text')) {
            for (const c of cur.textClips) {
              if (t > c.startSec + 0.08 && t < c.endSec - 0.08) {
                const id = `txt-${nanoid(6)}`;
                created.push(id);
                nextText.push({ ...c, id, startSec: t });
                const i = nextText.findIndex((x) => x.id === c.id);
                if (i >= 0) nextText[i] = { ...nextText[i], endSec: t };
              }
            }
          }
          if (!locked('fx')) {
            for (const c of cur.fxClips) {
              const end = c.startSec + c.duration;
              if (t > c.startSec + 0.08 && t < end - 0.08) {
                const id = `fx-${nanoid(6)}`;
                created.push(id);
                nextFx.push({ ...c, id, startSec: t, duration: end - t });
                const i = nextFx.findIndex((x) => x.id === c.id);
                if (i >= 0) nextFx[i] = { ...nextFx[i], duration: t - c.startSec };
              }
            }
          }
          for (const trackIndex of [0, 1] as const) {
            if (locked(`overlay-${trackIndex}`)) continue;
            for (const c of cur.overlayClips.filter((x) => x.trackIndex === trackIndex)) {
              const dur = Math.max(0.1, c.outSec - c.inSec || c.duration || 0);
              const end = c.startSec + dur;
              if (t > c.startSec + 0.08 && t < end - 0.08) {
                const local = t - c.startSec;
                const id = `ovl-${nanoid(6)}`;
                created.push(id);
                nextOverlay.push({ ...c, id, startSec: t, inSec: c.inSec + local, duration: dur - local });
                const i = nextOverlay.findIndex((x) => x.id === c.id);
                if (i >= 0) nextOverlay[i] = { ...nextOverlay[i], outSec: c.inSec + local, duration: local };
              }
            }
          }
          for (const c of cur.audioClips) {
            const kind = cur.audioTracks.find((x) => x.id === c.trackId)?.kind ?? 'bgm';
            if (locked(`audio-${kind}`)) continue;
            const dur = Math.max(0.1, c.outSec - c.inSec || c.duration || 0);
            const end = c.startSec + dur;
            if (t > c.startSec + 0.08 && t < end - 0.08) {
              const local = t - c.startSec;
              const id = `aclip-${nanoid(6)}`;
              created.push(id);
              nextAudio.push({ ...c, id, startSec: t, inSec: c.inSec + local, duration: dur - local });
              const i = nextAudio.findIndex((x) => x.id === c.id);
              if (i >= 0) nextAudio[i] = { ...nextAudio[i], outSec: c.inSec + local, duration: local };
            }
          }
          if (!locked('subtitle')) {
            for (const c of cur.subtitles) {
              if (t > c.startSec + 0.08 && t < c.endSec - 0.08) {
                const id = `sub-${nanoid(6)}`;
                created.push(id);
                nextSub.push({ ...c, id, startSec: t });
                const i = nextSub.findIndex((x) => x.id === c.id);
                if (i >= 0) nextSub[i] = { ...nextSub[i], endSec: t };
              }
            }
          }
          return {
            textClips: nextText.sort((a, b) => a.startSec - b.startSec),
            fxClips: nextFx.sort((a, b) => a.startSec - b.startSec),
            overlayClips: nextOverlay.sort((a, b) => a.startSec - b.startSec),
            audioClips: nextAudio.sort((a, b) => a.startSec - b.startSec),
            subtitles: nextSub.sort((a, b) => a.startSec - b.startSec),
          };
        });
        return created;
      },

      // 时间轴有效时长 = 裁剪区间 / 变速（曲线变速约定不改总时长）
      clipLength: (c) => Math.max(0.1, (c.outSec - c.inSec) / (c.speed && c.speed > 0 ? c.speed : 1)),

      totalDuration: () => {
        const { clips, overlayClips, textClips, fxClips, audioClips, subtitles, clipLength } = get();
        const main = clips.reduce((sum, c) => sum + clipLength(c), 0);
        const tails = [
          ...overlayClips.map((o) => o.startSec + Math.max(0.1, o.outSec - o.inSec || o.duration || 0)),
          ...textClips.map((t) => t.endSec),
          ...fxClips.map((f) => f.startSec + f.duration),
          ...audioClips.map((a) => a.startSec + Math.max(0.1, a.outSec - a.inSec || a.duration || 0)),
          ...subtitles.map((c) => c.endSec),
        ];
        // 超出主轨的部分导出时由 composeEngine 补黑场（tpad）
        return Math.max(main, ...tails, 0);
      },

      getStateSummary: () => {
        const { clips, bgm, aspect, audioTracks, audioClips, subtitles, overlayClips, textClips, fxClips, markers, exportSettings, proxyPaths, rippleEnabled, trackStates, lastRenderError, playheadSec, clipLength, totalDuration } = get();
        const total = totalDuration();
        const activeAtPlayhead = {
          playhead_sec: Number(playheadSec.toFixed(2)),
          clips: [] as string[],
          overlays: overlayClips.filter((o) => !o.disabled && playheadSec >= o.startSec && playheadSec < o.startSec + Math.max(0.1, o.outSec - o.inSec || o.duration || 0)).map((o) => o.id),
          texts: textClips.filter((t) => !t.disabled && playheadSec >= t.startSec && playheadSec < t.endSec).map((t) => t.id),
          fx: fxClips.filter((f) => !f.disabled && playheadSec >= f.startSec && playheadSec < f.startSec + f.duration).map((f) => f.id),
          audio: audioClips.filter((a) => !a.disabled && playheadSec >= a.startSec && playheadSec < a.startSec + Math.max(0.1, a.outSec - a.inSec || a.duration || total)).map((a) => a.id),
          subtitles: subtitles.filter((c) => !c.disabled && playheadSec >= c.startSec && playheadSec < c.endSec).map((c) => c.id),
        };
        let cursor = 0;
        for (const c of clips) {
          const len = clipLength(c);
          if (!c.disabled && playheadSec >= cursor && playheadSec < cursor + len) activeAtPlayhead.clips.push(c.id);
          cursor += len;
        }
        return JSON.stringify({
          aspect,
          export_settings: exportSettings,
          ripple_enabled: rippleEnabled,
          track_states: trackStates,
          playhead_sec: Number(playheadSec.toFixed(2)),
          active_at_playhead: activeAtPlayhead,
          last_render_error: lastRenderError,
          proxy_count: Object.keys(proxyPaths).length,
          markers_count: markers.length,
          total_duration_sec: Number(total.toFixed(2)),
          bgm: bgm ? { label: bgm.label, basename: fileBasename(bgm.path), path: bgm.path, volume: bgm.volume } : null,
          clips: clips.map((c, i) => ({
            index: i,
            id: c.id,
            label: c.label,
            basename: fileBasename(c.path),
            path: c.path,
            full_duration: Number(c.duration.toFixed(2)),
            in_sec: Number(c.inSec.toFixed(2)),
            out_sec: Number(c.outSec.toFixed(2)),
            effective_sec: Number(clipLength(c).toFixed(2)),
            speed: c.speed ?? 1,
            volume: c.volume ?? 1,
            disabled: c.disabled ?? false,
            transition_after: c.transitionAfter,
          })),
          audio_clips: audioClips.map((a) => ({
            id: a.id,
            kind: audioTracks.find((t) => t.id === a.trackId)?.kind,
            label: a.label,
            basename: fileBasename(a.path),
            path: a.path,
            start_sec: Number(a.startSec.toFixed(2)),
            duration_sec: Number(a.duration.toFixed(2)),
            in_sec: Number(a.inSec.toFixed(2)),
            out_sec: Number(a.outSec.toFixed(2)),
            effective_sec: Number(Math.max(0.1, a.outSec - a.inSec || a.duration || 0).toFixed(2)),
            volume: a.volume,
            loop: a.loop ?? false,
            disabled: a.disabled ?? false,
          })),
          subtitles: subtitles.map((c) => ({
            id: c.id,
            start: Number(c.startSec.toFixed(2)),
            end: Number(c.endSec.toFixed(2)),
            text: c.text,
          })),
          overlays: overlayClips.map((o) => ({
            id: o.id, track: o.trackIndex, kind: o.kind, label: o.label,
            basename: fileBasename(o.path),
            path: o.path,
            start: Number(o.startSec.toFixed(2)),
            in_sec: Number(o.inSec.toFixed(2)),
            out_sec: Number(o.outSec.toFixed(2)),
            duration_sec: Number(o.duration.toFixed(2)),
            effective_sec: Number(Math.max(0.1, o.outSec - o.inSec).toFixed(2)),
            disabled: o.disabled ?? false,
            transform: o.transform, keyframes: o.keyframes?.length ?? 0,
          })),
          texts: textClips.map((t) => ({
            id: t.id, template: t.templateId, text: t.text.slice(0, 40),
            start: Number(t.startSec.toFixed(2)), end: Number(t.endSec.toFixed(2)), position: t.position,
            disabled: t.disabled ?? false,
          })),
          fx: fxClips.map((f) => ({
            id: f.id, label: f.label, component: f.componentId ?? 'custom',
            start: Number(f.startSec.toFixed(2)), duration: Number(f.duration.toFixed(2)),
            theme: f.theme,
            mode: (f.params as { mode?: unknown } | undefined)?.mode ?? (f.componentId === 'scene' ? 'scene' : 'custom'),
            has_spec: Boolean((f.params as { spec?: unknown } | undefined)?.spec),
            params_keys: f.params ? Object.keys(f.params) : [],
            transform: f.transform,
            has_cache: Boolean(f.renderCachePath),
            disabled: f.disabled ?? false,
          })),
        });
      },
    }),
    {
      name: EDITOR_STORAGE_KEY,
      storage: createJSONStorage(() => editorLocalStorage),
      version: 3,
      // transcripts 不进 localStorage（可能很大），仅随 editor.json 项目落盘
      partialize: (s) => ({
        clips: s.clips,
        bgm: s.bgm,
        zoom: s.zoom,
        aspect: s.aspect,
        audioTracks: s.audioTracks,
        audioClips: s.audioClips,
        subtitles: s.subtitles,
        overlayClips: s.overlayClips,
        textClips: s.textClips,
        fxClips: s.fxClips,
        markers: s.markers,
        exportSettings: s.exportSettings,
        proxyPaths: s.proxyPaths,
        snapEnabled: s.snapEnabled,
        rippleEnabled: s.rippleEnabled,
        trackStates: s.trackStates,
      }),
      migrate: (persisted, version) => {
        const state = persisted as Record<string, unknown>;
        if (version < 2) {
          // v1 → v2: bgm 迁移为 bgm 音频轨 + loop AudioClip
          state.aspect = '16:9';
          state.audioTracks = [];
          state.audioClips = [];
          state.subtitles = [];
          const bgm = state.bgm as EditorBgm | null;
          if (bgm) {
            const track = newTrack('bgm');
            state.audioTracks = [track];
            state.audioClips = [{
              id: `aclip-${nanoid(6)}`,
              trackId: track.id,
              path: bgm.path,
              label: bgm.label,
              startSec: 0,
              duration: 0,
              inSec: 0,
              outSec: 0,
              volume: bgm.volume,
              loop: true,
            } satisfies AudioClip];
          }
        }
        if (version < 3) {
          // v2 → v3: 新增轨道与设置补默认值
          state.overlayClips = state.overlayClips ?? [];
          state.textClips = state.textClips ?? [];
          state.fxClips = state.fxClips ?? [];
          state.markers = state.markers ?? [];
          state.exportSettings = state.exportSettings ?? { ...DEFAULT_EXPORT_SETTINGS };
          state.snapEnabled = state.snapEnabled ?? true;
        }
        if (!isEditorAspect(state.aspect)) state.aspect = '16:9';
        state.proxyPaths = state.proxyPaths ?? {};
        state.rippleEnabled = state.rippleEnabled ?? true;
        state.trackStates = state.trackStates ?? {};
        state.fxClips = Array.isArray(state.fxClips)
          ? state.fxClips.map((f: any) => ({ ...f, transform: f.transform ?? DEFAULT_FX_TRANSFORM }))
          : [];
        return state as never;
      },
    },
  ),
);
