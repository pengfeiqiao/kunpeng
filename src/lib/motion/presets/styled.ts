/**
 * presets/styled — 艺术方向套件示范预设。
 *
 * 每个 = 一个 style kit 的代表作，给 agent 看"这套美学怎么用"。
 * agent 拿 preset 当起点，改 style 换套件、改内容注入个性。
 */
import type { SceneLayer } from '../spec';
import type { PresetDef } from './mg';

function str(v: unknown, fb = ''): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fb;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 国风墨韵标题：竖排衬线大字 + 卷轴揭示 + 印章落款 */
const guofengTitle: PresetDef = {
  id: 'style.guofeng',
  label: '艺术方向·国风墨韵',
  group: '艺术方向',
  paramsDoc: '{ title: string(≤8字), sub?: string, seal?: string(印章字≤2字,默认"印") }',
  defaultDuration: 5,
  build(params, duration) {
    const title = str(params.title, '东方');
    const sub = str(params.sub);
    const layers: SceneLayer[] = [
      {
        id: 'title', kind: 'text', text: title, class: 'kp-vert kp-serif',
        style: { fontSize: '150px', fontWeight: '600', color: 'var(--fx-text)' },
        at: { x: '62%', y: '50%', anchor: 'center' }, z: 3,
        effects: [{ type: 'kineticText', split: 'char', at: 0.3, stagger: 0.18, dur: 0.7, from: { y: -60, opacity: 0 }, ease: 'outQuart' }],
      },
      {
        id: 'rule', kind: 'shape',
        html: `<div class="kit-guofeng-rule" style="width:2px;height:420px"></div>`,
        at: { x: '50%', y: '50%', anchor: 'center' }, z: 2,
        tracks: [{ prop: 'scaleY', kf: [{ t: 0.2, v: 0 }, { t: 1.1, v: 1, ease: 'outQuart' }] }],
      },
    ];
    if (sub) {
      layers.push({
        id: 'sub', kind: 'text', text: sub, class: 'kp-vert kp-serif',
        style: { fontSize: '38px', color: 'var(--fx-accent2)', letterSpacing: '0.2em' },
        at: { x: '42%', y: '52%', anchor: 'center' }, z: 3, in: 1.0,
        tracks: [{ prop: 'opacity', kf: [{ t: 1.0, v: 0 }, { t: 1.7, v: 1, ease: 'outQuad' }] }],
      });
    }
    return {
      v: 1, duration, style: 'guofeng', bg: 'opaque',
      camera: { tracks: [{ prop: 'scale', kf: [{ t: 0, v: 1.03 }, { t: duration, v: 1, ease: 'outQuad' }] }] },
      layers,
    };
  },
};

/** 赛博 HUD 标题：故障字 + 霓虹辉光 + 数据拼装 */
const cyberTitle: PresetDef = {
  id: 'style.cyber',
  label: '艺术方向·赛博霓虹',
  group: '艺术方向',
  paramsDoc: '{ title: string(≤10字), code?: string(副标数据串) }',
  defaultDuration: 4.5,
  build(params, duration) {
    const title = str(params.title, 'SYSTEM');
    const code = str(params.code, 'v2.077 // neural-link');
    return {
      v: 1, duration, style: 'cyber', bg: 'opaque',
      beats: [0, 0.3, 1.4],
      layers: [
        {
          id: 'title', kind: 'text', text: title, class: 'kp-h1 kit-cyber-neon kp-accent',
          at: { x: '50%', y: '44%', anchor: 'center' }, z: 3,
          effects: [
            { type: 'kineticText', split: 'char', at: 0.3, stagger: 0.035, dur: 0.4, from: { x: -30, opacity: 0 }, ease: 'outExpo' },
            { type: 'glitch', at: 'beat:2', dur: 0.6, amp: 8, seed: 7 },
          ],
        },
        {
          id: 'code', kind: 'text', text: code, class: 'kp-label',
          style: { fontFamily: "'Space Grotesk',monospace", color: 'var(--fx-accent2)', fontSize: '22px', letterSpacing: '0.12em' },
          at: { x: '50%', y: '56%', anchor: 'center' }, z: 3, in: 0.9,
          effects: [{ type: 'typewriter', at: 0.9, charDur: 0.04 }],
        },
      ],
    };
  },
};

