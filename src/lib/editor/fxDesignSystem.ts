/**
 * fxDesignSystem — HyperFrames 特效/花字的美学标准（设计 token + 校验器）。
 *
 * 所有特效（内置模板 / 口播组件 / agent 自写 custom HTML）共享同一套 token，
 * 保证成片视觉统一。agent custom 模式产出必须过 validateFx，不过返回具体
 * 违规项让其修正重试。
 */

export type ThemeGroup = '经典' | '自然' | '时尚' | '商务' | '节日';

export interface FxTheme {
  id: string;
  label: string;
  /** 主色（大面积底/标题） */
  primary: string;
  /** 强调色（数字/高亮/图表） */
  accent: string;
  /** 次强调色（渐变/双色场景） */
  accent2?: string;
  /** 文字主色 */
  text: string;
  /** 底板色（卡片背景，带透明度） */
  surface: string;
  /** 主题分组 */
  group: ThemeGroup;
  /** 字体配对 ID */
  fontPairing?: string;
}

export const FX_THEMES: FxTheme[] = [
  // ── 经典 ──
  { id: 'blackgold', label: '深邃黑金', primary: '#16161a', accent: '#d4a843', accent2: '#c49a6c', text: '#f5f0e6', surface: 'rgba(22,22,26,0.82)', group: '经典', fontPairing: 'luxury' },
  { id: 'techblue', label: '科技蓝', primary: '#0c1530', accent: '#3d8bff', accent2: '#6366f1', text: '#eaf2ff', surface: 'rgba(12,21,48,0.82)', group: '经典', fontPairing: 'tech' },
  { id: 'paper', label: '纸白杂志', primary: '#f7f4ee', accent: '#d94f30', accent2: '#e8a598', text: '#221f1a', surface: 'rgba(247,244,238,0.92)', group: '经典', fontPairing: 'editorial' },
  { id: 'vividorange', label: '活力橙', primary: '#1c1410', accent: '#ff7a1a', accent2: '#f59e0b', text: '#fff4ea', surface: 'rgba(28,20,16,0.82)', group: '经典', fontPairing: 'variety' },
  { id: 'neon', label: '暗夜霓虹', primary: '#0d0b14', accent: '#c84bff', accent2: '#ec4899', text: '#f2eaff', surface: 'rgba(13,11,20,0.85)', group: '经典', fontPairing: 'tech' },

  // ── 自然 ──
  { id: 'forest', label: '森林绿', primary: '#0e1a14', accent: '#4a9e6e', accent2: '#84cc16', text: '#e8f5ec', surface: 'rgba(14,26,20,0.82)', group: '自然', fontPairing: 'literary' },
  { id: 'glacier', label: '冰川蓝', primary: '#0d151e', accent: '#7cb8d4', accent2: '#94a3b8', text: '#e6f0f8', surface: 'rgba(13,21,30,0.82)', group: '自然', fontPairing: 'minimal' },
  { id: 'coral', label: '落日珊瑚', primary: '#1c1210', accent: '#ff6b5b', accent2: '#f59e0b', text: '#fff0ed', surface: 'rgba(28,18,16,0.82)', group: '自然', fontPairing: 'literary' },
  { id: 'mint', label: '薄荷清新', primary: '#0e1a18', accent: '#5dd4b0', accent2: '#7cb8d4', text: '#e6faf3', surface: 'rgba(14,26,24,0.82)', group: '自然', fontPairing: 'minimal' },
  { id: 'olive', label: '橄榄灰', primary: '#161814', accent: '#84cc16', accent2: '#4a9e6e', text: '#f0f4e8', surface: 'rgba(22,24,20,0.82)', group: '自然', fontPairing: 'editorial' },

  // ── 时尚 ──
  { id: 'rosegold', label: '玫瑰金', primary: '#1a1416', accent: '#e8a598', accent2: '#f4a0c0', text: '#f8f0ee', surface: 'rgba(26,20,22,0.82)', group: '时尚', fontPairing: 'luxury' },
  { id: 'sakura', label: '樱花粉', primary: '#1a1018', accent: '#f4a0c0', accent2: '#a78bfa', text: '#faf0f6', surface: 'rgba(26,16,24,0.82)', group: '时尚', fontPairing: 'literary' },
  { id: 'lavender', label: '薰衣草', primary: '#14101c', accent: '#a78bfa', accent2: '#c84bff', text: '#f0ecfa', surface: 'rgba(20,16,28,0.82)', group: '时尚', fontPairing: 'editorial' },
  { id: 'candy', label: '糖果彩', primary: '#140e18', accent: '#ec4899', accent2: '#a78bfa', text: '#fce8f4', surface: 'rgba(20,14,24,0.82)', group: '时尚', fontPairing: 'variety' },
  { id: 'mocha', label: '摩卡咖啡', primary: '#18140e', accent: '#c49a6c', accent2: '#d4a843', text: '#f4efe6', surface: 'rgba(24,20,14,0.82)', group: '时尚', fontPairing: 'editorial' },

  // ── 商务 ──
  { id: 'indigo', label: '靛蓝深邃', primary: '#0c0e1e', accent: '#6366f1', accent2: '#3d8bff', text: '#eceeff', surface: 'rgba(12,14,30,0.82)', group: '商务', fontPairing: 'tech' },
  { id: 'slate', label: '高级灰', primary: '#18181b', accent: '#94a3b8', accent2: '#64748b', text: '#f1f5f9', surface: 'rgba(24,24,27,0.82)', group: '商务', fontPairing: 'minimal' },
  { id: 'midnight', label: '午夜蓝金', primary: '#0a0e1a', accent: '#fbbf24', accent2: '#d4a843', text: '#f5f0e6', surface: 'rgba(10,14,26,0.82)', group: '商务', fontPairing: 'luxury' },

  // ── 节日 ──
  { id: 'crimson', label: '中国红', primary: '#1a0a0a', accent: '#dc2626', accent2: '#fbbf24', text: '#fef2f2', surface: 'rgba(26,10,10,0.82)', group: '节日', fontPairing: 'editorial' },
  { id: 'amber', label: '琥珀暖光', primary: '#1a1508', accent: '#f59e0b', accent2: '#ff7a1a', text: '#fef9e8', surface: 'rgba(26,21,8,0.82)', group: '节日', fontPairing: 'variety' },
];

