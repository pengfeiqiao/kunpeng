/**
 * transcribe — 自动字幕：豆包录音文件识别（AUC 大模型）优先，dmxapi whisper-1 降级。
 *
 * 豆包 AUC（volc.seedasr.auc，openspeech.bytedance.com）：异步任务式，音频以
 * URL 提交（先上传 COS），无 25MB 限制（上限 512MB），返回 utterance + 词级毫秒
 * 时间戳。需 doubaoSpeechApiKey + COS 配置。
 *
 * 降级 dmxapi whisper-1：直传 wav，单次 25MiB 上限，超长音频按时间分块转写后
 * 合并（块边界句子各自成独立 cue，时间戳加块偏移，精度无损）。
 */
import { invoke } from '@tauri-apps/api/tauri';
import { createDir, readBinaryFile, removeFile } from '@tauri-apps/api/fs';
import { detectFfmpeg, probeDuration } from '@/lib/canvas/videoCompose';
import { getDmxApiKey } from '@/lib/agent/tools/dmxClient';
import { doubaoAsrAvailable, transcribeWithDoubaoAsr, transcribeWithDoubaoAsrWords, type AsrUtteranceResult, type AsrWord } from '@/lib/doubaoAsr/client';
import { useEditorStore, type SubtitleCue, type EditorClip, type AudioClip } from '@/stores/editorStore';
import { nanoid } from 'nanoid';

/** 词级转写句：words 为空数组表示该链路无词级时间戳（Whisper 降级）。 */
export interface TranscribedSentence {
  text: string;
  startSec: number;
  endSec: number;
  words: AsrWord[];
}

interface CommandResult { stdout: string; stderr: string; exit_code: number }

interface WhisperSegment { start: number; end: number; text: string }
interface WhisperVerbose { text: string; segments?: WhisperSegment[] }

