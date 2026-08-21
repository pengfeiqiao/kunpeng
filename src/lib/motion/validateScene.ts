/**
 * validateScene — SceneSpec 校验：结构 + 性能预算（硬违规）+ 可读性 lint（warning）。
 *
 * 违规信息面向 agent 重试：每条都写清楚"哪里错、怎么改"。
 */
import {
  SCENE_BUDGET, SCENE_EFFECT_TYPES, SCENE_SPEC_VERSION,
  resolveTimeRef,
  type SceneEffect, type SceneLayer, type SceneSpec, type Track,
} from './spec';
import { FX_THEMES } from '../editor/fxDesignSystem';
import { FONT_PAIRINGS } from '../editor/fontSystem';
import { STYLE_KITS, styleKitOf } from './styleKits';

export interface SceneValidation {
  ok: boolean;
  violations: string[];
  warnings: string[];
}

const TRACK_PROPS = new Set(['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate', 'opacity', 'blur']);
const EASE_NAMES = new Set([
  'linear', 'inQuad', 'outQuad', 'inOutQuad', 'inCubic', 'outCubic', 'inOutCubic',
  'outQuart', 'inExpo', 'outExpo', 'inOutExpo', 'inBack', 'outBack', 'outElastic', 'outBounce',
]);
const LAYER_KINDS = new Set(['text', 'shape', 'image', 'svg', 'html', 'group']);

function validateHtmlFragment(html: string, where: string, violations: string[]): void {
  if (/<script\b/i.test(html)) violations.push(`${where}：禁止内嵌 <script>（场景动画全部用 tracks/effects 声明）`);
  if (/<iframe\b|<video\b|<audio\b/i.test(html)) violations.push(`${where}：禁止 iframe/video/audio`);
  if (/\son[a-z]+\s*=/i.test(html)) violations.push(`${where}：禁止内联事件处理器`);
  if (/<link\b/i.test(html)) violations.push(`${where}：禁止 <link> 外链样式/字体`);
}

function validateTimeRef(ref: unknown, beats: number[] | undefined, where: string, violations: string[]): void {
  if (ref == null || typeof ref === 'number') return;
  const m = /^beat:(\d+)\s*(?:[+-]\s*[\d.]+)?$/.exec(String(ref).trim());
  if (!m) {
    violations.push(`${where}：时间引用 "${ref}" 非法，应为秒数或 "beat:N"（可带 +0.1/-0.1 偏移）`);
    return;
  }
  const idx = Number(m[1]);
  if (!beats || idx >= beats.length) {
    violations.push(`${where}：引用了 beat:${idx}，但 beats 只有 ${beats?.length ?? 0} 个（先在 spec.beats 里定义节奏点）`);
  }
}

function countKf(tracks: Track[] | undefined): number {
  return (tracks ?? []).reduce((a, tr) => a + (tr.kf?.length ?? 0), 0);
}

