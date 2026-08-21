/**
 * pageLayoutEngine — 页面布局引擎（HyperFrames 页面模板生成核心）。
 *
 * 16 种风格 x N 种布局 → 250+ 页面模板。
 * 布局定义在 ./layouts/ 下（按类目拆分），本模块只提供风格、生成器、
 * 渲染壳和公共 CSS 辅助。所有产出满足 html2canvas 安全约束。
 *
 * 坐标系：1920x1080 absolute positioned stage。
 */

import { themeCssVars, themeOf, FX_FONT_SCALE, FX_EASINGS } from './fxDesignSystem';
import { pairingOf, fontCssVars, fontFaceCss, loadFontPairing } from './fontSystem';

// ── 类型 ──────────────────────────────────────────────────────────────────────

export interface LayoutZone {
  id: string;
  type: 'title' | 'subtitle' | 'body' | 'data' | 'chart' | 'list' | 'image' | 'badge' | 'cta' | 'decor';
  bounds: { x: string; y: string; w: string; h: string };
  optional?: boolean;
}

export type PageCategory = '通用' | '口播' | '电商' | '知识' | '品牌';

export const PAGE_CATEGORIES: PageCategory[] = ['通用', '口播', '电商', '知识', '品牌'];

export interface PageLayoutDef {
  id: string;
  label: string;
  category: PageCategory;
  desc: string;
  zones: LayoutZone[];
  render: (params: PageParams, style: StyleConfig) => { html: string; css: string };
}

export type StyleId =
  | 'linear' | 'minimal' | 'fluid' | 'metal'
  | 'keynote' | 'capcut' | 'pixel' | 'cyberpunk'
  | 'editorial' | 'warm' | 'luxury' | 'vibrant'
  | 'glass' | 'neon' | 'retro' | 'nature';

export type CardStyleId =
  | 'frosted' | 'neumorphism' | 'gradient-border' | 'elevated'
  | 'solid' | 'outline' | 'none' | 'pixel-border';

export interface StyleConfig {
  id: StyleId;
  label: string;
  defaultThemeId: string;
  defaultFontPairingId: string;
  enterEffect: 'fadeUp' | 'slideLeft' | 'scaleIn' | 'typewriter' | 'blur-reveal' | 'split-reveal';
  staggerDelay: number;
  decorations: string[];
  cardStyleId: CardStyleId;
  borderRadius: number;
  bgBaseCss: string;
  bgTextureCss: string;
  bgOrbsCss: string;
  bgGridCss: string;
  bgShimmerCss: string;
}

export interface PageParams {
  title?: string;
  subtitle?: string;
  body?: string;
  items?: string[];
  data?: { label: string; value: string | number }[];
  quote?: string;
  author?: string;
  price?: string;
  originalPrice?: string;
  cta?: string;
  steps?: string[];
  code?: string;
  stats?: { value: string; label: string }[];
  [key: string]: unknown;
}

export interface PageTemplateDef {
  id: string;
  label: string;
  category: PageCategory;
  layoutId: string;
  styleId: StyleId;
  render: (params: PageParams, themeId?: string) => { html: string; css: string };
  demoParams: PageParams;
}

// ── 入场动画 CSS ──────────────────────────────────────────────────────────────

/**
 * 返回指定入场效果的 @keyframes + 通用 .pg-enter 应用规则。
 * 所有动画仅使用 2D transform，html2canvas 安全。
 */
export function enterAnimCss(
  effect: StyleConfig['enterEffect'],
  staggerDelay: number,
): string {
  const ease = FX_EASINGS.enter;
  const dur = '0.6s';

  const keyframes: Record<StyleConfig['enterEffect'], string> = {
    fadeUp: `
@keyframes pgEnter {
  from { opacity: 0; transform: translateY(40px); }
  to   { opacity: 1; transform: translateY(0); }
}`,
    slideLeft: `
@keyframes pgEnter {
  from { opacity: 0; transform: translateX(80px); }
  to   { opacity: 1; transform: translateX(0); }
}`,
    scaleIn: `
@keyframes pgEnter {
  from { opacity: 0; transform: scale(0.7); }
  70%  { transform: scale(1.04); }
  to   { opacity: 1; transform: scale(1); }
}`,
    typewriter: `
@keyframes pgEnter {
  from { opacity: 0; clip-path: inset(0 100% 0 0); }
  to   { opacity: 1; clip-path: inset(0 0 0 0); }
}`,
    'blur-reveal': `
@keyframes pgEnter {
  from { opacity: 0; filter: blur(16px); }
  to   { opacity: 1; filter: blur(0); }
}`,
    'split-reveal': `
@keyframes pgEnter {
  from { opacity: 0; clip-path: inset(50% 0 50% 0); }
  to   { opacity: 1; clip-path: inset(0 0 0 0); }
}`,
  };

  return `${keyframes[effect]}
.pg-enter {
  opacity: 0;
  animation: pgEnter ${dur} ${ease} both;
}
${Array.from({ length: 8 }, (_, i) =>
    `.pg-enter:nth-child(${i + 1}) { animation-delay: ${(staggerDelay * i).toFixed(2)}s; }`).join('\n')}`;
}

// ── 装饰元素 HTML ─────────────────────────────────────────────────────────────

/**
 * 返回装饰元素 HTML（绝对定位覆盖层）。
 * 每种装饰是一个 .pg-decor-* div，CSS 在 decorationCss 中定义。
 */
export function decorationHtml(decorations: string[]): string {
  return decorations
    .map((d) => `<div class="pg-decor pg-decor-${d}" aria-hidden="true"></div>`)
    .join('');
}

