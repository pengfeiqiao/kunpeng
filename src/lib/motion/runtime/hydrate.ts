/**
 * runtime/hydrate — 扫描 [data-kp-scene-spec]，把 SceneSpec 编译为可逐帧求值的
 * 场景实例（一次性 DOM 准备 + 预编译指令表），renderFrame(t) 每帧零分配。
 *
 * DOM 结构（sceneDoc 生成静态骨架，hydrate 只绑定/补挂动态节点）：
 *   .kp-scene[data-kp-scene-spec-host]
 *     .kp-cam            ← camera tracks 作用于此
 *       .kp-layer[data-kp-layer-id]  × N
 *     .kp-flash          ← 节奏闪白 overlay
 */
import type { SceneLayer, SceneSpec } from '../spec';
import { resolveTimeRef } from '../spec';
import {
  compileTrack, evalTracks, TRACK_DEFAULTS,
  type CompiledTrack, type TrackValues,
} from './evaluate';
import { compileEffects, resetDelta, type EffectDelta, type LayerEffects, type TrailGhost } from './effects';
import { easeOf } from './easing';
import { clamp01 } from './evaluate';

const STAGE_W = 1920;
const STAGE_H = 1080;

interface CompiledLayer {
  el: HTMLElement;
  inSec: number;
  outSec: number;
  parallax: number;
  tracks: CompiledTrack[];
  effects: LayerEffects;
  ghosts: TrailGhost[];
  /** 复用的增量对象（每帧 reset，不分配） */
  delta: EffectDelta;
  values: TrackValues;
}

interface CompiledFlash {
  at: number; dur: number; peak: number; el: HTMLElement;
}

export interface SceneInstance {
  root: HTMLElement;
  duration: number;
  renderFrame(t: number): void;
  dispose(): void;
}

function applyTransform(el: HTMLElement, v: TrackValues, delta: EffectDelta, camX: number, camY: number, parallax: number): void {
  const px = (parallax - 1) * camX;
  const py = (parallax - 1) * camY;
  const x = v.x + delta.dx + px;
  const y = v.y + delta.dy + py;
  const rot = v.rotate + delta.drot;
  const scale = v.scale * delta.dscale;
  el.style.transform =
    `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${rot.toFixed(3)}deg) scale(${(scale * v.scaleX).toFixed(4)}, ${(scale * v.scaleY).toFixed(4)})`;
  el.style.opacity = String(clamp01(v.opacity * delta.opacityMul));
  el.style.clipPath = delta.clipPath ?? '';
  el.style.filter = v.blur > 0.01 ? `blur(${v.blur.toFixed(2)}px)` : '';
}

function compileLayer(spec: SceneSpec, layer: SceneLayer, el: HTMLElement): CompiledLayer {
  const resolveT = (ref: number | string | undefined, fb: number) => resolveTimeRef(ref, spec.beats, fb);
  const tracks = (layer.tracks ?? []).map((tr) => compileTrack(tr, resolveT));
  const effects = compileEffects(layer.effects, { el, resolveT, stageW: STAGE_W, stageH: STAGE_H });
  return {
    el,
    inSec: resolveT(layer.in, 0),
    outSec: resolveT(layer.out, spec.duration),
    parallax: layer.parallax ?? 1,
    tracks,
    effects,
    ghosts: effects.ghosts,
    delta: { dx: 0, dy: 0, drot: 0, dscale: 1, opacityMul: 1, clipPath: null },
    values: { ...TRACK_DEFAULTS } as TrackValues,
  };
}

