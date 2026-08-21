/**
 * fxComponents — 口播展示组件库（HyperFrames 管线的参数化组件层）。
 *
 * 每个组件 = HTML/CSS 模板 + 参数 schema，实例化时注入设计 token
 * （fxDesignSystem）。UI 面板和 agent 的 timeline_add_fx(component 模式)
 * 共用，保证零美学风险。坐标系：1920×1080 舞台，安全区四边 8%。
 *
 * 约束：只用 html2canvas 支持的 CSS 子集（无 3D transform/backdrop-filter），
 * 动画全部 CSS @keyframes（WAAPI 可 seek，预览与导出逐帧一致）。
 */
import { themeCssVars, themeOf, FX_FONT_SCALE } from './fxDesignSystem';
import { EXT_FX_COMPONENTS } from './fxComponentsExt';
import { EXT2_FX_COMPONENTS } from './fxComponentsExt2';

export type FxCategory =
  | '数据' | '要点' | '强调' | '标题' | '口播' | '产品' | '对比' | '氛围' | '转场';

export const FX_CATEGORIES: FxCategory[] = [
  '标题', '口播', '强调', '要点', '数据', '产品', '对比', '氛围', '转场',
];

export interface FxComponentDef {
  id: string;
  label: string;
  category: FxCategory;
  /** 给 agent 看的参数说明（写进工具 description） */
  paramsDoc: string;
  /** 实例化：参数 + 主题 → html/css */
  render: (params: Record<string, unknown>, themeId?: string) => { html: string; css: string };
}

const STAGE = `position:absolute;inset:0;font-family:'PingFang SC','Microsoft YaHei',sans-serif;`;

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function arr(v: unknown, max = 6): string[] {
  return (Array.isArray(v) ? v : []).slice(0, max).map((x) => String(x));
}

function root(themeId: string | undefined, inner: string): string {
  return `<div class="fx-root" style="${STAGE}${themeCssVars(themeOf(themeId))}">${inner}</div>`;
}

// ── 数据类 ────────────────────────────────────────────────────────────────────

const numberRoll: FxComponentDef = {
  id: 'number-roll',
  label: '数字滚动',
  category: '数据',
  paramsDoc: '{ value: string(纯数字如"1280"), unit?: string(单位如"万"), label?: string(说明文字) }',
  render(params, themeId) {
    const value = String(params.value ?? '0').replace(/[^\d]/g, '') || '0';
    const unit = esc(params.unit ?? '');
    const label = esc(params.label ?? '');
    const cols = [...value].map((d, i) =>
      `<span class="nr-col" style="animation-delay:${0.15 + i * 0.12}s;--tgt:${d}">${Array.from({ length: 10 }, (_, n) => `<i>${n}</i>`).join('')}</span>`,
    ).join('');
    return {
      html: root(themeId, `<div class="nr-wrap"><div class="nr-num">${cols}<em class="nr-unit">${unit}</em></div>${label ? `<div class="nr-label">${label}</div>` : ''}</div>`),
      css: `
.nr-wrap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;animation:nrIn .5s var(--fx-ease-enter) both}
.nr-num{font-size:${FX_FONT_SCALE.display}px;font-weight:800;color:var(--fx-accent);letter-spacing:4px}
.nr-col{display:inline-block;height:1em;overflow:hidden;vertical-align:top}
.nr-col i{display:block;font-style:normal;height:1em;line-height:1em;animation:nrRoll .9s var(--fx-ease-enter) both;animation-delay:inherit;transform:translateY(0)}
@keyframes nrRoll{to{transform:translateY(calc(var(--tgt)*-1em))}}
.nr-unit{font-style:normal;font-size:${FX_FONT_SCALE.subtitle}px;color:var(--fx-text);margin-left:8px}
.nr-label{margin-top:16px;font-size:${FX_FONT_SCALE.body}px;color:var(--fx-text);opacity:.85}
@keyframes nrIn{from{opacity:0;transform:translate(-50%,-44%)}to{opacity:1;transform:translate(-50%,-50%)}}`,
    };
  },
};

