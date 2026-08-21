import { fetch as tauriFetch, ResponseType } from '@tauri-apps/api/http';
import { convertFileSrc, invoke } from '@tauri-apps/api/tauri';
import { createDir, writeBinaryFile } from '@tauri-apps/api/fs';
import { useSettingsStore } from '@/stores/settingsStore';
import { uploadToCos } from '@/lib/cos';
import {
  ApimartAllRoutesConnectError,
  resolveApimartBaseUrl,
  withApimartGetFailover,
  withApimartSubmitFailover,
} from '@/lib/apimart/baseUrl';
import { assetUrlToLocalPath } from '@/lib/rhtv/upload';
import { appendArtifact } from '@/lib/artifacts';
import { OMNI_ZEXAPI_BASE_URL } from '@/stores/settingsStore';
import { resolveApiKey } from '@/lib/credentials';
import {
  PaidSubmissionUnknownError,
  isAmbiguousPaidSubmitStatus,
  shouldStopAutomaticPaidFallback,
} from '@/lib/billingSafety';

export const OMNI_MODEL = 'gemini-omni-flash-preview';
export const OMNI_ZEX_MODEL = 'omni_flash-10s';
export const OMNI_ZEROFALL_BASE_URL = 'https://llm.zerofall.top';
export const OMNI_ZEROFALL_TEXT_MODEL = 'omni-flash';
export const OMNI_ZEROFALL_MODEL = 'omni-flash-vref';

export interface OmniGenerateRequest {
  prompt: string;
  imageUrls?: string[];
  videoUrls?: string[];
  aspectRatio?: '16:9' | '9:16';
  resolution?: '720p';
  taskLabel?: string;
  onProgress?: (message: string) => void;
}

export interface OmniGenerateResult {
  success: boolean;
  taskId?: string;
  resultUrls: string[];
  resultPaths: string[];
  creditsCost?: number;
  cost?: number;
  baseUrl?: string;
  /** 实际用成的引擎标签（降级链场景下用于排查，如 'Omni' / 'MiniMax H3' / 'Seedance Mini'） */
  engineUsed?: string;
  /** 已提交或提交结果未知；上层必须停止自动切换其他付费引擎。 */
  preventFallback?: boolean;
  error?: string;
}

interface SubmitOk {
  code?: number;
  data?: Array<{ status?: string; task_id?: string }>;
  error?: { message?: string; type?: string; code?: number };
}

interface TaskStatus {
  code?: number;
  data?: {
    id?: string;
    status?: string;
    progress?: number;
    cost?: number;
    credits_cost?: number;
    result?: {
      videos?: Array<{ url?: string[] | string; expires_at?: number }>;
    };
    error?: string;
    fail_reason?: string;
  };
  error?: { message?: string; type?: string; code?: number };
}

interface OmniProvider {
  kind: 'zerofall' | 'zexapi' | 'apimart';
  baseUrl: string;
  model: string;
  apiKey: string;
}

interface ZexTaskStatus {
  id?: string;
  task_id?: string;
  object?: string;
  model?: string;
  status?: string;
  progress?: number | string;
  created_at?: number;
  completed_at?: number;
  size?: string;
  video_url?: string;
  error?: { message?: string; code?: string } | string;
  code?: string;
  message?: string;
  data?: unknown;
}

interface ZeroFallSubmitStatus {
  id?: string;
  task_id?: string;
  object?: string;
  model?: string;
  status?: string;
  progress?: number;
  created_at?: number;
  error?: { message?: string; code?: string; type?: string } | string;
  message?: string;
}

interface ZeroFallTaskStatus extends ZeroFallSubmitStatus {
  format?: string;
  metadata?: {
    duration?: number;
    fps?: number;
    height?: number;
    width?: number;
    seed?: number;
  };
  completed_at?: number;
  video_url?: string;
  url?: string;
  result_url?: string;
  fail_reason?: string;
  data?: ZeroFallTaskStatus;
}

