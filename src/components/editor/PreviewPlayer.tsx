/**
 * PreviewPlayer — 分层合成预览（P3）：
 * 主轨视频（变速/调色/镜像/旋转，单 video 分段顺序播放）
 * → 画中画两轨（关键帧插值，独立 video/img）
 * → 花字/特效舞台（HyperFrames：createFxStage + WAAPI seek，与导出帧同源）
 * → 字幕叠加。
 * 限制：BGM/音效/旁白不在预览混音、倒放仅导出生效（角标提示）。
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { Film, Maximize2, Minimize2, Pause, Play, SkipBack } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import {
  useEditorStore,
  DEFAULT_FX_TRANSFORM,
  type EditorClip, type FxClip, type MaskSettings, type OverlayClip, type OverlayTransform,
} from '@/stores/editorStore';
import { captureEditorSnapshot } from '@/lib/editor/editorHistory';
import { filterToCss } from '@/lib/editor/presets/filterPresets';
import { computeSkipRanges } from '@/lib/editor/speechAudit/apply';
import {
  FX_STAGE_H, FX_STAGE_W, activateFxStage, buildFxClipDoc, buildTextClipDoc, createFxStage, fxClipHash,
  destroyFxStage, seekStage, textClipHash, type FxDoc,
} from '@/lib/editor/fxRender';
import { aspectCssRatio, isPortraitAspect } from '@/lib/editor/aspect';

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const f = Math.floor((sec % 1) * 30);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(f).padStart(2, '0')}`;
}

interface Located { clip: EditorClip; idx: number; local: number; offset: number }

/** 播放头（节目秒）→ 主轨片段 + 片段内时间轴秒 */
function locate(clips: EditorClip[], clipLength: (c: EditorClip) => number, t: number): Located | null {
  let acc = 0;
  for (let i = 0; i < clips.length; i++) {
    const len = clipLength(clips[i]);
    if (t < acc + len || (i === clips.length - 1 && t <= acc + len + 0.001)) {
      return { clip: clips[i], idx: i, local: Math.min(Math.max(0, t - acc), len), offset: acc };
    }
    acc += len;
  }
  return null;
}

/** 画中画关键帧插值（无关键帧用静态 transform；rotation 不参与插值） */
export function ovlTransformAt(o: OverlayClip, local: number): OverlayTransform {
  const kfs = o.keyframes;
  if (!kfs || kfs.length === 0) return o.transform;
  const rot = o.transform.rotation;
  if (local <= kfs[0].t) return { ...kfs[0], rotation: rot };
  const last = kfs[kfs.length - 1];
  if (local >= last.t) return { ...last, rotation: rot };
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i], b = kfs[i + 1];
    if (local >= a.t && local <= b.t) {
      const r = (local - a.t) / Math.max(0.001, b.t - a.t);
      const lerp = (x: number, y: number) => x + (y - x) * r;
      return { x: lerp(a.x, b.x), y: lerp(a.y, b.y), scale: lerp(a.scale, b.scale), opacity: lerp(a.opacity, b.opacity), rotation: rot };
    }
  }
  return o.transform;
}

