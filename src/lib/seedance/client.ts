import { fetch, ResponseType } from '@tauri-apps/api/http';
import { useSettingsStore } from '@/stores/settingsStore';
import { resolveApiKey } from '@/lib/credentials';

// Seedance 2.5（doubao-seedance-2-5-260628）参数要点，以官方文档为准：
// https://docs.volcengine.com/docs/82379/2607688?lang=zh
// - 视频时长最长 30 秒；
// - 多模态参考（图片/视频/音频）总数最多 50 个；
// - 开通有门槛：账户余额 ≥ 200 元或已购资源包。
// 本文件不臆造参数名；分辨率/时长/i2v 等参数面以官方文档为准，不要照抄 1.x 参数。
//
// model 由调用方传入：可选目录 ID 见注册表 src/lib/channels/arkModels.ts（ARK_MODELS），
// 用户自建推理接入点（ep-xxx）同样允许填入。

const BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

export interface SeedanceContentItem {
  type: 'text' | 'image_url' | 'video_url' | 'audio_url';
  text?: string;
  image_url?: { url: string };
  video_url?: { url: string };
  audio_url?: { url: string };
  role?: string;
}

export interface SeedanceCreateRequest {
  model: string;
  content: SeedanceContentItem[];
  generate_audio?: boolean;
  ratio?: string;
  resolution?: string;
  duration?: number;
  watermark?: boolean;
  tools?: { type: string }[];
}

export interface SeedanceTaskResult {
  id: string;
  model: string;
  status: 'running' | 'succeeded' | 'failed';
  content?: { video_url?: string; last_frame_url?: string };
  error?: { code: string; message: string };
  usage?: { completion_tokens: number };
  created_at?: number;
  updated_at?: number;
}

function getApiKey(): string {
  const s = useSettingsStore.getState();
  return resolveApiKey(s, 'ark', s.arkApiKey);
}

function headers() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${getApiKey()}`,
  };
}

export async function createTask(request: SeedanceCreateRequest): Promise<SeedanceTaskResult> {
  const resp = await fetch(`${BASE_URL}/contents/generations/tasks`, {
    method: 'POST',
    headers: headers(),
    body: { type: 'Json', payload: request },
    responseType: ResponseType.JSON,
    timeout: 60, // seconds
  });
  if (!resp.ok) {
    throw new Error(`Seedance API error: ${resp.status} ${JSON.stringify(resp.data)}`);
  }
  return resp.data as SeedanceTaskResult;
}

export async function getTask(taskId: string): Promise<SeedanceTaskResult> {
  const resp = await fetch(`${BASE_URL}/contents/generations/tasks/${taskId}`, {
    method: 'GET',
    headers: headers(),
    responseType: ResponseType.JSON,
    timeout: 30,
  });
  if (!resp.ok) {
    throw new Error(`Seedance API error: ${resp.status} ${JSON.stringify(resp.data)}`);
  }
  return resp.data as SeedanceTaskResult;
}

export async function pollUntilDone(
  taskId: string,
  onProgress?: (status: string) => void,
  intervalMs = 15000,
  signal?: AbortSignal,
): Promise<SeedanceTaskResult> {
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 5;
  while (true) {
    if (signal?.aborted) throw new Error('Polling aborted');
    try {
      const result = await getTask(taskId);
      consecutiveErrors = 0;
      onProgress?.(result.status);
      if (result.status === 'succeeded' || result.status === 'failed') {
        return result;
      }
    } catch (err) {
      consecutiveErrors++;
      onProgress?.(`重试中 (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS})`);
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        throw err instanceof Error ? err : new Error(String(err));
      }
    }
    // Exponential backoff on errors, otherwise fixed interval
    const wait = consecutiveErrors > 0
      ? Math.min(intervalMs * Math.pow(2, consecutiveErrors - 1), 120_000)
      : intervalMs;
    await new Promise<void>((resolve) => setTimeout(resolve, wait));
  }
}