/** 装饰元素的 CSS（所有类型汇总，按需匹配） */
function decorationCss(): string {
  return `
/* ── 装饰公共 ── */
.pg-decor {
  position: absolute; inset: 0;
  pointer-events: none; z-index: 1;
}

/* grid-lines：极简风网格 */
.pg-decor-grid-lines {
  background-image:
    linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px);
  background-size: 120px 120px;
}

/* corner-accent：杂志风角标 */
.pg-decor-corner-accent::before,
.pg-decor-corner-accent::after {
  content: '';
  position: absolute;
  width: 80px; height: 80px;
  border-color: var(--fx-accent);
  border-style: solid;
  border-width: 0;
}
.pg-decor-corner-accent::before {
  top: 60px; left: 60px;
  border-top-width: 3px; border-left-width: 3px;
}
.pg-decor-corner-accent::after {
  bottom: 60px; right: 60px;
  border-bottom-width: 3px; border-right-width: 3px;
}

/* corner-frame：加厚L形渐变角标 */
.pg-decor-corner-frame::before,
.pg-decor-corner-frame::after {
  content: '';
  position: absolute;
}
.pg-decor-corner-frame::before {
  top: 48px; left: 48px;
  width: 120px; height: 120px;
  border-top: 4px solid var(--fx-accent);
  border-left: 4px solid var(--fx-accent);
  opacity: 0.7;
}
.pg-decor-corner-frame::after {
  bottom: 48px; right: 48px;
  width: 120px; height: 120px;
  border-bottom: 4px solid var(--fx-accent2, var(--fx-accent));
  border-right: 4px solid var(--fx-accent2, var(--fx-accent));
  opacity: 0.7;
}

/* diagonal-line：对角线装饰 */
.pg-decor-diagonal-line::before {
  content: '';
  position: absolute;
  top: 0; right: 0;
  width: 200px; height: 200px;
  background: linear-gradient(135deg, transparent 49%, var(--fx-accent) 49%, var(--fx-accent) 51%, transparent 51%);
  opacity: 0.15;
}

/* circle-accent：大圆环装饰 */
.pg-decor-circle-accent::before {
  content: '';
  position: absolute;
  width: 500px; height: 500px;
  top: -120px; right: -80px;
  border-radius: 50%;
  border: 3px solid var(--fx-accent);
  opacity: 0.08;
}
.pg-decor-circle-accent::after {
  content: '';
  position: absolute;
  width: 300px; height: 300px;
  bottom: -60px; left: -40px;
  border-radius: 50%;
  border: 2px solid var(--fx-accent2, var(--fx-accent));
  opacity: 0.06;
}

/* dot-pattern：点阵图案 */
.pg-decor-dot-pattern {
  background-image: radial-gradient(circle 2px, var(--fx-accent) 1px, transparent 1px);
  background-size: 40px 40px;
  opacity: 0.06;
}

/* glow-orb：大发光球 */
.pg-decor-glow-orb::before {
  content: '';
  position: absolute;
  width: 400px; height: 400px;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: radial-gradient(circle, var(--fx-accent) 0%, transparent 70%);
  opacity: 0.08;
  animation: pgOrbDrift 12s ease-in-out infinite alternate;
}

/* scan-line：扫描线 */
.pg-decor-scan-line {
  background: repeating-linear-gradient(
    to bottom,
    transparent 0px,
    transparent 3px,
    rgba(0,0,0,0.08) 3px,
    rgba(0,0,0,0.08) 4px
  );
}

/* pixel-grid：像素网格 */
.pg-decor-pixel-grid {
  background-image:
    linear-gradient(var(--fx-accent) 2px, transparent 2px),
    linear-gradient(90deg, var(--fx-accent) 2px, transparent 2px);
  background-size: 32px 32px;
  opacity: 0.04;
}

/* gradient-strip：水平渐变条带 */
.pg-decor-gradient-strip::before {
  content: '';
  position: absolute;
  bottom: 0; left: 0; right: 0;
  height: 4px;
  background: linear-gradient(90deg, var(--fx-accent), var(--fx-accent2, var(--fx-accent)), var(--fx-accent));
  opacity: 0.6;
}

/* noise-film：SVG噪点覆盖 */
.pg-decor-noise-film {
  opacity: 0.035;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  background-size: 256px 256px;
}

/* geometric-shapes：几何散布 */
.pg-decor-geometric-shapes::before {
  content: '';
  position: absolute;
  top: 80px; right: 120px;
  width: 0; height: 0;
  border-left: 40px solid transparent;
  border-right: 40px solid transparent;
  border-bottom: 70px solid var(--fx-accent);
  opacity: 0.08;
}
.pg-decor-geometric-shapes::after {
  content: '';
  position: absolute;
  bottom: 120px; left: 160px;
  width: 80px; height: 80px;
  border-radius: 50%;
  background: var(--fx-accent2, var(--fx-accent));
  opacity: 0.06;
}

/* gradient-blob：渐变色块 */
.pg-decor-gradient-blob::before {
  content: '';
  position: absolute;
  width: 600px; height: 600px;
  top: -180px; right: -120px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--fx-accent) 0%, transparent 70%);
  opacity: 0.12;
  animation: pgBlobDrift 8s var(--fx-ease-enter) infinite alternate;
}
.pg-decor-gradient-blob::after {
  content: '';
  position: absolute;
  width: 400px; height: 400px;
  bottom: -100px; left: -60px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--fx-accent2) 0%, transparent 70%);
  opacity: 0.10;
  animation: pgBlobDrift 10s var(--fx-ease-enter) 1s infinite alternate-reverse;
}
@keyframes pgBlobDrift {
  from { transform: translate(0, 0); }
  to   { transform: translate(30px, -20px); }
}

/* shimmer：奢华微光扫描 */
.pg-decor-shimmer::before {
  content: '';
  position: absolute;
  top: 0; left: -100%;
  width: 60%; height: 100%;
  background: linear-gradient(
    100deg,
    transparent 0%,
    rgba(255,255,255,0.03) 40%,
    rgba(255,255,255,0.08) 50%,
    rgba(255,255,255,0.03) 60%,
    transparent 100%
  );
  animation: pgShimmer 4s linear infinite;
}
@keyframes pgShimmer {
  from { left: -100%; }
  to   { left: 200%; }
}

/* noise-overlay：噪点叠层 */
.pg-decor-noise-overlay {
  opacity: 0.06;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  background-size: 256px 256px;
}

/* particles：粒子 */
.pg-decor-particles::before,
.pg-decor-particles::after {
  content: '';
  position: absolute;
  width: 4px; height: 4px;
  border-radius: 50%;
  background: var(--fx-accent);
  opacity: 0.3;
  box-shadow:
    120px 80px 0 0 var(--fx-accent),
    340px 200px 0 1px var(--fx-accent2, var(--fx-accent)),
    560px 120px 0 0 var(--fx-accent),
    780px 320px 0 1px var(--fx-accent),
    900px 180px 0 0 var(--fx-accent2, var(--fx-accent)),
    1100px 400px 0 1px var(--fx-accent),
    1300px 100px 0 0 var(--fx-accent),
    1500px 300px 0 1px var(--fx-accent2, var(--fx-accent)),
    1700px 220px 0 0 var(--fx-accent);
  animation: pgParticleFloat 6s ease-in-out infinite alternate;
}
.pg-decor-particles::after {
  top: 40px; left: 60px;
  animation-delay: -3s;
  animation-direction: alternate-reverse;
}
@keyframes pgParticleFloat {
  from { transform: translateY(0); }
  to   { transform: translateY(-16px); }
}

/* scan-lines：赛博扫描线（旧名兼容） */
.pg-decor-scan-lines {
  background: repeating-linear-gradient(
    to bottom,
    transparent 0px,
    transparent 3px,
    rgba(0,0,0,0.08) 3px,
    rgba(0,0,0,0.08) 4px
  );
}`;
}

