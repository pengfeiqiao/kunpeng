/**
 * runtime/easing — 标准缓动 + 闭式阻尼弹簧。
 *
 * 全部为 t 的纯函数（无状态、无迭代模拟），保证预览/导出任意时间点重入一致。
 */
import type { EaseName, SpringParams } from '../spec';

export type EaseFn = (p: number) => number;

const c1 = 1.70158;
const c3 = c1 + 1;

export const EASINGS: Record<EaseName, EaseFn> = {
  linear: (p) => p,
  inQuad: (p) => p * p,
  outQuad: (p) => 1 - (1 - p) * (1 - p),
  inOutQuad: (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2),
  inCubic: (p) => p * p * p,
  outCubic: (p) => 1 - Math.pow(1 - p, 3),
  inOutCubic: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  outQuart: (p) => 1 - Math.pow(1 - p, 4),
  inExpo: (p) => (p === 0 ? 0 : Math.pow(2, 10 * p - 10)),
  outExpo: (p) => (p === 1 ? 1 : 1 - Math.pow(2, -10 * p)),
  inOutExpo: (p) => (p === 0 ? 0 : p === 1 ? 1 : p < 0.5 ? Math.pow(2, 20 * p - 10) / 2 : (2 - Math.pow(2, -20 * p + 10)) / 2),
  inBack: (p) => c3 * p * p * p - c1 * p * p,
  outBack: (p) => 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2),
  outElastic: (p) => {
    if (p === 0 || p === 1) return p;
    return Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },
  outBounce: (p) => {
    const n1 = 7.5625; const d1 = 2.75;
    if (p < 1 / d1) return n1 * p * p;
    if (p < 2 / d1) return n1 * (p -= 1.5 / d1) * p + 0.75;
    if (p < 2.5 / d1) return n1 * (p -= 2.25 / d1) * p + 0.9375;
    return n1 * (p -= 2.625 / d1) * p + 0.984375;
  },
};

export function easeOf(name?: EaseName): EaseFn {
  return (name && EASINGS[name]) || EASINGS.outCubic;
}

/**
 * 闭式欠阻尼弹簧：返回"距目标的归一化偏移衰减系数"g(τ)。
 * value(τ) = target + (v0 - target) * g(τ)，τ 为距段起点的秒数。
 * g(0)=1，g(∞)→0；欠阻尼时带过冲振荡。纯闭式解，任意 τ 可重入。
 */
export function springDecay(tau: number, params?: SpringParams): number {
  if (tau <= 0) return 1;
  const stiffness = Math.max(1, params?.stiffness ?? 170);
  const damping = Math.max(0.1, params?.damping ?? 14);
  const w0 = Math.sqrt(stiffness); // 质量归一
  const zeta = damping / (2 * w0);
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return Math.exp(-zeta * w0 * tau) * (Math.cos(wd * tau) + ((zeta * w0) / wd) * Math.sin(wd * tau));
  }
  // 临界/过阻尼
  const decay = Math.exp(-w0 * tau);
  return decay * (1 + w0 * tau);
}