const barChart: FxComponentDef = {
  id: 'bar-chart',
  label: '柱状图',
  category: '数据',
  paramsDoc: '{ items: {label:string, value:number(0-100)}[] (≤5), title?: string }',
  render(params, themeId) {
    const items = (Array.isArray(params.items) ? params.items : []).slice(0, 5) as { label: string; value: number }[];
    const title = esc(params.title ?? '');
    const maxV = Math.max(...items.map((x) => Number(x.value) || 0), 1);
    const bars = items.map((x, i) => {
      const pct = Math.round(((Number(x.value) || 0) / maxV) * 100);
      return `<div class="bc-row"><span class="bc-label">${esc(x.label)}</span><span class="bc-track"><span class="bc-bar" style="animation-delay:${0.2 + i * 0.18}s;--w:${pct}%"></span></span><span class="bc-val" style="animation-delay:${0.5 + i * 0.18}s">${esc(x.value)}</span></div>`;
    }).join('');
    return {
      html: root(themeId, `<div class="bc-card">${title ? `<div class="bc-title">${title}</div>` : ''}${bars}</div>`),
      css: `
.bc-card{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:880px;padding:48px 56px;background:var(--fx-surface);border-radius:24px;animation:bcIn .5s var(--fx-ease-enter) both}
.bc-title{font-size:${FX_FONT_SCALE.subtitle}px;font-weight:700;color:var(--fx-text);margin-bottom:32px}
.bc-row{display:flex;align-items:center;gap:16px;margin-bottom:24px}
.bc-label{width:160px;font-size:${FX_FONT_SCALE.body}px;color:var(--fx-text);text-align:right}
.bc-track{flex:1;height:32px;background:rgba(255,255,255,0.08);border-radius:16px;overflow:hidden}
.bc-bar{display:block;height:100%;width:0;background:var(--fx-accent);border-radius:16px;animation:bcGrow .8s var(--fx-ease-enter) both;animation-delay:inherit}
@keyframes bcGrow{to{width:var(--w)}}
.bc-val{width:80px;font-size:${FX_FONT_SCALE.body}px;font-weight:700;color:var(--fx-accent);animation:bcFade .4s both;animation-delay:inherit}
@keyframes bcFade{from{opacity:0}to{opacity:1}}
@keyframes bcIn{from{opacity:0;transform:translate(-50%,-46%)}to{opacity:1;transform:translate(-50%,-50%)}}`,
    };
  },
};

const percentRing: FxComponentDef = {
  id: 'percent-ring',
  label: '百分比环',
  category: '数据',
  paramsDoc: '{ percent: number(0-100), label?: string }',
  render(params, themeId) {
    const pct = Math.max(0, Math.min(100, Number(params.percent) || 0));
    const label = esc(params.label ?? '');
    const R = 130; const C = 2 * Math.PI * R;
    return {
      html: root(themeId, `<div class="pr-wrap"><svg width="320" height="320" viewBox="0 0 320 320"><circle cx="160" cy="160" r="${R}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="26"/><circle class="pr-arc" cx="160" cy="160" r="${R}" fill="none" stroke="var(--fx-accent)" stroke-width="26" stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${C.toFixed(1)}" style="--off:${(C * (1 - pct / 100)).toFixed(1)}" transform="rotate(-90 160 160)"/></svg><div class="pr-num">${pct}<i>%</i></div>${label ? `<div class="pr-label">${label}</div>` : ''}</div>`),
      css: `
.pr-wrap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;animation:prIn .5s var(--fx-ease-enter) both}
.pr-arc{animation:prDraw 1.1s var(--fx-ease-enter) .2s both}
@keyframes prDraw{to{stroke-dashoffset:var(--off)}}
.pr-num{position:absolute;left:0;right:0;top:118px;font-size:${FX_FONT_SCALE.title}px;font-weight:800;color:var(--fx-text)}
.pr-num i{font-style:normal;font-size:${FX_FONT_SCALE.subtitle}px;color:var(--fx-accent)}
.pr-label{margin-top:12px;font-size:${FX_FONT_SCALE.body}px;color:var(--fx-text);opacity:.85}
@keyframes prIn{from{opacity:0;transform:translate(-50%,-46%) scale(.92)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}`,
    };
  },
};

// ── 要点类 ────────────────────────────────────────────────────────────────────

