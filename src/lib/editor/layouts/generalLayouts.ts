/**
 * generalLayouts — 通用 + 口播页面布局定义（8 种）。
 *
 * 通用 5 种：hero-center / split-text-visual / full-data / bullet-stack / quote-spotlight
 * 口播 3 种：lower-bar / side-panel / floating-cards
 *
 * 坐标系：1920x1080 absolute stage，安全区 8%（154px/86px）。
 * html 不含 fx-root 壳——引擎 renderPage 会包裹。
 */

import type { PageLayoutDef, PageParams, StyleConfig } from '../pageLayoutEngine';
import { escHtml, FX_FONT_SCALE } from '../pageLayoutEngine';

// ── 缓动曲线 ────────────────────────────────────────────────────────────────────

const EASE_DECEL  = 'cubic-bezier(0.16, 1, 0.3, 1)';
const EASE_SMOOTH = 'cubic-bezier(0.32, 0.72, 0, 1)';

// ── 公共阴影 ────────────────────────────────────────────────────────────────────

const CARD_SHADOW = '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08)';

// ═══════════════════════════════════════════════════════════════════════════════
// 1. hero-center — 居中大标题
// ═══════════════════════════════════════════════════════════════════════════════
// demoParams: { title: '让数据驱动增长', subtitle: '2024 年度趋势报告' }

