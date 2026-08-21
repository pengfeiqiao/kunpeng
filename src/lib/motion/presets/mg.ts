/**
 * presets/mg — AE/MG 动画预设（Scene Spec 生成器）。
 *
 * 每个预设 = 参数 → SceneSpec 纯函数。产出的 spec 同时是 agent 的 few-shot 范例：
 * agent 可以直接用 preset_id 调用，也可以拿产出结构继续改（spec_patch）。
 */
import type { SceneLayer, SceneSpec } from '../spec';

export interface PresetDef {
  id: string;
  label: string;
  group: 'MG 动画' | '口播包装' | '信息页' | '高级网页' | '艺术方向' | '签名场景' | '概念演示' | '媒介演示';
  /** 给 agent 看的参数说明 */
  paramsDoc: string;
  /** 默认时长（可被 duration 参数覆盖） */
  defaultDuration: number;
  build(params: Record<string, unknown>, durationSec: number): SceneSpec;
}

function str(v: unknown, fb = ''): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fb;
}

function num(v: unknown, fb: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function list(v: unknown, fallback: string[]): string[] {
  if (Array.isArray(v)) {
    return v.map((x) => String(x ?? '').trim()).filter(Boolean);
  }
  if (typeof v === 'string') {
    return v
      .split(/[；;\n、,，|]/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return fallback;
}

/** 标题揭示：镜头缓推 + 逐字弹入 + 副标题遮罩揭示 + 装饰线描线 */
const titleReveal: PresetDef = {
  id: 'mg.titleReveal',
  label: 'MG 标题揭示',
  group: 'MG 动画',
  paramsDoc: '{ title: string(主标题≤14字), subtitle?: string, theme?: string, bg?: "opaque"|"transparent" }',
  defaultDuration: 4.5,
  build(params, duration) {
    const title = str(params.title, '标题');
    const subtitle = str(params.subtitle);
    const layers: SceneLayer[] = [
      {
        id: 'rule', kind: 'svg',
        svg: `<svg width="560" height="8" viewBox="0 0 560 8" fill="none"><line x1="4" y1="4" x2="556" y2="4" stroke="var(--fx-accent)" stroke-width="4" stroke-linecap="round"/></svg>`,
        at: { x: '50%', y: '58%', anchor: 'center' }, z: 2,
        effects: [{ type: 'lineDraw', at: 0.55, dur: 0.7, ease: 'inOutExpo' }],
      },
      {
        id: 'title', kind: 'text', text: title, class: 'kp-h1 kp-shadow',
        at: { x: '50%', y: '46%', anchor: 'center' }, z: 3, parallax: 1,
        effects: [
          { type: 'kineticText', split: 'char', at: 0.25, stagger: 0.05, dur: 0.55, from: { y: 90, opacity: 0, rotate: 4 }, spring: { stiffness: 190, damping: 15 } },
        ],
      },
    ];
    if (subtitle) {
      layers.push({
        id: 'subtitle', kind: 'text', text: subtitle, class: 'kp-sub kp-shadow',
        at: { x: '50%', y: '65%', anchor: 'center' }, z: 2, parallax: 0.85,
        in: 0.9,
        tracks: [{ prop: 'opacity', kf: [{ t: 0.9, v: 0 }, { t: 1.25, v: 1, ease: 'outCubic' }] }],
        effects: [{ type: 'maskReveal', at: 0.9, dur: 0.55, dir: 'left', ease: 'outExpo' }],
      });
    }
    return {
      v: 1, duration, theme: str(params.theme) || undefined,
      bg: params.bg === 'opaque' ? 'opaque' : 'transparent',
      fonts: ['minimal'],
      beats: [0, 0.25, 0.9, 1.6],
      camera: { tracks: [{ prop: 'scale', kf: [{ t: 0, v: 1.06 }, { t: duration, v: 1, ease: 'outQuad' }] }] },
      layers,
    };
  },
};

/** 列表整体：2-6 个并列要点作为一个 MG 组件，而不是零散关键词贴片 */
const listCards: PresetDef = {
  id: 'mg.listCards',
  label: 'MG 列表整体卡片',
  group: 'MG 动画',
  paramsDoc: '{ title?: string, items: string[]|string(2-6个要点), mode?: "row"|"grid", bg?: "transparent"|"opaque", theme?: string }',
  defaultDuration: 5,
  build(params, duration) {
    const items = list(params.items, ['第一点', '第二点', '第三点', '第四点']).slice(0, 6);
    const safeItems = items.length >= 2 ? items : ['第一点', '第二点'];
    const title = str(params.title);
    const bg = params.bg === 'opaque' ? 'opaque' : 'transparent';
    const useGrid = params.mode === 'grid' || safeItems.length > 4;
    const cols = useGrid ? 3 : safeItems.length;
    const rows = Math.ceil(safeItems.length / cols);
    const cardW = useGrid ? 360 : Math.min(420, Math.max(260, 1280 / safeItems.length));
    const gapX = useGrid ? 410 : Math.min(460, Math.max(300, 1380 / safeItems.length));
    const startX = 50 - ((cols - 1) * gapX) / 2 / 19.2;
    const baseY = rows === 1 ? 54 : 49;
    const rowGap = 17;
    const layers: SceneLayer[] = [];

    if (title) {
      layers.push({
        id: 'title',
        kind: 'text',
        text: title,
        class: bg === 'opaque' ? 'kp-h3 kp-shadow' : 'kp-h3 kp-chip',
        style: { maxWidth: '1280px', textAlign: 'center' },
        at: { x: '50%', y: rows === 1 ? '35%' : '28%', anchor: 'center' },
        z: 4,
        effects: [{ type: 'kineticText', split: 'char', at: 0.15, stagger: 0.035, dur: 0.45, from: { y: 32, opacity: 0 }, ease: 'outCubic' }],
      });
    }

    safeItems.forEach((item, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = `${startX + (col * gapX) / 19.2}%`;
      const y = `${baseY + row * rowGap}%`;
      const order = String(index + 1).padStart(2, '0');
      const accentOpacity = index === 0 ? '1' : '0.72';
      layers.push({
        id: `card_${index + 1}`,
        kind: 'html',
        html: `<div class="kp-card kp-soft-shadow" style="box-sizing:border-box;width:${cardW}px;min-height:${useGrid ? 136 : 154}px;padding:22px 24px;border-radius:24px;background:rgba(18,22,30,.82);border:1px solid rgba(255,255,255,.18);box-shadow:0 20px 60px rgba(0,0,0,.32);backdrop-filter:blur(10px);"><div style="display:flex;align-items:center;gap:14px;margin-bottom:14px;"><span style="font:800 28px/1 Space Grotesk,Arial,sans-serif;color:var(--fx-accent);opacity:${accentOpacity};">${order}</span><span style="height:1px;flex:1;background:linear-gradient(90deg,var(--fx-accent),rgba(255,255,255,.14));"></span></div><div style="font:800 ${useGrid ? 34 : 38}px/1.18 system-ui,-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;color:#fff;letter-spacing:0;text-wrap:balance;">${esc(item)}</div></div>`,
        at: { x, y, anchor: 'center' },
        w: cardW,
        z: 3,
        in: 0.28 + index * 0.13,
        tracks: [
          { prop: 'opacity', kf: [{ t: 0.28 + index * 0.13, v: 0 }, { t: 0.58 + index * 0.13, v: 1, ease: 'outCubic' }] },
          { prop: 'y', kf: [{ t: 0.28 + index * 0.13, v: 42 }, { t: 0.78 + index * 0.13, v: 0, spring: { stiffness: 190, damping: 16 } }] },
          { prop: 'scale', kf: [{ t: 0.28 + index * 0.13, v: 0.9 }, { t: 0.78 + index * 0.13, v: 1, spring: { stiffness: 210, damping: 18 } }] },
        ],
      });
    });

    return {
      v: 1,
      duration,
      theme: str(params.theme) || undefined,
      bg,
      bgCss: bg === 'opaque' ? 'radial-gradient(circle at 18% 18%, rgba(69,214,255,.28), transparent 34%), linear-gradient(135deg,#10131a,#1b1f2a 58%,#11131a)' : undefined,
      fonts: ['minimal', 'tech'],
      beats: [0, 0.25, 0.7, 1.1, 1.5],
      camera: { tracks: [{ prop: 'scale', kf: [{ t: 0, v: 1.025 }, { t: duration, v: 1, ease: 'linear' }] }] },
      layers,
    };
  },
};

/** 否定修正：把旧词叉掉，再把新词替换出来 */
const crossOutReplace: PresetDef = {
  id: 'mg.crossOutReplace',
  label: 'MG 叉掉替换',
  group: 'MG 动画',
  paramsDoc: '{ wrong: string(被否定的词/短语), right: string(正确词/短语), lead?: string, bg?: "transparent"|"opaque", theme?: string }',
  defaultDuration: 4.2,
  build(params, duration) {
    const wrong = str(params.wrong, '不是这样');
    const right = str(params.right, '而是这样');
    const lead = str(params.lead);
    const bg = params.bg === 'opaque' ? 'opaque' : 'transparent';
    const wrongWidth = Math.max(520, Math.min(1120, wrong.length * 52 + 220));
    const lineWidth = Math.max(420, Math.min(980, wrong.length * 46 + 150));
    const layers: SceneLayer[] = [
      ...(lead ? [{
        id: 'lead',
        kind: 'text' as const,
        text: lead,
        class: bg === 'opaque' ? 'kp-sub kp-shadow' : 'kp-sub kp-chip',
        style: { color: 'rgba(255,255,255,.78)' },
        at: { x: '50%', y: '30%', anchor: 'center' as const },
        z: 2,
        tracks: [{ prop: 'opacity' as const, kf: [{ t: 0.1, v: 0 }, { t: 0.4, v: 1, ease: 'outCubic' as const }] }],
      }] : []),
      {
        id: 'wrong',
        kind: 'html',
        html: `<div style="box-sizing:border-box;min-width:${wrongWidth}px;padding:22px 42px;border-radius:999px;background:rgba(24,26,32,.86);border:1px solid rgba(255,255,255,.18);box-shadow:0 22px 70px rgba(0,0,0,.38);font:900 72px/1.05 system-ui,-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;color:rgba(255,255,255,.9);text-align:center;">${esc(wrong)}</div>`,
        at: { x: '50%', y: '43%', anchor: 'center' },
        w: wrongWidth,
        z: 3,
        tracks: [
          { prop: 'opacity', kf: [{ t: 0.18, v: 0 }, { t: 0.46, v: 1, ease: 'outCubic' }, { t: 2.0, v: 1 }, { t: 2.35, v: 0.56, ease: 'outCubic' }] },
          { prop: 'scale', kf: [{ t: 0.18, v: 0.88 }, { t: 0.62, v: 1, spring: { stiffness: 210, damping: 16 } }, { t: 1.12, v: 1 }, { t: 1.28, v: 1.04, ease: 'outBack' }, { t: 1.6, v: 1, ease: 'outCubic' }] },
        ],
      },
      {
        id: 'strike',
        kind: 'svg',
        svg: `<svg width="${lineWidth}" height="160" viewBox="0 0 ${lineWidth} 160" fill="none"><path d="M32 126 C ${lineWidth * 0.25} 64, ${lineWidth * 0.72} 88, ${lineWidth - 32} 30" stroke="#ff4f4f" stroke-width="18" stroke-linecap="round"/><path d="M42 36 L ${lineWidth - 42} 124" stroke="#ff4f4f" stroke-width="10" stroke-linecap="round" opacity=".75"/></svg>`,
        at: { x: '50%', y: '43%', anchor: 'center' },
        w: lineWidth,
        z: 5,
        in: 1.05,
        effects: [{ type: 'lineDraw', at: 1.05, dur: 0.38, stagger: 0.04, ease: 'outExpo' }],
      },
      {
        id: 'right',
        kind: 'html',
        html: `<div style="box-sizing:border-box;max-width:1220px;padding:22px 46px;border-radius:28px;background:linear-gradient(135deg,var(--fx-accent),var(--fx-accent2));box-shadow:0 28px 90px rgba(0,0,0,.38),0 0 42px rgba(45,212,255,.22);font:950 82px/1.08 system-ui,-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;color:#061017;text-align:center;text-wrap:balance;">${esc(right)}</div>`,
        at: { x: '50%', y: '61%', anchor: 'center' },
        w: 1220,
        z: 6,
        in: 1.45,
        tracks: [
          { prop: 'opacity', kf: [{ t: 1.45, v: 0 }, { t: 1.72, v: 1, ease: 'outCubic' }] },
          { prop: 'y', kf: [{ t: 1.45, v: 58 }, { t: 1.92, v: 0, spring: { stiffness: 220, damping: 15 } }] },
          { prop: 'scale', kf: [{ t: 1.45, v: 0.82 }, { t: 1.92, v: 1, spring: { stiffness: 230, damping: 16 } }] },
        ],
        effects: [{ type: 'shine', at: 2.2, dur: 0.9, strength: 0.5 }],
      },
    ];

    return {
      v: 1,
      duration,
      theme: str(params.theme) || undefined,
      bg,
      bgCss: bg === 'opaque' ? 'radial-gradient(circle at 50% 35%, rgba(255,79,79,.20), transparent 32%), linear-gradient(135deg,#101117,#171b24)' : undefined,
      fonts: ['minimal'],
      beats: [0, 0.45, 1.08, 1.55, 2.2],
      flashes: [{ at: 1.05, dur: 0.16, color: '#ff4f4f', peak: 0.24 }],
      layers,
    };
  },
};

/** 数据冲击：数字滚动 + 节奏点冲击抖动 + 闪白 + 标签 */
const statPunch: PresetDef = {
  id: 'mg.statPunch',
  label: 'MG 数据冲击',
  group: 'MG 动画',
  paramsDoc: '{ value: number(目标数值), label: string(说明), format?: "plain"|"comma"|"compact-cn"|"percent", prefix?: string, suffix?: string, theme?: string }',
  defaultDuration: 3.5,
  build(params, duration) {
    const to = num(params.value, 100);
    const label = str(params.label, '');
    return {
      v: 1, duration, theme: str(params.theme) || undefined, bg: 'transparent',
      fonts: ['tech'],
      beats: [0, 0.2, 1.35],
      flashes: [{ at: 'beat:2', dur: 0.28, peak: 0.5 }],
      layers: [
        {
          id: 'value', kind: 'text', text: '0', class: 'kp-h1 kp-chip',
          style: { fontSize: '128px', color: 'var(--fx-accent)', fontVariantNumeric: 'tabular-nums', fontWeight: '700', letterSpacing: '-0.03em' },
          at: { x: '50%', y: '46%', anchor: 'center' }, z: 3,
          tracks: [
            { prop: 'scale', kf: [{ t: 0.2, v: 0.8 }, { t: 0.55, v: 1, spring: { stiffness: 210, damping: 13 } }, { t: 'beat:2', v: 1 }, { t: 1.55, v: 1.12, ease: 'outBack' }, { t: 1.85, v: 1, ease: 'outCubic' }] },
            { prop: 'opacity', kf: [{ t: 0.2, v: 0 }, { t: 0.4, v: 1 }] },
          ],
          effects: [
            { type: 'numberRoll', at: 'beat:1', dur: 1.15, from: 0, to, format: (str(params.format) || 'comma') as 'comma', prefix: str(params.prefix), suffix: str(params.suffix) },
            { type: 'shake', at: 'beat:2', dur: 0.32, amp: 10, freq: 20, seed: 3 },
          ],
        },
        ...(label ? [{
          id: 'label', kind: 'text' as const, text: label, class: 'kp-sub kp-chip',
          at: { x: '50%', y: '62%', anchor: 'center' as const }, z: 2, in: 0.55,
          tracks: [
            { prop: 'y' as const, kf: [{ t: 0.55, v: 24 }, { t: 0.95, v: 0, ease: 'outExpo' as const }] },
            { prop: 'opacity' as const, kf: [{ t: 0.55, v: 0 }, { t: 0.9, v: 1 }] },
          ],
        }] : []),
      ],
    };
  },
};

/** 章节转场：色块遮罩擦过 + 章节标题居中弹出 + 擦出 */
const chapterTransition: PresetDef = {
  id: 'mg.chapterTransition',
  label: 'MG 章节转场',
  group: 'MG 动画',
  paramsDoc: '{ title: string(章节名≤10字), index?: string(如"02"), theme?: string }',
  defaultDuration: 2.6,
  build(params, duration) {
    const title = str(params.title, '章节');
    const index = str(params.index);
    const outAt = duration - 0.7;
    return {
      v: 1, duration, theme: str(params.theme) || undefined, bg: 'transparent',
      fonts: ['minimal'],
      layers: [
        {
          id: 'panel', kind: 'shape',
          html: `<div style="width:1920px;height:1080px;background:var(--fx-primary)"></div>`,
          at: { x: '50%', y: '50%', anchor: 'center' }, z: 1,
          effects: [
            { type: 'maskReveal', at: 0, dur: 0.5, dir: 'left', ease: 'inOutExpo' },
            { type: 'maskReveal', at: outAt, dur: 0.55, dir: 'right', ease: 'inOutExpo', out: true },
          ],
        },
        ...(index ? [{
          id: 'index', kind: 'text' as const, text: index, class: 'kp-label',
          style: { fontSize: '30px', color: 'var(--fx-accent)', letterSpacing: '8px' },
          at: { x: '50%', y: '40%', anchor: 'center' as const }, z: 3, in: 0.35, out: outAt + 0.15,
          tracks: [{ prop: 'opacity' as const, kf: [{ t: 0.35, v: 0 }, { t: 0.6, v: 1 }, { t: outAt, v: 1 }, { t: outAt + 0.15, v: 0 }] }],
        }] : []),
        {
          id: 'title', kind: 'text', text: title, class: 'kp-h2',
          at: { x: '50%', y: '50%', anchor: 'center' }, z: 3, out: outAt + 0.3,
          tracks: [{ prop: 'opacity', kf: [{ t: outAt, v: 1 }, { t: outAt + 0.3, v: 0, ease: 'inQuad' }] }],
          effects: [
            { type: 'kineticText', split: 'char', at: 0.3, stagger: 0.045, dur: 0.5, from: { y: 56, opacity: 0 }, spring: { stiffness: 200, damping: 16 } },
          ],
        },
      ],
    };
  },
};

/** 金句 kinetic：逐词弹入 + 残影 + 轻推镜 */
const quoteKinetic: PresetDef = {
  id: 'mg.quoteKinetic',
  label: 'MG 金句动效',
  group: 'MG 动画',
  paramsDoc: '{ quote: string(金句≤30字), author?: string, theme?: string }',
  defaultDuration: 5,
  build(params, duration) {
    const quote = str(params.quote, '金句');
    const author = str(params.author);
    const layers: SceneLayer[] = [
      {
        id: 'quote', kind: 'text', text: quote, class: 'kp-h3 kp-chip',
        style: { maxWidth: '1280px', textAlign: 'center', lineHeight: '1.5' },
        at: { x: '50%', y: '48%', anchor: 'center' }, w: 1280, z: 3,
        effects: [
          { type: 'kineticText', split: 'char', at: 0.3, stagger: 0.05, dur: 0.6, from: { y: 34, opacity: 0 }, ease: 'outCubic' },
        ],
      },
    ];
    if (author) {
      layers.push({
        id: 'author', kind: 'text', text: `—— ${author}`, class: 'kp-sub kp-shadow',
        style: { color: 'var(--fx-accent)' },
        at: { x: '50%', y: '66%', anchor: 'center' }, z: 2, in: 1.6,
        tracks: [
          { prop: 'opacity', kf: [{ t: 1.6, v: 0 }, { t: 2.1, v: 1, ease: 'outCubic' }] },
          { prop: 'x', kf: [{ t: 1.6, v: -30 }, { t: 2.15, v: 0, ease: 'outExpo' }] },
        ],
      });
    }
    return {
      v: 1, duration, theme: str(params.theme) || undefined, bg: 'transparent',
      fonts: ['literary'],
      camera: { tracks: [{ prop: 'scale', kf: [{ t: 0, v: 1 }, { t: duration, v: 1.05, ease: 'linear' }] }] },
      layers,
    };
  },
};

/** 冲击 Hook：大字撞入 + 抖动 + 闪白 + 残影，抖音开屏钩子 */
const hookSlam: PresetDef = {
  id: 'mg.hookSlam',
  label: 'MG 冲击开场',
  group: 'MG 动画',
  paramsDoc: '{ text: string(钩子句≤12字), theme?: string }',
  defaultDuration: 2.2,
  build(params, duration) {
    const text = str(params.text, '注意看');
    return {
      v: 1, duration, theme: str(params.theme) || undefined, bg: 'transparent',
      fonts: ['variety'],
      beats: [0, 0.34],
      flashes: [{ at: 'beat:1', dur: 0.22, peak: 0.7 }],
      layers: [{
        id: 'hook', kind: 'text', text, class: 'kp-h1 kp-stroke',
        style: { fontSize: '120px', color: '#ffffff', letterSpacing: '-0.02em' },
        at: { x: '50%', y: '44%', anchor: 'center' }, z: 3,
        tracks: [
          { prop: 'scale', kf: [{ t: 0, v: 2.6 }, { t: 'beat:1', v: 1, ease: 'inExpo' }] },
          { prop: 'opacity', kf: [{ t: 0, v: 0 }, { t: 0.18, v: 1 }] },
        ],
        effects: [
          { type: 'shake', at: 'beat:1', dur: 0.4, amp: 16, freq: 22, seed: 11, rotAmp: 1.6 },
          { type: 'trail', copies: 3, lag: 0.045, fade: 0.45 },
        ],
      }],
    };
  },
};

export const MG_PRESETS: PresetDef[] = [titleReveal, listCards, crossOutReplace, statPunch, chapterTransition, quoteKinetic, hookSlam];
