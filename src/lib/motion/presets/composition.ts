/**
 * presets/composition — 构图语法预设（设计词汇示范层）。
 *
 * 每个预设示范一种构图语法 × 表面质感 × 运动家族的组合。
 * 它们的首要角色是给 agent 的"构图词汇表"：拿骨架理解空间关系，
 * 再用 spec_patch 或手写 spec 注入内容个性。
 */
import type { SceneLayer } from '../spec';
import type { PresetDef } from './mg';

function str(v: unknown, fb = ''): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fb;
}

function strArr(v: unknown, max = 6): string[] {
  return (Array.isArray(v) ? v : []).map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, max);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 全出血海报：超大字撑满画面 + 描边字重叠 + 噪点，海报级冲击 */
const posterBleed: PresetDef = {
  id: 'comp.posterBleed',
  label: '构图·全出血海报',
  group: 'MG 动画',
  paramsDoc: '{ word: string(核心词≤6字), sub?: string(角标小字), theme?: string }',
  defaultDuration: 4,
  build(params, duration) {
    const word = str(params.word, '主题');
    const sub = str(params.sub);
    const layers: SceneLayer[] = [
      {
        id: 'texture', kind: 'shape',
        html: `<div class="kp-noise kp-vignette" style="position:relative;width:1920px;height:1080px"></div>`,
        at: { x: '50%', y: '50%', anchor: 'center' }, z: 1, parallax: 0,
      },
      {
        // 底层描边字：错位放大，做纹理
        id: 'ghost', kind: 'text', text: word, class: 'kp-mega kp-outline',
        style: { fontSize: '360px', opacity: '0.22', whiteSpace: 'nowrap' },
        at: { x: '52%', y: '54%', anchor: 'center' }, z: 2, parallax: 0.55,
        tracks: [
          { prop: 'x', kf: [{ t: 0, v: 60 }, { t: duration, v: -60, ease: 'linear' }] },
          { prop: 'opacity', kf: [{ t: 0, v: 0 }, { t: 0.8, v: 0.9, ease: 'outQuad' }] },
        ],
      },
      {
        // 主字：实心，压在描边字上
        id: 'main', kind: 'text', text: word, class: 'kp-mega',
        style: { fontSize: '280px', whiteSpace: 'nowrap' },
        at: { x: '48%', y: '48%', anchor: 'center' }, z: 3,
        effects: [
          { type: 'kineticText', split: 'char', at: 0.25, stagger: 0.07, dur: 0.6, from: { y: 120, opacity: 0 }, spring: { stiffness: 170, damping: 15 } },
          { type: 'shine', at: 1.3, dur: 1.2 },
        ],
      },
      ...(sub ? [{
        id: 'sub', kind: 'text' as const, text: sub, class: 'kp-label',
        at: { x: '86%', y: '86%', anchor: 'bottom-right' as const }, z: 4, in: 1.1,
        tracks: [{ prop: 'opacity' as const, kf: [{ t: 1.1, v: 0 }, { t: 1.6, v: 0.8, ease: 'outQuad' as const }] }],
      }] : []),
    ];
    return {
      v: 1, duration, theme: str(params.theme) || 'slate', bg: 'opaque',
      bgCss: 'linear-gradient(165deg,#0b0b0e 0%,#141419 100%)',
      fonts: ['minimal'], layers,
    };
  },
};

