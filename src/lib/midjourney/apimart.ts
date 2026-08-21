import { fetch as tauriFetch, ResponseType } from '@tauri-apps/api/http';
import { uploadToCos } from '@/lib/cos';
import { assetUrlToLocalPath } from '@/lib/rhtv/upload';
import { rhtvDownloadAll } from '@/lib/rhtv/download';
import { useSettingsStore } from '@/stores/settingsStore';
import { resolveApiKey } from '@/lib/credentials';
import { withApimartGetFailover, withApimartSubmitFailover } from '@/lib/apimart/baseUrl';
import {
  buildApimartMidjourneyPrompt,
  type MidjourneyPromptInput,
} from './prompt';

export {
  buildApimartMidjourneyPrompt,
  MIDJOURNEY_VERSIONS,
  normalizeMidjourneyVersion,
  type MidjourneyVersion,
} from './prompt';

export const APIMART_MIDJOURNEY_ENDPOINT = 'apimart/midjourney/generations';

export interface ApimartMidjourneyRequest extends MidjourneyPromptInput {
  referenceUrls?: string[];
  styleReferenceUrls?: string[];
  aspectRatio?: string;
  stylize?: number;
  chaos?: number;
  raw?: boolean;
  quality?: string | number;
  speed?: 'relax' | 'fast' | 'turbo';
  signal?: AbortSignal;
  onSubmitted?: (taskId: string) => void;
  onProgress?: (message: string) => void;
}

export interface ApimartMidjourneyTaskStatus {
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  progress?: number;
  urls: string[];
  error?: string;
}

export interface ApimartMidjourneyResult {
  taskId: string;
  urls: string[];
  paths: string[];
}

export class ApimartMidjourneyTaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApimartMidjourneyTaskError';
  }
}

function apiKey(): string {
  const s = useSettingsStore.getState();
  return resolveApiKey(s, 'omniApimart', s.omniApimartApiKey).trim();
}

export function hasApimartMidjourneyKey(): boolean {
  return Boolean(apiKey());
}