// ── 卡片样式 CSS ──────────────────────────────────────────────────────────────

/**
 * 返回 .pg-card 的 CSS（8 种高级卡片样式）。
 * 所有效果 html2canvas 安全：不使用 backdrop-filter / 3D transform。
 */
export function cardCss(cardStyleId: CardStyleId, borderRadius: number): string {
  const radius = `${borderRadius}px`;

  switch (cardStyleId) {
    case 'frosted':
      return `.pg-card {
  background: var(--fx-surface);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: ${radius};
  box-shadow: 0 8px 32px rgba(0,0,0,0.25), 0 2px 8px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.06);
}`;
    case 'neumorphism':
      return `.pg-card {
  background: var(--fx-primary);
  border-radius: ${radius};
  box-shadow: 8px 8px 24px rgba(0,0,0,0.35), -8px -8px 24px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.05);
}`;
    case 'gradient-border':
      return `.pg-card {
  background: linear-gradient(var(--fx-primary), var(--fx-primary)) padding-box,
              linear-gradient(135deg, var(--fx-accent), var(--fx-accent2, var(--fx-accent))) border-box;
  border: 2px solid transparent;
  border-radius: ${radius};
  box-shadow: 0 0 20px rgba(0,0,0,0.2), inset 0 0 30px rgba(0,0,0,0.1);
}`;
    case 'elevated':
      return `.pg-card {
  background: var(--fx-surface);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: ${radius};
  box-shadow: 0 1px 2px rgba(0,0,0,0.1), 0 4px 16px rgba(0,0,0,0.12), 0 12px 48px rgba(0,0,0,0.15);
}`;
    case 'solid':
      return `.pg-card {
  background: var(--fx-surface);
  border-radius: ${radius};
  box-shadow: 0 4px 24px rgba(0,0,0,0.12);
}`;
    case 'outline':
      return `.pg-card {
  background: transparent;
  border: 2px solid var(--fx-accent);
  border-radius: ${radius};
}`;
    case 'pixel-border':
      return `.pg-card {
  background: var(--fx-primary);
  border-radius: 0;
  box-shadow: 4px 0 0 0 var(--fx-accent), -4px 0 0 0 var(--fx-accent),
              0 4px 0 0 var(--fx-accent), 0 -4px 0 0 var(--fx-accent);
}`;
    case 'none':
    default:
      return `.pg-card {
  background: transparent;
  border: none;
  border-radius: ${radius};
}`;
  }
}

// ── 背景层 HTML / CSS ─────────────────────────────────────────────────────────

function backgroundHtml(): string {
  return `<div class="pg-bg-layers" aria-hidden="true">
  <div class="pg-bg-base"></div>
  <div class="pg-bg-texture"></div>
  <div class="pg-bg-orbs"></div>
  <div class="pg-bg-grid"></div>
  <div class="pg-bg-shimmer"></div>
</div>`;
}

function backgroundCss(style: StyleConfig): string {
  return `
.pg-bg-layers { position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden; }
.pg-bg-layers > div { position:absolute;inset:0; }
.pg-bg-base { ${style.bgBaseCss} }
.pg-bg-texture { ${style.bgTextureCss} }
.pg-bg-orbs { ${style.bgOrbsCss} }
.pg-bg-grid { ${style.bgGridCss} }
.pg-bg-shimmer { ${style.bgShimmerCss} }

@keyframes pgOrbDrift {
  from { transform: translate(0, 0); }
  to   { transform: translate(20px, -15px); }
}
@keyframes pgShimmerSweep {
  from { transform: translateX(-100%); }
  to   { transform: translateX(200%); }
}
@keyframes pgStepScan {
  from { transform: translateY(-100%); }
  to   { transform: translateY(200%); }
}
@keyframes pgNeonFlicker {
  0%, 100% { opacity: 1; }
  5%  { opacity: 0.8; }
  10% { opacity: 1; }
  50% { opacity: 0.95; }
  55% { opacity: 0.7; }
  60% { opacity: 1; }
}`;
}

