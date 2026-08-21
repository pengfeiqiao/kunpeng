/**
 * fxComponentsExt — 组件库扩充包（24 款，来自高级动效案例库提炼）。
 * 与 fxComponents.ts 同管线：html2canvas 安全 CSS 子集 + CSS @keyframes +
 * fxDesignSystem token。高级感法则：错峰 stagger / 自定义缓动 / 克制幅度。
 */
import { themeCssVars, themeOf, FX_FONT_SCALE } from './fxDesignSystem';
import type { FxComponentDef } from './fxComponents';

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

const counterVs: FxComponentDef = {
  id: 'counter-vs',
  label: '计数对比',
  category: '数据',
  paramsDoc: '{ left: {label:string,value:string}, right: {label:string,value:string} }',
  render(params, themeId) {
    const l = (params.left ?? {}) as { label?: string; value?: string };
    const r = (params.right ?? {}) as { label?: string; value?: string };
    return {
      html: root(themeId, `<div class="cv-wrap"><div class="cv-side cv-l"><div class="cv-val">${esc(l.value)}</div><div class="cv-lab">${esc(l.label)}</div></div><div class="cv-vs">VS</div><div class="cv-side cv-r"><div class="cv-val">${esc(r.value)}</div><div class="cv-lab">${esc(r.label)}</div></div></div>`),
      css: `
.cv-wrap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;align-items:center;gap:48px}
.cv-side{text-align:center;padding:40px 56px;background:var(--fx-surface);border-radius:24px}
.cv-l{animation:cvL .55s var(--fx-ease-enter) both}
.cv-r{animation:cvR .55s var(--fx-ease-enter) .12s both}
.cv-val{font-size:${FX_FONT_SCALE.title}px;font-weight:800;color:var(--fx-accent)}
.cv-lab{margin-top:10px;font-size:${FX_FONT_SCALE.body}px;color:var(--fx-text);opacity:.85}
.cv-vs{font-size:${FX_FONT_SCALE.subtitle}px;font-weight:800;color:var(--fx-text);opacity:.5;animation:cvVs .4s var(--fx-ease-enter) .3s both}
@keyframes cvL{from{opacity:0;transform:translateX(-32px)}to{opacity:1;transform:none}}
@keyframes cvR{from{opacity:0;transform:translateX(32px)}to{opacity:1;transform:none}}
@keyframes cvVs{from{opacity:0;transform:scale(.6)}to{opacity:.5;transform:scale(1)}}`,
    };
  },
};

const countdown: FxComponentDef = {
  id: 'countdown',
  label: '倒计时',
  category: '数据',
  paramsDoc: '{ from: number(3-9), label?: string }',
  render(params, themeId) {
    const from = Math.max(2, Math.min(9, Number(params.from) || 3));
    const label = esc(params.label ?? '');
    const digits = Array.from({ length: from }, (_, i) => from - i);
    const seg = 1; // 每位 1s
    return {
      html: root(themeId, `<div class="cd-wrap">${digits.map((d, i) => `<div class="cd-num" style="animation-delay:${i * seg}s">${d}</div>`).join('')}${label ? `<div class="cd-label">${label}</div>` : ''}</div>`),
      css: `
.cd-wrap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center}
.cd-num{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:${FX_FONT_SCALE.display * 1.4}px;font-weight:800;color:var(--fx-accent);opacity:0;animation:cdPop ${1}s var(--fx-ease-enter) both;animation-delay:inherit}
@keyframes cdPop{0%{opacity:0;transform:translate(-50%,-50%) scale(1.5)}12%{opacity:1;transform:translate(-50%,-50%) scale(1)}82%{opacity:1}100%{opacity:0;transform:translate(-50%,-50%) scale(.85)}}
.cd-label{position:absolute;left:50%;top:calc(50% + 140px);transform:translateX(-50%);font-size:${FX_FONT_SCALE.body}px;color:var(--fx-text);opacity:.8;white-space:nowrap}`,
    };
  },
};

// ── 要点类 ────────────────────────────────────────────────────────────────────

const timelineList: FxComponentDef = {
  id: 'timeline-list',
  label: '时间线',
  category: '要点',
  paramsDoc: '{ items: {time:string, text:string}[] (≤5), title?: string }',
  render(params, themeId) {
    const items = (Array.isArray(params.items) ? params.items : []).slice(0, 5) as { time?: string; text?: string }[];
    const title = esc(params.title ?? '');
    const rows = items.map((x, i) =>
      `<div class="tl-row" style="animation-delay:${0.2 + i * 0.18}s"><span class="tl-dot"></span><span class="tl-time">${esc(x.time)}</span><span class="tl-text">${esc(x.text)}</span></div>`,
    ).join('');
    return {
      html: root(themeId, `<div class="tl-card">${title ? `<div class="tl-title">${title}</div>` : ''}<div class="tl-body">${rows}</div></div>`),
      css: `
.tl-card{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:760px;padding:44px 56px;background:var(--fx-surface);border-radius:24px;animation:tlIn .5s var(--fx-ease-enter) both}
.tl-title{font-size:${FX_FONT_SCALE.subtitle}px;font-weight:700;color:var(--fx-text);margin-bottom:28px}
.tl-body{position:relative;padding-left:18px;border-left:3px solid rgba(255,255,255,0.12)}
.tl-row{display:flex;align-items:baseline;gap:14px;margin-bottom:22px;opacity:0;animation:tlRow .45s var(--fx-ease-enter) both;animation-delay:inherit}
.tl-dot{position:relative;left:-27px;width:14px;height:14px;border-radius:50%;background:var(--fx-accent);flex:none;margin-right:-14px}
.tl-time{font-size:${FX_FONT_SCALE.body}px;font-weight:700;color:var(--fx-accent);min-width:96px}
.tl-text{font-size:${FX_FONT_SCALE.body}px;color:var(--fx-text)}
@keyframes tlRow{from{opacity:0;transform:translateX(-14px)}to{opacity:1;transform:none}}
@keyframes tlIn{from{opacity:0;transform:translate(-50%,-46%)}to{opacity:1;transform:translate(-50%,-50%)}}`,
    };
  },
};

