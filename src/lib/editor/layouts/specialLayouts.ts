/**
 * specialLayouts — 专题场景页面布局（电商 / 知识 / 品牌）。
 *
 * 7 种布局 x 6 种风格 → 40+ 页面模板（减去不兼容组合）。
 * 每个 render(params, style) 只返回内容 HTML/CSS，
 * 外壳 .fx-root / .pg-root 由 pageLayoutEngine.renderPage 统一套壳。
 *
 * 坐标系：1920×1080 absolute stage，安全区 8%（154px / 86px）。
 */

import type { PageLayoutDef, PageParams, StyleConfig } from '../pageLayoutEngine';
import { escHtml, FX_FONT_SCALE, SAFE_PAD, CONTENT_AREA } from '../pageLayoutEngine';

// ── 公共常量 ─────────────────────────────────────────────────────────────────

const SX = SAFE_PAD.x;  // 154
const SY = SAFE_PAD.y;  // 86
const CW = CONTENT_AREA.w; // 1612
const CH = CONTENT_AREA.h; // 908

/** 高级缓动曲线 */
const EASE_PREMIUM = 'cubic-bezier(0.16, 1, 0.3, 1)';
const EASE_SMOOTH  = 'cubic-bezier(0.32, 0.72, 0, 1)';

// ═══════════════════════════════════════════════════════════════════════════════
// 1. product-showcase — 产品展示（电商）
// ═══════════════════════════════════════════════════════════════════════════════
//
// demoParams: {
//   title: '轻盈无线耳机',
//   items: ['主动降噪', '30小时续航', '蓝牙5.3', 'Hi-Res认证'],
//   price: '¥299',
//   originalPrice: '¥599',
// }

