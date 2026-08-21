/**
 * runtime/effects — 运动原语求值：kineticText / maskReveal / shake / lineDraw /
 * numberRoll / trail / magnify。
 *
 * 每个原语分两段：prepare（hydrate 期一次性 DOM 准备，可分配）
 * 和 apply（每帧调用，禁分配、只写 style）。
 */
import type {
  BreatheEffect, FlickerEffect, GlitchEffect, GradientShiftEffect, JitterEffect,
  KineticTextEffect, LineDrawEffect, LiquidBlobEffect, MagnifyEffect,
  MaskRevealEffect, NumberRollEffect, OrbitEffect, PathMoveEffect,
  ScanRevealEffect, SceneEffect, ShakeEffect, ShineEffect, SliceInEffect,
  TrailEffect, TypewriterEffect, WaveTextEffect,
} from '../spec';
import { easeOf, springDecay } from './easing';
import { clamp01 } from './evaluate';
import { seededSines, type NoiseFn } from './noise';
import { splitText } from './text';

/** 每帧对图层根元素的增量输出（叠加到 tracks 的基础值上） */
export interface EffectDelta {
  dx: number; dy: number; drot: number; dscale: number;
  opacityMul: number;
  clipPath: string | null;
}

export function resetDelta(d: EffectDelta): void {
  d.dx = 0; d.dy = 0; d.drot = 0; d.dscale = 1; d.opacityMul = 1; d.clipPath = null;
}

export interface CompiledEffect {
  /** 每帧调用：t 为场景秒；delta 为图层根的累积增量 */
  apply(t: number, delta: EffectDelta): void;
}

interface CompileCtx {
  el: HTMLElement;
  resolveT(ref: number | string | undefined, fb: number): number;
  stageW: number;
  stageH: number;
}

// ── kineticText ───────────────────────────────────────────────────────────────

function compileKineticText(fx: KineticTextEffect, ctx: CompileCtx): CompiledEffect {
  const units = splitText(ctx.el, fx.split ?? 'char');
  const at = ctx.resolveT(fx.at, 0);
  const dur = fx.dur ?? 0.5;
  const stagger = fx.stagger ?? 0.045;
  const from = { x: 0, y: 60, rotate: 0, scale: 1, opacity: 0, ...(fx.from ?? {}) };
  const ease = easeOf(fx.ease ?? 'outBack');
  const spring = fx.spring;
  return {
    apply(t) {
      for (let i = 0; i < units.length; i++) {
        const local = t - at - i * stagger;
        let p: number;
        if (spring) {
          p = local <= 0 ? 0 : 1 - springDecay(local, spring);
        } else {
          p = ease(clamp01(local / Math.max(1e-6, dur)));
        }
        const inv = 1 - p;
        const s = units[i].el.style;
        s.transform = `translate(${(from.x * inv).toFixed(2)}px, ${(from.y * inv).toFixed(2)}px) rotate(${(from.rotate * inv).toFixed(2)}deg) scale(${(1 + (from.scale - 1) * inv).toFixed(4)})`;
        s.opacity = String(clamp01(from.opacity + (1 - from.opacity) * clamp01(p)));
      }
    },
  };
}

// ── maskReveal ────────────────────────────────────────────────────────────────

function compileMaskReveal(fx: MaskRevealEffect, ctx: CompileCtx): CompiledEffect {
  const at = ctx.resolveT(fx.at, 0);
  const dur = fx.dur ?? 0.6;
  const dir = fx.dir ?? 'left';
  const ease = easeOf(fx.ease ?? 'outExpo');
  const isOut = Boolean(fx.out);
  return {
    apply(t, delta) {
      let p = ease(clamp01((t - at) / Math.max(1e-6, dur)));
      if (isOut) p = 1 - p;
      const hide = ((1 - p) * 100).toFixed(2);
      switch (dir) {
        case 'left': delta.clipPath = `inset(0 ${hide}% 0 0)`; break;
        case 'right': delta.clipPath = `inset(0 0 0 ${hide}%)`; break;
        case 'top': delta.clipPath = `inset(0 0 ${hide}% 0)`; break;
        case 'bottom': delta.clipPath = `inset(${hide}% 0 0 0)`; break;
        case 'center': delta.clipPath = `circle(${(p * 75).toFixed(2)}% at 50% 50%)`; break;
      }
    },
  };
}