const bulletList: FxComponentDef = {
  id: 'bullet-list',
  label: '要点列表',
  category: '要点',
  paramsDoc: '{ items: string[] (≤5), title?: string }',
  render(params, themeId) {
    const items = arr(params.items, 5);
    const title = esc(params.title ?? '');
    const rows = items.map((t, i) =>
      `<div class="bl-row" style="animation-delay:${0.25 + i * 0.35}s"><span class="bl-check" style="animation-delay:${0.4 + i * 0.35}s">✓</span><span>${esc(t)}</span></div>`,
    ).join('');
    return {
      html: root(themeId, `<div class="bl-card">${title ? `<div class="bl-title">${title}</div>` : ''}${rows}</div>`),
      css: `
.bl-card{position:absolute;left:120px;top:50%;transform:translateY(-50%);max-width:760px;padding:44px 52px;background:var(--fx-surface);border-radius:24px;border-left:8px solid var(--fx-accent);animation:blIn .5s var(--fx-ease-enter) both}
.bl-title{font-size:${FX_FONT_SCALE.subtitle}px;font-weight:700;color:var(--fx-accent);margin-bottom:28px}
.bl-row{display:flex;align-items:center;gap:18px;margin-bottom:22px;font-size:${FX_FONT_SCALE.body}px;color:var(--fx-text);opacity:0;animation:blSlide .5s var(--fx-ease-enter) both;animation-delay:inherit}
.bl-check{width:44px;height:44px;border-radius:50%;background:var(--fx-accent);color:var(--fx-primary);font-weight:800;display:flex;align-items:center;justify-content:center;font-size:${FX_FONT_SCALE.caption}px;transform:scale(0);animation:blPop .3s var(--fx-ease-enter) both;animation-delay:inherit}
@keyframes blSlide{from{opacity:0;transform:translateX(-32px)}to{opacity:1;transform:translateX(0)}}
@keyframes blPop{to{transform:scale(1)}}
@keyframes blIn{from{opacity:0}to{opacity:1}}`,
    };
  },
};

const stepFlow: FxComponentDef = {
  id: 'step-flow',
  label: '步骤条',
  category: '要点',
  paramsDoc: '{ steps: string[] (≤4) }',
  render(params, themeId) {
    const steps = arr(params.steps, 4);
    const cells = steps.map((t, i) =>
      `<div class="sf-cell" style="animation-delay:${0.2 + i * 0.4}s"><div class="sf-no">${i + 1}</div><div class="sf-text">${esc(t)}</div></div>${i < steps.length - 1 ? `<div class="sf-arrow" style="animation-delay:${0.45 + i * 0.4}s">→</div>` : ''}`,
    ).join('');
    return {
      html: root(themeId, `<div class="sf-wrap">${cells}</div>`),
      css: `
.sf-wrap{position:absolute;left:50%;bottom:140px;transform:translateX(-50%);display:flex;align-items:center;gap:24px}
.sf-cell{display:flex;align-items:center;gap:14px;padding:20px 28px;background:var(--fx-surface);border-radius:18px;opacity:0;animation:sfIn .5s var(--fx-ease-enter) both;animation-delay:inherit}
.sf-no{width:48px;height:48px;border-radius:50%;background:var(--fx-accent);color:var(--fx-primary);font-size:${FX_FONT_SCALE.body}px;font-weight:800;display:flex;align-items:center;justify-content:center}
.sf-text{font-size:${FX_FONT_SCALE.body}px;color:var(--fx-text);max-width:280px}
.sf-arrow{font-size:${FX_FONT_SCALE.subtitle}px;color:var(--fx-accent);opacity:0;animation:sfIn .3s both;animation-delay:inherit}
@keyframes sfIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}`,
    };
  },
};

