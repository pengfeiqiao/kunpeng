/**
 * fxComponentsExt2 — 组件库扩充包 2（20 款，覆盖数据增强 / 口播增强 /
 * 电商增强 / 品牌增强 / 氛围增强五大场景）。
 * 与 fxComponents.ts / fxComponentsExt.ts 同管线：html2canvas 安全 CSS 子集 +
 * CSS @keyframes + fxDesignSystem token。
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

// ── 数据增强 ─────────────────────────────────────────────────────────────────

const gaugeMeter: FxComponentDef = {
  id: 'gauge-meter',
  label: '仪表盘',
  category: '数据',
  paramsDoc: '{ value: number(0-100), label?: string }',
  render(params, themeId) {
    const value = Math.max(0, Math.min(100, Number(params.value) || 0));
    const label = esc(params.label ?? '');
    // Semi-circle gauge: 180° arc, R=120, cx=160, cy=160
    const R = 120;
    const C = Math.PI * R; // half-circle circumference
    const offset = C * (1 - value / 100);
    // Pointer angle: -180 (0%) to 0 (100%)
    const angle = -180 + (value / 100) * 180;
    return {
      html: root(themeId, `<div class="gm-wrap"><svg width="340" height="200" viewBox="0 0 340 200"><circle cx="170" cy="170" r="${R}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="22" stroke-dasharray="${C.toFixed(1)} ${C.toFixed(1)}" stroke-linecap="round" transform="rotate(-180 170 170)"/><circle class="gm-arc" cx="170" cy="170" r="${R}" fill="none" stroke="var(--fx-accent)" stroke-width="22" stroke-dasharray="${C.toFixed(1)} ${C.toFixed(1)}" stroke-dashoffset="${C.toFixed(1)}" stroke-linecap="round" style="--off:${offset.toFixed(1)}" transform="rotate(-180 170 170)"/><line class="gm-ptr" x1="170" y1="170" x2="170" y2="60" stroke="var(--fx-text)" stroke-width="4" stroke-linecap="round" style="--angle:${angle}deg" transform="rotate(${angle} 170 170)"/></svg><div class="gm-val">${value}</div>${label ? `<div class="gm-label">${label}</div>` : ''}</div>`),
      css: `
.gm-wrap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;animation:gmIn .5s var(--fx-ease-enter) both}
.gm-arc{animation:gmDraw 1.1s var(--fx-ease-enter) .2s both}
@keyframes gmDraw{to{stroke-dashoffset:var(--off)}}
.gm-ptr{transform-origin:170px 170px;animation:gmPtr 1.1s var(--fx-ease-enter) .2s both}
@keyframes gmPtr{from{transform:rotate(-180deg)}to{transform:rotate(var(--angle))}}
.gm-val{margin-top:-30px;font-size:${FX_FONT_SCALE.title}px;font-weight:800;color:var(--fx-accent)}
.gm-label{margin-top:8px;font-size:${FX_FONT_SCALE.body}px;color:var(--fx-text);opacity:.85}
@keyframes gmIn{from{opacity:0;transform:translate(-50%,-46%) scale(.92)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}`,
    };
  },
};

const funnelChart: FxComponentDef = {
  id: 'funnel-chart',
  label: '漏斗图',
  category: '数据',
  paramsDoc: '{ stages: {label:string, value:number}[](≤4) }',
  render(params, themeId) {
    const stages = (Array.isArray(params.stages) ? params.stages : []).slice(0, 4) as { label?: string; value?: number }[];
    const maxV = Math.max(...stages.map((s) => Number(s.value) || 0), 1);
    const rows = stages.map((s, i) => {
      const pct = Math.max(30, Math.round(((Number(s.value) || 0) / maxV) * 100));
      return `<div class="fn-stage" style="width:${pct}%;animation-delay:${0.2 + i * 0.18}s"><span class="fn-label">${esc(s.label)}</span><span class="fn-badge">${esc(s.value)}</span></div>`;
    }).join('');
    return {
      html: root(themeId, `<div class="fn-wrap">${rows}</div>`),
      css: `
.fn-wrap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:12px}
.fn-stage{display:flex;justify-content:space-between;align-items:center;padding:18px 28px;background:var(--fx-accent);border-radius:14px;opacity:0;animation:fnIn .5s var(--fx-ease-enter) both;animation-delay:inherit}
.fn-label{font-size:${FX_FONT_SCALE.body}px;font-weight:700;color:#111}
.fn-badge{font-size:${FX_FONT_SCALE.caption}px;font-weight:800;color:#111;background:rgba(0,0,0,0.15);padding:4px 14px;border-radius:999px}
@keyframes fnIn{from{opacity:0;transform:translateY(18px) scaleX(.8)}to{opacity:1;transform:none}}`,
    };
  },
};

const pieChart: FxComponentDef = {
  id: 'pie-chart',
  label: '饼图',
  category: '数据',
  paramsDoc: '{ segments: {label:string, value:number, color?:string}[](≤5), title?: string }',
  render(params, themeId) {
    const segments = (Array.isArray(params.segments) ? params.segments : []).slice(0, 5) as { label?: string; value?: number; color?: string }[];
    const title = esc(params.title ?? '');
    const total = segments.reduce((a, s) => a + (Number(s.value) || 0), 0) || 1;
    const R = 100;
    const C = 2 * Math.PI * R;
    const paletteColors = ['var(--fx-accent)', 'var(--fx-accent2)', 'rgba(255,255,255,0.35)', 'rgba(255,255,255,0.2)', 'rgba(255,255,255,0.12)'];
    let cumOffset = 0;
    const arcs = segments.map((s, i) => {
      const frac = (Number(s.value) || 0) / total;
      const dash = frac * C;
      const gap = C - dash;
      const rot = cumOffset * 360 - 90;
      cumOffset += frac;
      const color = paletteColors[i % paletteColors.length];
      return `<circle cx="140" cy="140" r="${R}" fill="none" stroke="${color}" stroke-width="60" stroke-dasharray="${dash.toFixed(1)} ${gap.toFixed(1)}" transform="rotate(${rot.toFixed(1)} 140 140)" class="pc-seg" style="animation-delay:${0.2 + i * 0.12}s"/>`;
    }).join('');
    const legend = segments.map((s, i) => {
      const color = paletteColors[i % paletteColors.length];
      return `<span class="pc-leg" style="animation-delay:${0.5 + i * 0.1}s"><span class="pc-dot" style="background:${color}"></span>${esc(s.label)}</span>`;
    }).join('');
    return {
      html: root(themeId, `<div class="pc-wrap">${title ? `<div class="pc-title">${title}</div>` : ''}<svg width="280" height="280" viewBox="0 0 280 280">${arcs}</svg><div class="pc-legend">${legend}</div></div>`),
      css: `
.pc-wrap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;animation:pcIn .5s var(--fx-ease-enter) both}
.pc-title{font-size:${FX_FONT_SCALE.subtitle}px;font-weight:700;color:var(--fx-text);margin-bottom:20px}
.pc-seg{opacity:0;animation:pcSeg .6s var(--fx-ease-enter) both;animation-delay:inherit}
@keyframes pcSeg{from{opacity:0;transform:scale(.85)}to{opacity:1;transform:scale(1)}}
.pc-legend{display:flex;gap:20px;justify-content:center;margin-top:20px;flex-wrap:wrap}
.pc-leg{display:flex;align-items:center;gap:6px;font-size:${FX_FONT_SCALE.caption}px;color:var(--fx-text);opacity:0;animation:pcLeg .4s var(--fx-ease-enter) both;animation-delay:inherit}
.pc-dot{width:12px;height:12px;border-radius:50%;flex:none}
@keyframes pcLeg{to{opacity:1}}
@keyframes pcIn{from{opacity:0;transform:translate(-50%,-46%)}to{opacity:1;transform:translate(-50%,-50%)}}`,
    };
  },
};

const statGrid: FxComponentDef = {
  id: 'stat-grid',
  label: '数据矩阵',
  category: '数据',
  paramsDoc: '{ stats: {value:string, label:string}[](≤6) }',
  render(params, themeId) {
    const stats = (Array.isArray(params.stats) ? params.stats : []).slice(0, 6) as { value?: string; label?: string }[];
    const cols = stats.length <= 4 ? 2 : 3;
    const cards = stats.map((s, i) =>
      `<div class="sg-card" style="animation-delay:${0.15 + i * 0.12}s"><div class="sg-val">${esc(s.value)}</div><div class="sg-lab">${esc(s.label)}</div></div>`,
    ).join('');
    return {
      html: root(themeId, `<div class="sg-wrap" style="grid-template-columns:repeat(${cols},1fr)">${cards}</div>`),
      css: `
.sg-wrap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:grid;gap:20px;animation:sgIn .4s var(--fx-ease-enter) both}
.sg-card{padding:32px 36px;background:var(--fx-surface);border-radius:18px;text-align:center;opacity:0;animation:sgUp .45s var(--fx-ease-enter) both;animation-delay:inherit}
.sg-val{font-size:${FX_FONT_SCALE.title}px;font-weight:800;color:var(--fx-accent)}
.sg-lab{margin-top:8px;font-size:${FX_FONT_SCALE.caption}px;color:var(--fx-text);opacity:.75}
@keyframes sgUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}
@keyframes sgIn{from{opacity:0}to{opacity:1}}`,
    };
  },
};

// ── 口播增强 ─────────────────────────────────────────────────────────────────

const topicIntro: FxComponentDef = {
  id: 'topic-intro',
  label: '话题引入',
  category: '口播',
  paramsDoc: '{ topic: string, description?: string }',
  render(params, themeId) {
    const topic = esc(params.topic ?? '');
    const desc = esc(params.description ?? '');
    return {
      html: root(themeId, `<div class="ti-wrap"><span class="ti-mark">#</span><div class="ti-body"><div class="ti-topic">${topic}</div>${desc ? `<div class="ti-desc">${desc}</div>` : ''}</div></div>`),
      css: `
.ti-wrap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;align-items:flex-start;gap:24px;max-width:900px;animation:tiIn .4s var(--fx-ease-enter) both}
.ti-mark{font-size:${FX_FONT_SCALE.display}px;font-weight:900;color:var(--fx-accent);line-height:1;animation:tiBounce .6s var(--fx-ease-enter) both}
@keyframes tiBounce{from{opacity:0;transform:scale(.4) rotate(-12deg)}60%{transform:scale(1.1) rotate(3deg)}to{opacity:1;transform:none}}
.ti-topic{font-size:${FX_FONT_SCALE.subtitle}px;font-weight:700;color:var(--fx-text);animation:tiSlide .5s var(--fx-ease-enter) .2s both;opacity:0}
.ti-desc{margin-top:12px;font-size:${FX_FONT_SCALE.body}px;color:var(--fx-text);opacity:0;animation:tiSlide .5s var(--fx-ease-enter) .35s both}
@keyframes tiSlide{from{opacity:0;transform:translateX(20px)}to{opacity:.85;transform:none}}
@keyframes tiIn{from{opacity:0;transform:translate(-50%,-46%)}to{opacity:1;transform:translate(-50%,-50%)}}`,
    };
  },
};

const reactionMeter: FxComponentDef = {
  id: 'reaction-meter',
  label: '反应量表',
  category: '口播',
  paramsDoc: '{ reactions: {emoji:string, label:string, value:number}[](≤3) }',
  render(params, themeId) {
    const reactions = (Array.isArray(params.reactions) ? params.reactions : []).slice(0, 3) as { emoji?: string; label?: string; value?: number }[];
    const rows = reactions.map((r, i) => {
      const pct = Math.max(0, Math.min(100, Number(r.value) || 0));
      return `<div class="rm-row" style="animation-delay:${0.2 + i * 0.2}s"><span class="rm-emoji">${esc(r.emoji)}</span><span class="rm-label">${esc(r.label)}</span><span class="rm-track"><span class="rm-fill" style="--w:${pct}%;animation-delay:${0.4 + i * 0.2}s"></span></span><span class="rm-pct">${pct}%</span></div>`;
    }).join('');
    return {
      html: root(themeId, `<div class="rm-wrap">${rows}</div>`),
      css: `
.rm-wrap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:700px;animation:rmIn .4s var(--fx-ease-enter) both}
.rm-row{display:flex;align-items:center;gap:14px;margin-bottom:22px;opacity:0;animation:rmRow .45s var(--fx-ease-enter) both;animation-delay:inherit}
.rm-emoji{font-size:${FX_FONT_SCALE.subtitle}px;flex:none}
.rm-label{font-size:${FX_FONT_SCALE.body}px;color:var(--fx-text);min-width:80px}
.rm-track{flex:1;height:28px;background:rgba(255,255,255,0.08);border-radius:14px;overflow:hidden}
.rm-fill{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--fx-accent),var(--fx-accent2));border-radius:14px;animation:rmFill .7s var(--fx-ease-enter) both;animation-delay:inherit}
@keyframes rmFill{to{width:var(--w)}}
.rm-pct{font-size:${FX_FONT_SCALE.caption}px;color:var(--fx-accent);font-weight:700;min-width:50px;text-align:right}
@keyframes rmRow{from{opacity:0;transform:translateX(-16px)}to{opacity:1;transform:none}}
@keyframes rmIn{from{opacity:0;transform:translate(-50%,-46%)}to{opacity:1;transform:translate(-50%,-50%)}}`,
    };
  },
};

const subscribeCard: FxComponentDef = {
  id: 'subscribe-card',
  label: '关注引导',
  category: '口播',
  paramsDoc: '{ name: string, title?: string, cta?: string }',
  render(params, themeId) {
    const name = esc(params.name ?? '');
    const title = esc(params.title ?? '');
    const cta = esc(params.cta ?? '关注');
    return {
      html: root(themeId, `<div class="sub-card"><div class="sub-info"><div class="sub-name">${name}</div>${title ? `<div class="sub-title">${title}</div>` : ''}</div><div class="sub-btn">${cta}</div></div>`),
      css: `
.sub-card{position:absolute;left:50%;bottom:14%;transform:translateX(-50%);display:flex;align-items:center;gap:28px;padding:28px 40px;background:var(--fx-surface);border-radius:22px;animation:subIn .55s var(--fx-ease-enter) both}
@keyframes subIn{from{opacity:0;transform:translateX(-50%) translateY(30px)}60%{transform:translateX(-50%) translateY(-4px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
.sub-info{display:flex;flex-direction:column;gap:4px}
.sub-name{font-size:${FX_FONT_SCALE.subtitle}px;font-weight:800;color:var(--fx-text)}
.sub-title{font-size:${FX_FONT_SCALE.caption}px;color:var(--fx-text);opacity:.65}
.sub-btn{padding:14px 36px;border-radius:999px;background:var(--fx-accent);color:#111;font-size:${FX_FONT_SCALE.body}px;font-weight:800;white-space:nowrap;animation:subBtn .4s var(--fx-ease-enter) .35s both}
@keyframes subBtn{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:scale(1)}}`,
    };
  },
};

const chapterNav: FxComponentDef = {
  id: 'chapter-nav',
  label: '章节导航',
  category: '口播',
  paramsDoc: '{ chapters: string[](≤5), current: number }',
  render(params, themeId) {
    const chapters = arr(params.chapters, 5);
    const current = Math.max(0, Math.min(chapters.length - 1, Number(params.current) || 0));
    const pills = chapters.map((ch, i) => {
      const active = i === current;
      return `<div class="cn-pill ${active ? 'cn-active' : ''}" style="animation-delay:${0.15 + i * 0.1}s">${esc(ch)}</div>`;
    }).join('');
    // Progress line segments
    const lines = chapters.length > 1 ? chapters.slice(0, -1).map((_, i) =>
      `<div class="cn-line ${i < current ? 'cn-done' : ''}" style="animation-delay:${0.3 + i * 0.1}s"></div>`,
    ).join('') : '';
    return {
      html: root(themeId, `<div class="cn-wrap">${pills.split('</div>').filter(Boolean).map((p, i) => p + '</div>' + (i < chapters.length - 1 && lines ? lines.split('</div>').filter(Boolean)[i] + '</div>' : '')).join('')}</div>`),
      css: `
.cn-wrap{position:absolute;left:50%;bottom:12%;transform:translateX(-50%);display:flex;align-items:center;gap:0;animation:cnIn .4s var(--fx-ease-enter) both}
.cn-pill{padding:10px 22px;border-radius:999px;background:var(--fx-surface);font-size:${FX_FONT_SCALE.caption}px;color:var(--fx-text);opacity:.5;white-space:nowrap;animation:cnPill .4s var(--fx-ease-enter) both;animation-delay:inherit}
.cn-active{background:var(--fx-accent);color:#111;font-weight:800;opacity:1;animation:cnPulse 1.5s var(--fx-ease-pulse) .5s infinite alternate,cnPill .4s var(--fx-ease-enter) both}
@keyframes cnPulse{from{transform:scale(1)}to{transform:scale(1.06)}}
.cn-line{width:36px;height:3px;background:rgba(255,255,255,0.12);animation:cnLine .3s var(--fx-ease-enter) both;animation-delay:inherit}
.cn-done{background:var(--fx-accent)}
@keyframes cnPill{from{opacity:0;transform:scale(.7)}to{opacity:.5;transform:scale(1)}}
@keyframes cnLine{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes cnIn{from{opacity:0}to{opacity:1}}`,
    };
  },
};

// ── 电商增强 ─────────────────────────────────────────────────────────────────

const starRating: FxComponentDef = {
  id: 'star-rating',
  label: '星级评分',
  category: '产品',
  paramsDoc: '{ rating: number(0-5), total?: number, label?: string }',
  render(params, themeId) {
    const rating = Math.max(0, Math.min(5, Number(params.rating) || 0));
    const total = params.total != null ? esc(params.total) : '';
    const label = esc(params.label ?? '');
    const stars = Array.from({ length: 5 }, (_, i) => {
      const filled = i < Math.round(rating);
      return `<span class="sr-star ${filled ? 'sr-filled' : ''}" style="animation-delay:${0.2 + i * 0.15}s">★</span>`;
    }).join('');
    return {
      html: root(themeId, `<div class="sr-wrap"><div class="sr-stars">${stars}</div><div class="sr-info">${total ? `<span class="sr-total">${total} 条评价</span>` : ''}${label ? `<span class="sr-label">${label}</span>` : ''}</div></div>`),
      css: `
.sr-wrap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;animation:srIn .4s var(--fx-ease-enter) both}
.sr-stars{display:flex;gap:10px;justify-content:center}
.sr-star{font-size:${FX_FONT_SCALE.title}px;color:rgba(255,255,255,0.18);transform:scale(0);animation:srPop .4s var(--fx-ease-enter) both;animation-delay:inherit}
.sr-filled{color:var(--fx-accent)}
@keyframes srPop{from{opacity:0;transform:scale(0) rotate(-30deg)}60%{transform:scale(1.15) rotate(5deg)}to{opacity:1;transform:scale(1) rotate(0)}}
.sr-info{margin-top:18px;display:flex;gap:16px;justify-content:center;font-size:${FX_FONT_SCALE.body}px;color:var(--fx-text);opacity:.75;animation:srFade .4s .9s both}
.sr-total{font-weight:600}
.sr-label{opacity:.65}
@keyframes srFade{from{opacity:0}to{opacity:.75}}
@keyframes srIn{from{opacity:0;transform:translate(-50%,-46%)}to{opacity:1;transform:translate(-50%,-50%)}}`,
    };
  },
};

const couponCard: FxComponentDef = {
  id: 'coupon-card',
  label: '优惠券',
  category: '产品',
  paramsDoc: '{ discount: string(如"50元"), code?: string, note?: string }',
  render(params, themeId) {
    const discount = esc(params.discount ?? '');
    const code = esc(params.code ?? '');
    const note = esc(params.note ?? '');
    return {
      html: root(themeId, `<div class="cp2-wrap"><div class="cp2-left"><div class="cp2-disc">${discount}</div><div class="cp2-off">优惠</div></div><div class="cp2-divider"></div><div class="cp2-right">${code ? `<div class="cp2-code">${code}</div>` : ''}${note ? `<div class="cp2-note">${note}</div>` : ''}</div></div>`),
      css: `
.cp2-wrap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;align-items:stretch;background:var(--fx-surface);border-radius:22px;overflow:hidden;animation:cp2In .5s var(--fx-ease-enter) both;clip-path:polygon(0 0,100% 0,100% 38%,96% 42%,100% 46%,100% 54%,96% 58%,100% 62%,100% 100%,0 100%,0 62%,4% 58%,0 54%,0 46%,4% 42%,0 38%)}
@keyframes cp2In{from{opacity:0;transform:translate(-50%,-50%) scale(.7)}60%{transform:translate(-50%,-50%) scale(1.04)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
.cp2-left{padding:36px 44px;text-align:center;display:flex;flex-direction:column;justify-content:center;gap:4px}
.cp2-disc{font-size:${FX_FONT_SCALE.display}px;font-weight:800;color:var(--fx-accent);line-height:1}
.cp2-off{font-size:${FX_FONT_SCALE.caption}px;color:var(--fx-accent);font-weight:700}
.cp2-divider{width:2px;border-left:2px dashed rgba(255,255,255,0.15);margin:18px 0}
.cp2-right{padding:36px 44px;display:flex;flex-direction:column;justify-content:center;gap:12px}
.cp2-code{font-size:${FX_FONT_SCALE.body}px;font-family:monospace;color:var(--fx-text);letter-spacing:2px;padding:8px 18px;background:rgba(255,255,255,0.06);border-radius:8px}
.cp2-note{font-size:${FX_FONT_SCALE.caption}px;color:var(--fx-text);opacity:.6}`,
    };
  },
};

const shippingInfo: FxComponentDef = {
  id: 'shipping-info',
  label: '物流信息',
  category: '产品',
  paramsDoc: '{ items: {icon:string, text:string}[](≤3) }',
  render(params, themeId) {
    const items = (Array.isArray(params.items) ? params.items : []).slice(0, 3) as { icon?: string; text?: string }[];
    const cells = items.map((item, i) =>
      `<div class="si-cell" style="animation-delay:${0.3 + i * 0.15}s"><span class="si-icon">${esc(item.icon)}</span><span class="si-text">${esc(item.text)}</span></div>`,
    ).join('');
    return {
      html: root(themeId, `<div class="si-bar">${cells}</div>`),
      css: `
.si-bar{position:absolute;left:8%;right:8%;bottom:10%;display:flex;justify-content:center;gap:40px;padding:20px 36px;background:var(--fx-surface);border-radius:16px;border-top:3px solid var(--fx-accent);animation:siIn .5s var(--fx-ease-enter) both}
@keyframes siIn{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}
.si-cell{display:flex;align-items:center;gap:10px;opacity:0;animation:siCell .4s var(--fx-ease-enter) both;animation-delay:inherit}
.si-icon{font-size:${FX_FONT_SCALE.body}px}
.si-text{font-size:${FX_FONT_SCALE.caption}px;color:var(--fx-text);white-space:nowrap}
@keyframes siCell{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}`,
    };
  },
};

const socialProof: FxComponentDef = {
  id: 'social-proof',
  label: '社会认证',
  category: '产品',
  paramsDoc: '{ count: string, label?: string(默认"人已购买") }',
  render(params, themeId) {
    const count = esc(params.count ?? '0');
    const label = esc(params.label ?? '人已购买');
    return {
      html: root(themeId, `<div class="sp-wrap"><span class="sp-dot"></span><span class="sp-pre">已有</span><span class="sp-count">${count}</span><span class="sp-label">${label}</span></div>`),
      css: `
.sp-wrap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;align-items:baseline;gap:10px;padding:20px 40px;background:var(--fx-surface);border-radius:999px;animation:spIn .5s var(--fx-ease-enter) both}
.sp-dot{width:10px;height:10px;border-radius:50%;background:var(--fx-accent);flex:none;align-self:center;animation:spPulse 1.2s var(--fx-ease-pulse) .5s infinite alternate}
@keyframes spPulse{from{transform:scale(1);opacity:.8}to{transform:scale(1.3);opacity:1}}
.sp-pre{font-size:${FX_FONT_SCALE.body}px;color:var(--fx-text);opacity:.75}
.sp-count{font-size:${FX_FONT_SCALE.title}px;font-weight:800;color:var(--fx-accent);animation:spCount .6s var(--fx-ease-enter) .2s both}
@keyframes spCount{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.sp-label{font-size:${FX_FONT_SCALE.body}px;color:var(--fx-text);opacity:.75}
@keyframes spIn{from{opacity:0;transform:translate(-50%,-50%) scale(.85)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}`,
    };
  },
};

// ── 品牌增强 ─────────────────────────────────────────────────────────────────

const logoReveal: FxComponentDef = {
  id: 'logo-reveal',
  label: 'Logo揭示',
  category: '标题',
  paramsDoc: '{ text: string(品牌名), tagline?: string }',
  render(params, themeId) {
    const text = esc(params.text ?? '');
    const tagline = esc(params.tagline ?? '');
    return {
      html: root(themeId, `<div class="lr-wrap"><div class="lr-text">${text}</div>${tagline ? `<div class="lr-tag">${tagline}</div>` : ''}</div>`),
      css: `
.lr-wrap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center}
.lr-text{font-size:${FX_FONT_SCALE.display}px;font-weight:900;color:var(--fx-text);letter-spacing:8px;clip-path:inset(0 100% 0 0);animation:lrWipe .8s var(--fx-ease-enter) .2s both}
@keyframes lrWipe{to{clip-path:inset(0 0 0 0)}}
.lr-tag{margin-top:18px;font-size:${FX_FONT_SCALE.body}px;color:var(--fx-accent);letter-spacing:6px;opacity:0;animation:lrFade .5s var(--fx-ease-enter) .85s both}
@keyframes lrFade{to{opacity:1}}`,
    };
  },
};

const teamCard: FxComponentDef = {
  id: 'team-card',
  label: '团队介绍',
  category: '口播',
  paramsDoc: '{ members: {name:string, role:string}[](≤4) }',
  render(params, themeId) {
    const members = (Array.isArray(params.members) ? params.members : []).slice(0, 4) as { name?: string; role?: string }[];
    const cards = members.map((m, i) =>
      `<div class="tm-card" style="animation-delay:${0.15 + i * 0.15}s"><div class="tm-avatar"></div><div class="tm-name">${esc(m.name)}</div><div class="tm-role">${esc(m.role)}</div></div>`,
    ).join('');
    return {
      html: root(themeId, `<div class="tm-wrap">${cards}</div>`),
      css: `
.tm-wrap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;gap:28px;animation:tmIn .4s var(--fx-ease-enter) both}
.tm-card{text-align:center;padding:32px 28px;background:var(--fx-surface);border-radius:20px;min-width:180px;opacity:0;animation:tmPop .45s var(--fx-ease-enter) both;animation-delay:inherit}
.tm-avatar{width:64px;height:64px;border-radius:50%;background:var(--fx-accent);opacity:.25;margin:0 auto 16px}
.tm-name{font-size:${FX_FONT_SCALE.body}px;font-weight:700;color:var(--fx-text)}
.tm-role{margin-top:6px;font-size:${FX_FONT_SCALE.caption}px;color:var(--fx-text);opacity:.6}
@keyframes tmPop{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:none}}
@keyframes tmIn{from{opacity:0;transform:translate(-50%,-46%)}to{opacity:1;transform:translate(-50%,-50%)}}`,
    };
  },
};

const milestoneTimeline: FxComponentDef = {
  id: 'milestone-timeline',
  label: '里程碑',
  category: '要点',
  paramsDoc: '{ milestones: {year:string, event:string}[](≤5) }',
  render(params, themeId) {
    const milestones = (Array.isArray(params.milestones) ? params.milestones : []).slice(0, 5) as { year?: string; event?: string }[];
    const nodeW = 160;
    const totalW = milestones.length * nodeW;
    const nodes = milestones.map((m, i) =>
      `<div class="mt-node" style="animation-delay:${0.3 + i * 0.2}s"><div class="mt-dot"></div><div class="mt-year">${esc(m.year)}</div><div class="mt-event">${esc(m.event)}</div></div>`,
    ).join('');
    return {
      html: root(themeId, `<div class="mt-wrap" style="width:${totalW}px"><svg class="mt-line" width="${totalW}" height="6" viewBox="0 0 ${totalW} 6"><line x1="0" y1="3" x2="${totalW}" y2="3" stroke="var(--fx-accent)" stroke-width="3" stroke-linecap="round" stroke-dasharray="${totalW}" stroke-dashoffset="${totalW}"/></svg><div class="mt-nodes">${nodes}</div></div>`),
      css: `
.mt-wrap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);animation:mtIn .4s var(--fx-ease-enter) both}
.mt-line{position:absolute;top:50%;left:0;transform:translateY(-50%)}
.mt-line line{animation:mtDraw 1.2s var(--fx-ease-enter) .2s both}
@keyframes mtDraw{to{stroke-dashoffset:0}}
.mt-nodes{position:relative;display:flex}
.mt-node{width:${nodeW}px;text-align:center;opacity:0;animation:mtNode .4s var(--fx-ease-enter) both;animation-delay:inherit}
.mt-dot{width:16px;height:16px;border-radius:50%;background:var(--fx-accent);margin:0 auto 12px;border:3px solid var(--fx-primary)}
.mt-year{font-size:${FX_FONT_SCALE.body}px;font-weight:800;color:var(--fx-accent)}
.mt-event{margin-top:6px;font-size:${FX_FONT_SCALE.caption}px;color:var(--fx-text);opacity:.8}
@keyframes mtNode{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:scale(1)}}
@keyframes mtIn{from{opacity:0;transform:translate(-50%,-46%)}to{opacity:1;transform:translate(-50%,-50%)}}`,
    };
  },
};

const missionStatement: FxComponentDef = {
  id: 'mission-statement',
  label: '使命宣言',
  category: '标题',
  paramsDoc: '{ text: string }',
  render(params, themeId) {
    const text = String(params.text ?? '');
    const words = text.split(/\s+/).filter(Boolean);
    // For Chinese text with no spaces, split by character
    const tokens = words.length <= 1 && text.length > 1 ? [...text] : words;
    const spans = tokens.map((w, i) =>
      `<span class="ms-word" style="animation-delay:${0.3 + i * 0.08}s">${esc(w)}</span>`,
    ).join('');
    return {
      html: root(themeId, `<div class="ms-wrap">${spans}</div>`),
      css: `
.ms-wrap{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);max-width:1100px;text-align:center;font-size:${FX_FONT_SCALE.display}px;font-weight:900;color:var(--fx-text);line-height:1.4;letter-spacing:4px}
.ms-word{display:inline-block;opacity:0;margin:0 4px;animation:msReveal .5s var(--fx-ease-enter) both;animation-delay:inherit}
@keyframes msReveal{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:none}}`,
    };
  },
};

// ── 氛围增强 ─────────────────────────────────────────────────────────────────

const gradientMesh: FxComponentDef = {
  id: 'gradient-mesh',
  label: '渐变网格',
  category: '氛围',
  paramsDoc: '{ intensity?: "low"|"high" }',
  render(params, themeId) {
    const high = params.intensity === 'high';
    const count = high ? 5 : 3;
    const opBase = high ? 0.22 : 0.15;
    const blobs = Array.from({ length: count }, (_, i) => {
      const x = (i * 149 + 30) % 100;
      const y = (i * 83 + 20) % 100;
      const size = 300 + ((i * 73) % 300);
      const dur = 8 + (i % 4) * 2;
      const op = opBase + (i % 2) * 0.05;
      const color = i % 2 === 0 ? 'var(--fx-accent)' : 'var(--fx-accent2)';
      return `<span class="gm2-blob" style="left:${x}%;top:${y}%;width:${size}px;height:${size}px;background:radial-gradient(circle,${color},transparent 70%);opacity:${op};animation-duration:${dur}s;animation-delay:-${i * 2}s"></span>`;
    }).join('');
    return {
      html: root(themeId, blobs),
      css: `
.gm2-blob{position:absolute;border-radius:50%;transform:translate(-50%,-50%);animation:gm2Drift ease-in-out infinite alternate}
@keyframes gm2Drift{0%{transform:translate(-50%,-50%) scale(1)}50%{transform:translate(-44%,-56%) scale(1.12)}100%{transform:translate(-56%,-48%) scale(0.95)}}`,
    };
  },
};

const noiseGrain: FxComponentDef = {
  id: 'noise-grain',
  label: '噪点纹理',
  category: '氛围',
  paramsDoc: '{ opacity?: number(0.02-0.12, default 0.06) }',
  render(params, themeId) {
    const op = Math.max(0.02, Math.min(0.12, Number(params.opacity) || 0.06));
    return {
      html: root(themeId, `<svg class="ng-svg" width="100%" height="100%"><filter id="ng-noise"><feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch"/></filter><rect width="100%" height="100%" filter="url(#ng-noise)" opacity="${op}"/></svg>`),
      css: `
.ng-svg{position:absolute;inset:0;pointer-events:none;animation:ngIn .8s both}
@keyframes ngIn{from{opacity:0}to{opacity:1}}`,
    };
  },
};

const gridLines: FxComponentDef = {
  id: 'grid-lines',
  label: '网格装饰',
  category: '氛围',
  paramsDoc: '{ spacing?: number(80-200, default 120) }',
  render(params, themeId) {
    const sp = Math.max(80, Math.min(200, Number(params.spacing) || 120));
    return {
      html: root(themeId, `<div class="gl-grid" style="background-size:${sp}px ${sp}px"></div>`),
      css: `
.gl-grid{position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(rgba(255,255,255,0.06) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.06) 1px,transparent 1px);opacity:0;animation:glIn .8s var(--fx-ease-enter) both}
@keyframes glIn{to{opacity:1}}`,
    };
  },
};

const cornerFrames: FxComponentDef = {
  id: 'corner-frames',
  label: '四角框线',
  category: '氛围',
  paramsDoc: '{ size?: number(40-100, default 60), thickness?: number(2-4, default 2) }',
  render(params, themeId) {
    const size = Math.max(40, Math.min(100, Number(params.size) || 60));
    const thick = Math.max(2, Math.min(4, Number(params.thickness) || 2));
    return {
      html: root(themeId, `<div class="cf-tl" style="--sz:${size}px;--th:${thick}px"></div><div class="cf-tr" style="--sz:${size}px;--th:${thick}px"></div><div class="cf-bl" style="--sz:${size}px;--th:${thick}px"></div><div class="cf-br" style="--sz:${size}px;--th:${thick}px"></div>`),
      css: `
.cf-tl,.cf-tr,.cf-bl,.cf-br{position:absolute;width:var(--sz);height:var(--sz);animation:cfIn .6s var(--fx-ease-enter) both}
.cf-tl{top:8%;left:8%;border-top:var(--th) solid var(--fx-accent);border-left:var(--th) solid var(--fx-accent)}
.cf-tr{top:8%;right:8%;border-top:var(--th) solid var(--fx-accent);border-right:var(--th) solid var(--fx-accent)}
.cf-bl{bottom:8%;left:8%;border-bottom:var(--th) solid var(--fx-accent);border-left:var(--th) solid var(--fx-accent)}
.cf-br{bottom:8%;right:8%;border-bottom:var(--th) solid var(--fx-accent);border-right:var(--th) solid var(--fx-accent)}
@keyframes cfIn{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:scale(1)}}`,
    };
  },
};

export const EXT2_FX_COMPONENTS: FxComponentDef[] = [
  gaugeMeter, funnelChart, pieChart, statGrid,
  topicIntro, reactionMeter, subscribeCard, chapterNav,
  starRating, couponCard, shippingInfo, socialProof,
  logoReveal, teamCard, milestoneTimeline, missionStatement,
  gradientMesh, noiseGrain, gridLines, cornerFrames,
];