const tagCloud: FxComponentDef = {
  id: 'tag-cloud',
  label: '标签云',
  category: '要点',
  paramsDoc: '{ tags: string[] (≤8), title?: string }',
  render(params, themeId) {
    const tags = arr(params.tags, 8);
    const title = esc(params.title ?? '');
    const chips = tags.map((t, i) =>
      `<span class="tc-chip ${i % 3 === 0 ? 'tc-hot' : ''}" style="animation-delay:${0.15 + i * 0.1}s">${esc(t)}</span>`,
    ).join('');
    return {
      html: root(themeId, `<div class="tc-wrap">${title ? `<div class="tc-title">${title}</div>` : ''}<div class="tc-cloud">${chips}</div></div>`),
      css: `
.tc-wrap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:820px;text-align:center}
.tc-title{font-size:${FX_FONT_SCALE.subtitle}px;font-weight:700;color:var(--fx-text);margin-bottom:30px;animation:tcIn .4s var(--fx-ease-enter) both}
.tc-cloud{display:flex;flex-wrap:wrap;justify-content:center;gap:16px}
.tc-chip{padding:12px 28px;border-radius:999px;background:var(--fx-surface);font-size:${FX_FONT_SCALE.body}px;color:var(--fx-text);opacity:0;animation:tcPop .4s var(--fx-ease-enter) both;animation-delay:inherit}
.tc-hot{background:var(--fx-accent);color:#111;font-weight:700}
@keyframes tcPop{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:scale(1)}}
@keyframes tcIn{from{opacity:0}to{opacity:1}}`,
    };
  },
};

// ── 强调类 ────────────────────────────────────────────────────────────────────

const underlineSweep: FxComponentDef = {
  id: 'underline-sweep',
  label: '下划线扫光',
  category: '强调',
  paramsDoc: '{ text: string(关键短句), position?: "center"|"lower" }',
  render(params, themeId) {
    const text = esc(params.text ?? '');
    const lower = params.position === 'lower';
    return {
      html: root(themeId, `<div class="us-wrap" style="top:${lower ? '72%' : '50%'}"><span class="us-text">${text}</span><span class="us-line"></span></div>`),
      css: `
.us-wrap{position:absolute;left:50%;transform:translate(-50%,-50%);text-align:center;animation:usIn .4s var(--fx-ease-enter) both}
.us-text{font-size:${FX_FONT_SCALE.title}px;font-weight:800;color:var(--fx-text)}
.us-line{display:block;height:10px;margin-top:10px;border-radius:5px;background:var(--fx-accent);transform:scaleX(0);transform-origin:left;animation:usSweep .6s var(--fx-ease-enter) .35s both}
@keyframes usSweep{to{transform:scaleX(1)}}
@keyframes usIn{from{opacity:0;transform:translate(-50%,-44%)}to{opacity:1;transform:translate(-50%,-50%)}}`,
    };
  },
};

const circleMark: FxComponentDef = {
  id: 'circle-mark',
  label: '圈选标注',
  category: '强调',
  paramsDoc: '{ text: string(被圈的词), note?: string(旁注) }',
  render(params, themeId) {
    const text = esc(params.text ?? '');
    const note = esc(params.note ?? '');
    return {
      html: root(themeId, `<div class="cm-wrap"><span class="cm-text">${text}<svg class="cm-ring" viewBox="0 0 240 110" preserveAspectRatio="none"><ellipse cx="120" cy="55" rx="112" ry="46" fill="none" stroke="var(--fx-accent)" stroke-width="7" stroke-linecap="round" stroke-dasharray="500" stroke-dashoffset="500"/></svg></span>${note ? `<div class="cm-note">${note}</div>` : ''}</div>`),
      css: `
.cm-wrap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;animation:cmIn .35s var(--fx-ease-enter) both}
.cm-text{position:relative;display:inline-block;padding:18px 40px;font-size:${FX_FONT_SCALE.title}px;font-weight:800;color:var(--fx-text)}
.cm-ring{position:absolute;inset:-6px;width:calc(100% + 12px);height:calc(100% + 12px)}
.cm-ring ellipse{animation:cmDraw .8s var(--fx-ease-enter) .3s both}
@keyframes cmDraw{to{stroke-dashoffset:0}}
.cm-note{margin-top:16px;font-size:${FX_FONT_SCALE.body}px;color:var(--fx-accent);animation:cmNote .4s .9s both}
@keyframes cmNote{from{opacity:0}to{opacity:1}}
@keyframes cmIn{from{opacity:0}to{opacity:1}}`,
    };
  },
};

