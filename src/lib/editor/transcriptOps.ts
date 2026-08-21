/**
 * transcriptOps — 文稿剪辑核心：转写 → Transcript（词级近似）→ 口癖/无人声空白检测
 * → 删句应用为时间轴真实裁剪（拆分主轨 clip）。
 *
 * 时间约定：Transcript 的 start/end 均为**源媒体相对秒**（不随时间轴裁剪
 * 变化），应用删除时才换算为各 clip 的 in/out 裁剪区间。
 */
import { nanoid } from 'nanoid';
import {
  useEditorStore,
  type AudioClip,
  type EditorClip,
  type FxClip,
  type OverlayClip,
  type SubtitleCue,
  type TextClip,
  type Transcript,
  type TranscriptSentence,
  type TranscriptWord,
} from '@/stores/editorStore';
import { transcribeFileWords } from './transcribe';

/** 单字/单词级口癖（独立成词时标记） */
const FILLER_WORD_RE = /^(嗯+|啊+|呃+|额+|哦+|唉+|呀|哈+|emm*|uh+|um+)$/i;
/** 整句口癖：去掉标点后只剩语气词/口头禅 */
const FILLER_SENTENCE_RE = /^(嗯|啊|呃|额|哦|唉|哈|呢|吧|那个|这个|就是|然后|对|对对+|OK|ok|好|好的)+$/;
const FILLER_PHRASES = ['嗯', '啊', '呃', '额', '哦', '唉', '呀', '哈', '那个', '这个', '就是', '然后', '那么', '其实', '感觉', '对吧', '是不是', '你知道', '怎么说'];

