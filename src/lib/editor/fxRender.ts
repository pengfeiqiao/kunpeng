/**
 * fxRender — HyperFrames 渲染管线："Write HTML. Render video."
 *
 * 预览：HTML 挂进沙盒层，WAAPI 全量 seek（暂停态逐帧可预览，与导出一致）。
 * 导出：离屏舞台逐帧 seek → html2canvas 栅格化（透明底）→ PNG 序列写盘
 *      （~/.kunpeng/fxcache/{hash}/）→ composeEngine 用 overlay 叠进成片。
 *
 * 约束：单条 ≤15s（fxDesignSystem.FX_DURATIONS.totalMax）；模板/组件只用
 * html2canvas 支持的 CSS 子集（无 3D transform / backdrop-filter）。
 * 舞台基准 1920×1080，导出分辨率经 html2canvas scale 适配。
 */
import html2canvas from 'html2canvas';
import { writeBinaryFile, writeTextFile, createDir, exists, readTextFile, BaseDirectory } from '@tauri-apps/api/fs';
import { homeDir, resourceDir } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/tauri';
import { stopBackgroundProcessCommand, isWindowsSync } from '@/lib/platform';
import MOTION_RUNTIME_SRC from '../../../scripts/motion-runtime.js?raw';
import { KP_MOTION_VERSION } from '@/lib/motion/runtimeVersion';
import { DEFAULT_FX_TRANSFORM, useEditorStore, type EditorRenderError, type TextClip, type FxClip } from '@/stores/editorStore';
import { findTextTemplate } from './presets/textTemplates';
import { themeCssVars, themeOf, FX_SAFE_MARGIN } from './fxDesignSystem';
import { detectFfmpeg } from '@/lib/canvas/videoCompose';

export const FX_STAGE_W = 1920;
export const FX_STAGE_H = 1080;
const FX_CSS_SCOPE_VERSION = 2;
const FX_CSS_SCOPE_MARK = 'kp-fx-scoped';

export interface FxDoc {
  html: string;
  css: string;
}

function reportRenderError(error: Omit<EditorRenderError, 'at'>): void {
  try {
    useEditorStore.getState().setLastRenderError({ ...error, at: Date.now() });
  } catch (err) {
    console.warn('[fxRender] failed to report render error', err);
  }
}

