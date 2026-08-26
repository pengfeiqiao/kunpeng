import { fitSeedreamProPixelSize } from '../imageGen/size.ts';

export type ApimartTaskKind = 'image' | 'video' | 'music';

export const APIMART_SEEDREAM_SLOT_ID = 'apimart-seedream-v5-pro';
export const APIMART_GPT_IMAGE2_SLOT_ID = 'apimart-gpt-image-2';
export const APIMART_GPT_IMAGE2_ENDPOINT = 'apimart/gpt-image-2';
export const APIMART_SUNO_ENDPOINT = 'apimart/suno';

export const APIMART_SUNO_VERSIONS = ['v3.5', 'v4', 'v4.5', 'v4.5+', 'v4.5-all', 'v5', 'v5.5'] as const;
export type ApimartSunoVersion = (typeof APIMART_SUNO_VERSIONS)[number];

/**
 * Suno 生成（/v1/music/generations，异步任务，docs.apib.ai/audios/suno）。
 * custom=false 灵感模式：prompt 作灵感描述，style/title 等自定义字段被静默忽略；
 * custom=true 自定义模式：prompt 作歌词，style/negative_tags/权重字段生效。
 * version 两种模式都必填（不传 400）。
 */
export function buildApimartSunoPayload(input: {
  prompt: string;
  custom?: boolean;
  instrumental?: boolean;
  version?: string;
  title?: string;
  style?: string;
  negativeTags?: string;
  autoLyrics?: boolean;
  vocalGender?: 'Male' | 'Female';
  styleWeight?: number;
  weirdnessConstraint?: number;
  audioWeight?: number;
}): Record<string, unknown> {
  const custom = input.custom ?? true;
  const version = APIMART_SUNO_VERSIONS.includes(input.version as ApimartSunoVersion)
    ? input.version as string
    : 'v5';
  if (!input.prompt.trim() && !(custom && input.instrumental)) {
    throw new Error(custom && input.instrumental
      ? 'Suno 提示词不能为空'
      : 'Suno 歌词/灵感提示词不能为空');
  }
  const payload: Record<string, unknown> = {
    model: 'suno',
    custom,
    instrumental: input.instrumental ?? false,
    version,
    prompt: input.prompt,
  };
  if (custom) {
    if (input.title?.trim()) payload.title = input.title.trim();
    if (input.style?.trim()) payload.style = input.style.trim();
    if (input.negativeTags?.trim()) payload.negative_tags = input.negativeTags.trim();
    if (input.autoLyrics !== undefined) payload.auto_lyrics = input.autoLyrics;
    if (typeof input.styleWeight === 'number') payload.style_weight = input.styleWeight;
    if (typeof input.weirdnessConstraint === 'number') payload.weirdness_constraint = input.weirdnessConstraint;
    if (typeof input.audioWeight === 'number') payload.audio_weight = input.audioWeight;
  }
  if (input.vocalGender) payload.vocal_gender = input.vocalGender;
  return payload;
}

export interface ApimartTaskState {
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  progress?: number;
  urls: string[];
  error?: string;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function taskData(body: unknown): Record<string, unknown> | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const root = body as Record<string, unknown>;
  const raw = root.data;
  if (Array.isArray(raw)) {
    const first = raw[0];
    return first && typeof first === 'object' ? first as Record<string, unknown> : undefined;
  }
  return raw && typeof raw === 'object' ? raw as Record<string, unknown> : root;
}

export function apimartTaskId(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const root = body as Record<string, unknown>;
  const data = taskData(body);
  return stringValue(data?.task_id ?? data?.taskId ?? data?.id ?? root.task_id ?? root.taskId ?? root.id);
}

export function apimartError(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const root = body as Record<string, unknown>;
  const error = root.error;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const item = error as Record<string, unknown>;
    const message = stringValue(item.message ?? item.error);
    if (message) return message;
  }
  const data = taskData(body);
  return stringValue(
    data?.fail_reason ?? data?.failed_reason ?? data?.error_message ?? data?.error
      ?? root.fail_reason ?? root.failed_reason ?? root.message,
  );
}

function collectUrls(value: unknown, output: string[]): void {
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value)) output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectUrls(item, output));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    if (/^(url|urls|images?|videos?|files?|outputs?|results?|results?|output_url|image_url|video_url|audio_url|music)$/i.test(key)) {
      collectUrls(child, output);
    } else if (key === 'result') {
      collectUrls(child, output);
    }
  }
}