const stripPunct = (s: string) => s.replace(/[，。、！？!?,.\s…：:;；"'“”‘’()（）]/g, '');
const SENTENCE_END_RE = /[。！？!?…]$/;
const PUNCT_RE = /[，。、！？!?,.：:;；、…]/;
const SOFT_BREAK_WORDS = [
  '但是', '不过', '所以', '然后', '另外', '其实', '那么', '比如', '因为', '如果',
  '当然', '最后', '首先', '其次', '同时', '而且', '或者', '也就是', '换句话说', '这个时候', '接下来',
];

/**
 * ASR 有时会把长口播压成少量长句，剪口播面板读起来像一整块墙。
 * 这里只补显示/字幕文本的中文标点，不改词级时间戳；剪切边界仍按 words。
 */
export function punctuateChineseTranscriptText(input: string): string {
  let text = input.replace(/\s+/g, ' ').trim();
  if (!text) return text;

  for (const word of SOFT_BREAK_WORDS) {
    text = text.replace(new RegExp(`${word}(?![，。、！？!?,.：:;；、…])`, 'g'), `${word}，`);
  }

  const chars = Array.from(text);
  let out = '';
  let since = 0;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const next = chars[i + 1] ?? '';
    out += ch;
    if (/\s/.test(ch)) continue;
    if (PUNCT_RE.test(ch)) {
      since = 0;
      continue;
    }
    since += /[\u4e00-\u9fff]/.test(ch) ? 1 : 0.5;
    const nextIsPunct = !next || PUNCT_RE.test(next);
    const naturalPause = /[的了嘛吗呢吧呀啊噢哦喔]/.test(ch);
    if (!nextIsPunct && ((since >= 16 && naturalPause) || since >= 24)) {
      out += '，';
      since = 0;
    }
  }

  out = out
    .replace(/，([。！？!?])/g, '$1')
    .replace(/，{2,}/g, '，')
    .replace(/([。！？!?])，/g, '$1');
  if (!SENTENCE_END_RE.test(out)) out += '。';
  return out;
}

/** 把句子文本拆成词（CJK 逐字、拉丁按空格），时间在句内均匀分布 */
function splitWords(text: string, start: number, end: number): TranscriptWord[] {
  const tokens: string[] = [];
  // 拉丁词整体保留，CJK 逐字
  for (const seg of text.split(/(\s+)/)) {
    if (!seg.trim()) continue;
    if (/^[\x00-\x7F]+$/.test(seg)) tokens.push(seg);
    else tokens.push(...Array.from(seg));
  }
  if (tokens.length === 0) return [];
  const dur = Math.max(0.01, end - start);
  const per = dur / tokens.length;
  return tokens.map((w, i) => ({
    w,
    start: start + i * per,
    end: start + (i + 1) * per,
    ...(FILLER_WORD_RE.test(stripPunct(w)) ? { filler: true } : {}),
  }));
}

/**
 * 把句级文本里的标点合并进词级 token（豆包词级时间戳不带标点，
 * 但句 text 带）：按顺序对齐词序列，词间未匹配字符（标点/空格）追加到前一个词。
 * 对不齐（ASR 两路文本不一致）时原样返回，不破坏时间戳。
 */
function mergePunctIntoWords(text: string, words: TranscriptWord[]): TranscriptWord[] {
  if (words.length === 0) return words;
  const chars = Array.from(text);
  const out: TranscriptWord[] = [];
  let ti = 0;
  for (const word of words) {
    const wchars = Array.from(word.w);
    // 从 ti 起找词的起始位置（容忍中间隔标点/空白）
    let start = -1;
    for (let i = ti; i < chars.length; i++) {
      let ok = true;
      for (let j = 0; j < wchars.length; j++) {
        if (chars[i + j] !== wchars[j]) { ok = false; break; }
      }
      if (ok) { start = i; break; }
      // 只允许跳过非文字字符；遇到别的文字说明对不齐
      if (!/[\s\p{P}]/u.test(chars[i])) return words;
    }
    if (start < 0) return words;
    const gap = chars.slice(ti, start).join('');
    if (gap) {
      if (out.length > 0) out[out.length - 1] = { ...out[out.length - 1], w: out[out.length - 1].w + gap };
      else { out.push({ ...word, w: gap + word.w }); ti = start + wchars.length; continue; }
    }
    out.push({ ...word });
    ti = start + wchars.length;
  }
  const tail = chars.slice(ti).join('');
  if (tail && out.length > 0) out[out.length - 1] = { ...out[out.length - 1], w: out[out.length - 1].w + tail };
  return out;
}

/** 旧缓存 Transcript 的词 token 不带标点——按句 text 惰性补齐一次（写回 store）。 */
function upgradeTranscriptPunct(tr: Transcript): Transcript {
  let changed = false;
  const sentences = tr.sentences.map((sen) => {
    if (sen.silence || sen.words.length === 0) return sen;
    const text = punctuateChineseTranscriptText(sen.text);
    if (text !== sen.text) changed = true;
    const joined = sen.words.map((w) => w.w).join('');
    // 已含标点（曾合并过 / 均匀分布来源本来带标点）则跳过
    if (joined === text || /[\p{P}]/u.test(joined)) return text === sen.text ? sen : { ...sen, text };
    const merged = mergePunctIntoWords(text, sen.words);
    if (merged === sen.words) return text === sen.text ? sen : { ...sen, text };
    changed = true;
    return { ...sen, text, words: merged };
  });
  if (!changed) return tr;
  const next = { ...tr, sentences };
  useEditorStore.getState().setTranscript(tr.mediaPath, next);
  return next;
}

/** 转写一个源媒体并构建 Transcript（写入 store，已有缓存则直接返回） */
export async function ensureTranscript(mediaPath: string): Promise<Transcript> {
  const cached = useEditorStore.getState().transcripts[mediaPath];
  if (cached) return upgradeTranscriptPunct(cached);
  const results = await transcribeFileWords(mediaPath);
  const sentences: TranscriptSentence[] = results.map((c) => {
    const text = punctuateChineseTranscriptText(c.text);
    return {
      id: `ts-${nanoid(6)}`,
      text,
      start: c.startSec,
      end: c.endSec,
      // 词级时间戳真实化：豆包返回逐词毫秒时间戳，seek/剪切/filler 高亮全部精确；
      // 标点从句 text 合并进词 token；Whisper 降级链无词级 → 句内均匀分布兜底。
      words: c.words.length > 0
        ? mergePunctIntoWords(text, c.words.map((w) => ({
          w: w.w,
          start: w.startSec,
          end: w.endSec,
          ...(w.blankMs != null ? { blankMs: w.blankMs } : {}),
          ...(FILLER_WORD_RE.test(stripPunct(w.w)) ? { filler: true } : {}),
        })))
        : splitWords(text, c.startSec, c.endSec),
    };
  });
  const transcript: Transcript = { mediaPath, sentences, createdAt: Date.now() };
  useEditorStore.getState().setTranscript(mediaPath, transcript);
  return transcript;
}

/** 智能剪口播：把纯口癖句标记为 deleted，返回标记数 */
export function smartMarkFillers(): number {
  let marked = 0;
  for (const row of buildTranscriptTimelineRows()) {
    if (row.deleted) continue;
    const bare = stripPunct(row.text);
    const isFiller = bare.length > 0 && (FILLER_SENTENCE_RE.test(bare) || (bare.length <= 2 && FILLER_WORD_RE.test(bare)));
    if (isFiller) {
      useEditorStore.getState().setTranscriptRowDeleted(row.id, true);
      marked += 1;
    }
  }
  return marked;
}

/** [in,out] 减去 cut 区间，返回保留段 */
function subtract(inSec: number, outSec: number, cuts: [number, number][]): [number, number][] {
  let kept: [number, number][] = [[inSec, outSec]];
  for (const [cs, ce] of cuts) {
    const next: [number, number][] = [];
    for (const [a, b] of kept) {
      if (ce <= a || cs >= b) { next.push([a, b]); continue; }
      if (cs > a) next.push([a, cs]);
      if (ce < b) next.push([ce, b]);
    }
    kept = next;
  }
  return kept.filter(([a, b]) => b - a >= 0.1);
}

export interface ApplyCutsResult { removedSec: number; clipsBefore: number; clipsAfter: number }

export interface TranscriptTimelineRow {
  id: string;
  label: string;
  mediaPath: string;
  clipId: string;
  clipLabel: string;
  clipIndex: number;
  sentenceId: string;
  text: string;
  words: TranscriptWord[];
  sourceStart: number;
  sourceEnd: number;
  timelineStart: number;
  timelineEnd: number;
  deleted?: boolean;
  rowDeleted?: boolean;
  sentenceDeleted?: boolean;
  silence?: boolean;
  clipped?: boolean;
}

function clipTimelineRange(clips: EditorClip[], targetId: string): { start: number; end: number } | null {
  const s = useEditorStore.getState();
  let acc = 0;
  for (const clip of clips) {
    const len = s.clipLength(clip);
    if (clip.id === targetId) return { start: acc, end: acc + len };
    acc += len;
  }
  return null;
}

function rippleSpanItems<T extends { id: string; startSec: number }>(
  items: T[],
  cutStart: number,
  cutEnd: number,
  minDur: number,
  idPrefix: string,
  endOf: (item: T) => number,
  withSpan: (item: T, startSec: number, endSec: number) => T,
): T[] {
  const removed = cutEnd - cutStart;
  const next: T[] = [];
  for (const item of items) {
    const start = item.startSec;
    const end = endOf(item);
    if (end <= cutStart) {
      next.push(item);
      continue;
    }
    if (start >= cutEnd) {
      next.push(withSpan(item, Math.max(0, start - removed), Math.max(minDur, end - removed)));
      continue;
    }

    let keptOriginal = false;
    if (start < cutStart && cutStart - start >= minDur) {
      next.push(withSpan(item, start, cutStart));
      keptOriginal = true;
    }
    if (end > cutEnd && end - cutEnd >= minDur) {
      const base = keptOriginal ? { ...item, id: `${idPrefix}-${nanoid(6)}` } : item;
      next.push(withSpan(base, cutStart, cutStart + (end - cutEnd)));
    }
  }
  return next.sort((a, b) => a.startSec - b.startSec);
}

function shiftKeyframesAfterCut(
  keyframes: OverlayClip['keyframes'],
  originalStart: number,
  keptGlobalStart: number,
  keptGlobalEnd: number,
): OverlayClip['keyframes'] {
  if (!keyframes) return undefined;
  return keyframes
    .filter((k) => {
      const global = originalStart + k.t;
      return global >= keptGlobalStart - 0.001 && global <= keptGlobalEnd + 0.001;
    })
    .map((k) => ({ ...k, t: Math.max(0, originalStart + k.t - keptGlobalStart) }))
    .sort((a, b) => a.t - b.t);
}

function rippleMediaItems<T extends AudioClip | OverlayClip>(
  items: T[],
  cutStart: number,
  cutEnd: number,
  minDur: number,
  idPrefix: string,
): T[] {
  const removed = cutEnd - cutStart;
  const next: T[] = [];
  for (const item of items) {
    const start = item.startSec;
    const sourceDur = Math.max(minDur, item.outSec - item.inSec || item.duration || minDur);
    const end = start + sourceDur;
    if (end <= cutStart) {
      next.push(item);
      continue;
    }
    if (start >= cutEnd) {
      next.push({ ...item, startSec: Math.max(0, start - removed) });
      continue;
    }

    let keptOriginal = false;
    if (start < cutStart && cutStart - start >= minDur) {
      const duration = cutStart - start;
      const before = {
        ...item,
        duration,
        outSec: item.inSec + duration,
        ...(('keyframes' in item)
          ? { keyframes: shiftKeyframesAfterCut(item.keyframes, start, start, cutStart) }
          : {}),
      } as T;
      next.push(before);
      keptOriginal = true;
    }
    if (end > cutEnd && end - cutEnd >= minDur) {
      const duration = end - cutEnd;
      const sourceShift = Math.max(0, cutEnd - start);
      const base = keptOriginal ? { ...item, id: `${idPrefix}-${nanoid(6)}` } : item;
      const after = {
        ...base,
        startSec: cutStart,
        duration,
        inSec: item.inSec + sourceShift,
        outSec: item.inSec + sourceShift + duration,
        ...(('keyframes' in item)
          ? { keyframes: shiftKeyframesAfterCut(item.keyframes, start, cutEnd, end) }
          : {}),
      } as T;
      next.push(after);
    }
  }
  return next.sort((a, b) => a.startSec - b.startSec);
}

function rippleAbsoluteTracks(cutStart: number, cutEnd: number): void {
  if (cutEnd - cutStart <= 0) return;
  useEditorStore.setState((cur) => {
    const overlayClips = rippleMediaItems(cur.overlayClips, cutStart, cutEnd, 0.1, 'ovl');
    const audioClips = rippleMediaItems(cur.audioClips, cutStart, cutEnd, 0.1, 'aclip');
    const textClips = rippleSpanItems<TextClip>(
      cur.textClips,
      cutStart,
      cutEnd,
      0.2,
      'txt',
      (t) => t.endSec,
      (t, startSec, endSec) => ({ ...t, startSec, endSec }),
    );
    const fxClips = rippleSpanItems<FxClip>(
      cur.fxClips,
      cutStart,
      cutEnd,
      0.1,
      'fx',
      (f) => f.startSec + f.duration,
      (f, startSec, endSec) => ({ ...f, startSec, duration: Math.max(0.1, endSec - startSec) }),
    );
    const subtitles = rippleSpanItems<SubtitleCue>(
      cur.subtitles,
      cutStart,
      cutEnd,
      0.1,
      'sub',
      (c) => c.endSec,
      (c, startSec, endSec) => ({ ...c, startSec, endSec }),
    );
    const markers = cur.markers
      .filter((m) => m < cutStart || m >= cutEnd)
      .map((m) => (m >= cutEnd ? Math.max(0, m - (cutEnd - cutStart)) : m))
      .filter((m, i, arr) => arr.findIndex((x) => Math.abs(x - m) < 0.05) === i);
    return {
      overlayClips,
      audioClips,
      textClips,
      fxClips,
      subtitles,
      markers,
      selectedOverlayId: overlayClips.some((x) => x.id === cur.selectedOverlayId) ? cur.selectedOverlayId : null,
      selectedAudioClipId: audioClips.some((x) => x.id === cur.selectedAudioClipId) ? cur.selectedAudioClipId : null,
      selectedTextId: textClips.some((x) => x.id === cur.selectedTextId) ? cur.selectedTextId : null,
      selectedFxId: fxClips.some((x) => x.id === cur.selectedFxId) ? cur.selectedFxId : null,
      selectedSubtitleId: subtitles.some((x) => x.id === cur.selectedSubtitleId) ? cur.selectedSubtitleId : null,
    };
  });
}

/** 按时间轴片段实例生成文稿行；同一源视频被切成多段时，每段都有自己的精确行。 */
export function buildTranscriptTimelineRows(): TranscriptTimelineRow[] {
  const s = useEditorStore.getState();
  const rows: TranscriptTimelineRow[] = [];
  let cursor = 0;
  s.clips.forEach((clip, clipIndex) => {
    const tr = s.transcripts[clip.path];
    const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
    const clipLen = s.clipLength(clip);
    let sentenceInClip = 0;
    if (tr) {
      for (const sen of tr.sentences) {
        const sourceStart = Math.max(sen.start, clip.inSec);
        const sourceEnd = Math.min(sen.end, clip.outSec);
        if (sourceEnd - sourceStart < 0.05) continue;
        sentenceInClip += 1;
        const timelineStart = cursor + ((sourceStart - clip.inSec) / speed);
        const timelineEnd = cursor + ((sourceEnd - clip.inSec) / speed);
        const visibleWords = sen.words.filter((w) => w.end > sourceStart && w.start < sourceEnd);
        const rowId = `${clip.id}:${sen.id}:${sourceStart.toFixed(3)}-${sourceEnd.toFixed(3)}`;
        const rowDeleted = Boolean(s.transcriptRowDeletes[rowId]);
        const sentenceDeleted = Boolean(sen.deleted);
        rows.push({
          id: rowId,
          label: `片段${clipIndex + 1}/句${sentenceInClip}`,
          mediaPath: clip.path,
          clipId: clip.id,
          clipLabel: clip.label,
          clipIndex,
          sentenceId: sen.id,
          text: visibleWords.length > 0 ? visibleWords.map((w) => w.w).join('') : sen.text,
          words: visibleWords.length > 0 ? visibleWords : sen.words,
          sourceStart,
          sourceEnd,
          timelineStart,
          timelineEnd,
          deleted: rowDeleted || sentenceDeleted,
          rowDeleted,
          sentenceDeleted,
          silence: sen.silence,
          clipped: sourceStart > sen.start + 0.03 || sourceEnd < sen.end - 0.03,
        });
      }
    }
    cursor += clipLen;
  });
  return rows.sort((a, b) => a.timelineStart - b.timelineStart);
}

// ── AI 冗余/节奏诊断 ─────────────────────────────────────────────────────────

export type RedundancyIssueType = 'repeat_phrase' | 'similar_nearby' | 'filler_dense' | 'speed_anomaly' | 'asr_hidden_risk';

export interface RedundancyRowDiagnostic {
  rowId: string;
  label: string;
  timelineStart: number;
  timelineEnd: number;
  sourceStart: number;
  sourceEnd: number;
  text: string;
  repeatScore: number;
  fillerRatio: number;
  charsPerSec: number;
  speedAnomaly?: 'too_fast' | 'too_slow';
  comparedWith?: string;
}

export interface RedundancyIssue {
  type: RedundancyIssueType;
  severity: 'low' | 'medium' | 'high';
  rowIds: string[];
  labels: string[];
  timelineStart: number;
  timelineEnd: number;
  message: string;
  suggestion: string;
  score?: number;
}

export interface RedundancyReport {
  diagnostics: RedundancyRowDiagnostic[];
  issues: RedundancyIssue[];
  summary: string;
}

export interface TranscriptRhythmBin {
  start: number;
  end: number;
  charCount: number;
  rowCount: number;
  fillerRatio: number;
  density: number;
  labels: string[];
  snippets: string[];
}

const normalizeSpeechText = (s: string) => stripPunct(s).toLowerCase().replace(/\s+/g, '');

function charBigrams(text: string): Set<string> {
  const chars = Array.from(text);
  const out = new Set<string>();
  if (chars.length <= 1) {
    if (text) out.add(text);
    return out;
  }
  for (let i = 0; i < chars.length - 1; i++) out.add(chars[i] + chars[i + 1]);
  return out;
}

function textSimilarity(a: string, b: string): number {
  const na = normalizeSpeechText(a);
  const nb = normalizeSpeechText(b);
  if (!na || !nb) return 0;
  const short = na.length <= nb.length ? na : nb;
  const long = na.length > nb.length ? na : nb;
  const containment = short.length >= 4 && long.includes(short) ? short.length / long.length : 0;
  const ba = charBigrams(na);
  const bb = charBigrams(nb);
  let hit = 0;
  for (const x of ba) if (bb.has(x)) hit += 1;
  const jaccard = hit / Math.max(1, ba.size + bb.size - hit);
  return Math.max(jaccard, containment);
}

function fillerRatioOf(text: string): number {
  const normalized = normalizeSpeechText(text);
  if (!normalized) return 0;
  let fillerChars = 0;
  for (const phrase of FILLER_PHRASES) {
    const p = normalizeSpeechText(phrase);
    if (!p) continue;
    const re = new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const count = normalized.match(re)?.length ?? 0;
    fillerChars += count * p.length;
  }
  return Math.min(1, fillerChars / normalized.length);
}

function adjacentRepeatedPhrase(text: string): string | null {
  const normalized = normalizeSpeechText(text);
  const chars = Array.from(normalized);
  for (let len = Math.min(10, Math.floor(chars.length / 2)); len >= 2; len--) {
    for (let i = 0; i + len * 2 <= chars.length; i++) {
      const a = chars.slice(i, i + len).join('');
      const b = chars.slice(i + len, i + len * 2).join('');
      if (a !== b) continue;
      if (FILLER_PHRASES.some((p) => normalizeSpeechText(p) === a)) continue;
      // 叠词/拟声/数字串是正常表达（哈哈哈哈、666、2024 2024 播报）：
      // 单字符重复组成的片段，或纯数字/字母片段，不算口播重复。
      const uniq = new Set(Array.from(a));
      if (uniq.size === 1) continue;
      if (/^[0-9a-z]+$/.test(a)) continue;
      return a;
    }
  }
  return null;
}

function rowInRange(row: TranscriptTimelineRow, startSec?: number, endSec?: number): boolean {
  return (startSec == null || row.timelineEnd > startSec) && (endSec == null || row.timelineStart < endSec);
}

export function analyzeTranscriptRedundancy(options: {
  startSec?: number;
  endSec?: number;
  windowSec?: number;
  minRepeatScore?: number;
  minFillerRatio?: number;
} = {}): RedundancyReport {
  const windowSec = options.windowSec ?? 30;
  const minRepeatScore = options.minRepeatScore ?? 0.72;
  const minFillerRatio = options.minFillerRatio ?? 0.22;
  const rows = buildTranscriptTimelineRows()
    .filter((row) => !row.silence && rowInRange(row, options.startSec, options.endSec));
  const diagnostics: RedundancyRowDiagnostic[] = [];
  const issues: RedundancyIssue[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const dur = Math.max(0.1, row.timelineEnd - row.timelineStart);
    const normalized = normalizeSpeechText(row.text);
    const charsPerSec = normalized.length / dur;
    const fillerRatio = fillerRatioOf(row.text);
    let repeatScore = 0;
    let comparedWith: string | undefined;
    for (let j = i - 1; j >= 0; j--) {
      const prev = rows[j];
      if (row.timelineStart - prev.timelineEnd > windowSec) break;
      const score = textSimilarity(row.text, prev.text);
      if (score > repeatScore) {
        repeatScore = score;
        comparedWith = prev.label;
      }
    }
    const speedAnomaly = charsPerSec > 8.5 ? 'too_fast' : (dur >= 1.5 && charsPerSec < 1.2 ? 'too_slow' : undefined);
    diagnostics.push({
      rowId: row.id,
      label: row.label,
      timelineStart: row.timelineStart,
      timelineEnd: row.timelineEnd,
      sourceStart: row.sourceStart,
      sourceEnd: row.sourceEnd,
      text: row.text,
      repeatScore: Number(repeatScore.toFixed(2)),
      fillerRatio: Number(fillerRatio.toFixed(2)),
      charsPerSec: Number(charsPerSec.toFixed(2)),
      speedAnomaly,
      comparedWith,
    });

    const repeated = adjacentRepeatedPhrase(row.text);
    if (repeated) {
      issues.push({
        type: 'repeat_phrase',
        severity: 'high',
        rowIds: [row.id],
        labels: [row.label],
        timelineStart: row.timelineStart,
        timelineEnd: row.timelineEnd,
        message: `疑似连续重复短语「${repeated}」`,
        suggestion: `复核 ${row.label}，通常保留更顺的一遍；可用 cut_rows(row_ids:["${row.id}"]) 或按 source_sec 精切。`,
        score: 1,
      });
    }
    if (repeatScore >= minRepeatScore && comparedWith) {
      issues.push({
        type: 'similar_nearby',
        severity: repeatScore >= 0.86 ? 'high' : 'medium',
        rowIds: [row.id],
        labels: [row.label, comparedWith],
        timelineStart: row.timelineStart,
        timelineEnd: row.timelineEnd,
        message: `${row.label} 和 ${comparedWith} 在 ${windowSec}s 内高度相似`,
        suggestion: `优先复核后出现的 ${row.label}，如果只是重复表达，删后者更符合口播节奏。`,
        score: Number(repeatScore.toFixed(2)),
      });
    }
    if (fillerRatio >= minFillerRatio && normalized.length >= 4) {
      issues.push({
        type: 'filler_dense',
        severity: fillerRatio >= 0.38 ? 'high' : 'medium',
        rowIds: [row.id],
        labels: [row.label],
        timelineStart: row.timelineStart,
        timelineEnd: row.timelineEnd,
        message: `${row.label} 填充词密度偏高`,
        suggestion: `复核是否为“然后/就是/那个/那么”等过渡废话，可整句删或只裁前后口癖。`,
        score: Number(fillerRatio.toFixed(2)),
      });
    }
    if (speedAnomaly) {
      issues.push({
        type: 'speed_anomaly',
        severity: 'low',
        rowIds: [row.id],
        labels: [row.label],
        timelineStart: row.timelineStart,
        timelineEnd: row.timelineEnd,
        message: `${row.label} 语速${speedAnomaly === 'too_fast' ? '过快' : '过慢/可能有停顿'}`,
        suggestion: `只作为复核提醒，不建议自动删除；需要结合画面和上下文判断。`,
        score: Number(charsPerSec.toFixed(2)),
      });
    }
    if (dur >= 8 && normalized.length <= Math.max(12, dur * 2.2)) {
      issues.push({
        type: 'asr_hidden_risk',
        severity: 'medium',
        rowIds: [row.id],
        labels: [row.label],
        timelineStart: row.timelineStart,
        timelineEnd: row.timelineEnd,
        message: `${row.label} 持续 ${dur.toFixed(1)}s 但文本偏少，ASR 可能漏掉停顿、重复或吞字`,
        suggestion: `不要只看文字决定保留；建议用 timeline_preview_clip 看这段节奏，必要时让用户试听后精切。`,
        score: Number((normalized.length / dur).toFixed(2)),
      });
    }
  }
  const high = issues.filter((x) => x.severity === 'high').length;
  const medium = issues.filter((x) => x.severity === 'medium').length;
  const low = issues.filter((x) => x.severity === 'low').length;
  return {
    diagnostics,
    issues,
    summary: `检查 ${rows.length} 行文稿，发现高风险 ${high} 个、中风险 ${medium} 个、提示 ${low} 个。`,
  };
}

export function markRedundancyCandidates(report = analyzeTranscriptRedundancy()): number {
  const s = useEditorStore.getState();
  const rowIds = new Set<string>();
  for (const issue of report.issues) {
    const autoMark =
      issue.type === 'repeat_phrase'
      || (issue.type === 'similar_nearby' && issue.severity === 'high')
      || (issue.type === 'filler_dense' && issue.severity === 'high');
    if (!autoMark) continue;
    for (const id of issue.rowIds) rowIds.add(id);
  }
  for (const id of rowIds) s.setTranscriptRowDeleted(id, true);
  return rowIds.size;
}

export function buildTranscriptRhythmPreview(options: { startSec?: number; endSec?: number; binSec?: number } = {}): TranscriptRhythmBin[] {
  const binSec = Math.max(0.5, Math.min(5, options.binSec ?? 1));
  const rows = buildTranscriptTimelineRows().filter((row) => !row.silence && rowInRange(row, options.startSec, options.endSec));
  const start = options.startSec ?? Math.floor(Math.min(...rows.map((row) => row.timelineStart), 0));
  const end = options.endSec ?? Math.ceil(Math.max(...rows.map((row) => row.timelineEnd), 0));
  if (!Number.isFinite(end) || end <= start) return [];
  const bins: TranscriptRhythmBin[] = [];
  for (let t = start; t < end; t += binSec) {
    const b0 = t;
    const b1 = Math.min(end, t + binSec);
    const hitRows = rows.filter((row) => row.timelineEnd > b0 && row.timelineStart < b1);
    const text = hitRows.map((row) => row.text).join('');
    const charCount = normalizeSpeechText(text).length;
    bins.push({
      start: b0,
      end: b1,
      charCount,
      rowCount: hitRows.length,
      fillerRatio: Number(fillerRatioOf(text).toFixed(2)),
      density: Number((charCount / Math.max(0.1, b1 - b0)).toFixed(2)),
      labels: hitRows.map((row) => row.label),
      snippets: hitRows.slice(0, 2).map((row) => row.text.slice(0, 18)),
    });
  }
  return bins;
}

/**
 * 剪掉某个时间轴文稿行绑定的源区间。调用方负责 captureEditorSnapshot。
 * 返回 false 表示 clip 已不存在或区间不再命中。
 */
export function cutTranscriptTimelineRow(row: Pick<TranscriptTimelineRow, 'clipId' | 'sourceStart' | 'sourceEnd'>): ApplyCutsResult & { success: boolean } {
  const s = useEditorStore.getState();
  const before = s.clips.length;
  const clipIndex = s.clips.findIndex((c) => c.id === row.clipId);
  if (clipIndex < 0) return { success: false, removedSec: 0, clipsBefore: before, clipsAfter: before };
  const clip = s.clips[clipIndex];
  const cutStart = Math.max(clip.inSec, Math.min(row.sourceStart, clip.outSec));
  const cutEnd = Math.max(cutStart, Math.min(row.sourceEnd, clip.outSec));
  if (cutEnd - cutStart < 0.05) return { success: false, removedSec: 0, clipsBefore: before, clipsAfter: before };

  const range = clipTimelineRange(s.clips, clip.id);
  if (!range) return { success: false, removedSec: 0, clipsBefore: before, clipsAfter: before };
  const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
  const timelineCutStart = range.start + ((cutStart - clip.inSec) / speed);
  const timelineCutEnd = range.start + ((cutEnd - clip.inSec) / speed);
  const removedTimelineSec = (cutEnd - cutStart) / speed;
  const kept = subtract(clip.inSec, clip.outSec, [[cutStart, cutEnd]]);
  const replacement = kept.map(([a, b], i) => ({
    ...clip,
    id: i === 0 ? clip.id : `clip-${nanoid(6)}`,
    inSec: a,
    outSec: b,
    transitionAfter: i === kept.length - 1 ? clip.transitionAfter : { type: 'cut', duration: 0 },
  }));
  const next = [...s.clips];
  next.splice(clipIndex, 1, ...replacement);
  useEditorStore.setState({ clips: next, selectedClipId: replacement[0]?.id ?? null });
  if ('id' in row && typeof row.id === 'string') useEditorStore.getState().setTranscriptRowDeleted(row.id, false);
  rippleAbsoluteTracks(timelineCutStart, timelineCutEnd);
  return { success: true, removedSec: removedTimelineSec, clipsBefore: before, clipsAfter: next.length };
}

/**
 * 把所有 deleted 句子的时间范围真实裁掉：拆分/删除主轨 clip。
 * 调用方负责先 captureEditorSnapshot()。
 */
export function applyTranscriptCuts(): ApplyCutsResult {
  const before = useEditorStore.getState().clips.length;
  let removed = 0;
  const rows = buildTranscriptTimelineRows()
    .filter((row) => row.deleted)
    .sort((a, b) => b.timelineStart - a.timelineStart);

  for (const row of rows) {
    const r = cutTranscriptTimelineRow(row);
    if (r.success) removed += r.removedSec;
  }
  const after = useEditorStore.getState().clips.length;
  useEditorStore.setState({ selectedClipId: null });
  return { removedSec: removed, clipsBefore: before, clipsAfter: after };
}

// ── 无人声/无字幕内容段检测 ─────────────────────────────────────────────────

/** 检测源媒体的低音量区间（ffmpeg silencedetect，兼容旧“静音”逻辑）。 */
export async function detectAudioSilences(mediaPath: string, minDur = 0.8, noiseDb = -35): Promise<[number, number][]> {
  const { detectFfmpeg } = await import('@/lib/canvas/videoCompose');
  const ffmpeg = await detectFfmpeg();
  if (!ffmpeg) throw new Error('未检测到 ffmpeg，无法检测低音量段');
  const { invoke } = await import('@tauri-apps/api/tauri');
  const q = (p: string) => JSON.stringify(p);
  const r = await invoke<{ stdout: string; stderr: string; exit_code: number }>('execute_command', {
    command: `${ffmpeg} -i ${q(mediaPath)} -af silencedetect=noise=${noiseDb}dB:d=${minDur} -f null -`,
    timeoutMs: 180000,
  }).catch(() => ({ stdout: '', stderr: '', exit_code: 1 }));
  const text = r.stdout + r.stderr;
  const ranges: [number, number][] = [];
  let start: number | null = null;
  for (const line of text.split('\n')) {
    const ms = /silence_start: ([\d.]+)/.exec(line);
    if (ms) { start = Number(ms[1]); continue; }
    const me = /silence_end: ([\d.]+)/.exec(line);
    if (me && start != null) { ranges.push([start, Number(me[1])]); start = null; }
  }
  return ranges;
}

function sourceDurationForMedia(mediaPath: string): number {
  const s = useEditorStore.getState();
  const fromClips = s.clips
    .filter((clip) => clip.path === mediaPath)
    .map((clip) => Math.max(clip.duration, clip.outSec));
  const fromTranscript = s.transcripts[mediaPath]?.sentences
    .filter((sen) => !sen.silence)
    .map((sen) => sen.end) ?? [];
  return Math.max(0, ...fromClips, ...fromTranscript);
}

function subtitleSourceRangesForMedia(mediaPath: string): [number, number][] {
  const s = useEditorStore.getState();
  const ranges: [number, number][] = [];
  let acc = 0;
  for (const clip of s.clips) {
    const len = s.clipLength(clip);
    const clipStart = acc;
    const clipEnd = acc + len;
    acc = clipEnd;
    if (clip.path !== mediaPath) continue;
    const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
    for (const sub of s.subtitles) {
      const overlapStart = Math.max(sub.startSec, clipStart);
      const overlapEnd = Math.min(sub.endSec, clipEnd);
      if (overlapEnd <= overlapStart || !sub.text.trim()) continue;
      ranges.push([
        clip.inSec + (overlapStart - clipStart) * speed,
        clip.inSec + (overlapEnd - clipStart) * speed,
      ]);
    }
  }
  return ranges;
}

function mergeRanges(ranges: [number, number][], padSec: number): [number, number][] {
  const sorted = ranges
    .map(([a, b]) => [Math.max(0, a - padSec), Math.max(0, b + padSec)] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = merged[merged.length - 1];
    if (!last || a > last[1]) merged.push([a, b]);
    else last[1] = Math.max(last[1], b);
  }
  return merged;
}

/**
 * 检测“无人声/无字幕内容”的区间：基于 ASR 识别句子 + 时间轴字幕轨的间隙，而不是音量阈值。
 * 这更符合口播剪辑里的“静音”：画面里没有可识别人声或字幕承载信息。
 */
export async function detectSpeechlessRanges(mediaPath: string, minDur = 0.8, keepPadSec = 0.12): Promise<[number, number][]> {
  const tr = await ensureTranscript(mediaPath);
  const duration = sourceDurationForMedia(mediaPath);
  if (duration <= 0) return [];
  const contentRanges: [number, number][] = [
    ...tr.sentences
      .filter((sen) => !sen.silence && sen.text.trim())
      .map((sen) => [sen.start, sen.end] as [number, number]),
    ...subtitleSourceRangesForMedia(mediaPath),
  ];
  const spoken = mergeRanges(
    contentRanges,
    keepPadSec,
  );
  const gaps: [number, number][] = [];
  let cursor = 0;
  for (const [a, b] of spoken) {
    if (a - cursor >= minDur) gaps.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (duration - cursor >= minDur) gaps.push([cursor, duration]);
  return gaps;
}

/** 默认“静音”检测：无人声/无字幕内容。保留同名导出避免旧调用断裂。 */
export async function detectSilences(mediaPath: string, minDur = 0.8, noiseDb = -35): Promise<[number, number][]> {
  void noiseDb;
  return detectSpeechlessRanges(mediaPath, minDur);
}

/**
 * 把无人声/无字幕区间注入为「伪句子」（预标记 deleted，文本显示空白时长），
 * 与口癖句共用同一条「复核 → 应用删除」流程。前后各留 padSec 呼吸余量。
 * 返回新增条数；与正常句子重叠的停顿（句内换气）跳过。
 */
export function injectSilenceSentences(mediaPath: string, ranges: [number, number][], padSec = 0.15): number {
  const s = useEditorStore.getState();
  const tr = s.transcripts[mediaPath];
  if (!tr) return 0;
  let added = 0;
  const sentences = [...tr.sentences];
  for (const [a, b] of ranges) {
    const start = a + padSec;
    const end = b - padSec;
    if (end - start < 0.4) continue;
    if (sentences.some((x) => !x.silence && start < x.end && end > x.start)) continue;
    if (sentences.some((x) => x.silence && Math.abs(x.start - start) < 0.2)) continue; // 重复检测去重
    sentences.push({
      id: `sil-${nanoid(6)}`,
      text: `（无人声/无字幕 ${(end - start).toFixed(1)}s）`,
      start,
      end,
      words: [],
      deleted: true,
      silence: true,
    });
    added += 1;
  }
  if (added > 0) {
    sentences.sort((x, y) => x.start - y.start);
    s.setTranscript(mediaPath, { ...tr, sentences });
  }
  return added;
}

/** 源媒体秒 → 时间轴秒（找到第一个包含该源时间的 clip）；不在任何 clip 内返回 null */
export function sourceTimeToTimeline(mediaPath: string, srcSec: number): number | null {
  const s = useEditorStore.getState();
  let acc = 0;
  for (const c of s.clips) {
    const len = s.clipLength(c);
    if (c.path === mediaPath && srcSec >= c.inSec && srcSec <= c.outSec) {
      return acc + (srcSec - c.inSec) / (c.speed && c.speed > 0 ? c.speed : 1);
    }
    acc += len;
  }
  return null;
}
