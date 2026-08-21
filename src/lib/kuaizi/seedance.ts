/**
 * Kuaizi LZ (筷子丽帧) Seedance client — default video generation backend.
 * mode=fast/pro/mini 走 Seedance 2.0 档；mode=seedance2.5 走 Seedance 2.5 档
 * （素材 30 图/10 视频/10 音频、音频总时长 30s、resolution 仅 480p/720p、
 * duration 4-30s）。
 */
import { fetch as tauriFetch, ResponseType, Body } from '@tauri-apps/api/http';
import { invoke, convertFileSrc } from '@tauri-apps/api/tauri';
import { homeDir } from '@tauri-apps/api/path';
import { useSettingsStore } from '@/stores/settingsStore';
import { resolveApiKey } from '@/lib/credentials';
import { uploadToCos } from '@/lib/cos';
import { assetUrlToLocalPath } from '@/lib/rhtv/upload';
import { probeDuration } from '@/lib/canvas/videoCompose';
import { rhtvDownloadAll } from '@/lib/rhtv/download';
import { appendArtifact } from '@/lib/artifacts';
import { appendGenerationLog } from '@/lib/aigc/genLogger';
import { isAmbiguousPaidSubmitStatus, PaidSubmissionUnknownError, PaidTaskCreatedError } from '@/lib/billingSafety';
import { normalizeKuaiziDuration } from './duration';

export const KUAIZI_SEEDANCE_ENGINE_ID = 'kuaizi-seedance-2.0';
const BASE_URL = 'https://aiopenapi.kuaizi.cn';
const CREATE_PATH = '/ai-open-platform-api/v1/lz/video/task/create';
const STATUS_PATH = '/ai-open-platform-api/v1/lz/video/task/status';

/** fast/pro/mini = Seedance 2.0 档；seedance2.5 = Seedance 2.5 档。 */
export type KuaiziVideoMode = 'fast' | 'pro' | 'mini' | 'seedance2.5';

/** 归一化筷子 mode：只认 fast/mini/seedance2.5，其余一律 pro。 */
export function normalizeKuaiziMode(raw: unknown): KuaiziVideoMode {
  const value = String(raw || 'pro');
  if (value === 'fast') return 'fast';
  if (value === 'mini') return 'mini';
  if (value === 'seedance2.5') return 'seedance2.5';
  return 'pro';
}

/**
 * 筷子业务错误（不自动重试）：
 * - balance：余额不足（HTTP 429 或 message 含 40001），上层据此降级/提示充值。
 * - task_failed：远端任务进入 failed 终态（失败不扣费），上层可安全降级重试。
 */
export type KuaiziErrorKind = 'balance' | 'task_failed';

export class KuaiziBusinessError extends Error {
  readonly kind: KuaiziErrorKind;
  constructor(kind: KuaiziErrorKind, message: string) {
    super(message);
    this.name = 'KuaiziBusinessError';
    this.kind = kind;
  }
}

function isKuaiziBalanceMessage(text: string): boolean {
  return /40001|余额不足|insufficient|balance/i.test(text);
}

export type KuaiziVideoStatus = 'pending' | 'submitted' | 'running' | 'succeeded' | 'failed';

export interface KuaiziImageInput {
  url: string;
  role?: 'reference_image' | 'first_frame' | 'last_frame';
}

export interface KuaiziVideoInput {
  url: string;
  role?: 'reference_video';
}

export interface KuaiziAudioInput {
  url: string;
  role?: 'reference_audio';
}

export interface KuaiziSuperResolutionConfig {
  resolution?: '720p' | '1080p' | '2k' | '4k';
  resolution_limit?: number;
  scene?: 'aigc' | 'short_series' | 'ugc' | 'old_film';
  tool_version?: 'standard' | 'professional';
  fps?: number;
}

export interface KuaiziCreateTaskPayload {
  prompt: string;
  mode?: KuaiziVideoMode;
  images?: KuaiziImageInput[];
  videos?: KuaiziVideoInput[];
  audios?: KuaiziAudioInput[];
  resolution?: '480p' | '720p' | '1080p';
  ratio?: '16:9' | '4:3' | '1:1' | '3:4' | '9:16' | '21:9' | 'adaptive';
  duration?: number;
  generate_audio?: boolean;
  watermark?: boolean;
  seed?: number | string;
  return_last_frame?: boolean;
  execution_expires_after?: number;
  super_resolution_config?: KuaiziSuperResolutionConfig;
  ips?: string[];
}