const productShowcase: PageLayoutDef = {
  id: 'product-showcase',
  label: '产品展示',
  category: '电商',
  desc: '中央产品图 + 四周卖点标签 + 底部价格',
  zones: [
    { id: 'image',  type: 'image', bounds: { x: '660px', y: '120px', w: '600px', h: '600px' } },
    { id: 'items',  type: 'list',  bounds: { x: '154px', y: '160px', w: '1612px', h: '600px' } },
    { id: 'price',  type: 'data',  bounds: { x: '660px', y: '760px', w: '600px', h: '120px' } },
  ],

  render(params: PageParams, _style: StyleConfig) {
    const items = (params.items ?? []).slice(0, 4);
    const price = escHtml(params.price ?? '');
    const origPrice = escHtml(params.originalPrice ?? '');

    // 卖点位置：四个角散布
    const positions = [
      { x: SX,            y: SY + 60,       align: 'left'  },
      { x: 1920 - SX - 280, y: SY + 60,     align: 'right' },
      { x: SX,            y: SY + CH - 260,  align: 'left'  },
      { x: 1920 - SX - 280, y: SY + CH - 260, align: 'right' },
    ];

    // Center of product area for decorative lines
    const centerX = 960;
    const centerY = 486; // 50% - 55% offset ≈ top area center

    const linesHtml = items.map((_, i) => {
      const pos = positions[i] ?? positions[0];
      const pillX = pos.align === 'left' ? pos.x + 140 : pos.x + 140;
      const pillY = pos.y + 20;
      // SVG line from center to pill
      const x1 = centerX; const y1 = centerY;
      const x2 = pillX; const y2 = pillY;
      return `<svg class="ps-ray pg-enter pg-enter-d${i + 1}" style="position:absolute;left:0;top:0;width:1920px;height:1080px;pointer-events:none;">
        <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--fx-accent)" stroke-width="1" stroke-dasharray="6,6" opacity="0.18"/>
      </svg>`;
    }).join('\n');

    const pointsHtml = items.map((text, i) => {
      const pos = positions[i] ?? positions[0];
      return `<div class="ps-point pg-enter pg-enter-d${i + 1}"
        style="position:absolute;left:${pos.x}px;top:${pos.y}px;text-align:${pos.align}">
        <span class="ps-pill">${escHtml(text)}</span>
      </div>`;
    }).join('\n');

    const html = `
<!-- 聚光灯背景 -->
<div class="ps-spotlight"></div>

<!-- 装饰连接线 -->
${linesHtml}

<!-- 产品图占位 -->
<div class="ps-product-area pg-enter">
  <span class="ps-product-label">产品图</span>
</div>

<!-- 卖点标签 -->
${pointsHtml}

<!-- 价格区域 -->
<div class="ps-price-row pg-enter pg-enter-d5">
  ${origPrice ? `<span class="ps-orig-price">${origPrice}</span>` : ''}
  <span class="ps-price">${price}</span>
</div>`;

    const css = `
/* ── product-showcase ── */
@keyframes psEnter {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes psPulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.03); }
}
.ps-spotlight {
  position: absolute;
  left: 50%; top: 45%;
  transform: translate(-50%, -50%);
  width: 900px; height: 900px;
  background: radial-gradient(circle, var(--fx-accent) 0%, transparent 70%);
  opacity: 0.06;
  pointer-events: none;
}
.ps-product-area {
  position: absolute;
  left: 50%; top: 50%;
  transform: translate(-50%, -55%);
  width: 600px; height: 600px;
  border-radius: 24px;
  display: flex; align-items: center; justify-content: center;
  opacity: 0;
  animation: psEnter 0.6s ${EASE_PREMIUM} 0.1s both;
  /* gradient border via background trick */
  background:
    linear-gradient(var(--fx-primary), var(--fx-primary)) padding-box,
    linear-gradient(135deg, var(--fx-accent), var(--fx-accent2, var(--fx-accent)), var(--fx-accent)) border-box;
  border: 3px solid transparent;
}
.ps-product-label {
  font-family: var(--fx-font-body);
  font-size: ${FX_FONT_SCALE.subtitle}px;
  color: var(--fx-accent);
  opacity: 0.4;
}
.ps-pill {
  display: inline-block;
  padding: 10px 28px;
  background: var(--fx-accent);
  color: var(--fx-primary);
  font-family: var(--fx-font-body);
  font-size: ${FX_FONT_SCALE.caption}px;
  font-weight: 700;
  border-radius: 100px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.15), 0 1px 4px rgba(0,0,0,0.1), 0 0 20px var(--fx-accent);
}
.ps-point {
  opacity: 0;
}
.ps-ray {
  opacity: 0;
}
.pg-enter-d1 { animation: psEnter 0.5s ${EASE_PREMIUM} 0.3s both; }
.pg-enter-d2 { animation: psEnter 0.5s ${EASE_PREMIUM} 0.45s both; }
.pg-enter-d3 { animation: psEnter 0.5s ${EASE_PREMIUM} 0.6s both; }
.pg-enter-d4 { animation: psEnter 0.5s ${EASE_PREMIUM} 0.75s both; }
.pg-enter-d5 { animation: psEnter 0.5s ${EASE_PREMIUM} 0.9s both; }
.ps-price-row {
  position: absolute;
  left: 50%; bottom: ${SY + 40}px;
  transform: translateX(-50%);
  display: flex; align-items: baseline; gap: 20px;
  opacity: 0;
}
.ps-price {
  font-family: var(--fx-font-title);
  font-size: ${FX_FONT_SCALE.display}px;
  font-weight: 900;
  color: var(--fx-accent);
  line-height: 1.1;
  text-shadow: 0 0 40px var(--fx-accent);
}
.ps-orig-price {
  font-family: var(--fx-font-body);
  font-size: ${FX_FONT_SCALE.subtitle}px;
  color: var(--fx-text);
  opacity: 0.45;
  text-decoration: line-through;
}`;

    return { html, css };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// 2. compare-grid — 对比网格（电商）
// ═══════════════════════════════════════════════════════════════════════════════
//
// demoParams: {
//   title: '套餐对比',
//   items: ['基础版', '专业版', '旗舰版'],
//   data: [
//     { label: '存储空间', value: '10GB / 100GB / 无限' },
//     { label: '用户数', value: '1人 / 5人 / 不限' },
//     { label: '技术支持', value: '社区 / 工单 / 专属顾问' },
//     { label: '月费', value: '¥29 / ¥99 / ¥299' },
//   ],
// }

const compareGrid: PageLayoutDef = {
  id: 'compare-grid',
  label: '对比网格',
  category: '电商',
  desc: '多列对比卡片网格 + 标题',
  zones: [
    { id: 'title', type: 'title',    bounds: { x: `${SX}px`, y: `${SY}px`, w: `${CW}px`, h: '80px' } },
    { id: 'cols',  type: 'list',     bounds: { x: `${SX}px`, y: '180px', w: `${CW}px`, h: '780px' } },
    { id: 'data',  type: 'data',     bounds: { x: `${SX}px`, y: '260px', w: `${CW}px`, h: '700px' } },
  ],

  render(params: PageParams, _style: StyleConfig) {
    const title = escHtml(params.title ?? '');
    const colHeaders = (params.items ?? []).slice(0, 3);
    const rows = (params.data ?? []).slice(0, 6);
    const colCount = Math.max(colHeaders.length, 2);
    const colW = Math.floor((CW - (colCount - 1) * 28) / colCount);

    const colsHtml = colHeaders.map((header, ci) => {
      const isLast = ci === colHeaders.length - 1;
      const rowsInCol = rows.map((row, ri) => {
        const vals = String(row.value).split('/').map(v => v.trim());
        const cellVal = vals[ci] ?? vals[0] ?? '';
        const evenRow = ri % 2 === 0;
        return `<div class="cg-row ${evenRow ? 'cg-row-even' : ''}" style="animation-delay:${0.4 + ri * 0.1 + ci * 0.15}s">
          <span class="cg-row-label">${escHtml(row.label)}</span>
          <span class="cg-row-val">${escHtml(cellVal)}</span>
        </div>`;
      }).join('');

      return `<div class="cg-col pg-card ${isLast ? 'cg-col-accent' : ''} pg-enter"
        style="width:${colW}px;animation-delay:${0.15 + ci * 0.15}s">
        ${isLast ? '<div class="cg-recommend-badge">推荐</div>' : ''}
        <div class="cg-col-header"><span class="cg-header-dot"></span>${escHtml(header)}</div>
        ${rowsInCol}
        <div class="cg-col-bottom-line"></div>
      </div>`;
    }).join('');

    const html = `
${title ? `<div class="cg-title pg-enter" style="position:absolute;left:${SX}px;top:${SY}px">${title}</div>` : ''}
<div class="cg-grid" style="position:absolute;left:${SX}px;top:${SY + 100}px;display:flex;gap:28px;">
  ${colsHtml}
</div>`;

    const css = `
/* ── compare-grid ── */
@keyframes cgEnter {
  from { opacity: 0; transform: translateY(24px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes cgRowIn {
  from { opacity: 0; transform: translateX(-12px); }
  to   { opacity: 1; transform: translateX(0); }
}
.cg-title {
  font-family: var(--fx-font-title);
  font-size: ${FX_FONT_SCALE.subtitle}px;
  font-weight: 700;
  color: var(--fx-text);
  line-height: 1.2;
  opacity: 0;
  animation: cgEnter 0.5s ${EASE_PREMIUM} 0.1s both;
}
.cg-grid .pg-enter {
  opacity: 0;
  animation: cgEnter 0.55s ${EASE_PREMIUM} both;
}
.cg-col {
  padding: 36px 32px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.12), 0 1px 6px rgba(0,0,0,0.08);
  position: relative;
  overflow: hidden;
}
.cg-col-accent {
  border-top: 4px solid var(--fx-accent);
  background-image: linear-gradient(180deg, var(--fx-accent) 0%, transparent 40%);
  background-size: 100% 100%;
  background-blend-mode: overlay;
}
.cg-col-accent::before {
  content: '';
  position: absolute; inset: 0;
  background: linear-gradient(180deg, var(--fx-accent), transparent 50%);
  opacity: 0.06;
  pointer-events: none;
}
.cg-recommend-badge {
  position: absolute;
  top: -4px; right: 24px;
  padding: 6px 18px;
  background: var(--fx-accent);
  color: var(--fx-primary);
  font-family: var(--fx-font-body);
  font-size: ${FX_FONT_SCALE.caption * 0.85}px;
  font-weight: 700;
  border-radius: 0 0 8px 8px;
  letter-spacing: 2px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
}
.cg-header-dot {
  display: inline-block;
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--fx-accent);
  margin-right: 12px;
  vertical-align: middle;
}
.cg-col-header {
  font-family: var(--fx-font-title);
  font-size: ${FX_FONT_SCALE.body}px;
  font-weight: 800;
  color: var(--fx-text);
  margin-bottom: 28px;
  padding-bottom: 16px;
  border-bottom: 2px solid rgba(255,255,255,0.08);
}
.cg-col-accent .cg-col-header {
  color: var(--fx-accent);
}
.cg-col:not(.cg-col-accent) {
  opacity: 0.8;
}
.cg-col-bottom-line {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, transparent, var(--fx-accent), transparent);
  opacity: 0.4;
}
.cg-row {
  display: flex; justify-content: space-between; align-items: baseline;
  padding: 14px 8px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  opacity: 0;
  animation: cgRowIn 0.4s ${EASE_SMOOTH} both;
  border-radius: 4px;
}
.cg-row-even {
  background: rgba(255,255,255,0.02);
}
.cg-row-label {
  font-family: var(--fx-font-body);
  font-size: ${FX_FONT_SCALE.caption}px;
  color: var(--fx-text);
  opacity: 0.6;
}
.cg-row-val {
  font-family: var(--fx-font-body);
  font-size: ${FX_FONT_SCALE.caption}px;
  font-weight: 600;
  color: var(--fx-text);
}`;

    return { html, css };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// 3. promo-banner — 促销横幅（电商）
// ═══════════════════════════════════════════════════════════════════════════════
//
// demoParams: {
//   title: '年中大促',
//   subtitle: '全场精选商品限时特惠，错过再等一年',
//   price: '¥199',
//   originalPrice: '¥899',
//   cta: '立即抢购',
//   items: ['仅剩 24 小时'],
// }

const promoBanner: PageLayoutDef = {
  id: 'promo-banner',
  label: '促销横幅',
  category: '电商',
  desc: '全幅促销横幅 — 大标题 + 价格 + CTA',
  zones: [
    { id: 'badge',    type: 'badge',    bounds: { x: `${SX}px`, y: `${SY}px`,  w: '300px', h: '48px' }, optional: true },
    { id: 'title',    type: 'title',    bounds: { x: `${SX}px`, y: '200px', w: `${CW}px`, h: '100px' } },
    { id: 'subtitle', type: 'subtitle', bounds: { x: `${SX}px`, y: '320px', w: `${CW}px`, h: '60px' }, optional: true },
    { id: 'price',    type: 'data',     bounds: { x: `${SX}px`, y: '440px', w: `${CW}px`, h: '160px' } },
    { id: 'cta',      type: 'cta',      bounds: { x: `${SX}px`, y: '680px', w: `${CW}px`, h: '72px' }, optional: true },
  ],

  render(params: PageParams, _style: StyleConfig) {
    const title = escHtml(params.title ?? '');
    const subtitle = escHtml(params.subtitle ?? '');
    const price = escHtml(params.price ?? '');
    const origPrice = escHtml(params.originalPrice ?? '');
    const cta = escHtml(params.cta ?? '');
    const urgency = (params.items ?? [])[0] ? escHtml((params.items as string[])[0]) : '';

    const html = `
<!-- 背景渐变层 -->
<div class="pb-bg"></div>

<!-- 装饰对角条纹 -->
<div class="pb-stripes"></div>

<!-- 价格闪光背景 -->
<div class="pb-starburst"></div>

<!-- 紧迫感标签 -->
${urgency ? `<div class="pb-urgency pg-enter" style="position:absolute;left:50%;top:${SY + 40}px;transform:translateX(-50%)">
  <span class="pg-badge pb-urgency-tag">${urgency}</span>
</div>` : ''}

<!-- 主标题 -->
<div class="pb-title pg-enter pg-enter-d1">${title}</div>

<!-- 副标题 -->
${subtitle ? `<div class="pb-subtitle pg-enter pg-enter-d2">${subtitle}</div>` : ''}

<!-- 价格区 -->
<div class="pb-price-block pg-enter pg-enter-d3">
  ${origPrice ? `<div class="pb-orig">${origPrice}</div>` : ''}
  <div class="pb-price">${price}</div>
</div>

<!-- CTA 按钮 -->
${cta ? `<div class="pb-cta-wrap pg-enter pg-enter-d4">
  <span class="pg-cta pb-cta">${cta}</span>
</div>` : ''}`;

    const css = `
/* ── promo-banner ── */
@keyframes pbEnter {
  from { opacity: 0; transform: translateY(18px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes pbGlow {
  0%, 100% { text-shadow: 0 0 50px var(--fx-accent), 0 0 100px var(--fx-accent), 0 0 20px rgba(0,0,0,0.3); }
  50% { text-shadow: 0 0 80px var(--fx-accent), 0 0 160px var(--fx-accent), 0 0 40px rgba(0,0,0,0.4); }
}
@keyframes pbUrgencyPulse {
  0%, 100% { box-shadow: 0 0 0 0 var(--fx-accent); }
  50% { box-shadow: 0 0 16px 4px var(--fx-accent); }
}
.pb-bg {
  position: absolute; inset: 0;
  background: linear-gradient(135deg,
    var(--fx-primary) 0%,
    var(--fx-surface) 50%,
    var(--fx-primary) 100%
  );
  opacity: 0.6;
}
.pb-stripes {
  position: absolute; inset: 0;
  background: repeating-linear-gradient(
    -45deg,
    transparent,
    transparent 40px,
    rgba(255,255,255,0.015) 40px,
    rgba(255,255,255,0.015) 80px
  );
  pointer-events: none;
}
.pb-starburst {
  position: absolute;
  left: 50%; top: 480px;
  transform: translate(-50%, -50%);
  width: 600px; height: 600px;
  background: radial-gradient(circle, var(--fx-accent) 0%, transparent 50%);
  opacity: 0.07;
  pointer-events: none;
}
.pb-urgency {
  opacity: 0;
  animation: pbEnter 0.5s ${EASE_PREMIUM} 0.1s both;
}
.pb-urgency-tag {
  animation: pbUrgencyPulse 2s ${EASE_SMOOTH} 1s infinite;
  border: 2px solid var(--fx-accent);
}
.pb-title {
  position: absolute;
  left: 50%; top: 240px;
  transform: translateX(-50%);
  font-family: var(--fx-font-title);
  font-size: ${FX_FONT_SCALE.title}px;
  font-weight: 900;
  color: var(--fx-text);
  text-align: center;
  line-height: 1.2;
  white-space: nowrap;
  opacity: 0;
}
.pb-subtitle {
  position: absolute;
  left: 50%; top: 340px;
  transform: translateX(-50%);
  font-family: var(--fx-font-body);
  font-size: ${FX_FONT_SCALE.body}px;
  color: var(--fx-text);
  opacity: 0;
  text-align: center;
  line-height: 1.6;
}
.pb-price-block {
  position: absolute;
  left: 50%; top: 440px;
  transform: translateX(-50%);
  text-align: center;
  opacity: 0;
}
.pb-orig {
  font-family: var(--fx-font-body);
  font-size: ${FX_FONT_SCALE.subtitle}px;
  color: var(--fx-text);
  opacity: 0.4;
  text-decoration: line-through;
  margin-bottom: 8px;
}
.pb-price {
  font-family: var(--fx-font-title);
  font-size: ${FX_FONT_SCALE.display}px;
  font-weight: 900;
  color: var(--fx-accent);
  line-height: 1.1;
  animation: pbGlow 2.5s ${EASE_SMOOTH} 1s infinite;
}
.pb-cta-wrap {
  position: absolute;
  left: 50%; bottom: ${SY + 100}px;
  transform: translateX(-50%);
  opacity: 0;
}
.pb-cta {
  border-radius: 100px;
  padding: 20px 72px;
  font-size: ${FX_FONT_SCALE.body}px;
  background: linear-gradient(135deg, var(--fx-accent), var(--fx-accent2, var(--fx-accent)));
  box-shadow: 0 8px 32px rgba(0,0,0,0.25), 0 2px 8px rgba(0,0,0,0.15), 0 0 20px var(--fx-accent);
}
.pg-enter-d1 { animation: pbEnter 0.6s ${EASE_PREMIUM} 0.2s both; }
.pg-enter-d2 { animation: pbEnter 0.5s ${EASE_PREMIUM} 0.4s both; }
.pg-enter-d3 { animation: pbEnter 0.6s ${EASE_PREMIUM} 0.55s both; }
.pg-enter-d4 { animation: pbEnter 0.5s ${EASE_PREMIUM} 0.75s both; }`;

    return { html, css };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// 4. step-timeline — 步骤时间线（知识）
// ═══════════════════════════════════════════════════════════════════════════════
//
// demoParams: {
//   title: '项目实施流程',
//   steps: ['需求分析', '方案设计', '开发测试', '上线部署'],
// }

const stepTimeline: PageLayoutDef = {
  id: 'step-timeline',
  label: '步骤时间线',
  category: '知识',
  desc: '水平时间线 — 编号圆点 + 连接线 + 步骤标签',
  zones: [
    { id: 'title', type: 'title', bounds: { x: `${SX}px`, y: `${SY}px`, w: `${CW}px`, h: '80px' } },
    { id: 'steps', type: 'list',  bounds: { x: `${SX}px`, y: '240px', w: `${CW}px`, h: '600px' } },
  ],

  render(params: PageParams, _style: StyleConfig) {
    const title = escHtml(params.title ?? '');
    const rawSteps = (params.steps ?? params.items ?? []).slice(0, 6);
    const showSteps = rawSteps.length > 4 ? rawSteps.slice(0, 4) : rawSteps;
    const hasMore = rawSteps.length > 4;
    const count = showSteps.length + (hasMore ? 1 : 0);

    // Circle + line geometry
    const circleR = 40;
    const lineY = 440;
    const totalW = CW - 120; // usable width for timeline
    const stepGap = count > 1 ? totalW / (count - 1) : 0;
    const startX = SX + 60;

    let timelineHtml = '';

    // Background decorative band
    timelineHtml += `<div class="st-band" style="
      position:absolute;left:${SX}px;top:${lineY - 60}px;
      width:${CW}px;height:120px;
    "></div>`;

    // Arrow indicator at start
    timelineHtml += `<div class="st-arrow-start pg-enter" style="
      position:absolute;left:${startX - 40}px;top:${lineY - 8}px;
      animation-delay:0.15s;
    "></div>`;

    showSteps.forEach((step, i) => {
      const cx = startX + i * stepGap;
      // Connecting line with gradient (not for last)
      if (i < count - 1) {
        timelineHtml += `<div class="st-line pg-enter" style="
          position:absolute;left:${cx + circleR + 8}px;top:${lineY - 2}px;
          width:${stepGap - circleR * 2 - 16}px;height:4px;
          animation-delay:${0.3 + i * 0.18}s;
        "></div>`;
      }
      // Outer ring (double-ring effect)
      timelineHtml += `<div class="st-outer-ring pg-enter" style="
        position:absolute;left:${cx - circleR - 6}px;top:${lineY - circleR - 6}px;
        width:${(circleR + 6) * 2}px;height:${(circleR + 6) * 2}px;
        animation-delay:${0.2 + i * 0.18}s;
      "></div>`;
      // Circle
      timelineHtml += `<div class="st-circle pg-enter" style="
        position:absolute;left:${cx - circleR}px;top:${lineY - circleR}px;
        width:${circleR * 2}px;height:${circleR * 2}px;
        animation-delay:${0.2 + i * 0.18}s;
      "><span class="st-num">${i + 1}</span></div>`;
      // Label
      timelineHtml += `<div class="st-label pg-enter" style="
        position:absolute;left:${cx - 100}px;top:${lineY + circleR + 24}px;
        width:200px;text-align:center;
        animation-delay:${0.35 + i * 0.18}s;
      ">${escHtml(step)}</div>`;
    });

    // Arrow indicator at end
    const lastX = startX + (count - 1) * stepGap;
    timelineHtml += `<div class="st-arrow-end pg-enter" style="
      position:absolute;left:${lastX + circleR + 16}px;top:${lineY - 8}px;
      animation-delay:${0.3 + (count - 1) * 0.18}s;
    "></div>`;

    // "..." indicator
    if (hasMore) {
      const dotX = startX + showSteps.length * stepGap;
      timelineHtml += `<div class="st-more pg-enter" style="
        position:absolute;left:${dotX - 30}px;top:${lineY - 20}px;
        animation-delay:${0.2 + showSteps.length * 0.18}s;
      ">...</div>`;
    }

    const html = `
${title ? `<div class="st-title pg-enter" style="position:absolute;left:50%;top:${SY + 40}px;transform:translateX(-50%)">${title}</div>` : ''}
<div class="st-timeline">
  ${timelineHtml}
</div>`;

    const css = `
/* ── step-timeline ── */
@keyframes stCircleIn {
  from { opacity: 0; transform: scale(0.5); }
  to   { opacity: 1; transform: scale(1); }
}
@keyframes stLineGrow {
  from { opacity: 0; transform: scaleX(0); transform-origin: left center; }
  to   { opacity: 1; transform: scaleX(1); }
}
@keyframes stFadeUp {
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
}
.st-title {
  font-family: var(--fx-font-title);
  font-size: ${FX_FONT_SCALE.subtitle}px;
  font-weight: 700;
  color: var(--fx-text);
  text-align: center;
  line-height: 1.2;
  white-space: nowrap;
  opacity: 0;
  animation: stFadeUp 0.5s ${EASE_PREMIUM} 0.1s both;
}
.st-band {
  background: linear-gradient(180deg, transparent, var(--fx-accent), transparent);
  opacity: 0.03;
  border-radius: 8px;
  pointer-events: none;
}
.st-outer-ring {
  border-radius: 50%;
  border: 2px solid var(--fx-accent);
  opacity: 0;
  animation: stCircleIn 0.5s ${EASE_PREMIUM} both;
}
.st-outer-ring { opacity: 0; }
.st-circle {
  border-radius: 50%;
  background: var(--fx-accent);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 20px rgba(0,0,0,0.2), 0 0 0 6px rgba(255,255,255,0.06);
  opacity: 0;
  animation: stCircleIn 0.5s ${EASE_PREMIUM} both;
}
.st-num {
  font-family: var(--fx-font-title);
  font-size: ${FX_FONT_SCALE.body}px;
  font-weight: 800;
  color: var(--fx-primary);
}
.st-line {
  background: linear-gradient(90deg, var(--fx-accent), var(--fx-accent));
  border-radius: 2px;
  opacity: 0;
  animation: stLineGrow 0.4s ${EASE_SMOOTH} both;
}
.st-arrow-start, .st-arrow-end {
  width: 0; height: 0;
  border-top: 8px solid transparent;
  border-bottom: 8px solid transparent;
  opacity: 0;
  animation: stFadeUp 0.3s ${EASE_PREMIUM} both;
}
.st-arrow-start {
  border-right: 12px solid var(--fx-accent);
  opacity: 0.3;
}
.st-arrow-end {
  border-left: 12px solid var(--fx-accent);
  opacity: 0.3;
}
.st-label {
  font-family: var(--fx-font-body);
  font-size: ${FX_FONT_SCALE.body}px;
  color: var(--fx-text);
  line-height: 1.6;
  opacity: 0;
  animation: stFadeUp 0.4s ${EASE_PREMIUM} both;
}
.st-more {
  font-family: var(--fx-font-title);
  font-size: ${FX_FONT_SCALE.subtitle}px;
  font-weight: 700;
  color: var(--fx-accent);
  opacity: 0;
  animation: stFadeUp 0.4s ${EASE_PREMIUM} both;
  letter-spacing: 6px;
}`;

    return { html, css };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// 5. code-explain — 代码讲解（知识）
// ═══════════════════════════════════════════════════════════════════════════════
//
// demoParams: {
//   code: 'function greet(name) {\n  const msg = `Hello, ${name}!`;\n  console.log(msg);\n  return msg;\n}',
//   items: ['函数声明：定义 greet 函数', '模板字符串：动态拼接文本', '控制台输出：打印结果', '返回值：将结果传回调用方'],
// }

const codeExplain: PageLayoutDef = {
  id: 'code-explain',
  label: '代码讲解',
  category: '知识',
  desc: '左侧代码块 + 右侧注解面板',
  zones: [
    { id: 'code',  type: 'body', bounds: { x: `${SX}px`, y: `${SY}px`, w: '55%', h: `${CH}px` } },
    { id: 'items', type: 'list', bounds: { x: '58%',      y: `${SY}px`, w: '38%', h: `${CH}px` } },
  ],

  render(params: PageParams, _style: StyleConfig) {
    const code = params.code ?? '';
    const items = (params.items ?? []).slice(0, 6);

    // Code with line numbers and alternating highlights
    const lines = String(code).split('\n');
    const codeLines = lines.map((line, i) => {
      const even = i % 2 === 0;
      return `<div class="ce-line ${even ? 'ce-line-alt' : ''}"><span class="ce-ln">${i + 1}</span><span class="ce-code">${escHtml(line)}</span></div>`;
    }).join('');

    // Explanation points with gradient badges
    const pointsHtml = items.map((text, i) =>
      `<div class="ce-point pg-enter" style="animation-delay:${0.4 + i * 0.15}s">
        <span class="ce-badge">${i + 1}</span>
        <span class="ce-desc">${escHtml(text)}</span>
      </div>`
    ).join('');

    const codeBlockLeft = SX;
    const codeBlockW = Math.floor(1920 * 0.55) - SX - 20;
    const explainLeft = Math.floor(1920 * 0.58);
    const explainW = 1920 - explainLeft - SX;

    const html = `
<!-- 代码块 -->
<div class="ce-code-block pg-enter" style="
  position:absolute;left:${codeBlockLeft}px;top:${SY}px;
  width:${codeBlockW}px;height:${CH}px;
">
  <!-- Terminal header bar -->
  <div class="ce-terminal-bar">
    <span class="ce-dot ce-dot-red"></span>
    <span class="ce-dot ce-dot-yellow"></span>
    <span class="ce-dot ce-dot-green"></span>
  </div>
  <div class="ce-scanline"></div>
  <div class="ce-code-inner">
    ${codeLines}
  </div>
</div>

<!-- 分割线 -->
<div class="ce-divider pg-enter pg-enter-d1" style="
  position:absolute;left:${explainLeft - 24}px;top:${SY + 40}px;
  width:2px;height:${CH - 80}px;
"></div>

<!-- 注解面板 -->
<div class="ce-explain" style="
  position:absolute;left:${explainLeft}px;top:${SY}px;
  width:${explainW}px;height:${CH}px;
">
  <div class="ce-explain-inner">
    ${pointsHtml}
  </div>
</div>`;

    const css = `
/* ── code-explain ── */
@keyframes ceSlideIn {
  from { opacity: 0; transform: translateX(-24px); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes ceFadeIn {
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes ceScan {
  from { top: 44px; }
  to   { top: 100%; }
}
@keyframes ceDivGrow {
  from { transform: scaleY(0); }
  to   { transform: scaleY(1); }
}
.ce-code-block {
  background: var(--fx-primary);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 8px 40px rgba(0,0,0,0.3), 0 2px 8px rgba(0,0,0,0.15);
  opacity: 0;
  animation: ceSlideIn 0.6s ${EASE_PREMIUM} 0.15s both;
}
.ce-terminal-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 20px;
  background: rgba(0,0,0,0.25);
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.ce-dot {
  display: inline-block;
  width: 12px; height: 12px;
  border-radius: 50%;
}
.ce-dot-red { background: #ff5f57; }
.ce-dot-yellow { background: #febc2e; }
.ce-dot-green { background: #28c840; }
.ce-scanline {
  position: absolute; left: 0; right: 0; top: 44px;
  height: 4px;
  background: linear-gradient(90deg, transparent, var(--fx-accent), transparent);
  opacity: 0.35;
  animation: ceScan 4s linear 1s infinite;
  pointer-events: none;
}
.ce-code-inner {
  padding: 24px 36px;
  overflow: hidden;
}
.ce-line {
  display: flex; gap: 20px;
  margin-bottom: 6px;
  white-space: pre;
  padding: 2px 8px;
  border-radius: 4px;
}
.ce-line-alt {
  background: rgba(255,255,255,0.02);
}
.ce-ln {
  font-family: var(--fx-font-body);
  font-size: ${FX_FONT_SCALE.caption}px;
  color: var(--fx-text);
  opacity: 0.3;
  min-width: 28px;
  text-align: right;
  user-select: none;
}
.ce-code {
  font-family: var(--fx-font-body);
  font-size: ${FX_FONT_SCALE.caption}px;
  color: var(--fx-text);
  line-height: 1.6;
  letter-spacing: 0.5px;
}
.ce-divider {
  background: var(--fx-accent);
  opacity: 0.3;
  transform-origin: top center;
  animation: ceDivGrow 0.5s ${EASE_SMOOTH} 0.3s both;
}
.ce-explain-inner {
  display: flex; flex-direction: column;
  justify-content: center;
  height: 100%;
  padding: 40px 24px;
  gap: 28px;
}
.ce-point {
  display: flex; align-items: flex-start; gap: 16px;
  opacity: 0;
  animation: ceFadeIn 0.45s ${EASE_PREMIUM} both;
}
.ce-badge {
  flex-shrink: 0;
  width: 36px; height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--fx-accent), var(--fx-accent2, var(--fx-accent)));
  color: var(--fx-primary);
  font-family: var(--fx-font-title);
  font-size: ${FX_FONT_SCALE.caption}px;
  font-weight: 800;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
}
.ce-desc {
  font-family: var(--fx-font-body);
  font-size: ${FX_FONT_SCALE.caption}px;
  color: var(--fx-text);
  line-height: 1.6;
  padding-top: 6px;
}`;

    return { html, css };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// 6. brand-statement — 品牌宣言（品牌）
// ═══════════════════════════════════════════════════════════════════════════════
//
// demoParams: {
//   title: '重新定义可能',
//   subtitle: 'REDEFINE THE POSSIBLE',
// }

const brandStatement: PageLayoutDef = {
  id: 'brand-statement',
  label: '品牌宣言',
  category: '品牌',
  desc: '全屏戏剧化品牌宣言 — 大字居中 + 细线点缀',
  zones: [
    { id: 'title',    type: 'title',    bounds: { x: `${SX}px`, y: '300px', w: `${CW}px`, h: '200px' } },
    { id: 'subtitle', type: 'subtitle', bounds: { x: `${SX}px`, y: '560px', w: `${CW}px`, h: '60px' }, optional: true },
  ],

  render(params: PageParams, _style: StyleConfig) {
    const title = escHtml(params.title ?? '');
    const subtitle = escHtml(params.subtitle ?? '');

    const html = `
<!-- 暗角效果 -->
<div class="bs-vignette"></div>

<!-- 底部渐变 -->
<div class="bs-gradient"></div>

<!-- 上下 letterbox 条 -->
<div class="bs-letterbox-top"></div>
<div class="bs-letterbox-bottom"></div>

<!-- 装饰菱形 -->
<div class="bs-diamond pg-enter"></div>

<!-- 主标题 -->
<div class="bs-title pg-enter">${title}</div>

<!-- 分割细线 -->
<div class="bs-line pg-enter pg-enter-d1"></div>

<!-- 副标题 -->
${subtitle ? `<div class="bs-subtitle pg-enter pg-enter-d2">${subtitle}</div>` : ''}`;

    const css = `
/* ── brand-statement ── */
@keyframes bsFadeUp {
  from { opacity: 0; transform: translate(-50%, 12px); }
  to   { opacity: 1; transform: translate(-50%, 0); }
}
@keyframes bsLineGrow {
  from { width: 0; }
  to   { width: 120px; }
}
@keyframes bsGradient {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes bsDiamondIn {
  from { opacity: 0; transform: translate(-50%, 0) rotate(45deg) scale(0.5); }
  to   { opacity: 1; transform: translate(-50%, 0) rotate(45deg) scale(1); }
}
.bs-vignette {
  position: absolute; inset: 0;
  background: radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.4) 100%);
  pointer-events: none;
}
.bs-gradient {
  position: absolute; inset: 0;
  background: linear-gradient(
    to top,
    var(--fx-primary) 0%,
    transparent 50%
  );
  opacity: 0;
  animation: bsGradient 1.2s ${EASE_SMOOTH} 0.2s both;
  pointer-events: none;
}
.bs-letterbox-top {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 40px;
  background: rgba(0,0,0,0.5);
  pointer-events: none;
}
.bs-letterbox-bottom {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 40px;
  background: rgba(0,0,0,0.5);
  pointer-events: none;
}
.bs-diamond {
  position: absolute;
  left: 50%; top: calc(50% - 100px);
  transform: translate(-50%, 0) rotate(45deg);
  width: 14px; height: 14px;
  border: 2px solid var(--fx-accent);
  opacity: 0;
  animation: bsDiamondIn 0.6s ${EASE_PREMIUM} 0.15s both;
}
.bs-title {
  position: absolute;
  left: 50%; top: 50%;
  transform: translate(-50%, -24px);
  font-family: var(--fx-font-title);
  font-size: ${FX_FONT_SCALE.display}px;
  font-weight: 900;
  color: var(--fx-text);
  text-align: center;
  line-height: 1.1;
  letter-spacing: 16px;
  white-space: nowrap;
  opacity: 0;
  animation: bsFadeUp 0.8s ${EASE_PREMIUM} 0.3s both;
}
.bs-line {
  position: absolute;
  left: 50%; top: calc(50% + 70px);
  transform: translateX(-50%);
  height: 3px;
  background: linear-gradient(90deg, transparent, var(--fx-accent), transparent);
  border-radius: 2px;
  width: 0;
  animation: bsLineGrow 0.6s ${EASE_SMOOTH} 0.8s both;
}
.bs-subtitle {
  position: absolute;
  left: 50%; top: calc(50% + 100px);
  transform: translate(-50%, 0);
  font-family: var(--fx-font-body);
  font-size: ${FX_FONT_SCALE.caption}px;
  color: var(--fx-text);
  opacity: 0;
  text-align: center;
  letter-spacing: 8px;
  line-height: 1.6;
  animation: bsFadeUp 0.8s ${EASE_PREMIUM} 1.1s both;
}
.pg-enter-d1 { animation-delay: 0.8s; }
.pg-enter-d2 { animation-delay: 1.1s; }`;

    return { html, css };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// 7. data-dashboard — 数据大屏（品牌）
// ═══════════════════════════════════════════════════════════════════════════════
//
// demoParams: {
//   title: '年度运营数据总览',
//   subtitle: '较去年同期整体增长 32%，各项指标均达成目标',
//   stats: [
//     { value: '1.2亿', label: '总营收' },
//     { value: '860万', label: '活跃用户' },
//     { value: '99.9%', label: '可用性' },
//     { value: '128%', label: '增长率' },
//     { value: '4.8', label: '用户评分' },
//     { value: '50+', label: '合作伙伴' },
//   ],
// }

const dataDashboard: PageLayoutDef = {
  id: 'data-dashboard',
  label: '数据大屏',
  category: '品牌',
  desc: 'KPI 卡片网格 + 标题 + 底部摘要',
  zones: [
    { id: 'title',    type: 'title',    bounds: { x: `${SX}px`, y: `${SY}px`, w: `${CW}px`, h: '80px' } },
    { id: 'stats',    type: 'data',     bounds: { x: `${SX}px`, y: '200px', w: `${CW}px`, h: '600px' } },
    { id: 'subtitle', type: 'subtitle', bounds: { x: `${SX}px`, y: '860px', w: `${CW}px`, h: '60px' }, optional: true },
  ],

  render(params: PageParams, _style: StyleConfig) {
    const title = escHtml(params.title ?? '');
    const subtitle = escHtml(params.subtitle ?? '');
    const stats = (params.stats ?? []).slice(0, 6);

    // Grid: 3 columns (or 2 if <= 4 items)
    const cols = stats.length <= 4 ? 2 : 3;
    const rows = Math.ceil(stats.length / cols);
    const cardW = Math.floor((CW - (cols - 1) * 32) / cols);
    const cardH = Math.min(220, Math.floor((600 - (rows - 1) * 28) / rows));
    const gridTop = 200;

    // Row dividers between card rows
    let dividersHtml = '';
    for (let r = 1; r < rows; r++) {
      const divY = gridTop + r * (cardH + 28) - 14;
      dividersHtml += `<div class="dd-row-divider" style="
        position:absolute;left:${SX + 20}px;top:${divY}px;
        width:${CW - 40}px;height:1px;
      "></div>`;
    }

    const cardsHtml = stats.map((stat, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = SX + col * (cardW + 32);
      const y = gridTop + row * (cardH + 28);

      return `<div class="dd-card pg-card pg-enter" style="
        position:absolute;left:${x}px;top:${y}px;
        width:${cardW}px;height:${cardH}px;
        animation-delay:${0.2 + i * 0.12}s;
      ">
        <div class="dd-card-top-border"></div>
        <div class="dd-value-row">
          <span class="dd-value">${escHtml(stat.value)}</span>
          <span class="dd-trend-dot"></span>
        </div>
        <div class="dd-label">${escHtml(stat.label)}</div>
      </div>`;
    }).join('\n');

    // Progress bar at bottom
    const barTop = gridTop + rows * (cardH + 28) + 40;

    const html = `
<!-- 背景网格 -->
<div class="dd-grid-bg"></div>

<!-- 标题 -->
<div class="dd-title pg-enter" style="position:absolute;left:${SX}px;top:${SY + 20}px">${title}</div>

<!-- 行分割线 -->
${dividersHtml}

<!-- KPI 卡片 -->
${cardsHtml}

<!-- 底部摘要条 -->
${subtitle ? `<div class="dd-summary pg-enter" style="
  position:absolute;left:${SX}px;top:${barTop}px;width:${CW}px;
  animation-delay:${0.2 + stats.length * 0.12 + 0.15}s;
">
  <div class="dd-bar-track">
    <div class="dd-bar-fill">
      <div class="dd-bar-shimmer"></div>
    </div>
  </div>
  <div class="dd-summary-text">${subtitle}</div>
</div>` : ''}`;

    const css = `
/* ── data-dashboard ── */
@keyframes ddFadeUp {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes ddBarGrow {
  from { width: 0; }
  to   { width: 100%; }
}
@keyframes ddPulse {
  0%, 100% { box-shadow: 0 4px 20px rgba(0,0,0,0.12), 0 1px 6px rgba(0,0,0,0.08); }
  50% { box-shadow: 0 6px 28px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.12); }
}
@keyframes ddShimmer {
  0% { left: -40%; }
  100% { left: 140%; }
}
.dd-grid-bg {
  position: absolute; inset: 0;
  background-image:
    linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px);
  background-size: 80px 80px;
  pointer-events: none;
}
.dd-title {
  font-family: var(--fx-font-title);
  font-size: ${FX_FONT_SCALE.subtitle}px;
  font-weight: 700;
  color: var(--fx-text);
  line-height: 1.2;
  opacity: 0;
  animation: ddFadeUp 0.5s ${EASE_PREMIUM} 0.1s both;
}
.dd-row-divider {
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent);
  pointer-events: none;
}
.dd-card {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: 24px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.12), 0 1px 6px rgba(0,0,0,0.08);
  opacity: 0;
  animation: ddFadeUp 0.5s ${EASE_PREMIUM} both, ddPulse 4s ${EASE_SMOOTH} 1.5s infinite;
  position: relative;
  overflow: hidden;
}
.dd-card-top-border {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, var(--fx-accent), var(--fx-accent2, var(--fx-accent)));
  opacity: 0.8;
}
.dd-value-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.dd-value {
  font-family: var(--fx-font-title);
  font-size: ${FX_FONT_SCALE.title}px;
  font-weight: 900;
  color: var(--fx-accent);
  line-height: 1.2;
  margin-bottom: 12px;
}
.dd-trend-dot {
  display: inline-block;
  width: 8px; height: 8px;
  border-radius: 50%;
  background: #28c840;
  margin-bottom: 12px;
  box-shadow: 0 0 6px rgba(40,200,64,0.4);
}
.dd-label {
  font-family: var(--fx-font-body);
  font-size: ${FX_FONT_SCALE.caption}px;
  color: var(--fx-text);
  opacity: 0.55;
  letter-spacing: 2px;
  line-height: 1.6;
}
.dd-summary {
  opacity: 0;
  animation: ddFadeUp 0.5s ${EASE_PREMIUM} both;
}
.dd-bar-track {
  width: 100%; height: 6px;
  background: rgba(255,255,255,0.08);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 16px;
}
.dd-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--fx-accent), var(--fx-accent2, var(--fx-accent)));
  border-radius: 3px;
  width: 0;
  animation: ddBarGrow 1s ${EASE_SMOOTH} 1.2s both;
  position: relative;
  overflow: hidden;
}
.dd-bar-shimmer {
  position: absolute;
  top: 0; left: -40%;
  width: 40%; height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent);
  animation: ddShimmer 2s ${EASE_SMOOTH} 2.2s infinite;
}
.dd-summary-text {
  font-family: var(--fx-font-body);
  font-size: ${FX_FONT_SCALE.caption}px;
  color: var(--fx-text);
  opacity: 0.6;
  text-align: center;
  line-height: 1.6;
}`;

    return { html, css };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// 导出
// ═══════════════════════════════════════════════════════════════════════════════

export const SPECIAL_LAYOUTS: PageLayoutDef[] = [
  // 电商 (3)
  productShowcase,
  compareGrid,
  promoBanner,
  // 知识 (2)
  stepTimeline,
  codeExplain,
  // 品牌 (2)
  brandStatement,
  dataDashboard,
];