export function parseApimartTask(body: unknown, kind: ApimartTaskKind): ApimartTaskState {
  const root = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const data = taskData(body) ?? root;
  const rawStatus = stringValue(data.status ?? root.status).toLowerCase();
  const found: string[] = [];
  collectUrls(data.result ?? root.result, found);
  // APIMart output links are signed and do not always retain a file suffix.
  // The queried model already determines the output kind, so extension-based
  // filtering would incorrectly discard valid CDN results.
  const urls = [...new Set(found)];
  const progressValue = Number(data.progress ?? root.progress);
  const progress = Number.isFinite(progressValue) ? progressValue : undefined;
  const error = apimartError(body);

  if (['success', 'succeeded', 'completed'].includes(rawStatus)) {
    return urls.length > 0
      ? { status: 'succeeded', progress: 100, urls }
      : { status: 'failed', progress: 100, urls: [], error: error || `APIMart ${kind === 'video' ? '视频' : kind === 'music' ? '音乐' : '图片'}任务已完成但没有返回产物` };
  }
  if (['failed', 'failure', 'cancelled', 'canceled', 'error'].includes(rawStatus)) {
    return { status: 'failed', progress, urls: [], error: error || 'APIMart 任务失败' };
  }
  return {
    status: ['pending', 'submitted', 'created', 'queued'].includes(rawStatus) ? 'pending' : 'running',
    progress,
    urls: [],
  };
}

const SEEDREAM_RATIOS = new Set(['auto', '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9']);
const H3_RATIOS = new Set(['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16']);
// APIMart GPT-Image-2 支持的 15 种比例（docs.apimart.ai GPT-Image-2 文档）。
const GPT_IMAGE2_RATIOS = new Set([
  'auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5',
  '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21',
]);

/**
 * APIMart GPT-Image-2（/v1/images/generations，异步任务）。
 * size 直接吃比例字符串；resolution 只有 1k/2k/4k 三档（按档计费）；
 * 参考图最多 16 张，URL 与 base64 data URI 可混填。
 */
export function buildApimartGptImage2Payload(input: {
  prompt: string;
  imageUrls?: string[];
  size?: string;
  aspectRatio?: string;
  resolution?: string;
}): Record<string, unknown> {
  if ((input.imageUrls?.length ?? 0) > 16) {
    throw new Error(`APIMart GPT-Image-2 最多支持 16 张参考图，当前 ${input.imageUrls!.length} 张。`);
  }
  const requestedSize = String(input.size || input.aspectRatio || 'auto');
  const size = GPT_IMAGE2_RATIOS.has(requestedSize) || /^\d{3,5}x\d{3,5}$/i.test(requestedSize)
    ? requestedSize
    : 'auto';
  const resolutionRaw = String(input.resolution || '2k').toLowerCase();
  const resolution = ['1k', '2k', '4k'].includes(resolutionRaw)
    ? resolutionRaw
    : resolutionRaw === '8k' ? '4k' : '2k';
  const payload: Record<string, unknown> = {
    model: 'gpt-image-2',
    prompt: input.prompt,
    n: 1,
    size,
    resolution,
  };
  if (input.imageUrls?.length) payload.image_urls = input.imageUrls;
  return payload;
}

export function buildApimartSeedreamPayload(input: {
  prompt: string;
  imageUrls?: string[];
  size?: string;
  aspectRatio?: string;
  resolution?: string;
  outputFormat?: string;
}): Record<string, unknown> {
  if ((input.imageUrls?.length ?? 0) > 10) {
    throw new Error(`Seedream 5 Pro 最多支持 10 张参考图，当前 ${input.imageUrls!.length} 张。`);
  }
  const resolutionRaw = String(input.resolution || '2K').toUpperCase();
  const resolution = ['1K', '1.5K', '2K'].includes(resolutionRaw) ? resolutionRaw : '2K';
  const requestedSize = String(input.size || input.aspectRatio || 'auto');
  // 像素尺寸受渠道总像素上限约束：轻缩则缩，缩太狠退回 auto
  // （由 resolution 档位决定输出档位，比例交给模型）。
  const fittedSize = fitSeedreamProPixelSize(requestedSize);
  const size = SEEDREAM_RATIOS.has(requestedSize)
    ? requestedSize
    : (fittedSize && /^\d{3,5}x\d{3,5}$/i.test(fittedSize) ? fittedSize : 'auto');
  const payload: Record<string, unknown> = {
    model: 'seedream-5-0-pro',
    prompt: input.prompt,
    n: 1,
    resolution,
    size,
    output_format: String(input.outputFormat || 'jpeg').toLowerCase() === 'png' ? 'png' : 'jpeg',
    watermark: false,
  };
  if (input.imageUrls?.length) payload.image_urls = input.imageUrls;
  return payload;
}