const arrowPoint: FxComponentDef = {
  id: 'arrow-point',
  label: '箭头指向',
  category: '强调',
  paramsDoc: '{ text: string(标注文字), direction?: "down"|"left"|"right"(箭头朝向，默认down), x?: number(0-100 横向百分位), y?: number(0-100 纵向百分位) }',
  render(params, themeId) {
    const text = esc(params.text ?? '');
    const dir = String(params.direction ?? 'down');
    const x = Math.max(8, Math.min(92, Number(params.x) || 50));
    const y = Math.max(8, Math.min(92, Number(params.y) || 30));
    const rot = dir === 'left' ? 90 : dir === 'right' ? -90 : 0;
    return {
      html: root(themeId, `<div class="ap-wrap" style="left:${x}%;top:${y}%"><div class="ap-tag">${text}</div><svg class="ap-arrow" width="44" height="56" viewBox="0 0 44 56" style="transform:rotate(${rot}deg)"><path d="M22 4 L22 40 M8 28 L22 44 L36 28" fill="none" stroke="var(--fx-accent)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`),
      css: `
.ap-wrap{position:absolute;transform:translate(-50%,-50%);text-align:center;animation:apIn .4s var(--fx-ease-enter) both}
.ap-tag{padding:12px 26px;border-radius:14px;background:var(--fx-accent);color:#111;font-size:${FX_FONT_SCALE.body}px;font-weight:700;white-space:nowrap}
.ap-arrow{display:block;margin:8px auto 0;animation:apBob 1.1s ease-in-out .4s infinite alternate}
@keyframes apBob{from{transform:translateY(0) rotate(var(--r,0deg))}to{transform:translateY(8px) rotate(var(--r,0deg))}}
@keyframes apIn{from{opacity:0;transform:translate(-50%,-58%)}to{opacity:1;transform:translate(-50%,-50%)}}`,
    };
  },
};

const markerHighlight: FxComponentDef = {
  id: 'marker-highlight',
  label: '马克笔高亮',
  category: '强调',
  paramsDoc: '{ text: string(整句), highlight: string(句中要高亮的词，须包含于 text) }',
  render(params, themeId) {
    const text = String(params.text ?? '');
    const hl = String(params.highlight ?? '');
    const idx = hl ? text.indexOf(hl) : -1;
    const before = esc(idx >= 0 ? text.slice(0, idx) : text);
    const mid = esc(idx >= 0 ? hl : '');
    const after = esc(idx >= 0 ? text.slice(idx + hl.length) : '');
    return {
      html: root(themeId, `<div class="mh-wrap">${before}${mid ? `<span class="mh-mark">${mid}</span>` : ''}${after}</div>`),
      css: `
.mh-wrap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);max-width:1100px;font-size:${FX_FONT_SCALE.subtitle}px;font-weight:700;color:var(--fx-text);line-height:1.6;text-align:center;animation:mhIn .4s var(--fx-ease-enter) both}
.mh-mark{position:relative;padding:2px 6px;color:#111;background:linear-gradient(var(--fx-accent),var(--fx-accent)) left/0% 88% no-repeat;animation:mhSweep .55s var(--fx-ease-enter) .35s both;border-radius:6px}
@keyframes mhSweep{to{background-size:100% 88%}}
@keyframes mhIn{from{opacity:0;transform:translate(-50%,-46%)}to{opacity:1;transform:translate(-50%,-50%)}}`,
    };
  },
};

// ── 标题类 ────────────────────────────────────────────────────────────────────

const openingTitle: FxComponentDef = {
  id: 'opening-title',
  label: '开场大字',
  category: '标题',
  paramsDoc: '{ title: string(主标题≤12字), subtitle?: string }',
  render(params, themeId) {
    const title = String(params.title ?? '');
    const subtitle = esc(params.subtitle ?? '');
    const chars = [...title].map((c, i) => `<span class="ot-ch" style="animation-delay:${0.1 + i * 0.06}s">${esc(c)}</span>`).join('');
    return {
      html: root(themeId, `<div class="ot-wrap"><div class="ot-title">${chars}</div>${subtitle ? `<div class="ot-sub">${subtitle}</div>` : ''}</div>`),
      css: `
.ot-wrap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center}
.ot-title{font-size:${FX_FONT_SCALE.display}px;font-weight:800;color:var(--fx-text);letter-spacing:6px}
.ot-ch{display:inline-block;opacity:0;animation:otCh .5s var(--fx-ease-enter) both;animation-delay:inherit}
@keyframes otCh{from{opacity:0;transform:translateY(34px)}to{opacity:1;transform:none}}
.ot-sub{margin-top:20px;font-size:${FX_FONT_SCALE.body}px;color:var(--fx-accent);letter-spacing:10px;animation:otSub .5s var(--fx-ease-enter) .6s both}
@keyframes otSub{from{opacity:0}to{opacity:1}}`,
    };
  },
};