function safeFileName(source: string, index: number): string {
  const fromPath = source.split('?')[0].split('#')[0].split('/').pop() || `reference-${index + 1}.png`;
  const clean = fromPath.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${Date.now()}-${index + 1}-${clean || 'reference.png'}`;
}

async function resolveReferenceUrl(source: string, index: number): Promise<string> {
  if (/^https?:\/\//i.test(source) && !source.startsWith('https://asset.localhost/')) return source;
  if (/^data:image\//i.test(source)) {
    throw new Error('APIMart Midjourney 暂不直接接收画布内的 Base64 参考图，请先将图片保存为资产后重试。');
  }
  const localPath = assetUrlToLocalPath(source);
  return uploadToCos(localPath, safeFileName(localPath, index));
}

function taskIdFrom(body: unknown): string {
  const root = body as Record<string, unknown> | undefined;
  const rawData = root?.data;
  const data = Array.isArray(rawData) ? rawData[0] : rawData;
  const item = data && typeof data === 'object' ? data as Record<string, unknown> : undefined;
  return String(item?.task_id ?? item?.taskId ?? item?.id ?? root?.task_id ?? root?.taskId ?? root?.id ?? '').trim();
}

function errorFrom(body: unknown): string {
  const root = body as Record<string, unknown> | undefined;
  const error = root?.error;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const item = error as Record<string, unknown>;
    return String(item.message ?? item.error ?? '');
  }
  const data = root?.data;
  const item = data && !Array.isArray(data) && typeof data === 'object' ? data as Record<string, unknown> : undefined;
  return String(item?.fail_reason ?? item?.error ?? root?.fail_reason ?? root?.message ?? '').trim();
}

function collectResultUrls(body: unknown): string[] {
  const found: string[] = [];
  const visit = (value: unknown, key = '') => {
    if (typeof value === 'string') {
      if (/^https?:\/\//i.test(value) && /(?:url|image|output|result|file)/i.test(key)) found.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, key));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
      if (/^(result|results|images?|outputs?|files?|urls?|url|output_url|image_url)$/i.test(childKey) || /result|image|output|file|url/i.test(key)) {
        visit(child, childKey);
      }
    }
  };
  visit(body, 'result');
  return [...new Set(found)];
}

function statusFrom(body: unknown): ApimartMidjourneyTaskStatus {
  const root = body as Record<string, unknown> | undefined;
  const rawData = root?.data;
  const data = Array.isArray(rawData) ? rawData[0] : rawData;
  const item = data && typeof data === 'object' ? data as Record<string, unknown> : root;
  const raw = String(item?.status ?? root?.status ?? '').toLowerCase();
  const urls = collectResultUrls(body);
  const error = errorFrom(body);
  const progressValue = Number(item?.progress ?? root?.progress);
  const progress = Number.isFinite(progressValue) ? progressValue : undefined;
  if (['completed', 'succeeded', 'success'].includes(raw)) {
    return urls.length > 0
      ? { status: 'succeeded', progress: 100, urls }
      : { status: 'failed', progress: 100, urls: [], error: error || 'APIMart Midjourney 已完成但没有返回图片' };
  }
  if (['failed', 'failure', 'cancelled', 'canceled', 'error'].includes(raw)) {
    return { status: 'failed', progress, urls: [], error: error || 'APIMart Midjourney 任务失败' };
  }
  return { status: ['pending', 'submitted', 'created', 'queued'].includes(raw) ? 'pending' : 'running', progress, urls: [] };
}

export async function submitApimartMidjourney(input: ApimartMidjourneyRequest): Promise<string> {
  const key = apiKey();
  if (!key) throw new Error('未配置 APIMart API Key，请在设置 > Omni MG > APIMart 中填写。');
  const references = await Promise.all((input.referenceUrls ?? []).slice(0, 10).map(resolveReferenceUrl));
  const styleReferences = await Promise.all((input.styleReferenceUrls ?? []).slice(0, 1).map((source, index) => resolveReferenceUrl(source, index + references.length)));
  const prompt = buildApimartMidjourneyPrompt({ ...input, styleReferenceUrls: styleReferences }, references);
  const response = (await withApimartSubmitFailover(key, (baseUrl) => (
    tauriFetch(`${baseUrl}/v1/midjourney/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: { type: 'Json', payload: { prompt, speed: input.speed ?? 'relax' } },
      responseType: ResponseType.JSON,
      timeout: 120,
    })
  ))).value;
  if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const taskId = taskIdFrom(response.data);
  if (!response.ok || !taskId) {
    throw new Error(errorFrom(response.data) || `APIMart Midjourney 提交失败 HTTP ${response.status}${taskId ? '' : '（未返回 task_id）'}`);
  }
  input.onSubmitted?.(taskId);
  return taskId;
}

export async function queryApimartMidjourneyTask(taskId: string): Promise<ApimartMidjourneyTaskStatus> {
  const key = apiKey();
  if (!key) throw new Error('未配置 APIMart API Key，无法恢复 Midjourney 任务。');
  return withApimartGetFailover(key, async (baseUrl) => {
    const response = await tauriFetch(`${baseUrl}/v1/tasks/${encodeURIComponent(taskId)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
      responseType: ResponseType.JSON,
      timeout: 60,
    });
    if (!response.ok) throw new Error(errorFrom(response.data) || `APIMart 任务查询失败 HTTP ${response.status}`);
    return statusFrom(response.data);
  });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

export async function runApimartMidjourney(input: ApimartMidjourneyRequest): Promise<ApimartMidjourneyResult> {
  const taskId = await submitApimartMidjourney(input);
  const startedAt = Date.now();
  await sleep(4_000, input.signal);
  while (Date.now() - startedAt < 30 * 60_000) {
    if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const state = await queryApimartMidjourneyTask(taskId);
    if (state.status === 'failed') throw new ApimartMidjourneyTaskError(state.error || 'APIMart Midjourney 任务失败');
    if (state.status === 'succeeded') {
      input.onProgress?.(`生成完成，下载 ${state.urls.length} 张图片…`);
      const paths = await rhtvDownloadAll(state.urls, 'image', 'apimart-midjourney', input.onProgress);
      return { taskId, urls: state.urls, paths };
    }
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    input.onProgress?.(`${state.status === 'pending' ? '排队中' : '生成中'}${state.progress !== undefined ? ` ${state.progress}%` : ''} · ${elapsed}s`);
    await sleep(4_000, input.signal);
  }
  throw new Error('APIMart Midjourney 轮询超过 30 分钟，任务仍可在后台恢复。');
}
