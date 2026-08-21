/**
 * sceneDoc — SceneSpec → FxDoc{html, css} 编译器。
 *
 * 产出静态骨架 + 惰性 JSON spec 标签；一切运动由 KPMotion 运行时在两端 hydrate。
 * 结构：
 *   .kp-scene（主题/字体变量、bg）
 *     script[type=application/json][data-kp-scene-spec]
 *     .kp-cam
 *       .kp-layer-pos（定位/锚点） > .kp-layer[data-kp-layer-id]（运行时写 transform）
 *     .kp-flash
 */
import type { SceneLayer, SceneSpec } from './spec';
import { stageCoord } from './spec';
import { themeCssVars, themeOf } from '../editor/fxDesignSystem';
import { fontCssVars, fontFaceCss, pairingOf } from '../editor/fontSystem';
import { styleKitOf } from './styleKits';

const STAGE_W = 1920;
const STAGE_H = 1080;

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(s: string): string {
  return s.replace(/"/g, '&quot;');
}

const ANCHOR_TRANSLATE: Record<string, string> = {
  'center': 'translate(-50%,-50%)',
  'top': 'translate(-50%,0)',
  'bottom': 'translate(-50%,-100%)',
  'left': 'translate(0,-50%)',
  'right': 'translate(-100%,-50%)',
  'top-left': 'none',
  'top-right': 'translate(-100%,0)',
  'bottom-left': 'translate(0,-100%)',
  'bottom-right': 'translate(-100%,-100%)',
};

function styleToCss(style: Record<string, string | number> | undefined): string {
  if (!style) return '';
  return Object.entries(style)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${v}`)
    .join(';');
}

function hasEffect(layer: SceneLayer, type: string): boolean {
  return (layer.effects ?? []).some((f) => f.type === type);
}

function renderLayerHtml(layer: SceneLayer, idPrefix: string): string {
  const fullId = idPrefix ? `${idPrefix}/${layer.id}` : layer.id;
  const anchor = layer.at?.anchor ?? 'center';
  const posStyle = [
    'position:absolute',
    `left:${stageCoord(layer.at?.x, '50%')}`,
    `top:${stageCoord(layer.at?.y, '50%')}`,
    `transform:${ANCHOR_TRANSLATE[anchor] ?? ANCHOR_TRANSLATE.center}`,
    layer.w != null ? `width:${stageCoord(layer.w, 'auto')}` : '',
    layer.h != null ? `height:${stageCoord(layer.h, 'auto')}` : '',
    layer.z != null ? `z-index:${layer.z}` : '',
  ].filter(Boolean).join(';');

  let inner = '';
  switch (layer.kind) {
    case 'text': {
      const text = hasEffect(layer, 'numberRoll')
        ? `<span class="kp-num-value">${esc(layer.text)}</span>`
        : esc(layer.text);
      inner = text;
      break;
    }
    case 'image':
      inner = `<img src="${escAttr(layer.src ?? '')}" alt="" style="display:block;width:100%;height:100%;object-fit:cover" />`;
      break;
    case 'svg':
      inner = layer.svg ?? '';
      break;
    case 'html':
    case 'shape':
      inner = layer.html ?? '';
      break;
    case 'group':
      inner = (layer.children ?? []).map((c) => renderLayerHtml(c, fullId)).join('');
      break;
  }

  const cls = ['kp-layer', layer.class ?? ''].filter(Boolean).join(' ');
  const innerStyle = styleToCss(layer.style);
  return `<div class="kp-layer-pos" style="${posStyle}"><div class="kp-layer ${escAttr(cls)}" data-kp-layer-id="${escAttr(fullId)}"${innerStyle ? ` style="${escAttr(innerStyle)}"` : ''}>${inner}</div></div>`;
}

/** 场景基础 CSS：字阶 / 可读性工具类 / 结构类。所有场景共享（fxRender 按 css hash 去重）
 *
 * 排版精修：大字负字距收紧、抗锯齿、tabular 数字、克制字重（中文苹方 600 比合成 800 更干净）。
 */
export function sceneBaseCss(): string {
  return `
.kp-scene{position:absolute;inset:0;overflow:hidden;font-family:var(--fx-font-body,-apple-system,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif);color:var(--fx-text,#fff);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility}
.kp-cam{position:absolute;inset:0;transform-origin:50% 50%}
.kp-layer-pos{position:absolute;pointer-events:none}
.kp-layer{position:relative;will-change:transform,opacity}
.kp-flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;z-index:99}
.kp-h1{font-size:96px;font-weight:600;line-height:1.08;letter-spacing:-0.025em;font-family:var(--fx-font-title,inherit)}
.kp-h2{font-size:72px;font-weight:600;line-height:1.12;letter-spacing:-0.022em;font-family:var(--fx-font-title,inherit)}
.kp-h3{font-size:56px;font-weight:600;line-height:1.2;letter-spacing:-0.018em;font-family:var(--fx-font-title,inherit)}
.kp-num{font-size:40px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-0.02em}
.kp-sub{font-size:32px;font-weight:500;line-height:1.4;letter-spacing:-0.01em}
.kp-body{font-size:30px;font-weight:400;line-height:1.55}
.kp-label{font-size:18px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;opacity:.8}
.kp-heavy{font-weight:800}
.kp-chip{display:inline-block;padding:.32em .78em;background:var(--fx-surface,rgba(0,0,0,.72));border-radius:.42em}
.kp-stroke{text-shadow:0 0 4px rgba(0,0,0,.9),0 0 12px rgba(0,0,0,.7),2px 2px 2px rgba(0,0,0,.8)}
.kp-shadow{text-shadow:0 4px 24px rgba(0,0,0,.5),0 1px 3px rgba(0,0,0,.55)}
.kp-trail-ghost{position:relative}
.kp-num-value{font-variant-numeric:tabular-nums;font-feature-settings:'tnum'}

/* ── 排版装置 ── */
.kp-mega{font-size:200px;font-weight:800;line-height:0.9;letter-spacing:-0.04em;font-variant-numeric:tabular-nums}
.kp-serif{font-family:'Noto Serif SC','Songti SC',serif;font-weight:500}
.kp-outline{color:transparent;-webkit-text-stroke:2px var(--fx-text);text-stroke:2px var(--fx-text)}
.kp-outline-accent{color:transparent;-webkit-text-stroke:2px var(--fx-accent);text-stroke:2px var(--fx-accent)}
.kp-accent{color:var(--fx-accent)}
.kp-vert{writing-mode:vertical-rl;text-orientation:upright;letter-spacing:0.1em}
.kp-index{font-family:'Space Grotesk',var(--fx-font-title,sans-serif);font-weight:700;font-variant-numeric:tabular-nums;opacity:.9}
.kp-quote-mark{font-family:'Playfair Display','Noto Serif SC',serif;font-size:200px;line-height:0.6;opacity:.18}
.kp-underline{position:relative;display:inline-block}
.kp-underline::after{content:'';position:absolute;left:0;right:0;bottom:-0.14em;height:0.12em;background:var(--fx-accent);border-radius:2px}
.kp-mark{background:linear-gradient(transparent 55%, color-mix(in srgb, var(--fx-accent) 40%, transparent) 55%);padding:0 .08em}
.kp-tag{display:inline-block;padding:.28em .7em;border:1.5px solid currentColor;border-radius:999px;font-size:18px;font-weight:600;letter-spacing:.08em}

/* ── 表面质感 ── */
.kp-noise::before{content:'';position:absolute;inset:0;pointer-events:none;opacity:.05;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
.kp-grid::before{content:'';position:absolute;inset:0;pointer-events:none;opacity:.5;background-image:linear-gradient(color-mix(in srgb,var(--fx-text) 8%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--fx-text) 8%,transparent) 1px,transparent 1px);background-size:64px 64px}
.kp-dots::before{content:'';position:absolute;inset:0;pointer-events:none;opacity:.6;background-image:radial-gradient(color-mix(in srgb,var(--fx-text) 12%,transparent) 1.4px,transparent 1.4px);background-size:40px 40px}
.kp-vignette::after{content:'';position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 75% 75% at 50% 46%,transparent 55%,rgba(0,0,0,.55) 100%)}
.kp-glow{position:absolute;border-radius:50%;filter:blur(80px);pointer-events:none;background:radial-gradient(circle,color-mix(in srgb,var(--fx-accent) 60%,transparent),transparent 70%)}
.kp-glass{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);box-shadow:0 24px 80px rgba(0,0,0,0.4)}
.kp-glass-dark{background:rgba(10,12,20,0.42);border:1px solid rgba(255,255,255,0.09);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px)}
.kp-gradient-border{position:relative;background:var(--fx-surface);border-radius:24px}
.kp-gradient-border::before{content:'';position:absolute;inset:0;padding:2px;border-radius:inherit;background:linear-gradient(135deg,var(--fx-accent),var(--fx-accent2));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none}
.kp-scanline::after{content:'';position:absolute;inset:0;pointer-events:none;opacity:.35;background:repeating-linear-gradient(0deg,transparent 0 2px,rgba(0,0,0,.25) 2px 4px)}
.kp-soft-shadow{box-shadow:0 24px 80px rgba(0,0,0,.4)}
.kp-card{background:var(--fx-surface);border-radius:24px;padding:44px 52px}`.trim();
}

export interface SceneDocResult {
  html: string;
  css: string;
}

/** SceneSpec → FxDoc。调用前必须已过 validateSceneSpec */
export function sceneSpecToDoc(spec: SceneSpec): SceneDocResult {
  const kit = styleKitOf(spec.style);
  const theme = themeOf(spec.theme);
  // style kit 决定字体（除非 spec.fonts 显式覆盖）
  const fontIds = spec.fonts?.length ? spec.fonts : (kit ? [kit.fontPairing] : []);
  const pairings = fontIds.map((f) => pairingOf(f));
  const mainPairing = pairings[0];
  const useBackdrop = spec.styleBackdrop !== false;

  const bgValue = spec.bgCss ?? (kit ? kit.bgCss : theme.primary);
  const bg = spec.bg === 'opaque' ? `background:${bgValue};` : 'background:transparent;';

  // 变量层叠：theme 基底 → style kit 覆盖
  const kitVars = kit ? Object.entries(kit.cssVars).map(([k, v]) => `${k}: ${v}`).join('; ') : '';
  const vars = [
    themeCssVars(theme),
    mainPairing ? fontCssVars(mainPairing) : '',
    kitVars,
  ].filter(Boolean).join('; ');

  const layersHtml = spec.layers.map((l) => renderLayerHtml(l, '')).join('\n');
  const specJson = JSON.stringify(spec).replace(/<\//g, '<\\/');

  // style kit 签名装饰：backdrop 在 kp-cam 内随镜头动、foreground 压在最上不随镜头
  const kitBackdrop = kit && useBackdrop && kit.backdropHtml
    ? `<div class="kp-kit-backdrop" style="position:absolute;inset:0;z-index:0;pointer-events:none">${kit.backdropHtml}</div>`
    : '';
  const kitForeground = kit && useBackdrop && kit.foregroundHtml
    ? `<div class="kp-kit-foreground" style="position:absolute;inset:0;z-index:90;pointer-events:none">${kit.foregroundHtml}</div>`
    : '';

  const html = [
    `<div class="kp-scene${kit ? ` kit-${escAttr(kit.id)}` : ''}" style="${escAttr(`${bg}${vars}`)}" data-kp-stage="${STAGE_W}x${STAGE_H}">`,
    `<script type="application/json" data-kp-scene-spec>${specJson}</script>`,
    kitBackdrop,
    `<div class="kp-cam">`,
    layersHtml,
    `</div>`,
    kitForeground,
    `<div class="kp-flash"></div>`,
    `</div>`,
  ].filter(Boolean).join('\n');

  const fontCss = pairings.map((p) => fontFaceCss(p)).filter(Boolean).join('\n');
  const css = [fontCss, sceneBaseCss(), kit?.css ?? ''].filter(Boolean).join('\n');

  return { html, css };
}