/** HyperFrames 舞台：挂载一次，localSec 变化用 WAAPI 全量 seek（与导出帧一致） */
function FxStageView({
  hash,
  doc,
  localSec,
  playing,
}: {
  clipId: string;
  label: string;
  kind: 'fx' | 'text';
  hash: string;
  doc: FxDoc;
  localSec: number;
  playing: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const seekRef = useRef(0);

  const applySeek = () => {
    const stage = stageRef.current;
    const host = hostRef.current;
    if (!stage || !host) return;
    const rect = host.getBoundingClientRect();
    const hostW = rect.width || host.clientWidth || 640;
    const hostH = rect.height || host.clientHeight || (hostW * 9 / 16);
    const scale = Math.min(hostW / FX_STAGE_W, hostH / FX_STAGE_H);
    const x = Math.max(0, (hostW - FX_STAGE_W * scale) / 2);
    const y = Math.max(0, (hostH - FX_STAGE_H * scale) / 2);
    stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    seekStage(stage, seekRef.current);
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const stage = createFxStage(doc);
    stage.style.transformOrigin = 'top left';
    host.innerHTML = '';
    host.appendChild(stage);
    activateFxStage(stage);
    stageRef.current = stage;
    const ro = new ResizeObserver(applySeek);
    ro.observe(host);
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(applySeek);
    });
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      destroyFxStage(stage);
      host.replaceChildren();
      stageRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash]);
  useEffect(() => {
    // Paused at exactly 0s is usually the transparent entrance frame. Show a
    // representative frame so newly added page/fx/text clips are visible, while
    // playback still follows the real timeline.
    const previewMs = !playing && localSec < 0.08 ? 900 : Math.max(0, localSec * 1000);
    seekRef.current = previewMs;
    applySeek();
    const raf = requestAnimationFrame(applySeek);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localSec, hash, playing]);
  return <div ref={hostRef} className="absolute inset-0 pointer-events-none overflow-hidden" />;
}

/** 画中画视频：随播放头校准漂移 */
function OverlayVideo({ o, localSec, playing }: { o: OverlayClip; localSec: number; playing: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.volume = Math.max(0, Math.min(1, o.volume ?? 1));
    const want = o.inSec + localSec;
    if (Math.abs(v.currentTime - want) > (playing ? 0.35 : 0.08)) v.currentTime = want;
    if (playing && v.paused) void v.play().catch(() => {});
    if (!playing && !v.paused) v.pause();
  }, [localSec, playing, o.inSec, o.volume]);
  return <video ref={ref} src={convertFileSrc(o.path)} className="w-full h-full object-cover rounded-lg" playsInline />;
}

function maskPreviewStyle(mask?: MaskSettings): CSSProperties {
  if (!mask?.enabled) return {};
  const cx = 50 + mask.x * 100;
  const cy = 50 + mask.y * 100;
  const w = Math.max(1, mask.width * 100);
  const h = Math.max(1, mask.height * 100);
  if (mask.type === 'circle') {
    const rx = Math.max(1, w / 2);
    const ry = Math.max(1, h / 2);
    const img = `radial-gradient(ellipse ${rx}% ${ry}% at ${cx}% ${cy}%, ${mask.invert ? 'transparent' : 'black'} 99%, ${mask.invert ? 'black' : 'transparent'} 100%)`;
    return { WebkitMaskImage: img, maskImage: img };
  }
  if (mask.type === 'linear') {
    const edge = Math.max(0, Math.min(100, cy));
    const img = `linear-gradient(180deg, ${mask.invert ? 'transparent' : 'black'} 0%, ${mask.invert ? 'transparent' : 'black'} ${edge}%, ${mask.invert ? 'black' : 'transparent'} ${edge}%, ${mask.invert ? 'black' : 'transparent'} 100%)`;
    return { WebkitMaskImage: img, maskImage: img };
  }
  if (mask.type === 'mirror') {
    const half = w / 2;
    const l = Math.max(0, cx - half);
    const r = Math.min(100, cx + half);
    const img = `linear-gradient(90deg, ${mask.invert ? 'black' : 'transparent'} 0%, ${mask.invert ? 'black' : 'transparent'} ${l}%, ${mask.invert ? 'transparent' : 'black'} ${l}%, ${mask.invert ? 'transparent' : 'black'} ${r}%, ${mask.invert ? 'black' : 'transparent'} ${r}%, ${mask.invert ? 'black' : 'transparent'} 100%)`;
    return { WebkitMaskImage: img, maskImage: img };
  }
  const l = Math.max(0, cx - w / 2);
  const r = Math.min(100, cx + w / 2);
  const t = Math.max(0, cy - h / 2);
  const b = Math.min(100, cy + h / 2);
  return {
    clipPath: `polygon(${l}% ${t}%, ${r}% ${t}%, ${r}% ${b}%, ${l}% ${b}%)`,
  };
}

