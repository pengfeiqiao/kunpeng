/**
 * presets/infopage — 非透明信息页预设（bg: opaque）。
 *
 * 口播长逻辑段的承载体：流程链 / 因果 / 对比 / 概念图。
 * 版式原则：明确背景、至少一个 56px+ 主视觉、层级清晰、留白充足。
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

/** 流程链：标题 + 横向步骤节点，连接线描线、节点依次弹入 */
const flowChain: PresetDef = {
  id: 'info.flowChain',
  label: '信息页·流程链',
  group: '信息页',
  paramsDoc: '{ title: string, steps: string[](2-5步,每步≤10字), theme?: string, bgCss?: string }',
  defaultDuration: 6,
  build(params, duration) {
    const title = str(params.title, '流程');
    const steps = strArr(params.steps, 5);
    const n = Math.max(2, steps.length);
    const totalW = 1600;
    const gap = totalW / (n - 1);
    const startX = (1920 - totalW) / 2;
    const cy = 620;
    const lineY = 26;

    const layers: SceneLayer[] = [
      {
        id: 'title', kind: 'text', text: title, class: 'kp-h2',
        at: { x: '50%', y: 220, anchor: 'center' }, z: 3,
        effects: [{ type: 'kineticText', split: 'char', at: 0.2, stagger: 0.04, dur: 0.5, from: { y: 44, opacity: 0 }, spring: { stiffness: 200, damping: 16 } }],
      },
      {
        id: 'rail', kind: 'svg',
        svg: `<svg width="${totalW + 40}" height="52" viewBox="0 0 ${totalW + 40} 52" fill="none"><line x1="20" y1="${lineY}" x2="${totalW + 20}" y2="${lineY}" stroke="var(--fx-accent)" stroke-width="5" stroke-linecap="round" stroke-dasharray="2 18"/></svg>`,
        at: { x: '50%', y: cy, anchor: 'center' }, z: 1,
        effects: [{ type: 'lineDraw', at: 0.7, dur: 1.1, ease: 'inOutCubic' }],
      },
    ];

    steps.forEach((s, i) => {
      const at = 0.9 + i * 0.28;
      layers.push({
        id: `node${i}`, kind: 'html',
        html: `<div style="display:flex;flex-direction:column;align-items:center;gap:22px"><div style="width:88px;height:88px;border-radius:50%;background:var(--fx-surface);border:5px solid var(--fx-accent);display:flex;align-items:center;justify-content:center;font-size:36px;font-weight:800;color:var(--fx-accent)">${i + 1}</div><div style="font-size:32px;font-weight:600;color:var(--fx-text);max-width:280px;text-align:center;line-height:1.35">${esc(s)}</div></div>`,
        at: { x: startX + gap * i, y: cy + 20, anchor: 'top' }, z: 2,
        in: at,
        tracks: [
          { prop: 'y', kf: [{ t: at, v: 46 }, { t: at + 0.5, v: 0, spring: { stiffness: 190, damping: 15 } }] },
          { prop: 'opacity', kf: [{ t: at, v: 0 }, { t: at + 0.3, v: 1 }] },
        ],
      });
    });

    return {
      v: 1, duration, theme: str(params.theme) || 'techblue',
      bg: 'opaque', bgCss: str(params.bgCss) || undefined,
      fonts: ['minimal'],
      camera: { tracks: [{ prop: 'scale', kf: [{ t: 0, v: 1.02 }, { t: duration, v: 1, ease: 'outQuad' }] }] },
      layers,
    };
  },
};

