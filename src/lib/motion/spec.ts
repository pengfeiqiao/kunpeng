/**
 * KPMotion Scene Spec — 声明式运动场景协议（v1）。
 *
 * 这是 agent、校验器、sceneDoc 编译器、运行时（runtime/）四方共享的唯一协议。
 * 本文件必须保持零依赖（会被打进 runtime IIFE），只放类型、常量、纯函数。
 *
 * 设计原则：spec 是纯数据（JSON 可序列化），不含任何可执行代码；
 * 一切动画都是 t 的纯函数——同一 spec + 同一 t 在预览端和导出端渲染出同一帧。
 */

export const SCENE_SPEC_VERSION = 1;

// ── 预算护栏（validateScene 与 runtime 双端执行） ──────────────────────────────
export const SCENE_BUDGET = {
  maxLayers: 24,
  maxTracksPerLayer: 8,
  maxKeyframesTotal: 400,
  maxTrailCopies: 4,
  maxCharSplitLen: 40,
  maxEffectsPerLayer: 6,
  maxDurationSec: 15,
} as const;

// ── 基础类型 ──────────────────────────────────────────────────────────────────

export type EaseName =
  | 'linear'
  | 'inQuad' | 'outQuad' | 'inOutQuad'
  | 'inCubic' | 'outCubic' | 'inOutCubic'
  | 'outQuart' | 'inExpo' | 'outExpo' | 'inOutExpo'
  | 'inBack' | 'outBack'
  | 'outElastic' | 'outBounce';

export type TrackProp = 'x' | 'y' | 'scale' | 'scaleX' | 'scaleY' | 'rotate' | 'opacity' | 'blur';

/** 时间引用：秒数，或 "beat:N" / "beat:N+0.15" / "beat:N-0.1"（引用 spec.beats） */
export type TimeRef = number | string;

export interface SpringParams {
  /** 刚度，默认 170 */
  stiffness?: number;
  /** 阻尼，默认 14（欠阻尼，有过冲） */
  damping?: number;
}

export interface Keyframe {
  t: TimeRef;
  v: number;
  /** 段缓动（作用于上一关键帧 → 本关键帧），默认 outCubic */
  ease?: EaseName;
  /** 闭式阻尼弹簧（代替 ease；归一化到段时长内基本收敛，任意 t 可重入） */
  spring?: SpringParams;
}

export interface Track {
  prop: TrackProp;
  kf: Keyframe[];
}

export type LayerAnchor =
  | 'center' | 'top' | 'bottom' | 'left' | 'right'
  | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

// ── 效果 ──────────────────────────────────────────────────────────────────────

export interface KineticTextEffect {
  type: 'kineticText';
  /** 逐字 / 逐词（CJK 建议 char） */
  split?: 'char' | 'word';
  at?: TimeRef;
  /** 每个单元的入场时长（秒），默认 0.5 */
  dur?: number;
  /** 单元间隔（秒），默认 0.045 */
  stagger?: number;
  /** 入场初始状态 */
  from?: { x?: number; y?: number; rotate?: number; scale?: number; opacity?: number };
  ease?: EaseName;
  spring?: SpringParams;
}

export interface MaskRevealEffect {
  type: 'maskReveal';
  at?: TimeRef;
  dur?: number;
  /** 揭示方向；center 为圆形扩散 */
  dir?: 'left' | 'right' | 'top' | 'bottom' | 'center';
  ease?: EaseName;
  /** true 时反向（收拢隐藏，用作出场） */
  out?: boolean;
}

export interface ShakeEffect {
  type: 'shake';
  at?: TimeRef;
  dur?: number;
  /** 振幅 px，默认 12 */
  amp?: number;
  /** 频率 Hz，默认 18 */
  freq?: number;
  /** 噪声种子（确定性），默认 1 */
  seed?: number;
  /** 旋转振幅（度），默认 amp/10 */
  rotAmp?: number;
}