const lowerThird: FxComponentDef = {
  id: 'lower-third',
  label: '字幕条',
  category: '标题',
  paramsDoc: '{ name: string(主文字), title?: string(副文字，如头衔) }',
  render(params, themeId) {
    const name = esc(params.name ?? '');
    const title = esc(params.title ?? '');
    return {
      html: root(themeId, `<div class="lt-wrap"><div class="lt-bar"></div><div class="lt-text"><div class="lt-name">${name}</div>${title ? `<div class="lt-title">${title}</div>` : ''}</div></div>`),
      css: `
.lt-wrap{position:absolute;left:8%;bottom:12%;display:flex;align-items:stretch;gap:18px;animation:ltIn .5s var(--fx-ease-enter) both}
.lt-bar{width:10px;border-radius:5px;background:var(--fx-accent);transform:scaleY(0);transform-origin:bottom;animation:ltBar .4s var(--fx-ease-enter) .1s both}
@keyframes ltBar{to{transform:scaleY(1)}}
.lt-text{padding:14px 30px;background:var(--fx-surface);border-radius:14px}
.lt-name{font-size:${FX_FONT_SCALE.subtitle}px;font-weight:800;color:var(--fx-text)}
.lt-title{margin-top:4px;font-size:${FX_FONT_SCALE.caption}px;color:var(--fx-text);opacity:.7}
@keyframes ltIn{from{opacity:0;transform:translateX(-32px)}to{opacity:1;transform:none}}`,
    };
  },
};

const cornerBadge: FxComponentDef = {
  id: 'corner-badge',
  label: '角标',
  category: '标题',
  paramsDoc: '{ text: string(≤8字), corner?: "tl"|"tr"|"bl"|"br"(默认tr) }',
  render(params, themeId) {
    const text = esc(params.text ?? '');
    const c = String(params.corner ?? 'tr');
    const pos = c === 'tl' ? 'left:6%;top:8%' : c === 'bl' ? 'left:6%;bottom:10%' : c === 'br' ? 'right:6%;bottom:10%' : 'right:6%;top:8%';
    return {
      html: root(themeId, `<div class="cb-badge" style="${pos}">${text}</div>`),
      css: `
.cb-badge{position:absolute;padding:10px 26px;border-radius:999px;background:var(--fx-accent);color:#111;font-size:${FX_FONT_SCALE.caption}px;font-weight:800;animation:cbIn .45s var(--fx-ease-enter) both}
@keyframes cbIn{from{opacity:0;transform:scale(.6)}60%{transform:scale(1.06)}to{opacity:1;transform:scale(1)}}`,
    };
  },
};

const endCard: FxComponentDef = {
  id: 'end-card',
  label: '片尾卡',
  category: '标题',
  paramsDoc: '{ title: string(如"关注我"), lines?: string[](≤3 行附加文字) }',
  render(params, themeId) {
    const title = esc(params.title ?? '');
    const lines = arr(params.lines, 3).map((l, i) => `<div class="ec-line" style="animation-delay:${0.5 + i * 0.18}s">${esc(l)}</div>`).join('');
    return {
      html: root(themeId, `<div class="ec-mask"></div><div class="ec-wrap"><div class="ec-title">${title}</div>${lines}</div>`),
      css: `
.ec-mask{position:absolute;inset:0;background:rgba(10,10,12,0.82);animation:ecMask .5s both}
@keyframes ecMask{from{opacity:0}to{opacity:1}}
.ec-wrap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center}
.ec-title{font-size:${FX_FONT_SCALE.display}px;font-weight:800;color:var(--fx-text);animation:ecT .55s var(--fx-ease-enter) .2s both}
@keyframes ecT{from{opacity:0;transform:scale(.86)}to{opacity:1;transform:scale(1)}}
.ec-line{margin-top:18px;font-size:${FX_FONT_SCALE.body}px;color:var(--fx-text);opacity:0;animation:ecL .4s var(--fx-ease-enter) both;animation-delay:inherit}
@keyframes ecL{from{opacity:0;transform:translateY(12px)}to{opacity:.9;transform:none}}`,
    };
  },
};

// ── 口播类 ────────────────────────────────────────────────────────────────────

const questionCard: FxComponentDef = {
  id: 'question-card',
  label: '提问卡',
  category: '口播',
  paramsDoc: '{ question: string(抛给观众的问题) }',
  render(params, themeId) {
    const q = esc(params.question ?? '');
    return {
      html: root(themeId, `<div class="qq-card"><span class="qq-mark">?</span><div class="qq-text">${q}</div></div>`),
      css: `
.qq-card{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;align-items:center;gap:28px;max-width:1000px;padding:44px 60px;background:var(--fx-surface);border-radius:24px;border-left:10px solid var(--fx-accent);animation:qqIn .5s var(--fx-ease-enter) both}
.qq-mark{font-size:${FX_FONT_SCALE.display}px;font-weight:800;color:var(--fx-accent);animation:qqMark .6s var(--fx-ease-enter) .25s both}
@keyframes qqMark{from{opacity:0;transform:rotate(-14deg) scale(.6)}to{opacity:1;transform:none}}
.qq-text{font-size:${FX_FONT_SCALE.subtitle}px;font-weight:700;color:var(--fx-text);line-height:1.5}
@keyframes qqIn{from{opacity:0;transform:translate(-50%,-45%)}to{opacity:1;transform:translate(-50%,-50%)}}`,
    };
  },
};