export interface KuaiziCreateTaskResponse {
  code: number;
  message?: string;
  data?: { task_id?: string };
  trace_id?: string;
}

export interface KuaiziTaskStatusData {
  task_id: string;
  status: KuaiziVideoStatus;
  video_url?: string;
  tos_key?: string;
  last_frame_url?: string;
  seed?: number | string;
  framespersecond?: number | string;
  generate_audio?: boolean;
  execution_expires_after?: number | string;
  duration?: number;
  error?: string;
  usage?: { completion_tokens?: number; total_tokens?: number };
}

export interface KuaiziTaskStatusResponse {
  code: number;
  message?: string;
  data?: KuaiziTaskStatusData;
  trace_id?: string;
}

export interface KuaiziSeedanceRunRequest {
  prompt: string;
  referenceUrls?: string[];
  videoUrls?: string[];
  audioUrls?: string[];
  params?: Record<string, unknown>;
  imageRoles?: KuaiziImageInput['role'][];
  taskId?: string;
  onProviderTaskCreated?: (taskId: string) => void;
  onProgress?: (phase: string) => void;
  signal?: AbortSignal;
}

export interface KuaiziSeedanceRunResult {
  taskId: string;
  resultPaths: string[];
  resultUrls: string[];
  status: KuaiziTaskStatusData;
  payload: KuaiziCreateTaskPayload;
}

export function getKuaiziApiKey(): string {
  const s = useSettingsStore.getState();
  return resolveApiKey(s, 'kuaizi', s.kuaiziApiKey).trim();
}

export function requireKuaiziApiKey(): string {
  const key = getKuaiziApiKey();
  if (!key) throw new Error('未配置筷子丽帧 API Key，请先在「设置 → API 密钥 → 视频生成」填写');
  return key;
}

function sanitizeFileName(ref: string, fallback: string): string {
  const raw = ref.split('/').pop()?.split('?')[0] || fallback;
  return raw.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function toBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    if (v === 'true') return true;
    if (v === 'false') return false;
  }
  return fallback;
}

function toInt(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function normalizeResolution(
  raw: unknown,
  mode: KuaiziVideoMode,
): { resolution: '480p' | '720p' | '1080p'; superResolution?: KuaiziSuperResolutionConfig } {
  const value = String(raw || '720p');
  // Seedance 2.5 仅支持 480p/720p：更高值静默降为 720p，且不挂链式超分
  if (mode === 'seedance2.5') {
    return { resolution: value === '480p' ? '480p' : '720p' };
  }
  if (value === '480p') return { resolution: '480p' };
  if (value === '1080p' || value === 'native1080p') return { resolution: '1080p' };
  if (value === '2k' || value === '4k') {
    return {
      resolution: '1080p',
      superResolution: {
        resolution: value,
        scene: 'aigc',
        tool_version: 'standard',
      },
    };
  }
  return { resolution: '720p' };
}

function normalizeRatio(raw: unknown): KuaiziCreateTaskPayload['ratio'] {
  const value = String(raw || '16:9');
  if (['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'].includes(value)) {
    return value as KuaiziCreateTaskPayload['ratio'];
  }
  return '16:9';
}

export async function appendKuaiziLog(entry: Record<string, unknown>): Promise<void> {
  try {
    const home = await homeDir();
    const path = `${home.replace(/\/$/, '')}/.kunpeng/aigc-memory/generation-log/kuaizi-seedance2.jsonl`;
    await invoke('append_file', { path, content: `${JSON.stringify(entry)}\n` });
  } catch (err) {
    console.warn('[kuaizi-seedance] failed to append log:', err);
  }
}

export function isTransientKuaiziError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /Network Error|error sending request|timed out|timeout|超时|failed to fetch|connection closed|dns|ECONN|ETIMEDOUT|EPIPE|ENOTFOUND|下载失败 HTTP 5\d\d|HTTP 5\d\d/i.test(msg);
}

/**
 * Kuaizi accepts public HTTP URLs or asset:// IDs. For local canvas/workshop
 * refs we upload to the user's configured COS and pass the public URL.
 */