export function validateSceneSpec(raw: unknown): SceneValidation {
  const violations: string[] = [];
  const warnings: string[] = [];
  const spec = raw as SceneSpec;

  if (!spec || typeof spec !== 'object') {
    return { ok: false, violations: ['spec 必须是对象'], warnings };
  }
  if (spec.v !== SCENE_SPEC_VERSION) violations.push(`v 必须为 ${SCENE_SPEC_VERSION}`);
  if (!Number.isFinite(spec.duration) || spec.duration <= 0) {
    violations.push('duration 必须是正数（秒）');
  } else if (spec.duration > SCENE_BUDGET.maxDurationSec) {
    violations.push(`duration ${spec.duration}s 超过单场景上限 ${SCENE_BUDGET.maxDurationSec}s，请拆成多个场景片段`);
  }
  if (spec.bg && spec.bg !== 'transparent' && spec.bg !== 'opaque') {
    violations.push('bg 只能是 transparent（叠加层）或 opaque（整屏信息页）');
  }
  if (spec.theme && !FX_THEMES.some((t) => t.id === spec.theme)) {
    violations.push(`theme "${spec.theme}" 不存在，可用：${FX_THEMES.map((t) => t.id).join('/')}`);
  }
  if (spec.style && !styleKitOf(spec.style)) {
    violations.push(`style "${spec.style}" 不存在，可用艺术方向：${STYLE_KITS.map((k) => k.id).join('/')}`);
  }
  if (spec.style && (spec.bg ?? 'transparent') === 'transparent' && spec.styleBackdrop !== false) {
    warnings.push(`透明叠加场景启用了 style kit 签名装饰层，可能遮挡原视频画面——若只要配色/字体不要装饰，传 styleBackdrop: false`);
  }
  for (const f of spec.fonts ?? []) {
    if (!FONT_PAIRINGS.some((p) => p.id === f)) {
      violations.push(`fonts 含未知配对 "${f}"，可用：${FONT_PAIRINGS.map((p) => p.id).join('/')}`);
    }
  }
  if (spec.beats) {
    if (!Array.isArray(spec.beats) || spec.beats.some((b) => !Number.isFinite(b) || b < 0)) {
      violations.push('beats 必须是非负秒数数组');
    } else {
      for (let i = 1; i < spec.beats.length; i++) {
        if (spec.beats[i] < spec.beats[i - 1]) { violations.push('beats 必须升序'); break; }
      }
    }
  }

  if (!Array.isArray(spec.layers) || spec.layers.length === 0) {
    violations.push('layers 不能为空');
    return { ok: false, violations, warnings };
  }

  // 展平（group 计入总数）
  const flat: SceneLayer[] = [];
  const flatten = (ls: SceneLayer[]) => {
    for (const l of ls) {
      flat.push(l);
      if (l.kind === 'group' && l.children) flatten(l.children);
    }
  };
  flatten(spec.layers);

  if (flat.length > SCENE_BUDGET.maxLayers) {
    violations.push(`图层总数 ${flat.length} 超过上限 ${SCENE_BUDGET.maxLayers}（含 group 子层）`);
  }

  const ids = new Set<string>();
  let kfTotal = countKf(spec.camera?.tracks);
  let hasReadabilityAid = false;
  let hasBigText = false;

  const validateTracks = (tracks: Track[] | undefined, where: string) => {
    if (!tracks) return;
    if (tracks.length > SCENE_BUDGET.maxTracksPerLayer) {
      violations.push(`${where}：tracks 数 ${tracks.length} 超过每层上限 ${SCENE_BUDGET.maxTracksPerLayer}`);
    }
    for (const tr of tracks) {
      if (!TRACK_PROPS.has(tr.prop)) {
        violations.push(`${where}：未知 track prop "${tr.prop}"，可用 ${[...TRACK_PROPS].join('/')}`);
        continue;
      }
      if (!Array.isArray(tr.kf) || tr.kf.length === 0) {
        violations.push(`${where}：track ${tr.prop} 的 kf 不能为空`);
        continue;
      }
      let lastT = -Infinity;
      for (const k of tr.kf) {
        validateTimeRef(k.t, spec.beats, `${where}.${tr.prop}`, violations);
        const tSec = resolveTimeRef(k.t, spec.beats, NaN);
        if (Number.isFinite(tSec)) {
          if (tSec < 0 || tSec > spec.duration + 0.001) {
            violations.push(`${where}.${tr.prop}：关键帧 t=${tSec.toFixed(2)}s 超出 [0, ${spec.duration}]`);
          }
          if (tSec < lastT) violations.push(`${where}.${tr.prop}：关键帧必须按 t 升序`);
          lastT = tSec;
        }
        if (!Number.isFinite(k.v)) violations.push(`${where}.${tr.prop}：关键帧 v 必须是数字`);
        if (k.ease && !EASE_NAMES.has(k.ease)) {
          violations.push(`${where}.${tr.prop}：未知缓动 "${k.ease}"，可用 ${[...EASE_NAMES].join('/')}`);
        }
      }
    }
  };

  const validateEffects = (effects: SceneEffect[] | undefined, layer: SceneLayer, where: string) => {
    if (!effects) return;
    if (effects.length > SCENE_BUDGET.maxEffectsPerLayer) {
      violations.push(`${where}：effects 数 ${effects.length} 超过每层上限 ${SCENE_BUDGET.maxEffectsPerLayer}`);
    }
    for (const fx of effects) {
      if (!SCENE_EFFECT_TYPES.includes(fx.type)) {
        violations.push(`${where}：未知效果 "${(fx as { type?: string }).type}"，可用 ${SCENE_EFFECT_TYPES.join('/')}`);
        continue;
      }
      validateTimeRef((fx as { at?: unknown }).at, spec.beats, `${where}.${fx.type}`, violations);
      switch (fx.type) {
        case 'kineticText': {
          if (layer.kind !== 'text') violations.push(`${where}：kineticText 只能用于 kind=text 图层`);
          const len = [...(layer.text ?? '')].length;
          if ((fx.split ?? 'char') === 'char' && len > SCENE_BUDGET.maxCharSplitLen) {
            violations.push(`${where}：kineticText char 拆分文本 ${len} 字超上限 ${SCENE_BUDGET.maxCharSplitLen}（性能），改 word 或缩短文案`);
          }
          break;
        }
        case 'lineDraw':
          if (layer.kind !== 'svg' && !layer.svg) {
            violations.push(`${where}：lineDraw 需要 kind=svg 图层（提供 svg 字段，路径用 stroke 描边）`);
          }
          break;
        case 'trail':
          if ((fx.copies ?? 3) > SCENE_BUDGET.maxTrailCopies) {
            violations.push(`${where}：trail copies ${fx.copies} 超上限 ${SCENE_BUDGET.maxTrailCopies}`);
          }
          break;
        case 'numberRoll':
          if (!Number.isFinite(fx.to)) violations.push(`${where}：numberRoll 需要数字 to`);
          break;
        case 'magnify':
          if (!fx.region || !Number.isFinite(fx.region.r)) violations.push(`${where}：magnify 需要 region {x, y, r}`);
          break;
        case 'typewriter': {
          if (layer.kind !== 'text') violations.push(`${where}：typewriter 只能用于 kind=text 图层`);
          const twLen = [...(layer.text ?? '')].length;
          if (twLen > SCENE_BUDGET.maxCharSplitLen) {
            violations.push(`${where}：typewriter 文本 ${twLen} 字超上限 ${SCENE_BUDGET.maxCharSplitLen}`);
          }
          break;
        }
        case 'glitch':
          if ((fx.dur ?? 0.5) > 2) violations.push(`${where}：glitch 是冲击点缀，dur 不要超过 2s`);
          break;
        case 'gradientShift':
          if (fx.colors && (fx.colors.length < 2 || fx.colors.length > 4)) {
            violations.push(`${where}：gradientShift colors 需要 2-4 个颜色`);
          }
          break;
        case 'pathMove':
          if (!fx.via || !fx.to || !Number.isFinite(fx.to.x) || !Number.isFinite(fx.to.y)) {
            violations.push(`${where}：pathMove 需要 via {x,y} 和 to {x,y}（相对起始位置的 px 偏移）`);
          }
          break;
        case 'waveText': {
          if (layer.kind !== 'text') violations.push(`${where}：waveText 只能用于 kind=text 图层`);
          const wLen = [...(layer.text ?? '')].length;
          if (wLen > SCENE_BUDGET.maxCharSplitLen) {
            violations.push(`${where}：waveText 文本 ${wLen} 字超上限 ${SCENE_BUDGET.maxCharSplitLen}`);
          }
          break;
        }
        case 'sliceIn':
          if (fx.slices != null && (fx.slices < 2 || fx.slices > 8)) {
            violations.push(`${where}：sliceIn slices 需在 2-8 之间`);
          }
          break;
        case 'orbit':
          if (fx.period != null && fx.period < 0.5) violations.push(`${where}：orbit period 不能小于 0.5s`);
          break;
        case 'liquidBlob':
          if (fx.period != null && fx.period < 2) violations.push(`${where}：liquidBlob period 不能小于 2s（形变过快显廉价）`);
          break;
      }
    }
  };

  const walk = (ls: SceneLayer[], prefix: string) => {
    for (const l of ls) {
      const where = `layer[${prefix}${l.id ?? '?'}]`;
      if (!l.id || typeof l.id !== 'string') violations.push(`${where}：每个图层必须有字符串 id`);
      const fullId = `${prefix}${l.id}`;
      if (ids.has(fullId)) violations.push(`${where}：图层 id 重复`);
      ids.add(fullId);
      if (!LAYER_KINDS.has(l.kind)) violations.push(`${where}：未知 kind "${l.kind}"`);
      if (l.kind === 'text' && !l.text) violations.push(`${where}：kind=text 需要 text 字段`);
      if (l.kind === 'image' && !l.src) violations.push(`${where}：kind=image 需要 src`);
      if (l.kind === 'svg' && !l.svg) violations.push(`${where}：kind=svg 需要 svg 字段`);
      if (l.html) validateHtmlFragment(l.html, where, violations);
      if (l.svg) validateHtmlFragment(l.svg, where, violations);
      validateTimeRef(l.in, spec.beats, `${where}.in`, violations);
      validateTimeRef(l.out, spec.beats, `${where}.out`, violations);
      validateTracks(l.tracks, where);
      validateEffects(l.effects, l, where);
      kfTotal += countKf(l.tracks);

      const cls = l.class ?? '';
      if (/kp-chip|kp-stroke|kp-shadow/.test(cls)) hasReadabilityAid = true;
      if (/kp-h1|kp-h2|kp-h3/.test(cls)) hasBigText = true;
      if (l.kind === 'group' && l.children) walk(l.children, `${fullId}/`);
    }
  };
  walk(spec.layers, '');

  if (spec.camera) validateTracks(spec.camera.tracks, 'camera');
  for (const f of spec.flashes ?? []) validateTimeRef(f.at, spec.beats, 'flashes', violations);

  if (kfTotal > SCENE_BUDGET.maxKeyframesTotal) {
    violations.push(`关键帧总数 ${kfTotal} 超上限 ${SCENE_BUDGET.maxKeyframesTotal}`);
  }

  // ── 可读性 lint（warning，不阻断） ──
  const bg = spec.bg ?? 'transparent';
  const textLayers = flat.filter((l) => l.kind === 'text');
  if (bg === 'transparent' && textLayers.length > 0 && !hasReadabilityAid) {
    warnings.push('透明叠加场景的文字层建议加可读性保护：class 加 kp-chip（底托）/ kp-stroke（描边）/ kp-shadow（投影），避免裸字压复杂画面');
  }
  if (bg === 'opaque' && textLayers.length > 0 && !hasBigText) {
    warnings.push('整屏信息页建议至少一个 kp-h1/kp-h2/kp-h3（56px+）主视觉文字，避免全屏小字');
  }
  if (spec.beats && spec.beats.length > 0) {
    const specStr = JSON.stringify(spec);
    if (!/"beat:/.test(specStr)) warnings.push('定义了 beats 但没有任何 "beat:N" 引用——要么删掉 beats，要么把关键动作对齐到节奏点');
  }

  return { ok: violations.length === 0, violations, warnings };
}