// ── shake ─────────────────────────────────────────────────────────────────────

function compileShake(fx: ShakeEffect, ctx: CompileCtx): CompiledEffect {
  const at = ctx.resolveT(fx.at, 0);
  const dur = fx.dur ?? 0.35;
  const amp = fx.amp ?? 12;
  const freq = fx.freq ?? 18;
  const rotAmp = fx.rotAmp ?? amp / 10;
  const seed = fx.seed ?? 1;
  const nx: NoiseFn = seededSines(seed, freq);
  const ny: NoiseFn = seededSines(seed + 101, freq * 1.13);
  const nr: NoiseFn = seededSines(seed + 202, freq * 0.87);
  return {
    apply(t, delta) {
      const local = t - at;
      if (local < 0 || local > dur) return;
      // 包络：快起慢收
      const env = Math.sin(Math.PI * clamp01(local / dur)) ** 0.7;
      delta.dx += nx(local) * amp * env;
      delta.dy += ny(local) * amp * env;
      delta.drot += nr(local) * rotAmp * env;
    },
  };
}

// ── lineDraw ──────────────────────────────────────────────────────────────────

interface DrawPath { el: SVGGeometryElement; len: number }

function compileLineDraw(fx: LineDrawEffect, ctx: CompileCtx): CompiledEffect {
  const at = ctx.resolveT(fx.at, 0);
  const dur = fx.dur ?? 0.9;
  const stagger = fx.stagger ?? 0.08;
  const ease = easeOf(fx.ease ?? 'inOutCubic');
  const paths: DrawPath[] = [];
  const nodes = ctx.el.querySelectorAll<SVGGeometryElement>('path, circle, ellipse, line, polyline, polygon, rect');
  nodes.forEach((el) => {
    let len = 0;
    try { len = el.getTotalLength(); } catch { len = 0; }
    if (!len || !Number.isFinite(len)) len = 1000;
    el.style.strokeDasharray = `${len}`;
    el.style.strokeDashoffset = `${len}`;
    paths.push({ el, len });
  });
  return {
    apply(t) {
      for (let i = 0; i < paths.length; i++) {
        const p = ease(clamp01((t - at - i * stagger) / Math.max(1e-6, dur)));
        paths[i].el.style.strokeDashoffset = `${(paths[i].len * (1 - p)).toFixed(2)}`;
      }
    },
  };
}

// ── numberRoll ────────────────────────────────────────────────────────────────

function formatNumber(v: number, fx: NumberRollEffect): string {
  const decimals = fx.decimals ?? 0;
  const prefix = fx.prefix ?? '';
  const suffix = fx.suffix ?? '';
  let body: string;
  switch (fx.format ?? 'plain') {
    case 'comma':
      body = v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
      break;
    case 'compact-cn': {
      const abs = Math.abs(v);
      if (abs >= 1e8) body = `${(v / 1e8).toFixed(abs >= 1e9 ? 0 : 1)}亿`;
      else if (abs >= 1e4) body = `${(v / 1e4).toFixed(abs >= 1e5 ? 0 : 1)}万`;
      else body = `${Math.round(v)}`;
      break;
    }
    case 'percent':
      body = `${v.toFixed(decimals)}%`;
      break;
    default:
      body = v.toFixed(decimals);
  }
  return `${prefix}${body}${suffix}`;
}

function compileNumberRoll(fx: NumberRollEffect, ctx: CompileCtx): CompiledEffect {
  const at = ctx.resolveT(fx.at, 0);
  const dur = fx.dur ?? 1.2;
  const from = fx.from ?? 0;
  const to = fx.to;
  const ease = easeOf(fx.ease ?? 'outExpo');
  // 数字写进第一个 .kp-num-value（sceneDoc 生成）或元素本身
  const target = ctx.el.querySelector<HTMLElement>('.kp-num-value') ?? ctx.el;
  return {
    apply(t) {
      const p = ease(clamp01((t - at) / Math.max(1e-6, dur)));
      target.textContent = formatNumber(from + (to - from) * p, fx);
    },
  };
}

// ── trail ─────────────────────────────────────────────────────────────────────

export interface TrailGhost {
  el: HTMLElement;
  lag: number;
  fade: number;
}

