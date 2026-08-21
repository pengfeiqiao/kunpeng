/**
 * speechAudit/engine — 口播审片流水线。
 *
 * 词级转写 → 候选窗口（retake 模式 + 文本启发式，全本地免费）
 * → 短窗原始重转写（并发 3，恢复被 ASR 清洗的语流）
 * → LLM 信息增量判定（并发 2，JSON 校验）
 * → 词边界吸附 → SpeechAuditReport 增量写入 editorStore。
 *
 * 语气词/停顿走零成本本地路径秒出；重复/口误随流水线渐进补充。
 * 引擎只产出标记，绝不自动剪。
 */
import { nanoid } from 'nanoid';
import { useEditorStore, type Transcript, type TranscriptSentence } from '@/stores/editorStore';
import { transcribeFileRangeWords, type TranscribedSentence } from '../transcribe';
import { ensureTranscript, analyzeTranscriptRedundancy, buildTranscriptTimelineRows } from '../transcriptOps';
import { detectPausesFromWords, detectRetakeWindows } from './audio';
import { judgeWindows, type WindowInput, type LlmWindowFinding } from './prompt';
import type {
  PauseEvent, SpeechAuditOptions, SpeechAuditReport, SpeechFinding, SuspectWindow,
} from './types';

const WINDOW_PAD_SEC = 1.2;
const BREATH_MARGIN_SEC = 0.08;
const ASR_CONCURRENCY = 3;
const LLM_BATCH_SIZE = 6;

// ── 小工具 ──────────────────────────────────────────────────────────────────

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

function mergeWindows(windows: SuspectWindow[], maxWindows: number): SuspectWindow[] {
  const sorted = [...windows].sort((a, b) => a.sourceStart - b.sourceStart);
  const merged: SuspectWindow[] = [];
  for (const w of sorted) {
    const padded = {
      ...w,
      sourceStart: Math.max(0, w.sourceStart - WINDOW_PAD_SEC),
      sourceEnd: w.sourceEnd + WINDOW_PAD_SEC,
    };
    const last = merged[merged.length - 1];
    if (last && last.mediaPath === padded.mediaPath && padded.sourceStart <= last.sourceEnd) {
      last.sourceEnd = Math.max(last.sourceEnd, padded.sourceEnd);
      last.reasons = [...new Set([...last.reasons, ...padded.reasons])];
      if (padded.energyScore != null) last.energyScore = Math.max(last.energyScore ?? 0, padded.energyScore);
    } else {
      merged.push(padded);
    }
  }
  // 超上限时按证据强度取前 N（有能量证据的优先）
  if (merged.length > maxWindows) {
    return merged
      .map((w, i) => ({ w, key: (w.energyScore ?? 0) * 100 + (w.reasons.length) - i * 0.001 }))
      .sort((a, b) => b.key - a.key)
      .slice(0, maxWindows)
      .map((x) => x.w)
      .sort((a, b) => a.sourceStart - b.sourceStart);
  }
  return merged;
}

/** finding 边界吸附到词间隙中点 + 呼吸余量，从根上避免切到半个字 */
function snapToWordBoundaries(
  transcript: Transcript,
  sourceStart: number,
  sourceEnd: number,
): [number, number] {
  const words = transcript.sentences
    .filter((s) => !s.silence)
    .flatMap((s) => s.words)
    .sort((a, b) => a.start - b.start);
  if (words.length === 0) return [sourceStart, sourceEnd];

  let start = sourceStart;
  let end = sourceEnd;
  // start：找最后一个 end <= sourceStart+容差 的词，吸到它和下一个词的间隙中点
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.start >= sourceStart - 0.05) {
      const prev = words[i - 1];
      start = prev ? Math.max(prev.end + BREATH_MARGIN_SEC, (prev.end + w.start) / 2) : Math.max(0, w.start - BREATH_MARGIN_SEC);
      break;
    }
  }
  // end：找最后一个 end <= sourceEnd+容差 的词，吸到它和下一个词的间隙中点
  for (let i = words.length - 1; i >= 0; i--) {
    const w = words[i];
    if (w.end <= sourceEnd + 0.05) {
      const next = words[i + 1];
      end = next ? Math.min(next.start - BREATH_MARGIN_SEC, (w.end + next.start) / 2) : w.end + BREATH_MARGIN_SEC;
      break;
    }
  }
  if (end - start < 0.05) return [sourceStart, sourceEnd];
  return [Math.max(0, start), end];
}

function sentencesInRange(transcript: Transcript, start: number, end: number): TranscriptSentence[] {
  return transcript.sentences.filter((s) => !s.silence && s.end > start && s.start < end);
}