/** 因果链：原因卡 → 箭头 → 多个结果卡 */
const causeEffect: PresetDef = {
  id: 'info.causeEffect',
  label: '信息页·因果链',
  group: '信息页',
  paramsDoc: '{ title?: string, cause: string(原因≤14字), effects: string[](1-3个结果,每个≤14字), theme?: string }',
  defaultDuration: 6,
  build(params, duration) {
    const title = str(params.title);
    const cause = str(params.cause, '原因');
    const effects = strArr(params.effects, 3);
    const n = Math.max(1, effects.length);
    const rightX = 1290;
    const spacing = Math.min(280, 760 / n);
    const firstY = 540 - ((n - 1) * spacing) / 2 + (title ? 40 : 0);

    const layers: SceneLayer[] = [];
    if (title) {
      layers.push({
        id: 'title', kind: 'text', text: title, class: 'kp-h3',
        at: { x: '50%', y: 170, anchor: 'center' }, z: 3,
        effects: [{ type: 'maskReveal', at: 0.15, dur: 0.5, dir: 'left', ease: 'outExpo' }],
        tracks: [{ prop: 'opacity', kf: [{ t: 0.15, v: 0 }, { t: 0.4, v: 1 }] }],
      });
    }
    layers.push({
      id: 'cause', kind: 'html',
      html: `<div style="padding:44px 56px;background:var(--fx-surface);border:3px solid var(--fx-accent);border-radius:24px;font-size:44px;font-weight:800;color:var(--fx-text);max-width:520px;text-align:center;line-height:1.3">${esc(cause)}</div>`,
      at: { x: 470, y: 560 + (title ? 40 : 0), anchor: 'center' }, z: 2, in: 0.5,
      tracks: [
        { prop: 'scale', kf: [{ t: 0.5, v: 0.85 }, { t: 0.95, v: 1, spring: { stiffness: 200, damping: 14 } }] },
        { prop: 'opacity', kf: [{ t: 0.5, v: 0 }, { t: 0.8, v: 1 }] },
      ],
    });
    effects.forEach((e, i) => {
      const y = firstY + i * spacing;
      const at = 1.5 + i * 0.35;
      layers.push({
        id: `arrow${i}`, kind: 'svg',
        svg: `<svg width="260" height="120" viewBox="0 0 260 120" fill="none"><path d="M14 60 C 90 ${60 + (y - 560 - (title ? 40 : 0)) * -0.18}, 170 60, 226 60" stroke="var(--fx-accent2)" stroke-width="6" stroke-linecap="round"/><path d="M204 38 L 236 60 L 204 82" stroke="var(--fx-accent2)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`,
        at: { x: 870, y, anchor: 'center' }, z: 1, in: Math.max(0, at - 0.1),
        effects: [{ type: 'lineDraw', at, dur: 0.5, stagger: 0.18, ease: 'outCubic' }],
      });
      layers.push({
        id: `effect${i}`, kind: 'html',
        html: `<div style="padding:30px 44px;background:var(--fx-surface);border-left:8px solid var(--fx-accent2);border-radius:18px;font-size:36px;font-weight:600;color:var(--fx-text);min-width:480px;max-width:620px;line-height:1.35">${esc(e)}</div>`,
        at: { x: rightX, y, anchor: 'center' }, z: 2, in: at + 0.3,
        tracks: [
          { prop: 'x', kf: [{ t: at + 0.3, v: 60 }, { t: at + 0.75, v: 0, ease: 'outExpo' }] },
          { prop: 'opacity', kf: [{ t: at + 0.3, v: 0 }, { t: at + 0.6, v: 1 }] },
        ],
      });
    });

    return {
      v: 1, duration, theme: str(params.theme) || 'techblue', bg: 'opaque',
      fonts: ['minimal'], layers,
    };
  },
};

