/**
 * 自定义媒体插件执行器：引擎 id `custom-media:{id}` → 按插件协议提交/轮询/下载。
 * 计费安全语义与 APIMart 通道对齐：提交阶段网络不明不自动重发
 * （PaidSubmissionUnknownError），远端 failed 终态视为未扣费可安全降级。
 */
import { fetch as tauriFetch, ResponseType, Body } from '@tauri-apps/api/http';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { useSettingsStore, type CustomMediaApi } from '@/stores/settingsStore';
import { resolveSlotApiKey } from '@/lib/credentials';
import { isAmbiguousPaidSubmitStatus, PaidSubmissionUnknownError, PaidTaskCreatedError } from '@/lib/billingSafety';
import { rhtvDownloadAll } from '@/lib/rhtv/download';
import { appendArtifact } from '@/lib/artifacts';
import { appendGenerationLog } from '@/lib/aigc/genLogger';
import { resolveApimartPublicMedia } from '@/lib/apimart/client';
import { parseApimartTask, apimartError } from '@/lib/apimart/contracts';
import {
  buildCustomImagePayload,
  buildCustomVideoPayload,
  customSubmitPath,
  customTaskPath,
  normalizeCustomBaseUrl,
  parseCustomTaskId,
  parseOpenaiImagesResponse,
} from './payload.ts';

export const CUSTOM_MEDIA_ENGINE_PREFIX = 'custom-media:';

export function isCustomMediaEngine(engineId: string): boolean {
  return engineId.startsWith(CUSTOM_MEDIA_ENGINE_PREFIX);
}

export function customMediaApiId(engineId: string): string {
  return engineId.slice(CUSTOM_MEDIA_ENGINE_PREFIX.length);
}

/** 查找启用的插件配置（按引擎 id）。 */
export function findCustomMediaApi(engineId: string): CustomMediaApi | undefined {
  if (!isCustomMediaEngine(engineId)) return undefined;
  const id = customMediaApiId(engineId);
  return (useSettingsStore.getState().customMediaApis ?? [])
    .find((api) => api.id === id && api.enabled);
}

function requireCustomKey(api: CustomMediaApi): string {
  const key = resolveSlotApiKey(useSettingsStore.getState(), api).trim();
  if (!key) throw new Error(`自定义插件「${api.label}」未配置 API Key，请在设置中填写`);
  return key;
}

export class CustomMediaTaskFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CustomMediaTaskFailedError';
  }
}

async function customSubmit(api: CustomMediaApi, payload: Record<string, unknown>, signal?: AbortSignal): Promise<{ taskId?: string; sync?: Record<string, unknown> }> {
  const key = requireCustomKey(api);
  const url = `${normalizeCustomBaseUrl(api.baseUrl)}${customSubmitPath(api)}`;
  let res;
  try {
    res = await tauriFetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: Body.json(payload),
      responseType: ResponseType.JSON,
      timeout: 180,
    });
  } catch (err) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    throw new PaidSubmissionUnknownError(api.label, err instanceof Error ? err.message : String(err));
  }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!res.ok) {
    const detail = apimartError(res.data) || `HTTP ${res.status}`;
    const taskId = parseCustomTaskId(res.data);
    if (taskId) throw new PaidTaskCreatedError(api.label, taskId, detail);
    if (isAmbiguousPaidSubmitStatus(res.status)) throw new PaidSubmissionUnknownError(api.label, detail);
    throw new Error(`${api.label} 提交失败：${detail}`);
  }
  if (api.protocol === 'openai-images') return { sync: res.data as Record<string, unknown> };
  const taskId = parseCustomTaskId(res.data);
  if (!taskId) {
    throw new PaidSubmissionUnknownError(api.label, `成功响应没有 task_id：${JSON.stringify(res.data).slice(0, 300)}`);
  }
  return { taskId };
}

