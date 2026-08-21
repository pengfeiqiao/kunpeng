/**
 * presets/talking — 抖音口播视觉包装预设。
 *
 * 全部透明底、贴原视频画面：坐标由 agent 按画面内容锚定（x/y 舞台百分比），
 * 时间由 agent 从 timeline_transcript_read 的词级时间戳换算成片段内秒传入。
 * 文字一律带 kp-chip/kp-stroke 可读性保护。
 */
import type { SceneLayer } from '../spec';
import type { PresetDef } from './mg';

function str(v: unknown, fb = ''): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fb;
}

function num(v: unknown, fb: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function coord(v: unknown, fb: string): string {
  if (typeof v === 'number' && Number.isFinite(v)) return `${v}px`;
  const s = str(v);
  return s || fb;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface KeywordItem { word: string; x?: unknown; y?: unknown; at?: unknown }

/** 关键词弹出：一批关键词按各自时间戳在指定坐标弹入（口播强调的主力） */
const keywordPop: PresetDef = {
  id: 'talking.keywordPop',
  label: '口播关键词弹出',
  group: '口播包装',
  paramsDoc: '{ words: {word:string, x?:string|number(默认"50%"), y?:string|number(默认"30%"), at:number(片段内秒)}[] (≤6), hold?: number(每个词停留秒,默认2.2), theme?: string }',
  defaultDuration: 6,
  build(params, duration) {
    const items = (Array.isArray(params.words) ? params.words : []).slice(0, 6) as KeywordItem[];
    const hold = num(params.hold, 2.2);
    const layers: SceneLayer[] = items.map((it, i) => {
      const at = num(it.at, i * 1.2);
      return {
        id: `kw${i}`, kind: 'text' as const, text: str(it.word, `关键词${i + 1}`),
        class: 'kp-h3 kp-chip',
        style: { color: 'var(--fx-accent)' },
        at: { x: coord(it.x, '50%'), y: coord(it.y, '30%'), anchor: 'center' as const },
        z: 3 + i, in: at, out: Math.min(duration, at + hold),
        tracks: [
          { prop: 'opacity' as const, kf: [{ t: at, v: 0 }, { t: at + 0.22, v: 1 }, { t: Math.min(duration, at + hold) - 0.25, v: 1 }, { t: Math.min(duration, at + hold), v: 0, ease: 'inQuad' as const }] },
          { prop: 'scale' as const, kf: [{ t: at, v: 0.6 }, { t: at + 0.45, v: 1, spring: { stiffness: 240, damping: 13 } }] },
        ],
      };
    });
    return { v: 1, duration, theme: str(params.theme) || undefined, bg: 'transparent', fonts: ['minimal'], layers };
  },
};

/** 底栏信息条：底部安全区上方滑入的半透明信息栏（观点/结论/来源标注） */
const bottomBar: PresetDef = {
  id: 'talking.bottomBar',
  label: '口播底栏',
  group: '口播包装',
  paramsDoc: '{ text: string(≤24字), tag?: string(左侧短标签如"结论"), at?: number(入场秒,默认0.2), theme?: string }',
  defaultDuration: 5,
  build(params, duration) {
    const text = str(params.text, '');
    const tag = str(params.tag);
    const at = num(params.at, 0.2);
    const outAt = duration - 0.4;
    return {
      v: 1, duration, theme: str(params.theme) || undefined, bg: 'transparent', fonts: ['minimal'],
      layers: [{
        id: 'bar', kind: 'html',
        html: `<div style="display:flex;align-items:center;gap:20px;padding:22px 36px;background:var(--fx-surface);border-left:8px solid var(--fx-accent);border-radius:16px;max-width:1500px">${tag ? `<span style="flex-shrink:0;padding:6px 16px;background:var(--fx-accent);color:var(--fx-primary);font-size:24px;font-weight:800;border-radius:8px">${esc(tag)}</span>` : ''}<span style="font-size:34px;font-weight:600;color:var(--fx-text);line-height:1.35">${esc(text)}</span></div>`,
        at: { x: '50%', y: '86%', anchor: 'center' }, z: 3, in: at, out: duration,
        tracks: [
          { prop: 'y', kf: [{ t: at, v: 90 }, { t: at + 0.55, v: 0, spring: { stiffness: 170, damping: 16 } }, { t: outAt, v: 0 }, { t: duration, v: 110, ease: 'inCubic' }] },
          { prop: 'opacity', kf: [{ t: at, v: 0 }, { t: at + 0.3, v: 1 }, { t: outAt, v: 1 }, { t: duration - 0.05, v: 0 }] },
        ],
      }],
    };
  },
};

/** 圈选标注：在画面指定位置手绘感圆圈描线 + 可选短标签 */
const circleMark: PresetDef = {
  id: 'talking.circleMark',
  label: '口播圈选',
  group: '口播包装',
  paramsDoc: '{ x: string|number(圆心), y: string|number, r?: number(半径px,默认150), label?: string(短标签), at?: number(秒), color?: string }',
  defaultDuration: 3,
  build(params, duration) {
    const x = coord(params.x, '50%');
    const y = coord(params.y, '50%');
    const r = num(params.r, 150);
    const label = str(params.label);
    const at = num(params.at, 0.15);
    const color = str(params.color, 'var(--fx-accent)');
    // 手绘感：椭圆稍微压扁 + 起笔收笔重叠一点
    const rx = r; const ry = r * 0.82;
    const w = rx * 2 + 40; const h = ry * 2 + 40;
    const layers: SceneLayer[] = [{
      id: 'circle', kind: 'svg',
      svg: `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none"><ellipse cx="${w / 2}" cy="${h / 2}" rx="${rx}" ry="${ry}" stroke="${color}" stroke-width="8" stroke-linecap="round" transform="rotate(-4 ${w / 2} ${h / 2})"/></svg>`,
      at: { x, y, anchor: 'center' }, z: 4, in: Math.max(0, at - 0.05),
      effects: [{ type: 'lineDraw', at, dur: 0.55, ease: 'inOutCubic' }],
      tracks: [{ prop: 'opacity', kf: [{ t: duration - 0.35, v: 1 }, { t: duration, v: 0, ease: 'inQuad' }] }],
    }];
    if (label) {
      layers.push({
        id: 'label', kind: 'text', text: label, class: 'kp-sub kp-chip',
        style: { color },
        at: { x, y: `calc(${y} - ${ry + 70}px)`, anchor: 'center' }, z: 4, in: at + 0.4,
        tracks: [
          { prop: 'opacity', kf: [{ t: at + 0.4, v: 0 }, { t: at + 0.65, v: 1 }, { t: duration - 0.35, v: 1 }, { t: duration, v: 0 }] },
          { prop: 'y', kf: [{ t: at + 0.4, v: 16 }, { t: at + 0.75, v: 0, ease: 'outBack' }] },
        ],
      });
    }
    return { v: 1, duration, theme: str(params.theme) || undefined, bg: 'transparent', fonts: ['minimal'], layers };
  },
};

/** 箭头指点：从起点描线画到目标位置 + 尖端弹一下 */
const arrowPoint: PresetDef = {
  id: 'talking.arrowPoint',
  label: '口播箭头',
  group: '口播包装',
  paramsDoc: '{ x: string|number(箭头尖指向), y: string|number, dir?: "up"|"down"|"left"|"right"(箭头来向,默认down即从上往下指), label?: string, at?: number, color?: string }',
  defaultDuration: 2.5,
  build(params, duration) {
    const x = coord(params.x, '50%');
    const y = coord(params.y, '50%');
    const dir = str(params.dir, 'down');
    const label = str(params.label);
    const at = num(params.at, 0.15);
    const color = str(params.color, 'var(--fx-accent)');
    // 箭杆带一点弧度的手绘感 path，尖端在画布中的固定点，整体按 dir 旋转
    const rot = { down: 0, left: -90, up: 180, right: 90 }[dir] ?? 0;
    const layers: SceneLayer[] = [{
      id: 'arrow', kind: 'svg',
      svg: `<svg width="140" height="220" viewBox="0 0 140 220" fill="none" style="transform:rotate(${rot}deg)"><path d="M78 12 C 96 66, 56 108, 68 178" stroke="${color}" stroke-width="9" stroke-linecap="round"/><path d="M42 152 L 68 182 L 96 156" stroke="${color}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`,
      at: { x, y: `calc(${y} - 110px)`, anchor: 'bottom' }, z: 4, in: Math.max(0, at - 0.05),
      effects: [
        { type: 'lineDraw', at, dur: 0.45, stagger: 0.22, ease: 'outCubic' },
        { type: 'shake', at: at + 0.7, dur: 0.28, amp: 5, freq: 14, seed: 5 },
      ],
      tracks: [{ prop: 'opacity', kf: [{ t: duration - 0.3, v: 1 }, { t: duration, v: 0, ease: 'inQuad' }] }],
    }];
    if (label) {
      layers.push({
        id: 'label', kind: 'text', text: label, class: 'kp-sub kp-chip',
        style: { color },
        at: { x, y: `calc(${y} - 250px)`, anchor: 'center' }, z: 4, in: at + 0.35,
        tracks: [{ prop: 'opacity', kf: [{ t: at + 0.35, v: 0 }, { t: at + 0.6, v: 1 }, { t: duration - 0.3, v: 1 }, { t: duration, v: 0 }] }],
      });
    }
    return { v: 1, duration, theme: str(params.theme) || undefined, bg: 'transparent', fonts: ['minimal'], layers };
  },
};

/** 局部放大：压暗四周 + 圈环聚焦画面局部（细节讲解） */
const magnifyCallout: PresetDef = {
  id: 'talking.magnifyCallout',
  label: '口播局部聚焦',
  group: '口播包装',
  paramsDoc: '{ x: string|number(聚焦中心), y: string|number, r?: number(半径px,默认180), label?: string, at?: number, dim?: number(0-1压暗度,默认0.5) }',
  defaultDuration: 3,
  build(params, duration) {
    const x = coord(params.x, '50%');
    const y = coord(params.y, '40%');
    const r = num(params.r, 180);
    const label = str(params.label);
    const at = num(params.at, 0.1);
    const layers: SceneLayer[] = [{
      id: 'focus', kind: 'shape', html: `<div style="width:1920px;height:1080px"></div>`,
      at: { x: '50%', y: '50%', anchor: 'center' }, z: 2,
      effects: [{ type: 'magnify', at, dur: duration - at - 0.2, region: { x, y, r }, dim: num(params.dim, 0.5) }],
    }];
    if (label) {
      layers.push({
        id: 'label', kind: 'text', text: label, class: 'kp-sub kp-chip',
        style: { color: 'var(--fx-accent)' },
        at: { x, y: `calc(${y} + ${r + 60}px)`, anchor: 'center' }, z: 4, in: at + 0.4,
        tracks: [
          { prop: 'opacity', kf: [{ t: at + 0.4, v: 0 }, { t: at + 0.7, v: 1 }, { t: duration - 0.3, v: 1 }, { t: duration, v: 0 }] },
          { prop: 'y', kf: [{ t: at + 0.4, v: 20 }, { t: at + 0.8, v: 0, ease: 'outExpo' }] },
        ],
      });
    }
    return { v: 1, duration, theme: str(params.theme) || undefined, bg: 'transparent', fonts: ['minimal'], layers };
  },
};

/** 节奏强调：按 beats 序列在屏幕边缘打节奏光效 + 可选踩点词 */
const beatEmphasis: PresetDef = {
  id: 'talking.beatEmphasis',
  label: '口播节奏强调',
  group: '口播包装',
  paramsDoc: '{ beats: number[](片段内秒,≤8个), words?: string[](与 beats 对齐的踩点词,可省), theme?: string }',
  defaultDuration: 6,
  build(params, duration) {
    const beats = (Array.isArray(params.beats) ? params.beats : []).map(Number).filter((n) => Number.isFinite(n) && n >= 0).slice(0, 8);
    const words = (Array.isArray(params.words) ? params.words : []).map((w) => String(w ?? '').trim());
    const layers: SceneLayer[] = [{
      id: 'vignette', kind: 'shape',
      html: `<div style="width:1920px;height:1080px;box-shadow:inset 0 0 180px 40px var(--fx-accent);border-radius:2px"></div>`,
      at: { x: '50%', y: '50%', anchor: 'center' }, z: 1,
      tracks: [{
        prop: 'opacity',
        kf: beats.flatMap((b) => [
          { t: Math.max(0, b - 0.02), v: 0 },
          { t: b + 0.06, v: 0.85, ease: 'outQuad' as const },
          { t: Math.min(duration, b + 0.5), v: 0, ease: 'outCubic' as const },
        ]).sort((a, b2) => a.t - b2.t),
      }],
    }];
    words.forEach((w, i) => {
      if (!w || beats[i] == null) return;
      const b = beats[i];
      layers.push({
        id: `beatword${i}`, kind: 'text', text: w, class: 'kp-h2 kp-stroke',
        at: { x: '50%', y: '28%', anchor: 'center' }, z: 3,
        in: b, out: Math.min(duration, b + 1.1),
        tracks: [
          { prop: 'scale', kf: [{ t: b, v: 1.8 }, { t: b + 0.22, v: 1, ease: 'inExpo' }] },
          { prop: 'opacity', kf: [{ t: b, v: 0 }, { t: b + 0.12, v: 1 }, { t: Math.min(duration, b + 0.85), v: 1 }, { t: Math.min(duration, b + 1.1), v: 0 }] },
        ],
        effects: [{ type: 'shake', at: b + 0.2, dur: 0.25, amp: 8, freq: 20, seed: 13 + i }],
      });
    });
    return { v: 1, duration, beats, theme: str(params.theme) || undefined, bg: 'transparent', fonts: ['minimal'], layers };
  },
};

export const TALKING_PRESETS: PresetDef[] = [keywordPop, bottomBar, circleMark, arrowPoint, magnifyCallout, beatEmphasis];
