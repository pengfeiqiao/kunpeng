/**
 * Kuaizi LZ (筷子丽帧) seed_audio TTS client —— 台词配音/声音克隆通道。
 *
 * 纯请求层：只负责「创建任务 → 轮询 → 返回 audio_url」，不做落盘；
 * 音频下载/落盘由调用方处理（fetchSpeechAudioBytes / rhtvDownloadResult）。
 *
 * 接口（官方文档）：
 * - create: POST {BASE_URL}/ai-open-platform-api/v1/seed_audio/task/create，ApiKey 头
 *   body: { text（必填 ≤4096，正文用「参考录音N」引用第 N 条参考音频）,
 *           references: [{ audio_url }]（必填 1-10 条，必须公网 HTTP(S) URL）,
 *           options?: { format: wav/mp3/pcm/ogg_opus（默认 wav）,
 *                        sample_rate: 8000-48000（默认 24000）,
 *                        speed: 0.5-2.0, volume: 0.5-2.0, pitch: -12~12 } }
 * - status: POST .../seed_audio/task/status { task_id }
 *   → data.status: running/succeeded/failed + audio_url + duration(秒, float)
 * - 错误：HTTP 200 + code!==0 为业务错误；余额不足 = HTTP 429 或 code 40001；
 *   官方建议轮询间隔 ≥3s。
 */
import { fetch as tauriFetch, ResponseType, Body } from '@tauri-apps/api/http';
import { isTransientKuaiziError, requireKuaiziApiKey } from './seedance';
import { isAmbiguousPaidSubmitStatus, PaidSubmissionUnknownError, PaidTaskCreatedError } from '@/lib/billingSafety';

// 与 seedance.ts 同源；那边未导出 BASE_URL，且该文件由其他代理在改，这里就地重定义。
const BASE_URL = 'https://aiopenapi.kuaizi.cn';
const CREATE_PATH = '/ai-open-platform-api/v1/seed_audio/task/create';
const STATUS_PATH = '/ai-open-platform-api/v1/seed_audio/task/status';

const INSUFFICIENT_BALANCE_MSG = '筷子丽帧余额不足（HTTP 429 / 40001），请充值后重试';

export type KuaiziSeedAudioStatus = 'pending' | 'submitted' | 'running' | 'succeeded' | 'failed';

export interface KuaiziSeedAudioPayload {
  text: string;
  references: Array<{ audio_url: string }>;
  options?: {
    format?: 'wav' | 'mp3' | 'pcm' | 'ogg_opus';
    sample_rate?: number;
    speed?: number;
    volume?: number;
    pitch?: number;
  };
}

export interface KuaiziSeedAudioCreateResponse {
  code: number;
  message?: string;
  data?: { task_id?: string };
  trace_id?: string;
}

export interface KuaiziSeedAudioStatusData {
  task_id: string;
  status: KuaiziSeedAudioStatus;
  audio_url?: string;
  duration?: number;
  error?: string;
}

export interface KuaiziSeedAudioStatusResponse {
  code: number;
  message?: string;
  data?: KuaiziSeedAudioStatusData;
  trace_id?: string;
}

export interface GenerateSeedAudioOptions {
  text: string;
  referenceAudioUrls: string[];
  format?: 'wav' | 'mp3' | 'pcm' | 'ogg_opus';
  sampleRate?: number;
  speed?: number;
  volume?: number;
  pitch?: number;
  signal?: AbortSignal;
  pollIntervalMs?: number;
  /** 配音场景默认 10 分钟 */
  timeoutMs?: number;
}

export interface SeedAudioResult {
  taskId: string;
  audioUrl: string;
  duration: number;
}

/**
 * 文本编排规则：seed_audio 用正文中的「参考录音N」把台词绑定到第 N 条参考音频
 * （N 按 references 数组顺序从 1 开始编号）。调用方已在 text 里写了「参考录音」
 * 时不做改动（多参考场景由调用方自行编排 参考录音1..N）；否则有参考音频时
 * 自动补「参考录音1：」前缀——单参考默认取第 1 条，多参考自动前缀也只用第 1 条
 * 的音色。
 */
export function buildSeedAudioText(text: string, referenceCount: number): string {
  if (referenceCount <= 0 || text.includes('参考录音')) return text;
  return `参考录音1：${text}`;
}