// ── 公共 CSS 片段 ─────────────────────────────────────────────────────────────

const NOISE_SVG_ENCODED = "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

function noiseBg(opacity: number): string {
  return `opacity:${opacity}; background-image: ${NOISE_SVG_ENCODED}; background-size: 256px 256px;`;
}

function shimmerSweepCss(duration: string = '6s'): string {
  return `overflow:hidden;`
    + ` background: linear-gradient(100deg, transparent 0%, rgba(255,255,255,0.03) 35%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.03) 65%, transparent 100%);`
    + ` background-size: 60% 100%; background-repeat: no-repeat;`
    + ` animation: pgShimmerSweep ${duration} linear infinite;`;
}

// ── 16 种风格定义 ─────────────────────────────────────────────────────────────

export const STYLES: StyleConfig[] = [
  // 1. linear — Linear精致
  {
    id: 'linear',
    label: 'Linear精致',
    defaultThemeId: 'techblue',
    defaultFontPairingId: 'tech',
    enterEffect: 'fadeUp',
    staggerDelay: 0.12,
    decorations: ['diagonal-line', 'noise-film'],
    cardStyleId: 'frosted',
    borderRadius: 12,
    bgBaseCss: `background: linear-gradient(145deg, var(--fx-primary) 0%, color-mix(in srgb, var(--fx-primary) 85%, var(--fx-accent) 15%) 50%, var(--fx-primary) 100%);`,
    bgTextureCss: noiseBg(0.035),
    bgOrbsCss: `background: radial-gradient(ellipse 600px 600px at 20% 30%, color-mix(in srgb, var(--fx-accent) 10%, transparent) 0%, transparent 70%), radial-gradient(ellipse 500px 500px at 80% 70%, color-mix(in srgb, var(--fx-accent2, var(--fx-accent)) 8%, transparent) 0%, transparent 70%); animation: pgOrbDrift 12s ease-in-out infinite alternate;`,
    bgGridCss: `background-image: linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px); background-size: 80px 80px;`,
    bgShimmerCss: shimmerSweepCss('6s'),
  },

  // 2. minimal — 极简克制
  {
    id: 'minimal',
    label: '极简克制',
    defaultThemeId: 'slate',
    defaultFontPairingId: 'minimal',
    enterEffect: 'fadeUp',
    staggerDelay: 0.14,
    decorations: ['grid-lines'],
    cardStyleId: 'none',
    borderRadius: 4,
    bgBaseCss: `background: var(--fx-primary);`,
    bgTextureCss: '',
    bgOrbsCss: '',
    bgGridCss: `background-image: linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px); background-size: 120px 120px;`,
    bgShimmerCss: '',
  },

  // 3. fluid — 流体渐变
  {
    id: 'fluid',
    label: '流体渐变',
    defaultThemeId: 'candy',
    defaultFontPairingId: 'variety',
    enterEffect: 'scaleIn',
    staggerDelay: 0.10,
    decorations: ['circle-accent'],
    cardStyleId: 'frosted',
    borderRadius: 24,
    bgBaseCss: `background: conic-gradient(from 180deg at 50% 50%, var(--fx-primary) 0%, color-mix(in srgb, var(--fx-primary) 70%, var(--fx-accent)) 25%, var(--fx-primary) 50%, color-mix(in srgb, var(--fx-primary) 70%, var(--fx-accent2, var(--fx-accent))) 75%, var(--fx-primary) 100%);`,
    bgTextureCss: noiseBg(0.03),
    bgOrbsCss: `background: radial-gradient(circle 500px at 30% 40%, color-mix(in srgb, var(--fx-accent) 18%, transparent) 0%, transparent 60%), radial-gradient(circle 400px at 70% 60%, color-mix(in srgb, var(--fx-accent2, var(--fx-accent)) 15%, transparent) 0%, transparent 60%), radial-gradient(circle 300px at 50% 80%, color-mix(in srgb, var(--fx-accent) 12%, transparent) 0%, transparent 60%); animation: pgOrbDrift 10s ease-in-out infinite alternate;`,
    bgGridCss: '',
    bgShimmerCss: `background: conic-gradient(from 0deg at 50% 50%, transparent 0%, rgba(255,255,255,0.02) 25%, transparent 50%); animation: pgOrbDrift 15s linear infinite alternate;`,
  },

  // 4. metal — 金属质感
  {
    id: 'metal',
    label: '金属质感',
    defaultThemeId: 'midnight',
    defaultFontPairingId: 'luxury',
    enterEffect: 'blur-reveal',
    staggerDelay: 0.16,
    decorations: ['shimmer'],
    cardStyleId: 'neumorphism',
    borderRadius: 8,
    bgBaseCss: `background: linear-gradient(160deg, var(--fx-primary) 0%, color-mix(in srgb, var(--fx-primary) 80%, var(--fx-accent)) 50%, var(--fx-primary) 100%);`,
    bgTextureCss: `background: repeating-linear-gradient(135deg, transparent 0px, transparent 2px, rgba(255,255,255,0.015) 2px, rgba(255,255,255,0.015) 3px); opacity: 1;`,
    bgOrbsCss: `background: radial-gradient(ellipse 800px 400px at 50% 40%, color-mix(in srgb, var(--fx-accent) 6%, transparent) 0%, transparent 70%);`,
    bgGridCss: '',
    bgShimmerCss: shimmerSweepCss('5s'),
  },

  // 5. keynote — 发布会
  {
    id: 'keynote',
    label: '发布会',
    defaultThemeId: 'midnight',
    defaultFontPairingId: 'minimal',
    enterEffect: 'fadeUp',
    staggerDelay: 0.12,
    decorations: ['gradient-strip'],
    cardStyleId: 'frosted',
    borderRadius: 16,
    bgBaseCss: `background: linear-gradient(180deg, var(--fx-primary) 0%, color-mix(in srgb, var(--fx-primary) 75%, var(--fx-accent)) 100%);`,
    bgTextureCss: noiseBg(0.03),
    bgOrbsCss: `background: radial-gradient(ellipse 900px 500px at 50% 90%, color-mix(in srgb, var(--fx-accent) 12%, transparent) 0%, transparent 60%);`,
    bgGridCss: '',
    bgShimmerCss: '',
  },

  // 6. capcut — 剪映模板
  {
    id: 'capcut',
    label: '剪映模板',
    defaultThemeId: 'vividorange',
    defaultFontPairingId: 'variety',
    enterEffect: 'scaleIn',
    staggerDelay: 0.08,
    decorations: ['geometric-shapes', 'dot-pattern'],
    cardStyleId: 'gradient-border',
    borderRadius: 20,
    bgBaseCss: `background: linear-gradient(135deg, var(--fx-primary) 0%, color-mix(in srgb, var(--fx-primary) 65%, var(--fx-accent)) 100%);`,
    bgTextureCss: noiseBg(0.04),
    bgOrbsCss: `background: radial-gradient(circle 400px at 15% 25%, color-mix(in srgb, var(--fx-accent) 20%, transparent) 0%, transparent 60%), radial-gradient(circle 350px at 85% 75%, color-mix(in srgb, var(--fx-accent2, var(--fx-accent)) 18%, transparent) 0%, transparent 60%), radial-gradient(circle 250px at 60% 20%, color-mix(in srgb, var(--fx-accent) 12%, transparent) 0%, transparent 60%);`,
    bgGridCss: '',
    bgShimmerCss: '',
  },

  // 7. pixel — 像素游戏
  {
    id: 'pixel',
    label: '像素游戏',
    defaultThemeId: 'neon',
    defaultFontPairingId: 'tech',
    enterEffect: 'typewriter',
    staggerDelay: 0.10,
    decorations: ['pixel-grid', 'scan-line'],
    cardStyleId: 'pixel-border',
    borderRadius: 0,
    bgBaseCss: `background: var(--fx-primary);`,
    bgTextureCss: '',
    bgOrbsCss: `background: radial-gradient(circle 4px at 200px 150px, var(--fx-accent) 100%, transparent 100%), radial-gradient(circle 4px at 500px 300px, var(--fx-accent2, var(--fx-accent)) 100%, transparent 100%), radial-gradient(circle 4px at 900px 200px, var(--fx-accent) 100%, transparent 100%), radial-gradient(circle 4px at 1400px 400px, var(--fx-accent2, var(--fx-accent)) 100%, transparent 100%), radial-gradient(circle 4px at 1700px 150px, var(--fx-accent) 100%, transparent 100%); opacity: 0.3;`,
    bgGridCss: `background-image: linear-gradient(var(--fx-accent) 1px, transparent 1px), linear-gradient(90deg, var(--fx-accent) 1px, transparent 1px); background-size: 32px 32px; opacity: 0.06;`,
    bgShimmerCss: `background: linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%); background-size: 100% 40px; animation: pgStepScan 3s steps(20) infinite;`,
  },

  // 8. cyberpunk — 赛博朋克
  {
    id: 'cyberpunk',
    label: '赛博朋克',
    defaultThemeId: 'neon',
    defaultFontPairingId: 'tech',
    enterEffect: 'slideLeft',
    staggerDelay: 0.06,
    decorations: ['glow-orb', 'scan-line', 'noise-film'],
    cardStyleId: 'gradient-border',
    borderRadius: 2,
    bgBaseCss: `background: linear-gradient(180deg, #05020e 0%, var(--fx-primary) 40%, #0a0515 100%);`,
    bgTextureCss: noiseBg(0.06),
    bgOrbsCss: `background: radial-gradient(ellipse 500px 500px at 25% 35%, color-mix(in srgb, var(--fx-accent) 15%, transparent) 0%, transparent 60%), radial-gradient(ellipse 400px 400px at 75% 65%, color-mix(in srgb, var(--fx-accent2, var(--fx-accent)) 12%, transparent) 0%, transparent 60%); animation: pgOrbDrift 8s ease-in-out infinite alternate;`,
    bgGridCss: '',
    bgShimmerCss: `background: linear-gradient(100deg, transparent 30%, rgba(255,255,255,0.04) 50%, transparent 70%); background-size: 40% 100%; animation: pgShimmerSweep 4s linear infinite; opacity: 0.8;`,
  },

  // 9. editorial — 杂志编辑
  {
    id: 'editorial',
    label: '杂志编辑',
    defaultThemeId: 'paper',
    defaultFontPairingId: 'editorial',
    enterEffect: 'split-reveal',
    staggerDelay: 0.15,
    decorations: ['corner-frame', 'noise-film'],
    cardStyleId: 'outline',
    borderRadius: 0,
    bgBaseCss: `background: linear-gradient(170deg, var(--fx-primary) 0%, color-mix(in srgb, var(--fx-primary) 92%, var(--fx-accent)) 100%);`,
    bgTextureCss: noiseBg(0.05),
    bgOrbsCss: `background: radial-gradient(ellipse 700px 500px at 80% 20%, color-mix(in srgb, var(--fx-accent) 5%, transparent) 0%, transparent 70%);`,
    bgGridCss: '',
    bgShimmerCss: '',
  },

  // 10. warm — 温暖治愈
  {
    id: 'warm',
    label: '温暖治愈',
    defaultThemeId: 'mocha',
    defaultFontPairingId: 'literary',
    enterEffect: 'fadeUp',
    staggerDelay: 0.14,
    decorations: ['gradient-blob'],
    cardStyleId: 'solid',
    borderRadius: 24,
    bgBaseCss: `background: linear-gradient(150deg, var(--fx-primary) 0%, color-mix(in srgb, var(--fx-primary) 80%, var(--fx-accent)) 60%, var(--fx-primary) 100%);`,
    bgTextureCss: noiseBg(0.04),
    bgOrbsCss: `background: radial-gradient(circle 600px at 25% 50%, color-mix(in srgb, var(--fx-accent) 10%, transparent) 0%, transparent 70%), radial-gradient(circle 500px at 75% 50%, color-mix(in srgb, var(--fx-accent2, var(--fx-accent)) 8%, transparent) 0%, transparent 70%); animation: pgOrbDrift 14s ease-in-out infinite alternate;`,
    bgGridCss: '',
    bgShimmerCss: '',
  },

  // 11. luxury — 奢华品牌
  {
    id: 'luxury',
    label: '奢华品牌',
    defaultThemeId: 'midnight',
    defaultFontPairingId: 'luxury',
    enterEffect: 'blur-reveal',
    staggerDelay: 0.18,
    decorations: ['diagonal-line', 'shimmer'],
    cardStyleId: 'elevated',
    borderRadius: 4,
    bgBaseCss: `background: linear-gradient(165deg, var(--fx-primary) 0%, color-mix(in srgb, var(--fx-primary) 88%, var(--fx-accent)) 50%, var(--fx-primary) 100%);`,
    bgTextureCss: `background: repeating-linear-gradient(120deg, transparent 0px, transparent 3px, rgba(255,255,255,0.01) 3px, rgba(255,255,255,0.01) 4px); opacity: 1;`,
    bgOrbsCss: `background: radial-gradient(ellipse 600px 300px at 50% 50%, color-mix(in srgb, var(--fx-accent) 5%, transparent) 0%, transparent 70%);`,
    bgGridCss: '',
    bgShimmerCss: shimmerSweepCss('8s'),
  },

  // 12. vibrant — 活力潮流
  {
    id: 'vibrant',
    label: '活力潮流',
    defaultThemeId: 'vividorange',
    defaultFontPairingId: 'variety',
    enterEffect: 'scaleIn',
    staggerDelay: 0.10,
    decorations: ['geometric-shapes', 'gradient-blob'],
    cardStyleId: 'gradient-border',
    borderRadius: 20,
    bgBaseCss: `background: linear-gradient(135deg, var(--fx-primary) 0%, color-mix(in srgb, var(--fx-primary) 55%, var(--fx-accent)) 50%, color-mix(in srgb, var(--fx-primary) 70%, var(--fx-accent2, var(--fx-accent))) 100%);`,
    bgTextureCss: noiseBg(0.04),
    bgOrbsCss: `background: radial-gradient(circle 500px at 20% 30%, color-mix(in srgb, var(--fx-accent) 20%, transparent) 0%, transparent 60%), radial-gradient(circle 400px at 80% 70%, color-mix(in srgb, var(--fx-accent2, var(--fx-accent)) 16%, transparent) 0%, transparent 60%); animation: pgOrbDrift 9s ease-in-out infinite alternate;`,
    bgGridCss: '',
    bgShimmerCss: '',
  },

  // 13. glass — 毛玻璃
  {
    id: 'glass',
    label: '毛玻璃',
    defaultThemeId: 'techblue',
    defaultFontPairingId: 'tech',
    enterEffect: 'fadeUp',
    staggerDelay: 0.12,
    decorations: ['noise-film'],
    cardStyleId: 'frosted',
    borderRadius: 16,
    bgBaseCss: `background: linear-gradient(150deg, var(--fx-primary) 0%, color-mix(in srgb, var(--fx-primary) 82%, var(--fx-accent)) 100%);`,
    bgTextureCss: noiseBg(0.04),
    bgOrbsCss: `background: radial-gradient(circle 550px at 20% 35%, color-mix(in srgb, var(--fx-accent) 16%, transparent) 0%, transparent 55%), radial-gradient(circle 450px at 80% 65%, color-mix(in srgb, var(--fx-accent2, var(--fx-accent)) 14%, transparent) 0%, transparent 55%), radial-gradient(circle 350px at 50% 90%, color-mix(in srgb, var(--fx-accent) 10%, transparent) 0%, transparent 55%); animation: pgOrbDrift 11s ease-in-out infinite alternate;`,
    bgGridCss: '',
    bgShimmerCss: shimmerSweepCss('7s'),
  },

  // 14. neon — 霓虹
  {
    id: 'neon',
    label: '霓虹',
    defaultThemeId: 'neon',
    defaultFontPairingId: 'tech',
    enterEffect: 'slideLeft',
    staggerDelay: 0.08,
    decorations: ['glow-orb', 'noise-film'],
    cardStyleId: 'gradient-border',
    borderRadius: 8,
    bgBaseCss: `background: linear-gradient(180deg, #08020f 0%, var(--fx-primary) 50%, #06010c 100%);`,
    bgTextureCss: noiseBg(0.05),
    bgOrbsCss: `background: radial-gradient(circle 500px at 20% 30%, color-mix(in srgb, var(--fx-accent) 18%, transparent) 0%, transparent 55%), radial-gradient(circle 400px at 80% 50%, color-mix(in srgb, var(--fx-accent2, var(--fx-accent)) 15%, transparent) 0%, transparent 55%), radial-gradient(circle 350px at 50% 80%, color-mix(in srgb, var(--fx-accent) 12%, transparent) 0%, transparent 55%); animation: pgOrbDrift 8s ease-in-out infinite alternate;`,
    bgGridCss: '',
    bgShimmerCss: `background: linear-gradient(100deg, transparent 30%, rgba(255,255,255,0.03) 50%, transparent 70%); background-size: 50% 100%; animation: pgShimmerSweep 5s linear infinite; animation-name: pgNeonFlicker; animation-duration: 3s; animation-iteration-count: infinite;`,
  },

  // 15. retro — 复古CRT
  {
    id: 'retro',
    label: '复古CRT',
    defaultThemeId: 'neon',
    defaultFontPairingId: 'tech',
    enterEffect: 'typewriter',
    staggerDelay: 0.12,
    decorations: ['scan-line', 'pixel-grid', 'noise-film'],
    cardStyleId: 'pixel-border',
    borderRadius: 0,
    bgBaseCss: `background: linear-gradient(180deg, color-mix(in srgb, var(--fx-primary) 90%, #3d2b1f) 0%, var(--fx-primary) 50%, color-mix(in srgb, var(--fx-primary) 90%, #3d2b1f) 100%);`,
    bgTextureCss: noiseBg(0.07),
    bgOrbsCss: `background: radial-gradient(ellipse 1200px 800px at 50% 50%, color-mix(in srgb, var(--fx-accent) 6%, transparent) 0%, transparent 70%);`,
    bgGridCss: `background-image: linear-gradient(var(--fx-accent) 2px, transparent 2px), linear-gradient(90deg, var(--fx-accent) 2px, transparent 2px); background-size: 32px 32px; opacity: 0.04;`,
    bgShimmerCss: `background: linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.03) 50%, transparent 100%); background-size: 100% 60px; animation: pgStepScan 4s steps(15) infinite;`,
  },

  // 16. nature — 自然
  {
    id: 'nature',
    label: '自然',
    defaultThemeId: 'olive',
    defaultFontPairingId: 'literary',
    enterEffect: 'fadeUp',
    staggerDelay: 0.14,
    decorations: ['circle-accent', 'noise-film'],
    cardStyleId: 'solid',
    borderRadius: 16,
    bgBaseCss: `background: linear-gradient(160deg, var(--fx-primary) 0%, color-mix(in srgb, var(--fx-primary) 85%, var(--fx-accent)) 50%, var(--fx-primary) 100%);`,
    bgTextureCss: noiseBg(0.06),
    bgOrbsCss: `background: radial-gradient(circle 500px at 30% 40%, color-mix(in srgb, var(--fx-accent) 10%, transparent) 0%, transparent 70%), radial-gradient(circle 400px at 70% 60%, color-mix(in srgb, var(--fx-accent2, var(--fx-accent)) 8%, transparent) 0%, transparent 70%); animation: pgOrbDrift 14s ease-in-out infinite alternate;`,
    bgGridCss: '',
    bgShimmerCss: '',
  },
];

