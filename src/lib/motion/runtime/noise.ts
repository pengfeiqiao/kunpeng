/**
 * runtime/noise — 确定性连续噪声（seeded 正弦叠加）。
 *
 * 用连续函数而非逐帧随机数：与 fps 无关、任意 t 可重入，
 * 保证 shake 等效果预览/导出逐帧一致。
 */

/** mulberry32 — 仅用于从 seed 生成固定的相位/频率表（构造期一次性），不在帧循环中使用 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface NoiseFn {
  (t: number): number; // ∈ [-1, 1] 近似
}

/**
 * 生成一个确定性连续噪声函数：3 个不可公度频率的正弦叠加。
 * @param seed 种子
 * @param freq 基准频率 Hz
 */
export function seededSines(seed: number, freq: number): NoiseFn {
  const rand = mulberry32(Math.floor(seed * 1013904223) + 1);
  const f1 = freq * (0.9 + rand() * 0.2);
  const f2 = freq * (1.7 + rand() * 0.6);
  const f3 = freq * (2.9 + rand() * 0.8);
  const p1 = rand() * Math.PI * 2;
  const p2 = rand() * Math.PI * 2;
  const p3 = rand() * Math.PI * 2;
  const TWO_PI = Math.PI * 2;
  return (t: number) =>
    (Math.sin(TWO_PI * f1 * t + p1) * 0.55
      + Math.sin(TWO_PI * f2 * t + p2) * 0.3
      + Math.sin(TWO_PI * f3 * t + p3) * 0.15);
}