export interface LineDrawEffect {
  type: 'lineDraw';
  at?: TimeRef;
  dur?: number;
  /** 多条路径的间隔（秒），默认 0.08 */
  stagger?: number;
  ease?: EaseName;
}

export interface NumberRollEffect {
  type: 'numberRoll';
  at?: TimeRef;
  dur?: number;
  from?: number;
  to: number;
  /** plain: 原样；comma: 千分位；compact-cn: 万/亿；percent: 加 % */
  format?: 'plain' | 'comma' | 'compact-cn' | 'percent';
  /** 小数位（plain/comma/percent），默认 0 */
  decimals?: number;
  /** 前后缀 */
  prefix?: string;
  suffix?: string;
  ease?: EaseName;
}

export interface TrailEffect {
  type: 'trail';
  /** 残影数 ≤4 */
  copies?: number;
  /** 每个残影滞后（秒），默认 0.06 */
  lag?: number;
  /** 逐级透明度衰减，默认 0.5 */
  fade?: number;
}

export interface MagnifyEffect {
  type: 'magnify';
  at?: TimeRef;
  dur?: number;
  /** 聚焦区域（舞台坐标，支持 "62%" 或 px 数字） */
  region: { x: number | string; y: number | string; r: number };
  /** 外围压暗强度 0-1，默认 0.45 */
  dim?: number;
  /** 圈环颜色，默认 var(--fx-accent) */
  color?: string;
}

export interface TypewriterEffect {
  type: 'typewriter';
  at?: TimeRef;
  /** 每字符间隔秒，默认 0.06 */
  charDur?: number;
  /** 是否显示闪烁光标（t 驱动方波），默认 true */
  cursor?: boolean;
  /** 光标颜色，默认 var(--fx-accent) */
  cursorColor?: string;
}

export interface GlitchEffect {
  type: 'glitch';
  at?: TimeRef;
  dur?: number;
  /** RGB 分离幅度 px，默认 6 */
  amp?: number;
  /** 抖动切片频率 Hz，默认 14 */
  freq?: number;
  seed?: number;
}

export interface ShineEffect {
  type: 'shine';
  at?: TimeRef;
  /** 单次扫光时长，默认 1.1 */
  dur?: number;
  /** 循环间隔秒（0=只扫一次），默认 0 */
  every?: number;
  /** 光带角度 deg，默认 115 */
  angle?: number;
  /** 光带强度 0-1，默认 0.5 */
  strength?: number;
}

export interface GradientShiftEffect {
  type: 'gradientShift';
  /** 循环周期秒，默认 6 */
  period?: number;
  /** 渐变角度 deg，默认 120 */
  angle?: number;
  /** 颜色列表（2-4 个），默认 [accent, accent2] */
  colors?: string[];
  /** 'text'（渐变填字）| 'bg'（背景流动），默认 text */
  mode?: 'text' | 'bg';
}

export interface PathMoveEffect {
  type: 'pathMove';
  at?: TimeRef;
  dur?: number;
  /** 二次贝塞尔控制点与终点（相对图层起始位置的 px 偏移） */
  via: { x: number; y: number };
  to: { x: number; y: number };
  ease?: EaseName;
  /** 是否让元素朝向运动切线方向旋转，默认 false */
  orient?: boolean;
}

// ── 持续生命感原语（v1.1 新增：循环/待机动画，让画面"活着"而非动完就死） ────────

export interface WaveTextEffect {
  type: 'waveText';
  /** 开始漂浮的时刻（通常接在 kineticText 入场后），默认 0 */
  at?: TimeRef;
  /** 波浪垂直振幅 px，默认 10 */
  amp?: number;
  /** 波浪周期秒，默认 2.4 */
  period?: number;
  /** 相邻字符相位差（0-1，1=整周期），默认 0.12 */
  phaseStep?: number;
  /** 同时轻微旋转（度），默认 0 */
  rotAmp?: number;
}