export async function resolveKuaiziMediaRef(ref: string): Promise<string> {
  if ((ref.startsWith('http://') || ref.startsWith('https://')) && !ref.startsWith('https://asset.localhost/')) {
    return ref;
  }
  const localPath = assetUrlToLocalPath(ref);
  const fileName = sanitizeFileName(localPath, `kuaizi-ref-${Date.now()}`);
  return uploadToCos(localPath, fileName);
}

export function buildKuaiziSeedancePayload(args: {
  prompt: string;
  imageUrls?: string[];
  videoUrls?: string[];
  audioUrls?: string[];
  params?: Record<string, unknown>;
  imageRoles?: KuaiziImageInput['role'][];
}): KuaiziCreateTaskPayload {
  const params = args.params ?? {};
  const mode = normalizeKuaiziMode(params.mode || params.kuaiziMode);
  // 素材上限按档：2.5 → 30 图/10 视频/10 音频，2.0 档 → 9/3/3
  const limits = mode === 'seedance2.5'
    ? { images: 30, videos: 10, audios: 10 }
    : { images: 9, videos: 3, audios: 3 };
  const { resolution, superResolution } = normalizeResolution(params.resolution, mode);
  const duration = normalizeKuaiziDuration(params.duration, 5, mode);
  const superFromParams = params.super_resolution_config as KuaiziSuperResolutionConfig | undefined;
  const images: KuaiziImageInput[] = (args.imageUrls ?? []).slice(0, limits.images).map((url, i) => ({
    url,
    role: args.imageRoles?.[i] ?? 'reference_image',
  }));
  return {
    prompt: args.prompt,
    mode,
    images,
    videos: (args.videoUrls ?? []).slice(0, limits.videos).map((url) => ({ url, role: 'reference_video' })),
    audios: (args.audioUrls ?? []).slice(0, limits.audios).map((url) => ({ url, role: 'reference_audio' })),
    resolution,
    ratio: normalizeRatio(params.ratio ?? params.aspectRatio),
    duration,
    generate_audio: toBool(params.no_generate_audio, false)
      ? false
      : toBool(params.generateAudio ?? params.generate_audio, true),
    watermark: toBool(params.watermark, false),
    return_last_frame: toBool(params.returnLastFrame ?? params.return_last_frame, false),
    execution_expires_after: toInt(params.execution_expires_after, 172800),
    ...(params.seed ? { seed: params.seed as string | number } : {}),
    // 2.5 不允许 1080p+，链式超分一并省略
    ...(mode !== 'seedance2.5' && superFromParams
      ? { super_resolution_config: superFromParams }
      : mode !== 'seedance2.5' && superResolution
        ? { super_resolution_config: superResolution }
        : {}),
  };
}

export async function kuaiziCreateTask(
  payload: KuaiziCreateTaskPayload,
  signal?: AbortSignal,
): Promise<KuaiziCreateTaskResponse> {
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
    throw new PaidSubmissionUnknownError('筷子丽帧', err instanceof Error ? err.message : String(err));
  }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!res.ok) {
    const detail = JSON.stringify(res.data).slice(0, 300);
    if (isAmbiguousPaidSubmitStatus(res.status)) {
      throw new PaidSubmissionUnknownError('筷子丽帧', `HTTP ${res.status}: ${detail}`);
    }
    if (res.status === 429 || isKuaiziBalanceMessage(detail)) {
      throw new KuaiziBusinessError('balance', `筷子丽帧余额不足（HTTP ${res.status}），请充值后重试: ${detail}`);
    }
    throw new Error(`筷子丽帧创建任务失败 HTTP ${res.status}: ${detail}`);
  }
  const parsed = res.data as KuaiziCreateTaskResponse;
  if (parsed.code !== 0) {
    const detail = parsed.message || JSON.stringify(parsed).slice(0, 300);
    if (isKuaiziBalanceMessage(detail)) {
      throw new KuaiziBusinessError('balance', `筷子丽帧余额不足，请充值后重试: ${detail}`);
    }
    throw new Error(`筷子丽帧创建任务被拒绝: ${detail}`);
  }
  if (!parsed.data?.task_id) {
    throw new PaidSubmissionUnknownError('筷子丽帧', `成功响应未包含 task_id：${JSON.stringify(parsed).slice(0, 300)}`);
  }
  return parsed;
}