const q = (p: string) => `'${p.replace(/'/g, `'\\''`)}'`;

/** 16kHz 单声道 16bit PCM WAV 的字节速率（不含 44 字节头） */
const BYTES_PER_SEC = 16000 * 1 * 2;
/** Whisper 单次请求上限 25MiB；留 1MiB 余量，按 24MiB 判定分块 */
const MAX_BYTES = 24 * 1024 * 1024;
const WHISPER_URL = 'https://www.dmxapi.cn/v1/audio/transcriptions';
const WHISPER_CHUNK_CONCURRENCY = 2;

async function mapPool<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function hasAudioStream(ffmpeg: string, path: string): Promise<boolean> {
  const r = await invoke<CommandResult>('execute_command', {
    command: `${ffmpeg} -hide_banner -i ${q(path)} 2>&1 | grep -q "Audio:" && echo OK`,
    timeoutMs: 15000,
  }).catch(() => ({ stdout: '', stderr: '', exit_code: 1 }));
  return r.exit_code === 0 && r.stdout.includes('OK');
}

function audioAtempo(speed?: number): string {
  let s = Math.max(0.1, Math.min(8, speed && Number.isFinite(speed) ? speed : 1));
  const parts: number[] = [];
  while (s > 2) { parts.push(2); s /= 2; }
  while (s < 0.5) { parts.push(0.5); s /= 0.5; }
  parts.push(s);
  return parts.map((p) => `atempo=${p.toFixed(4)}`).join(',');
}

function audioClipEffectiveDuration(clip: EditorClip): number {
  const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
  return Math.max(0.05, (clip.outSec - clip.inSec) / speed);
}

function audioExtraEffectiveDuration(clip: AudioClip): number {
  return Math.max(0.05, clip.outSec - clip.inSec || clip.duration || 0);
}

/**
 * 把当前剪辑时间轴渲染成一条 16kHz 单声道 wav，专供 ASR。
 *
 * 这条路径模拟“文稿识别/自动字幕”的真实用户预期：不管视频在主轨被切成
 * 多少段，先把最终时间轴听到的声音合成出来，再只识别一次。返回的 ASR
 * 时间戳天然就是时间轴坐标。
 */
export async function renderTimelineAudioForTranscription(
  onProgress?: (status: string) => void,
): Promise<string | null> {
  const ffmpeg = await detectFfmpeg();
  if (!ffmpeg) throw new Error('未检测到 ffmpeg（macOS: brew install ffmpeg；Windows: winget install ffmpeg）');
  const s = useEditorStore.getState();
  const clips = s.clips.filter((clip) => clip.path && s.clipLength(clip) > 0.05);
  const mutedTracks = new Set(s.audioTracks.filter((track) => track.muted).map((track) => track.id));
  const audioClips = s.audioClips.filter((clip) => !mutedTracks.has(clip.trackId) && clip.path && audioExtraEffectiveDuration(clip) > 0.05);
  const total = s.totalDuration();
  if (total <= 0.05) return null;

  const workspace = await invoke<string>('ensure_workspace');
  const outDir = `${workspace}/audio`;
  await createDir(outDir, { recursive: true }).catch(() => {});
  const out = `${outDir}/timeline-asr-${Date.now()}-${nanoid(4)}.wav`;
  const inputs: string[] = [];
  const filters: string[] = [];
  const mainLabels: string[] = [];
  let inputIndex = 0;

  onProgress?.('准备时间轴音频…');
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const dur = audioClipEffectiveDuration(clip);
    const volume = Math.max(0, clip.volume ?? 1);
    const label = `[m${i}]`;
    if (volume <= 0 || !(await hasAudioStream(ffmpeg, clip.path))) {
      filters.push(`anullsrc=r=16000:cl=mono,atrim=0:${dur.toFixed(3)}${label}`);
      mainLabels.push(label);
      continue;
    }
    inputs.push(`-i ${q(clip.path)}`);
    const reverse = clip.reversed ? ',areverse' : '';
    const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
    const tempo = Math.abs(speed - 1) > 0.001 ? `,${audioAtempo(speed)}` : '';
    filters.push(`[${inputIndex}:a]atrim=${clip.inSec.toFixed(3)}:${clip.outSec.toFixed(3)},asetpts=PTS-STARTPTS${reverse}${tempo},volume=${volume.toFixed(3)},aresample=16000,aformat=channel_layouts=mono${label}`);
    mainLabels.push(label);
    inputIndex += 1;
  }

  let baseLabel = '[base]';
  if (mainLabels.length > 0) {
    filters.push(`${mainLabels.join('')}concat=n=${mainLabels.length}:v=0:a=1${baseLabel}`);
  } else {
    filters.push(`anullsrc=r=16000:cl=mono,atrim=0:${total.toFixed(3)}${baseLabel}`);
  }

  const mixLabels: string[] = [baseLabel];
  for (let i = 0; i < audioClips.length; i++) {
    const clip = audioClips[i];
    if (!(await hasAudioStream(ffmpeg, clip.path))) continue;
    inputs.push(`-i ${q(clip.path)}`);
    const len = audioExtraEffectiveDuration(clip);
    const delayMs = Math.max(0, Math.round(clip.startSec * 1000));
    const fadeIn = clip.fadeInSec ? `,afade=t=in:st=0:d=${clip.fadeInSec.toFixed(2)}` : '';
    const fadeOut = clip.fadeOutSec ? `,afade=t=out:st=${Math.max(0, len - clip.fadeOutSec).toFixed(2)}:d=${clip.fadeOutSec.toFixed(2)}` : '';
    const label = `[x${i}]`;
    filters.push(`[${inputIndex}:a]atrim=${clip.inSec.toFixed(3)}:${clip.outSec.toFixed(3)},asetpts=PTS-STARTPTS,volume=${Math.max(0, clip.volume).toFixed(3)}${fadeIn}${fadeOut},aresample=16000,aformat=channel_layouts=mono,adelay=${delayMs}|${delayMs}${label}`);
    mixLabels.push(label);
    inputIndex += 1;
  }

  const finalLabel = mixLabels.length > 1 ? '[mix]' : baseLabel;
  if (mixLabels.length > 1) {
    filters.push(`${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=first:normalize=0${finalLabel}`);
  }

  onProgress?.('导出时间轴音频…');
  const r = await invoke<CommandResult>('execute_command', {
    command: `${ffmpeg} -y ${inputs.join(' ')} -filter_complex "${filters.join(';')}" -map "${finalLabel}" -t ${total.toFixed(3)} -ar 16000 -ac 1 ${q(out)}`,
    timeoutMs: Math.max(120000, Math.ceil(total * 2500)),
  });
  if (r.exit_code !== 0) {
    throw new Error(`导出时间轴音频失败: ${r.stderr.slice(-300)}`);
  }
  return out;
}

export async function transcribeEditorTimelineAudio(
  onProgress?: (status: string) => void,
): Promise<SubtitleCue[]> {
  const wav = await renderTimelineAudioForTranscription(onProgress);
  if (!wav) return [];
  try {
    onProgress?.('识别时间轴音频…');
    return await transcribeFile(wav, onProgress);
  } finally {
    void removeFile(wav).catch(() => {});
  }
}

/** 抽取媒体文件的完整音轨为 16k 单声道 wav，返回临时文件路径。无音轨返回 null。 */
async function extractWav(mediaPath: string): Promise<string | null> {
  const ffmpeg = await detectFfmpeg();
  if (!ffmpeg) throw new Error('未检测到 ffmpeg（macOS: brew install ffmpeg；Windows: winget install ffmpeg）');
  const out = `/tmp/kunpeng-asr-${Date.now()}-${nanoid(4)}.wav`;
  const r = await invoke<CommandResult>('execute_command', {
    command: `${ffmpeg} -i ${q(mediaPath)} -vn -ar 16000 -ac 1 ${q(out)} -y`,
    timeoutMs: 900000,
  });
  if (r.exit_code !== 0) {
    if (/does not contain any stream|Output file #0 does not contain/.test(r.stderr)) return null;
    throw new Error(`抽取音轨失败: ${r.stderr.slice(-200)}`);
  }
  return out;
}

/** 抽取媒体文件 [startSec, startSec+durSec) 区间的音轨为 16k 单声道 wav。无音轨返回 null。 */
async function extractWavRange(mediaPath: string, startSec: number, durSec: number): Promise<string | null> {
  const ffmpeg = await detectFfmpeg();
  if (!ffmpeg) throw new Error('未检测到 ffmpeg（macOS: brew install ffmpeg；Windows: winget install ffmpeg）');
  const out = `/tmp/kunpeng-asr-${Date.now()}-${nanoid(4)}.wav`;
  // -ss 在 -i 前 = 快速输入 seek；音频 seek 近乎采样精确
  const r = await invoke<CommandResult>('execute_command', {
    command: `${ffmpeg} -ss ${startSec.toFixed(3)} -i ${q(mediaPath)} -t ${durSec.toFixed(3)} -vn -ar 16000 -ac 1 ${q(out)} -y`,
    timeoutMs: 120000,
  });
  if (r.exit_code !== 0) {
    if (/does not contain any stream|Output file #0 does not contain/.test(r.stderr)) return null;
    throw new Error(`抽取音轨片段失败: ${r.stderr.slice(-200)}`);
  }
  return out;
}

/** Whisper 直传单段 wav（≤25MiB）。offsetSec 为该段在源媒体中的起始秒。 */
async function transcribeWavBytes(key: string, bytes: Uint8Array, offsetSec: number): Promise<SubtitleCue[]> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }), 'audio.wav');
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');

  const resp = await fetch(WHISPER_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!resp.ok) {
    throw new Error(`ASR 请求失败 ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  const data = (await resp.json()) as WhisperVerbose;
  return (data.segments ?? [])
    .filter((s) => s.text.trim())
    .map((s) => ({
      id: `sub-${nanoid(6)}`,
      startSec: s.start + offsetSec,
      endSec: Math.max(s.start + 0.2, s.end) + offsetSec,
      text: s.text.trim(),
    }));
}