export function styleOf(id?: StyleId): StyleConfig {
  return STYLES.find((s) => s.id === id) ?? STYLES[0];
}

// ── 不兼容组合 ────────────────────────────────────────────────────────────────

/**
 * "layoutId--styleId" 对：这些组合在美学或语义上不成立，跳过生成。
 * 布局文件可追加条目。
 */
export const INCOMPATIBLE = new Set<string>([
  // 代码展示 + 温暖手写风 = 阅读体验差
  'code-explain--warm',
  'code-block--warm',
  'code-explain--nature',
  'code-block--nature',
  // 电商促销 + 奢华克制 = 调性冲突
  'promo-banner--luxury',
  'flash-sale--luxury',
  'flash-sale--minimal',
  'flash-sale--editorial',
  // 数据密集 + 活力花哨 = 信息干扰
  'data-table--vibrant',
  'data-table--capcut',
  'data-table--pixel',
  // 品牌故事 + 赛博/像素 = 调性冲突
  'brand-story--cyberpunk',
  'brand-story--pixel',
  'brand-story--retro',
  'warm-intro--cyberpunk',
  'warm-intro--pixel',
  'warm-intro--neon',
  // 知识卡 + 温暖/自然 = 专业感不足
  'tech-spec--warm',
  'tech-spec--nature',
  // 像素风 + 精致/毛玻璃 = 风格冲突
  'brand-statement--pixel',
  'brand-statement--retro',
  'brand-statement--cyberpunk',
  // 复古 + 流体渐变 = 对比过强
  'flash-sale--retro',
]);