function compileTrail(fx: TrailEffect, ctx: CompileCtx): { ghosts: TrailGhost[] } {
  const copies = Math.max(1, Math.min(4, fx.copies ?? 3));
  const lag = fx.lag ?? 0.06;
  const fade = fx.fade ?? 0.5;
  const ghosts: TrailGhost[] = [];
  const parent = ctx.el.parentElement;
  if (!parent) return { ghosts };
  for (let i = 1; i <= copies; i++) {
    const ghost = ctx.el.cloneNode(true) as HTMLElement;
    ghost.setAttribute('aria-hidden', 'true');
    ghost.classList.add('kp-trail-ghost');
    ghost.style.pointerEvents = 'none';
    parent.insertBefore(ghost, ctx.el);
    ghosts.push({ el: ghost, lag: lag * i, fade: Math.pow(fade, i) });
  }
  return { ghosts };
}

// ── magnify ───────────────────────────────────────────────────────────────────

function coordPx(v: number | string, total: number): number {
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (s.endsWith('%')) return (parseFloat(s) / 100) * total;
  return parseFloat(s) || 0;
}

function compileMagnify(fx: MagnifyEffect, ctx: CompileCtx): CompiledEffect {
  const at = ctx.resolveT(fx.at, 0);
  const dur = fx.dur ?? 1.5;
  const cx = coordPx(fx.region.x, ctx.stageW);
  const cy = coordPx(fx.region.y, ctx.stageH);
  const r = fx.region.r;
  const dim = fx.dim ?? 0.45;
  const color = fx.color ?? 'var(--fx-accent)';
  // 结构：暗化遮罩（镂空圆）+ 圈环
  const doc = ctx.el.ownerDocument;
  const overlay = doc.createElement('div');
  overlay.className = 'kp-magnify-dim';
  overlay.style.cssText = `position:absolute;inset:0;pointer-events:none;background:rgba(0,0,0,${dim});opacity:0;`;
  const ring = doc.createElement('div');
  ring.className = 'kp-magnify-ring';
  ring.style.cssText = `position:absolute;left:${cx - r}px;top:${cy - r}px;width:${r * 2}px;height:${r * 2}px;border:6px solid ${color};border-radius:50%;box-shadow:0 0 40px rgba(0,0,0,0.4);pointer-events:none;opacity:0;`;
  ctx.el.appendChild(overlay);
  ctx.el.appendChild(ring);
  const easeIn = easeOf('outCubic');
  return {
    apply(t) {
      const local = t - at;
      const inP = easeIn(clamp01(local / 0.35));
      const outP = easeIn(clamp01((local - dur + 0.3) / 0.3));
      const vis = local < 0 ? 0 : inP * (1 - outP);
      overlay.style.opacity = String(vis);
      // 镂空圆用 radial-gradient 遮罩（clip-path 反选在 Chromium 上支持有限）
      overlay.style.webkitMaskImage = `radial-gradient(circle ${r}px at ${cx}px ${cy}px, transparent 98%, #000 100%)`;
      overlay.style.maskImage = `radial-gradient(circle ${r}px at ${cx}px ${cy}px, transparent 98%, #000 100%)`;
      ring.style.opacity = String(vis);
      const pulse = 1 + 0.03 * Math.sin(Math.max(0, local) * Math.PI * 2 * 1.2);
      ring.style.transform = `scale(${(vis > 0 ? pulse : 0.9).toFixed(4)})`;
    },
  };
}

// ── typewriter ────────────────────────────────────────────────────────────────

function compileTypewriter(fx: TypewriterEffect, ctx: CompileCtx): CompiledEffect {
  const units = splitText(ctx.el, 'char');
  const at = ctx.resolveT(fx.at, 0);
  const charDur = fx.charDur ?? 0.06;
  const useCursor = fx.cursor !== false;
  let cursor: HTMLElement | null = null;
  if (useCursor) {
    cursor = ctx.el.ownerDocument.createElement('span');
    cursor.className = 'kp-tw-cursor';
    cursor.style.cssText = `display:inline-block;width:0.08em;height:1em;vertical-align:-0.12em;background:${fx.cursorColor ?? 'var(--fx-accent)'};margin-left:0.05em;`;
    ctx.el.appendChild(cursor);
  }
  const totalDur = units.length * charDur;
  return {
    apply(t) {
      const local = t - at;
      const shown = local <= 0 ? 0 : Math.min(units.length, Math.floor(local / charDur) + 1);
      for (let i = 0; i < units.length; i++) {
        units[i].el.style.opacity = i < shown ? '1' : '0';
      }
      if (cursor) {
        // t 驱动方波闪烁（1.1Hz）；打完后再闪 1.2s 熄灭
        const done = local - totalDur;
        const blink = Math.floor(Math.max(0, local) * 2.2) % 2 === 0 ? 1 : 0;
        cursor.style.opacity = local < 0 || done > 1.2 ? '0' : String(blink);
      }
    },
  };
}