/** Whisper 长音频分块转写：按时间均分为 n 块（每块 wav ≤ MAX_BYTES），逐块转写后合并。 */
async function transcribeWhisperInChunks(
  key: string,
  mediaPath: string,
  totalDur: number,
  onProgress?: (status: string) => void,
): Promise<SubtitleCue[]> {
  const n = Math.max(2, Math.ceil((totalDur * BYTES_PER_SEC) / MAX_BYTES));
  const chunkDur = totalDur / n;
  console.log(`[transcribe] whisper 分块：${totalDur.toFixed(0)}s → ${n} 块，每块 ${chunkDur.toFixed(0)}s`);
  let completed = 0;
  const chunks = Array.from({ length: n }, (_, index) => index);
  const grouped = await mapPool(chunks, WHISPER_CHUNK_CONCURRENCY, async (i) => {
    const startSec = i * chunkDur;
    const chunkWav = await extractWavRange(mediaPath, startSec, chunkDur);
    if (!chunkWav) return [];
    try {
      const chunkBytes = await readBinaryFile(chunkWav);
      const cues = await transcribeWavBytes(key, chunkBytes, startSec);
      completed += 1;
      onProgress?.(`Whisper 分段识别 ${completed}/${n}`);
      console.log(`[transcribe] whisper 块 ${i + 1}/${n} 完成（+${cues.length} 句）`);
      return cues;
    } finally {
      void removeFile(chunkWav).catch(() => {});
    }
  });
  return grouped.flat().sort((a, b) => a.startSec - b.startSec);
}

