import { fetch, ResponseType } from '@tauri-apps/api/http';

export interface HappyHorseCreateParams {
  model: 'happyhorse-1.0-t2v' | 'happyhorse-1.0-i2v';
  prompt: string;
  firstFrameUrl?: string;
  resolution?: '720P' | '1080P';
  ratio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
  duration?: number;
  watermark?: boolean;
  seed?: number;
}

export interface HappyHorseTaskResult {
  taskId: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  videoUrl?: string;
  error?: string;
  usage?: { video_count?: number; video_duration?: number };
}

function headers(apiKey: string) {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    'X-DashScope-Async': 'enable',
  };
}

export async function createTask(
  baseUrl: string,
  apiKey: string,
  params: HappyHorseCreateParams,
): Promise<HappyHorseTaskResult> {
  const input: Record<string, unknown> = { prompt: params.prompt };
  if (params.firstFrameUrl) {
    input.media = [{ type: 'first_frame', url: params.firstFrameUrl }];
  }

  const parameters: Record<string, unknown> = {};
  if (params.resolution) parameters.resolution = params.resolution;
  if (params.ratio) parameters.ratio = params.ratio;
  if (params.duration != null) parameters.duration = params.duration;
  if (params.watermark != null) parameters.watermark = params.watermark;
  if (params.seed != null) parameters.seed = params.seed;

  const body = {
    model: params.model,
    input,
    parameters: Object.keys(parameters).length > 0 ? parameters : undefined,
  };

  const url = `${baseUrl.replace(/\/+$/, '')}/api/v1/services/aigc/video-generation/video-synthesis`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: headers(apiKey),
    body: { type: 'Json', payload: body },
    responseType: ResponseType.JSON,
    timeout: 60,
  });

  if (!resp.ok) {
    throw new Error(`HappyHorse API error: ${resp.status} ${JSON.stringify(resp.data)}`);
  }

  const data = resp.data as any;
  return {
    taskId: data.output?.task_id,
    status: data.output?.task_status ?? 'PENDING',
  };
}

export async function getTask(
  baseUrl: string,
  apiKey: string,
  taskId: string,
): Promise<HappyHorseTaskResult> {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/v1/tasks/${taskId}`;
  const resp = await fetch(url, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    responseType: ResponseType.JSON,
    timeout: 30,
  });

  if (!resp.ok) {
    throw new Error(`HappyHorse API error: ${resp.status} ${JSON.stringify(resp.data)}`);
  }

  const data = resp.data as any;
  const output = data.output ?? {};
  return {
    taskId: output.task_id ?? taskId,
    status: output.task_status ?? 'PENDING',
    videoUrl: output.video_url,
    error: output.message || output.code,
    usage: data.usage,
  };
}

export async function pollUntilDone(
  baseUrl: string,
  apiKey: string,
  taskId: string,
  onProgress?: (status: string) => void,
  intervalMs = 15000,
  signal?: AbortSignal,
): Promise<HappyHorseTaskResult> {
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 5;
  while (true) {
    if (signal?.aborted) throw new Error('Polling aborted');
    try {
      const result = await getTask(baseUrl, apiKey, taskId);
      consecutiveErrors = 0;
      onProgress?.(result.status);
      if (result.status === 'SUCCEEDED' || result.status === 'FAILED') {
        return result;
      }
    } catch (err) {
      consecutiveErrors++;
      onProgress?.(`重试中 (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS})`);
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        throw err instanceof Error ? err : new Error(String(err));
      }
    }
    const wait = consecutiveErrors > 0
      ? Math.min(intervalMs * Math.pow(2, consecutiveErrors - 1), 120_000)
      : intervalMs;
    await new Promise<void>((resolve) => setTimeout(resolve, wait));
  }
}
