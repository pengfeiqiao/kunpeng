/**
 * presets/webgrade — 高级网页审美场景包（Apple / Stripe / Linear 式 opaque 场景）。
 *
 * 特点：大留白、克制配色、精确层级、outExpo 慢动效、渐变辉光、空间纵深（parallax）。
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

/** Apple 式发布页：eyebrow 小标 + 超大标题渐显 + 副文案 + 底部辉光 */
const heroApple: PresetDef = {
  id: 'web.heroApple',
  label: '网页·Apple 发布页',
  group: '高级网页',
  paramsDoc: '{ eyebrow?: string(顶部小标如"全新推出"), title: string(≤12字), subtitle?: string(≤28字), theme?: string(默认slate暗色) }',
  defaultDuration: 5.5,
  build(params, duration) {
    const eyebrow = str(params.eyebrow);
    const title = str(params.title, '标题');
    const subtitle = str(params.subtitle);
    const layers: SceneLayer[] = [
      {
        id: 'glow', kind: 'shape',
        html: `<div style="width:1500px;height:700px;background:radial-gradient(ellipse 50% 42% at 50% 78%, color-mix(in srgb, var(--fx-accent) 34%, transparent), transparent 72%);"></div>`,
        at: { x: '50%', y: '76%', anchor: 'center' }, z: 1, parallax: 0.55,
        tracks: [
          { prop: 'opacity', kf: [{ t: 0, v: 0 }, { t: 1.4, v: 1, ease: 'outQuad' }] },
          { prop: 'scale', kf: [{ t: 0, v: 0.86 }, { t: duration, v: 1.05, ease: 'outQuad' }] },
        ],
      },
      ...(eyebrow ? [{
        id: 'eyebrow', kind: 'text' as const, text: eyebrow, class: 'kp-label',
        style: { color: 'var(--fx-accent)', letterSpacing: '6px' },
        at: { x: '50%', y: '34%', anchor: 'center' as const }, z: 3, in: 0.25, parallax: 0.92,
        tracks: [
          { prop: 'opacity' as const, kf: [{ t: 0.25, v: 0 }, { t: 0.85, v: 1, ease: 'outQuad' as const }] },
          { prop: 'y' as const, kf: [{ t: 0.25, v: 18 }, { t: 0.95, v: 0, ease: 'outExpo' as const }] },
        ],
      }] : []),
      {
        id: 'title', kind: 'text', text: title, class: 'kp-h1',
        style: { fontSize: '110px', letterSpacing: '-2px', fontWeight: '700' },
        at: { x: '50%', y: '45%', anchor: 'center' }, z: 3, parallax: 1,
        tracks: [
          { prop: 'opacity', kf: [{ t: 0.45, v: 0 }, { t: 1.25, v: 1, ease: 'outQuad' }] },
          { prop: 'y', kf: [{ t: 0.45, v: 44 }, { t: 1.45, v: 0, ease: 'outExpo' }] },
          { prop: 'blur', kf: [{ t: 0.45, v: 10 }, { t: 1.35, v: 0, ease: 'outQuad' }] },
        ],
      },
      ...(subtitle ? [{
        id: 'subtitle', kind: 'text' as const, text: subtitle, class: 'kp-sub',
        style: { opacity: '0.72', fontWeight: '400' },
        at: { x: '50%', y: '58%', anchor: 'center' as const }, z: 2, in: 0.9, parallax: 0.85,
        tracks: [
          { prop: 'opacity' as const, kf: [{ t: 0.9, v: 0 }, { t: 1.7, v: 0.85, ease: 'outQuad' as const }] },
          { prop: 'y' as const, kf: [{ t: 0.9, v: 26 }, { t: 1.8, v: 0, ease: 'outExpo' as const }] },
        ],
      }] : []),
    ];
    return {
      v: 1, duration, theme: str(params.theme) || 'slate', bg: 'opaque',
      bgCss: 'linear-gradient(180deg, #060607 0%, #0c0c10 100%)',
      fonts: ['minimal'],
      camera: { tracks: [{ prop: 'scale', kf: [{ t: 0, v: 1.04 }, { t: duration, v: 1, ease: 'outQuad' }] }] },
      layers,
    };
  },
};