/** 原始重转写 → 带停顿标注的文本，如「我们团队 [0.4s] 我们团队已经」 */
function formatRawText(sentences: TranscribedSentence[]): string {
  const parts: string[] = [];
  for (const sen of sentences) {
    if (sen.words.length === 0) {
      parts.push(`[${sen.startSec.toFixed(1)}s] ${sen.text}`);
      continue;
    }
    const tokens: string[] = [`[${sen.startSec.toFixed(1)}s]`];
    for (const w of sen.words) {
      const blank = (w.blankMs ?? 0) / 1000;
      if (blank >= 0.25) tokens.push(`[停顿${blank.toFixed(1)}s]`);
      tokens.push(w.w);
    }
    parts.push(tokens.join(' '));
  }
  return parts.join('\n');
}

// ── 轻量路径：语气词 + 停顿（本地免费，秒出） ────────────────────────────────

function buildFillerFindings(transcript: Transcript): SpeechFinding[] {
  const findings: SpeechFinding[] = [];
  for (const sen of transcript.sentences) {
    if (sen.silence) continue;
    // 合并连续 filler 词为一个 finding，避免碎切
    let runStart = -1;
    const flush = (endIdx: number) => {
      if (runStart < 0) return;
      const run = sen.words.slice(runStart, endIdx);
      const text = run.map((w) => w.w).join('');
      const [s, e] = [run[0].start, run[run.length - 1].end];
      findings.push({
        id: `sf-${nanoid(6)}`,
        category: 'filler',
        mediaPath: transcript.mediaPath,
        sourceStart: Math.max(0, s - 0.03),
        sourceEnd: e + 0.03,
        text,
        evidence: [{ kind: 'text_heuristic', detail: `独立语气词「${text}」` }],
        confidence: 0.85,
        enabled: true,
      });
      runStart = -1;
    };
    sen.words.forEach((w, i) => {
      if (w.filler) { if (runStart < 0) runStart = i; }
      else flush(i);
    });
    flush(sen.words.length);
  }
  return findings;
}

function buildPauseFindings(pauses: PauseEvent[]): SpeechFinding[] {
  return pauses.map((p) => ({
    id: `sp-${nanoid(6)}`,
    category: 'pause' as const,
    mediaPath: p.mediaPath,
    // 停顿删除时前后各留呼吸余量，不要贴死词边界
    sourceStart: p.sourceStart + BREATH_MARGIN_SEC,
    sourceEnd: Math.max(p.sourceStart + BREATH_MARGIN_SEC + 0.05, p.sourceEnd - BREATH_MARGIN_SEC),
    text: `（停顿 ${p.durSec.toFixed(1)}s）`,
    evidence: [{ kind: 'pause_pattern' as const, detail: `词间停顿 ${p.durSec.toFixed(2)}s`, score: p.durSec }],
    confidence: 0.95,
    enabled: true,
    pauseDur: p.durSec,
  })).filter((f) => f.sourceEnd - f.sourceStart >= 0.1);
}

// ── 候选窗口生成 ────────────────────────────────────────────────────────────

function textHeuristicWindows(mediaPath: string, startSec?: number, endSec?: number): SuspectWindow[] {
  const report = analyzeTranscriptRedundancy({ startSec, endSec });
  const rows = buildTranscriptTimelineRows();
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const windows: SuspectWindow[] = [];
  for (const issue of report.issues) {
    if (issue.type === 'speed_anomaly') continue; // 仅提示级，不进重转写
    for (const rowId of issue.rowIds) {
      const row = rowById.get(rowId);
      if (!row || row.mediaPath !== mediaPath) continue;
      windows.push({
        mediaPath,
        sourceStart: row.sourceStart,
        sourceEnd: row.sourceEnd,
        reasons: [`${issue.type}: ${issue.message}`],
      });
    }
  }
  return windows;
}

// ── 主流水线 ────────────────────────────────────────────────────────────────

let auditRunning = false;

export function isAuditRunning(): boolean {
  return auditRunning;
}

/**
 * 跑完整审片。findings 增量写入 editorStore.speechAudit（面板实时刷新）。
 * 返回最终报告。重复调用时若已在运行则直接抛错。
 */