// ── 模板生成器 ────────────────────────────────────────────────────────────────

/**
 * 交叉乘积：layouts x styles，过滤不兼容组合，生成 PageTemplateDef[]。
 */
export function generatePageTemplates(layouts: PageLayoutDef[]): PageTemplateDef[] {
  const templates: PageTemplateDef[] = [];

  for (const layout of layouts) {
    for (const style of STYLES) {
      const combo = `${layout.id}--${style.id}`;
      if (INCOMPATIBLE.has(combo)) continue;

      templates.push({
        id: `${layout.id}__${style.id}`,
        label: `${layout.label} / ${style.label}`,
        category: layout.category,
        layoutId: layout.id,
        styleId: style.id,
        render: (params: PageParams, themeId?: string) =>
          renderPage(layout, params, style, themeId),
        demoParams: buildDemoParams(layout),
      });
    }
  }

  return templates;
}

// ── 页面渲染器 ────────────────────────────────────────────────────────────────

const STAGE_STYLE = "position:absolute;inset:0;width:1920px;height:1080px;overflow:hidden;";

/**
 * 完整页面渲染：主题 token + 字体 + 布局内容 + 装饰 + 风格 CSS。
 */
export function renderPage(
  layout: PageLayoutDef,
  params: PageParams,
  style: StyleConfig,
  themeId?: string,
): { html: string; css: string } {
  // 1. 解析主题
  const resolvedThemeId = themeId ?? style.defaultThemeId;
  const theme = themeOf(resolvedThemeId);

  // 2. 解析字体配对
  const fontPairingId = theme.fontPairing ?? style.defaultFontPairingId;
  const pairing = pairingOf(fontPairingId);

  // 3. 加载字体（浏览器环境）
  if (typeof document !== 'undefined') {
    loadFontPairing(pairing);
  }

  // 4. 构建 CSS 变量
  const cssVarStr = `${themeCssVars(theme)}; ${fontCssVars(pairing)}`;

  // 5. 调用布局渲染
  const layoutResult = layout.render(params, style);

  // 6. 装饰 HTML
  const decor = decorationHtml(style.decorations);

  // 7. 组装 HTML
  const html = `<div class="fx-root pg-root" style="${STAGE_STYLE}background:var(--fx-primary);${cssVarStr}; font-family: var(--fx-font-body);">
${backgroundHtml()}
${decor}
<div class="pg-content" style="position:absolute;inset:0;z-index:2;">
${layoutResult.html}
</div>
</div>`;

  // 8. 组装 CSS（fontFaceCss 让导出端 stage.html 也能加载 CDN 字体，与预览一致）
  const css = `${fontFaceCss(pairing)}
/* ── 页面风格：${style.label} ── */
${backgroundCss(style)}
${enterAnimCss(style.enterEffect, style.staggerDelay)}
${cardCss(style.cardStyleId, style.borderRadius)}
${decorationCss()}

/* ── 页面公共 ── */
.pg-root {
  font-size: ${FX_FONT_SCALE.body}px;
  color: var(--fx-text);
  line-height: 1.5;
}
.pg-root * { box-sizing: border-box; }
.pg-title {
  font-family: var(--fx-font-title);
  font-size: ${FX_FONT_SCALE.title}px;
  font-weight: 800;
  color: var(--fx-text);
  line-height: 1.2;
}
.pg-subtitle {
  font-family: var(--fx-font-title);
  font-size: ${FX_FONT_SCALE.subtitle}px;
  font-weight: 600;
  color: var(--fx-text);
  opacity: 0.85;
  line-height: 1.3;
}
.pg-body {
  font-family: var(--fx-font-body);
  font-size: ${FX_FONT_SCALE.body}px;
  color: var(--fx-text);
  line-height: 1.7;
}
.pg-display {
  font-family: var(--fx-font-title);
  font-size: ${FX_FONT_SCALE.display}px;
  font-weight: 900;
  color: var(--fx-accent);
  line-height: 1.1;
}
.pg-caption {
  font-family: var(--fx-font-body);
  font-size: ${FX_FONT_SCALE.caption}px;
  color: var(--fx-text);
  opacity: 0.7;
}
.pg-accent { color: var(--fx-accent); }
.pg-accent2 { color: var(--fx-accent2); }
.pg-badge {
  display: inline-block;
  padding: 6px 20px;
  background: var(--fx-accent);
  color: var(--fx-primary);
  font-size: ${FX_FONT_SCALE.caption}px;
  font-weight: 700;
  border-radius: ${Math.max(style.borderRadius, 4)}px;
}
.pg-divider {
  width: 64px; height: 4px;
  background: var(--fx-accent);
  border-radius: 2px;
}
.pg-cta {
  display: inline-block;
  padding: 16px 48px;
  background: var(--fx-accent);
  color: var(--fx-primary);
  font-family: var(--fx-font-title);
  font-size: ${FX_FONT_SCALE.body}px;
  font-weight: 700;
  border-radius: ${style.borderRadius}px;
  text-align: center;
}

/* ── 布局内容 ── */
${layoutResult.css}`;

  return { html, css };
}