function cleanBaseUrl(url: string): string {
  const v = url.trim().replace(/\/+$/, '');
  if (!v) return 'https://apib.ai';
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

function providerBaseUrls(): string[] {
  const s = useSettingsStore.getState();
  const urls = [s.omniBaseUrl, ...(s.omniFallbackBaseUrls ?? [])]
    .map(cleanBaseUrl)
    .filter(Boolean);
  return [...new Set(urls)];
}

function omniProviders(): OmniProvider[] {
  const s = useSettingsStore.getState();
  const zeroFallKey = resolveApiKey(s, 'omniZeroFall', s.omniZeroFallApiKey ?? '').trim();
  const omniKey = resolveApiKey(s, 'omni', s.omniApiKey ?? '').trim();
  const apimartKey = resolveApiKey(s, 'omniApimart', s.omniApimartApiKey ?? '').trim();
  const providers: OmniProvider[] = [];
  if (omniKey) {
    providers.push({
      kind: 'zexapi',
      baseUrl: OMNI_ZEXAPI_BASE_URL,
      model: OMNI_ZEX_MODEL,
      apiKey: omniKey,
    });
  }
  if (zeroFallKey) {
    providers.push({
      kind: 'zerofall',
      baseUrl: OMNI_ZEROFALL_BASE_URL,
      model: OMNI_ZEROFALL_MODEL,
      apiKey: zeroFallKey,
    });
  }
  const legacy = apimartKey
    ? providerBaseUrls()
      .filter((url) => !url.includes('zexapi.com'))
      .map<OmniProvider>((baseUrl) => ({
        kind: 'apimart',
        baseUrl,
        model: OMNI_MODEL,
        apiKey: apimartKey,
      }))
    : [];
  providers.push(...legacy);
  return providers;
}

function extFromPath(path: string): string {
  const clean = path.split('?')[0].split('#')[0];
  return clean.includes('.') ? clean.slice(clean.lastIndexOf('.') + 1).toLowerCase() : '';
}

function fileNameForOmni(path: string): string {
  const base = path.split('/').pop()?.split('?')[0]?.split('#')[0] || `omni-${Date.now()}`;
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function resolveOmniMediaUrl(ref: string, kind: 'image' | 'video'): Promise<string> {
  if (/^https?:\/\//i.test(ref) && !ref.startsWith('https://asset.localhost/')) return ref;
  const localPath = assetUrlToLocalPath(ref);
  const ext = extFromPath(localPath);
  const fileName = fileNameForOmni(localPath || `${kind}-${Date.now()}`);
  const contentType = kind === 'video' && ext === 'mov'
    ? 'video/mov'
    : kind === 'video' && ext === 'mp4'
      ? 'video/mp4'
      : undefined;
  return uploadToCos(localPath, fileName, contentType);
}

function unwrapVideoUrls(status: TaskStatus): string[] {
  const videos = status.data?.result?.videos ?? [];
  const urls: string[] = [];
  for (const item of videos) {
    if (Array.isArray(item.url)) urls.push(...item.url.filter(Boolean));
    else if (item.url) urls.push(item.url);
  }
  return urls;
}

async function submit(baseUrl: string, key: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  void baseUrl;
  let resp;
  try {
    resp = (await withApimartSubmitFailover(key, (activeBaseUrl) => (
      tauriFetch(`${activeBaseUrl}/v1/videos/generations`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: { type: 'Json', payload: body },
        responseType: ResponseType.JSON,
        timeout: 120,
      })
    ))).value;
  } catch (err) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (err instanceof ApimartAllRoutesConnectError) throw err;
    throw new PaidSubmissionUnknownError('APIMart Omni', err instanceof Error ? err.message : String(err));
  }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const data = resp.data as SubmitOk;
  if (!resp.ok || data.error) {
    if (!resp.ok && isAmbiguousPaidSubmitStatus(resp.status)) {
      throw new PaidSubmissionUnknownError('APIMart Omni', `HTTP ${resp.status}`);
    }
    throw new Error(data.error?.message || `Omni 提交失败 HTTP ${resp.status}`);
  }
  const taskId = data.data?.[0]?.task_id;
  if (!taskId) throw new PaidSubmissionUnknownError('APIMart Omni', `成功响应未返回 task_id：${JSON.stringify(data).slice(0, 300)}`);
  return taskId;
}

async function submitZex(baseUrl: string, key: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  let resp;
  try {
    resp = await tauriFetch(`${baseUrl}/v1/videos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: { type: 'Json', payload: body },
      responseType: ResponseType.JSON,
      timeout: 180,
    });
  } catch (err) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    throw new PaidSubmissionUnknownError('ZexAPI Omni', err instanceof Error ? err.message : String(err));
  }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const data = resp.data as ZexTaskStatus;
  if (!resp.ok || data?.code === 'insufficient_user_quota' || data?.error) {
    if (!resp.ok && isAmbiguousPaidSubmitStatus(resp.status)) {
      throw new PaidSubmissionUnknownError('ZexAPI Omni', `HTTP ${resp.status}`);
    }
    const err = typeof data?.error === 'string' ? data.error : data?.error?.message;
    throw new Error(err || data?.message || `ZexAPI Omni 提交失败 HTTP ${resp.status}`);
  }
  const taskId = data.id || data.task_id;
  if (!taskId) throw new PaidSubmissionUnknownError('ZexAPI Omni', `成功响应未返回 task_id：${JSON.stringify(data).slice(0, 300)}`);
  return taskId;
}

function zeroFallErrorMessage(respStatus: number, data: ZeroFallSubmitStatus | ZeroFallTaskStatus): string {
  const raw = typeof data?.error === 'string' ? data.error : data?.error?.message;
  const resultUrl = 'result_url' in data ? data.result_url : undefined;
  const failReason = 'fail_reason' in data ? data.fail_reason : undefined;
  const message = raw || failReason || (resultUrl && !/^https?:\/\//i.test(resultUrl) ? resultUrl : '') || data?.message || `ZeroFall Omni 请求失败 HTTP ${respStatus}`;
  if (respStatus === 400) {
    return `${message}。ZeroFall/Google Omni 的 400 通常表示提示词涉及违规、版权、真人身份/肖像等内容被 Google 拒绝，请弱化为抽象 MG、产品图形、图标和非真人表达后重试。`;
  }
  if (/PUBLIC_ERROR_VIDEO_EDIT|内容安全审核|Google|拒/i.test(message)) {
    return `${message}。这类 ZeroFall/Google Omni 失败通常与提示词、版权/真人内容或参考视频安全审核有关，请改成更抽象的 MG、UI、图标、图表和非真人表达后重试。`;
  }
  return message;
}

async function submitZeroFall(baseUrl: string, key: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  let resp;
  try {
    resp = await tauriFetch(`${baseUrl}/v1/video/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: { type: 'Json', payload: body },
      responseType: ResponseType.JSON,
      timeout: 180,
    });
  } catch (err) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    throw new PaidSubmissionUnknownError('ZeroFall Omni', err instanceof Error ? err.message : String(err));
  }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const data = resp.data as ZeroFallSubmitStatus;
  if (!resp.ok || data?.error) {
    if (!resp.ok && isAmbiguousPaidSubmitStatus(resp.status)) {
      throw new PaidSubmissionUnknownError('ZeroFall Omni', `HTTP ${resp.status}`);
    }
    throw new Error(zeroFallErrorMessage(resp.status, data));
  }
  const taskId = data.id || data.task_id;
  if (!taskId) throw new PaidSubmissionUnknownError('ZeroFall Omni', `成功响应未返回 task_id：${JSON.stringify(data).slice(0, 300)}`);
  return taskId;
}