// ── glitch（RGB 分离 + 水平切片抖动） ─────────────────────────────────────────

function compileGlitch(fx: GlitchEffect, ctx: CompileCtx): CompiledEffect {
  const at = ctx.resolveT(fx.at, 0);
  const dur = fx.dur ?? 0.5;
  const amp = fx.amp ?? 6;
  const freq = fx.freq ?? 14;
  const seed = fx.seed ?? 1;
  // 两个色偏残影副本（红/青），叠在原元素后面
  const parent = ctx.el.parentElement;
  const copies: HTMLElement[] = [];
  if (parent) {
    for (const [color, cls] of [['rgba(255,0,64,0.8)', 'kp-glitch-r'], ['rgba(0,224,255,0.8)', 'kp-glitch-c']] as const) {
      const ghost = ctx.el.cloneNode(true) as HTMLElement;
      ghost.setAttribute('aria-hidden', 'true');
      ghost.classList.add(cls);
      ghost.style.pointerEvents = 'none';
      ghost.style.color = color;
      ghost.style.opacity = '0';
      parent.insertBefore(ghost, ctx.el);
      copies.push(ghost);
    }
  }
  const nx = seededSines(seed, freq);
  const nSlice = seededSines(seed + 51, freq * 1.6);
  return {
    apply(t, delta) {
      const local = t - at;
      const active = local >= 0 && local <= dur;
      // 包络：突发式（前 20% 强、渐弱）
      const env = active ? Math.pow(1 - local / dur, 0.6) : 0;
      for (let i = 0; i < copies.length; i++) {
        const dir = i === 0 ? 1 : -1;
        copies[i].style.opacity = String(0.75 * env);
        copies[i].style.transform = `translate(${(nx(local + i) * amp * dir * env).toFixed(2)}px, 0)`;
      }
      if (active) {
        // 主体水平切片：clip 一条随机高度带并横移
        const bandY = (nSlice(local) * 0.5 + 0.5) * 80;
        const bandH = 12 + (nx(local * 1.3) * 0.5 + 0.5) * 18;
        delta.dx += nx(local * 2.1) * amp * 0.6 * env;
        if (Math.floor(local * freq) % 3 === 0) {
          delta.clipPath = `inset(${bandY.toFixed(1)}% 0 ${Math.max(0, 100 - bandY - bandH).toFixed(1)}% 0)`;
        }
      }
    },
  };
}

// ── shine（光带扫过，文字/卡片高光） ──────────────────────────────────────────

function compileShine(fx: ShineEffect, ctx: CompileCtx): CompiledEffect {
  const at = ctx.resolveT(fx.at, 0);
  const dur = fx.dur ?? 1.1;
  const every = fx.every ?? 0;
  const angle = fx.angle ?? 115;
  const strength = fx.strength ?? 0.5;
  const doc = ctx.el.ownerDocument;
  const band = doc.createElement('div');
  band.className = 'kp-shine-band';
  band.style.cssText = `position:absolute;inset:-10%;pointer-events:none;opacity:0;mix-blend-mode:screen;background:linear-gradient(${angle}deg, transparent 42%, rgba(255,255,255,${strength}) 50%, transparent 58%);background-size:280% 280%;`;
  ctx.el.appendChild(band);
  const ease = easeOf('inOutCubic');
  return {
    apply(t) {
      let local = t - at;
      if (every > 0 && local > 0) local = local % Math.max(every, dur);
      const p = local < 0 || local > dur ? -1 : ease(clamp01(local / dur));
      if (p < 0) { band.style.opacity = '0'; return; }
      band.style.opacity = '1';
      band.style.backgroundPosition = `${(100 - p * 200).toFixed(2)}% 50%`;
    },
  };
}

// ── gradientShift（渐变流动：文字渐变填充或背景流动） ─────────────────────────