export async function kuaiziQueryTask(
  taskId: string,
  signal?: AbortSignal,
): Promise<KuaiziTaskStatusResponse> {
  const key = requireKuaiziApiKey();
  const res = await tauriFetch(`${BASE_URL}${STATUS_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ApiKey: key },
    body: Body.json({ task_id: taskId }),
    responseType: ResponseType.JSON,
    timeout: 60,
  });
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!res.ok) {
    const detail = JSON.stringify(res.data).slice(0, 300);
    if (res.status === 429 || isKuaiziBalanceMessage(detail)) {
      throw new KuaiziBusinessError('balance', `筷子丽帧余额不足（HTTP ${res.status}），请充值后重试: ${detail}`);
    }
    throw new Error(`筷子丽帧查询失败 HTTP ${res.status}: ${detail}`);
  }
  const parsed = res.data as KuaiziTaskStatusResponse;
  if (parsed.code !== 0 || !parsed.data?.status) {
    const detail = parsed.message || JSON.stringify(parsed).slice(0, 300);
    if (isKuaiziBalanceMessage(detail)) {
      throw new KuaiziBusinessError('balance', `筷子丽帧余额不足，请充值后重试: ${detail}`);
    }
    throw new Error(`筷子丽帧查询被拒绝: ${detail}`);
  }
  return parsed;
}

export async function kuaiziPollTask(
  taskId: string,
  opts: {
    signal?: AbortSignal;
    onProgress?: (status: KuaiziVideoStatus, elapsedMs: number) => void;
    intervalMs?: number;
    timeoutMs?: number;
  } = {},
): Promise<KuaiziTaskStatusData> {
  const start = Date.now();
  const intervalMs = Math.max(5000, opts.intervalMs ?? 5000);
  const timeoutMs = opts.timeoutMs ?? 20 * 60 * 1000;
  let transientFailures = 0;

  while (Date.now() - start < timeoutMs) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    let resp: KuaiziTaskStatusResponse;
    try {
      resp = await kuaiziQueryTask(taskId, opts.signal);
      transientFailures = 0;
    } catch (err) {
      if (!isTransientKuaiziError(err)) throw err;
      transientFailures += 1;
      opts.onProgress?.('running', Date.now() - start);
      await appendKuaiziLog({
        timestamp: new Date().toISOString(),
        provider: 'kuaizi-lz',
        event: 'poll_transient_error',
        taskId,
        transientFailures,
        error: err instanceof Error ? err.message : String(err),
        elapsedMs: Date.now() - start,
      });
      await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, intervalMs * Math.min(transientFailures, 4))));
      continue;
    }
    const data = resp.data!;
    opts.onProgress?.(data.status, Date.now() - start);
    await appendKuaiziLog({
      timestamp: new Date().toISOString(),
      provider: 'kuaizi-lz',
      event: 'poll',
      taskId,
      status: data.status,
      traceId: resp.trace_id,
      elapsedMs: Date.now() - start,
    });
    if (data.status === 'succeeded') return data;
    if (data.status === 'failed') throw new KuaiziBusinessError('task_failed', `筷子丽帧任务失败: ${data.error || 'unknown error'}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`筷子丽帧任务超时: ${taskId}`);
}