/** 编辑式非对称分栏（37/63）：左窄栏元信息轨 + 右宽栏主内容，杂志版式 */
const editorialSplit: PresetDef = {
  id: 'comp.editorialSplit',
  label: '构图·编辑分栏',
  group: '信息页',
  paramsDoc: '{ kicker: string(栏眉如"观点 03"), title: string(≤16字), body?: string(≤60字), theme?: string }',
  defaultDuration: 6,
  build(params, duration) {
    const kicker = str(params.kicker, 'NO.01');
    const title = str(params.title, '标题');
    const body = str(params.body);
    const layers: SceneLayer[] = [
      {
        id: 'rail', kind: 'shape',
        html: `<div style="width:3px;height:760px;background:currentColor;opacity:.25"></div>`,
        at: { x: 640, y: '50%', anchor: 'center' }, z: 2,
        tracks: [{ prop: 'scaleY', kf: [{ t: 0.2, v: 0 }, { t: 1.0, v: 1, ease: 'outExpo' }] }],
      },
      {
        id: 'kicker', kind: 'text', text: kicker, class: 'kp-label kp-index',
        at: { x: 560, y: 260, anchor: 'top-right' }, z: 3, in: 0.35,
        tracks: [
          { prop: 'opacity', kf: [{ t: 0.35, v: 0 }, { t: 0.85, v: 0.85, ease: 'outQuad' }] },
          { prop: 'x', kf: [{ t: 0.35, v: -24 }, { t: 0.95, v: 0, ease: 'outExpo' }] },
        ],
      },
      {
        id: 'vertdate', kind: 'text', text: kicker, class: 'kp-vert kp-label',
        style: { opacity: '0.3' },
        at: { x: 160, y: '50%', anchor: 'center' }, z: 2, in: 0.8, parallax: 0.7,
        tracks: [{ prop: 'opacity', kf: [{ t: 0.8, v: 0 }, { t: 1.4, v: 0.3, ease: 'outQuad' }] }],
      },
      {
        id: 'title', kind: 'text', text: title, class: 'kp-h1 kp-serif',
        style: { maxWidth: '1000px', lineHeight: '1.18' },
        at: { x: 720, y: 300, anchor: 'top-left' }, w: 1000, z: 3,
        effects: [{ type: 'maskReveal', at: 0.5, dur: 0.75, dir: 'left', ease: 'outExpo' }],
        tracks: [{ prop: 'opacity', kf: [{ t: 0.5, v: 0 }, { t: 0.75, v: 1 }] }],
      },
    ];
    if (body) {
      layers.push({
        id: 'body', kind: 'text', text: body, class: 'kp-body',
        style: { maxWidth: '880px', opacity: '0.75', lineHeight: '1.7' },
        at: { x: 724, y: 640, anchor: 'top-left' }, w: 880, z: 3, in: 1.1,
        tracks: [
          { prop: 'opacity', kf: [{ t: 1.1, v: 0 }, { t: 1.8, v: 0.75, ease: 'outQuad' }] },
          { prop: 'y', kf: [{ t: 1.1, v: 26 }, { t: 1.9, v: 0, ease: 'outExpo' }] },
        ],
      });
    }
    return {
      v: 1, duration, theme: str(params.theme) || 'paper', bg: 'opaque',
      fonts: ['editorial'],
      layers,
    };
  },
};

/** 对角线张力：内容沿对角轴排布 + 斜切色块，运动方向统一沿对角线 */
const diagonalTension: PresetDef = {
  id: 'comp.diagonal',
  label: '构图·对角张力',
  group: 'MG 动画',
  paramsDoc: '{ title: string(≤10字), tags?: string[](≤3), theme?: string }',
  defaultDuration: 4.5,
  build(params, duration) {
    const title = str(params.title, '标题');
    const tags = strArr(params.tags, 3);
    const layers: SceneLayer[] = [
      {
        id: 'slab', kind: 'shape',
        html: `<div style="width:2600px;height:400px;background:linear-gradient(90deg,var(--fx-accent),var(--fx-accent2));transform:rotate(-12deg);opacity:.92"></div>`,
        at: { x: '50%', y: '52%', anchor: 'center' }, z: 1,
        effects: [{ type: 'maskReveal', at: 0.1, dur: 0.6, dir: 'left', ease: 'inOutExpo' }],
      },
      {
        id: 'title', kind: 'html',
        html: `<div style="transform:rotate(-12deg);font-size:96px;font-weight:600;letter-spacing:-0.025em;color:#fff;white-space:nowrap">${esc(title)}</div>`,
        at: { x: '46%', y: '48%', anchor: 'center' }, z: 3,
        tracks: [
          { prop: 'x', kf: [{ t: 0.45, v: -70 }, { t: 1.0, v: 0, ease: 'outExpo' }] },
          { prop: 'opacity', kf: [{ t: 0.45, v: 0 }, { t: 0.9, v: 1, ease: 'outQuad' }] },
        ],
      },
    ];
    tags.forEach((tag, i) => {
      const at = 1.0 + i * 0.18;
      layers.push({
        id: `tag${i}`, kind: 'html',
        html: `<div class="kp-tag" style="transform:rotate(-12deg);color:var(--fx-text)">${esc(tag)}</div>`,
        at: { x: `${58 + i * 9}%`, y: `${64 + i * 7}%`, anchor: 'center' }, z: 3, in: at,
        tracks: [
          { prop: 'x', kf: [{ t: at, v: -46 }, { t: at + 0.55, v: 0, ease: 'outExpo' }] },
          { prop: 'y', kf: [{ t: at, v: 10 }, { t: at + 0.55, v: 0, ease: 'outExpo' }] },
          { prop: 'opacity', kf: [{ t: at, v: 0 }, { t: at + 0.4, v: 1 }] },
        ],
      });
    });
    return { v: 1, duration, theme: str(params.theme) || 'indigo', bg: 'transparent', fonts: ['minimal'], layers };
  },
};