function compileGradientShift(fx: GradientShiftEffect, ctx: CompileCtx): CompiledEffect {
  const period = Math.max(1, fx.period ?? 6);
  const angle = fx.angle ?? 120;
  const colors = fx.colors?.length ? fx.colors : ['var(--fx-accent)', 'var(--fx-accent2)'];
  const mode = fx.mode ?? 'text';
  const stops = [...colors, colors[0]].join(', ');
  const el = ctx.el;
  el.style.backgroundImage = `linear-gradient(${angle}deg, ${stops})`;
  el.style.backgroundSize = '300% 300%';
  if (mode === 'text') {
    el.style.webkitBackgroundClip = 'text';
    el.style.backgroundClip = 'text';
    el.style.webkitTextFillColor = 'transparent';
    el.style.color = 'transparent';
  }
  return {
    apply(t) {
      const p = (t % period) / period;
      el.style.backgroundPosition = `${(p * 200).toFixed(2)}% 50%`;
    },
  };
}

// ── pathMove（二次贝塞尔路径运动） ────────────────────────────────────────────

function compilePathMove(fx: PathMoveEffect, ctx: CompileCtx): CompiledEffect {
  const at = ctx.resolveT(fx.at, 0);
  const dur = fx.dur ?? 1.5;
  const ease = easeOf(fx.ease ?? 'inOutCubic');
  const { via, to } = fx;
  const orient = Boolean(fx.orient);
  return {
    apply(t, delta) {
      const p = ease(clamp01((t - at) / Math.max(1e-6, dur)));
      const inv = 1 - p;
      // 二次贝塞尔 B(p) = (1-p)²·0 + 2(1-p)p·via + p²·to
      delta.dx += 2 * inv * p * via.x + p * p * to.x;
      delta.dy += 2 * inv * p * via.y + p * p * to.y;
      if (orient) {
        // 切线 B'(p) = 2(1-p)(via-0) + 2p(to-via)
        const tx = 2 * inv * via.x + 2 * p * (to.x - via.x);
        const ty = 2 * inv * via.y + 2 * p * (to.y - via.y);
        delta.drot += Math.atan2(ty, tx) * (180 / Math.PI);
      }
    },
  };
}

// ── waveText（逐字持续波浪浮动——入场后保持"活字"生命感） ─────────────────────

function compileWaveText(fx: WaveTextEffect, ctx: CompileCtx): CompiledEffect {
  const units = splitText(ctx.el, 'char');
  const at = ctx.resolveT(fx.at, 0);
  const amp = fx.amp ?? 10;
  const period = Math.max(0.5, fx.period ?? 2.4);
  const phaseStep = fx.phaseStep ?? 0.12;
  const rotAmp = fx.rotAmp ?? 0;
  const TWO_PI = Math.PI * 2;
  // 与 kineticText 共存：wave 写在内层 wrapper（splitText 幂等复用同一批 unit，
  // 但 transform 会互相覆盖），所以 wave 给每个 unit 再包一层。
  const inner: HTMLElement[] = units.map((u) => {
    const w = ctx.el.ownerDocument.createElement('span');
    w.style.display = 'inline-block';
    while (u.el.firstChild) w.appendChild(u.el.firstChild);
    u.el.appendChild(w);
    return w;
  });
  return {
    apply(t) {
      const local = t - at;
      // 入场前静止；入场后 0.6s 内幅度渐起，避免与入场动画打架
      const ramp = local <= 0 ? 0 : clamp01(local / 0.6);
      for (let i = 0; i < inner.length; i++) {
        const ph = TWO_PI * ((local / period) - i * phaseStep);
        const dy = Math.sin(ph) * amp * ramp;
        const rot = rotAmp ? Math.sin(ph + 0.7) * rotAmp * ramp : 0;
        inner[i].style.transform = rot
          ? `translateY(${dy.toFixed(2)}px) rotate(${rot.toFixed(2)}deg)`
          : `translateY(${dy.toFixed(2)}px)`;
      }
    },
  };
}

// ── flicker（霓虹灯管点亮：不稳定闪烁 → 稳定微闪） ───────────────────────────