const compareCard: FxComponentDef = {
  id: 'compare-card',
  label: '对比卡',
  category: '对比',
  paramsDoc: '{ leftTitle: string, leftItems: string[](≤3), rightTitle: string, rightItems: string[](≤3) }',
  render(params, themeId) {
    const side = (title: unknown, items: unknown, cls: string, delay: number) =>
      `<div class="cc-side ${cls}" style="animation-delay:${delay}s"><div class="cc-head">${esc(title)}</div>${arr(items, 3).map((t, i) => `<div class="cc-item" style="animation-delay:${delay + 0.25 + i * 0.2}s">${esc(t)}</div>`).join('')}</div>`;
    return {
      html: root(themeId, `<div class="cc-wrap">${side(params.leftTitle, params.leftItems, 'cc-left', 0.15)}<div class="cc-vs">VS</div>${side(params.rightTitle, params.rightItems, 'cc-right', 0.3)}</div>`),
      css: `
.cc-wrap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;align-items:stretch;gap:36px}
.cc-side{width:520px;padding:40px 44px;background:var(--fx-surface);border-radius:24px;opacity:0;animation:ccIn .5s var(--fx-ease-enter) both;animation-delay:inherit}
.cc-left{border-top:6px solid var(--fx-text)}
.cc-right{border-top:6px solid var(--fx-accent)}
.cc-head{font-size:${FX_FONT_SCALE.subtitle}px;font-weight:800;color:var(--fx-text);margin-bottom:24px}
.cc-right .cc-head{color:var(--fx-accent)}
.cc-item{font-size:${FX_FONT_SCALE.body}px;color:var(--fx-text);opacity:.0;margin-bottom:16px;padding-left:20px;border-left:4px solid var(--fx-accent);animation:ccFade .4s both;animation-delay:inherit}
.cc-vs{align-self:center;font-size:${FX_FONT_SCALE.title}px;font-weight:900;color:var(--fx-accent);animation:ccPulse .6s var(--fx-ease-pulse) .5s both}
@keyframes ccIn{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:translateY(0)}}
@keyframes ccFade{to{opacity:.92}}
@keyframes ccPulse{0%{opacity:0;transform:scale(.6)}60%{transform:scale(1.15)}100%{opacity:1;transform:scale(1)}}`,
    };
  },
};

// ── 强调类 ────────────────────────────────────────────────────────────────────

const keywordPop: FxComponentDef = {
  id: 'keyword-pop',
  label: '关键词强调',
  category: '强调',
  paramsDoc: '{ keyword: string, sub?: string(一句话补充) }',
  render(params, themeId) {
    return {
      html: root(themeId, `<div class="kp-wrap"><div class="kp-key">${esc(params.keyword)}</div>${params.sub ? `<div class="kp-sub">${esc(params.sub)}</div>` : ''}<div class="kp-line"></div></div>`),
      css: `
.kp-wrap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center}
.kp-key{font-size:${FX_FONT_SCALE.display}px;font-weight:900;color:var(--fx-text);animation:kpPop .6s var(--fx-ease-enter) both}
.kp-line{width:0;height:10px;background:var(--fx-accent);margin:18px auto 0;border-radius:5px;animation:kpLine .5s var(--fx-ease-enter) .35s both}
.kp-sub{margin-top:20px;font-size:${FX_FONT_SCALE.body}px;color:var(--fx-text);opacity:0;animation:kpFade .4s .55s both}
@keyframes kpPop{0%{opacity:0;transform:scale(.5)}70%{transform:scale(1.08)}100%{opacity:1;transform:scale(1)}}
@keyframes kpLine{to{width:240px}}
@keyframes kpFade{to{opacity:.85}}`,
    };
  },
};

const quoteCard: FxComponentDef = {
  id: 'quote-card',
  label: '引用卡',
  category: '口播',
  paramsDoc: '{ quote: string, author?: string }',
  render(params, themeId) {
    return {
      html: root(themeId, `<div class="qc-card"><div class="qc-mark">“</div><div class="qc-text">${esc(params.quote)}</div>${params.author ? `<div class="qc-author">— ${esc(params.author)}</div>` : ''}</div>`),
      css: `
.qc-card{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);max-width:900px;padding:56px 64px;background:var(--fx-surface);border-radius:24px;animation:qcIn .6s var(--fx-ease-enter) both}
.qc-mark{font-size:${FX_FONT_SCALE.display}px;line-height:.6;color:var(--fx-accent);font-weight:900}
.qc-text{margin-top:18px;font-size:${FX_FONT_SCALE.subtitle}px;line-height:1.6;color:var(--fx-text);opacity:0;animation:qcFade .6s .25s both}
.qc-author{margin-top:24px;text-align:right;font-size:${FX_FONT_SCALE.body}px;color:var(--fx-accent);opacity:0;animation:qcFade .4s .6s both}
@keyframes qcIn{from{opacity:0;transform:translate(-50%,-46%)}to{opacity:1;transform:translate(-50%,-50%)}}
@keyframes qcFade{to{opacity:1}}`,
    };
  },
};