const summaryCard: FxComponentDef = {
  id: 'summary-card',
  label: '总结卡',
  category: '口播',
  paramsDoc: '{ title?: string(默认"本期要点"), points: string[](≤4) }',
  render(params, themeId) {
    const title = esc(params.title ?? '本期要点');
    const points = arr(params.points, 4).map((p, i) =>
      `<div class="sc-row" style="animation-delay:${0.3 + i * 0.2}s"><span class="sc-idx">${i + 1}</span><span>${esc(p)}</span></div>`,
    ).join('');
    return {
      html: root(themeId, `<div class="sc-card"><div class="sc-title">${title}</div>${points}</div>`),
      css: `
.sc-card{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:840px;padding:48px 60px;background:var(--fx-surface);border-radius:24px;animation:scIn .5s var(--fx-ease-enter) both}
.sc-title{font-size:${FX_FONT_SCALE.subtitle}px;font-weight:800;color:var(--fx-accent);margin-bottom:30px}
.sc-row{display:flex;align-items:baseline;gap:18px;margin-bottom:20px;font-size:${FX_FONT_SCALE.body}px;color:var(--fx-text);opacity:0;animation:scRow .45s var(--fx-ease-enter) both;animation-delay:inherit}
.sc-idx{flex:none;width:40px;height:40px;line-height:40px;text-align:center;border-radius:12px;background:var(--fx-accent);color:#111;font-weight:800}
@keyframes scRow{from{opacity:0;transform:translateX(-16px)}to{opacity:1;transform:none}}
@keyframes scIn{from{opacity:0;transform:translate(-50%,-46%)}to{opacity:1;transform:translate(-50%,-50%)}}`,
    };
  },
};

const commentPop: FxComponentDef = {
  id: 'comment-pop',
  label: '弹幕评论',
  category: '口播',
  paramsDoc: '{ comments: string[](≤4 条观众评论口吻) }',
  render(params, themeId) {
    const comments = arr(params.comments, 4).map((c, i) =>
      `<div class="cp-bubble ${i % 2 ? 'cp-r' : ''}" style="animation-delay:${0.15 + i * 0.5}s">${esc(c)}</div>`,
    ).join('');
    return {
      html: root(themeId, `<div class="cp-wrap">${comments}</div>`),
      css: `
.cp-wrap{position:absolute;right:6%;top:14%;width:420px;display:flex;flex-direction:column;gap:16px;align-items:flex-end}
.cp-bubble{max-width:100%;padding:14px 24px;background:var(--fx-surface);border-radius:20px 20px 4px 20px;font-size:${FX_FONT_SCALE.caption}px;color:var(--fx-text);opacity:0;animation:cpIn .45s var(--fx-ease-enter) both;animation-delay:inherit}
.cp-r{border-radius:20px 20px 20px 4px;background:var(--fx-accent);color:#111;font-weight:600}
@keyframes cpIn{from{opacity:0;transform:translateY(18px) scale(.92)}to{opacity:1;transform:none}}`,
    };
  },
};

// ── 产品类 ────────────────────────────────────────────────────────────────────

const priceTag: FxComponentDef = {
  id: 'price-tag',
  label: '价格标',
  category: '产品',
  paramsDoc: '{ price: string(如"199"), original?: string(划线原价), note?: string(如"限时") }',
  render(params, themeId) {
    const price = esc(params.price ?? '');
    const original = esc(params.original ?? '');
    const note = esc(params.note ?? '');
    return {
      html: root(themeId, `<div class="pt-wrap">${note ? `<div class="pt-note">${note}</div>` : ''}<div class="pt-main"><i>¥</i>${price}</div>${original ? `<div class="pt-orig">原价 ¥${original}</div>` : ''}</div>`),
      css: `
.pt-wrap{position:absolute;right:10%;top:50%;transform:translateY(-50%);text-align:center;padding:40px 56px;background:var(--fx-surface);border-radius:28px;animation:ptIn .5s var(--fx-ease-enter) both}
.pt-note{display:inline-block;margin-bottom:14px;padding:6px 20px;border-radius:999px;background:var(--fx-accent);color:#111;font-size:${FX_FONT_SCALE.caption}px;font-weight:800;animation:ptNote .4s var(--fx-ease-enter) .4s both}
@keyframes ptNote{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:scale(1)}}
.pt-main{font-size:${FX_FONT_SCALE.display}px;font-weight:800;color:var(--fx-accent)}
.pt-main i{font-style:normal;font-size:${FX_FONT_SCALE.subtitle}px;margin-right:4px}
.pt-orig{margin-top:10px;font-size:${FX_FONT_SCALE.body}px;color:var(--fx-text);opacity:.55;text-decoration:line-through}
@keyframes ptIn{from{opacity:0;transform:translateY(-50%) scale(.85)}60%{transform:translateY(-50%) scale(1.04)}to{opacity:1;transform:translateY(-50%) scale(1)}}`,
    };
  },
};