function compileFlicker(fx: FlickerEffect, ctx: CompileCtx): CompiledEffect {
  const at = ctx.resolveT(fx.at, 0);
  const dur = Math.max(0.2, fx.dur ?? 1.2);
  const idle = fx.idle ?? 0.08;
  const off = fx.off != null ? ctx.resolveT(fx.off, Infinity) : Infinity;
  const seed = fx.seed ?? 1;
  const n = seededSines(seed, 13);
  const nFast = seededSines(seed + 77, 31);
  return {
    apply(t, delta) {
      if (t < at) { delta.opacityMul = 0; return; }
      if (t >= off) { delta.opacityMul *= clamp01(1 - (t - off) / 0.12); return; }
      const local = t - at;
      if (local < dur) {
        // 点亮期：阶梯突变 + 高频噪声，越接近点亮越稳定
        const stability = local / dur;
        const spike = n(local) * 0.5 + nFast(local * 1.7) * 0.5;
        const gate = spike > (0.55 - stability * 0.9) ? 1 : 0.12 + stability * 0.3;
        delta.opacityMul *= gate;
      } else {
        // 稳定期：轻微亮度呼吸
        delta.opacityMul *= 1 - Math.max(0, n(local * 0.6)) * idle;
      }
    },
  };
}

// ── scanReveal（扫描亮线扫过揭示——全息/科技） ────────────────────────────────

function compileScanReveal(fx: ScanRevealEffect, ctx: CompileCtx): CompiledEffect {
  const at = ctx.resolveT(fx.at, 0);
  const dur = fx.dur ?? 0.9;
  const dir = fx.dir ?? 'top';
  const color = fx.color ?? 'var(--fx-accent)';
  const lineWidth = fx.lineWidth ?? 3;
  const glow = fx.glow !== false;
  const ease = easeOf(fx.ease ?? 'inOutCubic');
  const doc = ctx.el.ownerDocument;
  const line = doc.createElement('div');
  line.className = 'kp-scan-line';
  const vertical = dir === 'top' || dir === 'bottom';
  line.style.cssText = [
    'position:absolute', 'pointer-events:none', 'opacity:0',
    vertical ? `left:-6%;right:-6%;height:${lineWidth}px` : `top:-6%;bottom:-6%;width:${lineWidth}px`,
    `background:${color}`,
    glow ? `box-shadow:0 0 18px ${color},0 0 46px ${color}` : '',
  ].filter(Boolean).join(';');
  ctx.el.appendChild(line);
  return {
    apply(t, delta) {
      const p = ease(clamp01((t - at) / Math.max(1e-6, dur)));
      const pct = (p * 100);
      switch (dir) {
        case 'top': delta.clipPath = `inset(0 0 ${(100 - pct).toFixed(2)}% 0)`; break;
        case 'bottom': delta.clipPath = `inset(${(100 - pct).toFixed(2)}% 0 0 0)`; break;
        case 'left': delta.clipPath = `inset(0 ${(100 - pct).toFixed(2)}% 0 0)`; break;
        case 'right': delta.clipPath = `inset(0 0 0 ${(100 - pct).toFixed(2)}%)`; break;
      }
      const active = p > 0.001 && p < 0.999;
      line.style.opacity = active ? '1' : '0';
      if (active) {
        if (vertical) line.style.top = `${pct.toFixed(2)}%`;
        else line.style.left = `${pct.toFixed(2)}%`;
      }
    },
  };
}

// ── liquidBlob（border-radius 有机形变循环——流体/Y2K/AI） ────────────────────

function compileLiquidBlob(fx: LiquidBlobEffect, ctx: CompileCtx): CompiledEffect {
  const period = Math.max(2, fx.period ?? 8);
  const amount = clamp01(fx.amount ?? 0.35);
  const seed = fx.seed ?? 1;
  // 8 个角向半径各自独立的慢噪声（4 角 × 水平/垂直）
  const fns: NoiseFn[] = [];
  for (let i = 0; i < 8; i++) fns.push(seededSines(seed + i * 37, 1 / period));
  const el = ctx.el;
  return {
    apply(t) {
      const r = (i: number) => (50 + fns[i](t) * 25 * amount * 2).toFixed(1);
      el.style.borderRadius =
        `${r(0)}% ${r(1)}% ${r(2)}% ${r(3)}% / ${r(4)}% ${r(5)}% ${r(6)}% ${r(7)}%`;
    },
  };
}

// ── orbit（椭圆轨道持续运动——装饰粒子/几何环绕） ─────────────────────────────