export interface FlickerEffect {
  type: 'flicker';
  at?: TimeRef;
  /** 点亮过程时长（不稳定期），默认 1.2；之后进入稳定微闪 */
  dur?: number;
  /** 稳定后的微闪强度 0-1（0=完全稳定），默认 0.08 */
  idle?: number;
  /** 熄灭时刻（可选） */
  off?: TimeRef;
  seed?: number;
}

export interface ScanRevealEffect {
  type: 'scanReveal';
  at?: TimeRef;
  dur?: number;
  /** 扫描方向，默认 top（从上往下扫出） */
  dir?: 'top' | 'bottom' | 'left' | 'right';
  /** 扫描亮线颜色，默认 var(--fx-accent) */
  color?: string;
  /** 亮线厚度 px，默认 3 */
  lineWidth?: number;
  /** 是否带扫过辉光，默认 true */
  glow?: boolean;
  ease?: EaseName;
}

export interface LiquidBlobEffect {
  type: 'liquidBlob';
  /** 形变周期秒，默认 8 */
  period?: number;
  /** 形变幅度 0-1（0.5=半径摆动 ±50% 差异），默认 0.35 */
  amount?: number;
  seed?: number;
}

export interface OrbitEffect {
  type: 'orbit';
  at?: TimeRef;
  /** 公转周期秒，默认 6 */
  period?: number;
  /** 轨道横向半径 px，默认 120 */
  rx?: number;
  /** 轨道纵向半径 px，默认 rx*0.6 */
  ry?: number;
  /** 初始相位 0-1，默认 0 */
  phase?: number;
  /** 方向，默认 cw（顺时针） */
  dir?: 'cw' | 'ccw';
  /** 是否随轨道近远缩放（伪 3D），默认 false */
  depth?: boolean;
}

export interface SliceInEffect {
  type: 'sliceIn';
  at?: TimeRef;
  dur?: number;
  /** 切片数 2-8，默认 4 */
  slices?: number;
  /** 切片错位幅度 px，默认 90 */
  offset?: number;
  /** 切片方向：h=水平条带左右错位（默认），v=竖直条带上下错位 */
  dir?: 'h' | 'v';
  ease?: EaseName;
  seed?: number;
}

export interface BreatheEffect {
  type: 'breathe';
  at?: TimeRef;
  /** 呼吸周期秒，默认 3.6 */
  period?: number;
  /** 缩放幅度（1±amount），默认 0.02 */
  amount?: number;
  /** 同步呼吸的辉光（drop-shadow）颜色；缺省不加辉光 */
  glowColor?: string;
  /** 辉光最大半径 px，默认 26 */
  glowRadius?: number;
}

export interface JitterEffect {
  type: 'jitter';
  at?: TimeRef;
  /** 结束时刻（缺省持续到场景尾） */
  until?: TimeRef;
  /** 位移振幅 px，默认 2.5 */
  amp?: number;
  /** 跳动频率 Hz（阶梯式换位，非平滑），默认 9 */
  freq?: number;
  /** 旋转振幅度，默认 0.8 */
  rotAmp?: number;
  seed?: number;
}

export type SceneEffect =
  | KineticTextEffect | MaskRevealEffect | ShakeEffect | LineDrawEffect
  | NumberRollEffect | TrailEffect | MagnifyEffect
  | TypewriterEffect | GlitchEffect | ShineEffect | GradientShiftEffect | PathMoveEffect
  | WaveTextEffect | FlickerEffect | ScanRevealEffect | LiquidBlobEffect
  | OrbitEffect | SliceInEffect | BreatheEffect | JitterEffect;

export type SceneEffectType = SceneEffect['type'];

export const SCENE_EFFECT_TYPES: SceneEffectType[] = [
  'kineticText', 'maskReveal', 'shake', 'lineDraw', 'numberRoll', 'trail', 'magnify',
  'typewriter', 'glitch', 'shine', 'gradientShift', 'pathMove',
  'waveText', 'flicker', 'scanReveal', 'liquidBlob', 'orbit', 'sliceIn', 'breathe', 'jitter',
];