const specTable: FxComponentDef = {
  id: 'spec-table',
  label: '参数表',
  category: '产品',
  paramsDoc: '{ title?: string, rows: {key:string, value:string}[](≤5) }',
  render(params, themeId) {
    const title = esc(params.title ?? '');
    const rows = (Array.isArray(params.rows) ? params.rows : []).slice(0, 5) as { key?: string; value?: string }[];
    const body = rows.map((r, i) =>
      `<div class="st-row" style="animation-delay:${0.25 + i * 0.14}s"><span class="st-key">${esc(r.key)}</span><span class="st-val">${esc(r.value)}</span></div>`,
    ).join('');
    return {
      html: root(themeId, `<div class="st-card">${title ? `<div class="st-title">${title}</div>` : ''}${body}</div>`),
      css: `
.st-card{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:720px;padding:44px 56px;background:var(--fx-surface);border-radius:24px;animation:stIn .5s var(--fx-ease-enter) both}
.st-title{font-size:${FX_FONT_SCALE.subtitle}px;font-weight:800;color:var(--fx-text);margin-bottom:26px}
.st-row{display:flex;justify-content:space-between;padding:16px 4px;border-bottom:1px solid rgba(255,255,255,0.08);font-size:${FX_FONT_SCALE.body}px;opacity:0;animation:stRow .4s var(--fx-ease-enter) both;animation-delay:inherit}
.st-key{color:var(--fx-text);opacity:.75}
.st-val{color:var(--fx-accent);font-weight:700}
@keyframes stRow{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes stIn{from{opacity:0;transform:translate(-50%,-46%)}to{opacity:1;transform:translate(-50%,-50%)}}`,
    };
  },
};

const discountBadge: FxComponentDef = {
  id: 'discount-badge',
  label: '优惠角标',
  category: '产品',
  paramsDoc: '{ text: string(如"5折"), sub?: string(如"今晚8点") }',
  render(params, themeId) {
    const text = esc(params.text ?? '');
    const sub = esc(params.sub ?? '');
    return {
      html: root(themeId, `<div class="db-wrap"><div class="db-burst">${text}</div>${sub ? `<div class="db-sub">${sub}</div>` : ''}</div>`),
      css: `
.db-wrap{position:absolute;right:8%;top:12%;text-align:center}
.db-burst{width:200px;height:200px;line-height:200px;border-radius:50%;background:var(--fx-accent);color:#111;font-size:${FX_FONT_SCALE.title}px;font-weight:800;animation:dbIn .55s var(--fx-ease-enter) both,dbPulse 1.4s ease-in-out .8s infinite alternate}
@keyframes dbIn{from{opacity:0;transform:scale(.4) rotate(-18deg)}65%{transform:scale(1.08) rotate(3deg)}to{opacity:1;transform:scale(1) rotate(0)}}
@keyframes dbPulse{to{transform:scale(1.05)}}
.db-sub{margin-top:14px;padding:8px 22px;display:inline-block;border-radius:999px;background:var(--fx-surface);font-size:${FX_FONT_SCALE.caption}px;color:var(--fx-text);animation:dbSub .4s .5s both}
@keyframes dbSub{from{opacity:0}to{opacity:1}}`,
    };
  },
};

// ── 对比类 ────────────────────────────────────────────────────────────────────

const vsSplit: FxComponentDef = {
  id: 'vs-split',
  label: '左右 PK',
  category: '对比',
  paramsDoc: '{ left: string, right: string, leftSub?: string, rightSub?: string }',
  render(params, themeId) {
    return {
      html: root(themeId, `<div class="vs-l"><div class="vs-main">${esc(params.left)}</div>${params.leftSub ? `<div class="vs-sub">${esc(params.leftSub)}</div>` : ''}</div><div class="vs-r"><div class="vs-main">${esc(params.right)}</div>${params.rightSub ? `<div class="vs-sub">${esc(params.rightSub)}</div>` : ''}</div><div class="vs-badge">VS</div>`),
      css: `
.vs-l,.vs-r{position:absolute;top:0;bottom:0;width:50%;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:14px}
.vs-l{left:0;background:rgba(0,0,0,0.55);animation:vsL .5s var(--fx-ease-enter) both}
.vs-r{right:0;background:rgba(0,0,0,0.32);animation:vsR .5s var(--fx-ease-enter) .1s both}
@keyframes vsL{from{opacity:0;transform:translateX(-60px)}to{opacity:1;transform:none}}
@keyframes vsR{from{opacity:0;transform:translateX(60px)}to{opacity:1;transform:none}}
.vs-main{font-size:${FX_FONT_SCALE.title}px;font-weight:800;color:var(--fx-text)}
.vs-sub{font-size:${FX_FONT_SCALE.body}px;color:var(--fx-text);opacity:.7}
.vs-badge{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:120px;height:120px;line-height:120px;text-align:center;border-radius:50%;background:var(--fx-accent);color:#111;font-size:${FX_FONT_SCALE.subtitle}px;font-weight:800;animation:vsB .45s var(--fx-ease-enter) .35s both}
@keyframes vsB{from{opacity:0;transform:translate(-50%,-50%) scale(.5)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}`,
    };
  },
};