function compileOrbit(fx: OrbitEffect, ctx: CompileCtx): CompiledEffect {
  const at = ctx.resolveT(fx.at, 0);
  const period = Math.max(0.5, fx.period ?? 6);
  const rx = fx.rx ?? 120;
  const ry = fx.ry ?? rx * 0.6;
  const phase0 = (fx.phase ?? 0) * Math.PI * 2;
  const sign = fx.dir === 'ccw' ? -1 : 1;
  const depth = Boolean(fx.depth);
  const TWO_PI = Math.PI * 2;
  return {
    apply(t, delta) {
      const ph = phase0 + sign * TWO_PI * ((t - at) / period);
      delta.dx += Math.cos(ph) * rx;
      delta.dy += Math.sin(ph) * ry;
      if (depth) {
        // sin(ph)>0 视为轨道近端：放大 + 保持不透明；远端缩小变淡
        const near = (Math.sin(ph) + 1) / 2;
        delta.dscale *= 0.75 + near * 0.5;
        delta.opacityMul *= 0.55 + near * 0.45;
      }
    },
  };
}

// ── sliceIn（切片错位拼装入场——数据科技/赛博） ───────────────────────────────

function compileSliceIn(fx: SliceInEffect, ctx: CompileCtx): CompiledEffect {
  const at = ctx.resolveT(fx.at, 0);
  const dur = fx.dur ?? 0.7;
  const count = Math.max(2, Math.min(8, fx.slices ?? 4));
  const offset = fx.offset ?? 90;
  const horizontal = (fx.dir ?? 'h') === 'h';
  const ease = easeOf(fx.ease ?? 'outExpo');
  const seed = fx.seed ?? 1;
  const rand = ((s: number) => { // 构造期一次性伪随机（方向/幅度表）
    let a = Math.floor(s * 2654435761) >>> 0;
    return () => {
      a = (a * 1664525 + 1013904223) >>> 0;
      return a / 4294967296;
    };
  })(seed);
  // 用 N 份克隆各显示一条水平/垂直带，实现切片错位（原元素隐藏内容、只留占位）
  const parent = ctx.el;
  const doc = parent.ownerDocument;
  const holder = doc.createElement('div');
  holder.style.cssText = 'position:absolute;inset:0;pointer-events:none';
  const slices: { el: HTMLElement; dir: number; mag: number }[] = [];
  const src = parent.cloneNode(true) as HTMLElement;
  src.style.position = 'absolute';
  src.style.inset = '0';
  for (let i = 0; i < count; i++) {
    const s = src.cloneNode(true) as HTMLElement;
    const a = (i / count * 100).toFixed(2);
    const b = (100 - (i + 1) / count * 100).toFixed(2);
    s.style.clipPath = horizontal ? `inset(${a}% 0 ${b}% 0)` : `inset(0 ${b}% 0 ${a}%)`;
    s.setAttribute('aria-hidden', 'true');
    holder.appendChild(s);
    slices.push({ el: s, dir: rand() > 0.5 ? 1 : -1, mag: 0.6 + rand() * 0.8 });
  }
  // 原内容藏起来（保留布局占位），由切片副本代显
  const originals: { el: HTMLElement; vis: string }[] = [];
  for (const child of Array.from(parent.children)) {
    if (child === holder) continue;
    const el = child as HTMLElement;
    originals.push({ el, vis: el.style.visibility });
    el.style.visibility = 'hidden';
  }
  parent.appendChild(holder);
  return {
    apply(t) {
      const p = ease(clamp01((t - at) / Math.max(1e-6, dur)));
      const inv = 1 - p;
      const done = p >= 0.999;
      // 拼装完成后恢复原内容、藏切片（避免克隆副本参与后续效果时错位）
      for (const o of originals) o.el.style.visibility = done ? o.vis || '' : 'hidden';
      holder.style.visibility = done ? 'hidden' : 'visible';
      if (done) return;
      for (const s of slices) {
        const d = s.dir * s.mag * offset * inv;
        s.el.style.transform = horizontal ? `translateX(${d.toFixed(2)}px)` : `translateY(${d.toFixed(2)}px)`;
        s.el.style.opacity = String(clamp01(p * 2));
      }
    },
  };
}

// ── breathe（微缩放+辉光呼吸循环——待机高级感） ───────────────────────────────