/** Stripe 式渐变卡：品牌渐变底 + 玻璃卡片 + 指标 */
const gradientCard: PresetDef = {
  id: 'web.gradientCard',
  label: '网页·Stripe 渐变卡',
  group: '高级网页',
  paramsDoc: '{ title: string, metric?: {value:number, suffix?:string, label:string}(核心指标), points?: string[](≤3), gradient?: string(CSS渐变,默认Stripe紫蓝) }',
  defaultDuration: 6,
  build(params, duration) {
    const title = str(params.title, '标题');
    const metric = (params.metric ?? null) as { value?: unknown; suffix?: unknown; label?: unknown } | null;
    const points = strArr(params.points, 3);
    const gradient = str(params.gradient, 'linear-gradient(135deg,#0a2540 0%,#243b8f 45%,#635bff 100%)');
    const layers: SceneLayer[] = [
      {
        id: 'blob', kind: 'shape',
        html: `<div style="width:900px;height:900px;border-radius:50%;background:radial-gradient(circle at 35% 35%, rgba(255,255,255,0.22), transparent 65%);filter:blur(2px)"></div>`,
        at: { x: '78%', y: '18%', anchor: 'center' }, z: 1, parallax: 0.5,
        tracks: [
          { prop: 'opacity', kf: [{ t: 0, v: 0 }, { t: 1.2, v: 1, ease: 'outQuad' }] },
          { prop: 'y', kf: [{ t: 0, v: 0 }, { t: duration, v: -34, ease: 'linear' }] },
        ],
      },
      {
        id: 'title', kind: 'text', text: title, class: 'kp-h2',
        style: { letterSpacing: '-1px' },
        at: { x: 220, y: 260, anchor: 'left' }, z: 3,
        tracks: [
          { prop: 'opacity', kf: [{ t: 0.3, v: 0 }, { t: 1.0, v: 1, ease: 'outQuad' }] },
          { prop: 'y', kf: [{ t: 0.3, v: 36 }, { t: 1.15, v: 0, ease: 'outExpo' }] },
        ],
      },
    ];
    if (metric) {
      const value = Number(metric.value) || 0;
      layers.push({
        id: 'card', kind: 'group',
        at: { x: 220, y: 480, anchor: 'top-left' }, z: 2, in: 0.7,
        tracks: [
          { prop: 'opacity', kf: [{ t: 0.7, v: 0 }, { t: 1.4, v: 1, ease: 'outQuad' }] },
          { prop: 'y', kf: [{ t: 0.7, v: 46 }, { t: 1.55, v: 0, ease: 'outExpo' }] },
        ],
        children: [
          {
            id: 'panel', kind: 'html',
            html: `<div style="width:820px;height:340px;background:rgba(255,255,255,0.09);border:1px solid rgba(255,255,255,0.22);border-radius:28px;backdrop-filter:blur(22px);box-shadow:0 24px 80px rgba(6,10,40,0.45)"></div>`,
            at: { x: 0, y: 0, anchor: 'top-left' }, z: 1,
          },
          {
            id: 'metric', kind: 'text', text: '0', class: 'kp-h1',
            style: { fontSize: '116px', fontVariantNumeric: 'tabular-nums', color: '#ffffff' },
            at: { x: 64, y: 66, anchor: 'top-left' }, z: 2,
            effects: [{ type: 'numberRoll', at: 1.2, dur: 1.4, from: 0, to: value, format: 'comma', suffix: str(metric.suffix), ease: 'outExpo' }],
          },
          {
            id: 'metricLabel', kind: 'text', text: str(metric.label, ''), class: 'kp-sub',
            style: { opacity: '0.75' },
            at: { x: 66, y: 232, anchor: 'top-left' }, z: 2,
            tracks: [{ prop: 'opacity', kf: [{ t: 1.5, v: 0 }, { t: 2.0, v: 0.85, ease: 'outQuad' }] }],
          },
        ],
      });
    }
    points.forEach((p, i) => {
      const at = 1.6 + i * 0.28;
      layers.push({
        id: `pt${i}`, kind: 'html',
        html: `<div style="display:flex;align-items:center;gap:20px"><div style="width:12px;height:12px;border-radius:50%;background:#9fe8ff"></div><div style="font-size:32px;color:rgba(255,255,255,0.88);font-weight:500">${esc(p)}</div></div>`,
        at: { x: 1180, y: 500 + i * 96, anchor: 'left' }, z: 2, in: at,
        tracks: [
          { prop: 'x', kf: [{ t: at, v: 44 }, { t: at + 0.6, v: 0, ease: 'outExpo' }] },
          { prop: 'opacity', kf: [{ t: at, v: 0 }, { t: at + 0.45, v: 1 }] },
        ],
      });
    });
    return { v: 1, duration, theme: 'indigo', bg: 'opaque', bgCss: gradient, fonts: ['tech'], layers };
  },
};