const beforeAfter: FxComponentDef = {
  id: 'before-after',
  label: '前后对比',
  category: '对比',
  paramsDoc: '{ before: string(之前状态), after: string(之后状态), label?: string }',
  render(params, themeId) {
    const label = esc(params.label ?? '');
    return {
      html: root(themeId, `<div class="ba-wrap">${label ? `<div class="ba-label">${label}</div>` : ''}<div class="ba-row"><div class="ba-card ba-before"><div class="ba-tag">之前</div>${esc(params.before)}</div><svg class="ba-arrow" width="64" height="40" viewBox="0 0 64 40"><path d="M4 20 L48 20 M36 8 L50 20 L36 32" fill="none" stroke="var(--fx-accent)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg><div class="ba-card ba-after"><div class="ba-tag ba-tag2">之后</div>${esc(params.after)}</div></div></div>`),
      css: `
.ba-wrap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center}
.ba-label{margin-bottom:26px;font-size:${FX_FONT_SCALE.subtitle}px;font-weight:800;color:var(--fx-text);animation:baL .4s both}
@keyframes baL{from{opacity:0}to{opacity:1}}
.ba-row{display:flex;align-items:center;gap:30px}
.ba-card{position:relative;padding:48px 52px 40px;background:var(--fx-surface);border-radius:22px;font-size:${FX_FONT_SCALE.body}px;color:var(--fx-text);max-width:380px}
.ba-before{opacity:.75;animation:baB .5s var(--fx-ease-enter) both}
.ba-after{border:2px solid var(--fx-accent);animation:baA .5s var(--fx-ease-enter) .25s both}
@keyframes baB{from{opacity:0;transform:translateX(-26px)}to{opacity:.75;transform:none}}
@keyframes baA{from{opacity:0;transform:translateX(26px)}to{opacity:1;transform:none}}
.ba-tag{position:absolute;top:-16px;left:50%;transform:translateX(-50%);padding:5px 18px;border-radius:999px;background:rgba(255,255,255,0.16);font-size:${FX_FONT_SCALE.caption}px;color:var(--fx-text)}
.ba-tag2{background:var(--fx-accent);color:#111;font-weight:800}
.ba-arrow path{stroke-dasharray:120;stroke-dashoffset:120;animation:baArr .5s var(--fx-ease-enter) .45s both}
@keyframes baArr{to{stroke-dashoffset:0}}`,
    };
  },
};

// ── 氛围类 ────────────────────────────────────────────────────────────────────

const particlesFall: FxComponentDef = {
  id: 'particles-fall',
  label: '粒子飘落',
  category: '氛围',
  paramsDoc: '{ density?: "low"|"high"(默认low), color?: string(默认主题色) }',
  render(params, themeId) {
    const n = params.density === 'high' ? 26 : 14;
    const color = typeof params.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(params.color) ? params.color : 'var(--fx-accent)';
    const dots = Array.from({ length: n }, (_, i) => {
      const x = (i * 137.5) % 100;
      const size = 4 + ((i * 7) % 8);
      const dur = 4 + ((i * 13) % 40) / 10;
      const delay = ((i * 17) % 30) / 10;
      return `<span class="pf-dot" style="left:${x.toFixed(1)}%;width:${size}px;height:${size}px;animation-duration:${dur.toFixed(1)}s;animation-delay:-${delay.toFixed(1)}s;background:${color}"></span>`;
    }).join('');
    return {
      html: root(themeId, dots),
      css: `
.pf-dot{position:absolute;top:-3%;border-radius:50%;opacity:.5;animation:pfFall linear infinite}
@keyframes pfFall{0%{transform:translateY(0) translateX(0);opacity:0}10%{opacity:.55}90%{opacity:.4}100%{transform:translateY(1150px) translateX(60px);opacity:0}}`,
    };
  },
};

const bokehGlow: FxComponentDef = {
  id: 'bokeh-glow',
  label: '光斑',
  category: '氛围',
  paramsDoc: '{ tone?: "warm"|"cool"(默认warm) }',
  render(params, themeId) {
    const warm = params.tone !== 'cool';
    const c1 = warm ? 'rgba(255,200,120,0.32)' : 'rgba(120,180,255,0.30)';
    const c2 = warm ? 'rgba(255,150,80,0.22)' : 'rgba(140,120,255,0.20)';
    const blobs = Array.from({ length: 7 }, (_, i) => {
      const x = (i * 149) % 100; const y = (i * 83) % 100;
      const size = 120 + ((i * 53) % 200);
      const dur = 6 + (i % 5);
      return `<span class="bg-blob" style="left:${x}%;top:${y}%;width:${size}px;height:${size}px;background:radial-gradient(circle,${i % 2 ? c1 : c2},transparent 70%);animation-duration:${dur}s;animation-delay:-${i}s"></span>`;
    }).join('');
    return {
      html: root(themeId, blobs),
      css: `
.bg-blob{position:absolute;border-radius:50%;transform:translate(-50%,-50%);animation:bgDrift ease-in-out infinite alternate}
@keyframes bgDrift{from{transform:translate(-50%,-50%) scale(1)}to{transform:translate(-46%,-56%) scale(1.18)}}`,
    };
  },
};

