/**
 * speechAudit/audio — 本地免费音频证据。
 *
 * 三件套：
 * 1. 停顿检测：优先词级 blank_duration（豆包词级时间戳，精确到词间），
 *    无词级时降级 ffmpeg silencedetect（阈值 0.3s，捕捉重来前的换气口）。
 * 2. 能量包络互相关：复用 waveform peaks（50/s，磁盘缓存），归一化互相关
 *    → 声学相似度。两遍重录的能量轮廓高度相似，是 ASR 文本给不了的铁证。
 * 3. retake 模式识别：停顿 ≥0.3s + 停顿两侧声学相似 ≥阈值 → 高置信重录窗口。
 */
import type { Transcript, TranscriptSentence } from '@/stores/editorStore';
import { getWaveform, PEAKS_PER_SEC } from '../waveform';
import type { PauseEvent, SuspectWindow } from './types';

/** 重来前的换气口通常 0.2-0.5s；低于字幕静音检测的 0.8s 下限 */
const MIN_PAUSE_SEC = 0.3;
/** retake 判定的声学相似度阈值 */
const RETAKE_XCORR_THRESHOLD = 0.62;
/** retake 对比窗口最长回看时长（秒） */
const RETAKE_LOOKBACK_SEC = 12;

// ── 停顿检测 ────────────────────────────────────────────────────────────────

/**
 * 从词级时间戳提取停顿事件（词间 blank / 相邻词时间间隙 / 句间间隙）。
 * 只依赖 Transcript（免费）；silence 伪句跳过（那是"无人声段"另一条链路）。
 */
export function detectPausesFromWords(transcript: Transcript, minPauseSec = MIN_PAUSE_SEC): PauseEvent[] {
  const events: PauseEvent[] = [];
  const push = (start: number, end: number) => {
    const dur = end - start;
    if (dur >= minPauseSec) {
      events.push({ mediaPath: transcript.mediaPath, sourceStart: start, sourceEnd: end, durSec: dur });
    }
  };
  const sentences = transcript.sentences.filter((s) => !s.silence);
  for (let si = 0; si < sentences.length; si++) {
    const sen = sentences[si];
    // 句内词间隙
    for (let wi = 1; wi < sen.words.length; wi++) {
      const prev = sen.words[wi - 1];
      const cur = sen.words[wi];
      // blankMs 优先（豆包原生停顿信号）；否则用相邻词时间差
      const gap = cur.blankMs != null ? cur.blankMs / 1000 : cur.start - prev.end;
      if (gap >= minPauseSec) push(prev.end, prev.end + gap);
    }
    // 句间间隙
    const next = sentences[si + 1];
    if (next && next.start - sen.end >= minPauseSec) push(sen.end, next.start);
  }
  // 去重（同一停顿可能被 blankMs 和句间隙同时报）
  events.sort((a, b) => a.sourceStart - b.sourceStart);
  return events.filter((e, i) => i === 0 || e.sourceStart - events[i - 1].sourceStart >= 0.1);
}

// ── 能量包络互相关 ──────────────────────────────────────────────────────────

/** 提取 [start,end] 区间的峰值切片并做能量归一化（去直流 + 单位方差） */
function normalizedSlice(peaks: number[], startSec: number, endSec: number): number[] | null {
  const i0 = Math.max(0, Math.floor(startSec * PEAKS_PER_SEC));
  const i1 = Math.min(peaks.length, Math.ceil(endSec * PEAKS_PER_SEC));
  if (i1 - i0 < PEAKS_PER_SEC * 0.4) return null; // <0.4s 太短没意义
  const slice = peaks.slice(i0, i1);
  const mean = slice.reduce((s, v) => s + v, 0) / slice.length;
  const centered = slice.map((v) => v - mean);
  const norm = Math.sqrt(centered.reduce((s, v) => s + v * v, 0));
  if (norm < 1e-6) return null; // 全静音
  return centered.map((v) => v / norm);
}

/**
 * 两个源区间的能量包络相似度（0-1）。长度不同则较短者在较长者上滑动取最大互相关。
 * 用于确认"停顿后这一遍"和"停顿前那一遍"是否声学上是同一句话的重录。
 */
export function energySimilarity(
  peaks: number[],
  aStart: number, aEnd: number,
  bStart: number, bEnd: number,
): number {
  const a = normalizedSlice(peaks, aStart, aEnd);
  const b = normalizedSlice(peaks, bStart, bEnd);
  if (!a || !b) return 0;
  const short = a.length <= b.length ? a : b;
  const long = a.length > b.length ? a : b;
  // 长度悬殊（>2.5x）不算同一句
  if (long.length > short.length * 2.5) return 0;
  let best = 0;
  const maxLag = long.length - short.length;
  // 步进 2 桶（40ms）足够，省算力
  for (let lag = 0; lag <= maxLag; lag += 2) {
    let dot = 0;
    for (let i = 0; i < short.length; i++) dot += short[i] * long[lag + i];
    if (dot > best) best = dot;
  }
  // short 已单位化，long 的窗口未重新归一化——结果略偏保守，可接受
  return Math.max(0, Math.min(1, best));
}

// ── retake 模式识别 ─────────────────────────────────────────────────────────

/**
 * 识别重录窗口：停顿两侧、时长相近的两段语音，能量包络高度相似 → 大概率是
 * "说错了停下来重讲一遍"。返回覆盖两遍的可疑窗口（含前一遍，供 LLM 决定留哪遍）。
 */
export async function detectRetakeWindows(
  transcript: Transcript,
  pauses: PauseEvent[],
): Promise<SuspectWindow[]> {
  const peaks = await getWaveform(transcript.mediaPath);
  if (!peaks) return [];
  const windows: SuspectWindow[] = [];
  const sentences = transcript.sentences.filter((s) => !s.silence);

  for (const pause of pauses) {
    // 停顿后第一句
    const after = sentences.find((s) => s.start >= pause.sourceEnd - 0.15 && s.start < pause.sourceEnd + 1.5);
    if (!after) continue;
    const afterDur = after.end - after.start;
    if (afterDur < 0.5 || afterDur > RETAKE_LOOKBACK_SEC) continue;
    // 停顿前等长区间（对齐重录典型形态：讲了一半停住，从头再来）
    const beforeEnd = pause.sourceStart;
    const beforeStart = Math.max(0, beforeEnd - afterDur * 1.4);
    if (beforeEnd - beforeStart < 0.5) continue;

    const score = energySimilarity(peaks, beforeStart, beforeEnd, after.start, after.end);
    if (score >= RETAKE_XCORR_THRESHOLD) {
      windows.push({
        mediaPath: transcript.mediaPath,
        sourceStart: beforeStart,
        sourceEnd: after.end,
        reasons: [`retake：停顿 ${pause.durSec.toFixed(2)}s 两侧能量相似度 ${score.toFixed(2)}`],
        energyScore: score,
      });
    }
  }
  return windows;
}

/** 比较任意两句的能量相似度（供引擎给文本相似候选补充声学证据） */
export async function sentencePairEnergy(
  mediaPath: string,
  a: Pick<TranscriptSentence, 'start' | 'end'>,
  b: Pick<TranscriptSentence, 'start' | 'end'>,
): Promise<number> {
  const peaks = await getWaveform(mediaPath);
  if (!peaks) return 0;
  return energySimilarity(peaks, a.start, a.end, b.start, b.end);
}
