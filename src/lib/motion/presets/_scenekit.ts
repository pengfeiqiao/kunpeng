/**
 * presets/_scenekit — 概念演示场景的共享构件。
 *
 * 把"导演思维"里最常用的画面语法做成可复用函数：
 *   node   — 角色化节点（几何体，会呼吸的"活"实体）
 *   pulse  — 沿连线飞行的消息光点（表示调用/数据在流动）
 *   wire   — 连线 svg 层（lineDraw 逐条画出关系）
 *   chip   — 标签/胶囊
 * 坐标统一用舞台百分比数字（0-100），内部转 %。
 */
import type { SceneLayer, TimeRef } from '../spec';

export const STAGE_W = 1920;
export const STAGE_H = 1080;

/** 百分比坐标 → px 偏移（用于 pathMove 的相对位移） */
export function pctToPx(fromXpct: number, fromYpct: number, toXpct: number, toYpct: number): { x: number; y: number } {
  return { x: (toXpct - fromXpct) / 100 * STAGE_W, y: (toYpct - fromYpct) / 100 * STAGE_H };
}

export interface NodeOpts {
  id: string;
  x: number; y: number;           // 舞台百分比
  size?: number;                   // 直径/宽度 px，默认 120
  color?: string;                  // 主色，默认 accent
  glow?: string;                   // 辉光色，默认同 color
  label?: string;                  // 节点内文字
  labelSize?: number;              // 文字 px，默认 size*0.24
  /** SVG 线性图标 id（见 ICONS 表）。与连线/描线同一套 stroke 视觉语言，
   * 显示在 label 上方（card/hex/ring）。不要用 emoji——风格与场景割裂。 */
  icon?: SceneIconId;
  /** 节点造型——按实体语义选，禁止全场景清一色圆球：
   * orb=抽象能量/AI核心  card=模块/服务/App/系统  hex=技术组件/引擎
   * diamond=决策/关卡  pill=标签/小角色  ring=枢纽/网关 */
  shape?: 'orb' | 'card' | 'hex' | 'diamond' | 'pill' | 'ring';
  at?: TimeRef;                    // 入场时刻，默认 0
  z?: number;
  breathePeriod?: number;          // 呼吸周期，默认 3.2
  ring?: boolean;                  // orb 专用：外描边环
}

// ── SVG 线性图标库 ────────────────────────────────────────────────────────────
// 24×24 viewBox、stroke 2、round cap——与 wire/lineDraw 同一套图形语言。
// currentColor 由造型注入。新增图标保持同规格手写，不要引外部图标库。
const ICON_PATHS: Record<string, string> = {
  brain: '<path d="M9 4a3 3 0 0 0-3 3c-1.7.3-3 1.7-3 3.5 0 1.2.6 2.3 1.5 2.9A3.5 3.5 0 0 0 7 20h2.5V4H9Z"/><path d="M15 4a3 3 0 0 1 3 3c1.7.3 3 1.7 3 3.5 0 1.2-.6 2.3-1.5 2.9A3.5 3.5 0 0 1 17 20h-2.5V4H15Z"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.8-4.8"/>',
  pen: '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="m13.5 6.5 3 3"/>',
  check: '<path d="m4 12.5 5 5L20 6.5"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M4.5 12h-2M21.5 12h-2M6 6l1.8 1.8M16.2 16.2 18 18M18 6l-1.8 1.8M7.8 16.2 6 18"/>',
  bolt: '<path d="M13 2 4.5 13.5H11L9.5 22 18.5 10H12L13 2Z"/>',
  data: '<ellipse cx="12" cy="5.5" rx="7" ry="2.8"/><path d="M5 5.5V12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V5.5"/><path d="M5 12v6.5c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V12"/>',
  cloud: '<path d="M7 18.5a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18.3 11a3.8 3.8 0 0 1-.8 7.5H7Z"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20c.8-3.5 3.6-5.5 7-5.5s6.2 2 7 5.5"/>',
  users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5c.7-3 3-4.8 5.5-4.8s4.8 1.8 5.5 4.8"/><circle cx="17" cy="9.5" r="2.6"/><path d="M16 14.9c2.2.2 4 1.7 4.6 4.1"/>',
  chip: '<rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M10 2.5V7M14 2.5V7M10 17v4.5M14 17v4.5M2.5 10H7M2.5 14H7M17 10h4.5M17 14h4.5"/>',
  eye: '<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  film: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M8 4.5v15M16 4.5v15M3 9h5M3 15h5M16 9h5M16 15h5"/>',
  msg: '<path d="M4 5.5h16v10.5H9L4 20V5.5Z"/><path d="M8 9.5h8M8 12.5h5"/>',
  doc: '<path d="M6 2.5h8l4 4v15H6v-19Z"/><path d="M14 2.5v4h4M9 12h6M9 15.5h6"/>',
  box: '<path d="m12 2.5 8.5 4.8v9.4L12 21.5l-8.5-4.8V7.3L12 2.5Z"/><path d="m3.5 7.3 8.5 4.8 8.5-4.8M12 12.1v9.4"/>',
  send: '<path d="M21 3 3.5 10.3l6.7 2.9L13 20z"/><path d="m21 3-10.8 10.2"/>',
  coin: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v10M9.2 9.2c0-1 1.2-1.7 2.8-1.7s2.8.7 2.8 1.7c0 2.7-5.6 1.9-5.6 4.7 0 1.2 1.2 1.9 2.8 1.9s2.8-.7 2.8-1.7"/>',
  star: '<path d="m12 3 2.7 5.7 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3 1.2-6.2L3 9.5l6.3-.8L12 3Z"/>',
  home: '<path d="m3.5 11 8.5-7 8.5 7"/><path d="M6 9.5V20h12V9.5"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.8"/><circle cx="12" cy="12" r="1.4"/>',
  wave: '<path d="M2.5 12c1.6 0 1.6-3.5 3.2-3.5S7.3 15.5 8.9 15.5 10.5 8.5 12.1 8.5s1.6 7 3.2 7 1.6-7 3.2-7 1.6 3.5 3 3.5"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/>',
  key: '<circle cx="8" cy="14.5" r="4.5"/><path d="m11.5 11.5 8-8M16 7l2.8 2.8M13.2 9.8 15.5 12"/>',
  rocket: '<path d="M12 2.5c3.5 1.8 5.5 5.5 5.5 9.5l-2.8 2.8h-5.4L6.5 12c0-4 2-7.7 5.5-9.5Z"/><circle cx="12" cy="9.5" r="1.8"/><path d="M9.3 14.8 7 20l3-1.2L12 21l2-2.2 3 1.2-2.3-5.2"/>',
};

