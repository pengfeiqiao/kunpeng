/**
 * doubaoAsr — 豆包录音文件识别（AUC 大模型）客户端。
 *
 * 火山 openspeech 异步任务式 ASR：提交音频 URL → 轮询查询 → 拿分句/词级时间戳。
 * 与 dmxapi Whisper-1 相比：无 25MB 内联限制（音频上限 512MB），长素材免分块；
 * 返回 utterance 级毫秒时间戳 + 词级时间戳，对智能剪辑（口癖裁剪）更精确。
 *
 * 认证：X-Api-Key（与 doubaoSpeech TTS 共用 doubaoSpeechApiKey，同 openspeech 平台）。
 * 音频需以公网 URL 提交 → 先用 uploadToCos 上传抽出的 wav。
 *
 * 端点 / 字段 / 错误码参考火山 AUC 大模型文档（已实测 2026-07）。
 */
import { fetch as tauriFetch, ResponseType } from '@tauri-apps/api/http';
import { useSettingsStore } from '@/stores/settingsStore';
import { resolveApiKey, resolveCosSecrets } from '@/lib/credentials';
import { uploadToCos } from '@/lib/cos';
import type { SubtitleCue } from '@/stores/editorStore';
import { nanoid } from 'nanoid';

const SUBMIT_URL = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit';
const QUERY_URL = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/query';
/** 豆包录音文件识别 2.0 资源 ID（1.0 为 volc.bigasr.auc） */
const RESOURCE_ID = 'volc.seedasr.auc';

/** 提交任务成功后的服务端状态码 */
const CODE_OK = '20000000';
/** 正在处理中 */
const CODE_PROCESSING = '20000001';
/** 任务在队列中 */
const CODE_QUEUED = '20000002';

interface RawAsrUtterance {
  text: string;
  start_time: number; // 毫秒
  end_time: number; // 毫秒
  definite?: boolean;
  words?: { text: string; start_time: number; end_time: number; blank_duration?: number }[];
}

/** 词级结果（秒）。blankMs = 与前一个词之间的空白毫秒数（重来/换气的关键信号）。 */
export interface AsrWord {
  w: string;
  startSec: number;
  endSec: number;
  blankMs?: number;
}

/** 分句级结果（秒），携带词级时间戳。 */
export interface AsrUtteranceResult {
  text: string;
  startSec: number;
  endSec: number;
  words: AsrWord[];
}

/** ASR 请求可配置项。审片重转写用 raw 模式（关 itn/punc）保留真实语流。 */
export interface DoubaoAsrOptions {
  /** 数字/金额规范化（默认 true；raw 模式传 false） */
  enableItn?: boolean;
  /** 语义标点（默认 true；raw 模式传 false——语义标点会合并重复、清洗口误） */
  enablePunc?: boolean;
}

interface AsrQueryResult {
  text?: string;
  utterances?: RawAsrUtterance[];
}

interface AsrQueryResponse {
  result?: AsrQueryResult;
  audio_info?: { duration?: number };
  code?: number;
  message?: string;
}

function getApiKey(): string {
  const s = useSettingsStore.getState();
  return resolveApiKey(s, 'doubaoSpeech', s.doubaoSpeechApiKey).trim();
}

function hasCosConfig(): boolean {
  const s = useSettingsStore.getState();
  const { secretId, secretKey } = resolveCosSecrets(s, s.cosSecretId, s.cosSecretKey);
  return Boolean(s.cosBucket && secretId.trim() && secretKey.trim());
}

/** 生成 RFC4122 UUID（无 crypto.randomUUID 兜底） */
function uuid(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch { /* fallthrough */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** 提交 AUC 任务。成功返回 taskId（即 X-Api-Request-Id）；失败抛错。 */
async function submitTask(audioUrl: string, format: string, options?: DoubaoAsrOptions): Promise<string> {
  const apiKey = getApiKey();
  const taskId = uuid();
  const body = {
    user: { uid: 'kunpeng' },
    audio: { url: audioUrl, format, language: 'zh-CN' },
    request: {
      model_name: 'bigmodel',
      enable_itn: options?.enableItn ?? true, // 数字/金额规范化
      enable_punc: options?.enablePunc ?? true, // 加标点
      show_utterances: true, // 返回分句 + 词级时间戳
    },
  };

  const resp = await tauriFetch(SUBMIT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
      'X-Api-Resource-Id': RESOURCE_ID,
      'X-Api-Request-Id': taskId,
      'X-Api-Sequence': '-1',
    },
    body: { type: 'Json', payload: body },
    responseType: ResponseType.JSON,
    timeout: 60,
  });

  // 提交结果状态码在 response header X-Api-Status-Code；Tauri HTTP 把 headers 放在 resp.headers
  const status = String(resp.headers?.['X-Api-Status-Code'] ?? resp.headers?.['x-api-status-code'] ?? '');
  const msg = String(resp.headers?.['X-Api-Message'] ?? resp.headers?.['x-api-message'] ?? '');
  if (!resp.ok || (status && status !== CODE_OK)) {
    throw new Error(`豆包 ASR 提交失败: ${status || resp.status} ${msg || JSON.stringify(resp.data).slice(0, 200)}`);
  }
  return taskId;
}

