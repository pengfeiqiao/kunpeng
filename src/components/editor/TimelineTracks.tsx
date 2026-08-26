/**
 * TimelineTracks — 多轨时间轴（v3）：
 * 标尺(踩点标记) / 特效 / 花字 / 画中画×2 / 主视频轨(缩略图+裁剪+排序) /
 * 字幕 / 音频轨(BGM/音效/旁白)。左侧 gutter 固定轨道名（音频带静音钮），
 * 拖拽支持吸附（踩点 + 0.5s 网格，TopBar 可关）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, Lock, Unlock, Volume2, VolumeX } from 'lucide-react';
import { nanoid } from 'nanoid';
import { invoke } from '@tauri-apps/api/tauri';
import { message as tauriMessage, open as openDialog, save } from '@tauri-apps/api/dialog';
import {
  useEditorStore, type AudioClip, type EditorClip, type FxClip, type OverlayClip,
  type SubtitleCue, type TextClip, type TimelineTrackKey,
} from '@/stores/editorStore';
import { captureEditorSnapshot } from '@/lib/editor/editorHistory';
import { exportSelectedMainClips } from '@/lib/editor/composeEngine';
import { findTransition } from '@/lib/editor/presets/transitionPresets';
import { detectFfmpeg, probeDuration } from '@/lib/canvas/videoCompose';
import { useVideoThumb } from '@/lib/canvas/videoThumbs';
import { getWaveform, PEAKS_PER_SEC } from '@/lib/editor/waveform';
import { saveCustomFxPreset, saveCustomTextPreset } from '@/lib/editor/customPresets';
import { TIMELINE_SELECT_RANGE_EVENT, type TimelineSelectRangeDirection } from './timelineEvents';
import { dispatchEditorPrompt } from './EditorChatPanel';

// 轨道默认行高（gutter 与轨道区严格同高对齐）
const H = { ruler: 28, fx: 30, text: 30, ovl: 32, main: 74, sub: 28, audio: 46 } as const;
const GAP = 3;
const GUTTER_W = 112;
const TRACK_HEIGHT_STORAGE_KEY = 'kunpeng.editor.trackHeights';
const MAIN_CLIP_HEADER_H = 18;
const MAIN_CLIP_WAVE_H = 24;

const LANE_BG = 'rgba(255,255,255,0.018)';
const TINT = {
  fx: { bg: 'rgba(167,139,250,0.16)', border: 'rgba(167,139,250,0.45)' },
  text: { bg: 'rgba(232,192,96,0.16)', border: 'rgba(232,192,96,0.45)' },
  ovl: { bg: 'rgba(96,200,250,0.14)', border: 'rgba(96,200,250,0.4)' },
  sub: { bg: 'rgba(74,222,128,0.13)', border: 'rgba(74,222,128,0.4)' },
  audio: { bg: 'rgba(96,165,250,0.13)', border: 'rgba(96,165,250,0.4)' },
} as const;

type SelectableTrackType = 'main' | 'fx' | 'text' | 'overlay' | 'subtitle' | 'audio';
type TimelineSelectionItem = { type: SelectableTrackType; id: string };
type TimelineSelectionBox = {
  active: boolean;
  startX: number;
  startY: number;
  x: number;
  y: number;
};
type TimelineContextMenu = { x: number; y: number; item: TimelineSelectionItem };
type TimelineAttributeClipboard = {
  type: SelectableTrackType;
  patch: Record<string, unknown>;
};
type TimelineClipboardPayload = {
  type: SelectableTrackType;
  start: number;
  data: Record<string, unknown>;
};
type TimelineDropPayload = {
  kind?: string;
  path?: string;
  label?: string;
  text?: string;
  templateId?: string;
  position?: TextClip['position'];
  customPos?: TextClip['customPos'];
  styleOverrides?: TextClip['styleOverrides'];
  html?: string;
  css?: string;
  componentId?: string;
  params?: Record<string, unknown>;
  theme?: string;
  transform?: FxClip['transform'];
  duration?: number;
};
type TimelineDropPreview = { sec: number; track: string; payload?: TimelineDropPayload | null };
type CommandResult = { exit_code: number; stdout: string; stderr: string };

function selectionKey(item: TimelineSelectionItem) {
  return `${item.type}:${item.id}`;
}

function cloneJson<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function shq(path: string) {
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

function itemFromElement(el: HTMLElement): TimelineSelectionItem | null {
  const id = el.dataset.clipId;
  const type = el.dataset.trackType as SelectableTrackType | undefined;
  if (!id || !type) return null;
  return { id, type };
}

function selectFirstTimelineItem(item: TimelineSelectionItem | undefined) {
  if (!item) return;
  const store = useEditorStore.getState();
  if (item.type === 'main') store.select(item.id);
  else if (item.type === 'fx') store.selectFx(item.id);
  else if (item.type === 'text') store.selectText(item.id);
  else if (item.type === 'overlay') store.selectOverlay(item.id);
  else if (item.type === 'subtitle') store.selectSubtitle(item.id);
  else if (item.type === 'audio') store.selectAudioClip(item.id);
}

function rectsIntersect(a: DOMRect | { left: number; right: number; top: number; bottom: number }, b: DOMRect | { left: number; right: number; top: number; bottom: number }) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function isVideoPath(path: string) {
  return /\.(mp4|mov|m4v|webm)$/i.test(path);
}

function isAudioPath(path: string) {
  return /\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i.test(path);
}

function dragTypes(e: React.DragEvent) {
  return Array.from(e.dataTransfer.types ?? []);
}

function hasTimelineDragPayload(e: React.DragEvent) {
  const types = dragTypes(e);
  return types.includes('application/x-kunpeng-media')
    || types.includes('application/json')
    || types.includes('text/plain')
    || types.includes('Files');
}

function parseTimelineDropPayload(raw: string): TimelineDropPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as TimelineDropPayload;
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    return { kind: isVideoPath(raw) ? 'video' : isAudioPath(raw) ? 'audio' : 'file', path: raw };
  }
  return null;
}

function readWindowDragPayload() {
  const raw = (window as unknown as { __kunpengMediaDragPayload?: string }).__kunpengMediaDragPayload ?? '';
  return parseTimelineDropPayload(raw);
}

async function safeMediaDuration(path: string) {
  try {
    const duration = await probeDuration(path);
    if (Number.isFinite(duration) && duration > 0) return duration;
  } catch {
    // The caller shows a user-facing error; never invent a clip duration.
  }
  throw new Error(`无法读取“${path.split('/').pop() ?? path}”的真实时长，请检查文件是否完整或格式是否受系统支持。`);
}

function writeWindowDropTarget(target: TimelineDropPreview | null) {
  const w = window as unknown as {
    __kunpengTimelineDropTarget?: TimelineDropPreview & { at: number };
  };
  if (!target) {
    delete w.__kunpengTimelineDropTarget;
    return;
  }
  w.__kunpengTimelineDropTarget = { ...target, at: Date.now() };
}

function clampHeight(track: TimelineTrackKey, height: number) {
  const isMain = track === 'main';
  const isAudio = track.startsWith('audio-');
  const min = isMain ? 68 : isAudio ? 34 : 24;
  const max = isMain ? 150 : isAudio ? 120 : 90;
  return Math.max(min, Math.min(max, Math.round(height)));
}

function defaultTrackHeight(track: TimelineTrackKey) {
  if (track === 'fx') return H.fx;
  if (track === 'text') return H.text;
  if (track === 'overlay-0' || track === 'overlay-1') return H.ovl;
  if (track === 'main') return H.main;
  if (track === 'subtitle') return H.sub;
  return H.audio;
}

function readTrackHeights() {
  if (typeof window === 'undefined') return {} as Partial<Record<TimelineTrackKey, number>>;
  try {
    const raw = window.localStorage.getItem(TRACK_HEIGHT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<Record<TimelineTrackKey, number>>;
    return Object.fromEntries(
      Object.entries(parsed).map(([k, v]) => [k, clampHeight(k as TimelineTrackKey, Number(v))]),
    ) as Partial<Record<TimelineTrackKey, number>>;
  } catch {
    return {};
  }
}

/** 吸附：踩点 + 0.5s 网格（阈值 8px） */
function useSnap() {
  const markers = useEditorStore((s) => s.markers);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const zoom = useEditorStore((s) => s.zoom);
  return useCallback((t: number): number => {
    if (t < 0) return 0;
    if (!snapEnabled) return t;
    const threshold = 8 / zoom;
    let best = t;
    let bestD = threshold;
    for (const c of [...markers, Math.round(t * 2) / 2]) {
      const d = Math.abs(c - t);
      if (d < bestD) { best = c; bestD = d; }
    }
    return Math.max(0, best);
  }, [markers, snapEnabled, zoom]);
}

/** 通用横移拖拽（startSec 类片段）。resize=true 时拖右缘改时长 */
function useHorizDrag(zoom: number, snap: (t: number) => number, locked = false) {
  const drag = useRef<{ startX: number; orig: number; cb: (v: number) => void } | null>(null);
  const onDown = (e: React.PointerEvent, orig: number, cb: (v: number) => void) => {
    e.stopPropagation();
    if (locked) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    captureEditorSnapshot();
    drag.current = { startX: e.clientX, orig, cb };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const d = drag.current;
    d.cb(snap(d.orig + (e.clientX - d.startX) / zoom));
  };
  const onUp = () => { drag.current = null; };
  return { onDown, onMove, onUp };
}