async function customPollTask(
  api: CustomMediaApi,
  taskId: string,
  opts: { signal?: AbortSignal; onProgress?: (message: string) => void } = {},
): Promise<string[]> {
  const key = requireCustomKey(api);
  const base = normalizeCustomBaseUrl(api.baseUrl);
  const startedAt = Date.now();
  const maxMs = api.kind === 'video' ? 15 * 60_000 : 8 * 60_000;
  const intervalMs = 5_000;
  await new Promise((resolve) => setTimeout(resolve, 4_000));
  while (Date.now() - startedAt < maxMs) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const res = await tauriFetch(`${base}${customTaskPath(taskId)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
      responseType: ResponseType.JSON,
      timeout: 60,
    });
    if (!res.ok) {
      // 查询阶段瞬态失败：等待后重试（任务已在远端，绝不重发提交）
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      continue;
    }
    const state = parseApimartTask(res.data, api.kind === 'video' ? 'video' : 'image');
    if (state.status === 'succeeded') return state.urls;
    if (state.status === 'failed') throw new CustomMediaTaskFailedError(state.error || `${api.label} 任务失败`);
    opts.onProgress?.(`${state.status}${state.progress !== undefined ? ` ${Math.round(state.progress)}%` : ''} · ${Math.round((Date.now() - startedAt) / 1000)}s`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`${api.label} 任务超时: ${taskId}`);
}

export interface CustomMediaRunRequest {
  engineId: string;
  prompt: string;
  referenceUrls?: string[];
  videoUrls?: string[];
  audioUrls?: string[];
  params?: Record<string, unknown>;
  onProgress?: (phase: string) => void;
  signal?: AbortSignal;
}

export interface CustomMediaRunResult {
  taskId: string;
  resultPaths: string[];
  resultUrls: string[];
  providerTaskId?: string;
}

/** 执行自定义插件生成（不注册画布任务，由调用方负责）。 */
export async function runCustomMediaApi(req: CustomMediaRunRequest): Promise<CustomMediaRunResult> {
  const api = findCustomMediaApi(req.engineId);
  if (!api) {
    throw new Error(`未找到启用的自定义模型插件：${req.engineId}（可在设置 → 自定义模型插件中检查）`);
  }
  req.onProgress?.('上传参考素材…');
  const imageUrls: string[] = [];
  for (const ref of req.referenceUrls ?? []) {
    imageUrls.push(await resolveApimartPublicMedia(ref, imageUrls.length, () => {}));
  }
  const videoUrls: string[] = [];
  for (const ref of req.videoUrls ?? []) {
    videoUrls.push(await resolveApimartPublicMedia(ref, imageUrls.length + videoUrls.length, () => {}));
  }
  const audioUrls: string[] = [];
  for (const ref of req.audioUrls ?? []) {
    audioUrls.push(await resolveApimartPublicMedia(ref, imageUrls.length + videoUrls.length + audioUrls.length, () => {}));
  }

  const payload = api.kind === 'video'
    ? buildCustomVideoPayload(api, {
        prompt: req.prompt,
        imageUrls,
        videoUrls,
        audioUrls,
        duration: req.params?.duration,
        resolution: req.params?.resolution,
        aspectRatio: req.params?.ratio ?? req.params?.aspectRatio,
      })
    : buildCustomImagePayload(api, {
        prompt: req.prompt,
        imageUrls,
        size: typeof req.params?.size === 'string' ? req.params.size : undefined,
        aspectRatio: typeof req.params?.aspectRatio === 'string' ? req.params.aspectRatio : undefined,
        resolution: typeof req.params?.resolution === 'string' ? req.params.resolution : undefined,
      });

  req.onProgress?.(`提交${api.label}任务…`);
  const submitted = await customSubmit(api, payload, req.signal);

  let urls: string[];
  let providerTaskId: string | undefined;
  if (api.protocol === 'openai-images') {
    const parsed = parseOpenaiImagesResponse(submitted.sync);
    if (parsed.b64) {
      const { writeBinaryFile } = await import('@tauri-apps/api/fs');
      const { invoke } = await import('@tauri-apps/api/tauri');
      const workspace = await invoke<string>('ensure_workspace');
      const path = `${workspace}/images/custom-${Date.now()}.png`;
      const bin = atob(parsed.b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      await writeBinaryFile(path, bytes);
      const genLogRefs = imageUrls.map((source, i) => ({ index: i + 1, type: 'image' as const, source }));
      void appendGenerationLog({
        timestamp: new Date().toISOString(),
        director: '',
        taskType: imageUrls.length > 0 ? 'image-to-image' as never : 'text-to-image',
        engine: 'other',
        prompt: req.prompt,
        outputPath: path,
        outputPaths: [path],
        model: `custom-media/${api.modelId}`,
        taskId: '',
        params: req.params,
        refs: genLogRefs,
      });
      void appendArtifact({ path, type: 'image', engine: `custom-media/${api.modelId}`, prompt: req.prompt, taskId: '' });
      return { taskId: '', resultPaths: [path], resultUrls: [convertFileSrc(path)] };
    }
    if (!parsed.url) throw new Error(`${api.label} 同步响应中没有图片（b64_json/url 均为空）`);
    urls = [parsed.url];
  } else {
    providerTaskId = submitted.taskId!;
    req.onProgress?.('等待生成…');
    try {
      urls = await customPollTask(api, providerTaskId, {
        signal: req.signal,
        onProgress: (message) => req.onProgress?.(message),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      if (err instanceof CustomMediaTaskFailedError) throw err;
      throw new PaidTaskCreatedError(api.label, providerTaskId, err instanceof Error ? err.message : String(err));
    }
  }

  if (urls.length === 0) throw new Error(`${api.label} 生成完成但没有输出文件`);
  req.onProgress?.('下载产物…');
  const kind = api.kind === 'video' ? 'video' : 'image';
  const resultPaths = await rhtvDownloadAll(urls, kind, `custom-media-${api.id}`, req.onProgress);
  for (const p of resultPaths) {
    void appendArtifact({ path: p, type: kind, engine: `custom-media/${api.modelId}`, prompt: req.prompt, taskId: providerTaskId ?? '' });
  }
  void appendGenerationLog({
    timestamp: new Date().toISOString(),
    director: '',
    taskType: kind === 'video'
      ? (imageUrls.length > 0 || videoUrls.length > 0 ? 'image-to-video' : 'text-to-video')
      : 'text-to-image',
    engine: 'other',
    prompt: req.prompt,
    outputPath: resultPaths[0],
    outputPaths: resultPaths,
    model: `custom-media/${api.modelId}`,
    taskId: providerTaskId ?? '',
    params: req.params,
    refs: [
      ...imageUrls.map((source, i) => ({ index: i + 1, type: 'image' as const, source })),
      ...videoUrls.map((source, i) => ({ index: i + 1, type: 'video' as const, source })),
      ...audioUrls.map((source, i) => ({ index: i + 1, type: 'audio' as const, source })),
    ],
  });
  return { taskId: providerTaskId ?? '', resultPaths, resultUrls: resultPaths.map((p) => convertFileSrc(p)), providerTaskId };
}