async function seedAudioCreateTask(
  payload: KuaiziSeedAudioPayload,
  signal?: AbortSignal,
): Promise<KuaiziSeedAudioCreateResponse> {
  const key = requireKuaiziApiKey();
  let res;
  try {
    res = await tauriFetch(`${BASE_URL}${CREATE_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ApiKey: key },
      body: Body.json(payload as unknown as Record<string, unknown>),
      responseType: ResponseType.JSON,
      timeout: 120,
    });
  } catch (err) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    throw new PaidSubmissionUnknownError('筷子丽帧配音', err instanceof Error ? err.message : String(err));
  }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (res.status === 429) throw new Error(INSUFFICIENT_BALANCE_MSG);
  if (!res.ok) {
    if (isAmbiguousPaidSubmitStatus(res.status)) {
      throw new PaidSubmissionUnknownError('筷子丽帧配音', `HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}`);
    }
    throw new Error(`筷子丽帧 seed_audio 创建任务失败 HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}`);
  }
  const parsed = res.data as KuaiziSeedAudioCreateResponse;
  if (parsed.code === 40001) throw new Error(INSUFFICIENT_BALANCE_MSG);
  if (parsed.code !== 0) {
    throw new Error(`筷子丽帧 seed_audio 创建任务被拒绝: ${parsed.message || JSON.stringify(parsed).slice(0, 300)}`);
  }
  if (!parsed.data?.task_id) {
    throw new PaidSubmissionUnknownError('筷子丽帧配音', `成功响应未包含 task_id：${JSON.stringify(parsed).slice(0, 300)}`);
  }
  return parsed;
}

async function seedAudioQueryTask(
  taskId: string,
  signal?: AbortSignal,
): Promise<KuaiziSeedAudioStatusResponse> {
  const key = requireKuaiziApiKey();
  const res = await tauriFetch(`${BASE_URL}${STATUS_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ApiKey: key },
    body: Body.json({ task_id: taskId }),
    responseType: ResponseType.JSON,
    timeout: 60,
  });
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (res.status === 429) throw new Error(INSUFFICIENT_BALANCE_MSG);
  if (!res.ok) {
    throw new Error(`筷子丽帧 seed_audio 查询失败 HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}`);
  }
  const parsed = res.data as KuaiziSeedAudioStatusResponse;
  if (parsed.code === 40001) throw new Error(INSUFFICIENT_BALANCE_MSG);
  if (parsed.code !== 0 || !parsed.data?.status) {
    throw new Error(`筷子丽帧 seed_audio 查询被拒绝: ${parsed.message || JSON.stringify(parsed).slice(0, 300)}`);
  }
  return parsed;
}

async function seedAudioPollTask(
  taskId: string,
  opts: { signal?: AbortSignal; intervalMs?: number; timeoutMs?: number } = {},
): Promise<KuaiziSeedAudioStatusData> {
  const start = Date.now();
  // 官方建议轮询间隔 ≥3s
  const intervalMs = Math.max(3000, opts.intervalMs ?? 4000);
  const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;
  let transientFailures = 0;

  while (Date.now() - start < timeoutMs) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    let resp: KuaiziSeedAudioStatusResponse;
    try {
      resp = await seedAudioQueryTask(taskId, opts.signal);
      transientFailures = 0;
    } catch (err) {
      if (!isTransientKuaiziError(err)) throw err;
      transientFailures += 1;
      console.warn(`[kuaizi-seed-audio] 轮询瞬时错误（第 ${transientFailures} 次）:`, err instanceof Error ? err.message : err);
      await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, intervalMs * Math.min(transientFailures, 4))));
      continue;
    }
    const data = resp.data!;
    if (data.status === 'succeeded') return data;
    if (data.status === 'failed') throw new Error(`筷子丽帧 seed_audio 任务失败: ${data.error || 'unknown error'}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`筷子丽帧 seed_audio 任务超时: ${taskId}`);
}

/**
 * 创建并轮询一个 seed_audio 配音任务，成功返回 { audioUrl, duration }。
 * 失败抛出带原文的 Error；余额不足（HTTP 429 / code 40001）报「筷子丽帧余额不足」。
 */
export async function generateSeedAudioViaKuaizi(opts: GenerateSeedAudioOptions): Promise<SeedAudioResult> {
  const referenceAudioUrls = (opts.referenceAudioUrls ?? []).map((u) => u.trim()).filter(Boolean).slice(0, 10);
  if (referenceAudioUrls.length === 0) {
    throw new Error('筷子丽帧 seed_audio 需要 1-10 条公网参考音色音频 URL');
  }
  const text = buildSeedAudioText(opts.text.trim(), referenceAudioUrls.length);
  if (!text) throw new Error('筷子丽帧 seed_audio 的 text 不能为空');
  if (text.length > 4096) {
    throw new Error(`筷子丽帧 seed_audio 的 text 超长（${text.length} 字，上限 4096）`);
  }

  const options: KuaiziSeedAudioPayload['options'] = {};
  if (opts.format) options.format = opts.format;
  if (opts.sampleRate != null) options.sample_rate = Math.min(48000, Math.max(8000, Math.trunc(opts.sampleRate)));
  if (opts.speed != null) options.speed = Math.min(2, Math.max(0.5, opts.speed));
  if (opts.volume != null) options.volume = Math.min(2, Math.max(0.5, opts.volume));
  if (opts.pitch != null) options.pitch = Math.min(12, Math.max(-12, Math.trunc(opts.pitch)));

  const created = await seedAudioCreateTask(
    {
      text,
      references: referenceAudioUrls.map((audio_url) => ({ audio_url })),
      ...(Object.keys(options).length > 0 ? { options } : {}),
    },
    opts.signal,
  );
  const taskId = created.data!.task_id!;
  console.log('[kuaizi-seed-audio] 任务已创建:', taskId, '参考数:', referenceAudioUrls.length);

  try {
    const status = await seedAudioPollTask(taskId, {
      signal: opts.signal,
      intervalMs: opts.pollIntervalMs,
      timeoutMs: opts.timeoutMs,
    });
    if (!status.audio_url) throw new Error('生成成功但未返回 audio_url');
    return { taskId, audioUrl: status.audio_url, duration: Number(status.duration ?? 0) };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new PaidTaskCreatedError('筷子丽帧配音', taskId, err instanceof Error ? err.message : String(err));
  }
}