/** Whisper 降级路径：抽 wav → ≤25MiB 直传，否则分块。 */
async function transcribeWithWhisper(mediaPath: string, onProgress?: (status: string) => void): Promise<SubtitleCue[]> {
  const key = getDmxApiKey();
  if (!key) throw new Error('缺少 DMX API Key');
  const probedDuration = await probeDuration(mediaPath).catch(() => 0);
  if (probedDuration > 0 && probedDuration * BYTES_PER_SEC > MAX_BYTES * 0.92) {
    return transcribeWhisperInChunks(key, mediaPath, probedDuration, onProgress);
  }
  const wav = await extractWav(mediaPath);
  if (!wav) return [];
  try {
    const bytes = await readBinaryFile(wav);
    if (bytes.byteLength <= MAX_BYTES) {
      return await transcribeWavBytes(key, bytes, 0);
    }
    const totalDur = Math.max(1, (bytes.byteLength - 44) / BYTES_PER_SEC);
    return await transcribeWhisperInChunks(key, mediaPath, totalDur, onProgress);
  } finally {
    void removeFile(wav).catch(() => {});
  }
}

/**
 * 单文件转写（源媒体相对时间）。
 * 优先豆包 AUC（无 25MB 限制、词级时间戳）；未配置或失败时降级 dmxapi Whisper
 * （超长音频自动分块）。无音轨返回 []。
 */
export async function transcribeFile(
  mediaPath: string,
  onProgress?: (status: string) => void,
): Promise<SubtitleCue[]> {
  // 1. 优先豆包 AUC
  if (doubaoAsrAvailable().available) {
    try {
      // 豆包 AUC 直接吃原始媒体文件的音轨；按容器格式提交
      const ext = (mediaPath.split('.').pop() || '').toLowerCase();
      // 非 wav/mp3/ogg 容器（如 mp4/mov）需先抽音轨为 wav
      let audioPath = mediaPath;
      let tmpWav: string | null = null;
      if (!['wav', 'mp3', 'ogg'].includes(ext)) {
        tmpWav = await extractWav(mediaPath);
        if (!tmpWav) return [];
        audioPath = tmpWav;
      }
      try {
        return await transcribeWithDoubaoAsr(audioPath, 'wav', onProgress);
      } finally {
        if (tmpWav) void removeFile(tmpWav).catch(() => {});
      }
    } catch (err) {
      console.warn('[transcribe] 豆包 ASR 失败，降级 Whisper:', err);
      // 落到 Whisper 降级
    }
  }

  // 2. 降级 Whisper
  return await transcribeWithWhisper(mediaPath, onProgress);
}

/**
 * 单文件**词级**转写（源媒体相对时间）。
 * 豆包 AUC 返回真实词级毫秒时间戳 + blank_duration 停顿；Whisper 降级链只有句级
 * 时间戳，words 返回空数组（下游用均匀分布兜底）。
 */
export async function transcribeFileWords(
  mediaPath: string,
  onProgress?: (status: string) => void,
): Promise<TranscribedSentence[]> {
  if (doubaoAsrAvailable().available) {
    try {
      const ext = (mediaPath.split('.').pop() || '').toLowerCase();
      const format = ['wav', 'mp3', 'ogg'].includes(ext) ? ext : 'wav';
      let audioPath = mediaPath;
      let tmpWav: string | null = null;
      if (!['wav', 'mp3', 'ogg'].includes((mediaPath.split('.').pop() || '').toLowerCase())) {
        tmpWav = await extractWav(mediaPath);
        if (!tmpWav) return [];
        audioPath = tmpWav;
      }
      try {
        const results = await transcribeWithDoubaoAsrWords(audioPath, format, undefined, onProgress);
        return results.map((u) => ({ text: u.text, startSec: u.startSec, endSec: u.endSec, words: u.words }));
      } finally {
        if (tmpWav) void removeFile(tmpWav).catch(() => {});
      }
    } catch (err) {
      console.warn('[transcribe] 豆包词级 ASR 失败，降级 Whisper（无词级）:', err);
    }
  }
  const cues = await transcribeWithWhisper(mediaPath, onProgress);
  return cues.map((c) => ({ text: c.text, startSec: c.startSec, endSec: c.endSec, words: [] }));
}