/** 对比分屏：左右两栏 VS 对比 */
const compareSplit: PresetDef = {
  id: 'info.compareSplit',
  label: '信息页·对比分屏',
  group: '信息页',
  paramsDoc: '{ title?: string, left: {title:string, points:string[](≤4)}, right: {title:string, points:string[](≤4)}, theme?: string }',
  defaultDuration: 7,
  build(params, duration) {
    const title = str(params.title);
    const left = (params.left ?? {}) as { title?: unknown; points?: unknown };
    const right = (params.right ?? {}) as { title?: unknown; points?: unknown };
    const col = (side: { title?: unknown; points?: unknown }, accent: string) => {
      const pts = strArr(side.points, 4).map((p) =>
        `<li style="font-size:32px;line-height:1.45;color:var(--fx-text);margin-bottom:20px;list-style:none;padding-left:36px;position:relative"><span style="position:absolute;left:0;top:10px;width:14px;height:14px;border-radius:4px;background:${accent}"></span>${esc(p)}</li>`).join('');
      return `<div style="width:760px;padding:52px 56px;background:var(--fx-surface);border-radius:28px;border-top:8px solid ${accent}"><div style="font-size:48px;font-weight:800;color:${accent};margin-bottom:36px">${esc(str(side.title, ''))}</div><ul style="margin:0;padding:0">${pts}</ul></div>`;
    };
    const topY = title ? 590 : 540;
    const layers: SceneLayer[] = [];
    if (title) {
      layers.push({
        id: 'title', kind: 'text', text: title, class: 'kp-h2',
        at: { x: '50%', y: 170, anchor: 'center' }, z: 3,
        effects: [{ type: 'kineticText', split: 'char', at: 0.2, stagger: 0.04, dur: 0.5, from: { y: 40, opacity: 0 }, ease: 'outBack' }],
      });
    }
    layers.push(
      {
        id: 'left', kind: 'html', html: col(left, 'var(--fx-accent)'),
        at: { x: 480, y: topY, anchor: 'center' }, z: 2, in: 0.5,
        tracks: [
          { prop: 'x', kf: [{ t: 0.5, v: -120 }, { t: 1.05, v: 0, ease: 'outExpo' }] },
          { prop: 'opacity', kf: [{ t: 0.5, v: 0 }, { t: 0.9, v: 1 }] },
        ],
      },
      {
        id: 'vs', kind: 'text', text: 'VS', class: 'kp-h3',
        style: { color: 'var(--fx-accent2)', fontStyle: 'italic', fontWeight: '800' },
        at: { x: '50%', y: topY, anchor: 'center' }, z: 3, in: 1.1,
        tracks: [
          { prop: 'scale', kf: [{ t: 1.1, v: 2.2 }, { t: 1.4, v: 1, ease: 'inExpo' }] },
          { prop: 'opacity', kf: [{ t: 1.1, v: 0 }, { t: 1.25, v: 1 }] },
        ],
        effects: [{ type: 'shake', at: 1.4, dur: 0.25, amp: 7, freq: 18, seed: 9 }],
      },
      {
        id: 'right', kind: 'html', html: col(right, 'var(--fx-accent2)'),
        at: { x: 1440, y: topY, anchor: 'center' }, z: 2, in: 0.7,
        tracks: [
          { prop: 'x', kf: [{ t: 0.7, v: 120 }, { t: 1.25, v: 0, ease: 'outExpo' }] },
          { prop: 'opacity', kf: [{ t: 0.7, v: 0 }, { t: 1.1, v: 1 }] },
        ],
      },
    );
    return { v: 1, duration, theme: str(params.theme) || 'slate', bg: 'opaque', fonts: ['minimal'], layers };
  },
};

/** 概念图：中心概念 + 周围要素放射状连线 */
const conceptMap: PresetDef = {
  id: 'info.conceptMap',
  label: '信息页·概念图',
  group: '信息页',
  paramsDoc: '{ center: string(核心概念≤8字), nodes: string[](2-6个关联要素,每个≤10字), title?: string, theme?: string }',
  defaultDuration: 7,
  build(params, duration) {
    const center = str(params.center, '概念');
    const nodes = strArr(params.nodes, 6);
    const title = str(params.title);
    const cx = 960; const cy = title ? 600 : 560;
    const R = 360;
    const layers: SceneLayer[] = [];
    if (title) {
      layers.push({
        id: 'title', kind: 'text', text: title, class: 'kp-h3',
        at: { x: '50%', y: 150, anchor: 'center' }, z: 4,
        tracks: [{ prop: 'opacity', kf: [{ t: 0.15, v: 0 }, { t: 0.5, v: 1, ease: 'outCubic' }] }],
      });
    }
    // 连线（一张 SVG 里全部画完，lineDraw stagger 依次生长）
    const lines = nodes.map((_, i) => {
      const ang = (Math.PI * 2 * i) / nodes.length - Math.PI / 2;
      const x2 = cx + Math.cos(ang) * R;
      const y2 = cy + Math.sin(ang) * R * 0.72;
      return `<path d="M ${cx} ${cy} L ${x2} ${y2}" stroke="var(--fx-accent2)" stroke-width="4" stroke-linecap="round" opacity="0.75"/>`;
    }).join('');
    layers.push({
      id: 'links', kind: 'svg',
      svg: `<svg width="1920" height="1080" viewBox="0 0 1920 1080" fill="none">${lines}</svg>`,
      at: { x: '50%', y: '50%', anchor: 'center' }, z: 1,
      effects: [{ type: 'lineDraw', at: 1.0, dur: 0.55, stagger: 0.16, ease: 'outCubic' }],
    });
    layers.push({
      id: 'center', kind: 'html',
      html: `<div style="padding:44px 64px;background:var(--fx-accent);border-radius:32px;font-size:52px;font-weight:700;letter-spacing:-0.02em;color:var(--fx-primary);box-shadow:0 16px 60px rgba(0,0,0,0.35)">${esc(center)}</div>`,
      at: { x: cx, y: cy, anchor: 'center' }, z: 3, in: 0.3,
      tracks: [
        { prop: 'scale', kf: [{ t: 0.3, v: 0.5 }, { t: 0.8, v: 1, spring: { stiffness: 210, damping: 13 } }] },
        { prop: 'opacity', kf: [{ t: 0.3, v: 0 }, { t: 0.55, v: 1 }] },
      ],
    });
    nodes.forEach((n, i) => {
      const ang = (Math.PI * 2 * i) / nodes.length - Math.PI / 2;
      const x = cx + Math.cos(ang) * R;
      const y = cy + Math.sin(ang) * R * 0.72;
      const at = 1.3 + i * 0.18;
      layers.push({
        id: `node${i}`, kind: 'html',
        html: `<div style="padding:24px 38px;background:var(--fx-surface);border:2px solid var(--fx-accent2);border-radius:20px;font-size:32px;font-weight:600;color:var(--fx-text);white-space:nowrap">${esc(n)}</div>`,
        at: { x, y, anchor: 'center' }, z: 2, in: at,
        tracks: [
          { prop: 'scale', kf: [{ t: at, v: 0.7 }, { t: at + 0.4, v: 1, spring: { stiffness: 230, damping: 14 } }] },
          { prop: 'opacity', kf: [{ t: at, v: 0 }, { t: at + 0.25, v: 1 }] },
        ],
      });
    });
    return { v: 1, duration, theme: str(params.theme) || 'indigo', bg: 'opaque', fonts: ['minimal'], layers };
  },
};