export default function TimelineTracks({ height = 404 }: { height?: number }) {
  const clips = useEditorStore((s) => s.clips);
  const overlayClips = useEditorStore((s) => s.overlayClips);
  const textClips = useEditorStore((s) => s.textClips);
  const fxClips = useEditorStore((s) => s.fxClips);
  const audioTracks = useEditorStore((s) => s.audioTracks);
  const audioClips = useEditorStore((s) => s.audioClips);
  const subtitles = useEditorStore((s) => s.subtitles);
  const markers = useEditorStore((s) => s.markers);
  const zoom = useEditorStore((s) => s.zoom);
  const playheadSec = useEditorStore((s) => s.playheadSec);
  const totalDuration = useEditorStore((s) => s.totalDuration);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const setZoom = useEditorStore((s) => s.setZoom);
  const setTrackMuted = useEditorStore((s) => s.setTrackMuted);
  const trackStates = useEditorStore((s) => s.trackStates);
  const setTrackState = useEditorStore((s) => s.setTrackState);
  const removeMarker = useEditorStore((s) => s.removeMarker);
  const [trackHeights, setTrackHeights] = useState<Partial<Record<TimelineTrackKey, number>>>(() => readTrackHeights());
  const [multiSelected, setMultiSelected] = useState<TimelineSelectionItem[]>([]);
  const [selectionBox, setSelectionBox] = useState<TimelineSelectionBox | null>(null);
  const [dropPreview, setDropPreview] = useState<TimelineDropPreview | null>(null);
  const [contextMenu, setContextMenu] = useState<TimelineContextMenu | null>(null);
  const [attributeClipboard, setAttributeClipboard] = useState<TimelineAttributeClipboard | null>(null);
  const [timelineClipboard, setTimelineClipboard] = useState<TimelineClipboardPayload[]>([]);
  const [exportingSelection, setExportingSelection] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const rulerScrollRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);
  const selectionTimer = useRef<number | null>(null);
  const selectingRef = useRef(false);
  const total = totalDuration();
  const trackWidth = Math.max(total * zoom + 120, 600);
  const multiSelectedKeys = useMemo(() => new Set(multiSelected.map(selectionKey)), [multiSelected]);
  const resolveDropTrack = useCallback((clientY: number): string => {
    const el = scrollRef.current;
    if (!el) return 'main';
    const y = clientY - el.getBoundingClientRect().top;
    const h = (track: TimelineTrackKey) => trackHeights[track] ?? defaultTrackHeight(track);
    const audioKinds = (['bgm', 'sfx', 'voice'] as const).filter((kind) => audioTracks.some((t) => t.kind === kind));
    const rows: { key?: string; height: number }[] = [
      { key: 'fx', height: h('fx') },
      { key: 'text', height: h('text') },
      { key: 'overlay-0', height: h('overlay-0') },
      { key: 'overlay-1', height: h('overlay-1') },
      { key: 'main', height: h('main') },
      { key: 'subtitle', height: h('subtitle') },
      ...audioKinds.map((kind) => ({ key: `audio-${kind}`, height: h(`audio-${kind}` as TimelineTrackKey) })),
    ];
    let cursor = 0;
    for (const row of rows) {
      if (y >= cursor && y <= cursor + row.height + GAP) return row.key ?? 'main';
      cursor += row.height + GAP;
    }
    return 'main';
  }, [audioTracks, trackHeights]);

  useEffect(() => {
    window.localStorage.setItem(TRACK_HEIGHT_STORAGE_KEY, JSON.stringify(trackHeights));
  }, [trackHeights]);

  useEffect(() => {
    const onMediaDrag = (event: Event) => {
      const detail = (event as CustomEvent<{ x: number; y: number; raw?: string }>).detail;
      const el = scrollRef.current;
      if (!el || !detail || detail.x <= 0 || detail.y <= 0) return;
      const rect = el.getBoundingClientRect();
      if (detail.x < rect.left || detail.x > rect.right || detail.y < rect.top || detail.y > rect.bottom) {
        setDropPreview(null);
        writeWindowDropTarget(null);
        return;
      }
      const next = {
        sec: Math.max(0, (detail.x - rect.left + el.scrollLeft) / zoom),
        track: resolveDropTrack(detail.y),
        payload: parseTimelineDropPayload(detail.raw ?? '') ?? readWindowDragPayload(),
      };
      setDropPreview(next);
      writeWindowDropTarget(next);
    };
    const onMediaDragEnd = () => {
      writeWindowDropTarget(null);
      window.setTimeout(() => setDropPreview(null), 80);
    };
    window.addEventListener('kunpeng:media-drag', onMediaDrag as EventListener);
    window.addEventListener('kunpeng:media-drag-end', onMediaDragEnd);
    return () => {
      window.removeEventListener('kunpeng:media-drag', onMediaDrag as EventListener);
      window.removeEventListener('kunpeng:media-drag-end', onMediaDragEnd);
    };
  }, [resolveDropTrack, zoom]);

  const getTrackHeight = useCallback((track: TimelineTrackKey) => {
    return trackHeights[track] ?? defaultTrackHeight(track);
  }, [trackHeights]);

  const startResizeTrack = useCallback((e: React.MouseEvent<HTMLDivElement>, track: TimelineTrackKey) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = getTrackHeight(track);
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    const move = (ev: MouseEvent) => {
      setTrackHeights((prev) => ({ ...prev, [track]: clampHeight(track, startH + ev.clientY - startY) }));
    };
    const up = () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, [getTrackHeight]);

  const posToSec = useCallback((clientX: number) => {
    const el = scrollRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left + el.scrollLeft) / zoom);
  }, [zoom]);

  const insertMainClipAt = useCallback(async (path: string, label: string | undefined, sec: number) => {
    const store = useEditorStore.getState();
    const before = store.clips;
    const ids = await store.addClips([{ path, label }]);
    const newId = ids[0];
    if (!newId) return;
    let acc = 0;
    let targetIndex = before.length;
    for (let i = 0; i < before.length; i += 1) {
      const len = store.clipLength(before[i]);
      if (sec < acc + len / 2) {
        targetIndex = i;
        break;
      }
      acc += len;
    }
    const nextIds = before.map((c) => c.id);
    nextIds.splice(targetIndex, 0, newId);
    useEditorStore.getState().setOrder(nextIds);
    useEditorStore.getState().select(newId);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!hasTimelineDragPayload(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropPreview(null);
    writeWindowDropTarget(null);
    (window as unknown as { __kunpengTimelineDropConsumed?: boolean }).__kunpengTimelineDropConsumed = true;
    const fallbackRaw = (window as unknown as { __kunpengMediaDragPayload?: string }).__kunpengMediaDragPayload ?? '';
    const raw = e.dataTransfer.getData('application/x-kunpeng-media')
      || e.dataTransfer.getData('application/json')
      || e.dataTransfer.getData('text/plain')
      || fallbackRaw;
    delete (window as unknown as { __kunpengMediaDragPayload?: string }).__kunpengMediaDragPayload;
    const file = e.dataTransfer.files?.[0] as (File & { path?: string }) | undefined;
    if (!raw && !file?.path) return;
    let payload = parseTimelineDropPayload(raw);
    if (!payload && file?.path) {
      payload = { kind: isVideoPath(file.path) ? 'video' : isAudioPath(file.path) ? 'audio' : 'file', path: file.path, label: file.name };
    }
    if (!payload) return;
    const trackEl = (e.target as HTMLElement).closest<HTMLElement>('[data-drop-track]');
    const track = trackEl?.dataset.dropTrack ?? resolveDropTrack(e.clientY);
    const sec = posToSec(e.clientX);
    captureEditorSnapshot();
    const store = useEditorStore.getState();
    if (payload.kind === 'text-template' && payload.text && payload.templateId) {
      const id = store.addTextClip({
        text: payload.text,
        templateId: payload.templateId,
        position: payload.position ?? 'center',
        customPos: payload.customPos,
        styleOverrides: payload.styleOverrides,
        startSec: sec,
        endSec: sec + (payload.duration ?? 3),
      });
      store.selectText(id);
      return;
    }
    if ((payload.kind === 'fx-template' || payload.kind === 'page-template') && payload.html && payload.css) {
      const id = store.addFxClip({
        label: payload.label ?? '特效',
        html: payload.html,
        css: payload.css,
        componentId: payload.componentId,
        params: payload.params,
        theme: payload.theme,
        transform: payload.transform,
        startSec: sec,
        duration: payload.duration ?? (payload.kind === 'page-template' ? 5 : 4),
      });
      store.selectFx(id);
      return;
    }
    if (!payload.path) return;
    if (track === 'overlay-0' || track === 'overlay-1') {
      const trackIndex = track === 'overlay-1' ? 1 : 0;
      void store.addOverlayClip({ path: payload.path, kind: isVideoPath(payload.path) ? 'video' : 'image', label: payload.label, startSec: sec, trackIndex })
        .then((id) => useEditorStore.getState().selectOverlay(id))
        .catch((error) => tauriMessage(error instanceof Error ? error.message : String(error), { title: '拖入素材失败', type: 'error' }).catch(() => {}));
    } else if (track.startsWith('audio-')) {
      const kind = track.replace('audio-', '') as 'bgm' | 'sfx' | 'voice';
      void store.addAudioClip(kind, { path: payload.path, label: payload.label, startSec: sec, loop: false })
        .then((id) => useEditorStore.getState().selectAudioClip(id))
        .catch((error) => tauriMessage(error instanceof Error ? error.message : String(error), { title: '拖入音频失败', type: 'error' }).catch(() => {}));
    } else if (payload.kind === 'audio' || isAudioPath(payload.path)) {
      void store.addAudioClip('sfx', { path: payload.path, label: payload.label, startSec: sec, loop: false })
        .then((id) => useEditorStore.getState().selectAudioClip(id))
        .catch((error) => tauriMessage(error instanceof Error ? error.message : String(error), { title: '拖入音频失败', type: 'error' }).catch(() => {}));
    } else {
      void insertMainClipAt(payload.path, payload.label, sec)
        .catch((error) => tauriMessage(error instanceof Error ? error.message : String(error), { title: '拖入素材失败', type: 'error' }).catch(() => {}));
    }
  }, [insertMainClipAt, posToSec, resolveDropTrack]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (hasTimelineDragPayload(e)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      const trackEl = (e.target as HTMLElement).closest<HTMLElement>('[data-drop-track]');
      const next = { sec: posToSec(e.clientX), track: trackEl?.dataset.dropTrack ?? resolveDropTrack(e.clientY), payload: readWindowDragPayload() };
      setDropPreview(next);
      writeWindowDropTarget(next);
    }
  }, [posToSec, resolveDropTrack]);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const current = e.currentTarget;
    const related = e.relatedTarget as Node | null;
    if (!related || !current.contains(related)) {
      setDropPreview(null);
      writeWindowDropTarget(null);
    }
  }, []);

  const commitBoxSelection = useCallback((box: TimelineSelectionBox) => {
    const el = scrollRef.current;
    if (!el) return;
    const rect = {
      left: Math.min(box.startX, box.x),
      right: Math.max(box.startX, box.x),
      top: Math.min(box.startY, box.y),
      bottom: Math.max(box.startY, box.y),
    };
    const next: TimelineSelectionItem[] = [];
    el.querySelectorAll<HTMLElement>('[data-clip-id][data-track-type]').forEach((node) => {
      if (!rectsIntersect(rect, node.getBoundingClientRect())) return;
      const item = itemFromElement(node);
      if (item && !next.some((x) => selectionKey(x) === selectionKey(item))) next.push(item);
    });
    setMultiSelected(next);
  }, []);

  const selectedItemsFor = useCallback((item: TimelineSelectionItem) => {
    return multiSelectedKeys.has(selectionKey(item)) ? multiSelected : [item];
  }, [multiSelected, multiSelectedKeys]);

  const copyItemAttributes = useCallback((item: TimelineSelectionItem) => {
    const state = useEditorStore.getState();
    let patch: Record<string, unknown> | null = null;
    if (item.type === 'main') {
      const clip = state.clips.find((x) => x.id === item.id);
      if (clip) patch = {
        transitionAfter: cloneJson(clip.transitionAfter),
        speed: clip.speed,
        curvePreset: clip.curvePreset,
        volume: clip.volume,
        reversed: clip.reversed,
        flipH: clip.flipH,
        rotate: clip.rotate,
        filter: cloneJson(clip.filter),
      };
    } else if (item.type === 'overlay') {
      const clip = state.overlayClips.find((x) => x.id === item.id);
      if (clip) patch = {
        transform: cloneJson(clip.transform),
        keyframes: cloneJson(clip.keyframes),
        volume: clip.volume,
      };
    } else if (item.type === 'text') {
      const clip = state.textClips.find((x) => x.id === item.id);
      if (clip) patch = {
        templateId: clip.templateId,
        position: clip.position,
        customPos: cloneJson(clip.customPos),
        styleOverrides: cloneJson(clip.styleOverrides),
      };
    } else if (item.type === 'fx') {
      const clip = state.fxClips.find((x) => x.id === item.id);
      if (clip) patch = {
        html: clip.html,
        css: clip.css,
        componentId: clip.componentId,
        params: cloneJson(clip.params),
        theme: clip.theme,
        transform: cloneJson(clip.transform),
      };
    } else if (item.type === 'subtitle') {
      const cue = state.subtitles.find((x) => x.id === item.id);
      if (cue) patch = { style: cloneJson(cue.style) };
    } else if (item.type === 'audio') {
      const clip = state.audioClips.find((x) => x.id === item.id);
      if (clip) patch = {
        volume: clip.volume,
        loop: clip.loop,
        fadeInSec: clip.fadeInSec,
        fadeOutSec: clip.fadeOutSec,
      };
    }
    if (!patch) return;
    setAttributeClipboard({ type: item.type, patch });
    setContextMenu(null);
  }, []);

  const pasteItemAttributes = useCallback((items: TimelineSelectionItem[]) => {
    if (!attributeClipboard || items.length === 0) return;
    const targets = items.filter((item) => item.type === attributeClipboard.type);
    if (targets.length === 0) return;
    const ids = new Set(targets.map((item) => item.id));
    captureEditorSnapshot();
    useEditorStore.setState((cur) => {
      const patch = cloneJson(attributeClipboard.patch);
      if (attributeClipboard.type === 'main') {
        return { clips: cur.clips.map((x) => (ids.has(x.id) ? { ...x, ...patch } as EditorClip : x)) };
      }
      if (attributeClipboard.type === 'overlay') {
        return { overlayClips: cur.overlayClips.map((x) => (ids.has(x.id) ? { ...x, ...cloneJson(patch) } as OverlayClip : x)) };
      }
      if (attributeClipboard.type === 'text') {
        return {
          textClips: cur.textClips.map((x) => (
            ids.has(x.id) ? { ...x, ...cloneJson(patch), renderCachePath: undefined, contentHash: undefined } as TextClip : x
          )),
        };
      }
      if (attributeClipboard.type === 'fx') {
        return {
          fxClips: cur.fxClips.map((x) => (
            ids.has(x.id) ? { ...x, ...cloneJson(patch), renderCachePath: undefined, contentHash: undefined } as FxClip : x
          )),
        };
      }
      if (attributeClipboard.type === 'subtitle') {
        return { subtitles: cur.subtitles.map((x) => (ids.has(x.id) ? { ...x, ...cloneJson(patch) } as SubtitleCue : x)) };
      }
      return { audioClips: cur.audioClips.map((x) => (ids.has(x.id) ? { ...x, ...cloneJson(patch) } as AudioClip : x)) };
    });
    setContextMenu(null);
  }, [attributeClipboard]);

  const exportSelectedItems = useCallback(async (items: TimelineSelectionItem[]) => {
    const mainIds = items.filter((item) => item.type === 'main').map((item) => item.id);
    if (items.length === 0 || mainIds.length !== items.length) {
      await tauriMessage('当前只支持导出主视频轨上的片段。', { title: '导出所选片段', type: 'info' }).catch(() => {});
      return;
    }
    if (exportingSelection) return;
    setExportingSelection(true);
    try {
      const workspace = await invoke<string>('ensure_workspace').catch(() => '');
      const fileName = `kunpeng_selected_${new Date().toISOString().slice(0, 19).replace(/-|:|T/g, '')}.mp4`;
      // Only prefill a default path when a workspace exists; otherwise let the
      // save dialog fall back to the system default location (never hardcode
      // a personal home directory here).
      const outputPath = await save({
        ...(workspace ? { defaultPath: `${workspace}/videos/${fileName}` } : {}),
        filters: [{ name: '视频', extensions: ['mp4'] }],
      }).catch(() => null);
      if (!outputPath) return;
      const out = await exportSelectedMainClips(mainIds, { outputPath });
      await tauriMessage(`已导出：${out}`, { title: '导出所选片段', type: 'info' }).catch(() => {});
    } catch (err) {
      await tauriMessage(err instanceof Error ? err.message : String(err), { title: '导出所选片段失败', type: 'error' }).catch(() => {});
    } finally {
      setExportingSelection(false);
      setContextMenu(null);
    }
  }, [exportingSelection]);

  const replaceItems = useCallback(async (items: TimelineSelectionItem[], actionTitle = '替换片段') => {
    const replaceable = items.filter((item) => item.type === 'main' || item.type === 'overlay');
    if (replaceable.length === 0 || replaceable.length !== items.length) {
      await tauriMessage('当前只支持主视频轨和视频轨 2/3 的媒体重连。', { title: actionTitle, type: 'info' }).catch(() => {});
      return;
    }
    const allowImages = replaceable.every((item) => item.type === 'overlay');
    const file = await openDialog({
      filters: [
        { name: allowImages ? '视频或图片' : '视频', extensions: allowImages ? ['mp4', 'mov', 'm4v', 'webm', 'png', 'jpg', 'jpeg', 'webp'] : ['mp4', 'mov', 'm4v', 'webm'] },
      ],
    }).catch(() => null);
    if (!file || Array.isArray(file)) return;
    const path = file;
    const isImg = /\.(png|jpe?g|webp)$/i.test(path);
    let probedDuration: number | null = null;
    try {
      probedDuration = isImg ? null : await safeMediaDuration(path);
    } catch (error) {
      await tauriMessage(error instanceof Error ? error.message : String(error), { title: `${actionTitle}失败`, type: 'error' }).catch(() => {});
      return;
    }
    const label = path.split('/').pop() ?? '替换素材';
    captureEditorSnapshot();
    const keys = new Set(replaceable.map(selectionKey));
    useEditorStore.setState((cur) => ({
      clips: cur.clips.map((clip) => {
        if (!keys.has(`main:${clip.id}`)) return clip;
        const oldLen = Math.max(0.1, clip.outSec - clip.inSec);
        const duration = probedDuration ?? oldLen;
        const nextOut = Math.min(duration, oldLen);
        return {
          ...clip,
          path,
          label,
          sourceNodeId: undefined,
          duration,
          inSec: 0,
          outSec: Math.max(0.1, nextOut),
        } as EditorClip;
      }),
      overlayClips: cur.overlayClips.map((clip) => {
        if (!keys.has(`overlay:${clip.id}`)) return clip;
        const oldLen = Math.max(0.1, clip.outSec - clip.inSec);
        const duration = isImg ? oldLen : (probedDuration ?? oldLen);
        const nextOut = isImg ? oldLen : Math.min(duration, oldLen);
        return {
          ...clip,
          path,
          label,
          kind: isImg ? 'image' : 'video',
          duration,
          inSec: 0,
          outSec: Math.max(0.1, nextOut),
          volume: isImg ? undefined : (clip.volume ?? 1),
        } as OverlayClip;
      }),
    }));
    setContextMenu(null);
  }, []);

  const firstMediaPathForItems = useCallback((items: TimelineSelectionItem[]) => {
    const state = useEditorStore.getState();
    for (const item of items) {
      if (item.type === 'main') {
        const path = state.clips.find((x) => x.id === item.id)?.path;
        if (path) return path;
      } else if (item.type === 'overlay') {
        const path = state.overlayClips.find((x) => x.id === item.id)?.path;
        if (path) return path;
      } else if (item.type === 'audio') {
        const path = state.audioClips.find((x) => x.id === item.id)?.path;
        if (path) return path;
      }
    }
    return null;
  }, []);

  const revealItemsInFinder = useCallback(async (items: TimelineSelectionItem[]) => {
    const path = firstMediaPathForItems(items);
    if (!path) {
      await tauriMessage('这个片段没有可定位的本地素材文件。', { title: '打开文件所在位置', type: 'info' }).catch(() => {});
      setContextMenu(null);
      return;
    }
    try {
      await invoke('open_path', { path, reveal: true });
    } catch (err) {
      await tauriMessage(err instanceof Error ? err.message : String(err), { title: '打开文件所在位置失败', type: 'error' }).catch(() => {});
    } finally {
      setContextMenu(null);
    }
  }, [firstMediaPathForItems]);

  const getTimelineItemStart = useCallback((item: TimelineSelectionItem) => {
    const state = useEditorStore.getState();
    if (item.type === 'main') {
      let acc = 0;
      for (const clip of state.clips) {
        const len = state.clipLength(clip);
        if (clip.id === item.id) return acc;
        acc += len;
      }
      return 0;
    }
    if (item.type === 'fx') return state.fxClips.find((x) => x.id === item.id)?.startSec ?? 0;
    if (item.type === 'text') return state.textClips.find((x) => x.id === item.id)?.startSec ?? 0;
    if (item.type === 'overlay') return state.overlayClips.find((x) => x.id === item.id)?.startSec ?? 0;
    if (item.type === 'subtitle') return state.subtitles.find((x) => x.id === item.id)?.startSec ?? 0;
    return state.audioClips.find((x) => x.id === item.id)?.startSec ?? 0;
  }, []);

  const selectedMainClipContexts = useCallback((items: TimelineSelectionItem[]) => {
    const state = useEditorStore.getState();
    return items
      .filter((item) => item.type === 'main')
      .map((item) => {
        const clip = state.clips.find((x) => x.id === item.id);
        if (!clip) return null;
        const timelineStart = getTimelineItemStart(item);
        const timelineEnd = timelineStart + state.clipLength(clip);
        return { clip, timelineStart, timelineEnd };
      })
      .filter((x): x is { clip: EditorClip; timelineStart: number; timelineEnd: number } => Boolean(x));
  }, [getTimelineItemStart]);

  const describeTimelineItems = useCallback((items: TimelineSelectionItem[]) => {
    const state = useEditorStore.getState();
    return items.map((item, index) => {
      const start = getTimelineItemStart(item);
      if (item.type === 'main') {
        const clip = state.clips.find((x) => x.id === item.id);
        if (!clip) return `${index + 1}. main:${item.id}（已找不到）`;
        const duration = state.clipLength(clip);
        return [
          `${index + 1}. 主视频 main:${clip.id}`,
          `名称：${clip.label}`,
          `时间轴：${start.toFixed(2)}-${(start + duration).toFixed(2)}s`,
          `源素材：${clip.path}`,
          `源入出点：${clip.inSec.toFixed(2)}-${clip.outSec.toFixed(2)}s`,
          `速度：${(clip.speed ?? 1).toFixed(2)}x`,
          clip.disabled ? '状态：已停用' : '',
        ].filter(Boolean).join('；');
      }
      if (item.type === 'overlay') {
        const clip = state.overlayClips.find((x) => x.id === item.id);
        if (!clip) return `${index + 1}. overlay:${item.id}（已找不到）`;
        const duration = Math.max(0.2, clip.outSec - clip.inSec);
        return [
          `${index + 1}. 视频轨 ${clip.trackIndex + 2} overlay:${clip.id}`,
          `名称：${clip.label}`,
          `类型：${clip.kind}`,
          `时间轴：${clip.startSec.toFixed(2)}-${(clip.startSec + duration).toFixed(2)}s`,
          `素材：${clip.path}`,
          clip.disabled ? '状态：已停用' : '',
        ].filter(Boolean).join('；');
      }
      if (item.type === 'fx') {
        const clip = state.fxClips.find((x) => x.id === item.id);
        if (!clip) return `${index + 1}. fx:${item.id}（已找不到）`;
        return [
          `${index + 1}. 特效 fx:${clip.id}`,
          `名称：${clip.label}`,
          `时间轴：${clip.startSec.toFixed(2)}-${(clip.startSec + clip.duration).toFixed(2)}s`,
          clip.componentId ? `组件：${clip.componentId}` : '',
          clip.disabled ? '状态：已停用' : '',
        ].filter(Boolean).join('；');
      }
      if (item.type === 'text') {
        const clip = state.textClips.find((x) => x.id === item.id);
        if (!clip) return `${index + 1}. text:${item.id}（已找不到）`;
        return [
          `${index + 1}. 花字 text:${clip.id}`,
          `内容：${clip.text.slice(0, 120)}`,
          `时间轴：${clip.startSec.toFixed(2)}-${clip.endSec.toFixed(2)}s`,
          `位置：${clip.position}`,
          clip.disabled ? '状态：已停用' : '',
        ].filter(Boolean).join('；');
      }
      if (item.type === 'subtitle') {
        const cue = state.subtitles.find((x) => x.id === item.id);
        if (!cue) return `${index + 1}. subtitle:${item.id}（已找不到）`;
        return [
          `${index + 1}. 字幕 subtitle:${cue.id}`,
          `内容：${cue.text.slice(0, 120)}`,
          `时间轴：${cue.startSec.toFixed(2)}-${cue.endSec.toFixed(2)}s`,
          cue.disabled ? '状态：已停用' : '',
        ].filter(Boolean).join('；');
      }
      const clip = state.audioClips.find((x) => x.id === item.id);
      if (!clip) return `${index + 1}. audio:${item.id}（已找不到）`;
      const duration = Math.max(0.2, (clip.outSec - clip.inSec) || clip.duration);
      return [
        `${index + 1}. 音频 audio:${clip.id}`,
        `名称：${clip.label}`,
        `时间轴：${clip.startSec.toFixed(2)}-${(clip.startSec + duration).toFixed(2)}s`,
        `素材：${clip.path}`,
        `音量：${Math.round((clip.volume ?? 1) * 100)}%`,
        clip.disabled ? '状态：已停用' : '',
      ].filter(Boolean).join('；');
    }).join('\n');
  }, [getTimelineItemStart]);

  const promptAiForItems = useCallback((items: TimelineSelectionItem[], mode: 'generate' | 'roughCut') => {
    if (items.length === 0) return;
    const itemSummary = describeTimelineItems(items);
    if (mode === 'roughCut') {
      dispatchEditorPrompt(`[时间轴右键 · 智能粗剪]
我选中了 ${items.length} 个主视频片段，请基于这些片段做一次剪映式智能粗剪。

选中片段：
${itemSummary}

要求：
1. 先调用 timeline_get_state 核对当前时间轴；需要逐字稿时优先用整段/片段转写工具，不要凭空判断内容。
2. 先输出剪辑计划卡片，不要直接改时间轴。目标是删冗余、删明显废话、保留信息完整和语气自然。
3. 如果识别到口播重复、口误、无字幕无人声空白段，请说明证据和建议处理方式。
4. 需要真正应用时，再等我确认后调用 timeline_apply_plan 或对应时间轴工具。`);
      setContextMenu(null);
      return;
    }
    dispatchEditorPrompt(`[时间轴右键 · AI生成]
我选中了 ${items.length} 个时间轴元素，请围绕这些元素生成合适的剪辑增强方案。

选中元素：
${itemSummary}

请先调用 timeline_get_state 核对状态，再根据元素类型选择工具：
- 主视频/视频轨：可补花字、页面、MG 动画、转场、音效或节奏点。
- 字幕/花字：可做更清晰的文字包装，但不要遮挡主体。
- 特效/页面：可优化 HTML/CSS 动效和构图。
- 音频：可加字幕、节奏点、音效或音量建议。

先说明你准备加什么、加在哪个时间段；涉及改时间轴时优先给计划，复杂变更等我确认。`);
    setContextMenu(null);
  }, [describeTimelineItems]);

  const promptMgForItems = useCallback((items: TimelineSelectionItem[]) => {
    if (items.length === 0) return;
    const state = useEditorStore.getState();
    const videoItems = items.map((item, index) => {
      const start = getTimelineItemStart(item);
      if (item.type === 'main') {
        const clip = state.clips.find((x) => x.id === item.id);
        if (!clip) return null;
        const duration = state.clipLength(clip);
        const trimHint = duration > 15.08
          ? '需要二次裁切：H3/Mini 最长 15 秒，Omni 固定 10 秒'
          : duration > 10.08
            ? '时长提示：选择 Omni 需裁到 10 秒；H3/Mini 可保留到 15 秒'
            : '当前片段可直接用于 H3/Mini；Omni 会按固定 10 秒生成';
        return [
          `${index + 1}. 主视频 main:${clip.id}`,
          `名称：${clip.label}`,
          `时间轴：${start.toFixed(2)}-${(start + duration).toFixed(2)}s`,
          `当前有效时长：${duration.toFixed(2)}s`,
          `源素材：${clip.path}`,
          `源入出点：${clip.inSec.toFixed(2)}-${clip.outSec.toFixed(2)}s`,
          trimHint,
        ].join('；');
      }
      if (item.type === 'overlay') {
        const clip = state.overlayClips.find((x) => x.id === item.id);
        if (!clip || clip.kind !== 'video') return null;
        const duration = Math.max(0.2, clip.outSec - clip.inSec);
        const trimHint = duration > 15.08
          ? '需要二次裁切：H3/Mini 最长 15 秒，Omni 固定 10 秒'
          : duration > 10.08
            ? '时长提示：选择 Omni 需裁到 10 秒；H3/Mini 可保留到 15 秒'
            : '当前片段可直接用于 H3/Mini；Omni 会按固定 10 秒生成';
        return [
          `${index + 1}. 视频轨 ${clip.trackIndex + 2} overlay:${clip.id}`,
          `名称：${clip.label}`,
          `时间轴：${clip.startSec.toFixed(2)}-${(clip.startSec + duration).toFixed(2)}s`,
          `当前有效时长：${duration.toFixed(2)}s`,
          `素材：${clip.path}`,
          `源入出点：${clip.inSec.toFixed(2)}-${clip.outSec.toFixed(2)}s`,
          trimHint,
        ].join('；');
      }
      return null;
    }).filter(Boolean);

    if (videoItems.length === 0) return;
    dispatchEditorPrompt(`[时间轴右键 · MG动画]
我选中了 ${videoItems.length} 个视频片段，想做 MG 动画设计。你现在不要直接生成，不要调用 timeline_omni_mg_plan，也不要调用 timeline_omni_mg_generate 或 batch。旧工具名只是兼容名称，不代表强制使用 Omni。

选中片段：
${videoItems.join('\n')}

请先调用 timeline_get_state 核对时间轴，然后第一轮只问我一个选择题：
“你要网页特效（便宜、可编辑、走 HTML/Scene），还是付费 MG 动画（AI 视频生成）？”

第一轮不要问风格，也不要问“花字类型/视频生MG还是纯MG动画/文字生”。

如果我选网页特效，再按普通网页/Scene 工作流继续问风格和设计方向。

如果我选付费 MG 动画，第二轮再做这几件事：
1. 用 Omni版MG动画 skill 里的精选风格给我 2-3 个适合这段素材的高级动效方向，不要调用普通 AE/网页动效引擎的风格。
2. 必须问我使用哪个引擎：MiniMax H3（推荐，2K、5-15秒）、Omni（720p、固定10秒）或 Seedance Mini（4-15秒）；如果我不选才默认 H3，禁止调用 Seedance 2.0 普通版。
3. 必须问我是“花字类型 / 视频生 MG”（传入这段视频做图形包装，保留原画面、人物、人脸、口型、动作和声音），还是“纯 MG 动画 / 文字生”（不传入视频，只根据文案生成）。
4. 按所选引擎判断是否需要二次裁切，并清楚告诉我目标时长。
5. 只有我确认引擎、风格、类型和是否裁切后，才允许进入 timeline_omni_mg_plan；进入时 source 用 timeline_transcript、传 engine，并且必须把上面“主视频 main:xxx”里的 xxx 传给 clip_id，只规划选中的片段（选中多个主视频则逐个 clip_id 分别规划），绝不许从整个视频的第一句开始规划。再次确认方案后必须优先用 timeline_omni_mg_generate_batch 并行生成并传同一个 engine，不要逐条串行生成。`);
    setContextMenu(null);
  }, [getTimelineItemStart]);

  const saveItemsAsPreset = useCallback(async (items: TimelineSelectionItem[]) => {
    const targets = items.filter((item) => item.type === 'text' || item.type === 'fx');
    if (targets.length === 0 || targets.length !== items.length) {
      await tauriMessage('请选择花字或特效后再保存为预设。', { title: '我的预设', type: 'info' }).catch(() => {});
      setContextMenu(null);
      return;
    }
    const state = useEditorStore.getState();
    let saved = 0;
    for (const item of targets) {
      if (item.type === 'text') {
        const clip = state.textClips.find((x) => x.id === item.id);
        if (!clip) continue;
        saveCustomTextPreset(clip);
        saved += 1;
      } else {
        const clip = state.fxClips.find((x) => x.id === item.id);
        if (!clip) continue;
        saveCustomFxPreset(clip);
        saved += 1;
      }
    }
    await tauriMessage(
      saved > 0 ? `已保存 ${saved} 个预设，可在左侧花字/特效里继续使用。` : '没有可保存的花字或特效。',
      { title: '我的预设', type: saved > 0 ? 'info' : 'warning' },
    ).catch(() => {});
    setContextMenu(null);
  }, []);

  const recognizeSubtitlesForItems = useCallback(async (items: TimelineSelectionItem[]) => {
    const targets = selectedMainClipContexts(items);
    if (targets.length === 0 || targets.length !== items.length) {
      await tauriMessage('请先选择主视频轨上的片段，再识别字幕。', { title: '识别字幕', type: 'info' }).catch(() => {});
      return;
    }
    const store = useEditorStore.getState();
    if (store.transcribing) return;
    store.setTranscribing(true);
    try {
      const { transcribeFileRange } = await import('@/lib/editor/transcribe');
      const nextCues: SubtitleCue[] = [];
      for (const target of targets) {
        const speed = target.clip.speed ?? 1;
        const sourceDur = Math.max(0.2, target.clip.outSec - target.clip.inSec);
        const cues = await transcribeFileRange(target.clip.path, target.clip.inSec, sourceDur);
        cues.forEach((cue) => {
          const mappedStart = target.timelineStart + Math.max(0, cue.startSec - target.clip.inSec) / speed;
          const mappedEnd = target.timelineStart + Math.max(0.1, cue.endSec - target.clip.inSec) / speed;
          if (mappedEnd <= target.timelineStart || mappedStart >= target.timelineEnd) return;
          nextCues.push({
            id: `sub-${nanoid(6)}`,
            startSec: Math.max(target.timelineStart, mappedStart),
            endSec: Math.min(target.timelineEnd, mappedEnd),
            text: cue.text,
          });
        });
      }
      if (nextCues.length === 0) {
        await tauriMessage('没有识别到字幕内容。', { title: '识别字幕', type: 'info' }).catch(() => {});
        return;
      }
      captureEditorSnapshot();
      useEditorStore.setState((cur) => ({
        subtitles: [
          ...cur.subtitles.filter((cue) => !targets.some((target) => cue.startSec < target.timelineEnd && cue.endSec > target.timelineStart)),
          ...nextCues,
        ].sort((a, b) => a.startSec - b.startSec),
      }));
      await tauriMessage(`已生成 ${nextCues.length} 条字幕。`, { title: '识别字幕', type: 'info' }).catch(() => {});
    } catch (err) {
      await tauriMessage(err instanceof Error ? err.message : String(err), { title: '识别字幕失败', type: 'error' }).catch(() => {});
    } finally {
      useEditorStore.getState().setTranscribing(false);
      setContextMenu(null);
    }
  }, [selectedMainClipContexts]);

  const separateAudioForItems = useCallback(async (items: TimelineSelectionItem[]) => {
    const targets = selectedMainClipContexts(items);
    if (targets.length === 0 || targets.length !== items.length) {
      await tauriMessage('请先选择主视频轨上的片段，再分离音频。', { title: '分离音频', type: 'info' }).catch(() => {});
      return;
    }
    const ffmpeg = await detectFfmpeg();
    if (!ffmpeg) {
      await tauriMessage('未检测到 ffmpeg。请先安装（macOS: brew install ffmpeg；Windows: winget install ffmpeg）', { title: '分离音频失败', type: 'error' }).catch(() => {});
      return;
    }
    try {
      const workspace = await invoke<string>('ensure_workspace');
      const outDir = `${workspace}/audio`;
      const mkdir = await invoke<{ exit_code: number; stderr: string; stdout: string }>('execute_command', {
        command: `mkdir -p ${shq(outDir)}`,
        timeoutMs: 15000,
      });
      if (mkdir.exit_code !== 0) throw new Error(mkdir.stderr || mkdir.stdout || `创建音频目录失败：${outDir}`);
      captureEditorSnapshot();
      const added: string[] = [];
      for (const target of targets) {
        const outPath = `${outDir}/separated_${Date.now()}_${target.clip.id}.m4a`;
        const start = target.clip.inSec;
        const dur = Math.max(0.2, target.clip.outSec - target.clip.inSec);
        const cmd = [
          ffmpeg,
          '-y',
          '-ss', start.toFixed(3),
          '-i', shq(target.clip.path),
          '-t', dur.toFixed(3),
          '-vn',
          '-c:a aac',
          '-b:a 192k',
          shq(outPath),
        ].join(' ');
        const r = await invoke<{ exit_code: number; stderr: string; stdout: string }>('execute_command', {
          command: cmd,
          timeoutMs: Math.max(60000, dur * 4000),
        });
        if (r.exit_code !== 0) throw new Error(r.stderr || r.stdout || 'ffmpeg 分离音频失败');
        const id = await useEditorStore.getState().addAudioClip('voice', {
          path: outPath,
          label: `${target.clip.label} 音频`,
          startSec: target.timelineStart,
          loop: false,
          volume: 1,
        });
        added.push(id);
      }
      setMultiSelected(added.map((id) => ({ type: 'audio', id })));
      selectFirstTimelineItem(added[0] ? { type: 'audio', id: added[0] } : undefined);
      await tauriMessage(`已分离 ${added.length} 条音频。`, { title: '分离音频', type: 'info' }).catch(() => {});
    } catch (err) {
      await tauriMessage(err instanceof Error ? err.message : String(err), { title: '分离音频失败', type: 'error' }).catch(() => {});
    } finally {
      setContextMenu(null);
    }
  }, [selectedMainClipContexts]);

  const smartSplitScenesForItems = useCallback(async (items: TimelineSelectionItem[]) => {
    const targets = selectedMainClipContexts(items);
    if (targets.length === 0 || targets.length !== items.length) {
      await tauriMessage('请先选择主视频轨上的片段，再做智能镜头分割。', { title: '智能镜头分割', type: 'info' }).catch(() => {});
      return;
    }
    const ffmpeg = await detectFfmpeg();
    if (!ffmpeg) {
      await tauriMessage('未检测到 ffmpeg。请先安装（macOS: brew install ffmpeg；Windows: winget install ffmpeg）', { title: '智能镜头分割失败', type: 'error' }).catch(() => {});
      return;
    }
    try {
      const cutMap = new Map<string, number[]>();
      for (const target of targets) {
        const cmd = [
          ffmpeg,
          '-hide_banner -nostdin',
          '-i', shq(target.clip.path),
          `-vf "select='gt(scene,0.28)',showinfo"`,
          '-an -f null - 2>&1',
        ].join(' ');
        const r = await invoke<CommandResult>('execute_command', {
          command: cmd,
          timeoutMs: Math.max(45000, Math.min(240000, target.clip.duration * 2500)),
        });
        const raw = `${r.stdout}\n${r.stderr}`;
        const cuts = [...raw.matchAll(/pts_time:([0-9.]+)/g)]
          .map((m) => Number(m[1]))
          .filter((t) => Number.isFinite(t))
          .filter((t) => t > target.clip.inSec + 0.35 && t < target.clip.outSec - 0.35)
          .sort((a, b) => a - b)
          .filter((t, idx, arr) => idx === 0 || t - arr[idx - 1] >= 0.55)
          .slice(0, 120);
        if (cuts.length > 0) cutMap.set(target.clip.id, cuts);
      }
      const totalCuts = [...cutMap.values()].reduce((sum, cuts) => sum + cuts.length, 0);
      if (totalCuts === 0) {
        await tauriMessage('没有检测到明显镜头切点。可以手动分割，或换一个画面变化更明显的片段。', { title: '智能镜头分割', type: 'info' }).catch(() => {});
        return;
      }
      captureEditorSnapshot();
      const created: TimelineSelectionItem[] = [];
      useEditorStore.setState((cur) => {
        const next: EditorClip[] = [];
        for (const clip of cur.clips) {
          const cuts = cutMap.get(clip.id);
          if (!cuts?.length) {
            next.push(clip);
            continue;
          }
          const boundaries = [clip.inSec, ...cuts, clip.outSec]
            .filter((t, idx, arr) => idx === 0 || t - arr[idx - 1] >= 0.1);
          for (let i = 0; i < boundaries.length - 1; i += 1) {
            const id = i === 0 ? clip.id : `clip-${nanoid(6)}`;
            const segment: EditorClip = {
              ...clip,
              id,
              label: `${clip.label} · 镜头${i + 1}`,
              inSec: boundaries[i],
              outSec: boundaries[i + 1],
              transitionAfter: { type: 'cut', duration: 0 },
            };
            next.push(segment);
            created.push({ type: 'main', id });
          }
        }
        return { clips: next, selectedClipId: created[0]?.id ?? cur.selectedClipId };
      });
      setMultiSelected(created);
      selectFirstTimelineItem(created[0]);
      await tauriMessage(`已按画面变化切出 ${totalCuts + targets.length} 个镜头。`, { title: '智能镜头分割', type: 'info' }).catch(() => {});
    } catch (err) {
      await tauriMessage(err instanceof Error ? err.message : String(err), { title: '智能镜头分割失败', type: 'error' }).catch(() => {});
    } finally {
      setContextMenu(null);
    }
  }, [selectedMainClipContexts]);

  const copyItemsToClipboard = useCallback((items: TimelineSelectionItem[]) => {
    if (items.length === 0) return;
    const state = useEditorStore.getState();
    const selected = new Set(items.map(selectionKey));
    const payload: TimelineClipboardPayload[] = [];
    state.clips.forEach((clip) => {
      if (selected.has(`main:${clip.id}`)) payload.push({ type: 'main', start: getTimelineItemStart({ type: 'main', id: clip.id }), data: cloneJson(clip) as unknown as Record<string, unknown> });
    });
    state.fxClips.forEach((clip) => {
      if (selected.has(`fx:${clip.id}`)) payload.push({ type: 'fx', start: clip.startSec, data: cloneJson(clip) as unknown as Record<string, unknown> });
    });
    state.textClips.forEach((clip) => {
      if (selected.has(`text:${clip.id}`)) payload.push({ type: 'text', start: clip.startSec, data: cloneJson(clip) as unknown as Record<string, unknown> });
    });
    state.overlayClips.forEach((clip) => {
      if (selected.has(`overlay:${clip.id}`)) payload.push({ type: 'overlay', start: clip.startSec, data: cloneJson(clip) as unknown as Record<string, unknown> });
    });
    state.subtitles.forEach((cue) => {
      if (selected.has(`subtitle:${cue.id}`)) payload.push({ type: 'subtitle', start: cue.startSec, data: cloneJson(cue) as unknown as Record<string, unknown> });
    });
    state.audioClips.forEach((clip) => {
      if (selected.has(`audio:${clip.id}`)) payload.push({ type: 'audio', start: clip.startSec, data: cloneJson(clip) as unknown as Record<string, unknown> });
    });
    setTimelineClipboard(payload.sort((a, b) => a.start - b.start));
    setContextMenu(null);
  }, [getTimelineItemStart]);

  const pasteTimelineClipboard = useCallback(() => {
    if (timelineClipboard.length === 0) return;
    const state = useEditorStore.getState();
    const pasteAt = state.playheadSec;
    const minStart = Math.min(...timelineClipboard.map((item) => item.start));
    const copied: TimelineSelectionItem[] = [];
    captureEditorSnapshot();
    useEditorStore.setState((cur) => {
      let cursor = 0;
      let insertIndex = cur.clips.length;
      for (let i = 0; i < cur.clips.length; i += 1) {
        const len = cur.clipLength(cur.clips[i]);
        if (pasteAt <= cursor + len / 2) {
          insertIndex = i;
          break;
        }
        cursor += len;
      }

      const mainCopies = timelineClipboard
        .filter((item) => item.type === 'main')
        .map((item) => {
          const source = item.data as unknown as EditorClip;
          const id = `clip-${nanoid(6)}`;
          copied.push({ type: 'main', id });
          return { ...source, id, label: `${source.label} 副本` };
        });
      const nextClips = [...cur.clips];
      nextClips.splice(insertIndex, 0, ...mainCopies);

      const at = (item: TimelineClipboardPayload) => Math.max(0, pasteAt + item.start - minStart);
      const fxCopies = timelineClipboard
        .filter((item) => item.type === 'fx')
        .map((item) => {
          const source = item.data as unknown as FxClip;
          const id = `fx-${nanoid(6)}`;
          copied.push({ type: 'fx', id });
          return { ...source, id, label: `${source.label} 副本`, startSec: at(item), renderCachePath: undefined, contentHash: undefined };
        });
      const textCopies = timelineClipboard
        .filter((item) => item.type === 'text')
        .map((item) => {
          const source = item.data as unknown as TextClip;
          const id = `txt-${nanoid(6)}`;
          const startSec = at(item);
          copied.push({ type: 'text', id });
          return { ...source, id, startSec, endSec: startSec + Math.max(0.2, source.endSec - source.startSec), renderCachePath: undefined, contentHash: undefined };
        });
      const overlayCopies = timelineClipboard
        .filter((item) => item.type === 'overlay')
        .map((item) => {
          const source = item.data as unknown as OverlayClip;
          const id = `ovl-${nanoid(6)}`;
          copied.push({ type: 'overlay', id });
          return { ...source, id, label: `${source.label} 副本`, startSec: at(item), keyframes: source.keyframes?.map((kf) => ({ ...kf })) };
        });
      const subtitleCopies = timelineClipboard
        .filter((item) => item.type === 'subtitle')
        .map((item) => {
          const source = item.data as unknown as SubtitleCue;
          const id = `sub-${nanoid(6)}`;
          const startSec = at(item);
          copied.push({ type: 'subtitle', id });
          return { ...source, id, startSec, endSec: startSec + Math.max(0.1, source.endSec - source.startSec) };
        });
      const audioCopies = timelineClipboard
        .filter((item) => item.type === 'audio')
        .map((item) => {
          const source = item.data as unknown as AudioClip;
          const id = `aclip-${nanoid(6)}`;
          copied.push({ type: 'audio', id });
          return { ...source, id, label: `${source.label} 副本`, startSec: at(item) };
        });

      return {
        clips: nextClips,
        fxClips: [...cur.fxClips, ...fxCopies].sort((a, b) => a.startSec - b.startSec),
        textClips: [...cur.textClips, ...textCopies].sort((a, b) => a.startSec - b.startSec),
        overlayClips: [...cur.overlayClips, ...overlayCopies],
        subtitles: [...cur.subtitles, ...subtitleCopies].sort((a, b) => a.startSec - b.startSec),
        audioClips: [...cur.audioClips, ...audioCopies],
      };
    });
    setMultiSelected(copied);
    selectFirstTimelineItem(copied[0]);
    setContextMenu(null);
  }, [timelineClipboard]);

  const selectRangeAtPlayhead = useCallback((direction: TimelineSelectRangeDirection) => {
    const store = useEditorStore.getState();
    const at = store.playheadSec;
    const next: TimelineSelectionItem[] = [];
    const add = (type: SelectableTrackType, id: string, start: number, end: number) => {
      const inRange = direction === 'left' ? end <= at + 0.001 : start >= at - 0.001;
      if (!inRange) return;
      next.push({ type, id });
    };

    let cursor = 0;
    for (const clip of store.clips) {
      const len = store.clipLength(clip);
      add('main', clip.id, cursor, cursor + len);
      cursor += len;
    }
    store.fxClips.forEach((clip) => add('fx', clip.id, clip.startSec, clip.startSec + clip.duration));
    store.textClips.forEach((clip) => add('text', clip.id, clip.startSec, clip.endSec));
    store.overlayClips.forEach((clip) => add('overlay', clip.id, clip.startSec, clip.startSec + Math.max(0.2, clip.outSec - clip.inSec)));
    store.subtitles.forEach((cue) => add('subtitle', cue.id, cue.startSec, cue.endSec));
    store.audioClips.forEach((clip) => add('audio', clip.id, clip.startSec, clip.startSec + Math.max(0.2, (clip.outSec - clip.inSec) || clip.duration)));

    setMultiSelected(next);
    selectFirstTimelineItem(next[0]);
  }, []);

  useEffect(() => {
    const onSelectRange = (event: Event) => {
      const direction = (event as CustomEvent<{ direction?: TimelineSelectRangeDirection }>).detail?.direction;
      if (direction === 'left' || direction === 'right') selectRangeAtPlayhead(direction);
    };
    window.addEventListener(TIMELINE_SELECT_RANGE_EVENT, onSelectRange);
    return () => window.removeEventListener(TIMELINE_SELECT_RANGE_EVENT, onSelectRange);
  }, [selectRangeAtPlayhead]);

  const clearSelectionTimer = useCallback(() => {
    if (selectionTimer.current != null) {
      window.clearTimeout(selectionTimer.current);
      selectionTimer.current = null;
    }
  }, []);

  const handleTrackPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-clip-id], button, input, [data-no-box-select]')) return;
    clearSelectionTimer();
    const startX = e.clientX;
    const startY = e.clientY;
    selectingRef.current = false;
    selectionTimer.current = window.setTimeout(() => {
      selectingRef.current = true;
      setSelectionBox({ active: true, startX, startY, x: startX, y: startY });
      setMultiSelected([]);
    }, 220);
  }, [clearSelectionTimer]);

  const handleTrackPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!selectingRef.current) return;
    setSelectionBox((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : prev));
  }, []);

  const handleTrackPointerUp = useCallback(() => {
    clearSelectionTimer();
    if (selectingRef.current) {
      setSelectionBox((prev) => {
        if (prev) commitBoxSelection(prev);
        return null;
      });
    }
    selectingRef.current = false;
  }, [clearSelectionTimer, commitBoxSelection]);

  const deleteItems = useCallback((items: TimelineSelectionItem[]) => {
    if (items.length === 0) return;
    captureEditorSnapshot();
    const groups = new Map<SelectableTrackType, Set<string>>();
    items.forEach((item) => {
      const setForType = groups.get(item.type) ?? new Set<string>();
      setForType.add(item.id);
      groups.set(item.type, setForType);
    });
    useEditorStore.setState((cur) => ({
      clips: cur.clips.filter((c) => !groups.get('main')?.has(c.id)),
      fxClips: cur.fxClips.filter((c) => !groups.get('fx')?.has(c.id)),
      textClips: cur.textClips.filter((c) => !groups.get('text')?.has(c.id)),
      overlayClips: cur.overlayClips.filter((c) => !groups.get('overlay')?.has(c.id)),
      subtitles: cur.subtitles.filter((c) => !groups.get('subtitle')?.has(c.id)),
      audioClips: cur.audioClips.filter((c) => !groups.get('audio')?.has(c.id)),
      selectedClipId: groups.get('main')?.has(cur.selectedClipId ?? '') ? null : cur.selectedClipId,
      selectedFxId: groups.get('fx')?.has(cur.selectedFxId ?? '') ? null : cur.selectedFxId,
      selectedTextId: groups.get('text')?.has(cur.selectedTextId ?? '') ? null : cur.selectedTextId,
      selectedOverlayId: groups.get('overlay')?.has(cur.selectedOverlayId ?? '') ? null : cur.selectedOverlayId,
      selectedSubtitleId: groups.get('subtitle')?.has(cur.selectedSubtitleId ?? '') ? null : cur.selectedSubtitleId,
      selectedAudioClipId: groups.get('audio')?.has(cur.selectedAudioClipId ?? '') ? null : cur.selectedAudioClipId,
    }));
    setMultiSelected((prev) => prev.filter((item) => !groups.get(item.type)?.has(item.id)));
    setContextMenu(null);
  }, []);

  const deleteMultiSelected = useCallback(() => {
    deleteItems(multiSelected);
  }, [deleteItems, multiSelected]);

  const copyMultiSelected = useCallback(() => {
    copyItemsToClipboard(multiSelected);
  }, [copyItemsToClipboard, multiSelected]);

  const toggleDisabledItems = useCallback((items: TimelineSelectionItem[]) => {
    if (items.length === 0) return;
    const state = useEditorStore.getState();
    const disabledOf = (item: TimelineSelectionItem) => {
      if (item.type === 'main') return Boolean(state.clips.find((x) => x.id === item.id)?.disabled);
      if (item.type === 'fx') return Boolean(state.fxClips.find((x) => x.id === item.id)?.disabled);
      if (item.type === 'text') return Boolean(state.textClips.find((x) => x.id === item.id)?.disabled);
      if (item.type === 'overlay') return Boolean(state.overlayClips.find((x) => x.id === item.id)?.disabled);
      if (item.type === 'subtitle') return Boolean(state.subtitles.find((x) => x.id === item.id)?.disabled);
      return Boolean(state.audioClips.find((x) => x.id === item.id)?.disabled);
    };
    const nextDisabled = !items.every(disabledOf);
    const keys = new Set(items.map(selectionKey));
    captureEditorSnapshot();
    useEditorStore.setState((cur) => ({
      clips: cur.clips.map((x) => (keys.has(`main:${x.id}`) ? { ...x, disabled: nextDisabled } : x)),
      fxClips: cur.fxClips.map((x) => (keys.has(`fx:${x.id}`) ? { ...x, disabled: nextDisabled, renderCachePath: undefined, contentHash: undefined } : x)),
      textClips: cur.textClips.map((x) => (keys.has(`text:${x.id}`) ? { ...x, disabled: nextDisabled, renderCachePath: undefined, contentHash: undefined } : x)),
      overlayClips: cur.overlayClips.map((x) => (keys.has(`overlay:${x.id}`) ? { ...x, disabled: nextDisabled } : x)),
      subtitles: cur.subtitles.map((x) => (keys.has(`subtitle:${x.id}`) ? { ...x, disabled: nextDisabled } : x)),
      audioClips: cur.audioClips.map((x) => (keys.has(`audio:${x.id}`) ? { ...x, disabled: nextDisabled } : x)),
    }));
    setContextMenu(null);
  }, []);

  const cutItems = useCallback((items: TimelineSelectionItem[]) => {
    if (items.length === 0) return;
    copyItemsToClipboard(items);
    deleteItems(items);
  }, [copyItemsToClipboard, deleteItems]);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const node = (e.target as HTMLElement).closest<HTMLElement>('[data-clip-id][data-track-type]');
    if (!node) return;
    const item = itemFromElement(node);
    if (!item) return;
    e.preventDefault();
    e.stopPropagation();
    if (!multiSelectedKeys.has(selectionKey(item))) setMultiSelected([item]);
    selectFirstTimelineItem(item);
    setContextMenu({ x: e.clientX, y: e.clientY, item });
  }, [multiSelectedKeys]);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    if (!contextMenu) return undefined;
    window.addEventListener('pointerdown', closeContextMenu);
    window.addEventListener('keydown', closeContextMenu);
    return () => {
      window.removeEventListener('pointerdown', closeContextMenu);
      window.removeEventListener('keydown', closeContextMenu);
    };
  }, [closeContextMenu, contextMenu]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"], [data-kunpeng-ai-input="true"]')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c' && document.getSelection()?.toString()) return;
      if (multiSelected.length > 0 && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        deleteMultiSelected();
      } else if (multiSelected.length > 0 && (e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        copyItemAttributes(multiSelected[0]);
      } else if (multiSelected.length > 0 && (e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        pasteItemAttributes(multiSelected);
      } else if (multiSelected.length > 0 && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        copyMultiSelected();
      } else if (multiSelected.length > 0 && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        cutItems(multiSelected);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        pasteTimelineClipboard();
      } else if (multiSelected.length > 0 && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        toggleDisabledItems(multiSelected);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [copyItemAttributes, copyMultiSelected, cutItems, deleteMultiSelected, multiSelected, multiSelected.length, pasteItemAttributes, pasteTimelineClipboard, toggleDisabledItems]);

  // 音频轨按 bgm/sfx/voice 固定排序
  const orderedAudio = (['bgm', 'sfx', 'voice'] as const)
    .map((k) => audioTracks.find((t) => t.kind === k))
    .filter((t): t is NonNullable<typeof t> => Boolean(t));

  const ticks: number[] = [];
  for (let t = 0; t <= Math.ceil(total) + 2; t++) ticks.push(t);

  const laneRows: { key?: TimelineTrackKey; label: string; height: number; mute?: { trackId: string; muted: boolean } }[] = [
    { key: 'fx', label: '特效', height: getTrackHeight('fx') },
    { key: 'text', label: '花字', height: getTrackHeight('text') },
    { key: 'overlay-0', label: '视频轨 2', height: getTrackHeight('overlay-0') },
    { key: 'overlay-1', label: '视频轨 3', height: getTrackHeight('overlay-1') },
    { key: 'main', label: '视频轨 1', height: getTrackHeight('main') },
    { key: 'subtitle', label: '字幕', height: getTrackHeight('subtitle') },
    ...orderedAudio.map((t) => ({
      key: `audio-${t.kind}` as TimelineTrackKey,
      label: t.kind === 'bgm' ? 'BGM' : t.kind === 'sfx' ? '音效' : '旁白',
      height: getTrackHeight(`audio-${t.kind}` as TimelineTrackKey),
      mute: { trackId: t.id, muted: t.muted },
    })),
  ];
  const zoomPct = Math.max(0, Math.min(100, ((zoom - 10) / 150) * 100));

  return (
    <div className="shrink-0 border-t border-[var(--canvas-node-border)] select-none flex flex-col" style={{ background: 'var(--canvas-panel)', height }}>
      {/* 控制行 */}
      <div className="flex items-center gap-2 px-3 h-7 border-b border-[rgba(255,255,255,0.045)] shrink-0">
        <span className="text-[11px] font-medium text-[var(--canvas-text-2)]">时间轴</span>
        <span className="text-[10px] font-mono text-[var(--canvas-text-3)]">{playheadSec.toFixed(2)}s / {total.toFixed(1)}s</span>
        <div className="flex-1" />
        <span className="text-[9px] text-[var(--canvas-text-3)]">缩放</span>
        <input
          type="range" min={10} max={160} value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="kunpeng-prop-slider w-28"
          style={{ background: `linear-gradient(90deg, rgba(255,255,255,0.92) ${zoomPct}%, rgba(255,255,255,0.16) ${zoomPct}%)` }}
        />
      </div>

      {/* 标尺行：固定在纵向滚动区外，任何滚动位置都能点击/拖动播放头；横向与轨道区同步 */}
      <div className="flex shrink-0" style={{ marginBottom: GAP }}>
        <div className="shrink-0 border-r border-[rgba(255,255,255,0.05)]" style={{ width: GUTTER_W }} />
        <div
          ref={rulerScrollRef}
          className="flex-1 overflow-hidden relative"
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragLeave={handleDragLeave}
        >
          {/* 标尺 + 踩点 + 播放头拖拽 */}
          <div
            className="relative cursor-pointer border-b border-[rgba(255,255,255,0.05)]"
            data-no-box-select
            style={{ height: H.ruler, width: trackWidth }}
            onPointerDown={(e) => {
              scrubbing.current = true;
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              setPlayhead(posToSec(e.clientX));
            }}
            onPointerMove={(e) => { if (scrubbing.current) setPlayhead(posToSec(e.clientX)); }}
            onPointerUp={() => { scrubbing.current = false; }}
          >
            {ticks.map((t) => (
              <div key={t} className="absolute top-0 h-full pointer-events-none" style={{ left: t * zoom }}>
                <div className="w-px h-2 bg-[var(--canvas-text-3)]" />
                {t % (zoom < 25 ? 5 : 1) === 0 && (
                  <span className="absolute top-2 left-0.5 text-[8px] text-[var(--canvas-text-3)] font-mono">{t}s</span>
                )}
              </div>
            ))}
            {markers.map((m) => (
              <button
                key={m}
                onClick={(e) => { e.stopPropagation(); removeMarker(m); }}
                onPointerDown={(e) => e.stopPropagation()}
                className="absolute -bottom-0.5 w-2 h-2 rotate-45 bg-[#e8c060] hover:scale-125 transition-transform"
                style={{ left: m * zoom - 4 }}
                title={`踩点 ${m.toFixed(2)}s（点击删除）`}
              />
            ))}
            {/* 播放头（标尺段） */}
            <div className="absolute top-0 bottom-0 w-px pointer-events-none z-10" style={{ left: playheadSec * zoom, background: '#ffffff' }}>
              <div className="w-2.5 h-2.5 -ml-[5px] rotate-45 bg-white" />
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex overflow-y-auto">
        {/* gutter 轨道名（不随横向滚动） */}
        <div className="shrink-0 border-r border-[rgba(255,255,255,0.05)]" style={{ width: GUTTER_W }}>
          {laneRows.map((row, i) => (
            <div key={i} className="relative flex items-center justify-between pl-2.5 pr-1.5" style={{ height: row.height, marginBottom: GAP }}>
              <span className="text-[10px] text-[var(--canvas-text-3)] truncate">{row.label}</span>
              <div className="flex items-center gap-0.5">
              {row.key && (
                <TrackStateButtons
                  trackKey={row.key}
                  locked={Boolean(trackStates[row.key]?.locked)}
                  hidden={Boolean(trackStates[row.key]?.hidden)}
                  onPatch={(patch) => setTrackState(row.key!, patch)}
                />
              )}
              {row.mute && (
                <button
                  onClick={() => setTrackMuted(row.mute!.trackId, !row.mute!.muted)}
                  className="p-0.5 rounded text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-1)]"
                  title={row.mute.muted ? '取消静音' : '静音此轨'}
                >
                  {row.mute.muted ? <VolumeX size={10} /> : <Volume2 size={10} />}
                </button>
              )}
              </div>
              {row.key && (
                <div
                  onMouseDown={(e) => startResizeTrack(e, row.key!)}
                  className="absolute left-0 right-0 bottom-[-2px] h-1 cursor-row-resize hover:bg-[rgba(0,216,230,0.35)]"
                  title="拖动调整此轨高度"
                />
              )}
            </div>
          ))}
        </div>

        {/* 轨道区（横向滚动） */}
        <div
          ref={scrollRef}
          data-timeline-scroll
          className="flex-1 overflow-x-auto overflow-y-hidden relative"
          onScroll={() => {
            const tracks = scrollRef.current;
            const ruler = rulerScrollRef.current;
            if (tracks && ruler && ruler.scrollLeft !== tracks.scrollLeft) ruler.scrollLeft = tracks.scrollLeft;
          }}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragLeave={handleDragLeave}
          onPointerDown={handleTrackPointerDown}
          onPointerMove={handleTrackPointerMove}
          onPointerUp={handleTrackPointerUp}
          onPointerCancel={handleTrackPointerUp}
          onContextMenu={handleContextMenu}
        >
          <div style={{ width: trackWidth, position: 'relative' }}>
            {dropPreview && (
              <div
                className="absolute top-0 bottom-0 w-px bg-[#20d6df] z-30 pointer-events-none shadow-[0_0_0_1px_rgba(32,214,223,0.24),0_0_14px_rgba(32,214,223,0.42)]"
                style={{ left: dropPreview.sec * zoom }}
              >
                <div className="absolute -top-0.5 -left-1.5 w-3 h-3 rounded-full bg-[#20d6df]" />
              </div>
            )}
            <FxLane clips={fxClips} zoom={zoom} height={getTrackHeight('fx')} multiSelectedKeys={multiSelectedKeys} />
            <TextLane clips={textClips} zoom={zoom} height={getTrackHeight('text')} multiSelectedKeys={multiSelectedKeys} />
            <OverlayLane clips={overlayClips} trackIndex={0} zoom={zoom} height={getTrackHeight('overlay-0')} multiSelectedKeys={multiSelectedKeys} dropPreview={dropPreview} />
            <OverlayLane clips={overlayClips} trackIndex={1} zoom={zoom} height={getTrackHeight('overlay-1')} multiSelectedKeys={multiSelectedKeys} dropPreview={dropPreview} />
            <MainTrack clips={clips} zoom={zoom} height={getTrackHeight('main')} multiSelectedKeys={multiSelectedKeys} dropPreview={dropPreview} />
            <SubtitleLane cues={subtitles} zoom={zoom} height={getTrackHeight('subtitle')} multiSelectedKeys={multiSelectedKeys} />
            {orderedAudio.map((t) => (
              <AudioLane key={t.id} trackId={t.id} muted={t.muted} clips={audioClips.filter((a) => a.trackId === t.id)} zoom={zoom} height={getTrackHeight(`audio-${t.kind}` as TimelineTrackKey)} multiSelectedKeys={multiSelectedKeys} />
            ))}
            {orderedAudio.length === 0 && (
              <div className="flex items-center px-3 rounded-md" style={{ height: defaultTrackHeight('audio-bgm'), background: LANE_BG, marginBottom: GAP }}>
                <span className="text-[9px] text-[var(--canvas-text-3)]">音频轨：在左侧「音频」tab 导入 / 录音后出现</span>
              </div>
            )}

            {/* 播放头（轨道区线段，菱形手柄在上方固定标尺行） */}
            <div className="absolute top-0 bottom-0 w-px pointer-events-none z-10" style={{ left: playheadSec * zoom, background: '#ffffff' }} />
          </div>
          {selectionBox?.active && (
            <div
              className="fixed z-[9999] pointer-events-none rounded-md border border-[#00d8e6] bg-[#00d8e6]/12"
              style={{
                left: Math.min(selectionBox.startX, selectionBox.x),
                top: Math.min(selectionBox.startY, selectionBox.y),
                width: Math.abs(selectionBox.x - selectionBox.startX),
                height: Math.abs(selectionBox.y - selectionBox.startY),
              }}
            />
          )}
          {contextMenu && (
            <TimelineContextMenuView
              x={contextMenu.x}
              y={contextMenu.y}
              count={selectedItemsFor(contextMenu.item).length}
              canPaste={timelineClipboard.length > 0}
              canPasteAttributes={Boolean(attributeClipboard && selectedItemsFor(contextMenu.item).every((item) => item.type === attributeClipboard.type))}
              canExportSelection={selectedItemsFor(contextMenu.item).length > 0 && selectedItemsFor(contextMenu.item).every((item) => item.type === 'main')}
              canMainClipAction={selectedItemsFor(contextMenu.item).length > 0 && selectedItemsFor(contextMenu.item).every((item) => item.type === 'main')}
              canMgAnimation={selectedItemsFor(contextMenu.item).length > 0 && selectedItemsFor(contextMenu.item).every((item) => {
                const state = useEditorStore.getState();
                if (item.type === 'main') return Boolean(state.clips.find((x) => x.id === item.id));
                if (item.type === 'overlay') return state.overlayClips.find((x) => x.id === item.id)?.kind === 'video';
                return false;
              })}
              canReplace={selectedItemsFor(contextMenu.item).length > 0 && selectedItemsFor(contextMenu.item).every((item) => item.type === 'main' || item.type === 'overlay')}
              canOpenMedia={Boolean(firstMediaPathForItems(selectedItemsFor(contextMenu.item)))}
              canSavePreset={selectedItemsFor(contextMenu.item).length > 0 && selectedItemsFor(contextMenu.item).every((item) => item.type === 'text' || item.type === 'fx')}
              exportingSelection={exportingSelection}
              disabled={(() => {
                const items = selectedItemsFor(contextMenu.item);
                const state = useEditorStore.getState();
                return items.length > 0 && items.every((item) => {
                  if (item.type === 'main') return Boolean(state.clips.find((x) => x.id === item.id)?.disabled);
                  if (item.type === 'fx') return Boolean(state.fxClips.find((x) => x.id === item.id)?.disabled);
                  if (item.type === 'text') return Boolean(state.textClips.find((x) => x.id === item.id)?.disabled);
                  if (item.type === 'overlay') return Boolean(state.overlayClips.find((x) => x.id === item.id)?.disabled);
                  if (item.type === 'subtitle') return Boolean(state.subtitles.find((x) => x.id === item.id)?.disabled);
                  return Boolean(state.audioClips.find((x) => x.id === item.id)?.disabled);
                });
              })()}
              onCopy={() => copyItemsToClipboard(selectedItemsFor(contextMenu.item))}
              onCut={() => cutItems(selectedItemsFor(contextMenu.item))}
              onPaste={pasteTimelineClipboard}
              onCopyAttributes={() => copyItemAttributes(contextMenu.item)}
              onPasteAttributes={() => pasteItemAttributes(selectedItemsFor(contextMenu.item))}
              onDelete={() => deleteItems(selectedItemsFor(contextMenu.item))}
              onReplace={() => void replaceItems(selectedItemsFor(contextMenu.item), '替换片段')}
              onRelinkMedia={() => void replaceItems(selectedItemsFor(contextMenu.item), '链接媒体')}
              onRevealInFinder={() => void revealItemsInFinder(selectedItemsFor(contextMenu.item))}
              onAiGenerate={() => promptAiForItems(selectedItemsFor(contextMenu.item), 'generate')}
              onMgAnimation={() => promptMgForItems(selectedItemsFor(contextMenu.item))}
              onSmartRoughCut={() => promptAiForItems(selectedItemsFor(contextMenu.item), 'roughCut')}
              onSmartSceneSplit={() => void smartSplitScenesForItems(selectedItemsFor(contextMenu.item))}
              onRecognizeSubtitles={() => void recognizeSubtitlesForItems(selectedItemsFor(contextMenu.item))}
              onSeparateAudio={() => void separateAudioForItems(selectedItemsFor(contextMenu.item))}
              onExportSelection={() => void exportSelectedItems(selectedItemsFor(contextMenu.item))}
              onToggleDisabled={() => toggleDisabledItems(selectedItemsFor(contextMenu.item))}
              onSavePreset={() => void saveItemsAsPreset(selectedItemsFor(contextMenu.item))}
              onClose={closeContextMenu}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function TimelineContextMenuView({
  x,
  y,
  count,
  disabled,
  canPaste,
  canPasteAttributes,
  canExportSelection,
  canMainClipAction,
  canMgAnimation,
  canReplace,
  canOpenMedia,
  canSavePreset,
  exportingSelection,
  onCopy,
  onCut,
  onPaste,
  onCopyAttributes,
  onPasteAttributes,
  onDelete,
  onReplace,
  onRelinkMedia,
  onRevealInFinder,
  onAiGenerate,
  onMgAnimation,
  onSmartRoughCut,
  onSmartSceneSplit,
  onRecognizeSubtitles,
  onSeparateAudio,
  onExportSelection,
  onToggleDisabled,
  onSavePreset,
  onClose,
}: {
  x: number;
  y: number;
  count: number;
  disabled: boolean;
  canPaste: boolean;
  canPasteAttributes: boolean;
  canExportSelection: boolean;
  canMainClipAction: boolean;
  canMgAnimation: boolean;
  canReplace: boolean;
  canOpenMedia: boolean;
  canSavePreset: boolean;
  exportingSelection: boolean;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onCopyAttributes: () => void;
  onPasteAttributes: () => void;
  onDelete: () => void;
  onReplace: () => void;
  onRelinkMedia: () => void;
  onRevealInFinder: () => void;
  onAiGenerate: () => void;
  onMgAnimation: () => void;
  onSmartRoughCut: () => void;
  onSmartSceneSplit: () => void;
  onRecognizeSubtitles: () => void;
  onSeparateAudio: () => void;
  onExportSelection: () => void;
  onToggleDisabled: () => void;
  onSavePreset: () => void;
  onClose: () => void;
}) {
  const row = 'w-full flex items-center justify-between gap-4 px-3 py-1.5 rounded-md text-left text-[12px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[rgba(255,255,255,0.07)]';
  const disabledRow = 'w-full flex items-center justify-between gap-4 px-3 py-1.5 rounded-md text-left text-[12px] text-[var(--canvas-text-3)] opacity-45 cursor-not-allowed';
  return (
    <div
      className="fixed z-[10000] w-[218px] max-h-[min(680px,calc(100vh-24px))] overflow-y-auto rounded-xl border border-[var(--canvas-node-border)] bg-[#272727] p-1.5 shadow-2xl"
      style={{ left: Math.min(x, window.innerWidth - 230), top: Math.min(y, window.innerHeight - Math.min(680, window.innerHeight - 24)) }}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-3 py-1.5 text-[10px] text-[var(--canvas-text-3)]">{count > 1 ? `已选 ${count} 个片段` : '片段操作'}</div>
      <button className={row} onClick={onCopy}><span>复制</span><kbd className="font-mono text-[10px]">⌘C</kbd></button>
      <button className={row} onClick={onCut}><span>剪切</span><kbd className="font-mono text-[10px]">⌘X</kbd></button>
      <button className={canPaste ? row : disabledRow} onClick={canPaste ? onPaste : onClose} disabled={!canPaste}>
        <span>粘贴</span><kbd className="font-mono text-[10px]">⌘V</kbd>
      </button>
      <button className={row} onClick={onCopyAttributes}><span>复制属性</span><kbd className="font-mono text-[10px]">⇧⌘C</kbd></button>
      <button className={canPasteAttributes ? row : disabledRow} onClick={canPasteAttributes ? onPasteAttributes : onClose} disabled={!canPasteAttributes}>
        <span>粘贴属性</span><kbd className="font-mono text-[10px]">⇧⌘V</kbd>
      </button>
      <button className={row} onClick={onDelete}><span>删除</span><kbd className="font-mono text-[10px]">Delete</kbd></button>
      <div className="my-1 h-px bg-[rgba(255,255,255,0.07)]" />
      <button className={row} onClick={onAiGenerate}><span>AI生成</span></button>
      <button className={canMgAnimation ? row : disabledRow} onClick={canMgAnimation ? onMgAnimation : onClose} disabled={!canMgAnimation}><span>MG动画</span></button>
      <button className={canMainClipAction ? row : disabledRow} onClick={canMainClipAction ? onSmartRoughCut : onClose} disabled={!canMainClipAction}><span>智能粗剪</span></button>
      <button className={canMainClipAction ? row : disabledRow} onClick={canMainClipAction ? onSmartSceneSplit : onClose} disabled={!canMainClipAction}><span>智能镜头分割</span></button>
      <button className={canMainClipAction ? row : disabledRow} onClick={canMainClipAction ? onRecognizeSubtitles : onClose} disabled={!canMainClipAction}><span>识别字幕/歌词</span></button>
      <button className={canMainClipAction ? row : disabledRow} onClick={canMainClipAction ? onSeparateAudio : onClose} disabled={!canMainClipAction}><span>分离音频</span></button>
      <button className={canExportSelection && !exportingSelection ? row : disabledRow} onClick={canExportSelection && !exportingSelection ? onExportSelection : onClose} disabled={!canExportSelection || exportingSelection}>
        <span>{exportingSelection ? '正在导出…' : '导出所选片段'}</span>
      </button>
      <button className={canReplace ? row : disabledRow} onClick={canReplace ? onReplace : onClose} disabled={!canReplace}><span>替换片段</span></button>
      <button className={canReplace ? row : disabledRow} onClick={canReplace ? onRelinkMedia : onClose} disabled={!canReplace}><span>链接媒体</span></button>
      <button className={canOpenMedia ? row : disabledRow} onClick={canOpenMedia ? onRevealInFinder : onClose} disabled={!canOpenMedia}><span>打开文件所在位置</span></button>
      <button className={canSavePreset ? row : disabledRow} onClick={canSavePreset ? onSavePreset : onClose} disabled={!canSavePreset}><span>保存为我的预设</span></button>
      <div className="my-1 h-px bg-[rgba(255,255,255,0.07)]" />
      <button className={row} onClick={onToggleDisabled}><span>{disabled ? '启用片段' : '停用片段'}</span><kbd className="font-mono text-[10px]">V</kbd></button>
    </div>
  );
}

function TrackStateButtons({ trackKey, locked, hidden, onPatch }: {
  trackKey: TimelineTrackKey;
  locked: boolean;
  hidden: boolean;
  onPatch: (patch: { locked?: boolean; hidden?: boolean }) => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={() => onPatch({ locked: !locked })}
        className={`p-0.5 rounded ${locked ? 'text-[#e8c060]' : 'text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-1)]'}`}
        title={locked ? '解锁轨道' : '锁定轨道'}
      >
        {locked ? <Lock size={9} /> : <Unlock size={9} />}
      </button>
      <button
        type="button"
        onClick={() => onPatch({ hidden: !hidden })}
        className={`p-0.5 rounded ${hidden ? 'text-[#e8c060]' : 'text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-1)]'}`}
        title={hidden ? '显示轨道' : '隐藏轨道'}
      >
        {hidden ? <EyeOff size={9} /> : <Eye size={9} />}
      </button>
      <span className="sr-only">{trackKey}</span>
    </>
  );
}

function HiddenLane({ height }: { height: number }) {
  return (
    <div className="relative rounded-md flex items-center px-3" style={{ height, background: LANE_BG, marginBottom: GAP }}>
      <span className="text-[9px] text-[var(--canvas-text-3)]">已隐藏</span>
    </div>
  );
}

// ── 特效轨 ────────────────────────────────────────────────────────────────────

function FxLane({ clips, zoom, height, multiSelectedKeys }: { clips: FxClip[]; zoom: number; height: number; multiSelectedKeys: Set<string> }) {
  const selectedFxId = useEditorStore((s) => s.selectedFxId);
  const selectFx = useEditorStore((s) => s.selectFx);
  const updateFxClip = useEditorStore((s) => s.updateFxClip);
  const trackState = useEditorStore((s) => s.trackStates.fx);
  const locked = Boolean(trackState?.locked);
  const snap = useSnap();
  const drag = useHorizDrag(zoom, snap, locked);
  if (trackState?.hidden) return <HiddenLane height={height} />;

  return (
    <div className="relative rounded-md" data-drop-track="fx" style={{ height, background: LANE_BG, marginBottom: GAP }}>
      {clips.map((c) => {
        const isMulti = multiSelectedKeys.has(`fx:${c.id}`);
        return (
        <div
          key={c.id}
          data-clip-id={c.id}
          data-track-type="fx"
          className={`absolute top-0 h-full rounded-md flex items-center px-2 overflow-hidden group ${locked ? 'cursor-not-allowed opacity-60' : 'cursor-grab active:cursor-grabbing'}`}
          style={{
            left: c.startSec * zoom, width: Math.max(c.duration * zoom, 20),
            background: TINT.fx.bg,
            border: `1px solid ${c.id === selectedFxId || isMulti ? 'rgba(255,255,255,0.9)' : TINT.fx.border}`,
            boxShadow: isMulti ? '0 0 0 1px rgba(0,216,230,0.75)' : undefined,
            opacity: c.disabled ? 0.45 : undefined,
          }}
          onPointerDown={(e) => { selectFx(c.id); drag.onDown(e, c.startSec, (v) => updateFxClip(c.id, { startSec: v })); }}
          onPointerMove={drag.onMove}
          onPointerUp={drag.onUp}
          title={c.label}
        >
          <span className="text-[10px] text-[var(--canvas-text-1)] truncate pointer-events-none flex-1">✦ {c.label}</span>
          {c.disabled && <span className="text-[8px] text-white/70 pointer-events-none mr-1">已停用</span>}
          <span className="text-[8px] text-[var(--canvas-text-2)] font-mono pointer-events-none ml-1">{c.duration.toFixed(1)}s</span>
          <div
            className={`absolute left-0 top-0 bottom-0 w-2 opacity-0 group-hover:opacity-100 bg-[rgba(255,255,255,0.4)] ${locked ? 'cursor-not-allowed' : 'cursor-ew-resize'}`}
            title="拖动缩短/延长特效开头"
            onPointerDown={(e) => {
              const end = c.startSec + c.duration;
              drag.onDown(e, c.startSec, (v) => {
                const nextStart = Math.max(0, Math.min(v, end - 0.2));
                updateFxClip(c.id, { startSec: nextStart, duration: Math.max(0.2, end - nextStart) });
              });
            }}
            onPointerMove={drag.onMove}
            onPointerUp={drag.onUp}
          />
          <div
            className={`absolute right-0 top-0 bottom-0 w-2 opacity-0 group-hover:opacity-100 bg-[rgba(255,255,255,0.4)] ${locked ? 'cursor-not-allowed' : 'cursor-ew-resize'}`}
            title="拖动缩短/延长特效结尾"
            onPointerDown={(e) => {
              const minEnd = c.startSec + 0.2;
              drag.onDown(e, c.startSec + c.duration, (v) => {
                const nextEnd = Math.max(minEnd, v);
                updateFxClip(c.id, { duration: Math.max(0.2, nextEnd - c.startSec) });
              });
            }}
            onPointerMove={drag.onMove}
            onPointerUp={drag.onUp}
          />
        </div>
        );
      })}
    </div>
  );
}

// ── 花字轨 ────────────────────────────────────────────────────────────────────

function TextLane({ clips, zoom, height, multiSelectedKeys }: { clips: TextClip[]; zoom: number; height: number; multiSelectedKeys: Set<string> }) {
  const selectedTextId = useEditorStore((s) => s.selectedTextId);
  const selectText = useEditorStore((s) => s.selectText);
  const updateTextClip = useEditorStore((s) => s.updateTextClip);
  const trackState = useEditorStore((s) => s.trackStates.text);
  const locked = Boolean(trackState?.locked);
  const snap = useSnap();
  const drag = useHorizDrag(zoom, snap, locked);
  if (trackState?.hidden) return <HiddenLane height={height} />;

  return (
    <div className="relative rounded-md" data-drop-track="text" style={{ height, background: LANE_BG, marginBottom: GAP }}>
      {clips.map((c) => {
        const dur = Math.max(0.2, c.endSec - c.startSec);
        const isMulti = multiSelectedKeys.has(`text:${c.id}`);
        return (
          <div
            key={c.id}
            data-clip-id={c.id}
            data-track-type="text"
            className={`absolute top-0 h-full rounded-md flex items-center px-2 overflow-hidden group ${locked ? 'cursor-not-allowed opacity-60' : 'cursor-grab active:cursor-grabbing'}`}
            style={{
              left: c.startSec * zoom, width: Math.max(dur * zoom, 20),
              background: TINT.text.bg,
              border: `1px solid ${c.id === selectedTextId || isMulti ? 'rgba(255,255,255,0.9)' : TINT.text.border}`,
              boxShadow: isMulti ? '0 0 0 1px rgba(0,216,230,0.75)' : undefined,
              opacity: c.disabled ? 0.45 : undefined,
            }}
            onPointerDown={(e) => {
              selectText(c.id);
              drag.onDown(e, c.startSec, (v) => updateTextClip(c.id, { startSec: v, endSec: v + dur }));
            }}
            onPointerMove={drag.onMove}
            onPointerUp={drag.onUp}
            title={c.text}
          >
            <span className="text-[10px] text-[var(--canvas-text-1)] truncate pointer-events-none">T {c.text}</span>
            {c.disabled && <span className="ml-1 text-[8px] text-white/70 pointer-events-none">已停用</span>}
            {/* 右缘改时长 */}
            <div
              className={`absolute right-0 top-0 bottom-0 w-1.5 opacity-0 group-hover:opacity-100 bg-[rgba(255,255,255,0.4)] ${locked ? 'cursor-not-allowed' : 'cursor-ew-resize'}`}
              onPointerDown={(e) => drag.onDown(e, c.endSec, (v) => updateTextClip(c.id, { endSec: Math.max(c.startSec + 0.2, v) }))}
              onPointerMove={drag.onMove}
              onPointerUp={drag.onUp}
            />
          </div>
        );
      })}
    </div>
  );
}

// ── 视频多轨（原画中画轨，导出到剪映时保持独立视频轨） ─────────────────────────

function OverlayLane({
  clips,
  trackIndex,
  zoom,
  height,
  multiSelectedKeys,
  dropPreview,
}: {
  clips: OverlayClip[];
  trackIndex: 0 | 1;
  zoom: number;
  height: number;
  multiSelectedKeys: Set<string>;
  dropPreview: TimelineDropPreview | null;
}) {
  const selectedOverlayId = useEditorStore((s) => s.selectedOverlayId);
  const selectOverlay = useEditorStore((s) => s.selectOverlay);
  const updateOverlayClip = useEditorStore((s) => s.updateOverlayClip);
  const trackState = useEditorStore((s) => s.trackStates[`overlay-${trackIndex}` as TimelineTrackKey]);
  const locked = Boolean(trackState?.locked);
  const snap = useSnap();
  const drag = useHorizDrag(zoom, snap, locked);
  if (trackState?.hidden) return <HiddenLane height={height} />;
  const trackKey = `overlay-${trackIndex}`;
  const dropPath = dropPreview?.payload?.path ?? '';
  const showDropSlot = Boolean(dropPreview && dropPreview.track === trackKey && dropPath && dropPreview.payload?.kind !== 'audio' && !isAudioPath(dropPath));
  const dropSlotDuration = Math.max(1.2, Math.min(8, dropPreview?.payload?.duration ?? 5));

  return (
    <div className="relative rounded-md" data-drop-track={`overlay-${trackIndex}`} style={{ height, background: LANE_BG, marginBottom: GAP }}>
      {showDropSlot && (
        <div
          className="absolute top-[3px] bottom-[3px] rounded-[5px] border border-dashed border-[#20d6df] bg-[#20d6df]/16 shadow-[0_0_0_1px_rgba(32,214,223,0.18)] overflow-hidden pointer-events-none z-[8]"
          style={{
            left: (dropPreview?.sec ?? 0) * zoom,
            width: Math.max(dropSlotDuration * zoom, 54),
          }}
        >
          <div className="absolute inset-x-0 top-0 h-[18px] bg-[#20aeb6]/70 border-b border-white/10 px-2 flex items-center">
            <span className="text-[10px] font-medium text-white truncate">{dropPreview?.payload?.label ?? `放入视频轨 ${trackIndex + 2}`}</span>
          </div>
        </div>
      )}
      {clips.filter((c) => c.trackIndex === trackIndex).map((c) => {
        const duration = Math.max(0.2, c.outSec - c.inSec);
        const width = Math.max(duration * zoom, 30);
        const isMulti = multiSelectedKeys.has(`overlay:${c.id}`);
        return (
        <div
          key={c.id}
          data-clip-id={c.id}
          data-track-type="overlay"
          className={`absolute top-[3px] bottom-[3px] rounded-[5px] overflow-hidden group ${locked ? 'cursor-not-allowed opacity-60' : 'cursor-grab active:cursor-grabbing'}`}
          style={{
            left: c.startSec * zoom,
            width,
            background: c.kind === 'video' ? '#086d72' : TINT.ovl.bg,
            border: `1px solid ${c.id === selectedOverlayId || isMulti ? 'rgba(255,255,255,0.92)' : 'rgba(0,160,166,0.55)'}`,
            boxShadow: isMulti ? '0 0 0 1px rgba(0,216,230,0.75)' : 'inset 0 0 0 1px rgba(255,255,255,0.04)',
            opacity: c.disabled ? 0.45 : undefined,
          }}
          onPointerDown={(e) => { selectOverlay(c.id); drag.onDown(e, c.startSec, (v) => updateOverlayClip(c.id, { startSec: v })); }}
          onPointerMove={drag.onMove}
          onPointerUp={drag.onUp}
          title={c.label}
        >
          <ClipFilmStrip
            path={c.path}
            selected={c.id === selectedOverlayId || isMulti}
            width={width}
            inSec={c.inSec}
            outSec={c.outSec}
            volume={c.volume ?? 1}
            activeVolume={false}
            onVolumePointerDown={() => {}}
          />
          <div className="absolute inset-x-0 top-0 h-[18px] px-2 flex items-center gap-2 pointer-events-none bg-[#07898d] border-b border-black/20">
            <p className="text-[10px] font-medium text-white truncate flex-1">{c.kind === 'video' ? c.label : `图片 · ${c.label}`}</p>
            {c.disabled && <p className="text-[8px] text-white/80 shrink-0">已停用</p>}
            <p className="text-[9px] text-white/95 font-mono shrink-0">{duration.toFixed(1)}s</p>
          </div>
          {(c.keyframes?.length ?? 0) > 0 && (
            <span className="absolute right-2 bottom-[25px] text-[8px] text-white/80 pointer-events-none">◆{c.keyframes!.length}</span>
          )}
          <div
            className={`absolute left-0 top-0 bottom-0 w-2 opacity-0 group-hover:opacity-100 bg-white/0 hover:bg-white/35 ${locked ? 'cursor-not-allowed' : 'cursor-ew-resize'}`}
            title="拖动调整开头"
            onPointerDown={(e) => {
              const end = c.startSec + duration;
              drag.onDown(e, c.startSec, (v) => {
                const nextStart = Math.max(0, Math.min(v, end - 0.2));
                const delta = nextStart - c.startSec;
                updateOverlayClip(c.id, {
                  startSec: nextStart,
                  inSec: Math.max(0, Math.min(c.inSec + delta, c.outSec - 0.2)),
                });
              });
            }}
            onPointerMove={drag.onMove}
            onPointerUp={drag.onUp}
          />
          <div
            className={`absolute right-0 top-0 bottom-0 w-2 opacity-0 group-hover:opacity-100 bg-white/0 hover:bg-white/35 ${locked ? 'cursor-not-allowed' : 'cursor-ew-resize'}`}
            title="拖动调整结尾"
            onPointerDown={(e) => {
              drag.onDown(e, c.startSec + duration, (v) => {
                const nextOut = Math.max(c.inSec + 0.2, Math.min(c.duration, c.inSec + (v - c.startSec)));
                updateOverlayClip(c.id, { outSec: nextOut });
              });
            }}
            onPointerMove={drag.onMove}
            onPointerUp={drag.onUp}
          />
        </div>
        );
      })}
    </div>
  );
}

// ── 主视频轨（缩略图 + 裁剪手柄 + 拖拽排序，沿用 v2 行为） ───────────────────

function MainTrack({
  clips,
  zoom,
  height,
  multiSelectedKeys,
  dropPreview,
}: {
  clips: EditorClip[];
  zoom: number;
  height: number;
  multiSelectedKeys: Set<string>;
  dropPreview: TimelineDropPreview | null;
}) {
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const select = useEditorStore((s) => s.select);
  const clipLength = useEditorStore((s) => s.clipLength);
  const updateClip = useEditorStore((s) => s.updateClip);
  const trackState = useEditorStore((s) => s.trackStates.main);
  const [drag, setDrag] = useState<{
    id: string;
    startX: number;
    mode: 'move' | 'trim-l' | 'trim-r';
    baseIn: number;
    baseOut: number;
    previewIn: number;
    previewOut: number;
  } | null>(null);
  const [volumeDrag, setVolumeDrag] = useState<{ id: string; startY: number; startVolume: number } | null>(null);
  const locked = Boolean(trackState?.locked);
  if (trackState?.hidden) return <HiddenLane height={height} />;

  const onPointerDown = (e: React.PointerEvent, clip: EditorClip, mode: 'move' | 'trim-l' | 'trim-r') => {
    e.stopPropagation();
    if (locked) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    captureEditorSnapshot();
    select(clip.id);
    setDrag({
      id: clip.id,
      startX: e.clientX,
      mode,
      baseIn: clip.inSec,
      baseOut: clip.outSec,
      previewIn: clip.inSec,
      previewOut: clip.outSec,
    });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (volumeDrag) {
      const next = Math.max(0, Math.min(2, volumeDrag.startVolume - ((e.clientY - volumeDrag.startY) / 86)));
      updateClip(volumeDrag.id, { volume: next });
      return;
    }
    if (!drag) return;
    const deltaSec = (e.clientX - drag.startX) / zoom;
    if (Math.abs(deltaSec) < 0.005) return;
    const store = useEditorStore.getState();
    const clip = store.clips.find((c) => c.id === drag.id);
    if (!clip) return;

    if (drag.mode === 'trim-l') {
      const nextIn = Math.max(0, Math.min(drag.baseIn + deltaSec, drag.previewOut - 0.1));
      setDrag({ ...drag, previewIn: nextIn });
    } else if (drag.mode === 'trim-r') {
      const nextOut = Math.max(drag.previewIn + 0.1, Math.min(drag.baseOut + deltaSec, clip.duration));
      setDrag({ ...drag, previewOut: nextOut });
    } else {
      if (Math.abs(deltaSec) < 0.02) return;
      const idx = store.clips.findIndex((c) => c.id === drag.id);
      const myLen = store.clipLength(clip) * zoom;
      if (deltaSec * zoom > myLen * 0.6 && idx < store.clips.length - 1) {
        store.reorderClip(drag.id, idx + 1);
        setDrag({ ...drag, startX: e.clientX });
      } else if (deltaSec * zoom < -myLen * 0.6 && idx > 0) {
        store.reorderClip(drag.id, idx - 1);
        setDrag({ ...drag, startX: e.clientX });
      }
    }
  };

  const onPointerUp = () => {
    if (drag && (drag.mode === 'trim-l' || drag.mode === 'trim-r')) {
      useEditorStore.getState().trimClip(drag.id, drag.previewIn, drag.previewOut);
    }
    setDrag(null);
    setVolumeDrag(null);
  };

  const onVolumePointerDown = (e: React.PointerEvent, clip: EditorClip) => {
    e.preventDefault();
    e.stopPropagation();
    if (locked) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    captureEditorSnapshot();
    select(clip.id);
    setVolumeDrag({ id: clip.id, startY: e.clientY, startVolume: clip.volume ?? 1 });
  };

  let acc = 0;
  const dragIndex = drag && (drag.mode === 'trim-l' || drag.mode === 'trim-r') ? clips.findIndex((clip) => clip.id === drag.id) : -1;
  const dragClip = dragIndex >= 0 ? clips[dragIndex] : null;
  const dragSpeed = dragClip?.speed && dragClip.speed > 0 ? dragClip.speed : 1;
  const dragStoredLen = dragClip ? clipLength(dragClip) : 0;
  const dragPreviewLen = drag ? Math.max(0.1, (drag.previewOut - drag.previewIn) / dragSpeed) : dragStoredLen;
  const dragDeltaPx = drag ? (dragPreviewLen - dragStoredLen) * zoom : 0;
  const dropPath = dropPreview?.payload?.path ?? '';
  const showDropSlot = Boolean(dropPreview && dropPreview.track === 'main' && dropPath && (dropPreview.payload?.kind !== 'audio') && !isAudioPath(dropPath));
  const dropSlotDuration = Math.max(1.2, Math.min(8, dropPreview?.payload?.duration ?? 5));
  let dropSlotIndex = clips.length;
  if (showDropSlot && dropPreview) {
    let cursor = 0;
    for (let i = 0; i < clips.length; i += 1) {
      const len = clipLength(clips[i]);
      if (dropPreview.sec < cursor + len / 2) {
        dropSlotIndex = i;
        break;
      }
      cursor += len;
    }
  }
  const dropSlotLeft = showDropSlot
    ? clips.slice(0, dropSlotIndex).reduce((sum, clip) => sum + clipLength(clip), 0) * zoom
    : 0;
  const dropSlotWidth = dropSlotDuration * zoom;
  return (
    <div className="relative" data-drop-track="main" style={{ height, background: 'rgba(255,255,255,0.022)', marginBottom: GAP }}>
      {showDropSlot && (
        <div
          className="absolute top-[4px] bottom-[4px] rounded-[5px] border border-dashed border-[#20d6df] bg-[#20d6df]/16 shadow-[0_0_0_1px_rgba(32,214,223,0.18),0_10px_24px_rgba(0,0,0,0.22)] overflow-hidden pointer-events-none z-[8]"
          style={{
            left: dropSlotLeft,
            width: Math.max(dropSlotWidth, 54),
            transition: 'left 120ms ease, width 120ms ease',
          }}
        >
          <div className="absolute inset-x-0 top-0 h-[18px] bg-[#20aeb6]/70 border-b border-white/10 px-2 flex items-center">
            <span className="text-[10px] font-medium text-white truncate">{dropPreview?.payload?.label ?? '放到这里'}</span>
          </div>
          <div className="absolute inset-x-1 bottom-1 h-[20px] rounded-sm bg-black/16 flex items-end gap-px px-1 pb-1">
            {Array.from({ length: 18 }).map((_, i) => (
              <span
                key={i}
                className="w-px rounded-full bg-[#ffd24d]/80"
                style={{ height: `${20 + ((i * 17) % 65)}%` }}
              />
            ))}
          </div>
        </div>
      )}
      {clips.map((c, index) => {
        const baseLeft = acc * zoom;
        const preview = drag?.id === c.id && (drag.mode === 'trim-l' || drag.mode === 'trim-r') ? drag : null;
        const effectiveIn = preview?.previewIn ?? c.inSec;
        const effectiveOut = preview?.previewOut ?? c.outSec;
        const effectiveLen = Math.max(0.1, (effectiveOut - effectiveIn) / (c.speed && c.speed > 0 ? c.speed : 1));
        const storedLen = clipLength(c);
        let queueOffset = 0;
        if (!preview && drag && dragIndex >= 0 && (drag.mode === 'trim-l' || drag.mode === 'trim-r')) {
          if (drag.mode === 'trim-l') {
            if (dragDeltaPx > 0 && index < dragIndex) queueOffset = -dragDeltaPx;
            if (dragDeltaPx < 0 && index > dragIndex) queueOffset = dragDeltaPx;
          } else if (index > dragIndex) {
            queueOffset = dragDeltaPx;
          }
        }
        if (!preview && showDropSlot && index >= dropSlotIndex) {
          queueOffset += dropSlotWidth;
        }
        const visualLeft = preview?.mode === 'trim-l'
          ? baseLeft + ((effectiveIn - c.inSec) / (c.speed && c.speed > 0 ? c.speed : 1)) * zoom
          : baseLeft + queueOffset;
        const width = effectiveLen * zoom;
        acc += clipLength(c);
        const isMulti = multiSelectedKeys.has(`main:${c.id}`);
        const isSel = c.id === selectedClipId || isMulti;
        const trans = c.transitionAfter.type !== 'cut' ? findTransition(c.transitionAfter.type)?.label ?? '叠化' : null;
        const layer = preview ? 9 : undefined;
        return (
          <div
            key={c.id}
            data-clip-id={c.id}
            data-track-type="main"
            className={`absolute top-[4px] bottom-[4px] rounded-[5px] overflow-hidden ${locked ? 'cursor-not-allowed opacity-60' : 'cursor-grab active:cursor-grabbing'}`}
            style={{
              left: visualLeft,
              width: Math.max(width, 24),
              zIndex: layer,
              background: isSel ? '#078b8f' : '#08777a',
              border: `1px solid ${isSel ? 'rgba(255,255,255,0.95)' : 'rgba(0,160,166,0.55)'}`,
              boxShadow: isMulti ? '0 0 0 1px rgba(0,216,230,0.82)' : isSel ? '0 0 0 1px rgba(255,255,255,0.55)' : 'inset 0 0 0 1px rgba(255,255,255,0.04)',
              transition: preview || drag ? 'none' : 'left 140ms ease, width 140ms ease',
              opacity: c.disabled ? 0.48 : undefined,
            }}
            onPointerDown={(e) => onPointerDown(e, c, 'move')}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            <ClipFilmStrip
              path={c.path}
              selected={isSel}
              width={Math.max(width, 24)}
              inSec={effectiveIn}
              outSec={effectiveOut}
              volume={c.volume ?? 1}
              activeVolume={volumeDrag?.id === c.id}
              onVolumePointerDown={(e) => onVolumePointerDown(e, c)}
            />
            <div className="absolute inset-x-0 top-0 h-[18px] px-2 flex items-center gap-2 pointer-events-none bg-[#07898d] border-b border-black/20">
              <p className="text-[10px] font-medium text-white truncate flex-1">{c.label}</p>
              {c.disabled && <p className="text-[8px] text-white/80 shrink-0">已停用</p>}
              <p className="text-[9px] text-white/95 font-mono shrink-0">
                {effectiveLen.toFixed(1)}s
              </p>
            </div>
            {preview && (
              <div
                className="absolute top-0 bottom-0 border-x border-white/70 bg-white/10 pointer-events-none"
                style={{
                  left: preview.mode === 'trim-l' ? 0 : storedLen * zoom,
                  width: Math.max(Math.abs(width - storedLen * zoom), 2),
                }}
              />
            )}
            <div
              className="absolute left-2 pointer-events-none flex items-center gap-1.5 text-[8px] text-white/80 font-mono"
              style={{ bottom: MAIN_CLIP_WAVE_H + 1 }}
            >
                {(c.speed ?? 1) !== 1 && <span className="text-[#e8c060]">{(c.speed ?? 1).toFixed(1)}x</span>}
                {c.reversed && <span>倒放</span>}
                {c.filter?.preset && c.filter.preset !== 'none' && <span>滤镜</span>}
              {trans && (
                <span>⇢{trans} {c.transitionAfter.duration}s</span>
              )}
            </div>
            <div
              className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize bg-white/0 hover:bg-white/35"
              onPointerDown={(e) => onPointerDown(e, c, 'trim-l')}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            />
            <div
              className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-white/0 hover:bg-white/35"
              onPointerDown={(e) => onPointerDown(e, c, 'trim-r')}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            />
          </div>
        );
      })}
      {clips.length === 0 && (
        <div className="h-full flex items-center px-3">
          <span className="text-[9px] text-[var(--canvas-text-3)]">从左侧「素材」添加视频，或让鲲鹏助手帮你排片</span>
        </div>
      )}
    </div>
  );
}

function ClipFilmStrip({
  path,
  selected,
  width,
  inSec,
  outSec,
  volume,
  activeVolume,
  onVolumePointerDown,
}: {
  path: string;
  selected?: boolean;
  width: number;
  inSec: number;
  outSec: number;
  volume: number;
  activeVolume?: boolean;
  onVolumePointerDown: (e: React.PointerEvent) => void;
}) {
  const thumb = useVideoThumb(path);
  const cells = Math.max(1, Math.min(28, Math.ceil(width / 52)));
  const waveHeight = MAIN_CLIP_WAVE_H;
  if (!thumb) {
    return (
      <div className="absolute inset-x-0 bottom-0 bg-black/30" style={{ top: MAIN_CLIP_HEADER_H }}>
        <VideoClipWaveform
          seed={path}
          fromSec={inSec}
          toSec={outSec}
          volume={volume}
          active={activeVolume}
          height={waveHeight}
          onPointerDown={onVolumePointerDown}
        />
      </div>
    );
  }
  return (
    <div className="absolute inset-x-0 bottom-0 overflow-hidden bg-[#113b3d]" style={{ top: MAIN_CLIP_HEADER_H }}>
      <div className="absolute inset-x-0 top-0 flex overflow-hidden" style={{ bottom: waveHeight }}>
        {Array.from({ length: cells }).map((_, i) => (
          <div
            key={i}
            className="h-full shrink-0 border-r border-black/25 pointer-events-none"
            style={{
              width: `${100 / cells}%`,
              backgroundImage: `linear-gradient(rgba(0,0,0,${selected ? 0 : 0.06}), rgba(0,0,0,${selected ? 0.03 : 0.11})), url(${thumb})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />
        ))}
      </div>
      <VideoClipWaveform
        seed={path}
        fromSec={inSec}
        toSec={outSec}
        volume={volume}
        active={activeVolume}
        height={waveHeight}
        onPointerDown={onVolumePointerDown}
      />
    </div>
  );
}

function VideoClipWaveform({
  seed,
  fromSec,
  toSec,
  volume,
  active,
  height,
  onPointerDown,
}: {
  seed: string;
  fromSec: number;
  toSec: number;
  volume: number;
  active?: boolean;
  height: number;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const [peaks, setPeaks] = useState<number[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getWaveform(seed).then((next) => {
      if (!cancelled) setPeaks(next);
    });
    return () => { cancelled = true; };
  }, [seed]);

  const seedValue = Array.from(seed).reduce((sum, ch) => (sum + ch.charCodeAt(0)) % 997, 0);
  const bars = 64;
  const vol = Math.max(0, Math.min(2, volume));
  const rangeStart = Math.max(0, fromSec);
  const rangeEnd = Math.max(rangeStart + 0.1, toSec);
  return (
    <div
      className={`absolute inset-x-0 bottom-0 cursor-ns-resize border-t border-black/30 ${active ? 'bg-[#087f87]' : 'bg-[#067277]'}`}
      style={{ height }}
      onPointerDown={onPointerDown}
      title={`上下拖动调整原声音量：${Math.round(vol * 100)}%`}
    >
      <div className="absolute inset-x-1.5 top-[3px] bottom-[3px] flex items-center gap-[1px]">
        {Array.from({ length: bars }).map((_, i) => {
          const peak = peaks
            ? (() => {
                const sec = rangeStart + ((i + 0.5) / bars) * (rangeEnd - rangeStart);
                const bucket = Math.max(0, Math.min(peaks.length - 1, Math.floor(sec * PEAKS_PER_SEC)));
                const window = peaks.slice(Math.max(0, bucket - 1), Math.min(peaks.length, bucket + 2));
                return window.length ? Math.max(...window) : 0.08;
              })()
            : 0.18 + (((Math.sin((i + 1) * 1.71 + seedValue) + Math.sin((i + 3) * 0.67 + seedValue / 7)) + 2) / 4) * 0.72;
          const h = Math.max(2, Math.round(Math.min(1, peak * 1.35) * Math.min(1.35, vol) * (height - 7)));
          return (
            <span
              key={i}
              className="flex-1 min-w-[1px] rounded-full bg-[#f39b23]"
              style={{ height: h, opacity: peaks ? 0.95 : 0.68 }}
            />
          );
        })}
      </div>
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-black/18 pointer-events-none" />
      {active && (
        <span className="absolute right-1 top-0.5 rounded bg-black/45 px-1 text-[8px] leading-3 text-white/90">
          {Math.round(vol * 100)}%
        </span>
      )}
    </div>
  );
}

// ── 字幕轨 ────────────────────────────────────────────────────────────────────

function SubtitleLane({ cues, zoom, height, multiSelectedKeys }: { cues: SubtitleCue[]; zoom: number; height: number; multiSelectedKeys: Set<string> }) {
  const selectedSubtitleId = useEditorStore((s) => s.selectedSubtitleId);
  const selectSubtitle = useEditorStore((s) => s.selectSubtitle);
  const updateSubtitle = useEditorStore((s) => s.updateSubtitle);
  const trackState = useEditorStore((s) => s.trackStates.subtitle);
  const locked = Boolean(trackState?.locked);
  const snap = useSnap();
  const drag = useHorizDrag(zoom, snap, locked);
  if (trackState?.hidden) return <HiddenLane height={height} />;

  return (
    <div className="relative rounded-md" data-drop-track="subtitle" style={{ height, background: LANE_BG, marginBottom: GAP }}>
      {cues.map((c) => {
        const dur = Math.max(0.2, c.endSec - c.startSec);
        const isMulti = multiSelectedKeys.has(`subtitle:${c.id}`);
        return (
          <div
            key={c.id}
            data-clip-id={c.id}
            data-track-type="subtitle"
            className={`absolute top-0 h-full rounded-md flex items-center px-2 overflow-hidden group ${locked ? 'cursor-not-allowed opacity-60' : 'cursor-grab active:cursor-grabbing'}`}
            style={{
              left: c.startSec * zoom, width: Math.max(dur * zoom, 16),
              background: TINT.sub.bg,
              border: `1px solid ${c.id === selectedSubtitleId || isMulti ? 'rgba(255,255,255,0.9)' : TINT.sub.border}`,
              boxShadow: isMulti ? '0 0 0 1px rgba(0,216,230,0.75)' : undefined,
              opacity: c.disabled ? 0.45 : undefined,
            }}
            onPointerDown={(e) => {
              selectSubtitle(c.id);
              drag.onDown(e, c.startSec, (v) => updateSubtitle(c.id, { startSec: v, endSec: v + dur }));
            }}
            onPointerMove={drag.onMove}
            onPointerUp={drag.onUp}
            title={c.text}
          >
            <span className="text-[10px] text-[var(--canvas-text-1)] truncate pointer-events-none">{c.text}</span>
            {c.disabled && <span className="ml-1 text-[8px] text-white/70 pointer-events-none">已停用</span>}
            <div
              className={`absolute right-0 top-0 bottom-0 w-1.5 opacity-0 group-hover:opacity-100 bg-[rgba(255,255,255,0.4)] ${locked ? 'cursor-not-allowed' : 'cursor-ew-resize'}`}
              onPointerDown={(e) => drag.onDown(e, c.endSec, (v) => updateSubtitle(c.id, { endSec: Math.max(c.startSec + 0.2, v) }))}
              onPointerMove={drag.onMove}
              onPointerUp={drag.onUp}
            />
          </div>
        );
      })}
    </div>
  );
}

// ── 音频轨 ────────────────────────────────────────────────────────────────────

function AudioLane({ trackId, muted, clips, zoom, height, multiSelectedKeys }: { trackId: string; muted: boolean; clips: AudioClip[]; zoom: number; height: number; multiSelectedKeys: Set<string> }) {
  const selectedAudioClipId = useEditorStore((s) => s.selectedAudioClipId);
  const selectAudioClip = useEditorStore((s) => s.selectAudioClip);
  const updateAudioClip = useEditorStore((s) => s.updateAudioClip);
  const audioTracks = useEditorStore((s) => s.audioTracks);
  const kind = audioTracks.find((t) => t.id === trackId)?.kind ?? 'bgm';
  const trackState = useEditorStore((s) => s.trackStates[`audio-${kind}` as TimelineTrackKey]);
  const locked = Boolean(trackState?.locked);
  const snap = useSnap();
  const drag = useHorizDrag(zoom, snap, locked);
  if (trackState?.hidden) return <HiddenLane height={height} />;
  void trackId;

  return (
    <div className="relative rounded-md" data-drop-track={`audio-${kind}`} style={{ height, background: LANE_BG, marginBottom: GAP, opacity: muted ? 0.45 : 1 }}>
      {clips.map((c) => {
        const dur = Math.max(0.5, (c.outSec - c.inSec) || c.duration || 4);
        const isMulti = multiSelectedKeys.has(`audio:${c.id}`);
        return (
          <div
            key={c.id}
            data-clip-id={c.id}
            data-track-type="audio"
            className={`absolute top-0 h-full rounded-md flex items-center gap-1 px-2 overflow-hidden ${locked ? 'cursor-not-allowed opacity-60' : 'cursor-grab active:cursor-grabbing'}`}
            style={{
              left: c.startSec * zoom, width: Math.max(dur * zoom, 20),
              background: TINT.audio.bg,
              border: `1px solid ${c.id === selectedAudioClipId || isMulti ? 'rgba(255,255,255,0.9)' : TINT.audio.border}`,
              boxShadow: isMulti ? '0 0 0 1px rgba(0,216,230,0.75)' : undefined,
              opacity: c.disabled ? 0.45 : undefined,
            }}
            onPointerDown={(e) => { selectAudioClip(c.id); drag.onDown(e, c.startSec, (v) => updateAudioClip(c.id, { startSec: v })); }}
            onPointerMove={drag.onMove}
            onPointerUp={drag.onUp}
            title={c.label}
          >
            <AudioWaveform seed={c.id} />
            <span className="relative z-[1] text-[10px] text-white truncate pointer-events-none">♪ {c.label}</span>
            {c.disabled && <span className="relative z-[1] text-[8px] text-white/75 pointer-events-none">已停用</span>}
            {c.loop && <span className="text-[8px] text-[var(--canvas-text-2)] pointer-events-none">∞</span>}
          </div>
        );
      })}
    </div>
  );
}

function AudioWaveform({ seed }: { seed: string }) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const bars = Array.from({ length: 54 }, (_, i) => {
    const v = Math.sin((h + i * 37) * 0.173) * 0.5 + 0.5;
    return 18 + Math.round(v * 26);
  });
  return (
    <div className="absolute inset-x-1 inset-y-1 flex items-center gap-[2px] opacity-70 pointer-events-none">
      {bars.map((v, i) => (
        <span key={i} className="flex-1 rounded-full bg-[#1db7f0]" style={{ height: `${v}%` }} />
      ))}
    </div>
  );
}