export async function runKuaiziSeedance2Generation(req: KuaiziSeedanceRunRequest): Promise<KuaiziSeedanceRunResult> {
  const mode = normalizeKuaiziMode(req.params?.mode ?? req.params?.kuaiziMode);
  const engineTag = mode === 'seedance2.5' ? 'kuaizi-lz/seedance-2.5' : 'kuaizi-lz/seedance-2.0';
  req.onProgress?.('上传参考素材到 COS…');
  const imageUrls: string[] = [];
  for (const ref of req.referenceUrls ?? []) imageUrls.push(await resolveKuaiziMediaRef(ref));
  const videoUrls: string[] = [];
  for (const ref of req.videoUrls ?? []) videoUrls.push(await resolveKuaiziMediaRef(ref));
  // 参考音频总时长上限：Seedance 2.0 档 15s、2.5 档 30s，超长会导致传参错误。上传 COS 前先 probe 时长拦截。
  const audioRefs = req.audioUrls ?? [];
  const audioLimitSec = mode === 'seedance2.5' ? 30 : 15;
  if (audioRefs.length > 0) {
    let totalAudioDur = 0;
    for (const ref of audioRefs) {
      const localPath = assetUrlToLocalPath(ref);
      const dur = await probeDuration(localPath);
      if (dur > 0) totalAudioDur += dur;
    }
    if (totalAudioDur > audioLimitSec) {
      throw new Error(`参考音频总时长 ${totalAudioDur.toFixed(1)}s 超过 Seedance ${mode === 'seedance2.5' ? '2.5' : '2.0'} 的 ${audioLimitSec}s 上限，请先裁剪音频再生成（可只取前 ${audioLimitSec}s 或缩短音频）。`);
    }
  }
  const audioUrls: string[] = [];
  for (const ref of audioRefs) audioUrls.push(await resolveKuaiziMediaRef(ref));

  const payload = buildKuaiziSeedancePayload({
    prompt: req.prompt,
    imageUrls,
    videoUrls,
    audioUrls,
    params: req.params,
    imageRoles: req.imageRoles,
  });

  await appendKuaiziLog({
    timestamp: new Date().toISOString(),
    provider: 'kuaizi-lz',
    event: 'create_request',
    hidden: false,
    apiKeyConfigured: Boolean(getKuaiziApiKey()),
    payload: { ...payload, prompt: payload.prompt.slice(0, 4000) },
    sourceRefs: {
      images: req.referenceUrls ?? [],
      videos: req.videoUrls ?? [],
      audios: req.audioUrls ?? [],
    },
  });

  req.onProgress?.('提交筷子丽帧任务…');
  const created = await kuaiziCreateTask(payload, req.signal);
  const taskId = created.data!.task_id!;
  try { req.onProviderTaskCreated?.(taskId); } catch { /* caller progress hook must not break generation */ }
  await appendKuaiziLog({
    timestamp: new Date().toISOString(),
    provider: 'kuaizi-lz',
    event: 'create_response',
    taskId,
    traceId: created.trace_id,
  });

  let status: KuaiziTaskStatusData;
  let resultPaths: string[];
  try {
    req.onProgress?.('等待筷子丽帧生成…');
    status = await kuaiziPollTask(taskId, {
      signal: req.signal,
      onProgress: (s, elapsed) => req.onProgress?.(`${s} · ${Math.round(elapsed / 1000)}s`),
    });
    if (!status.video_url) throw new Error('生成成功但未返回 video_url');

    req.onProgress?.('下载筷子丽帧视频…');
    resultPaths = await rhtvDownloadAll([status.video_url], 'video', mode === 'seedance2.5' ? 'kuaizi-seedance-2.5' : 'kuaizi-seedance-2.0', req.onProgress);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    if (err instanceof KuaiziBusinessError && err.kind === 'task_failed') throw err;
    throw new PaidTaskCreatedError('筷子丽帧', taskId, err instanceof Error ? err.message : String(err));
  }
  const resultUrls = resultPaths.map((p) => convertFileSrc(p));

  await appendKuaiziLog({
    timestamp: new Date().toISOString(),
    provider: 'kuaizi-lz',
    event: 'success',
    taskId,
    status,
    outputPaths: resultPaths,
  });

  for (const p of resultPaths) {
    void appendArtifact({
      path: p,
      type: 'video',
      engine: engineTag,
      prompt: req.prompt,
      taskId,
    });
  }
  void appendGenerationLog({
    timestamp: new Date().toISOString(),
    director: '',
    taskType: imageUrls.length > 0 || videoUrls.length > 0 ? 'image-to-video' : 'text-to-video',
    engine: 'seedance',
    prompt: req.prompt,
    outputPath: resultPaths[0],
    outputPaths: resultPaths,
    model: engineTag,
    taskId,
    params: req.params,
    refs: [
      ...imageUrls.map((source, i) => ({ index: i + 1, type: 'image' as const, source })),
      ...audioUrls.map((source, i) => ({ index: i + 1, type: 'audio' as const, source })),
      ...videoUrls.map((source, i) => ({ index: i + 1, type: 'video' as const, source })),
    ],
  });

  return { taskId, resultPaths, resultUrls, status, payload };
}
