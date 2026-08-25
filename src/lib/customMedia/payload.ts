/**
 * 自定义媒体插件的请求构造（纯函数，便于单测）。
 * 协议说明见 settingsStore.CustomMediaApi 注释。
 */
import type { CustomMediaApi } from '@/stores/settingsStore';

export function normalizeCustomBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

/** 提交路径：异步协议按 kind 区分 images/videos；openai-images 固定 images。 */
export function customSubmitPath(api: Pick<CustomMediaApi, 'kind' | 'protocol'>): string {
  if (api.protocol === 'openai-images') return '/v1/images/generations';
  return api.kind === 'video' ? '/v1/videos/generations' : '/v1/images/generations';
}

export function customTaskPath(taskId: string): string {
  return `/v1/tasks/${encodeURIComponent(taskId)}`;
}

const IMAGE_RATIOS = new Set([
  'auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5',
  '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21',
]);

/** 图片插件 payload（openai-images 同步与 apimart-async 异步同构）。 */
export function buildCustomImagePayload(
  api: Pick<CustomMediaApi, 'modelId'>,
  input: {
    prompt: string;
    imageUrls?: string[];
    size?: string;
    aspectRatio?: string;
    resolution?: string;
  },
): Record<string, unknown> {
  const requestedSize = String(input.size || input.aspectRatio || 'auto');
  const size = IMAGE_RATIOS.has(requestedSize) || /^\d{3,5}x\d{3,5}$/i.test(requestedSize)
    ? requestedSize
    : 'auto';
  const payload: Record<string, unknown> = {
    model: api.modelId,
    prompt: input.prompt,
    n: 1,
    size,
  };
  const resolution = String(input.resolution || '').trim();
  if (resolution) payload.resolution = resolution;
  if (input.imageUrls?.length) payload.image_urls = input.imageUrls;
  return payload;
}

const VIDEO_RATIOS = new Set(['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9']);

/** 视频插件 payload（apimart-async 异步任务协议）。 */
export function buildCustomVideoPayload(
  api: Pick<CustomMediaApi, 'modelId'>,
  input: {
    prompt: string;
    imageUrls?: string[];
    videoUrls?: string[];
    audioUrls?: string[];
    duration?: unknown;
    resolution?: unknown;
    aspectRatio?: unknown;
  },
): Record<string, unknown> {
  const rawDuration = Math.round(Number(input.duration ?? 5));
  const duration = Number.isFinite(rawDuration) ? Math.min(30, Math.max(2, rawDuration)) : 5;
  const resolution = String(input.resolution || '720P').trim() || '720P';
  const requestedRatio = String(input.aspectRatio || 'adaptive');
  const size = VIDEO_RATIOS.has(requestedRatio) ? requestedRatio : 'adaptive';
  const payload: Record<string, unknown> = {
    model: api.modelId,
    prompt: input.prompt,
    duration,
    resolution,
    size,
  };
  if (input.imageUrls?.length) payload.image_urls = input.imageUrls;
  if (input.videoUrls?.length) payload.video_urls = input.videoUrls;
  if (input.audioUrls?.length) payload.audio_urls = input.audioUrls;
  return payload;
}

/** 从同步 OpenAI Images 响应提取图片（b64_json 或 url）。 */
export function parseOpenaiImagesResponse(body: unknown): { b64?: string; url?: string } {
  const root = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const data = Array.isArray(root.data) ? root.data as Array<Record<string, unknown>> : [];
  const first = data[0] ?? {};
  const b64 = typeof first.b64_json === 'string' && first.b64_json ? first.b64_json : undefined;
  const url = typeof first.url === 'string' && first.url ? first.url : undefined;
  return { b64, url };
}

/** 从异步任务提交响应提取 task_id（{data:[{task_id}]} 或 {data:{task_id}} 或顶层）。 */
export function parseCustomTaskId(body: unknown): string {
  const root = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const data = root.data;
  if (Array.isArray(data)) {
    const first = data[0] as Record<string, unknown> | undefined;
    if (first && typeof first.task_id === 'string' && first.task_id) return first.task_id;
  }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (typeof obj.task_id === 'string' && obj.task_id) return obj.task_id;
    if (typeof obj.id === 'string' && obj.id) return obj.id;
  }
  if (typeof root.task_id === 'string' && root.task_id) return root.task_id;
  return '';
}