export const DEFAULT_FX_THEME = 'techblue';

export function themeOf(id?: string): FxTheme {
  return FX_THEMES.find((t) => t.id === id) ?? FX_THEMES.find((t) => t.id === DEFAULT_FX_THEME) ?? FX_THEMES[0];
}

export function fxThemesDoc(): string {
  const groups = new Map<ThemeGroup, FxTheme[]>();
  for (const t of FX_THEMES) {
    if (!groups.has(t.group)) groups.set(t.group, []);
    groups.get(t.group)!.push(t);
  }
  return [...groups.entries()]
    .map(([g, ts]) => `${g}：${ts.map((t) => `${t.id}(${t.label})`).join('、')}`)
    .join('；');
}

/** 字阶（基于 1080p 画布的 px） */
export const FX_FONT_SCALE = {
  display: 96,
  title: 72,
  subtitle: 44,
  body: 30,
  caption: 22,
} as const;

/** 间距网格（px，1080p 基准） */
export const FX_SPACING = 8;

/** 安全区：四边 8% 内不放内容 */
export const FX_SAFE_MARGIN = 0.08;

/** 标准动效曲线 */
export const FX_EASINGS = {
  /** 入场弹性 */
  enter: 'cubic-bezier(0.22, 1.2, 0.36, 1)',
  /** 出场加速 */
  exit: 'cubic-bezier(0.55, 0, 0.85, 0.4)',
  /** 强调脉冲 */
  pulse: 'cubic-bezier(0.45, 0, 0.55, 1)',
  /** 匀速（描线/进度类） */
  linear: 'linear',
} as const;

/** 时长规范（秒） */
export const FX_DURATIONS = {
  enterMin: 0.4, enterMax: 0.8,
  emphasis: 0.3,
  exitMin: 0.3, exitMax: 0.5,
  /** 单条特效总时长上限（渲染成本） */
  totalMax: 15,
} as const;

/** 注入模板的 CSS 变量声明（组件/模板统一引用 var(--fx-*)） */
export function themeCssVars(theme: FxTheme): string {
  return [
    `--fx-primary: ${theme.primary}`,
    `--fx-accent: ${theme.accent}`,
    `--fx-accent2: ${theme.accent2 ?? theme.accent}`,
    `--fx-text: ${theme.text}`,
    `--fx-surface: ${theme.surface}`,
    `--fx-ease-enter: ${FX_EASINGS.enter}`,
    `--fx-ease-exit: ${FX_EASINGS.exit}`,
    `--fx-ease-pulse: ${FX_EASINGS.pulse}`,
  ].join('; ');
}

// ── 校验器 ────────────────────────────────────────────────────────────────────

export interface FxValidation {
  ok: boolean;
  violations: string[];
  /** 不阻断的建议（relaxed 级把美学约束降级到这里） */
  warnings: string[];
}