const lightSweep: FxComponentDef = {
  id: 'light-sweep',
  label: '扫光',
  category: '氛围',
  paramsDoc: '{ interval?: number(扫光间隔秒，默认3) }',
  render(params, themeId) {
    const interval = Math.max(1.5, Math.min(8, Number(params.interval) || 3));
    return {
      html: root(themeId, `<div class="ls-beam" style="animation-duration:${interval}s"></div>`),
      css: `
.ls-beam{position:absolute;top:-20%;bottom:-20%;width:26%;left:-30%;background:linear-gradient(100deg,transparent,rgba(255,255,255,0.14) 45%,rgba(255,255,255,0.22) 50%,rgba(255,255,255,0.14) 55%,transparent);transform:skewX(-14deg);animation:lsMove linear infinite}
@keyframes lsMove{0%{left:-30%}55%{left:115%}100%{left:115%}}`,
    };
  },
};

// ── 转场类 ────────────────────────────────────────────────────────────────────

const colorWipe: FxComponentDef = {
  id: 'color-wipe',
  label: '色块过场',
  category: '转场',
  paramsDoc: '{ text?: string(过场时居中显示的短词), direction?: "lr"|"tb"(默认lr) }。建议时长 0.8-1.2s，跨在两个片段衔接处',
  render(params, themeId) {
    const text = esc(params.text ?? '');
    const tb = params.direction === 'tb';
    return {
      html: root(themeId, `<div class="cw-block ${tb ? 'cw-tb' : ''}"></div>${text ? `<div class="cw-text">${text}</div>` : ''}`),
      css: `
.cw-block{position:absolute;inset:0;background:var(--fx-accent);transform:translateX(-100%);animation:cwLr 1s var(--fx-ease-enter) both}
@keyframes cwLr{0%{transform:translateX(-100%)}42%{transform:translateX(0)}58%{transform:translateX(0)}100%{transform:translateX(100%)}}
.cw-tb{transform:translateY(-100%);animation-name:cwTb}
@keyframes cwTb{0%{transform:translateY(-100%)}42%{transform:translateY(0)}58%{transform:translateY(0)}100%{transform:translateY(100%)}}
.cw-text{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:${FX_FONT_SCALE.title}px;font-weight:800;color:#111;animation:cwT 1s both}
@keyframes cwT{0%,38%{opacity:0}45%,55%{opacity:1}62%,100%{opacity:0}}`,
    };
  },
};

const maskWipe: FxComponentDef = {
  id: 'mask-wipe',
  label: '遮罩擦除',
  category: '转场',
  paramsDoc: '{ shape?: "circle"|"bar"(默认circle) }。圆形收拢再展开的过场遮罩，建议 0.8-1.2s 跨片段衔接处',
  render(params, themeId) {
    const bar = params.shape === 'bar';
    if (bar) {
      const bars = Array.from({ length: 6 }, (_, i) => `<span class="mw-bar" style="left:${i * (100 / 6)}%;animation-delay:${i * 0.06}s"></span>`).join('');
      return {
        html: root(themeId, bars),
        css: `
.mw-bar{position:absolute;top:0;bottom:0;width:${100 / 6 + 0.5}%;background:#0a0a0c;transform:scaleY(0);transform-origin:top;animation:mwBar 1s var(--fx-ease-enter) both;animation-delay:inherit}
@keyframes mwBar{0%{transform:scaleY(0);transform-origin:top}40%{transform:scaleY(1);transform-origin:top}60%{transform:scaleY(1);transform-origin:bottom}100%{transform:scaleY(0);transform-origin:bottom}}`,
      };
    }
    return {
      html: root(themeId, `<div class="mw-iris"></div>`),
      css: `
.mw-iris{position:absolute;left:50%;top:50%;width:2400px;height:2400px;border-radius:50%;background:#0a0a0c;transform:translate(-50%,-50%) scale(0);animation:mwIris 1.1s var(--fx-ease-enter) both}
@keyframes mwIris{0%{transform:translate(-50%,-50%) scale(0)}45%{transform:translate(-50%,-50%) scale(1)}55%{transform:translate(-50%,-50%) scale(1)}100%{transform:translate(-50%,-50%) scale(0)}}`,
    };
  },
};

export const EXT_FX_COMPONENTS: FxComponentDef[] = [
  counterVs, countdown,
  timelineList, tagCloud,
  underlineSweep, circleMark, arrowPoint, markerHighlight,
  openingTitle, lowerThird, cornerBadge, endCard,
  questionCard, summaryCard, commentPop,
  priceTag, specTable, discountBadge,
  vsSplit, beforeAfter,
  particlesFall, bokehGlow, lightSweep,
  colorWipe, maskWipe,
];