// ── 图层 / 场景 ───────────────────────────────────────────────────────────────

export interface SceneLayer {
  id: string;
  kind: 'text' | 'shape' | 'image' | 'svg' | 'html' | 'group';
  /** kind=text 的文案 */
  text?: string;
  /** kind=html/group 的内嵌 HTML（过安全校验，禁 script） */
  html?: string;
  /** kind=svg 的 SVG 源（禁 script） */
  svg?: string;
  /** kind=image 的图片 URL */
  src?: string;
  /** 字阶/工具类：kp-h1(96) kp-h2(72) kp-h3(56) kp-num(40) kp-sub(32) kp-body(30) kp-label(18)，
   * 可读性工具：kp-chip(底托) kp-stroke(描边) kp-shadow(投影)。可叠自定义类 */
  class?: string;
  /** 内联样式（camelCase 或 kebab 均可，编译时转 kebab） */
  style?: Record<string, string | number>;
  /** 锚点位置（舞台百分比或 px） */
  at?: { x: number | string; y: number | string; anchor?: LayerAnchor };
  w?: number | string;
  h?: number | string;
  z?: number;
  /** 视差系数：1=完全随镜头（默认），0=钉在屏幕上不随镜头 */
  parallax?: number;
  /** 图层可见窗口（秒），默认 [0, duration] */
  in?: TimeRef;
  out?: TimeRef;
  tracks?: Track[];
  effects?: SceneEffect[];
  /** kind=group 的子图层 */
  children?: SceneLayer[];
}

export interface SceneFlash {
  at: TimeRef;
  /** 默认 0.3 */
  dur?: number;
  /** 默认 #ffffff */
  color?: string;
  /** 峰值透明度 0-1，默认 0.75 */
  peak?: number;
}

export interface SceneSpec {
  v: number;
  /** 场景时长（秒），≤15 */
  duration: number;
  /** transparent（叠加层，默认）| opaque（整屏信息页） */
  bg?: 'transparent' | 'opaque';
  /** opaque 时的背景 CSS（background 简写；渐变/图片均可），缺省用主题 primary 或 style kit 背景 */
  bgCss?: string;
  /** fxDesignSystem 主题 id */
  theme?: string;
  /** 艺术方向套件 id（styleKits）：一个字段激活整套美学语言（配色/字体/签名装饰层/质感），
   * 优先级高于 theme/fonts；backdrop=false 可只要配色不要签名装饰 */
  style?: string;
  /** style kit 的签名装饰层开关，默认 true */
  styleBackdrop?: boolean;
  /** fontSystem 字体配对 id 列表 */
  fonts?: string[];
  /** 节奏点（秒），供 "beat:N" 引用 */
  beats?: number[];
  /** 全场景镜头（作用于所有图层的容器）：prop 支持 x/y/scale/rotate */
  camera?: { tracks: Track[] };
  /** 节奏闪白 */
  flashes?: SceneFlash[];
  layers: SceneLayer[];
}

// ── 纯函数 ────────────────────────────────────────────────────────────────────

/** 解析 TimeRef："beat:2"/"beat:2+0.15"/"beat:2-0.1" → 秒。无 beats 或越界返回 null */
export function resolveTimeRef(ref: TimeRef | undefined, beats: number[] | undefined, fallback = 0): number {
  if (ref == null) return fallback;
  if (typeof ref === 'number') return ref;
  const m = /^beat:(\d+)\s*(?:([+-])\s*([\d.]+))?$/.exec(String(ref).trim());
  if (!m) return fallback;
  const base = beats?.[Number(m[1])];
  if (base == null) return fallback;
  const off = m[3] ? parseFloat(m[3]) * (m[2] === '-' ? -1 : 1) : 0;
  return base + off;
}

/** 舞台坐标归一："62%" → "62%"；数字 → px */
export function stageCoord(v: number | string | undefined, fallback: string): string {
  if (v == null) return fallback;
  return typeof v === 'number' ? `${v}px` : String(v);
}