const heroCenter: PageLayoutDef = {
  id: 'hero-center',
  label: '居中大标题',
  category: '通用',
  desc: '标题居中展示，配副标题与动态强调线',
  zones: [
    { id: 'title',    type: 'title',    bounds: { x: '154px', y: '300px', w: '1612px', h: '140px' } },
    { id: 'subtitle', type: 'subtitle', bounds: { x: '154px', y: '540px', w: '1612px', h: '60px'  }, optional: true },
  ],
  render(params: PageParams, _style: StyleConfig) {
    const title    = escHtml(params.title);
    const subtitle = escHtml(params.subtitle);

    const html = `
<div class="hc-container">
  <div class="hc-ring" aria-hidden="true"></div>
  <div class="hc-title pg-enter">${title}</div>
  <div class="hc-line pg-enter-d1"></div>
  ${subtitle ? `<div class="hc-subtitle pg-enter-d2">${subtitle}</div>
  <div class="hc-line-thin pg-enter-d3"></div>` : ''}
</div>`;

    const css = `
/* hero-center */
.hc-container {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: 86px 154px;
}
.hc-ring {
  position: absolute;
  top: 50%; left: 50%;
  width: 480px; height: 480px;
  margin-top: -240px; margin-left: -240px;
  border-radius: 50%;
  border: 2px solid var(--fx-accent);
  opacity: 0;
  animation: hcRingIn 1s ${EASE_SMOOTH} 0.1s both;
}
@keyframes hcRingIn {
  from { opacity: 0; transform: scale(0.7); }
  to   { opacity: 0.12; transform: scale(1); }
}
.hc-title {
  position: relative;
  font-family: var(--fx-font-title);
  font-size: ${FX_FONT_SCALE.display}px;
  font-weight: 900;
  background: linear-gradient(135deg, var(--fx-text) 40%, var(--fx-accent) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  text-align: center;
  line-height: 1.2;
  opacity: 0;
  animation: hcFadeUp 0.6s ${EASE_DECEL} both;
}
.hc-line {
  width: 0;
  height: 4px;
  margin: 36px 0;
  background: var(--fx-accent);
  border-radius: 2px;
  animation: hcLineGrow 0.5s ${EASE_SMOOTH} 0.25s both;
}
.hc-subtitle {
  font-family: var(--fx-font-body);
  font-size: ${FX_FONT_SCALE.body}px;
  color: var(--fx-text);
  opacity: 0;
  text-align: center;
  letter-spacing: 6px;
  line-height: 1.6;
  animation: hcFadeUp 0.6s ${EASE_DECEL} 0.4s both;
}
.hc-line-thin {
  width: 0;
  height: 1px;
  margin-top: 28px;
  background: var(--fx-accent);
  opacity: 0.4;
  animation: hcLineThinGrow 0.5s ${EASE_SMOOTH} 0.55s both;
}
@keyframes hcLineThinGrow {
  from { width: 0; }
  to   { width: 120px; }
}
@keyframes hcFadeUp {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes hcLineGrow {
  from { width: 0; }
  to   { width: 200px; }
}`;

    return { html, css };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// 2. split-text-visual — 左文右图
// ═══════════════════════════════════════════════════════════════════════════════
// demoParams: { title: '用户增长分析', items: ['月活同比增长 42%', '留存率提升至 78%', '付费转化翻倍'], data: [{ label: '月活用户', value: '320万' }] }

const splitTextVisual: PageLayoutDef = {
  id: 'split-text-visual',
  label: '左文右图',
  category: '通用',
  desc: '左半区文字、右半区数据/图片卡片，中间竖分线',
  zones: [
    { id: 'title', type: 'title', bounds: { x: '154px', y: '200px', w: '700px', h: '100px' } },
    { id: 'body',  type: 'body',  bounds: { x: '154px', y: '340px', w: '700px', h: '400px' }, optional: true },
    { id: 'list',  type: 'list',  bounds: { x: '154px', y: '340px', w: '700px', h: '400px' }, optional: true },
    { id: 'data',  type: 'data',  bounds: { x: '1020px', y: '200px', w: '746px', h: '680px' }, optional: true },
  ],
  render(params: PageParams, _style: StyleConfig) {
    const title = escHtml(params.title);
    const body  = params.body ? escHtml(params.body) : '';
    const items = params.items ?? [];
    const data  = params.data ?? [];

    // Left: tag + title + body/items
    let leftContent = `<div class="stv-tag pg-enter">DATA INSIGHTS</div>`;
    leftContent += `<div class="stv-title pg-enter-d1">${title}</div>`;
    if (items.length > 0) {
      leftContent += `<div class="stv-list pg-enter-d2">${items.map(
        (it) => `<div class="stv-item"><span class="stv-dot"></span><span>${escHtml(it)}</span></div>`,
      ).join('')}</div>`;
    } else if (body) {
      leftContent += `<div class="stv-body pg-enter-d2">${body}</div>`;
    }

    // Right: card with data or placeholder
    let rightContent = '';
    if (data.length > 0) {
      const d = data[0];
      rightContent = `
        <div class="stv-data-bar"></div>
        <div class="stv-data-value">${escHtml(d.value)}</div>
        <div class="stv-data-label">${escHtml(d.label)}</div>`;
    } else {
      rightContent = `<div class="stv-placeholder"></div>`;
    }

    const html = `
<div class="stv-left">${leftContent}</div>
<div class="stv-divider pg-enter-d1"></div>
<div class="stv-right pg-enter-d3">
  <div class="stv-card pg-card">${rightContent}</div>
</div>`;

    const css = `
/* split-text-visual */
.stv-left {
  position: absolute;
  left: 154px; top: 86px;
  width: 700px; height: 908px;
  display: flex; flex-direction: column;
  justify-content: center;
}
.stv-tag {
  font-family: var(--fx-font-body);
  font-size: ${FX_FONT_SCALE.caption - 4}px;
  font-weight: 700;
  color: var(--fx-accent);
  letter-spacing: 3px;
  text-transform: uppercase;
  margin-bottom: 16px;
  opacity: 0;
  animation: stvFadeUp 0.5s ${EASE_DECEL} both;
}
.stv-title {
  font-family: var(--fx-font-title);
  font-size: ${FX_FONT_SCALE.title}px;
  font-weight: 800;
  color: var(--fx-text);
  line-height: 1.2;
  margin-bottom: 40px;
  opacity: 0;
  animation: stvFadeUp 0.6s ${EASE_DECEL} 0.1s both;
}
.stv-body {
  font-family: var(--fx-font-body);
  font-size: ${FX_FONT_SCALE.body}px;
  color: var(--fx-text);
  line-height: 1.6;
  opacity: 0;
  animation: stvFadeUp 0.6s ${EASE_DECEL} 0.2s both;
}
.stv-list {
  opacity: 0;
  animation: stvFadeUp 0.6s ${EASE_DECEL} 0.2s both;
}
.stv-item {
  display: flex; align-items: center; gap: 16px;
  font-family: var(--fx-font-body);
  font-size: ${FX_FONT_SCALE.body}px;
  color: var(--fx-text);
  line-height: 1.6;
  padding-bottom: 18px;
  margin-bottom: 18px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.stv-item:last-child {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}
.stv-dot {
  flex-shrink: 0;
  width: 10px; height: 10px;
  border-radius: 50%;
  background: var(--fx-accent);
  box-shadow: 0 0 8px var(--fx-accent), 0 0 16px var(--fx-accent);
  animation: stvDotPulse 2s ease-in-out infinite;
}
@keyframes stvDotPulse {
  0%, 100% { box-shadow: 0 0 4px var(--fx-accent); }
  50%      { box-shadow: 0 0 12px var(--fx-accent), 0 0 20px var(--fx-accent); }
}
.stv-divider {
  position: absolute;
  left: 950px; top: 160px;
  width: 2px; height: 760px;
  background: var(--fx-accent);
  transform-origin: top center;
  transform: scaleY(0);
  animation: stvDivider 0.7s ${EASE_SMOOTH} 0.15s both;
}
@keyframes stvDivider {
  to { transform: scaleY(1); }
}
.stv-right {
  position: absolute;
  right: 154px; top: 86px;
  width: 746px; height: 908px;
  display: flex; align-items: center; justify-content: center;
  opacity: 0;
  animation: stvFadeUp 0.6s ${EASE_DECEL} 0.35s both;
}
.stv-card {
  width: 580px; min-height: 400px;
  padding: 60px 48px;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  box-shadow: ${CARD_SHADOW};
  position: relative;
  overflow: hidden;
}
.stv-data-bar {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: var(--fx-accent);
}
.stv-data-value {
  font-family: var(--fx-font-title);
  font-size: ${FX_FONT_SCALE.display + 12}px;
  font-weight: 900;
  color: var(--fx-accent);
  line-height: 1.1;
}
.stv-data-label {
  margin-top: 20px;
  font-family: var(--fx-font-body);
  font-size: ${FX_FONT_SCALE.caption}px;
  color: var(--fx-text);
  opacity: 0.7;
  letter-spacing: 2px;
}
.stv-placeholder {
  width: 100%; height: 300px;
  border: 2px dashed var(--fx-accent);
  border-radius: 12px;
  opacity: 0.25;
}
@keyframes stvFadeUp {
  from { opacity: 0; transform: translateY(18px); }
  to   { opacity: 1; transform: translateY(0); }
}`;

    return { html, css };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// 3. full-data — 全屏数据展示
// ═══════════════════════════════════════════════════════════════════════════════
// demoParams: { title: '核心业务指标', stats: [{ value: '128%', label: '增长率' }, { value: '50万', label: '用户数' }, { value: '96%', label: '满意度' }, { value: '¥3.2亿', label: '营收' }] }

const fullData: PageLayoutDef = {
  id: 'full-data',
  label: '全屏数据展示',
  category: '通用',
  desc: '大数字卡片横排展示核心指标',
  zones: [
    { id: 'title', type: 'subtitle', bounds: { x: '154px', y: '120px', w: '1612px', h: '60px'  } },
    { id: 'data',  type: 'data',     bounds: { x: '154px', y: '280px', w: '1612px', h: '520px' } },
  ],
  render(params: PageParams, _style: StyleConfig) {
    const title = escHtml(params.title);
    const stats = params.stats ?? [];

    const cards = stats.slice(0, 4).map((s, i) => `
      <div class="fd-card pg-card pg-enter-d${i + 1}">
        <div class="fd-accent-top"></div>
        <div class="fd-icon" aria-hidden="true"></div>
        <div class="fd-value">${escHtml(s.value)}</div>
        <div class="fd-label">${escHtml(s.label)}</div>
        <div class="fd-progress"></div>
      </div>`).join('');

    const html = `
<div class="fd-header pg-enter">${title}</div>
<div class="fd-row">${cards}</div>`;

    const css = `
/* full-data */
.fd-header {
  position: absolute;
  top: 140px; left: 0; right: 0;
  text-align: center;
  font-family: var(--fx-font-title);
  font-size: ${FX_FONT_SCALE.subtitle}px;
  font-weight: 600;
  color: var(--fx-text);
  opacity: 0;
  animation: fdFadeUp 0.5s ${EASE_DECEL} both;
}
.fd-row {
  position: absolute;
  top: 280px; left: 154px; right: 154px;
  height: 520px;
  display: flex;
  align-items: center; justify-content: center;
  gap: 56px;
}
.fd-card {
  flex: 1;
  max-width: 340px;
  padding: 60px 36px 48px;
  text-align: center;
  box-shadow: ${CARD_SHADOW};
  opacity: 0;
  animation: fdCardIn 0.6s ${EASE_DECEL} both;
  position: relative;
  overflow: hidden;
}
.fd-accent-top {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 4px;
  background: var(--fx-accent);
}
.fd-icon {
  width: 14px; height: 14px;
  margin: 0 auto 24px;
  background: var(--fx-accent);
  border-radius: 2px;
  transform: rotate(45deg);
  opacity: 0.5;
}
.pg-enter-d1.fd-card { animation-delay: 0.15s; }
.pg-enter-d2.fd-card { animation-delay: 0.27s; }
.pg-enter-d3.fd-card { animation-delay: 0.39s; }
.pg-enter-d4.fd-card { animation-delay: 0.51s; }
.fd-value {
  font-family: var(--fx-font-title);
  font-size: ${FX_FONT_SCALE.display}px;
  font-weight: 900;
  color: var(--fx-accent);
  line-height: 1.1;
}
.fd-label {
  margin-top: 20px;
  font-family: var(--fx-font-body);
  font-size: ${FX_FONT_SCALE.caption}px;
  color: var(--fx-text);
  opacity: 0.7;
  letter-spacing: 2px;
  line-height: 1.6;
}
.fd-progress {
  margin-top: 24px;
  width: 100%; height: 2px;
  background: rgba(255,255,255,0.06);
  border-radius: 1px;
  position: relative;
  overflow: hidden;
}
.fd-progress::after {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 0;
  background: linear-gradient(90deg, var(--fx-accent) 0%, transparent 100%);
  animation: fdProgressGrow 1.2s ${EASE_SMOOTH} 0.6s both;
}
@keyframes fdProgressGrow {
  to { width: 70%; }
}
@keyframes fdFadeUp {
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes fdCardIn {
  from { opacity: 0; transform: translateY(24px); }
  to   { opacity: 1; transform: translateY(0); }
}`;

    return { html, css };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// 4. bullet-stack — 要点堆叠
// ═══════════════════════════════════════════════════════════════════════════════
// demoParams: { title: '产品核心优势', items: ['端到端 AI 自动化', '毫秒级响应延迟', '99.99% 可用性保障', '零代码集成方案'] }

const bulletStack: PageLayoutDef = {
  id: 'bullet-stack',
  label: '要点堆叠',
  category: '通用',
  desc: '编号列表式要点展示，带装饰竖线',
  zones: [
    { id: 'title', type: 'title', bounds: { x: '154px', y: '120px', w: '1200px', h: '100px' } },
    { id: 'list',  type: 'list',  bounds: { x: '154px', y: '280px', w: '1200px', h: '680px' } },
  ],
  render(params: PageParams, _style: StyleConfig) {
    const title = escHtml(params.title);
    const items = params.items ?? [];

    const rows = items.slice(0, 6).map((it, i) => `
      <div class="bs-row" style="animation-delay: ${0.2 + i * 0.12}s">
        <div class="bs-num">${String(i + 1).padStart(2, '0')}</div>
        <div class="bs-text">${escHtml(it)}</div>
      </div>`).join('');

    const html = `
<div class="bs-container">
  <div class="bs-title pg-enter">${title}</div>
  <div class="bs-underline pg-enter-d1"></div>
  <div class="bs-section-label pg-enter-d1">HIGHLIGHTS</div>
  <div class="bs-items">${rows}</div>
</div>
<div class="bs-accent-bar" aria-hidden="true"></div>`;

    const css = `
/* bullet-stack */
.bs-container {
  position: absolute;
  left: 154px; top: 86px;
  width: 1300px; height: 908px;
  display: flex; flex-direction: column;
  justify-content: center;
}
.bs-title {
  font-family: var(--fx-font-title);
  font-size: ${FX_FONT_SCALE.title}px;
  font-weight: 800;
  color: var(--fx-text);
  line-height: 1.2;
  opacity: 0;
  animation: bsFadeUp 0.6s ${EASE_DECEL} both;
}
.bs-underline {
  width: 0; height: 4px;
  margin-top: 20px; margin-bottom: 20px;
  background: var(--fx-accent);
  border-radius: 2px;
  animation: bsLineGrow 0.5s ${EASE_SMOOTH} 0.15s both;
}
@keyframes bsLineGrow {
  to { width: 120px; }
}
.bs-section-label {
  font-family: var(--fx-font-body);
  font-size: ${FX_FONT_SCALE.caption - 4}px;
  font-weight: 700;
  color: var(--fx-accent);
  letter-spacing: 4px;
  text-transform: uppercase;
  margin-bottom: 36px;
  opacity: 0;
  animation: bsFadeUp 0.4s ${EASE_DECEL} 0.25s both;
}
.bs-items {
  display: flex; flex-direction: column; gap: 24px;
}
.bs-row {
  display: flex; align-items: center; gap: 24px;
  opacity: 0;
  animation: bsSlideIn 0.5s ${EASE_DECEL} both;
  border-left: 3px solid transparent;
  padding-left: 12px;
}
.bs-row:nth-child(odd) {
  border-left-color: rgba(var(--fx-accent-rgb, 255,255,255), 0.15);
}
.bs-num {
  flex-shrink: 0;
  width: 52px; height: 52px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--fx-accent) 0%, rgba(var(--fx-accent-rgb, 255,255,255), 0.6) 100%);
  color: var(--fx-primary);
  font-family: var(--fx-font-title);
  font-size: ${FX_FONT_SCALE.caption}px;
  font-weight: 800;
  display: flex; align-items: center; justify-content: center;
}
.bs-text {
  font-family: var(--fx-font-body);
  font-size: ${FX_FONT_SCALE.body}px;
  color: var(--fx-text);
  line-height: 1.6;
}
.bs-accent-bar {
  position: absolute;
  right: 200px; top: 180px;
  width: 4px; height: 0;
  background: linear-gradient(to bottom, var(--fx-accent) 0%, transparent 100%);
  opacity: 0.18;
  border-radius: 2px;
  animation: bsBarGrow 0.8s ${EASE_SMOOTH} 0.3s both;
}
@keyframes bsBarGrow {
  to { height: 720px; }
}
@keyframes bsFadeUp {
  from { opacity: 0; transform: translateY(18px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes bsSlideIn {
  from { opacity: 0; transform: translateX(-20px); }
  to   { opacity: 1; transform: translateX(0); }
}`;

    return { html, css };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// 5. quote-spotlight — 大引用
// ═══════════════════════════════════════════════════════════════════════════════
// demoParams: { quote: '好的设计是尽可能少的设计。', author: 'Dieter Rams' }

const quoteSpotlight: PageLayoutDef = {
  id: 'quote-spotlight',
  label: '大引用',
  category: '通用',
  desc: '居中大引用，配巨型引号装饰与作者署名',
  zones: [
    { id: 'quote',  type: 'body',    bounds: { x: '240px', y: '260px', w: '1440px', h: '400px' } },
    { id: 'author', type: 'subtitle', bounds: { x: '240px', y: '720px', w: '1440px', h: '40px'  }, optional: true },
  ],
  render(params: PageParams, _style: StyleConfig) {
    const quote  = escHtml(params.quote);
    const author = params.author ? escHtml(params.author) : '';

    const html = `
<div class="qs-container">
  <div class="qs-mark qs-mark-open pg-enter" aria-hidden="true">“</div>
  <div class="qs-mark qs-mark-close pg-enter" aria-hidden="true">”</div>
  <div class="qs-vline pg-enter-d1" aria-hidden="true"></div>
  <div class="qs-quote pg-enter-d1">${quote}</div>
  ${author ? `<div class="qs-author pg-enter-d3">— ${author}</div>` : ''}
  <div class="qs-bottom-line pg-enter-d4"></div>
</div>`;

    const css = `
/* quote-spotlight */
.qs-container {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: 86px 240px;
}
.qs-mark {
  position: absolute;
  font-family: var(--fx-font-title);
  font-size: 280px;
  font-weight: 900;
  color: var(--fx-accent);
  opacity: 0;
  line-height: 1;
}
.qs-mark-open {
  top: 80px; left: 120px;
  animation: qsMarkIn 0.7s ${EASE_DECEL} both;
}
.qs-mark-close {
  bottom: 60px; right: 120px;
  animation: qsMarkIn 0.7s ${EASE_DECEL} 0.15s both;
}
@keyframes qsMarkIn {
  from { opacity: 0; transform: scale(0.6); }
  to   { opacity: 0.08; transform: scale(1); }
}
.qs-vline {
  position: absolute;
  left: 200px; top: 50%;
  width: 2px; height: 0;
  margin-top: -160px;
  background: var(--fx-accent);
  opacity: 0.15;
  animation: qsVlineGrow 0.7s ${EASE_SMOOTH} 0.2s both;
}
@keyframes qsVlineGrow {
  to { height: 320px; }
}
.qs-quote {
  font-family: var(--fx-font-body);
  font-size: ${FX_FONT_SCALE.title}px;
  font-style: italic;
  color: var(--fx-text);
  text-align: center;
  line-height: 1.6;
  max-width: 1200px;
  opacity: 0;
  animation: qsFadeUp 0.6s ${EASE_DECEL} 0.2s both;
}
.qs-author {
  margin-top: 48px;
  font-family: var(--fx-font-body);
  font-size: ${FX_FONT_SCALE.caption}px;
  color: var(--fx-accent);
  text-align: right;
  width: 100%;
  max-width: 1200px;
  letter-spacing: 2px;
  opacity: 0;
  animation: qsFadeUp 0.5s ${EASE_DECEL} 0.5s both;
}
.qs-bottom-line {
  margin-top: 60px;
  width: 0; height: 2px;
  background: var(--fx-accent);
  border-radius: 1px;
  animation: qsLineGrow 0.6s ${EASE_SMOOTH} 0.6s both;
}
@keyframes qsLineGrow {
  to { width: 200px; }
}
@keyframes qsFadeUp {
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
}`;

    return { html, css };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// 6. lower-bar — 底部信息条（口播）
// ═══════════════════════════════════════════════════════════════════════════════
// demoParams: { title: '本季度营收增长 42%，创历史新高', subtitle: '财报速递' }

const lowerBar: PageLayoutDef = {
  id: 'lower-bar',
  label: '底部信息条',
  category: '口播',
  desc: '底部磨砂信息条，适合口播叠加',
  zones: [
    { id: 'title',    type: 'title',    bounds: { x: '154px', y: '840px', w: '1612px', h: '60px' } },
    { id: 'subtitle', type: 'subtitle', bounds: { x: '154px', y: '790px', w: '1612px', h: '40px' }, optional: true },
  ],
  render(params: PageParams, _style: StyleConfig) {
    const title    = escHtml(params.title);
    const subtitle = params.subtitle ? escHtml(params.subtitle) : '';

    const html = `
<div class="lb-fade" aria-hidden="true"></div>
<div class="lb-bar pg-enter">
  <div class="lb-noise" aria-hidden="true"></div>
  ${subtitle ? `<div class="lb-subtitle"><span class="lb-dot" aria-hidden="true"></span>${subtitle}</div>` : ''}
  <div class="lb-title">${title}</div>
</div>`;

    const css = `
/* lower-bar */
.lb-fade {
  position: absolute;
  left: 0; right: 0; bottom: 200px;
  height: 80px;
  background: linear-gradient(to bottom, transparent 0%, var(--fx-surface) 100%);
  opacity: 0;
  animation: lbFade 0.6s ${EASE_SMOOTH} 0.1s both;
}
.lb-bar {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  min-height: 200px;
  padding: 40px 154px 56px 154px;
  background: var(--fx-surface);
  border-left: 6px solid transparent;
  border-image: linear-gradient(to bottom, var(--fx-accent) 0%, transparent 100%) 1;
  display: flex; flex-direction: column;
  justify-content: flex-end;
  opacity: 0;
  animation: lbSlideUp 0.6s ${EASE_DECEL} both;
  position: relative;
  overflow: hidden;
}
.lb-noise {
  position: absolute; inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  background-size: 128px 128px;
  opacity: 0.03;
}
.lb-subtitle {
  font-family: var(--fx-font-body);
  font-size: ${FX_FONT_SCALE.caption}px;
  color: var(--fx-accent);
  letter-spacing: 3px;
  text-transform: uppercase;
  margin-bottom: 12px;
  display: flex; align-items: center; gap: 10px;
  opacity: 0;
  animation: lbFade 0.4s ${EASE_SMOOTH} 0.3s both;
}
.lb-dot {
  display: inline-block;
  width: 6px; height: 6px;
  background: var(--fx-accent);
  transform: rotate(45deg);
  flex-shrink: 0;
}
.lb-title {
  font-family: var(--fx-font-title);
  font-size: ${FX_FONT_SCALE.subtitle}px;
  font-weight: 700;
  color: var(--fx-text);
  line-height: 1.3;
  opacity: 0;
  animation: lbFade 0.5s ${EASE_SMOOTH} 0.2s both;
}
@keyframes lbSlideUp {
  from { opacity: 0; transform: translateY(24px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes lbFade {
  from { opacity: 0; }
  to   { opacity: 1; }
}`;

    return { html, css };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// 7. side-panel — 侧边信息面板（口播）
// ═══════════════════════════════════════════════════════════════════════════════
// demoParams: { title: '项目进展', items: ['需求分析已完成', '原型设计进行中', '技术选型待确认'] }

const sidePanel: PageLayoutDef = {
  id: 'side-panel',
  label: '侧边信息面板',
  category: '口播',
  desc: '右侧滑入面板，适合口播配合要点展示',
  zones: [
    { id: 'title', type: 'title', bounds: { x: '1152px', y: '120px', w: '614px', h: '60px' } },
    { id: 'list',  type: 'list',  bounds: { x: '1152px', y: '240px', w: '614px', h: '700px' } },
  ],
  render(params: PageParams, _style: StyleConfig) {
    const title = escHtml(params.title);
    const items = params.items ?? [];

    const listHtml = items.slice(0, 6).map((it, i) => `
      <div class="sp-item" style="animation-delay: ${0.35 + i * 0.1}s">
        <span class="sp-badge">${String(i + 1).padStart(2, '0')}</span>
        <span class="sp-text">${escHtml(it)}</span>
      </div>`).join('');

    const html = `
<div class="sp-panel pg-card pg-enter">
  <div class="sp-top-line" aria-hidden="true"></div>
  <div class="sp-title">${title}</div>
  <div class="sp-title-underline"></div>
  <div class="sp-list">${listHtml}</div>
</div>`;

    const css = `
/* side-panel */
.sp-panel {
  position: absolute;
  right: 0; top: 0; bottom: 0;
  width: 40%;
  padding: 86px 60px;
  box-shadow: ${CARD_SHADOW};
  display: flex; flex-direction: column;
  justify-content: center;
  opacity: 0;
  animation: spSlideIn 0.7s ${EASE_DECEL} both;
  border-left: 4px solid transparent;
  border-image: linear-gradient(to bottom, var(--fx-accent) 0%, transparent 100%) 1;
}
.sp-top-line {
  position: absolute;
  top: 86px; left: 60px; right: 60px;
  height: 1px;
  background: var(--fx-accent);
  opacity: 0.2;
}
.sp-title {
  font-family: var(--fx-font-title);
  font-size: ${FX_FONT_SCALE.subtitle}px;
  font-weight: 700;
  color: var(--fx-text);
  line-height: 1.2;
  margin-bottom: 12px;
  opacity: 0;
  animation: spFadeIn 0.5s ${EASE_SMOOTH} 0.25s both;
}
.sp-title-underline {
  width: 40px; height: 3px;
  background: var(--fx-accent);
  border-radius: 2px;
  margin-bottom: 48px;
  opacity: 0;
  animation: spFadeIn 0.4s ${EASE_SMOOTH} 0.3s both;
}
.sp-list {
  display: flex; flex-direction: column; gap: 28px;
}
.sp-item {
  display: flex; align-items: flex-start; gap: 16px;
  opacity: 0;
  animation: spItemIn 0.5s ${EASE_DECEL} both;
}
.sp-badge {
  flex-shrink: 0;
  width: 36px; height: 36px;
  border-radius: 50%;
  background: var(--fx-accent);
  color: var(--fx-primary);
  font-family: var(--fx-font-title);
  font-size: ${FX_FONT_SCALE.caption - 4}px;
  font-weight: 800;
  display: flex; align-items: center; justify-content: center;
  margin-top: 2px;
}
.sp-text {
  font-family: var(--fx-font-body);
  font-size: ${FX_FONT_SCALE.body}px;
  color: var(--fx-text);
  line-height: 1.6;
}
@keyframes spSlideIn {
  from { opacity: 0; transform: translateX(80px); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes spFadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes spItemIn {
  from { opacity: 0; transform: translateX(20px); }
  to   { opacity: 1; transform: translateX(0); }
}`;

    return { html, css };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// 8. floating-cards — 多卡片浮动（口播）
// ═══════════════════════════════════════════════════════════════════════════════
// demoParams: { items: ['AI 驱动的智能推荐', '实时数据分析面板', '一键导出报告', '多端协同编辑'] }

const floatingCards: PageLayoutDef = {
  id: 'floating-cards',
  label: '多卡片浮动',
  category: '口播',
  desc: '右侧散布多张小卡片，适合口播配合要点',
  zones: [
    { id: 'list', type: 'list', bounds: { x: '960px', y: '86px', w: '806px', h: '908px' } },
  ],
  render(params: PageParams, _style: StyleConfig) {
    const items = params.items ?? [];

    // Pre-defined positions (right portion, staggered)
    const positions = [
      { right: 120, top: 140 },
      { right: 280, top: 380 },
      { right: 80,  top: 580 },
      { right: 320, top: 760 },
    ];

    // Subtle rotations for alternating cards
    const rotations = [1, -0.5, 0.8, -0.3];

    const cards = items.slice(0, 4).map((it, i) => {
      const pos = positions[i] ?? positions[0];
      const rot = rotations[i] ?? 0;
      return `
      <div class="fc-card pg-card"
           style="right: ${pos.right}px; top: ${pos.top}px; animation-delay: ${0.15 + i * 0.13}s; --fc-rot: ${rot}deg">
        <div class="fc-num" aria-hidden="true">${String(i + 1).padStart(2, '0')}</div>
        <div class="fc-tag"></div>
        <div class="fc-text">${escHtml(it)}</div>
      </div>`;
    }).join('');

    // Dotted vertical connector line
    const html = `
<div class="fc-connector" aria-hidden="true"></div>
${cards}`;

    const css = `
/* floating-cards */
.fc-connector {
  position: absolute;
  right: 380px; top: 180px;
  width: 1px; height: 640px;
  border-left: 2px dotted var(--fx-accent);
  opacity: 0;
  animation: fcConnectorIn 0.8s ${EASE_SMOOTH} 0.5s both;
}
@keyframes fcConnectorIn {
  from { opacity: 0; }
  to   { opacity: 0.1; }
}
.fc-card {
  position: absolute;
  width: 380px;
  padding: 32px 36px;
  box-shadow: ${CARD_SHADOW};
  opacity: 0;
  animation: fcFloat 0.6s ${EASE_DECEL} both;
}
.fc-num {
  position: absolute;
  top: 16px; right: 16px;
  width: 32px; height: 32px;
  border-radius: 50%;
  background: var(--fx-accent);
  color: var(--fx-primary);
  font-family: var(--fx-font-title);
  font-size: 13px;
  font-weight: 800;
  display: flex; align-items: center; justify-content: center;
}
.fc-tag {
  width: 48px; height: 4px;
  background: var(--fx-accent);
  border-radius: 2px;
  margin-bottom: 16px;
}
.fc-text {
  font-family: var(--fx-font-body);
  font-size: ${FX_FONT_SCALE.body}px;
  color: var(--fx-text);
  line-height: 1.6;
}
@keyframes fcFloat {
  from { opacity: 0; transform: translateY(20px) scale(0.96) rotate(0deg); }
  to   { opacity: 1; transform: translateY(0) scale(1) rotate(var(--fc-rot, 0deg)); }
}`;

    return { html, css };
  },
};

// ── 导出 ────────────────────────────────────────────────────────────────────────

export const GENERAL_LAYOUTS: PageLayoutDef[] = [
  heroCenter,
  splitTextVisual,
  fullData,
  bulletStack,
  quoteSpotlight,
  lowerBar,
  sidePanel,
  floatingCards,
];