// ── Demo 参数构建 ─────────────────────────────────────────────────────────────

/**
 * 根据布局 zone 类型，生成一组合理的 demo 参数。
 */
export function buildDemoParams(layout: PageLayoutDef): PageParams {
  const params: PageParams = {};
  const zoneTypes = new Set(layout.zones.map((z) => z.type));

  if (zoneTypes.has('title'))    params.title = '示例标题文本';
  if (zoneTypes.has('subtitle')) params.subtitle = '这是一段副标题说明';
  if (zoneTypes.has('body'))     params.body = '正文内容在这里展示，可以是一段较长的描述文字，用于说明主题的详细信息。';
  if (zoneTypes.has('list'))     params.items = ['要点一', '要点二', '要点三'];
  if (zoneTypes.has('data'))     params.data = [
    { label: '增长率', value: '128%' },
    { label: '用户数', value: '50万' },
    { label: '满意度', value: '96%' },
  ];
  if (zoneTypes.has('cta'))      params.cta = '立即了解';
  if (zoneTypes.has('badge'))    params.subtitle = params.subtitle ?? '精选推荐';

  // 通用 fallback
  if (!params.title) params.title = layout.label;

  return params;
}

// ── 工具函数导出 ──────────────────────────────────────────────────────────────

/** 转义 HTML 特殊字符 */
export function escHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 安全区内边距（1920x1080 的 8% = 154px / 86px） */
export const SAFE_PAD = {
  x: 154,
  y: 86,
} as const;

/** 可用内容区域 */
export const CONTENT_AREA = {
  x: SAFE_PAD.x,
  y: SAFE_PAD.y,
  w: 1920 - SAFE_PAD.x * 2,  // 1612
  h: 1080 - SAFE_PAD.y * 2,  // 908
} as const;

/** 重导出字阶、缓动供布局文件使用 */
export { FX_FONT_SCALE, FX_EASINGS };