export function buildApimartMinimaxH3Payload(input: {
  prompt: string;
  imageUrls?: string[];
  videoUrls?: string[];
  audioUrls?: string[];
  duration?: string | number;
  resolution?: string;
  aspectRatio?: string;
}): Record<string, unknown> {
  if ((input.imageUrls?.length ?? 0) > 9) {
    throw new Error(`MiniMax H3 最多支持 9 张参考图，当前 ${input.imageUrls!.length} 张。`);
  }
  if ((input.videoUrls?.length ?? 0) > 3) {
    throw new Error(`MiniMax H3 最多支持 3 段参考视频，当前 ${input.videoUrls!.length} 段。`);
  }
  if ((input.audioUrls?.length ?? 0) > 3) {
    throw new Error(`MiniMax H3 最多支持 3 段参考音频，当前 ${input.audioUrls!.length} 段。`);
  }
  const durationValue = Math.round(Number(input.duration ?? 5));
  const duration = Number.isFinite(durationValue) ? Math.min(15, Math.max(5, durationValue)) : 5;
  const resolution = String(input.resolution || '2K').toUpperCase() === '768P' ? '768P' : '2K';
  const requestedRatio = String(input.aspectRatio || 'adaptive');
  const aspectRatio = H3_RATIOS.has(requestedRatio) ? requestedRatio : 'adaptive';
  const imageUrls = input.imageUrls ?? [];
  const videoUrls = input.videoUrls ?? [];
  const audioUrls = input.audioUrls ?? [];
  if (audioUrls.length > 0 && imageUrls.length === 0 && videoUrls.length === 0) {
    throw new Error('MiniMax H3 不能只传音频，至少还需要一张参考图或一段参考视频。');
  }
  const payload: Record<string, unknown> = {
    model: 'MiniMax-H3',
    prompt: input.prompt,
    duration,
    resolution,
    aspect_ratio: aspectRatio,
  };
  if (imageUrls.length) payload.image_urls = imageUrls;
  if (videoUrls.length) payload.video_urls = videoUrls;
  if (audioUrls.length) payload.audio_urls = audioUrls;
  return payload;
}

const WAN3_RATIOS = new Set(['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16']);

/**
 * APIMart 万相 3.0（wan3.0-video，/v1/videos/generations，异步任务）。
 * 素材统一走参考族：有任意素材时显式 generation_type=reference，
 * 避免裸 image_urls 被默认归到首尾帧族（图1=首帧、图2=尾帧）。
 * file_url 与 link_url 互斥；duration 2-30 或 -1（模型决定）。
 */
export function buildApimartWan3Payload(input: {
  prompt: string;
  imageUrls?: string[];
  videoUrls?: string[];
  audioUrls?: string[];
  fileUrl?: string;
  linkUrl?: string;
  duration?: string | number;
  resolution?: string;
  aspectRatio?: string;
  audio?: boolean;
}): Record<string, unknown> {
  const imageUrls = input.imageUrls ?? [];
  const videoUrls = input.videoUrls ?? [];
  const audioUrls = input.audioUrls ?? [];
  if (imageUrls.length > 10) throw new Error(`万相 3.0 最多支持 10 张参考图，当前 ${imageUrls.length} 张。`);
  if (videoUrls.length > 5) throw new Error(`万相 3.0 最多支持 5 段参考视频，当前 ${videoUrls.length} 段。`);
  if (audioUrls.length > 5) throw new Error(`万相 3.0 最多支持 5 段参考音频，当前 ${audioUrls.length} 段。`);
  if (input.fileUrl && input.linkUrl) throw new Error('万相 3.0 的文档（file_url）与网页链接（link_url）互斥，只能传一个。');
  if (!input.prompt.trim() && imageUrls.length + videoUrls.length + audioUrls.length === 0 && !input.fileUrl && !input.linkUrl) {
    throw new Error('万相 3.0 要求 prompt 与素材至少提供其一。');
  }

  const rawDuration = Math.round(Number(input.duration ?? 5));
  const duration = rawDuration === -1 ? -1 : Number.isFinite(rawDuration) ? Math.min(30, Math.max(2, rawDuration)) : 5;
  const resolutionRaw = String(input.resolution || '1080P').toUpperCase();
  const resolution = ['480P', '720P', '1080P'].includes(resolutionRaw) ? resolutionRaw : '1080P';
  const requestedSize = String(input.aspectRatio || 'adaptive');
  const size = WAN3_RATIOS.has(requestedSize) ? requestedSize : 'adaptive';

  const hasMedia = imageUrls.length + videoUrls.length + audioUrls.length > 0 || input.fileUrl || input.linkUrl;
  const payload: Record<string, unknown> = {
    model: 'wan3.0-video',
    prompt: input.prompt,
    duration,
    resolution,
    size,
    audio: input.audio !== false,
  };
  if (hasMedia) payload.generation_type = 'reference';
  if (imageUrls.length) payload.image_urls = imageUrls;
  if (videoUrls.length) payload.video_urls = videoUrls;
  if (audioUrls.length) payload.audio_urls = audioUrls;
  if (input.fileUrl) payload.file_url = input.fileUrl;
  if (input.linkUrl) payload.link_url = input.linkUrl;
  return payload;
}
