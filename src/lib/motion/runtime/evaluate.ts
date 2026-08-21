/**
 * runtime/evaluate — 关键帧轨道求值（纯函数核心）。
 *
 * 语义：kf[i] 上的 ease/spring 描述"从 kf[i-1] 过渡到 kf[i]"的方式；
 * spring 用真实经过秒数的闭式解，最后一段的弹簧过冲在段结束后继续收敛可见。
 */
import type { Keyframe, Track, TrackProp } from '../spec';
import { easeOf, springDecay } from './easing';

export interface CompiledKeyframe {
  t: number;
  v: number;
  ease?: Keyframe['ease'];
  spring?: Keyframe['spring'];
}

export interface CompiledTrack {
  prop: TrackProp;
  kf: CompiledKeyframe[];
}

export const TRACK_DEFAULTS: Record<TrackProp, number> = {
  x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, blur: 0,
};

export function evalTrack(kf: CompiledKeyframe[], t: number): number {
  if (kf.length === 0) return 0;
  if (t <= kf[0].t) return kf[0].v;
  const last = kf[kf.length - 1];
  if (t >= last.t) {
    // 最后一段是弹簧时，过冲尾巴在段结束后继续收敛
    if (last.spring && kf.length >= 2) {
      const prev = kf[kf.length - 2];
      return last.v + (prev.v - last.v) * springDecay(t - prev.t, last.spring);
    }
    return last.v;
  }
  for (let i = 1; i < kf.length; i++) {
    if (t < kf[i].t) {
      const prev = kf[i - 1];
      const cur = kf[i];
      if (cur.spring) {
        return cur.v + (prev.v - cur.v) * springDecay(t - prev.t, cur.spring);
      }
      const span = Math.max(1e-6, cur.t - prev.t);
      const p = (t - prev.t) / span;
      return prev.v + (cur.v - prev.v) * easeOf(cur.ease)(p);
    }
  }
  return last.v;
}

export interface TrackValues {
  x: number; y: number; scale: number; scaleX: number; scaleY: number;
  rotate: number; opacity: number; blur: number;
}

export function evalTracks(tracks: CompiledTrack[], t: number): TrackValues {
  const out: TrackValues = { ...TRACK_DEFAULTS } as TrackValues;
  for (const tr of tracks) {
    (out as unknown as Record<string, number>)[tr.prop] = evalTrack(tr.kf, t);
  }
  return out;
}

/** 排序 + TimeRef 已解析后的 Track 编译 */
export function compileTrack(track: Track, resolveT: (ref: number | string | undefined, fb: number) => number): CompiledTrack {
  const kf = track.kf
    .map((k) => ({ t: resolveT(k.t, 0), v: k.v, ease: k.ease, spring: k.spring }))
    .sort((a, b) => a.t - b.t);
  return { prop: track.prop, kf };
}

export function clamp01(p: number): number {
  return p < 0 ? 0 : p > 1 ? 1 : p;
}