const chapterTitle: FxComponentDef = {
  id: 'chapter-title',
  label: '章节标题卡',
  category: '标题',
  paramsDoc: '{ no?: string(如"01"), title: string, sub?: string }',
  render(params, themeId) {
    return {
      html: root(themeId, `<div class="ct-bg"></div><div class="ct-wrap">${params.no ? `<div class="ct-no">${esc(params.no)}</div>` : ''}<div class="ct-title">${esc(params.title)}</div>${params.sub ? `<div class="ct-sub">${esc(params.sub)}</div>` : ''}</div>`),
      css: `
.ct-bg{position:absolute;inset:0;background:var(--fx-primary);animation:ctBg .5s both}
.ct-wrap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center}
.ct-no{font-size:${FX_FONT_SCALE.title}px;font-weight:900;color:var(--fx-accent);letter-spacing:8px;animation:ctSlide .55s var(--fx-ease-enter) .1s both}
.ct-title{margin-top:10px;font-size:${FX_FONT_SCALE.display}px;font-weight:800;color:var(--fx-text);animation:ctSlide .55s var(--fx-ease-enter) .25s both}
.ct-sub{margin-top:18px;font-size:${FX_FONT_SCALE.body}px;color:var(--fx-text);opacity:0;animation:ctFade .5s .55s both}
@keyframes ctBg{from{opacity:0}to{opacity:1}}
@keyframes ctSlide{from{opacity:0;transform:translateY(46px)}to{opacity:1;transform:translateY(0)}}
@keyframes ctFade{to{opacity:.8}}`,
    };
  },
};

const callout: FxComponentDef = {
  id: 'callout',
  label: '贴边标注',
  category: '强调',
  paramsDoc: '{ text: string, side?: "left"|"right"(默认 right), y?: number(0-1 垂直位置，默认 0.35) }',
  render(params, themeId) {
    const side = params.side === 'left' ? 'left' : 'right';
    const y = Math.max(0.1, Math.min(0.85, Number(params.y) || 0.35));
    return {
      html: root(themeId, `<div class="co-wrap co-${side}" style="top:${(y * 100).toFixed(1)}%"><span class="co-arrow">${side === 'left' ? '←' : '→'}</span><span class="co-text">${esc(params.text)}</span></div>`),
      css: `
.co-wrap{position:absolute;display:flex;align-items:center;gap:14px;padding:18px 28px;background:var(--fx-surface);border:2px solid var(--fx-accent);border-radius:16px;animation:coIn .5s var(--fx-ease-enter) both}
.co-right{right:154px;flex-direction:row-reverse}
.co-left{left:154px}
.co-text{font-size:${FX_FONT_SCALE.body}px;color:var(--fx-text);max-width:420px}
.co-arrow{font-size:${FX_FONT_SCALE.subtitle}px;color:var(--fx-accent);animation:coNudge 1s var(--fx-ease-pulse) .5s infinite alternate}
@keyframes coIn{from{opacity:0;transform:translateX(0) scale(.9)}to{opacity:1;transform:scale(1)}}
@keyframes coNudge{from{transform:translateX(0)}to{transform:translateX(8px)}}`,
    };
  },
};