/** 从宿主元素读取并 hydrate 场景。宿主 = 含 <script type="application/json" data-kp-scene-spec> 的容器 */
export function hydrateScene(host: HTMLElement): SceneInstance | null {
  if ((host as HTMLElement & { __kpSceneInstance?: SceneInstance }).__kpSceneInstance) {
    return (host as HTMLElement & { __kpSceneInstance?: SceneInstance }).__kpSceneInstance!;
  }
  const specEl = host.matches('script[data-kp-scene-spec]')
    ? host
    : host.querySelector('script[data-kp-scene-spec]');
  if (!specEl?.textContent) return null;
  let spec: SceneSpec;
  try {
    spec = JSON.parse(specEl.textContent);
  } catch {
    return null;
  }
  const sceneRoot = host.matches('.kp-scene') ? host : host.querySelector<HTMLElement>('.kp-scene');
  if (!sceneRoot) return null;

  const resolveT = (ref: number | string | undefined, fb: number) => resolveTimeRef(ref, spec.beats, fb);

  // 图层绑定：sceneDoc 已生成 .kp-layer[data-kp-layer-id]（group 展开为扁平 id 路径）
  const layers: CompiledLayer[] = [];
  const bindLayers = (defs: SceneLayer[], prefix: string) => {
    for (const def of defs) {
      const id = prefix ? `${prefix}/${def.id}` : def.id;
      const el = sceneRoot.querySelector<HTMLElement>(`[data-kp-layer-id="${cssEscape(id)}"]`);
      if (el) layers.push(compileLayer(spec, def, el));
      if (def.kind === 'group' && def.children) bindLayers(def.children, id);
    }
  };
  bindLayers(spec.layers, '');

  // 镜头
  const camEl = sceneRoot.querySelector<HTMLElement>('.kp-cam');
  const camTracks = (spec.camera?.tracks ?? []).map((tr) => compileTrack(tr, resolveT));

  // 闪白
  const flashes: CompiledFlash[] = [];
  const flashEl = sceneRoot.querySelector<HTMLElement>('.kp-flash');
  if (flashEl) {
    for (const f of spec.flashes ?? []) {
      flashes.push({
        at: resolveT(f.at, 0),
        dur: f.dur ?? 0.3,
        peak: f.peak ?? 0.75,
        el: flashEl,
      });
      if (f.color) flashEl.style.background = f.color;
    }
  }

  const flashEase = easeOf('outQuad');
  const camValues: TrackValues = { ...TRACK_DEFAULTS } as TrackValues;

  const instance: SceneInstance = {
    root: sceneRoot,
    duration: spec.duration,
    renderFrame(t: number) {
      // 镜头
      let camX = 0; let camY = 0;
      if (camEl) {
        const cv = evalTracks(camTracks, t);
        Object.assign(camValues, cv);
        camX = cv.x; camY = cv.y;
        camEl.style.transform = `translate(${cv.x.toFixed(2)}px, ${cv.y.toFixed(2)}px) rotate(${cv.rotate.toFixed(3)}deg) scale(${cv.scale.toFixed(4)})`;
      }
      // 图层
      for (const layer of layers) {
        const visible = t >= layer.inSec && t < layer.outSec;
        layer.el.style.visibility = visible ? 'visible' : 'hidden';
        if (!visible) {
          for (const g of layer.ghosts) g.el.style.visibility = 'hidden';
          continue;
        }
        const v = evalTracks(layer.tracks, t);
        Object.assign(layer.values, v);
        resetDelta(layer.delta);
        for (const fx of layer.effects.perFrame) fx.apply(t, layer.delta);
        applyTransform(layer.el, layer.values, layer.delta, camX, camY, layer.parallax);
        // 残影：滞后时间重求 tracks（shake 等 perFrame delta 不进残影，保持纯轨迹尾迹）
        for (const g of layer.ghosts) {
          const gt = Math.max(layer.inSec, t - g.lag);
          const gv = evalTracks(layer.tracks, gt);
          g.el.style.visibility = 'visible';
          g.el.style.transform = `translate(${gv.x.toFixed(2)}px, ${gv.y.toFixed(2)}px) rotate(${gv.rotate.toFixed(3)}deg) scale(${(gv.scale * gv.scaleX).toFixed(4)}, ${(gv.scale * gv.scaleY).toFixed(4)})`;
          g.el.style.opacity = String(clamp01(gv.opacity * g.fade));
        }
      }
      // 闪白
      if (flashEl) {
        let peak = 0;
        for (const f of flashes) {
          const local = t - f.at;
          if (local < 0 || local > f.dur) continue;
          const p = local / f.dur;
          const env = p < 0.25 ? p / 0.25 : 1 - flashEase((p - 0.25) / 0.75);
          peak = Math.max(peak, f.peak * env);
        }
        flashEl.style.opacity = String(peak);
      }
    },
    dispose() {
      for (const layer of layers) {
        for (const g of layer.ghosts) g.el.remove();
      }
      delete (host as HTMLElement & { __kpSceneInstance?: SceneInstance }).__kpSceneInstance;
    },
  };
  (host as HTMLElement & { __kpSceneInstance?: SceneInstance }).__kpSceneInstance = instance;
  // 初始帧：先落到 t=0 状态，避免未 seek 前闪原始布局
  instance.renderFrame(0);
  return instance;
}

function cssEscape(s: string): string {
  return s.replace(/["\\\]]/g, '\\$&');
}