export type SceneIconId = keyof typeof ICON_PATHS;

/** 线性图标 SVG（stroke=currentColor，随节点色）。size=px */
export function iconSvg(id: SceneIconId, size: number, color = 'currentColor'): string {
  const path = ICON_PATHS[id];
  if (!path) return '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

function nodeInnerHtml(o: NodeOpts, size: number, color: string, glow: string, labelSize: number): string {
  const label = o.label ? escHtml(o.label) : '';
  const icon = o.icon ? iconSvg(o.icon, Math.round(size * 0.3), 'rgba(242,246,255,.92)') : '';
  switch (o.shape ?? 'orb') {
    case 'card': {
      // 玻璃卡片：线性图标+标签，顶部渐变提示条。模块/服务/App 的标准形象。
      const w = Math.round(size * 1.35);
      const h = Math.round(size * 1.0);
      return `<div style="width:${w}px;height:${h}px;border-radius:${Math.round(size * 0.14)}px;background:linear-gradient(180deg,color-mix(in srgb,${color} 22%,rgba(16,20,32,.9)),color-mix(in srgb,${color} 8%,rgba(12,15,24,.92)));border:1.5px solid color-mix(in srgb,${color} 55%,transparent);box-shadow:0 ${Math.round(size * 0.1)}px ${Math.round(size * 0.3)}px rgba(0,0,0,.4),0 0 ${Math.round(size * 0.24)}px color-mix(in srgb,${glow} 35%,transparent);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${Math.round(size * 0.07)}px;position:relative;overflow:hidden">
<div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,transparent,${color},transparent)"></div>
${icon}
${label ? `<span style="font-size:${labelSize}px;font-weight:700;color:#f2f6ff;letter-spacing:.03em">${label}</span>` : ''}</div>`;
    }
    case 'hex': {
      // 六边形：技术组件/引擎。
      return `<div style="width:${size}px;height:${Math.round(size * 1.12)}px;clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%);background:linear-gradient(160deg,color-mix(in srgb,${color} 45%,#10141f),color-mix(in srgb,${color} 18%,#0b0e16));display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;position:relative">
<div style="position:absolute;inset:3px;clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%);border:1.5px solid color-mix(in srgb,${color} 65%,transparent);background:transparent"></div>
${icon}
${label ? `<span style="font-size:${labelSize}px;font-weight:700;color:#f2f6ff">${label}</span>` : ''}</div>`;
    }
    case 'diamond':
      // 菱形：决策点/关卡。外层旋转 45°，内层文字转回来。
      return `<div style="width:${size}px;height:${size}px;transform:rotate(45deg);border-radius:${Math.round(size * 0.12)}px;background:linear-gradient(135deg,color-mix(in srgb,${color} 50%,#141824),color-mix(in srgb,${color} 20%,#0d1018));border:1.5px solid color-mix(in srgb,${color} 60%,transparent);box-shadow:0 0 ${Math.round(size * 0.3)}px color-mix(in srgb,${glow} 40%,transparent);display:flex;align-items:center;justify-content:center">${label ? `<span style="transform:rotate(-45deg);font-size:${labelSize}px;font-weight:700;color:#f2f6ff">${label}</span>` : ''}</div>`;
    case 'pill':
      // 胶囊：标签/小角色。左侧小图标或光点。
      return `<div style="padding:${Math.round(size * 0.12)}px ${Math.round(size * 0.28)}px;border-radius:999px;background:color-mix(in srgb,${color} 20%,rgba(14,18,28,.9));border:1.5px solid color-mix(in srgb,${color} 60%,transparent);box-shadow:0 0 ${Math.round(size * 0.2)}px color-mix(in srgb,${glow} 30%,transparent);display:flex;align-items:center;gap:8px">${o.icon ? iconSvg(o.icon, labelSize + 4, 'rgba(242,246,255,.92)') : `<span style="width:8px;height:8px;border-radius:50%;background:${color};box-shadow:0 0 8px ${glow}"></span>`}${label ? `<span style="font-size:${labelSize}px;font-weight:700;color:#f2f6ff;white-space:nowrap">${label}</span>` : ''}</div>`;
    case 'ring':
      // 空心环：枢纽/网关。
      return `<div style="width:${size}px;height:${size}px;border-radius:50%;border:${Math.max(3, Math.round(size * 0.045))}px solid ${color};box-shadow:0 0 ${Math.round(size * 0.32)}px color-mix(in srgb,${glow} 50%,transparent),inset 0 0 ${Math.round(size * 0.2)}px color-mix(in srgb,${glow} 25%,transparent);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;background:radial-gradient(circle,color-mix(in srgb,${color} 10%,transparent),transparent 70%)">
${icon}
${label ? `<span style="font-size:${labelSize}px;font-weight:800;color:#f2f6ff">${label}</span>` : ''}</div>`;
    default:
      // orb：抽象能量/AI 核心。发光球只留给真正"无形"的实体。
      return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:radial-gradient(circle at 38% 32%, color-mix(in srgb, ${color} 85%, #fff) 0%, ${color} 55%, color-mix(in srgb, ${color} 60%, #000) 100%);box-shadow:0 0 ${size * 0.4}px ${glow}, inset -6px -8px ${size * 0.18}px rgba(0,0,0,.35), inset 4px 6px ${size * 0.16}px rgba(255,255,255,.4)${o.ring ? `;border:2px solid color-mix(in srgb, ${color} 70%, #fff)` : ''};display:flex;align-items:center;justify-content:center">${icon && !label ? icon : label ? `<span style="font-size:${labelSize}px;font-weight:800;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.5);letter-spacing:.02em">${label}</span>` : ''}</div>`;
  }
}

/** 角色化节点：多造型（orb/card/hex/diamond/pill/ring）+ SVG 线性图标 + 弹入 +
 * 待机呼吸。造型按实体语义选（见 NodeOpts.shape），一个场景内主次节点在
 * 造型/大小/亮度至少两个维度上要有区分。 */
export function node(o: NodeOpts): SceneLayer {
  const size = o.size ?? 120;
  const color = o.color ?? 'var(--fx-accent)';
  const glow = o.glow ?? color;
  const at = o.at ?? 0;
  const labelSize = o.labelSize ?? Math.round(size * 0.24);
  const inner = nodeInnerHtml(o, size, color, glow, labelSize);
  return {
    id: o.id, kind: 'html', html: inner, z: o.z ?? 3,
    at: { x: `${o.x}%`, y: `${o.y}%`, anchor: 'center' },
    tracks: [
      { prop: 'scale', kf: [{ t: at, v: 0 }, { t: addT(at, 0.5), v: 1, spring: { stiffness: 180, damping: 13 } }] },
      { prop: 'opacity', kf: [{ t: at, v: 0 }, { t: addT(at, 0.2), v: 1 }] },
    ],
    effects: [{ type: 'breathe', at: addT(at, 0.6), period: o.breathePeriod ?? 3.2, amount: 0.035, glowColor: glow, glowRadius: size * 0.3 }],
  };
}

export interface PulseOpts {
  id: string;
  from: { x: number; y: number };  // 舞台百分比（起点节点位置）
  to: { x: number; y: number };    // 舞台百分比（终点节点位置）
  at: TimeRef;
  dur?: number;                    // 飞行时长，默认 0.7
  color?: string;
  size?: number;                   // 光点直径，默认 14
  bow?: number;                    // 路径弯曲 px（垂直于连线方向），默认 0（直线）
  z?: number;
}

/** 消息光点：从 from 沿路径飞到 to（pathMove），到达即隐。表示一次调用/数据传递。 */
export function pulse(o: PulseOpts): SceneLayer {
  const dur = o.dur ?? 0.7;
  const size = o.size ?? 14;
  const color = o.color ?? 'var(--fx-accent)';
  const d = pctToPx(o.from.x, o.from.y, o.to.x, o.to.y);
  const bow = o.bow ?? 0;
  // 控制点在中点加垂直偏移（bow）
  const via = { x: d.x / 2 + (bow ? -d.y / Math.hypot(d.x, d.y) * bow : 0), y: d.y / 2 + (bow ? d.x / Math.hypot(d.x, d.y) * bow : 0) };
  return {
    id: o.id, kind: 'html', z: o.z ?? 4,
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};box-shadow:0 0 ${size * 1.3}px ${color},0 0 ${size * 2.4}px ${color}"></div>`,
    at: { x: `${o.from.x}%`, y: `${o.from.y}%`, anchor: 'center' },
    in: o.at, out: addT(o.at, dur + 0.05),
    tracks: [{ prop: 'opacity', kf: [{ t: o.at, v: 0 }, { t: addT(o.at, 0.08), v: 1 }, { t: addT(o.at, dur - 0.1), v: 1 }, { t: addT(o.at, dur), v: 0 }] }],
    effects: [{ type: 'pathMove', at: o.at, dur, via, to: d, ease: 'inOutCubic' }],
  };
}

/** 连线 svg 层：paths 是一组 {d, color?} 直接画在全舞台 svg 上，lineDraw 逐条生长。 */
export function wire(id: string, paths: { d: string; color?: string; width?: number; dash?: string }[], at: TimeRef, opts?: { stagger?: number; z?: number; dur?: number }): SceneLayer {
  const body = paths.map((p) => `<path d="${p.d}" stroke="${p.color ?? 'rgba(255,255,255,.4)'}" stroke-width="${p.width ?? 2}" fill="none" stroke-linecap="round"${p.dash ? ` stroke-dasharray="${p.dash}"` : ''}/>`).join('');
  return {
    id, kind: 'svg', z: opts?.z ?? 2, parallax: 1,
    svg: `<svg width="${STAGE_W}" height="${STAGE_H}" viewBox="0 0 ${STAGE_W} ${STAGE_H}" fill="none">${body}</svg>`,
    at: { x: '50%', y: '50%', anchor: 'center' },
    effects: [{ type: 'lineDraw', at, dur: opts?.dur ?? 0.7, stagger: opts?.stagger ?? 0.12, ease: 'inOutCubic' }],
  };
}

/** 舞台百分比 → svg 绝对坐标（供 wire 的 path d 用） */
export function sx(xPct: number): number { return Math.round(xPct / 100 * STAGE_W); }
export function sy(yPct: number): number { return Math.round(yPct / 100 * STAGE_H); }

/** 一条从 a 到 b 的连线 path d（可带弯曲 bow px） */
export function line(ax: number, ay: number, bx: number, by: number, bow = 0): string {
  const x1 = sx(ax), y1 = sy(ay), x2 = sx(bx), y2 = sy(by);
  if (!bow) return `M${x1} ${y1} L${x2} ${y2}`;
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const cx = mx - dy / len * bow, cy = my + dx / len * bow;
  return `M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}`;
}

function addT(t: TimeRef, delta: number): TimeRef {
  if (typeof t === 'number') return +(t + delta).toFixed(3);
  const m = /^beat:(\d+)\s*(?:([+-])\s*([\d.]+))?$/.exec(String(t).trim());
  if (!m) return t;
  const base = m[3] ? parseFloat(m[3]) * (m[2] === '-' ? -1 : 1) : 0;
  const sum = base + delta;
  return `beat:${m[1]}${sum >= 0 ? '+' : '-'}${Math.abs(+sum.toFixed(3))}`;
}

function escHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export { addT as demoAddT };