export async function runSpeechAudit(options: SpeechAuditOptions = {}): Promise<SpeechAuditReport> {
  if (auditRunning) throw new Error('审片正在进行中');
  auditRunning = true;
  const maxWindows = options.maxWindows ?? 30;
  const stats = { asrCalls: 0, llmCalls: 0, windows: 0 };
  const findings: SpeechFinding[] = [];

  const publish = (status: SpeechAuditReport['status'], progress?: string, error?: string) => {
    const report: SpeechAuditReport = {
      createdAt: Date.now(),
      findings: [...findings].sort((a, b) => a.sourceStart - b.sourceStart),
      stats: { ...stats },
      status,
      ...(progress ? { progress } : {}),
      ...(error ? { error } : {}),
    };
    useEditorStore.getState().setSpeechAudit(report);
    options.onUpdate?.(report);
    return report;
  };

  try {
    const s = useEditorStore.getState();
    // 审片范围内涉及的源媒体
    const mediaPaths = [...new Set(s.clips.map((c) => c.path))];
    if (mediaPaths.length === 0) throw new Error('时间轴没有视频片段');

    // 1. 词级转写（有缓存直接过）
    publish('running', '转写中…');
    const transcripts: Transcript[] = [];
    for (const path of mediaPaths) {
      transcripts.push(await ensureTranscript(path));
    }

    // 2. 轻量路径：语气词 + 停顿秒出
    for (const tr of transcripts) {
      findings.push(...buildFillerFindings(tr));
      findings.push(...buildPauseFindings(detectPausesFromWords(tr)));
    }
    publish('running', '分析可疑窗口…');

    // 3. 候选窗口：retake 模式 + 文本启发式
    const allWindows: SuspectWindow[] = [];
    for (const tr of transcripts) {
      const pauses = detectPausesFromWords(tr);
      allWindows.push(...await detectRetakeWindows(tr, pauses));
      allWindows.push(...textHeuristicWindows(tr.mediaPath, options.startSec, options.endSec));
    }
    const windows = mergeWindows(allWindows, maxWindows);
    stats.windows = windows.length;
    if (windows.length === 0) return publish('done');

    // 4. 短窗原始重转写（并发 3）
    let rewhisperDone = 0;
    publish('running', `重转写 0/${windows.length}…`);
    const trByPath = new Map(transcripts.map((t) => [t.mediaPath, t]));
    const inputs: WindowInput[] = (await mapPool(windows, ASR_CONCURRENCY, async (w) => {
      let rawText = '';
      try {
        const raw = await transcribeFileRangeWords(w.mediaPath, w.sourceStart, w.sourceEnd - w.sourceStart, undefined, { raw: true });
        stats.asrCalls += 1;
        rawText = formatRawText(raw);
      } catch (err) {
        console.warn('[speechAudit] 短窗重转写失败:', err);
      }
      rewhisperDone += 1;
      publish('running', `重转写 ${rewhisperDone}/${windows.length}…`);
      const tr = trByPath.get(w.mediaPath);
      const cleanText = tr
        ? sentencesInRange(tr, w.sourceStart, w.sourceEnd).map((x) => `[${x.start.toFixed(1)}s] ${x.text}`).join('\n')
        : '';
      return { window: w, cleanText, rawText };
    })).filter((inp) => inp.cleanText || inp.rawText);

    // 5. LLM 信息增量判定（分批，批间并发 2）
    publish('running', 'AI 语义判定中…');
    const batches: WindowInput[][] = [];
    for (let i = 0; i < inputs.length; i += LLM_BATCH_SIZE) batches.push(inputs.slice(i, i + LLM_BATCH_SIZE));
    const globalText = transcripts
      .flatMap((t) => t.sentences.filter((x) => !x.silence).map((x) => x.text))
      .join('\n');

    await mapPool(batches, 2, async (batch) => {
      const llmFindings = await judgeWindows(globalText, batch);
      stats.llmCalls += 1;
      const mediaPath = batch[0]?.window.mediaPath ?? mediaPaths[0];
      const tr = trByPath.get(mediaPath);
      for (const lf of llmFindings) {
        findings.push(llmFindingToSpeechFinding(lf, mediaPath, tr, batch));
      }
      publish('running', 'AI 语义判定中…');
    });

    return publish('done');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    publish('error', undefined, msg);
    throw err;
  } finally {
    auditRunning = false;
  }
}

function llmFindingToSpeechFinding(
  lf: LlmWindowFinding,
  mediaPath: string,
  transcript: Transcript | undefined,
  batch: WindowInput[],
): SpeechFinding {
  const [start, end] = transcript
    ? snapToWordBoundaries(transcript, lf.sourceStart, lf.sourceEnd)
    : [lf.sourceStart, lf.sourceEnd];
  const sourceWindow = batch.find((b) =>
    lf.sourceStart >= b.window.sourceStart - 1 && lf.sourceEnd <= b.window.sourceEnd + 1)?.window;
  const evidence: SpeechFinding['evidence'] = [
    { kind: 'llm_semantic', detail: lf.reason, score: lf.confidence },
  ];
  if (sourceWindow?.energyScore != null) {
    evidence.push({ kind: 'energy_xcorr', detail: `能量相似度 ${sourceWindow.energyScore.toFixed(2)}`, score: sourceWindow.energyScore });
  }
  if (sourceWindow?.reasons.some((r) => r.startsWith('retake'))) {
    evidence.push({ kind: 'pause_pattern', detail: sourceWindow.reasons.find((r) => r.startsWith('retake')) ?? '' });
  }
  evidence.push({ kind: 'raw_rewhisper', detail: '经短窗原始重转写复核' });
  return {
    id: `sa-${nanoid(6)}`,
    category: lf.category,
    mediaPath,
    sourceStart: start,
    sourceEnd: end,
    text: lf.text,
    ...(lf.keptText ? { keptAlternativeText: lf.keptText } : {}),
    ...(lf.keptStart != null && lf.keptEnd != null ? { keptRange: [lf.keptStart, lf.keptEnd] as [number, number] } : {}),
    evidence,
    confidence: lf.confidence,
    enabled: lf.confidence >= 0.5,
  };
}