/** 瑞士极简宣言：超大字重对比 + 红块 + 直切 */
const swissStatement: PresetDef = {
  id: 'style.swiss',
  label: '艺术方向·瑞士极简',
  group: '艺术方向',
  paramsDoc: '{ big: string(超大主词≤6字), small?: string(注解), num?: string(编号如"01") }',
  defaultDuration: 4.5,
  build(params, duration) {
    const big = str(params.big, '设计');
    const small = str(params.small);
    const num = str(params.num, '01');
    const layers: SceneLayer[] = [
      {
        id: 'block', kind: 'shape',
        html: `<div class="kit-swiss-block" style="width:280px;height:120px"></div>`,
        at: { x: 64, y: 200, anchor: 'top-left' }, z: 1,
        effects: [{ type: 'maskReveal', at: 0.15, dur: 0.4, dir: 'left', ease: 'inOutExpo' }],
      },
      {
        id: 'num', kind: 'text', text: num, class: 'kp-mega',
        style: { fontSize: '110px', color: 'var(--fx-primary)' },
        at: { x: 96, y: 214, anchor: 'top-left' }, z: 2, in: 0.35,
        tracks: [{ prop: 'opacity', kf: [{ t: 0.35, v: 0 }, { t: 0.55, v: 1 }] }],
      },
      {
        id: 'big', kind: 'text', text: big, class: 'kp-mega',
        style: { fontSize: '240px', color: 'var(--fx-text)', lineHeight: '0.92' },
        at: { x: 60, y: 420, anchor: 'top-left' }, z: 3,
        effects: [{ type: 'maskReveal', at: 0.5, dur: 0.6, dir: 'bottom', ease: 'outExpo' }],
      },
    ];
    if (small) {
      layers.push({
        id: 'small', kind: 'text', text: small, class: 'kp-sub',
        style: { maxWidth: '760px', color: 'var(--fx-accent2)' },
        at: { x: 66, y: 760, anchor: 'top-left' }, w: 760, z: 3, in: 1.0,
        tracks: [{ prop: 'opacity', kf: [{ t: 1.0, v: 0 }, { t: 1.4, v: 1 }] }],
      });
    }
    return { v: 1, duration, style: 'swiss', bg: 'opaque', layers };
  },
};

/** 极光高级发布页：镭射渐变标题 + 玻璃卡 + 呼吸光 */
const auroraHero: PresetDef = {
  id: 'style.aurora',
  label: '艺术方向·极光高级',
  group: '艺术方向',
  paramsDoc: '{ title: string(≤12字), subtitle?: string, eyebrow?: string }',
  defaultDuration: 5.5,
  build(params, duration) {
    const title = str(params.title, '全新发布');
    const subtitle = str(params.subtitle);
    const eyebrow = str(params.eyebrow);
    const layers: SceneLayer[] = [];
    if (eyebrow) {
      layers.push({
        id: 'eyebrow', kind: 'text', text: eyebrow, class: 'kp-label kp-accent',
        at: { x: '50%', y: '35%', anchor: 'center' }, z: 3, in: 0.25,
        tracks: [
          { prop: 'opacity', kf: [{ t: 0.25, v: 0 }, { t: 0.85, v: 1, ease: 'outQuad' }] },
          { prop: 'y', kf: [{ t: 0.25, v: 16 }, { t: 0.95, v: 0, ease: 'outExpo' }] },
        ],
      });
    }
    layers.push({
      id: 'title', kind: 'text', text: title, class: 'kp-h1 kit-aurora-text',
      style: { fontSize: '112px', fontWeight: '700', letterSpacing: '-0.02em' },
      at: { x: '50%', y: '47%', anchor: 'center' }, z: 3,
      effects: [{ type: 'gradientShift', period: 6, colors: ['#7ef0d4', '#8f7bff', '#7ef0d4'], mode: 'text' }],
      tracks: [
        { prop: 'opacity', kf: [{ t: 0.45, v: 0 }, { t: 1.25, v: 1, ease: 'outQuad' }] },
        { prop: 'y', kf: [{ t: 0.45, v: 40 }, { t: 1.45, v: 0, ease: 'outExpo' }] },
        { prop: 'blur', kf: [{ t: 0.45, v: 12 }, { t: 1.35, v: 0, ease: 'outQuad' }] },
      ],
    });
    if (subtitle) {
      layers.push({
        id: 'sub', kind: 'text', text: subtitle, class: 'kp-sub',
        style: { opacity: '0.75' },
        at: { x: '50%', y: '59%', anchor: 'center' }, z: 3, in: 0.9,
        tracks: [
          { prop: 'opacity', kf: [{ t: 0.9, v: 0 }, { t: 1.7, v: 0.82, ease: 'outQuad' }] },
          { prop: 'y', kf: [{ t: 0.9, v: 24 }, { t: 1.8, v: 0, ease: 'outExpo' }] },
        ],
      });
    }
    return {
      v: 1, duration, style: 'aurora', bg: 'opaque',
      camera: { tracks: [{ prop: 'scale', kf: [{ t: 0, v: 1.04 }, { t: duration, v: 1, ease: 'outQuad' }] }] },
      layers,
    };
  },
};

