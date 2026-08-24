import { fetch as tauriFetch, ResponseType } from '@tauri-apps/api/http';
import { createDir, removeFile, writeBinaryFile } from '@tauri-apps/api/fs';
import { homeDir } from '@tauri-apps/api/path';
import { uploadToCos } from '@/lib/cos';
import { assetUrlToLocalPath } from '@/lib/rhtv/upload';
import { useSettingsStore } from '@/stores/settingsStore';
import { resolveApiKey } from '@/lib/credentials';
import {
  PaidSubmissionUnknownError,
  PaidTaskCreatedError,
  isAmbiguousPaidSubmitStatus,
} from '@/lib/billingSafety';
import {
  apimartError,
  apimartTaskId,
  parseApimartTask,
  type ApimartTaskKind,
  type ApimartTaskState,
} from './contracts';
import {
  ApimartAllRoutesConnectError,
  withApimartGetFailover,
  withApimartSubmitFailover,
} from './baseUrl';

export { APIMART_BASE_URL } from './baseUrl';
export const APIMART_SEEDREAM_ENDPOINT = 'apimart/seedream-5-0-pro';
export const APIMART_MINIMAX_H3_ENDPOINT = 'apimart/minimax-h3';
export const APIMART_WAN3_ENDPOINT = 'apimart/wan-3.0';

export class ApimartTaskFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApimartTaskFailedError';
  }
}

export function getApimartApiKey(): string {
  const s = useSettingsStore.getState();
  return resolveApiKey(s, 'omniApimart', s.omniApimartApiKey).trim();
}

export function hasApimartApiKey(): boolean {
  return Boolean(getApimartApiKey());
}

function requireKey(): string {
  const key = getApimartApiKey();
  if (!key) throw new Error('未配置 APIMart API Key，请在设置 > API 密钥 > APIMart 中填写。');
  return key;
}

export async function submitApimartTask(input: {
  path: '/v1/images/generations' | '/v1/videos/generations' | '/v1/music/generations';
  payload: Record<string, unknown>;
  label: string;
  signal?: AbortSignal;
}): Promise<string> {
  const key = requireKey();
  if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  // Probe with a read-only request first. If every route is unreachable, no
  // paid submission was attempted and the error must not imply a possible charge.
  let response;
  try {
    response = (await withApimartSubmitFailover(key, (baseUrl) => (
      tauriFetch(`${baseUrl}${input.path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: { type: 'Json', payload: input.payload },
        responseType: ResponseType.JSON,
        timeout: 180,
      })
    ))).value;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    if (error instanceof ApimartAllRoutesConnectError) throw error;
    throw new PaidSubmissionUnknownError(input.label, error instanceof Error ? error.message : String(error));
  }
  if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const taskId = apimartTaskId(response.data);
  if (!response.ok) {
    const detail = apimartError(response.data) || `HTTP ${response.status}`;
    if (taskId) throw new PaidTaskCreatedError(input.label, taskId, detail);
    if (isAmbiguousPaidSubmitStatus(response.status)) throw new PaidSubmissionUnknownError(input.label, detail);
    throw new Error(`${input.label} 提交失败：${detail}`);
  }
  if (!taskId) {
    throw new PaidSubmissionUnknownError(input.label, `成功响应没有 task_id：${JSON.stringify(response.data).slice(0, 300)}`);
  }
  return taskId;
}

export async function queryApimartTask(taskId: string, kind: ApimartTaskKind): Promise<ApimartTaskState> {
  const key = requireKey();
  // Suno 音乐任务走独立查询路由 /v1/music/tasks/{id}，其余走 /v1/tasks/{id}。
  const taskPath = kind === 'music' ? `/v1/music/tasks/` : `/v1/tasks/`;
  return withApimartGetFailover(key, async (baseUrl) => {
    const response = await tauriFetch(`${baseUrl}${taskPath}${encodeURIComponent(taskId)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
      responseType: ResponseType.JSON,
      timeout: 60,
    });
    if (!response.ok) throw new Error(apimartError(response.data) || `APIMart 查询失败 HTTP ${response.status}`);
    return parseApimartTask(response.data, kind);
  });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

export async function pollApimartTask(input: {
  taskId: string;
  kind: ApimartTaskKind;
  label: string;
  signal?: AbortSignal;
  maxMs?: number;
  onProgress?: (message: string) => void;
}): Promise<ApimartTaskState> {
  const startedAt = Date.now();
  const maxMs = input.maxMs ?? (input.kind === 'video' ? 15 * 60_000 : 8 * 60_000);
  let consecutiveErrors = 0;
  await sleep(4_000, input.signal);
  while (Date.now() - startedAt < maxMs) {
    try {
      const state = await queryApimartTask(input.taskId, input.kind);
      consecutiveErrors = 0;
      if (state.status === 'failed') throw new ApimartTaskFailedError(state.error || `${input.label} 任务失败`);
      if (state.status === 'succeeded') return state;
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      input.onProgress?.(`${state.status === 'pending' ? '排队中' : '生成中'}${state.progress !== undefined ? ` ${state.progress}%` : ''} · ${elapsed}s`);
    } catch (error) {
      if (error instanceof ApimartTaskFailedError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      consecutiveErrors += 1;
      if (consecutiveErrors >= 5) {
        throw new PaidTaskCreatedError(input.label, input.taskId, error instanceof Error ? error.message : String(error));
      }
    }
    await sleep(5_000, input.signal);
  }
  throw new PaidTaskCreatedError(input.label, input.taskId, `轮询超过 ${Math.round(maxMs / 60_000)} 分钟，后台任务仍可继续恢复`);
}

function dataUriParts(source: string): { bytes: Uint8Array; ext: string; mime: string } {
  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(source);
  if (!match) throw new Error('无效的 data URI');
  const mime = (match[1] || 'application/octet-stream').toLowerCase();
  const encoded = source.slice(0, source.indexOf(',')).includes(';base64');
  const binary = encoded ? atob(match[2]) : decodeURIComponent(match[2]);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const ext = mime.split('/')[1]?.replace('quicktime', 'mov').replace('mpeg', 'mp3') || 'bin';
  return { bytes, ext, mime };
}

export async function resolveApimartPublicMedia(
  source: string,
  index: number,
  onProgress?: (message: string) => void,
): Promise<string> {
  if (/^https?:\/\//i.test(source) && !source.startsWith('https://asset.localhost/')) return source;
  let localPath = assetUrlToLocalPath(source);
  let tempPath = '';
  let mime: string | undefined;
  if (source.startsWith('data:')) {
    const parts = dataUriParts(source);
    const home = await homeDir();
    const dir = `${home}.kunpeng/tmp`;
    await createDir(dir, { recursive: true }).catch(() => {});
    tempPath = `${dir}/apimart-${Date.now()}-${index}.${parts.ext}`;
    await writeBinaryFile(tempPath, parts.bytes);
    localPath = tempPath;
    mime = parts.mime;
  }
  const fileName = localPath.split('/').pop() || `reference-${index + 1}`;
  onProgress?.(`上传参考素材 ${index + 1} 到公网存储…`);
  try {
    return await uploadToCos(localPath, fileName, mime);
  } finally {
    if (tempPath) void removeFile(tempPath).catch(() => {});
  }
}
