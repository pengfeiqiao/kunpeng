/**
 * RenderGraph — renderer-independent timeline IR.
 *
 * The current exporter is FFmpeg-first. This graph is the bridge toward a
 * native/WebGPU compositor: every backend should consume this shape instead of
 * re-reading editorStore directly or rebuilding time math ad hoc.
 */
import { useEditorStore, EXPORT_RESOLUTIONS, type EditorAspect } from '@/stores/editorStore';
import { aspectOutputSize } from '@/lib/editor/aspect';

export type RenderNodeKind = 'main-video' | 'overlay-video' | 'overlay-image' | 'text' | 'fx' | 'audio' | 'subtitle' | 'virtual-base';
export type RenderTrackKind = 'video' | 'overlay' | 'graphics' | 'audio' | 'subtitle';

export interface RenderTimeRange {
  startSec: number;
  durationSec: number;
}

export interface RenderNode {
  id: string;
  kind: RenderNodeKind;
  track: RenderTrackKind;
  sourcePath?: string;
  label?: string;
  target: RenderTimeRange;
  source?: RenderTimeRange;
  zIndex: number;
  properties?: Record<string, unknown>;
}

export interface RenderGraphOutput {
  width: number;
  height: number;
  fps: number;
  aspect: EditorAspect;
  durationSec: number;
  format: 'mp4' | 'mov_alpha';
  background: 'black' | 'transparent';
}

export interface RenderGraph {
  version: 1;
  output: RenderGraphOutput;
  nodes: RenderNode[];
  diagnostics: string[];
  features: {
    hasMainVideo: boolean;
    hasVirtualBase: boolean;
    hasOverlays: boolean;
    hasGraphics: boolean;
    hasAudioMix: boolean;
    hasSubtitles: boolean;
    hasSpeedChanges: boolean;
    hasTransitions: boolean;
  };
}