const lineChart: FxComponentDef = {
  id: 'line-chart',
  label: '折线图',
  category: '数据',
  paramsDoc: '{ values: number[](≤8), title?: string }',
  render(params, themeId) {
    const values = (Array.isArray(params.values) ? params.values : []).slice(0, 8).map((v) => Number(v) || 0);
    const title = esc(params.title ?? '');
    const W = 760; const H = 320;
    const maxV = Math.max(...values, 1); const minV = Math.min(...values, 0);
    const pts = values.map((v, i) => `${(i / Math.max(values.length - 1, 1)) * W},${H - ((v - minV) / (maxV - minV || 1)) * H}`);
    const len = 1400; // 近似路径长度（dash 动画用，超出实际即可）
    return {
      html: root(themeId, `<div class="lc-card">${title ? `<div class="lc-title">${title}</div>` : ''}<svg width="${W}" height="${H}" viewBox="-10 -10 ${W + 20} ${H + 20}"><polyline class="lc-line" points="${pts.join(' ')}" fill="none" stroke="var(--fx-accent)" stroke-width="6" stroke-linecap="round" stroke-dasharray="${len}" stroke-dashoffset="${len}"/>${pts.map((p, i) => `<circle class="lc-dot" style="animation-delay:${0.3 + i * 0.12}s" cx="${p.split(',')[0]}" cy="${p.split(',')[1]}" r="9" fill="var(--fx-accent)"/>`).join('')}</svg></div>`),
      css: `
.lc-card{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);padding:48px 56px;background:var(--fx-surface);border-radius:24px;animation:lcIn .5s var(--fx-ease-enter) both}
.lc-title{font-size:${FX_FONT_SCALE.subtitle}px;font-weight:700;color:var(--fx-text);margin-bottom:28px}
.lc-line{animation:lcDraw 1.2s linear .2s both}
@keyframes lcDraw{to{stroke-dashoffset:0}}
.lc-dot{opacity:0;animation:lcPop .3s var(--fx-ease-enter) both;animation-delay:inherit}
@keyframes lcPop{from{opacity:0}to{opacity:1}}
@keyframes lcIn{from{opacity:0;transform:translate(-50%,-46%)}to{opacity:1;transform:translate(-50%,-50%)}}`,
    };
  },
};

export const FX_COMPONENTS: FxComponentDef[] = [
  numberRoll, barChart, lineChart, percentRing,
  bulletList, stepFlow, compareCard,
  keywordPop, quoteCard, chapterTitle, callout,
  ...EXT_FX_COMPONENTS,
  ...EXT2_FX_COMPONENTS,
];

export function findFxComponent(id: string): FxComponentDef | undefined {
  return FX_COMPONENTS.find((c) => c.id === id);
}

/** agent 工具 description 用的组件清单（按分类分组 + 设计指南） */
export function fxComponentsDoc(): string {
  const byCategory = new Map<string, FxComponentDef[]>();
  for (const c of FX_COMPONENTS) {
    if (!byCategory.has(c.category)) byCategory.set(c.category, []);
    byCategory.get(c.category)!.push(c);
  }
  const guide: Record<string, string> = {
    '标题': '开场/章节分隔/片尾，全片 2-4 个。opening-title 用于开场大字，chapter-title 用于章节切换，end-card 用于片尾引导',
    '口播': '口播者说到关键话题时配合。question-card 引出话题，summary-card 总结要点，subscribe-card 仅片尾用一次',
    '强调': '高亮关键词/短句。keyword-pop 最常用，underline-sweep 更含蓄，marker-highlight 模拟手写标记。每 30s 最多 1 个',
    '要点': '罗列步骤/要点/时间线。bullet-list 通用，step-flow 适合有序流程。一次只出 1 个',
    '数据': '出现数字/统计时使用。number-roll 适合单个大数字，bar-chart/percent-ring 适合对比。数据必须真实',
    '产品': '带货/测评场景专用。price-tag 显示价格，spec-table 参数对比。非电商视频不要用',
    '对比': '对比论述时使用，全片不超 2 个',
    '氛围': '轻量背景装饰（particles-fall/bokeh-glow/light-sweep/gradient-mesh）。全片 0-2 个，叠在其他特效下层，营造质感而非抢注意力',
    '转场': '片段衔接处 0.8-1.2s。不要每段都加——只在内容明确转折时使用',
  };
  return [...byCategory.entries()]
    .map(([cat, comps]) => {
      const g = guide[cat] ?? '';
      return `【${cat}】${g ? `（${g}）` : ''}\n${comps.map((c) => `  - ${c.id}（${c.label}）params=${c.paramsDoc}`).join('\n')}`;
    })
    .join('\n');
}