/** 要点清单：标题 + 逐条滑入的要点（承载长逻辑段的兜底版式） */
const pointList: PresetDef = {
  id: 'info.pointList',
  label: '信息页·要点清单',
  group: '信息页',
  paramsDoc: '{ title: string, points: string[](2-5条,每条≤22字), theme?: string, bgCss?: string }',
  defaultDuration: 7,
  build(params, duration) {
    const title = str(params.title, '要点');
    const points = strArr(params.points, 5);
    const firstY = 400;
    const spacing = Math.min(150, 560 / points.length);
    const layers: SceneLayer[] = [{
      id: 'title', kind: 'text', text: title, class: 'kp-h2',
      at: { x: 240, y: 210, anchor: 'left' }, z: 3,
      effects: [{ type: 'maskReveal', at: 0.2, dur: 0.55, dir: 'left', ease: 'outExpo' }],
      tracks: [{ prop: 'opacity', kf: [{ t: 0.2, v: 0 }, { t: 0.45, v: 1 }] }],
    }, {
      id: 'titlebar', kind: 'shape',
      html: `<div style="width:120px;height:10px;background:var(--fx-accent);border-radius:5px"></div>`,
      at: { x: 240, y: 290, anchor: 'left' }, z: 3, in: 0.5,
      tracks: [
        { prop: 'scaleX', kf: [{ t: 0.5, v: 0 }, { t: 0.95, v: 1, ease: 'outExpo' }] },
        { prop: 'opacity', kf: [{ t: 0.5, v: 0 }, { t: 0.7, v: 1 }] },
      ],
    }];
    points.forEach((p, i) => {
      const at = 0.8 + i * 0.3;
      layers.push({
        id: `pt${i}`, kind: 'html',
        html: `<div style="display:flex;align-items:center;gap:28px;max-width:1440px"><div style="flex-shrink:0;width:56px;height:56px;border-radius:16px;background:var(--fx-surface);border:2px solid var(--fx-accent);display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:800;color:var(--fx-accent)">${i + 1}</div><div style="font-size:36px;font-weight:500;color:var(--fx-text);line-height:1.4">${esc(p)}</div></div>`,
        at: { x: 240, y: firstY + spacing * i, anchor: 'left' }, z: 2, in: at,
        tracks: [
          { prop: 'x', kf: [{ t: at, v: -70 }, { t: at + 0.5, v: 0, ease: 'outExpo' }] },
          { prop: 'opacity', kf: [{ t: at, v: 0 }, { t: at + 0.35, v: 1 }] },
        ],
      });
    });
    return {
      v: 1, duration, theme: str(params.theme) || 'techblue', bg: 'opaque',
      bgCss: str(params.bgCss) || undefined, fonts: ['minimal'], layers,
    };
  },
};

export const INFO_PRESETS: PresetDef[] = [flowChain, causeEffect, compareSplit, conceptMap, pointList];
