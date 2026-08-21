export type ApimartTaskKind = 'image' | 'video';

export const APIMART_SEEDREAM_SLOT_ID = 'apimart-seedream-v5-pro';

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
    if (/^(url|urls|images?|videos?|files?|outputs?|results?|output_url|image_url|video_url)$/i.test(key)) {
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
      : { status: 'failed', progress: 100, urls: [], error: error || `APIMart ${kind === 'video' ? '视频' : '图片'}任务已完成但没有返回产物` };
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
  const size = SEEDREAM_RATIOS.has(requestedSize) || /^\d{3,5}x\d{3,5}$/i.test(requestedSize)
    ? requestedSize
    : 'auto';
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
  const duration = Number.isFinite(durationValue) ? Math.min(15, Math.max(4, durationValue)) : 5;
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