/** 复古胶片记忆：显影入场 + 圆衬线 + 暖褪色 */
const retroMemory: PresetDef = {
  id: 'style.retro',
  label: '艺术方向·复古胶片',
  group: '艺术方向',
  paramsDoc: '{ title: string(≤12字), caption?: string }',
  defaultDuration: 5,
  build(params, duration) {
    const title = str(params.title, '那年夏天');
    const caption = str(params.caption);
    const layers: SceneLayer[] = [
      {
        id: 'title', kind: 'text', text: title, class: 'kp-h1 kp-serif',
        style: { color: 'var(--fx-text)', fontSize: '84px' },
        at: { x: '50%', y: '46%', anchor: 'center' }, z: 3,
        tracks: [
          { prop: 'opacity', kf: [{ t: 0.3, v: 0 }, { t: 1.3, v: 1, ease: 'outQuad' }] },
          { prop: 'blur', kf: [{ t: 0.3, v: 10 }, { t: 1.4, v: 0, ease: 'outQuad' }] },
        ],
        effects: [{ type: 'shake', at: 0, dur: duration, amp: 1.6, freq: 3.5, seed: 4 }],
      },
    ];
    if (caption) {
      layers.push({
        id: 'caption', kind: 'text', text: caption, class: 'kp-sub kp-serif',
        style: { color: 'var(--fx-accent)', opacity: '0.85' },
        at: { x: '50%', y: '58%', anchor: 'center' }, z: 3, in: 1.2,
        tracks: [{ prop: 'opacity', kf: [{ t: 1.2, v: 0 }, { t: 2.0, v: 0.85, ease: 'outQuad' }] }],
      });
    }
    return { v: 1, duration, style: 'retro', bg: 'opaque', layers };
  },
};

/** 孟菲斯撞色开箱：贴纸卡 + 弹跳 + 几何漂浮 */
const memphisPop: PresetDef = {
  id: 'style.memphis',
  label: '艺术方向·孟菲斯撞色',
  group: '艺术方向',
  paramsDoc: '{ title: string(≤8字), tag?: string(贴纸小字) }',
  defaultDuration: 4,
  build(params, duration) {
    const title = str(params.title, '开箱');
    const tag = str(params.tag);
    const layers: SceneLayer[] = [
      {
        id: 'card', kind: 'html',
        html: `<div class="kit-memphis-sticker" style="padding:48px 72px"><div style="font-size:100px;font-weight:800;color:var(--fx-text);letter-spacing:-0.02em">${esc(title)}</div></div>`,
        at: { x: '50%', y: '48%', anchor: 'center' }, z: 3,
        tracks: [
          { prop: 'scale', kf: [{ t: 0.2, v: 0.4 }, { t: 0.75, v: 1, spring: { stiffness: 260, damping: 11 } }] },
          { prop: 'rotate', kf: [{ t: 0.2, v: -8 }, { t: 0.8, v: -2, ease: 'outBack' }] },
          { prop: 'opacity', kf: [{ t: 0.2, v: 0 }, { t: 0.4, v: 1 }] },
        ],
      },
    ];
    if (tag) {
      layers.push({
        id: 'tag', kind: 'html',
        html: `<div style="background:var(--fx-accent);color:#fff;font-size:30px;font-weight:800;padding:12px 26px;border-radius:999px;border:4px solid var(--fx-text);transform:rotate(6deg)">${esc(tag)}</div>`,
        at: { x: '68%', y: '36%', anchor: 'center' }, z: 4, in: 0.7,
        tracks: [
          { prop: 'scale', kf: [{ t: 0.7, v: 0 }, { t: 1.15, v: 1, spring: { stiffness: 280, damping: 10 } }] },
        ],
      });
    }
    return { v: 1, duration, style: 'memphis', bg: 'opaque', layers };
  },
};

export const STYLED_PRESETS: PresetDef[] = [
  guofengTitle, cyberTitle, swissStatement, auroraHero, retroMemory, memphisPop,
];