/** Bento 网格：不等格块拼贴（1 大 N 小），信息密度高但秩序感强 */
const bentoGrid: PresetDef = {
  id: 'comp.bento',
  label: '构图·Bento 网格',
  group: '信息页',
  paramsDoc: '{ hero: {title:string, value?:string}(大格), cells: {title:string, value?:string}[](2-4 小格), theme?: string }',
  defaultDuration: 6,
  build(params, duration) {
    const hero = (params.hero ?? {}) as { title?: unknown; value?: unknown };
    const cells = (Array.isArray(params.cells) ? params.cells : []).slice(0, 4) as { title?: unknown; value?: unknown }[];
    const G = 28;
    const heroW = 900; const heroH = 620;
    const cellW = 640; const cellH = (heroH - G) / 2;
    const left = (1920 - heroW - G - cellW) / 2;
    const top = 250;
    const card = (title: string, value: string, big: boolean) =>
      `<div class="kp-glass" style="width:100%;height:100%;border-radius:26px;padding:${big ? 52 : 36}px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:flex-end">${value ? `<div style="font-size:${big ? 120 : 56}px;font-weight:700;letter-spacing:-0.03em;color:var(--fx-accent);font-variant-numeric:tabular-nums;line-height:1">${esc(value)}</div>` : ''}<div style="font-size:${big ? 34 : 24}px;font-weight:500;opacity:.8;margin-top:14px">${esc(title)}</div></div>`;
    const layers: SceneLayer[] = [
      {
        id: 'glow', kind: 'shape',
        html: `<div class="kp-glow" style="width:900px;height:900px;position:relative"></div>`,
        at: { x: '30%', y: '20%', anchor: 'center' }, z: 1, parallax: 0.5,
        tracks: [{ prop: 'opacity', kf: [{ t: 0, v: 0 }, { t: 1.4, v: 0.7, ease: 'outQuad' }] }],
      },
      {
        id: 'hero', kind: 'html',
        html: card(str(hero.title, ''), str(hero.value), true),
        at: { x: left, y: top, anchor: 'top-left' }, w: heroW, h: heroH, z: 2, in: 0.3,
        tracks: [
          { prop: 'y', kf: [{ t: 0.3, v: 44 }, { t: 1.0, v: 0, ease: 'outExpo' }] },
          { prop: 'opacity', kf: [{ t: 0.3, v: 0 }, { t: 0.9, v: 1 }] },
        ],
      },
    ];
    cells.forEach((c, i) => {
      const col = Math.floor(i / 2); const row = i % 2;
      const at = 0.55 + i * 0.16;
      layers.push({
        id: `cell${i}`, kind: 'html',
        html: card(str(c.title, ''), str(c.value), false),
        at: { x: left + heroW + G + col * (cellW + G), y: top + row * (cellH + G), anchor: 'top-left' },
        w: cellW, h: cellH, z: 2, in: at,
        tracks: [
          { prop: 'y', kf: [{ t: at, v: 38 }, { t: at + 0.65, v: 0, ease: 'outExpo' }] },
          { prop: 'opacity', kf: [{ t: at, v: 0 }, { t: at + 0.5, v: 1 }] },
        ],
      });
    });
    return {
      v: 1, duration, theme: str(params.theme) || 'slate', bg: 'opaque',
      bgCss: 'radial-gradient(ellipse 80% 60% at 30% 0%,#191a22 0%,#0b0b0f 60%)',
      fonts: ['minimal'],
      camera: { tracks: [{ prop: 'scale', kf: [{ t: 0, v: 1.03 }, { t: duration, v: 1, ease: 'outQuad' }] }] },
      layers,
    };
  },
};