function FxTransformControl({ clip, boxRef }: { clip: FxClip; boxRef: RefObject<HTMLDivElement> }) {
  const updateFxClip = useEditorStore((s) => s.updateFxClip);
  const selectFx = useEditorStore((s) => s.selectFx);
  const tr = clip.transform ?? DEFAULT_FX_TRANSFORM;
  const dragRef = useRef<{
    mode: 'move' | 'scale';
    startX: number;
    startY: number;
    base: typeof tr;
  } | null>(null);

  const startDrag = (e: ReactPointerEvent, mode: 'move' | 'scale') => {
    e.preventDefault();
    e.stopPropagation();
    selectFx(clip.id);
    captureEditorSnapshot();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, base: tr };
  };

  const onMove = (e: ReactPointerEvent) => {
    const d = dragRef.current;
    const rect = boxRef.current?.getBoundingClientRect();
    if (!d || !rect) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (d.mode === 'move') {
      updateFxClip(clip.id, {
        transform: {
          ...d.base,
          x: Math.max(-1, Math.min(1, d.base.x + dx / Math.max(1, rect.width))),
          y: Math.max(-1, Math.min(1, d.base.y + dy / Math.max(1, rect.height))),
        },
      });
      return;
    }
    const delta = Math.abs(dx) >= Math.abs(dy) ? dx / Math.max(1, rect.width) : -dy / Math.max(1, rect.height);
    updateFxClip(clip.id, {
      transform: {
        ...d.base,
        scale: Math.max(0.05, Math.min(2, d.base.scale + delta)),
      },
    });
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  return (
    <div
      data-no-box-select
      className="absolute z-30 border border-white/95 rounded-sm cursor-move"
      style={{
        left: `${50 + tr.x * 100}%`,
        top: `${50 + tr.y * 100}%`,
        width: `${Math.max(5, tr.scale * 100)}%`,
        aspectRatio: '16 / 9',
        transform: `translate(-50%, -50%) rotate(${tr.rotation}deg)`,
        boxShadow: '0 0 0 1px rgba(0,0,0,0.35), 0 0 0 2px rgba(255,255,255,0.2)',
      }}
      onPointerDown={(e) => startDrag(e, 'move')}
      onPointerMove={onMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      title="拖动移动特效"
    >
      <div className="absolute left-1 top-1 rounded bg-black/65 px-1.5 py-0.5 text-[9px] leading-none text-white/90 pointer-events-none">
        特效
      </div>
      <div
        className="absolute -right-1.5 -bottom-1.5 h-3 w-3 rounded-full bg-white border border-black/35 cursor-nwse-resize"
        title="拖动缩放特效"
        onPointerDown={(e) => startDrag(e, 'scale')}
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
    </div>
  );
}

export default function PreviewPlayer() {
  const clips = useEditorStore((s) => s.clips);
  const overlayClips = useEditorStore((s) => s.overlayClips);
  const textClips = useEditorStore((s) => s.textClips);
  const fxClips = useEditorStore((s) => s.fxClips);
  const subtitles = useEditorStore((s) => s.subtitles);
  const proxyPaths = useEditorStore((s) => s.proxyPaths);
  const trackStates = useEditorStore((s) => s.trackStates);
  const aspect = useEditorStore((s) => s.aspect);
  const playheadSec = useEditorStore((s) => s.playheadSec);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const previewSkipFindings = useEditorStore((s) => s.previewSkipFindings);
  const speechAudit = useEditorStore((s) => s.speechAudit);
  const speechMinPauseSec = useEditorStore((s) => s.speechMinPauseSec);
  const clipLength = useEditorStore((s) => s.clipLength);
  const totalDuration = useEditorStore((s) => s.totalDuration);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const selectedFxId = useEditorStore((s) => s.selectedFxId);

  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(640);
  const [fullscreen, setFullscreen] = useState(false);
  const lastTickRef = useRef(0);

  const total = totalDuration();
  const loc = useMemo(() => locate(clips, clipLength, playheadSec), [clips, clipLength, playheadSec]);

  // 预览框实宽（fx 舞台 1920 基准缩放用）
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth || 640));
    ro.observe(el);
    setBoxW(el.clientWidth || 640);
    return () => ro.disconnect();
  }, [aspect]);

  // 主 video 与播放头同步（src 切换 / 变速 / 暂停态 scrub）
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !loc) {
      if (v && !v.paused && !loc) v.pause();
      return;
    }
    if (loc.clip.disabled) {
      if (!v.paused) v.pause();
      v.removeAttribute('src');
      v.dataset.src = '';
      v.load();
      return;
    }
    const speed = loc.clip.speed && loc.clip.speed > 0 ? loc.clip.speed : 1;
    const previewPath = proxyPaths[loc.clip.path] || loc.clip.path;
    const src = convertFileSrc(previewPath);
    const want = loc.clip.inSec + loc.local * speed;
    if (v.dataset.src !== src) {
      v.dataset.src = src;
      v.src = src;
      v.currentTime = want;
    } else if (Math.abs(v.currentTime - want) > (isPlaying ? 0.4 : 0.06)) {
      v.currentTime = want;
    }
    v.playbackRate = Math.max(0.1, Math.min(4, speed));
    if (isPlaying && v.paused) void v.play().catch(() => {});
    if (!isPlaying && !v.paused) v.pause();
  }, [loc, isPlaying, proxyPaths]);

  // 播放时钟：主轨段内以 video 为准；主轨外（尾部特效区）按墙钟推进
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    lastTickRef.current = performance.now();
    // 审片预览跳过：播放期间缓存跳过区间（findings/阈值变化由 effect 依赖触发重建）
    const st0 = useEditorStore.getState();
    const skipRanges = st0.previewSkipFindings ? computeSkipRanges(st0.speechMinPauseSec) : [];
    const tick = (now: number) => {
      const st = useEditorStore.getState();
      const dt = Math.min(0.1, (now - lastTickRef.current) / 1000);
      lastTickRef.current = now;
      const tt = st.totalDuration();
      // 播放头落入已标记区间 → 跳到区间尾（不真剪试听成片节奏）
      if (skipRanges.length > 0) {
        const cur = st.playheadSec;
        const hit = skipRanges.find(([a, b]) => cur >= a - 0.02 && cur < b);
        if (hit) {
          st.setPlayhead(hit[1] + 0.001);
          raf = requestAnimationFrame(tick);
          return;
        }
      }
      const l = locate(st.clips, st.clipLength, st.playheadSec);
      const v = videoRef.current;
      const previewPath = l ? (st.proxyPaths[l.clip.path] || l.clip.path) : '';
      if (l && !l.clip.disabled && v && v.readyState >= 2 && v.dataset.src === convertFileSrc(previewPath)) {
        const speed = l.clip.speed && l.clip.speed > 0 ? l.clip.speed : 1;
        if (v.currentTime >= l.clip.outSec - 0.03 || v.ended) {
          st.setPlayhead(l.offset + st.clipLength(l.clip) + 0.001);
        } else {
          st.setPlayhead(l.offset + Math.max(0, (v.currentTime - l.clip.inSec) / speed));
        }
      } else {
        st.setPlayhead(st.playheadSec + dt);
      }
      if (useEditorStore.getState().playheadSec >= tt - 0.02) {
        st.setPlaying(false);
        st.setPlayhead(0);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, previewSkipFindings, speechAudit, speechMinPauseSec]);

  const mainHidden = Boolean(trackStates.main?.hidden);
  const activeOverlays = overlayClips.filter((o) => {
    if (o.disabled || trackStates[`overlay-${o.trackIndex}`]?.hidden) return false;
    const len = Math.max(0.1, o.outSec - o.inSec);
    return playheadSec >= o.startSec && playheadSec < o.startSec + len;
  });
  const activeTexts = trackStates.text?.hidden ? [] : textClips.filter((t) => !t.disabled && playheadSec >= t.startSec && playheadSec < t.endSec);
  const activeFx = trackStates.fx?.hidden ? [] : fxClips.filter((f) => !f.disabled && playheadSec >= f.startSec && playheadSec < f.startSec + f.duration);
  const cue = trackStates.subtitle?.hidden ? undefined : subtitles.find((c) => !c.disabled && playheadSec >= c.startSec && playheadSec < c.endSec);

  useEffect(() => {
    const onFsChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFullscreen(false);
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const toggleFullscreen = async () => {
    const el = rootRef.current;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        setFullscreen(false);
      } else if (el?.requestFullscreen) {
        await el.requestFullscreen();
        setFullscreen(true);
      } else {
        setFullscreen((v) => !v);
      }
    } catch {
      setFullscreen((v) => !v);
    }
  };

  return (
    <div
      ref={rootRef}
      className={`${fullscreen ? 'fixed inset-0 z-[9998] rounded-none' : 'h-full rounded-xl border border-[var(--canvas-node-border)]'} min-h-0 flex flex-col overflow-hidden`}
      style={{ background: '#161616' }}
    >
      <div className="h-9 shrink-0 flex items-center justify-between px-3 border-b border-[rgba(255,255,255,0.055)]" style={{ background: '#232323' }}>
        <span className="text-[12px] font-semibold text-[#f4f4f4]">播放器 - 时间线 01</span>
        <button
          onClick={() => void toggleFullscreen()}
          className="p-1.5 rounded-lg text-[#bdbdbd] hover:text-white hover:bg-[rgba(255,255,255,0.08)] transition-colors"
          title={fullscreen ? '退出全屏' : '全屏预览'}
        >
          {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
      </div>
      <div className={`flex-1 min-h-0 flex flex-col items-center justify-center ${fullscreen ? 'p-0 gap-0' : 'px-3 pt-3 pb-2 gap-2'}`} style={{ background: '#2a2a2a' }}>
      <div
        ref={boxRef}
        data-kunpeng-editor-preview="true"
        className={`relative overflow-hidden min-h-0 ${fullscreen ? 'rounded-none' : 'rounded-lg'}`}
        style={{
          aspectRatio: aspectCssRatio(aspect),
          maxWidth: '100%',
          maxHeight: fullscreen ? '100%' : 'calc(100% - 40px)',
          ...(isPortraitAspect(aspect) ? { height: '100%' } : { width: '100%' }),
          background: '#303030',
          boxShadow: fullscreen ? 'none' : '0 0 0 1px rgba(255,255,255,0.16), 0 10px 28px rgba(0,0,0,0.25)',
        }}
      >
        <div className="absolute inset-0 pointer-events-none" style={{ background: '#303030' }} />
        {clips.length === 0 && total <= 0.05 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[var(--canvas-text-3)]">
            <Film size={22} />
            <span className="text-[11px]">从左侧素材库添加片段</span>
          </div>
        ) : loc && !mainHidden && !loc.clip.disabled ? (
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full"
            style={{
              objectFit: 'contain',
              background: '#303030',
              filter: filterToCss(loc?.clip.filter),
              transform: `${loc?.clip.flipH ? 'scaleX(-1) ' : ''}rotate(${loc?.clip.rotate ?? 0}deg)`,
            }}
            playsInline
          />
        ) : loc?.clip.disabled ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0d0d0d] text-[11px] text-white/45">
            已停用片段
          </div>
        ) : null}
        {loc?.clip.reversed && (
          <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/60 text-white/75 text-[9px] pointer-events-none">倒放 · 导出生效</span>
        )}

        {/* 画中画（轨 1 在下、轨 0 在上） */}
        {[...activeOverlays].sort((a, b) => b.trackIndex - a.trackIndex).map((o) => {
          const local = playheadSec - o.startSec;
          const tr = ovlTransformAt(o, local);
          return (
            <div
              key={o.id}
              className="absolute pointer-events-none"
              style={{
                left: `${50 + tr.x * 100}%`,
                top: `${50 + tr.y * 100}%`,
                width: `${tr.scale * 100}%`,
                transform: `translate(-50%, -50%) rotate(${tr.rotation}deg)`,
                opacity: tr.opacity,
              }}
            >
              <div className="w-full overflow-hidden rounded-lg" style={maskPreviewStyle(o.mask)}>
                {o.kind === 'video'
                  ? <OverlayVideo o={o} localSec={local} playing={isPlaying} />
                  : <img src={convertFileSrc(o.path)} alt="" className="w-full rounded-lg" />}
              </div>
            </div>
          );
        })}

        {/* 特效 / 花字（HyperFrames 舞台） */}
        {activeFx.map((f) => (
          <FxStageView
            key={f.id}
            clipId={f.id}
            label={f.label}
            kind="fx"
            hash={`${f.id}-${fxClipHash(f)}`}
            doc={buildFxClipDoc(f)}
            localSec={playheadSec - f.startSec}
            playing={isPlaying}
          />
        ))}
        {activeTexts.map((t) => (
          <FxStageView
            key={t.id}
            clipId={t.id}
            label={t.text}
            kind="text"
            hash={`${t.id}-${textClipHash(t)}`}
            doc={buildTextClipDoc(t)}
            localSec={playheadSec - t.startSec}
            playing={isPlaying}
          />
        ))}

        {activeFx.filter((f) => f.id === selectedFxId).map((f) => (
          <FxTransformControl key={`${f.id}-control`} clip={f} boxRef={boxRef} />
        ))}

        {/* 字幕 */}
        {cue && (
          <div className="absolute left-0 right-0 flex justify-center pointer-events-none" style={{ bottom: `${cue.style?.y ?? 7}%` }}>
            <span
              className="px-3 py-1 rounded-md text-center"
              style={{
                fontSize: Math.max(10, ((cue.style?.fontSize ?? 24) * boxW) / 960),
                color: cue.style?.color ?? '#ffffff',
                background: 'rgba(0,0,0,0.45)',
                maxWidth: '86%',
                lineHeight: 1.4,
                textShadow: '0 1px 3px rgba(0,0,0,0.8)',
              }}
            >
              {cue.text}
            </span>
          </div>
        )}
      </div>

      {/* 控制条 */}
      <div
        className={`flex items-center justify-center gap-3 shrink-0 ${fullscreen ? 'absolute left-0 right-0 bottom-0 h-14 bg-gradient-to-t from-black/75 to-transparent' : ''}`}
        style={fullscreen ? undefined : { height: 34 }}
      >
        <button
          onClick={() => { setPlaying(false); setPlayhead(0); }}
          className="p-1.5 rounded-lg text-[#d7d7d7] hover:text-white hover:bg-[rgba(255,255,255,0.08)] transition-colors"
          title="回到开头"
        >
          <SkipBack size={15} />
        </button>
        <button
          onClick={() => total > 0 && setPlaying(!isPlaying)}
          disabled={total <= 0}
          className={`${fullscreen ? 'w-10 h-10' : 'w-8 h-8'} rounded-full bg-[#ffffff] text-black flex items-center justify-center hover:bg-[#ffffff] hover:scale-[1.03] transition-transform disabled:opacity-30 shadow-[0_2px_10px_rgba(255,255,255,0.18)]`}
          title="播放 / 暂停（空格）"
        >
          {isPlaying ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
        </button>
        <span className="font-mono text-[11px] tabular-nums">
          <span className="text-[#22d8e6]">{fmt(Math.min(playheadSec, total))}</span>
          <span className="px-1.5 text-[#8a8a8a]">/</span>
          <span className="text-[#f4f4f4]">{fmt(total)}</span>
        </span>
        <button
          onClick={() => void toggleFullscreen()}
          className="p-1.5 rounded-lg text-[#d7d7d7] hover:text-white hover:bg-[rgba(255,255,255,0.08)] transition-colors"
          title={fullscreen ? '退出全屏' : '全屏预览'}
        >
          {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
      </div>
      </div>
    </div>
  );
}