function compileBreathe(fx: BreatheEffect, ctx: CompileCtx): CompiledEffect {
  const at = ctx.resolveT(fx.at, 0);
  const period = Math.max(1, fx.period ?? 3.6);
  const amount = fx.amount ?? 0.02;
  const glowColor = fx.glowColor;
  const glowRadius = fx.glowRadius ?? 26;
  const el = ctx.el;
  const TWO_PI = Math.PI * 2;
  return {
    apply(t, delta) {
      const local = t - at;
      if (local < 0) return;
      const ramp = clamp01(local / 1.2);
      const s = Math.sin(TWO_PI * local / period);
      delta.dscale *= 1 + s * amount * ramp;
      if (glowColor) {
        const r = (glowRadius * (0.55 + (s + 1) / 2 * 0.45) * ramp).toFixed(1);
        el.style.filter = `drop-shadow(0 0 ${r}px ${glowColor})`;
      }
    },
  };
}

// ── jitter（持续微抖——acid/复古印刷躁动） ────────────────────────────────────

function compileJitter(fx: JitterEffect, ctx: CompileCtx): CompiledEffect {
  const at = ctx.resolveT(fx.at, 0);
  const until = fx.until != null ? ctx.resolveT(fx.until, Infinity) : Infinity;
  const amp = fx.amp ?? 2.5;
  const freq = Math.max(1, fx.freq ?? 9);
  const rotAmp = fx.rotAmp ?? 0.8;
  const seed = fx.seed ?? 1;
  const nx = seededSines(seed, freq * 0.9);
  const ny = seededSines(seed + 53, freq * 1.1);
  const nr = seededSines(seed + 107, freq * 0.7);
  return {
    apply(t, delta) {
      if (t < at || t > until) return;
      // 阶梯量化：把连续噪声采样在 1/freq 的网格上 → 硬切换位感（stop-motion）
      const q = Math.floor((t - at) * freq) / freq;
      delta.dx += nx(q) * amp;
      delta.dy += ny(q) * amp;
      delta.drot += nr(q) * rotAmp;
    },
  };
}

// ── 汇总编译 ──────────────────────────────────────────────────────────────────
export interface LayerEffects {
  perFrame: CompiledEffect[];
  ghosts: TrailGhost[];
}

export function compileEffects(effects: SceneEffect[] | undefined, ctx: CompileCtx): LayerEffects {
  const perFrame: CompiledEffect[] = [];
  const ghosts: TrailGhost[] = [];
  for (const fx of effects ?? []) {
    switch (fx.type) {
      case 'kineticText': perFrame.push(compileKineticText(fx, ctx)); break;
      case 'maskReveal': perFrame.push(compileMaskReveal(fx, ctx)); break;
      case 'shake': perFrame.push(compileShake(fx, ctx)); break;
      case 'lineDraw': perFrame.push(compileLineDraw(fx, ctx)); break;
      case 'numberRoll': perFrame.push(compileNumberRoll(fx, ctx)); break;
      case 'trail': ghosts.push(...compileTrail(fx, ctx).ghosts); break;
      case 'magnify': perFrame.push(compileMagnify(fx, ctx)); break;
      case 'typewriter': perFrame.push(compileTypewriter(fx, ctx)); break;
      case 'glitch': perFrame.push(compileGlitch(fx, ctx)); break;
      case 'shine': perFrame.push(compileShine(fx, ctx)); break;
      case 'gradientShift': perFrame.push(compileGradientShift(fx, ctx)); break;
      case 'pathMove': perFrame.push(compilePathMove(fx, ctx)); break;
      case 'waveText': perFrame.push(compileWaveText(fx, ctx)); break;
      case 'flicker': perFrame.push(compileFlicker(fx, ctx)); break;
      case 'scanReveal': perFrame.push(compileScanReveal(fx, ctx)); break;
      case 'liquidBlob': perFrame.push(compileLiquidBlob(fx, ctx)); break;
      case 'orbit': perFrame.push(compileOrbit(fx, ctx)); break;
      case 'sliceIn': perFrame.push(compileSliceIn(fx, ctx)); break;
      case 'breathe': perFrame.push(compileBreathe(fx, ctx)); break;
      case 'jitter': perFrame.push(compileJitter(fx, ctx)); break;
    }
  }
  return { perFrame, ghosts };
}