/** 索引目录：编号 + 条目的目录页（章节预告/要点总览），编辑感 */
const indexList: PresetDef = {
  id: 'comp.indexList',
  label: '构图·索引目录',
  group: '信息页',
  paramsDoc: '{ title: string, items: string[](2-5条,每条≤14字), theme?: string }',
  defaultDuration: 6,
  build(params, duration) {
    const title = str(params.title, '目录');
    const items = strArr(params.items, 5);
    const rowH = Math.min(150, 620 / items.length);
    const top = 380;
    const layers: SceneLayer[] = [
      {
        id: 'grid', kind: 'shape',
        html: `<div class="kp-dots" style="position:relative;width:1920px;height:1080px"></div>`,
        at: { x: '50%', y: '50%', anchor: 'center' }, z: 1, parallax: 0,
      },
      {
        id: 'title', kind: 'text', text: title, class: 'kp-h2',
        at: { x: 220, y: 200, anchor: 'top-left' }, z: 3,
        effects: [{ type: 'maskReveal', at: 0.2, dur: 0.6, dir: 'left', ease: 'outExpo' }],
      },
    ];
    items.forEach((item, i) => {
      const at = 0.7 + i * 0.22;
      const y = top + i * rowH;
      layers.push(
        {
          id: `num${i}`, kind: 'text', text: String(i + 1).padStart(2, '0'), class: 'kp-index',
          style: { fontSize: '44px', color: 'var(--fx-accent)' },
          at: { x: 224, y, anchor: 'top-left' }, z: 3, in: at,
          tracks: [
            { prop: 'opacity', kf: [{ t: at, v: 0 }, { t: at + 0.4, v: 0.9 }] },
            { prop: 'x', kf: [{ t: at, v: -28 }, { t: at + 0.55, v: 0, ease: 'outExpo' }] },
          ],
        },
        {
          id: `item${i}`, kind: 'text', text: item, class: 'kp-h3',
          style: { fontWeight: '500' },
          at: { x: 360, y: y - 8, anchor: 'top-left' }, z: 3, in: at + 0.08,
          tracks: [
            { prop: 'opacity', kf: [{ t: at + 0.08, v: 0 }, { t: at + 0.5, v: 1 }] },
            { prop: 'x', kf: [{ t: at + 0.08, v: 34 }, { t: at + 0.7, v: 0, ease: 'outExpo' }] },
          ],
        },
        {
          id: `rule${i}`, kind: 'shape',
          html: `<div style="width:1480px;height:1px;background:currentColor;opacity:.16"></div>`,
          at: { x: 220, y: y + rowH - 24, anchor: 'top-left' }, z: 2, in: at + 0.15,
          tracks: [{ prop: 'scaleX', kf: [{ t: at + 0.15, v: 0 }, { t: at + 0.85, v: 1, ease: 'outExpo' }] }],
        },
      );
    });
    return { v: 1, duration, theme: str(params.theme) || 'slate', bg: 'opaque', fonts: ['minimal'], layers };
  },
};