export function hashContent(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// ── 文档构建 ──────────────────────────────────────────────────────────────────

/** TextClip → 完整舞台文档（模板实例化 + position 包裹） */
export function buildTextClipDoc(t: TextClip, themeId?: string): FxDoc {
  const tpl = findTextTemplate(t.templateId) ?? findTextTemplate('sub-clean')!;
  const { html, css } = tpl.render(t.text, t.styleOverrides);
  const safePct = (FX_SAFE_MARGIN * 100).toFixed(0);
  let posStyle: string;
  switch (t.position) {
    case 'top': posStyle = `left:50%;top:${safePct}%;transform:translateX(-50%)`; break;
    case 'bottom': posStyle = `left:50%;bottom:${safePct}%;transform:translateX(-50%)`; break;
    case 'custom': {
      const x = 50 + (t.customPos?.x ?? 0) * 100;
      const y = 50 + (t.customPos?.y ?? 0) * 100;
      posStyle = `left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;transform:translate(-50%,-50%)`;
      break;
    }
    default: posStyle = 'left:50%;top:50%;transform:translate(-50%,-50%)';
  }
  return {
    html: `<div style="position:absolute;inset:0;${themeCssVars(themeOf(themeId))}"><div style="position:absolute;${posStyle}">${html}</div></div>`,
    css,
  };
}

/** FxClip → 舞台文档（组件实例化产物已是完整 fx-root，custom 同构） */
export function buildFxClipDoc(f: FxClip): FxDoc {
  const tr = f.transform ?? DEFAULT_FX_TRANSFORM;
  const scale = Math.max(0.05, Math.min(2, tr.scale));
  const opacity = Math.max(0, Math.min(1, tr.opacity));
  const x = Math.max(-1, Math.min(1, tr.x)) * 100;
  const y = Math.max(-1, Math.min(1, tr.y)) * 100;
  const rotation = Math.max(-180, Math.min(180, tr.rotation));
  return {
    html: `<div style="position:absolute;inset:0;transform-origin:center center;transform:translate(${x.toFixed(3)}%,${y.toFixed(3)}%) scale(${scale.toFixed(4)}) rotate(${rotation.toFixed(3)}deg);opacity:${opacity.toFixed(3)};pointer-events:none">${f.html}</div>`,
    css: f.css,
  };
}

export function textClipHash(t: TextClip): string {
  return hashContent(`${t.templateId}|${t.text}|${t.position}|${JSON.stringify(t.styleOverrides ?? {})}|${JSON.stringify(t.customPos ?? {})}`);
}

export function fxClipHash(f: FxClip): string {
  return hashContent(`${f.html}|${f.css}|${f.theme ?? ''}|${JSON.stringify(f.transform ?? DEFAULT_FX_TRANSFORM)}`);
}

// ── 舞台挂载与 seek ───────────────────────────────────────────────────────────

interface KPMotionApi {
  version: string;
  hydrate(host: HTMLElement): { renderFrame(t: number): void; dispose(): void } | null;
  renderFrame(host: HTMLElement, t: number): void;
  dispose(host: HTMLElement): void;
}

type MotionStage = HTMLElement & {
  __kpMotion?: { renderFrame(t: number): void; dispose(): void } | null;
};

type FreePageStage = HTMLElement & {
  __kunpengRenderFrame?: (t: number) => unknown;
  __installFreePageScripts?: () => void;
  __freePageScriptsInstalled?: boolean;
};

let freePageStageSequence = 0;

/** 预览端注入 KPMotion 运行时（与导出 worker 内联的是同一份 IIFE 产物） */
function ensureMotionRuntime(): KPMotionApi | null {
  const w = window as Window & { KPMotion?: KPMotionApi };
  if (w.KPMotion?.version === KP_MOTION_VERSION) return w.KPMotion;
  try {
    new Function(`${MOTION_RUNTIME_SRC}\n//# sourceURL=kp-motion-runtime.js`).call(window);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[fxRender] motion runtime install failed', err);
    reportRenderError({ source: 'motion-runtime', message });
    return null;
  }
  return w.KPMotion ?? null;
}


interface FxStyleRef {
  count: number;
  el: HTMLStyleElement;
}

const fxStyleRefs = new Map<string, FxStyleRef>();

function fxStyleId(css: string): string {
  return `fx-style-${hashContent(css)}`;
}

function splitSelectorList(selectorText: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < selectorText.length; i++) {
    const ch = selectorText[i];
    const prev = selectorText[i - 1];
    if (quote) {
      if (ch === quote && prev !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[') depth += 1;
    else if ((ch === ')' || ch === ']') && depth > 0) depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push(selectorText.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(selectorText.slice(start));
  return parts;
}

function scopeSingleSelector(selector: string, scopeClass: string): string {
  const scope = `.${scopeClass}`;
  const raw = selector.trim();
  if (!raw) return raw;
  if (raw === '*' || raw === '*, *::before, *::after') return `${scope}, ${scope} *`;
  if (raw === 'html' || raw === 'body' || raw === ':root') return scope;
  if (raw.startsWith(scope)) return raw;

  let next = raw
    .replace(/^html\s+body(?=($|[\s.#:[>+~]))/i, scope)
    .replace(/^(html|body|:root)(?=($|[\s.#:[>+~]))/i, scope);
  if (next !== raw) return next;

  if (raw.startsWith('*')) return `${scope} ${raw}`;
  return `${scope} ${raw}`;
}

function scopeSelectorText(selectorText: string, scopeClass: string): string {
  return splitSelectorList(selectorText)
    .map((selector) => {
      const leading = selector.match(/^\s*/)?.[0] ?? '';
      const trailing = selector.match(/\s*$/)?.[0] ?? '';
      return `${leading}${scopeSingleSelector(selector, scopeClass)}${trailing}`;
    })
    .join(',');
}

function findRuleOpen(css: string, from: number): number {
  let quote: '"' | "'" | null = null;
  for (let i = from; i < css.length; i++) {
    const ch = css[i];
    const prev = css[i - 1];
    if (quote) {
      if (ch === quote && prev !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end >= 0 ? end + 1 : css.length;
      continue;
    }
    if (ch === '{') return i;
  }
  return -1;
}

function findMatchingBrace(css: string, open: number): number {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  for (let i = open; i < css.length; i++) {
    const ch = css[i];
    const prev = css[i - 1];
    if (quote) {
      if (ch === quote && prev !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end >= 0 ? end + 1 : css.length;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return css.length - 1;
}

function scopeCssRules(css: string, scopeClass: string): string {
  let out = '';
  let cursor = 0;
  while (cursor < css.length) {
    const open = findRuleOpen(css, cursor);
    if (open < 0) {
      out += css.slice(cursor);
      break;
    }
    const close = findMatchingBrace(css, open);
    const prelude = css.slice(cursor, open);
    const body = css.slice(open + 1, close);
    const name = prelude.trim().toLowerCase();

    if (/^@(?:-webkit-)?keyframes\b/.test(name) || /^@(font-face|property|page|import)\b/.test(name)) {
      out += `${prelude}{${body}}`;
    } else if (/^@(media|supports|container|layer)\b/.test(name)) {
      out += `${prelude}{${scopeCssRules(body, scopeClass)}}`;
    } else if (name.startsWith('@')) {
      out += `${prelude}{${body}}`;
    } else {
      out += `${scopeSelectorText(prelude, scopeClass)}{${body}}`;
    }
    cursor = close + 1;
  }
  return out;
}

export function prepareFxDocForStage(doc: FxDoc): FxDoc {
  if (doc.css.includes(FX_CSS_SCOPE_MARK)) return doc;
  const scopeClass = `kp-fx-scope-${hashContent(`${doc.html}\n${doc.css}`)}`;
  return {
    html: `<div class="${scopeClass}" style="position:absolute;inset:0;overflow:hidden">${doc.html}</div>`,
    css: `/* ${FX_CSS_SCOPE_MARK}:${scopeClass} */\n${scopeCssRules(doc.css, scopeClass)}`,
  };
}

function releaseFxStyle(id: string): void {
  const ref = fxStyleRefs.get(id);
  if (!ref) return;
  ref.count -= 1;
  if (ref.count > 0) return;
  ref.el.remove();
  fxStyleRefs.delete(id);
}

function retainFxStyle(css: string): { id: string; release: () => void } {
  const id = fxStyleId(css);
  const existing = fxStyleRefs.get(id);
  if (existing) {
    existing.count += 1;
    return { id, release: () => releaseFxStyle(id) };
  }

  let el = document.head.querySelector<HTMLStyleElement>(`style[data-fx-style="${id}"]`);
  if (!el) {
    el = document.createElement('style');
    el.dataset.fxStyle = id;
    document.head.appendChild(el);
  }
  el.textContent = css;
  fxStyleRefs.set(id, { count: 1, el });
  return { id, release: () => releaseFxStyle(id) };
}

/** 创建舞台 DOM（不挂载）。preview 缩放由调用方包一层 transform scale */
export function createFxStage(doc: FxDoc): HTMLDivElement {
  const scopedDoc = prepareFxDocForStage(doc);
  const stage = document.createElement('div');
  stage.dataset.fxStageId = String(++freePageStageSequence);
  stage.style.cssText = `position:relative;width:${FX_STAGE_W}px;height:${FX_STAGE_H}px;overflow:hidden;background:transparent;`;
  const styleRef = retainFxStyle(scopedDoc.css);
  stage.dataset.fxStyle = styleRef.id;
  (stage as HTMLDivElement & { __releaseFxStyle?: () => void }).__releaseFxStyle = styleRef.release;
  const localStyle = document.createElement('style');
  localStyle.dataset.fxLocalStyle = styleRef.id;
  localStyle.textContent = scopedDoc.css;
  stage.appendChild(localStyle);
  const content = document.createElement('div');
  content.style.cssText = 'position:absolute;inset:0';
  content.innerHTML = scopedDoc.html;
  stage.appendChild(content);
  if (content.querySelector('script[data-kp-scene-spec]')) {
    const motion = ensureMotionRuntime();
    (stage as MotionStage).__kpMotion = motion ? motion.hydrate(content) : null;
    if (motion && !(stage as MotionStage).__kpMotion) {
      reportRenderError({ source: 'preview', message: 'KPMotion hydrate 返回空实例：Scene Spec 可能缺字段、DOM 骨架不完整或运行时无法识别。' });
    }
  }
  if (content.querySelector('script')) {
    const freePageStage = stage as FreePageStage;
    freePageStage.__installFreePageScripts = () => {
      if (freePageStage.__freePageScriptsInstalled || !stage.isConnected) return;
      freePageStage.__freePageScriptsInstalled = true;
      installFreePageScripts(stage, content);
    };
  }
  return stage;
}

/** Execute free-page scripts only after the stage belongs to the live document. */
export function activateFxStage(stage: HTMLElement): void {
  (stage as FreePageStage).__installFreePageScripts?.();
}

export function destroyFxStage(stage: HTMLElement): void {
  (stage as MotionStage).__kpMotion?.dispose();
  (stage as MotionStage).__kpMotion = null;
  (stage as HTMLElement & { __releaseFxStyle?: () => void }).__releaseFxStyle?.();
  delete (stage as FreePageStage).__installFreePageScripts;
  delete (stage as FreePageStage).__kunpengRenderFrame;
  stage.replaceChildren();
}

/** WAAPI 全量 seek（暂停所有动画并定位到 ms）。预览与导出共用，保证一致 */
export function seekStage(stage: HTMLElement, ms: number): void {
  activateFxStage(stage);
  (stage as MotionStage).__kpMotion?.renderFrame(Math.max(0, ms / 1000));
  const renderFrame = (stage as HTMLElement & { __kunpengRenderFrame?: (t: number) => unknown }).__kunpengRenderFrame;
  if (renderFrame) {
    try {
      renderFrame(Math.max(0, ms / 1000));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[fxRender] __kunpengRenderFrame failed', err);
      reportRenderError({ source: 'free-page', message });
    }
  }
  for (const anim of stage.getAnimations({ subtree: true })) {
    anim.pause();
    anim.currentTime = ms;
  }
  for (const video of stage.querySelectorAll<HTMLVideoElement>('video')) {
    video.muted = true;
    video.pause();
    const offset = Number(video.dataset.kpOffsetSec || 0);
    const rate = Math.max(0.01, Number(video.dataset.kpRate || 1));
    let target = Math.max(0, ms / 1000 - offset) * rate;
    if (Number.isFinite(video.duration) && video.duration > 0) {
      target = video.dataset.kpLoop === 'false'
        ? Math.min(video.duration, target)
        : target % video.duration;
    }
    if (Number.isFinite(target) && Math.abs(video.currentTime - target) > 0.025) {
      try { video.currentTime = target; } catch { /* metadata may still be loading */ }
    }
  }
}

function installFreePageScripts(stage: HTMLElement, content: HTMLElement): void {
  const scripts = Array.from(content.querySelectorAll('script'));
  if (scripts.length === 0) return;
  const expectsRenderFrame = Boolean(content.querySelector('[data-kp-motion-mode="ae"]'))
    || scripts.some((script) => /__kunpengRenderFrame\s*=/.test(script.textContent ?? ''));
  const previous = (window as Window & { __kunpengRenderFrame?: (t: number) => unknown }).__kunpengRenderFrame;
  const nativeDocument = document;
  const scopedDocument = new Proxy(nativeDocument, {
    get(target, property) {
      if (property === 'getElementById') {
        return (id: string) => content.querySelector<HTMLElement>(`#${CSS.escape(id)}`) ?? target.getElementById(id);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  try {
    for (const script of scripts) {
      if (script.src) continue;
      // scene spec 等数据标签不是可执行 JS，保留在 DOM 里供运行时读取
      if (script.type && script.type !== 'text/javascript' && script.type !== 'module') continue;
      const code = script.textContent?.trim();
      script.remove();
      if (!code) continue;
      // Free pages may define window.__kunpengRenderFrame(t). Capture it onto
      // this stage so multiple previews do not fight over a global function.
      const sourceId = stage.dataset.fxStageId || 'unknown';
      new Function('window', 'document', `${code}\n//# sourceURL=kunpeng-free-page-${sourceId}.js`)
        .call(window, window, scopedDocument);
    }
    const renderFrame = (window as Window & { __kunpengRenderFrame?: (t: number) => unknown }).__kunpengRenderFrame;
    if (typeof renderFrame === 'function') {
      (stage as HTMLElement & { __kunpengRenderFrame?: (t: number) => unknown }).__kunpengRenderFrame = renderFrame;
    } else if (expectsRenderFrame) {
      reportRenderError({
        source: 'free-page',
        message: '自由页面脚本已加载，但没有成功定义 window.__kunpengRenderFrame(t)。动画将保持静止，请检查脚本初始化错误。',
      });
    }
  } catch (err) {
    const location = err instanceof Error ? err.stack?.split('\n').slice(1, 2).join(' ').trim() : '';
    const message = `${err instanceof Error ? err.message : String(err)}${location ? `（${location}）` : ''}`;
    console.warn('[fxRender] free page script failed', err);
    reportRenderError({ source: 'free-page', message });
  } finally {
    if (previous) (window as Window & { __kunpengRenderFrame?: (t: number) => unknown }).__kunpengRenderFrame = previous;
    else delete (window as Window & { __kunpengRenderFrame?: (t: number) => unknown }).__kunpengRenderFrame;
  }
}

// ── 导出栅格化 ────────────────────────────────────────────────────────────────

export interface FxRenderOptions {
  fps: number;
  durationSec: number;
  /** 导出宽度（舞台 16:9 等比缩放；9:16 由 composeEngine 后续裁切） */
  width: number;
  cacheKey: string;
  timeOffsetSec?: number;
  alphaCodec?: 'prores' | 'qtrle';
  opaqueBackground?: boolean;
  freezeAfterSec?: number | false;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  onTimelineProgress?: (p: FxTimelineProgress) => void;
}

export interface FxLayerResult {
  framesDir: string;
  /** 透明模式为 alpha.mov；黑底普通视频模式为 layer.mp4。 */
  alphaMovPath: string;
  renderer: 'chromium-worker' | 'html2canvas-fallback';
}

export interface FxSegmentLayerResult extends FxLayerResult {
  id: string;
  startSec: number;
  durationSec: number;
}

export interface FxTimelineLayerItem {
  id: string;
  startSec: number;
  durationSec: number;
  doc: FxDoc;
}

interface CommandResult { stdout: string; stderr: string; exit_code: number }

export interface FxTimelineProgress {
  stage: 'cache' | 'browser' | 'load' | 'frames' | 'encode' | 'segment' | 'concat' | 'done';
  done?: number;
  total?: number;
  segmentIndex?: number;
  segmentCount?: number;
  detail?: string;
  elapsedSec?: number;
}

// 串行渲染队列（html2canvas 并发会争 DOM/内存）
let renderQueue: Promise<unknown> = Promise.resolve();
const activeWorkerLayers = new Map<string, Promise<void>>();

const CONTINUOUS_ANIMATION_RE = /\b(__kunpengRenderFrame|<script\b|infinite|animation-delay|requestAnimationFrame|setInterval|setTimeout|canvas|lottie|\.gif\b|\.webm\b|\.mp4\b|<video|<canvas)\b/i;
const ANIMATION_DECL_RE = /animation(?:-[\w-]+)?\s*:[^;{}]+/gi;
const SECOND_VALUE_RE = /(-?\d*\.?\d+)s\b/gi;

function maxCssAnimationTimeSec(css: string): number {
  let max = 0;
  for (const decl of css.match(ANIMATION_DECL_RE) ?? []) {
    const values = [...decl.matchAll(SECOND_VALUE_RE)].map((m) => Number(m[1])).filter((n) => Number.isFinite(n) && n > 0);
    if (values.length > 0) max = Math.max(max, values.reduce((a, b) => a + b, 0));
  }
  return max;
}

function safeFreezeAfterSec(doc: FxDoc, durationSec: number): number | false {
  const source = `${doc.html}\n${doc.css}`;
  const explicit = /\bdata-kp-freeze-after\s*=\s*["']([\d.]+)["']/i.exec(source)
    ?? /--kp-freeze-after\s*:\s*([\d.]+)s/i.exec(source);
  if (explicit) {
    const sec = Number(explicit[1]);
    return Number.isFinite(sec) && sec > 0.5 && sec < durationSec - 0.75 ? sec : false;
  }
  // KPMotion scene：动画全部由 JS 每帧驱动（无 CSS animation），启发式会误判静止，禁冻结
  if (/data-kp-scene-spec/.test(source)) return false;
  if (/mode\s*:\s*['"]?free-page|class\s*=\s*["'][^"']*\bpage\b/i.test(source)) return false;
  if (durationSec < 3 || CONTINUOUS_ANIMATION_RE.test(source)) return false;
  const animationCount = (source.match(/\banimation(?:-[\w-]+)?\s*:/gi) ?? []).length;
  if (animationCount > 3) return false;
  const maxAnim = maxCssAnimationTimeSec(doc.css);
  if (maxAnim > Math.min(3.5, durationSec * 0.35)) return false;
  const freezeAt = Math.max(1.2, Math.min(3.5, maxAnim + 0.4));
  return freezeAt < durationSec - 0.75 ? freezeAt : false;
}

function isProbablyOpaqueFullPage(doc: FxDoc): boolean {
  const source = `${doc.html}\n${doc.css}`;
  if (/\b(sub-clean|caption|subtitle)\b/i.test(source)) return false;
  if (/background\s*:\s*(?:transparent|none|rgba\([^)]*,\s*0\s*\))/i.test(source)) return false;
  return /fx-root|pg-root|pg-bg-base|position\s*:\s*absolute\s*;\s*inset\s*:\s*0/i.test(source)
    && /background\s*:\s*(?!transparent|none)/i.test(source);
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function abortError(): Error {
  return new Error('已停止导出');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function commandRequestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * 渲染舞台文档为透明 PNG 帧序列，返回帧目录绝对路径。
 * 缓存命中（目录含 done.txt）直接返回，内容变更由 cacheKey 中的 hash 保证失效。
 */
export function renderToFrames(doc: FxDoc, opts: FxRenderOptions): Promise<string> {
  const task = renderQueue.then(() => doRender(doc, opts));
  renderQueue = task.catch(() => {});
  return task;
}

async function doRender(doc: FxDoc, opts: FxRenderOptions): Promise<string> {
  throwIfAborted(opts.signal);
  const home = await homeDir();
  const relDir = `.kunpeng/fxcache/${opts.cacheKey}`;
  const absDir = `${home}${relDir}`;
  const doneRel = `${relDir}/done.txt`;

  if (await exists(doneRel, { dir: BaseDirectory.Home })) return absDir;
  await createDir(relDir, { dir: BaseDirectory.Home, recursive: true });

  // 离屏挂载（不能 display:none——WAAPI/排版需要真实布局）
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;left:-99999px;top:0;pointer-events:none;';
  const stage = createFxStage(doc);
  wrap.appendChild(stage);
  document.body.appendChild(wrap);
  activateFxStage(stage);

  try {
    const total = Math.max(1, Math.round(opts.durationSec * opts.fps));
    const scale = opts.width / FX_STAGE_W;
    for (let i = 0; i < total; i++) {
      throwIfAborted(opts.signal);
      seekStage(stage, (i / opts.fps) * 1000);
      // 等一帧让样式生效
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const canvas = await html2canvas(stage, {
        backgroundColor: null,
        width: FX_STAGE_W,
        height: FX_STAGE_H,
        scale,
        logging: false,
      });
      const bytes = dataUrlToBytes(canvas.toDataURL('image/png'));
      await writeBinaryFile(`${relDir}/f${String(i).padStart(5, '0')}.png`, bytes, { dir: BaseDirectory.Home });
      throwIfAborted(opts.signal);
      opts.onProgress?.(i + 1, total);
    }
    await writeTextFile(doneRel, String(Date.now()), { dir: BaseDirectory.Home });
    return absDir;
  } finally {
    destroyFxStage(stage);
    wrap.remove();
  }
}

function shq(p: string): string {
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

async function commandOk(command: string, timeoutMs = 5000): Promise<boolean> {
  const r = await invoke<CommandResult>('execute_command', { command, timeoutMs })
    .catch(() => ({ stdout: '', stderr: '', exit_code: 1 }));
  return r.exit_code === 0;
}

// Windows 常见安装位置 + PATH 兜底；Git Bash 下 PATH 查找即可命中。
// WebView 里没有 process（Vite 产物中 process.env 被替换为 {}），
// 不要读 process.env.ProgramFiles——它恒为 undefined，直接写默认路径。
const NODE_CANDIDATES = isWindowsSync()
  ? [
      'C:\\Program Files\\nodejs\\node.exe',
      'node',
      'node.exe',
    ]
  : ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node', 'node'];
let cachedNodeCommand: string | null | undefined;

async function detectNodeCommand(): Promise<string | null> {
  if (cachedNodeCommand !== undefined) return cachedNodeCommand;
  for (const bin of NODE_CANDIDATES) {
    if (await commandOk(`${shq(bin)} --version`, 5000)) {
      cachedNodeCommand = bin;
      return bin;
    }
  }
  cachedNodeCommand = null;
  return null;
}

async function writeJsonViaShell(path: string, data: unknown): Promise<void> {
  const json = JSON.stringify(data);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  const b64 = btoa(bin);
  const script = [
    "python3 - <<'PY'",
    'import base64, pathlib',
    `path = ${JSON.stringify(path)}`,
    `data = ${JSON.stringify(b64)}`,
    'pathlib.Path(path).parent.mkdir(parents=True, exist_ok=True)',
    'pathlib.Path(path).write_bytes(base64.b64decode(data))',
    'PY',
  ].join('\n');
  const r = await invoke<CommandResult>('execute_command', { command: script, timeoutMs: 15000 });
  if (r.exit_code !== 0) throw new Error(`写入渲染任务失败: ${r.stderr || r.stdout}`);
}

async function writeTextViaShell(path: string, text: string): Promise<void> {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  const b64 = btoa(bin);
  const script = [
    "python3 - <<'PY'",
    'import base64, pathlib',
    `path = ${JSON.stringify(path)}`,
    `data = ${JSON.stringify(b64)}`,
    'pathlib.Path(path).parent.mkdir(parents=True, exist_ok=True)',
    'pathlib.Path(path).write_bytes(base64.b64decode(data))',
    'PY',
  ].join('\n');
  const r = await invoke<CommandResult>('execute_command', { command: script, timeoutMs: 15000 });
  if (r.exit_code !== 0) throw new Error(`写入渲染文件失败: ${r.stderr || r.stdout}`);
}

async function runShell(command: string, timeoutMs = 600000, signal?: AbortSignal, requestPrefix = 'fx-render'): Promise<CommandResult> {
  throwIfAborted(signal);
  const requestId = commandRequestId(requestPrefix);
  const onAbort = () => {
    void invoke('kill_command', { requestId }).catch(() => {});
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  let r: CommandResult;
  try {
    // Rust 端 timeoutMs 是 u64，浮点会直接反序列化失败（曾因 durationSec*30000 卡死导出）
    r = await invoke<CommandResult>('execute_command', { command, timeoutMs: Math.ceil(timeoutMs), requestId });
  } catch (err) {
    throwIfAborted(signal);
    throw err;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
  throwIfAborted(signal);
  if (r.exit_code !== 0) throw new Error(r.stderr || r.stdout || `命令失败: ${command}`);
  return r;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readTextIfExists(path: string): Promise<string> {
  return readTextFile(path).catch(() => '');
}

async function acquireRenderLock(absDir: string, signal?: AbortSignal): Promise<() => Promise<void>> {
  const lockDir = `${absDir}.lock`;
  for (;;) {
    throwIfAborted(signal);
    const locked = await commandOk(`mkdir ${shq(lockDir)} 2>/dev/null && date +%s > ${shq(`${lockDir}/created`)}`);
    if (locked) {
      return async () => {
        await invoke<CommandResult>('execute_command', { command: `rm -rf ${shq(lockDir)}`, timeoutMs: 5000 }).catch(() => null);
      };
    }
    const age = await invoke<CommandResult>('execute_command', {
      command: `if [ -f ${shq(`${lockDir}/created`)} ]; then echo $(( $(date +%s) - $(cat ${shq(`${lockDir}/created`)} 2>/dev/null || echo 0) )); else echo 999999; fi`,
      timeoutMs: 5000,
    }).catch(() => ({ stdout: '999999', stderr: '', exit_code: 0 }));
    if (Number(age.stdout.trim()) > 7200) {
      await invoke<CommandResult>('execute_command', { command: `rm -rf ${shq(lockDir)}`, timeoutMs: 5000 }).catch(() => null);
      continue;
    }
    await sleep(1000);
  }
}

function formatProgressEta(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '计算中';
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${String(r).padStart(2, '0')}s` : `${r}s`;
}

async function appendRenderDebug(absDir: string, event: string, data: Record<string, unknown>): Promise<void> {
  const home = await homeDir().catch(() => '');
  if (!home) return;
  const path = `${home}.kunpeng/render-debug/latest.jsonl`;
  const line = JSON.stringify({ time: new Date().toISOString(), event, outputDir: absDir, ...data }) + '\n';
  await invoke('append_file', { path, content: line }).catch(() => null);
}

async function runWorkerShellWithProgress(args: {
  command: string;
  timeoutMs: number;
  progressPath: string;
  logPath: string;
  exitPath: string;
  absDir: string;
  layerName: string;
  signal?: AbortSignal;
  onProgress?: FxRenderOptions['onTimelineProgress'];
}): Promise<void> {
  const start = Date.now();
  await appendRenderDebug(args.absDir, 'worker-start', { command: args.command, progressPath: args.progressPath });
  const workerScript = `${args.command} > ${shq(args.logPath)} 2>&1; echo $? > ${shq(args.exitPath)}`;
  const launch = [
    `rm -f ${shq(args.progressPath)} ${shq(args.logPath)} ${shq(args.exitPath)}`,
    `nohup sh -c ${shq(workerScript)} </dev/null >/dev/null 2>&1 & echo $!`,
  ].join('; ');
  const launched = await invoke<CommandResult>('execute_command', { command: launch, timeoutMs: 30000 });
  const pid = launched.stdout.trim().split(/\s+/).pop();
  if (!pid || launched.exit_code !== 0) {
    throw new Error(`启动特效渲染失败: ${launched.stderr || launched.stdout}`);
  }

  const stopProcess = async (force = false) => {
    await invoke<CommandResult>('execute_command', {
      command: stopBackgroundProcessCommand(pid, force),
      timeoutMs: 5000,
    }).catch(() => null);
  };

  let lastProgress = '';
  while (true) {
    if (args.signal?.aborted) {
      await stopProcess(false);
      await sleep(600);
      await stopProcess(true);
      await appendRenderDebug(args.absDir, 'worker-abort', {});
      throw abortError();
    }

    const elapsedSec = (Date.now() - start) / 1000;
    if (elapsedSec * 1000 > args.timeoutMs) {
      await stopProcess(false);
      const log = await readTextIfExists(args.logPath);
      await appendRenderDebug(args.absDir, 'worker-timeout', { elapsedSec, logTail: log.slice(-1200) });
      throw new Error(`${args.layerName}渲染超时，已运行 ${formatProgressEta(elapsedSec)}。诊断日志: ~/.kunpeng/render-debug/latest.jsonl`);
    }

    const progressText = await readTextIfExists(args.progressPath);
    if (progressText && progressText !== lastProgress) {
      lastProgress = progressText;
      try {
        const p = JSON.parse(progressText) as { event?: string; done?: number; total?: number; chrome?: string; outputPath?: string; reason?: string };
        const total = Number(p.total ?? 0);
        const done = Number(p.done ?? 0);
        const etaSec = total > 0 && done > 0 ? elapsedSec * (total - done) / done : undefined;
        const event = p.event ?? 'frames';
        await appendRenderDebug(args.absDir, 'worker-progress', { event, done, total, elapsedSec });
        if (event === 'browser') args.onProgress?.({ stage: 'browser', detail: '启动渲染浏览器', elapsedSec });
        else if (event === 'load') args.onProgress?.({ stage: 'load', detail: '加载特效页面', elapsedSec });
        else if (event === 'encode' || event === 'encode-fallback') args.onProgress?.({ stage: 'encode', done, total, detail: `编码${args.layerName} · 已运行 ${formatProgressEta(elapsedSec)}`, elapsedSec });
        else if (event === 'done') args.onProgress?.({ stage: 'done', done: 1, total: 1, detail: `${args.layerName}完成`, elapsedSec });
        else if (event === 'error') args.onProgress?.({ stage: 'segment', done, total, detail: `浏览器渲染失败：${p.reason ?? '未知错误'}`, elapsedSec });
        else args.onProgress?.({
          stage: 'frames',
          done,
          total,
          detail: total > 0 ? `截图 ${done}/${total} · 已运行 ${formatProgressEta(elapsedSec)} · 剩余 ${formatProgressEta(etaSec ?? -1)}` : `截图中 · 已运行 ${formatProgressEta(elapsedSec)}`,
          elapsedSec,
        });
      } catch {
        // Ignore partial writes.
      }
    }

    const exitText = await readTextIfExists(args.exitPath);
    if (exitText.trim()) {
      const code = Number(exitText.trim());
      if (code === 0) {
        await appendRenderDebug(args.absDir, 'worker-complete', { elapsedSec });
        return;
      }
      const log = await readTextIfExists(args.logPath);
      await appendRenderDebug(args.absDir, 'worker-failed', { code, logTail: log.slice(-1600) });
      throw new Error(`Worker 渲染失败: ${log.slice(-1200) || `exit ${code}`}`);
    }

    const alive = await invoke<CommandResult>('execute_command', { command: `kill -0 ${pid} 2>/dev/null && echo OK || true`, timeoutMs: 3000 })
      .catch(() => ({ stdout: '', stderr: '', exit_code: 1 }));
    if (!alive.stdout.includes('OK')) {
      const log = await readTextIfExists(args.logPath);
      await appendRenderDebug(args.absDir, 'worker-lost', { logTail: log.slice(-1200) });
      throw new Error(`特效渲染进程意外结束: ${log.slice(-1200) || '没有日志'}`);
    }
    await sleep(750);
  }
}

async function runWorkerLayer(doc: FxDoc, opts: FxRenderOptions): Promise<FxLayerResult> {
  throwIfAborted(opts.signal);
  const scopedDoc = prepareFxDocForStage(doc);
  const workerHtml = scopedDoc.html.replace(
    /(?:asset:\/\/localhost|https?:\/\/asset\.localhost)\/([^"'\s)<>]+)/gi,
    (_match, encodedPath: string) => {
      try {
        const decoded = decodeURIComponent(encodedPath);
        const absolute = decoded.startsWith('/') ? decoded : `/${decoded}`;
        return encodeURI(`file://${absolute}`);
      } catch {
        return _match;
      }
    },
  );
  const ffmpeg = await detectFfmpeg();
  if (!ffmpeg) throw new Error('未检测到 ffmpeg');
  const home = await homeDir();
  const freezeKey = opts.freezeAfterSec && Number.isFinite(Number(opts.freezeAfterSec))
    ? `-frz${Number(opts.freezeAfterSec).toFixed(2)}`
    : '-nofrz';
  const relDir = `.kunpeng/render-cache/layers/${opts.cacheKey}-mr${KP_MOTION_VERSION}-css${FX_CSS_SCOPE_VERSION}${freezeKey}`;
  const absDir = `${home}${relDir}`;
  const alphaMovPath = `${absDir}/${opts.opaqueBackground ? 'layer.mp4' : 'alpha.mov'}`;
  const framesDir = `${absDir}/frames`;
  const donePath = `${absDir}/worker-done.json`;
  if (await commandOk(`test -f ${shq(alphaMovPath)} && test -f ${shq(donePath)}`)) {
    opts.onTimelineProgress?.({ stage: 'cache', done: 1, total: 1, detail: opts.opaqueBackground ? '命中特效视频缓存' : '命中特效缓存' });
    return { framesDir, alphaMovPath, renderer: 'chromium-worker' };
  }
  await createDir(relDir, { dir: BaseDirectory.Home, recursive: true });
  const jobPath = `${absDir}/job.json`;
  const progressPath = `${absDir}/worker-progress.json`;
  const logPath = `${absDir}/worker.log`;
  const exitPath = `${absDir}/worker-exit.txt`;
  await writeJsonViaShell(jobPath, {
    html: workerHtml,
    css: scopedDoc.css,
    stageWidth: FX_STAGE_W,
    stageHeight: FX_STAGE_H,
    outputWidth: opts.width,
    fps: opts.fps,
    durationSec: Math.max(0.2, opts.durationSec),
    timeOffsetSec: Math.max(0, opts.timeOffsetSec ?? 0),
    alphaCodec: opts.alphaCodec ?? 'prores',
    opaqueBackground: Boolean(opts.opaqueBackground),
    freezeAfterSec: opts.freezeAfterSec ?? false,
    outputDir: absDir,
    progressPath,
    ffmpeg,
    timeoutMs: 900000,
  });

  const resourceRoot = await resourceDir().catch(() => '');
  const packagedWorker = resourceRoot ? `${resourceRoot.replace(/\/$/, '')}/scripts/render-worker.mjs` : '';
  const devWorker = `${(await invoke<string>('get_home_dir')).replace(/\/$/, '')}/Desktop/kunpeng/scripts/render-worker.mjs`;
  const scriptPath = await commandOk(`test -f ${shq(devWorker)}`)
    ? devWorker
    : packagedWorker;
  const nodeCommand = await detectNodeCommand();
  if (!nodeCommand) {
    await appendRenderDebug(absDir, 'node-missing', { candidates: NODE_CANDIDATES });
    throw new Error('特效渲染需要 Node.js，但应用没有找到 node。请安装 Node.js（Windows 安装到默认目录或加入 PATH，macOS 确认 /opt/homebrew/bin/node、/usr/local/bin/node 可用）。');
  }
  await appendRenderDebug(absDir, 'node-detected', { nodeCommand, scriptPath });
  const existing = activeWorkerLayers.get(absDir);
  if (existing) {
    opts.onTimelineProgress?.({ stage: 'cache', done: 0, total: 1, detail: '等待同一段渲染完成' });
    await existing;
  } else {
    const task = (async () => {
      const releaseLock = await acquireRenderLock(absDir, opts.signal);
      try {
        if (await commandOk(`test -f ${shq(alphaMovPath)} && test -f ${shq(donePath)}`)) return;
        await runWorkerShellWithProgress({
          command: `${shq(nodeCommand)} ${shq(scriptPath)} ${shq(jobPath)}`,
          timeoutMs: 1200000,
          progressPath,
          logPath,
          exitPath,
          absDir,
          layerName: opts.opaqueBackground ? '视频层' : '特效层',
          signal: opts.signal,
          onProgress: opts.onTimelineProgress,
        });
      } finally {
        await releaseLock();
      }
    })().finally(() => {
      if (activeWorkerLayers.get(absDir) === task) activeWorkerLayers.delete(absDir);
    });
    activeWorkerLayers.set(absDir, task);
    await task;
  }
  throwIfAborted(opts.signal);
  return { framesDir, alphaMovPath, renderer: 'chromium-worker' };
}

export async function renderLayer(doc: FxDoc, opts: FxRenderOptions): Promise<FxLayerResult> {
  try {
    return await runWorkerLayer(doc, opts);
  } catch (err) {
    if (opts.signal?.aborted) throw abortError();
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/** TextClip 渲染入口（renderCachePath 写回由调用方处理） */
export async function renderTextClip(t: TextClip, exportWidth: number, fps: number, themeId?: string, onProgress?: FxRenderOptions['onProgress']): Promise<string> {
  const doc = buildTextClipDoc(t, themeId);
  const cacheKey = `txt-${textClipHash(t)}-w${exportWidth}-f${fps}-d${(t.endSec - t.startSec).toFixed(2)}`;
  return renderToFrames(doc, { fps, durationSec: Math.max(0.2, t.endSec - t.startSec), width: exportWidth, cacheKey, onProgress });
}

export async function renderTextClipLayer(t: TextClip, exportWidth: number, fps: number, themeId?: string): Promise<FxLayerResult> {
  const doc = buildTextClipDoc(t, themeId);
  const cacheKey = `txt-${textClipHash(t)}-w${exportWidth}-f${fps}-d${(t.endSec - t.startSec).toFixed(2)}`;
  return renderLayer(doc, { fps, durationSec: Math.max(0.2, t.endSec - t.startSec), width: exportWidth, cacheKey });
}

/** FxClip 渲染入口 */
export async function renderFxClip(f: FxClip, exportWidth: number, fps: number, onProgress?: FxRenderOptions['onProgress']): Promise<string> {
  const doc = buildFxClipDoc(f);
  const cacheKey = `fx-${fxClipHash(f)}-w${exportWidth}-f${fps}-d${f.duration.toFixed(2)}`;
  return renderToFrames(doc, { fps, durationSec: Math.max(0.2, f.duration), width: exportWidth, cacheKey, onProgress });
}

export async function renderFxClipLayer(f: FxClip, exportWidth: number, fps: number): Promise<FxLayerResult> {
  const doc = buildFxClipDoc(f);
  const cacheKey = `fx-${fxClipHash(f)}-w${exportWidth}-f${fps}-d${f.duration.toFixed(2)}`;
  return renderLayer(doc, { fps, durationSec: Math.max(0.2, f.duration), width: exportWidth, cacheKey });
}

export async function renderFxTimelineLayer(
  items: FxTimelineLayerItem[],
  exportWidth: number,
  fps: number,
  durationSec: number,
  signal?: AbortSignal,
  onProgress?: (p: FxTimelineProgress) => void,
  opaqueBackground = false,
): Promise<FxLayerResult | null> {
  throwIfAborted(signal);
  if (items.length === 0) return null;
  const sorted = [...items]
    .map((item) => ({ ...item, doc: prepareFxDocForStage(item.doc) }))
    .sort((a, b) => a.startSec - b.startSec);
  const html = sorted.map((item, idx) => {
    const startMs = Math.max(0, item.startSec) * 1000;
    const endMs = Math.max(item.startSec + 0.05, item.startSec + item.durationSec) * 1000;
    return `<div data-kp-layer="${idx}" data-start="${startMs.toFixed(3)}" data-end="${endMs.toFixed(3)}" style="position:absolute;inset:0;visibility:hidden;pointer-events:none">${item.doc.html}</div>`;
  }).join('\n');
  const css = sorted.map((item, idx) => `/* layer ${idx}: ${item.id} */\n${item.doc.css}`).join('\n\n');
  const baseHash = hashContent(JSON.stringify({
    v: 1,
    opaqueBackground,
    width: exportWidth,
    fps,
    durationSec: Number(durationSec.toFixed(3)),
    items: sorted.map((item) => ({
      id: item.id,
      startSec: Number(item.startSec.toFixed(3)),
      durationSec: Number(item.durationSec.toFixed(3)),
      html: item.doc.html,
      css: item.doc.css,
    })),
  }));
  const cacheKey = `timeline-${baseHash}-w${exportWidth}-f${fps}-d${durationSec.toFixed(2)}`;

  if (durationSec <= 30) {
    return renderLayer({ html, css }, {
      fps,
      durationSec: Math.max(0.2, durationSec),
      width: exportWidth,
      cacheKey,
      alphaCodec: 'qtrle',
      opaqueBackground,
      freezeAfterSec: safeFreezeAfterSec({ html, css }, durationSec),
      signal,
      onTimelineProgress: onProgress,
    });
  }

  const ffmpeg = await detectFfmpeg();
  if (!ffmpeg) return renderLayer({ html, css }, {
    fps,
    durationSec: Math.max(0.2, durationSec),
    width: exportWidth,
    cacheKey,
    alphaCodec: 'qtrle',
    opaqueBackground,
    freezeAfterSec: safeFreezeAfterSec({ html, css }, durationSec),
    signal,
    onTimelineProgress: onProgress,
  });
  const home = await homeDir();
  const relDir = `.kunpeng/render-cache/layers/${cacheKey}`;
  const absDir = `${home}${relDir}`;
  const finalMov = `${absDir}/${opaqueBackground ? 'layer.mp4' : 'alpha.mov'}`;
  const donePath = `${absDir}/worker-done.json`;
  if (await commandOk(`test -f ${shq(finalMov)} && test -f ${shq(donePath)}`)) {
    onProgress?.({ stage: 'cache', done: 1, total: 1, detail: opaqueBackground ? '命中特效视频缓存' : '命中特效缓存' });
    return { framesDir: `${absDir}/segments`, alphaMovPath: finalMov, renderer: 'chromium-worker' };
  }
  await createDir(relDir, { dir: BaseDirectory.Home, recursive: true });

  // Keep Chromium conservative. Parallel 1080p alpha screenshots can close the
  // target on macOS under memory pressure, especially for long HTML timelines.
  const segmentSec = 6;
  const segments = Array.from({ length: Math.ceil(durationSec / segmentSec) }, (_, i) => {
    const start = i * segmentSec;
    return { index: i, start, duration: Math.min(segmentSec, durationSec - start) };
  }).filter((s) => s.duration > 0.05);

  const maxConcurrency = 1;
  const results: string[] = [];
  const frameTotals = new Map<number, { done: number; total: number }>();
  let next = 0;
  async function worker(): Promise<void> {
    while (next < segments.length) {
      throwIfAborted(signal);
      const seg = segments[next++];
      onProgress?.({
        stage: 'segment',
        segmentIndex: seg.index + 1,
        segmentCount: segments.length,
        detail: `渲染分段 ${seg.index + 1}/${segments.length}`,
      });
      const layer = await renderLayer(
        { html, css },
        {
          fps,
          durationSec: Math.max(0.2, seg.duration),
          timeOffsetSec: seg.start,
          width: exportWidth,
          alphaCodec: 'qtrle',
          opaqueBackground,
          freezeAfterSec: safeFreezeAfterSec({ html, css }, seg.duration),
          signal,
          cacheKey: `${cacheKey}-seg${String(seg.index).padStart(3, '0')}-${seg.start.toFixed(2)}-${seg.duration.toFixed(2)}`,
          onTimelineProgress: (p) => {
            if (p.total != null || p.done != null) {
              frameTotals.set(seg.index, { done: p.done ?? 0, total: p.total ?? Math.max(1, Math.round(seg.duration * fps)) });
            }
            const done = Array.from(frameTotals.values()).reduce((sum, x) => sum + Math.min(x.done, x.total), 0);
            const total = segments.reduce((sum, x) => sum + Math.max(1, Math.round(x.duration * fps)), 0);
            onProgress?.({
              ...p,
              segmentIndex: seg.index + 1,
              segmentCount: segments.length,
              done,
              total,
              detail: p.detail ?? `渲染分段 ${seg.index + 1}/${segments.length}`,
            });
          },
        },
      );
      throwIfAborted(signal);
      results[seg.index] = layer.alphaMovPath;
    }
  }
  await Promise.all(Array.from({ length: maxConcurrency }, () => worker()));

  const listPath = `${absDir}/segments.txt`;
  await writeTextViaShell(listPath, results.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
  onProgress?.({ stage: 'concat', done: 1, total: 1, detail: opaqueBackground ? '合并视频分段' : '合并透明分段' });
  await runShell(`${ffmpeg} -y -f concat -safe 0 -i ${shq(listPath)} -c copy ${shq(finalMov)}`, Math.max(600000, Math.ceil(durationSec) * 30000), signal, 'fx-segment-concat');
  await writeJsonViaShell(donePath, { outputPath: finalMov, renderer: 'chromium-worker-segmented', segmentCount: results.length, completedAt: Date.now() });
  onProgress?.({ stage: 'done', done: 1, total: 1, detail: opaqueBackground ? '视频层完成' : '透明轨完成' });
  return { framesDir: `${absDir}/segments`, alphaMovPath: finalMov, renderer: 'chromium-worker' };
}

export async function renderFxTimelineOpaqueSegments(
  items: FxTimelineLayerItem[],
  exportWidth: number,
  fps: number,
  signal?: AbortSignal,
  onProgress?: (p: FxTimelineProgress) => void,
): Promise<FxSegmentLayerResult[] | null> {
  throwIfAborted(signal);
  if (items.length === 0) return [];
  const sorted = [...items].sort((a, b) => a.startSec - b.startSec);
  if (!sorted.every((item) => isProbablyOpaqueFullPage(item.doc))) return null;

  const totalFrames = sorted.reduce((sum, item) => sum + Math.max(1, Math.round(item.durationSec * fps)), 0);
  let doneBefore = 0;
  const results: FxSegmentLayerResult[] = [];
  for (let index = 0; index < sorted.length; index++) {
    throwIfAborted(signal);
    const item = sorted[index];
    const duration = Math.max(0.2, item.durationSec);
    const cacheHash = hashContent(JSON.stringify({
      v: 1,
      mode: 'opaque-segment',
      width: exportWidth,
      fps,
      durationSec: Number(duration.toFixed(3)),
      html: item.doc.html,
      css: item.doc.css,
    }));
    onProgress?.({
      stage: 'segment',
      segmentIndex: index + 1,
      segmentCount: sorted.length,
      done: doneBefore,
      total: totalFrames,
      detail: `渲染页面 ${index + 1}/${sorted.length}`,
    });
    const layer = await renderLayer(item.doc, {
      fps,
      durationSec: duration,
      width: exportWidth,
      cacheKey: `opaque-${cacheHash}-w${exportWidth}-f${fps}-d${duration.toFixed(2)}`,
      alphaCodec: 'qtrle',
      opaqueBackground: true,
      freezeAfterSec: safeFreezeAfterSec(item.doc, duration),
      signal,
      onTimelineProgress: (p) => {
        const localDone = Math.min(p.done ?? 0, p.total ?? Math.max(1, Math.round(duration * fps)));
        const done = Math.min(totalFrames, doneBefore + localDone);
        onProgress?.({
          ...p,
          segmentIndex: index + 1,
          segmentCount: sorted.length,
          done,
          total: totalFrames,
          detail: p.detail ?? `渲染页面 ${index + 1}/${sorted.length}`,
        });
      },
    });
    doneBefore += Math.max(1, Math.round(duration * fps));
    results.push({
      ...layer,
      id: item.id,
      startSec: item.startSec,
      durationSec: duration,
    });
  }
  onProgress?.({ stage: 'done', done: totalFrames, total: totalFrames, detail: '页面视频完成' });
  return results;
}