function normalizeZeroFallStatus(data: ZeroFallTaskStatus): ZeroFallTaskStatus {
  if (data?.data && typeof data.data === 'object') {
    return { ...data.data, id: data.data.id || data.id, task_id: data.data.task_id || data.task_id };
  }
  return data;
}

async function poll(baseUrl: string, key: string, taskId: string, onProgress?: (message: string) => void, signal?: AbortSignal): Promise<TaskStatus> {
  void baseUrl;
  const started = Date.now();
  while (Date.now() - started < 20 * 60_000) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const resp = await withApimartGetFailover(key, (activeBaseUrl) => tauriFetch(`${activeBaseUrl}/v1/tasks/${encodeURIComponent(taskId)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
      responseType: ResponseType.JSON,
      timeout: 60,
    }).then((response) => {
      const body = response.data as TaskStatus;
      if (!response.ok || body.error) {
        throw new Error(body.error?.message || `Omni 查询失败 HTTP ${response.status}`);
      }
      return response;
    }));
    const data = resp.data as TaskStatus;
    const status = data.data?.status ?? 'unknown';
    const progress = data.data?.progress;
    onProgress?.(`Omni: ${status}${typeof progress === 'number' ? ` ${progress}%` : ''} · ${Math.round((Date.now() - started) / 1000)}s`);
    if (status === 'completed' || status === 'succeeded') return data;
    if (status === 'failed' || status === 'cancelled') {
      throw new Error(data.data?.error || data.data?.fail_reason || `Omni 任务失败: ${status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error('Omni 查询超时，远端任务可能仍在执行');
}

async function pollZeroFall(baseUrl: string, key: string, taskId: string, onProgress?: (message: string) => void, signal?: AbortSignal): Promise<ZeroFallTaskStatus> {
  const started = Date.now();
  while (Date.now() - started < 20 * 60_000) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const resp = await tauriFetch(`${baseUrl}/v1/video/generations/${encodeURIComponent(taskId)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
      responseType: ResponseType.JSON,
      timeout: 60,
    });
    const data = normalizeZeroFallStatus(resp.data as ZeroFallTaskStatus);
    if (!resp.ok || data?.error) {
      throw new Error(zeroFallErrorMessage(resp.status, data));
    }
    const statusRaw = data.status ?? 'unknown';
    const status = String(statusRaw).toLowerCase();
    const progress = data.progress;
    onProgress?.(`Omni(ZeroFall): ${statusRaw}${progress !== undefined ? ` ${progress}` : ''} · ${Math.round((Date.now() - started) / 1000)}s`);
    if (status === 'completed' || status === 'succeeded' || status === 'success') return data;
    if (status === 'failed' || status === 'failure' || status === 'cancelled' || status === 'canceled') {
      const err = typeof data.error === 'string' ? data.error : data.error?.message;
      throw new Error(err || zeroFallErrorMessage(200, data) || `ZeroFall Omni 任务失败: ${statusRaw}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error('ZeroFall Omni 查询超时，远端任务可能仍在执行');
}

async function pollZex(baseUrl: string, key: string, taskId: string, onProgress?: (message: string) => void, signal?: AbortSignal): Promise<ZexTaskStatus> {
  const started = Date.now();
  while (Date.now() - started < 20 * 60_000) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const resp = await tauriFetch(`${baseUrl}/v1/videos/${encodeURIComponent(taskId)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
      responseType: ResponseType.JSON,
      timeout: 60,
    });
    const data = resp.data as ZexTaskStatus;
    if (!resp.ok || data?.error) {
      const err = typeof data?.error === 'string' ? data.error : data?.error?.message;
      throw new Error(err || data?.message || `ZexAPI Omni 查询失败 HTTP ${resp.status}`);
    }
    const status = data.status ?? 'unknown';
    const progress = data.progress;
    onProgress?.(`Omni(ZexAPI): ${status}${typeof progress === 'number' ? ` ${progress}%` : ''} · ${Math.round((Date.now() - started) / 1000)}s`);
    if (status === 'completed' || status === 'succeeded') return data;
    if (status === 'failed' || status === 'cancelled' || status === 'canceled') {
      const err = typeof data.error === 'string' ? data.error : data.error?.message;
      throw new Error(err || `ZexAPI Omni 任务失败: ${status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error('ZexAPI Omni 查询超时，远端任务可能仍在执行');
}

async function downloadOmniVideo(url: string, namePrefix: string, onProgress?: (message: string) => void): Promise<string> {
  const workspace = await invoke<string>('ensure_workspace');
  const dir = `${workspace}/videos`;
  await createDir(dir, { recursive: true }).catch(() => {});
  onProgress?.('下载 Omni 视频…');
  const resp = await tauriFetch(url, {
    method: 'GET',
    responseType: ResponseType.Binary,
    timeout: 600,
  });
  if (!resp.ok) throw new Error(`Omni 视频下载失败 HTTP ${resp.status}`);
  const bytes = resp.data instanceof ArrayBuffer
    ? new Uint8Array(resp.data)
    : Array.isArray(resp.data)
      ? new Uint8Array(resp.data as number[])
      : resp.data instanceof Uint8Array
        ? resp.data
        : new Uint8Array();
  const path = `${dir}/${namePrefix}_${Date.now()}.mp4`;
  await writeBinaryFile(path, bytes);
  return path;
}

export async function runOmniGeneration(req: OmniGenerateRequest, signal?: AbortSignal): Promise<OmniGenerateResult> {
  const errors: string[] = [];
  let providers = omniProviders();
  if (providers.length === 0) {
    return {
      success: false,
      resultUrls: [],
      resultPaths: [],
      error: '请先在设置里填写 ZeroFall Omni API Key 或 Omni API Key',
    };
  }
  const apimartProvider = providers.find((provider) => provider.kind === 'apimart');
  if (apimartProvider) {
    try {
      const healthyBaseUrl = await resolveApimartBaseUrl(apimartProvider.apiKey);
      providers = [
        ...providers.filter((provider) => provider.kind !== 'apimart'),
        { ...apimartProvider, baseUrl: healthyBaseUrl },
      ];
    } catch (error) {
      providers = providers.filter((provider) => provider.kind !== 'apimart');
      if (providers.length === 0) {
        return {
          success: false,
          resultUrls: [],
          resultPaths: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }
  const imageUrls: string[] = [];
  const videoUrls: string[] = [];

  for (const url of req.imageUrls ?? []) {
    req.onProgress?.('上传 Omni 参考图到 COS…');
    imageUrls.push(await resolveOmniMediaUrl(url, 'image'));
  }
  for (const url of req.videoUrls ?? []) {
    req.onProgress?.('上传 Omni 参考视频到 COS…');
    videoUrls.push(await resolveOmniMediaUrl(url, 'video'));
  }

  const apimartBody: Record<string, unknown> = {
    model: OMNI_MODEL,
    prompt: req.prompt,
    aspect_ratio: req.aspectRatio ?? '16:9',
    resolution: req.resolution ?? '720p',
  };
  if (imageUrls.length > 0) apimartBody.image_urls = imageUrls;
  if (videoUrls.length > 0) apimartBody.video_urls = videoUrls.slice(0, 1);

  const zexBody: Record<string, unknown> = {
    model: OMNI_ZEX_MODEL,
    prompt: req.prompt,
    size: req.aspectRatio === '9:16' ? '720x1280' : '1280x720',
  };
  const zexRefs = [...imageUrls, ...videoUrls].slice(0, 7);
  if (zexRefs.length > 0) zexBody.images = zexRefs;

  const zeroFallHasVideo = videoUrls.length > 0;
  const zeroFallBody: Record<string, unknown> = {
    model: zeroFallHasVideo ? OMNI_ZEROFALL_MODEL : OMNI_ZEROFALL_TEXT_MODEL,
    prompt: req.prompt,
    duration: 10,
    aspect_ratio: req.aspectRatio === '9:16' ? 'portrait' : 'landscape',
    resolution: req.resolution ?? '720p',
  };
  if (zeroFallHasVideo) {
    zeroFallBody.video = videoUrls[0];
    zeroFallBody.images = imageUrls.slice(0, 5);
  } else if (imageUrls.length > 0) {
    zeroFallBody.images = imageUrls.slice(0, 7);
  }

  for (const provider of providers) {
    let taskId: string | undefined;
    try {
      req.onProgress?.(`提交 Omni 任务: ${provider.baseUrl}`);
      taskId = provider.kind === 'zerofall'
        ? await submitZeroFall(provider.baseUrl, provider.apiKey, zeroFallBody, signal)
        : provider.kind === 'zexapi'
          ? await submitZex(provider.baseUrl, provider.apiKey, zexBody, signal)
          : await submit(provider.baseUrl, provider.apiKey, apimartBody, signal);
      let resultUrls: string[];
      let creditsCost: number | undefined;
      let cost: number | undefined;
      if (provider.kind === 'zerofall') {
        const status = await pollZeroFall(provider.baseUrl, provider.apiKey, taskId, req.onProgress, signal);
        resultUrls = [status.url, status.video_url, status.result_url]
          .filter((url): url is string => Boolean(url) && /^https?:\/\//i.test(String(url)));
      } else if (provider.kind === 'zexapi') {
        const status = await pollZex(provider.baseUrl, provider.apiKey, taskId, req.onProgress, signal);
        resultUrls = [status.video_url].filter(Boolean) as string[];
      } else {
        const status = await poll(provider.baseUrl, provider.apiKey, taskId, req.onProgress, signal);
        resultUrls = unwrapVideoUrls(status);
        creditsCost = status.data?.credits_cost;
        cost = status.data?.cost;
      }
      if (resultUrls.length === 0) throw new Error('Omni 完成但没有返回视频 URL');
      const resultPaths: string[] = [];
      for (const url of resultUrls) {
        resultPaths.push(await downloadOmniVideo(url, req.taskLabel || 'omni-mg', req.onProgress));
      }
      for (const path of resultPaths) {
        void appendArtifact({
          path,
          type: 'video',
          engine: `${provider.baseUrl}/${provider.kind === 'zerofall' ? String(zeroFallBody.model) : provider.model}`,
          prompt: req.prompt,
          taskId,
        });
      }
      return {
        success: true,
        taskId,
        resultUrls,
        resultPaths,
        creditsCost,
        cost,
        baseUrl: provider.baseUrl,
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      if (shouldStopAutomaticPaidFallback(err, 'omni')) throw err;
      if (taskId) {
        errors.push(`${provider.baseUrl}（任务 ${taskId}）: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      errors.push(`${provider.baseUrl}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    success: false,
    resultUrls: [],
    resultPaths: [],
    error: errors.join('\n') || 'Omni 生成失败',
  };
}

export function localVideoUrl(path: string): string {
  return convertFileSrc(path);
}
