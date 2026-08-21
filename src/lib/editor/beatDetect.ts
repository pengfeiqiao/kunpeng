/**
 * beatDetect — 智能踩点（按节奏能量的近似节拍检测，非乐理 BPM 分析）。
 *
 * 复用 waveform 的 PCM 峰值：能量包络 → 滑动均值自适应阈值 → 峰值挑选
 * （最小间隔约束）。结果写 editorStore.markers，时间轴吸附点合并踩点。
 */
import { getWaveform, PEAKS_PER_SEC } from './waveform';

export interface BeatDetectOptions {
  /** 最小节拍间隔（秒），默认 0.3 */
  minGapSec?: number;
  /** 灵敏度 0-1（越高点越多），默认 0.5 */
  sensitivity?: number;
  /** 限制返回数量（按能量排序后裁剪再按时间排序） */
  maxBeats?: number;
}

/** 检测媒体（BGM/成片音轨）的节奏能量峰，返回秒数组（升序） */
export async function detectBeats(mediaPath: string, opts: BeatDetectOptions = {}): Promise<number[]> {
  const peaks = await getWaveform(mediaPath);
  if (!peaks || peaks.length === 0) return [];

  const minGap = Math.max(0.1, opts.minGapSec ?? 0.3);
  const sensitivity = Math.max(0, Math.min(1, opts.sensitivity ?? 0.5));

  // 能量包络平滑（5 桶 ≈ 100ms 窗口）
  const energy = peaks.map((_, i) => {
    let sum = 0; let n = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(peaks.length - 1, i + 2); j++) { sum += peaks[j]; n++; }
    return sum / n;
  });

  // 滑动均值（1.5s 窗口）作为自适应基线
  const win = Math.round(1.5 * PEAKS_PER_SEC);
  const candidates: { t: number; strength: number }[] = [];
  for (let i = 1; i < energy.length - 1; i++) {
    let sum = 0; let n = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(energy.length - 1, i + win); j++) { sum += energy[j]; n++; }
    const baseline = sum / n;
    // 阈值：基线 × (1.25..2.05)，灵敏度越高阈值越低
    const threshold = baseline * (2.05 - sensitivity * 0.8);
    const isLocalMax = energy[i] >= energy[i - 1] && energy[i] >= energy[i + 1];
    if (isLocalMax && energy[i] > threshold && energy[i] > 0.06) {
      candidates.push({ t: i / PEAKS_PER_SEC, strength: energy[i] / (baseline || 1) });
    }
  }

  // 最小间隔约束：同窗口内保留最强
  const picked: { t: number; strength: number }[] = [];
  for (const c of candidates) {
    const last = picked[picked.length - 1];
    if (last && c.t - last.t < minGap) {
      if (c.strength > last.strength) picked[picked.length - 1] = c;
    } else {
      picked.push(c);
    }
  }

  let beats = picked;
  if (opts.maxBeats && beats.length > opts.maxBeats) {
    beats = [...beats].sort((a, b) => b.strength - a.strength).slice(0, opts.maxBeats);
  }
  return beats.map((b) => Number(b.t.toFixed(2))).sort((a, b) => a - b);
}