/** Linear 式特性列表：暗底细边卡片 grid 依次浮现 */
const featureGrid: PresetDef = {
  id: 'web.featureGrid',
  label: '网页·Linear 特性网格',
  group: '高级网页',
  paramsDoc: '{ title: string, features: {name:string, desc?:string}[](2-6个), theme?: string }',
  defaultDuration: 6.5,
  build(params, duration) {
    const title = str(params.title, '特性');
    const features = (Array.isArray(params.features) ? params.features : []).slice(0, 6) as { name?: unknown; desc?: unknown }[];
    const n = Math.max(1, features.length);
    const cols = n <= 3 ? n : 3;
    const rows = Math.ceil(n / cols);
    const cardW = 520; const cardH = rows > 1 ? 250 : 300;
    const gapX = 40; const gapY = 36;
    const gridW = cols * cardW + (cols - 1) * gapX;
    const startX = (1920 - gridW) / 2;
    const startY = 460;
    const layers: SceneLayer[] = [{
      id: 'title', kind: 'text', text: title, class: 'kp-h2',
      style: { letterSpacing: '-1px' },
      at: { x: '50%', y: 250, anchor: 'center' }, z: 3,
      tracks: [
        { prop: 'opacity', kf: [{ t: 0.25, v: 0 }, { t: 0.95, v: 1, ease: 'outQuad' }] },
        { prop: 'y', kf: [{ t: 0.25, v: 30 }, { t: 1.1, v: 0, ease: 'outExpo' }] },
        { prop: 'blur', kf: [{ t: 0.25, v: 8 }, { t: 1.0, v: 0, ease: 'outQuad' }] },
      ],
    }];
    features.forEach((f, i) => {
      const cx = startX + (i % cols) * (cardW + gapX) + cardW / 2;
      const cy = startY + Math.floor(i / cols) * (cardH + gapY) + cardH / 2;
      const at = 0.75 + i * 0.16;
      const name = esc(String(f.name ?? '').trim());
      const desc = esc(String(f.desc ?? '').trim());
      layers.push({
        id: `card${i}`, kind: 'html',
        html: `<div style="width:${cardW}px;height:${cardH}px;padding:40px 44px;background:rgba(255,255,255,0.035);border:1px solid rgba(255,255,255,0.12);border-radius:20px;box-sizing:border-box"><div style="width:40px;height:4px;background:var(--fx-accent);border-radius:2px;margin-bottom:26px"></div><div style="font-size:34px;font-weight:700;color:var(--fx-text);margin-bottom:14px">${name}</div>${desc ? `<div style="font-size:24px;line-height:1.5;color:var(--fx-text);opacity:0.62">${desc}</div>` : ''}</div>`,
        at: { x: cx, y: cy, anchor: 'center' }, z: 2, in: at,
        tracks: [
          { prop: 'opacity', kf: [{ t: at, v: 0 }, { t: at + 0.55, v: 1, ease: 'outQuad' }] },
          { prop: 'y', kf: [{ t: at, v: 34 }, { t: at + 0.7, v: 0, ease: 'outExpo' }] },
          { prop: 'scale', kf: [{ t: at, v: 0.96 }, { t: at + 0.7, v: 1, ease: 'outExpo' }] },
        ],
      });
    });
    return {
      v: 1, duration, theme: str(params.theme) || 'slate', bg: 'opaque',
      bgCss: 'radial-gradient(ellipse 70% 55% at 50% -10%, #17181f 0%, #0a0a0d 60%)',
      fonts: ['minimal'],
      camera: { tracks: [{ prop: 'y', kf: [{ t: 0, v: 12 }, { t: duration, v: -12, ease: 'linear' }] }] },
      layers,
    };
  },
};

export const WEB_PRESETS: PresetDef[] = [heroApple, gradientCard, featureGrid];