export function buildRenderGraph(): RenderGraph {
  const s = useEditorStore.getState();
  const settings = s.exportSettings;
  const res = EXPORT_RESOLUTIONS[settings.resolution];
  const { width, height } = aspectOutputSize(s.aspect, res);
  const durationSec = Math.max(0, s.totalDuration());
  const nodes: RenderNode[] = [];
  const diagnostics: string[] = [];

  let cursor = 0;
  for (const c of s.clips.filter((x) => x.path)) {
    const dur = s.clipLength(c);
    nodes.push({
      id: c.id,
      kind: 'main-video',
      track: 'video',
      sourcePath: c.path,
      label: c.label,
      target: { startSec: cursor, durationSec: dur },
      source: { startSec: c.inSec, durationSec: Math.max(0.1, c.outSec - c.inSec) },
      zIndex: 0,
      properties: {
        speed: c.speed ?? 1,
        curvePreset: c.curvePreset,
        reversed: c.reversed,
        flipH: c.flipH,
        rotate: c.rotate,
        filter: c.filter,
        volume: c.volume ?? 1,
        transitionAfter: c.transitionAfter,
        disabled: Boolean(c.disabled),
      },
    });
    cursor += dur;
  }

  if (nodes.length === 0 && durationSec > 0.05) {
    nodes.push({
      id: 'virtual-base',
      kind: 'virtual-base',
      track: 'video',
      label: settings.background === 'transparent' || settings.format === 'mov_alpha' ? '透明底片' : '黑色底片',
      target: { startSec: 0, durationSec },
      zIndex: 0,
      properties: {
        color: settings.background === 'transparent' || settings.format === 'mov_alpha' ? 'transparent' : 'black',
      },
    });
  }

  for (const o of s.overlayClips.filter((x) => !x.disabled)) {
    nodes.push({
      id: o.id,
      kind: o.kind === 'image' ? 'overlay-image' : 'overlay-video',
      track: 'overlay',
      sourcePath: o.path,
      label: o.path.split('/').pop(),
      target: { startSec: o.startSec, durationSec: Math.max(0.1, o.outSec - o.inSec) },
      source: { startSec: o.inSec, durationSec: Math.max(0.1, o.outSec - o.inSec) },
      zIndex: 100 + o.trackIndex,
      properties: { transform: o.transform, keyframes: o.keyframes ?? [], volume: o.volume ?? 1 },
    });
  }

  for (const t of s.textClips.filter((x) => !x.disabled)) {
    nodes.push({
      id: t.id,
      kind: 'text',
      track: 'graphics',
      label: t.text.slice(0, 40),
      target: { startSec: t.startSec, durationSec: Math.max(0.2, t.endSec - t.startSec) },
      zIndex: 300,
      properties: { templateId: t.templateId, text: t.text, position: t.position, styleOverrides: t.styleOverrides },
    });
  }

  for (const f of s.fxClips.filter((x) => !x.disabled)) {
    nodes.push({
      id: f.id,
      kind: 'fx',
      track: 'graphics',
      label: f.label,
      target: { startSec: f.startSec, durationSec: Math.max(0.2, f.duration) },
      zIndex: 250,
      properties: { componentId: f.componentId, theme: f.theme, params: f.params, htmlBytes: f.html.length, cssBytes: f.css.length },
    });
  }

  const mutedTracks = new Set(s.audioTracks.filter((t) => t.muted).map((t) => t.id));
  for (const a of s.audioClips.filter((x) => !x.disabled && !mutedTracks.has(x.trackId))) {
    nodes.push({
      id: a.id,
      kind: 'audio',
      track: 'audio',
      sourcePath: a.path,
      label: a.label,
      target: { startSec: a.startSec, durationSec: Math.max(0.1, a.outSec - a.inSec || a.duration || 0) },
      source: { startSec: a.inSec, durationSec: Math.max(0.1, a.outSec - a.inSec || a.duration || 0) },
      zIndex: 0,
      properties: { volume: a.volume, loop: a.loop, fadeInSec: a.fadeInSec, fadeOutSec: a.fadeOutSec },
    });
  }

  for (const sub of s.subtitles.filter((x) => !x.disabled)) {
    nodes.push({
      id: sub.id,
      kind: 'subtitle',
      track: 'subtitle',
      label: sub.text.slice(0, 40),
      target: { startSec: sub.startSec, durationSec: Math.max(0.1, sub.endSec - sub.startSec) },
      zIndex: 400,
      properties: { text: sub.text, style: sub.style },
    });
  }

  const hasSpeedChanges = s.clips.some((c) => (c.speed ?? 1) !== 1 || c.curvePreset || c.reversed);
  const hasTransitions = s.clips.some((c) => c.transitionAfter.type !== 'cut' && c.transitionAfter.duration > 0);
  if (hasTransitions) diagnostics.push('包含转场：native compositor 需要实现转场 shader 或回退 FFmpeg xfade。');
  if (hasSpeedChanges) diagnostics.push('包含变速/倒放：native compositor 需要独立处理时间重映射。');
  if (s.fxClips.filter((x) => !x.disabled).length + s.textClips.filter((x) => !x.disabled).length > 0) diagnostics.push('包含 HTML/花字层：当前仍需 Chromium 预渲染透明总轨。');

  return {
    version: 1,
    output: {
      width,
      height,
      fps: settings.fps,
      aspect: s.aspect,
      durationSec,
      format: settings.format ?? 'mp4',
      background: settings.background ?? 'black',
    },
    nodes: nodes.sort((a, b) => a.target.startSec - b.target.startSec || a.zIndex - b.zIndex),
    diagnostics,
    features: {
      hasMainVideo: s.clips.some((c) => c.path),
      hasVirtualBase: nodes.some((n) => n.kind === 'virtual-base'),
      hasOverlays: s.overlayClips.some((x) => !x.disabled),
      hasGraphics: s.textClips.some((x) => !x.disabled) || s.fxClips.some((x) => !x.disabled),
      hasAudioMix: nodes.some((n) => n.kind === 'audio'),
      hasSubtitles: s.subtitles.length > 0,
      hasSpeedChanges,
      hasTransitions,
    },
  };
}