/** 下三分之一：主持人条（姓名/头衔/话题），新闻与访谈标配 */
const lowerThird: PresetDef = {
  id: 'comp.lowerThird',
  label: '构图·下三分之一条',
  group: '口播包装',
  paramsDoc: '{ name: string(主文字), meta?: string(次行,头衔/话题), at?: number, theme?: string }',
  defaultDuration: 5,
  build(params, duration) {
    const name = str(params.name, '');
    const meta = str(params.meta);
    const at = Number(params.at) || 0.2;
    const outAt = duration - 0.45;
    return {
      v: 1, duration, theme: str(params.theme) || 'slate', bg: 'transparent', fonts: ['minimal'],
      layers: [
        {
          id: 'bar', kind: 'shape',
          html: `<div style="width:10px;height:${meta ? 118 : 84}px;background:var(--fx-accent);border-radius:5px"></div>`,
          at: { x: 150, y: '82%', anchor: 'left' }, z: 3, in: at,
          tracks: [
            { prop: 'scaleY', kf: [{ t: at, v: 0 }, { t: at + 0.4, v: 1, ease: 'outExpo' }, { t: outAt, v: 1 }, { t: outAt + 0.3, v: 0, ease: 'inCubic' }] },
          ],
        },
        {
          id: 'name', kind: 'text', text: name, class: 'kp-h3 kp-shadow',
          at: { x: 190, y: meta ? '80%' : '82%', anchor: 'left' }, z: 3, in: at + 0.12, out: outAt + 0.3,
          effects: [{ type: 'maskReveal', at: at + 0.12, dur: 0.5, dir: 'left', ease: 'outExpo' }],
          tracks: [{ prop: 'opacity', kf: [{ t: outAt, v: 1 }, { t: outAt + 0.3, v: 0, ease: 'inQuad' }] }],
        },
        ...(meta ? [{
          id: 'meta', kind: 'text' as const, text: meta, class: 'kp-sub kp-shadow',
          style: { opacity: '0.78' },
          at: { x: 192, y: '86.5%', anchor: 'left' as const }, z: 3, in: at + 0.3, out: outAt + 0.25,
          effects: [{ type: 'maskReveal' as const, at: at + 0.3, dur: 0.45, dir: 'left' as const, ease: 'outExpo' as const }],
          tracks: [{ prop: 'opacity' as const, kf: [{ t: outAt, v: 0.78 }, { t: outAt + 0.25, v: 0, ease: 'inQuad' as const }] }],
        }] : []),
      ],
    };
  },
};

/** 杂志堆叠：衬线大标题 + 引号装饰 + 高亮标记，人文引用页 */
const magazineQuote: PresetDef = {
  id: 'comp.magazineQuote',
  label: '构图·杂志引用页',
  group: '信息页',
  paramsDoc: '{ quote: string(≤40字), source?: string, highlight?: string(quote 中要高亮的短语), theme?: string }',
  defaultDuration: 6,
  build(params, duration) {
    const quote = str(params.quote, '');
    const source = str(params.source);
    const highlight = str(params.highlight);
    const quoteHtml = highlight && quote.includes(highlight)
      ? esc(quote).replace(esc(highlight), `<span class="kp-mark">${esc(highlight)}</span>`)
      : esc(quote);
    return {
      v: 1, duration, theme: str(params.theme) || 'paper', bg: 'opaque',
      fonts: ['editorial'],
      camera: { tracks: [{ prop: 'scale', kf: [{ t: 0, v: 1 }, { t: duration, v: 1.03, ease: 'linear' }] }] },
      layers: [
        {
          id: 'mark', kind: 'text', text: '“', class: 'kp-quote-mark',
          at: { x: 300, y: 300, anchor: 'top-left' }, z: 2, parallax: 0.7,
          tracks: [
            { prop: 'opacity', kf: [{ t: 0.15, v: 0 }, { t: 0.9, v: 1, ease: 'outQuad' }] },
            { prop: 'y', kf: [{ t: 0.15, v: -30 }, { t: 1.0, v: 0, ease: 'outExpo' }] },
          ],
        },
        {
          id: 'quote', kind: 'html',
          html: `<div class="kp-serif" style="font-size:64px;line-height:1.5;letter-spacing:-0.01em;max-width:1280px">${quoteHtml}</div>`,
          at: { x: 380, y: 420, anchor: 'top-left' }, w: 1280, z: 3, in: 0.5,
          tracks: [
            { prop: 'opacity', kf: [{ t: 0.5, v: 0 }, { t: 1.3, v: 1, ease: 'outQuad' }] },
            { prop: 'y', kf: [{ t: 0.5, v: 36 }, { t: 1.5, v: 0, ease: 'outExpo' }] },
            { prop: 'blur', kf: [{ t: 0.5, v: 6 }, { t: 1.4, v: 0, ease: 'outQuad' }] },
          ],
        },
        ...(source ? [{
          id: 'source', kind: 'text' as const, text: `— ${source}`, class: 'kp-sub',
          style: { opacity: '0.6' },
          at: { x: 384, y: 820, anchor: 'top-left' as const }, z: 3, in: 1.6,
          tracks: [{ prop: 'opacity' as const, kf: [{ t: 1.6, v: 0 }, { t: 2.2, v: 0.6, ease: 'outQuad' as const }] }],
        }] : []),
      ],
    };
  },
};

export const COMPOSITION_PRESETS: PresetDef[] = [
  posterBleed, editorialSplit, diagonalTension, bentoGrid, indexList, lowerThird, magazineQuote,
];