export interface FxValidateOptions {
  /** 渲染目标：chromium（导出主路径，全能力）| html2canvas（旧兜底，CSS 子集受限）。默认 chromium */
  target?: 'chromium' | 'html2canvas';
  /** strict：颜色锁 token + 字号锁字阶（组件库 CI 自检用）；relaxed：美学降为 warning。默认 relaxed */
  level?: 'strict' | 'relaxed';
}

const ALLOWED_LITERAL_COLORS = new Set([
  '#fff', '#ffffff', '#000', '#000000', 'transparent', 'currentcolor', 'inherit', 'white', 'black',
]);

/**
 * 校验 agent/自定义特效。
 * 硬护栏（violations）：必须有动画、动画时长 0.2-15s、（html2canvas 目标时）禁 3D/backdrop-filter。
 * 美学建议（relaxed 下为 warnings）：颜色贴 token、字号有主视觉层级。
 * 导出主路径已是全能力 Chromium，默认 target=chromium 不再禁 3D transform / backdrop-filter。
 */
export function validateFx(html: string, css: string, options?: FxValidateOptions): FxValidation {
  const target = options?.target ?? 'chromium';
  const level = options?.level ?? 'relaxed';
  const violations: string[] = [];
  const warnings: string[] = [];
  const colorSink = level === 'strict' ? violations : warnings;
  const all = `${html}\n${css}`;

  // 1. 颜色字面量（strict 阻断 / relaxed 建议）
  const themeColors = new Set<string>();
  for (const t of FX_THEMES) {
    themeColors.add(t.primary.toLowerCase());
    themeColors.add(t.accent.toLowerCase());
    if (t.accent2) themeColors.add(t.accent2.toLowerCase());
    themeColors.add(t.text.toLowerCase());
  }
  const hexes = all.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
  for (const h of hexes) {
    const lower = h.toLowerCase();
    if (!themeColors.has(lower) && !ALLOWED_LITERAL_COLORS.has(lower)) {
      colorSink.push(`颜色 ${h} 不在设计 token 中——优先 var(--fx-primary/--fx-accent/--fx-text/--fx-surface) 保持成片统一（有意的独立配色可以保留）`);
    }
  }

  // 2. 动画时长（硬护栏）
  const durations = all.match(/(?:animation(?:-duration)?\s*:[^;]*?)([\d.]+)s/g) ?? [];
  for (const d of durations) {
    const m = /([\d.]+)s/.exec(d);
    if (!m) continue;
    const sec = parseFloat(m[1]);
    if (sec < 0.2) violations.push(`动画时长 ${sec}s 过短（最短 0.2s，规范：入场 0.4-0.8s / 强调 0.3s / 出场 0.3-0.5s）`);
    if (sec > FX_DURATIONS.totalMax) violations.push(`动画时长 ${sec}s 超过上限 ${FX_DURATIONS.totalMax}s`);
  }

  // 3. 字号层级
  const scale = Object.values(FX_FONT_SCALE) as number[];
  const sizes = (all.match(/font-size\s*:\s*([\d.]+)px/g) ?? []).map((s) => parseFloat(/([\d.]+)px/.exec(s)![1]));
  if (level === 'strict') {
    for (const px of sizes) {
      if (!scale.some((v) => Math.abs(v - px) <= 2)) {
        violations.push(`字号 ${px}px 不在字阶 [${scale.join('/')}] 上`);
      }
    }
  } else if (sizes.length > 0) {
    for (const px of sizes) {
      if (px < 14) violations.push(`字号 ${px}px 小于 14px，视频里不可读`);
    }
    if (!sizes.some((px) => px >= 54)) {
      warnings.push('没有 56px 以上的主视觉文字——整屏特效每屏应有一个明确的视觉主角');
    }
  }

  // 4. 必须有动画（硬护栏）
  if (!/animation|@keyframes|transition/.test(all)) {
    violations.push('特效必须包含动画（@keyframes + animation），口播展示动效不允许静态贴图');
  }

  // 5. 渲染目标限制：仅 html2canvas 兜底路径保留禁令
  if (target === 'html2canvas') {
    if (/transform[^;]*(?:rotate3d|translate3d|perspective|rotateX|rotateY)/i.test(all)) {
      violations.push('禁止 3D transform（html2canvas 兜底渲染不支持），请用 2D 变换组合');
    }
    if (/backdrop-filter/i.test(all)) {
      violations.push('禁止 backdrop-filter（html2canvas 兜底渲染不支持），底板请用 var(--fx-surface) 半透明色');
    }
  }

  return { ok: violations.length === 0, violations, warnings };
}