/** 轮询查询任务结果。返回 utterances（可能为空数组）。 */
async function pollTask(
  taskId: string,
  onProgress?: (status: string) => void,
  maxAttempts = 60,
  intervalMs = 3000,
): Promise<RawAsrUtterance[]> {
  const apiKey = getApiKey();
  for (let i = 0; i < maxAttempts; i++) {
    const resp = await tauriFetch(QUERY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
        'X-Api-Resource-Id': RESOURCE_ID,
        'X-Api-Request-Id': taskId,
      },
      body: { type: 'Json', payload: {} },
      responseType: ResponseType.JSON,
      timeout: 30,
    });
    const status = String(resp.headers?.['X-Api-Status-Code'] ?? resp.headers?.['x-api-status-code'] ?? '');

    if (status === CODE_PROCESSING || status === CODE_QUEUED) {
      onProgress?.(status === CODE_QUEUED ? 'queued' : 'processing');
      await new Promise((r) => setTimeout(r, intervalMs));
      continue;
    }
    if (status === CODE_OK || (!status && resp.ok)) {
      const data = resp.data as AsrQueryResponse;
      return data?.result?.utterances ?? [];
    }
    // 静音音频（20000003）等：无分句，返回空
    if (status === '20000003') return [];
    const msg = String(resp.headers?.['X-Api-Message'] ?? resp.headers?.['x-api-message'] ?? '');
    throw new Error(`豆包 ASR 查询失败: ${status} ${msg || JSON.stringify(resp.data).slice(0, 200)}`);
  }
  throw new Error('豆包 ASR 超时：任务长时间未完成');
}

/** utterances → SubtitleCue[]（start/end 毫秒 → 秒） */
function utterancesToCues(utterances: RawAsrUtterance[]): SubtitleCue[] {
  return utterances
    .filter((u) => (u.text || '').trim())
    .map((u) => ({
      id: `sub-${nanoid(6)}`,
      startSec: u.start_time / 1000,
      endSec: Math.max(u.start_time / 1000 + 0.2, u.end_time / 1000),
      text: u.text.trim(),
    }));
}

/** utterances → 词级结构（毫秒 → 秒），保留 blank_duration 停顿证据 */
function utterancesToResults(utterances: RawAsrUtterance[]): AsrUtteranceResult[] {
  return utterances
    .filter((u) => (u.text || '').trim())
    .map((u) => ({
      text: u.text.trim(),
      startSec: u.start_time / 1000,
      endSec: Math.max(u.start_time / 1000 + 0.2, u.end_time / 1000),
      words: (u.words ?? [])
        .filter((w) => (w.text || '').trim())
        .map((w) => ({
          w: w.text,
          startSec: w.start_time / 1000,
          endSec: Math.max(w.start_time / 1000 + 0.02, w.end_time / 1000),
          ...(w.blank_duration != null ? { blankMs: w.blank_duration } : {}),
        })),
    }));
}

export interface DoubaoAsrCapabilities {
  available: boolean;
  reason?: string;
}

/** 是否可用：需要 doubaoSpeechApiKey + COS 配置 */
export function doubaoAsrAvailable(): DoubaoAsrCapabilities {
  if (!getApiKey()) return { available: false, reason: '未配置豆包语音 API Key' };
  if (!hasCosConfig()) return { available: false, reason: '未配置腾讯云 COS（ASR 需上传音频到公网）' };
  return { available: true };
}

/**
 * 转写本地音频文件（豆包 AUC）。
 * @param localAudioPath 本地音频文件路径（wav/mp3 等）
 * @param format 音频容器格式：raw/wav/mp3/ogg
 * @param onProgress 进度回调（'uploading' | 'queued' | 'processing'）
 */
export async function transcribeWithDoubaoAsr(
  localAudioPath: string,
  format: string,
  onProgress?: (status: string) => void,
): Promise<SubtitleCue[]> {
  const cap = doubaoAsrAvailable();
  if (!cap.available) throw new Error(cap.reason ?? '豆包 ASR 不可用');

  onProgress?.('uploading');
  // 上传到 COS 拿公网 URL（AUC 要求音频以 URL 提交，不支持直接传文件）
  const fileName = localAudioPath.split('/').pop() || `asr-${Date.now()}.${format}`;
  const audioUrl = await uploadToCos(localAudioPath, fileName);

  onProgress?.('submitting');
  const taskId = await submitTask(audioUrl, format);

  const utterances = await pollTask(taskId, onProgress);
  const cues = utterancesToCues(utterances);
  console.log(`[doubaoAsr] 转写完成：${cues.length} 句`);
  return cues;
}

/**
 * 转写本地音频文件（豆包 AUC），返回**词级**结果。
 * 审片链路专用：options 传 { enableItn: false, enablePunc: false } 即 raw 模式——
 * ASR 不做语义规范化，保留真实语流里的重复、口误与停顿证据。
 */
export async function transcribeWithDoubaoAsrWords(
  localAudioPath: string,
  format: string,
  options?: DoubaoAsrOptions,
  onProgress?: (status: string) => void,
): Promise<AsrUtteranceResult[]> {
  const cap = doubaoAsrAvailable();
  if (!cap.available) throw new Error(cap.reason ?? '豆包 ASR 不可用');

  onProgress?.('uploading');
  const fileName = localAudioPath.split('/').pop() || `asr-${Date.now()}.${format}`;
  const audioUrl = await uploadToCos(localAudioPath, fileName);

  onProgress?.('submitting');
  const taskId = await submitTask(audioUrl, format, options);

  const utterances = await pollTask(taskId, onProgress);
  const results = utterancesToResults(utterances);
  const wordCount = results.reduce((n, u) => n + u.words.length, 0);
  console.log(`[doubaoAsr] 词级转写完成：${results.length} 句 / ${wordCount} 词${options?.enablePunc === false ? '（raw）' : ''}`);
  return results;
}