/**
 * 转写源媒体的一个小片段。用于“深度剪口播”：把可疑长句切成短窗重听，
 * 尽量避开整段 ASR 自动合并、吞重复、吞口头废话的问题。
 * opts.raw = 豆包原始模式（关 itn/punc），保留真实语流的重复与口误。
 */
export async function transcribeFileRange(
  mediaPath: string,
  startSec: number,
  durSec: number,
  onProgress?: (status: string) => void,
  opts?: { raw?: boolean },
): Promise<SubtitleCue[]> {
  const sentences = await transcribeFileRangeWords(mediaPath, startSec, durSec, onProgress, opts);
  return sentences.map((s) => ({ id: `sub-${nanoid(6)}`, startSec: s.startSec, endSec: s.endSec, text: s.text }));
}

/**
 * 短窗**词级**转写（源媒体相对时间）。审片引擎主入口：raw 模式恢复被
 * 整段 ASR 清洗掉的重复/口误，词级时间戳 + blank_duration 供边界吸附与停顿证据。
 */
export async function transcribeFileRangeWords(
  mediaPath: string,
  startSec: number,
  durSec: number,
  onProgress?: (status: string) => void,
  opts?: { raw?: boolean },
): Promise<TranscribedSentence[]> {
  const start = Math.max(0, startSec);
  const dur = Math.max(0.5, durSec);
  const wav = await extractWavRange(mediaPath, start, dur);
  if (!wav) return [];
  try {
    if (doubaoAsrAvailable().available) {
      try {
        const options = opts?.raw ? { enableItn: false, enablePunc: false } : undefined;
        const results: AsrUtteranceResult[] = await transcribeWithDoubaoAsrWords(wav, 'wav', options, onProgress);
        return results.map((u) => ({
          text: u.text,
          startSec: u.startSec + start,
          endSec: u.endSec + start,
          words: u.words.map((w) => ({ ...w, startSec: w.startSec + start, endSec: w.endSec + start })),
        }));
      } catch (err) {
        console.warn('[transcribe] 豆包小窗 ASR 失败，降级 Whisper:', err);
      }
    }
    const key = getDmxApiKey();
    if (!key) throw new Error('缺少 DMX API Key');
    const bytes = await readBinaryFile(wav);
    const cues = await transcribeWavBytes(key, bytes, start);
    return cues.map((c) => ({ text: c.text, startSec: c.startSec, endSec: c.endSec, words: [] }));
  } finally {
    void removeFile(wav).catch(() => {});
  }
}

/**
 * 整条时间轴转写：逐 clip 转写并按节目时间偏移合并
 * （每段偏移 = 前序片段有效时长累加；片段内裁掉 in 之前的 cue）。
 */
export async function transcribeTimeline(
  clips: EditorClip[],
  onProgress?: (done: number, total: number) => void,
): Promise<SubtitleCue[]> {
  const all: SubtitleCue[] = [];
  let offset = 0;
  let done = 0;
  for (const clip of clips) {
    const effective = Math.max(0.1, clip.outSec - clip.inSec);
    try {
      const cues = await transcribeFile(clip.path);
      for (const cue of cues) {
        // clip 内坐标 → 节目坐标（考虑裁剪窗口）
        const s = cue.startSec - clip.inSec;
        const e = cue.endSec - clip.inSec;
        if (e <= 0 || s >= effective) continue;
        all.push({
          ...cue,
          startSec: offset + Math.max(0, s),
          endSec: offset + Math.min(effective, e),
        });
      }
    } catch (err) {
      console.warn(`[transcribe] clip ${clip.label} 转写失败:`, err);
    }
    offset += effective;
    done += 1;
    onProgress?.(done, clips.length);
  }
  return all;
}
