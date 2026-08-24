/**
 * Kuaizi (筷子) MiniMax H3 兼容端点客户端 —— MiniMax Video Generation V2 协议级兼容：
 * 创建 POST /ai-open-platform-api/v2/video_generation，
 * 查询 GET  /ai-open-platform-api/v2/query/video_generation/{task_id}。
 * 鉴权 Authorization: Bearer <筷子 ApiKey>（ApiKey 头亦可，统一用 Bearer）。
 * 用途：MiniMax H3 的第三容灾渠道（RunningHub / APIMart 之后）。
 * 注意：创建请求只同步校验 model/content/resolution/duration，参数类错误
 * 由 MiniMax 异步在 task.status=failed 返回；余额不足在创建时同步返回 HTTP 429。
 */
import { fetch as tauriFetch, ResponseType, Body } from '@tauri-apps/api/http';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { isAmbiguousPaidSubmitStatus, PaidSubmissionUnknownError, PaidTaskCreatedError } from '@/lib/billingSafety';
import { rhtvDownloadAll } from '@/lib/rhtv/download';
import { appendArtifact } from '@/lib/artifacts';
import { appendGenerationLog } from '@/lib/aigc/genLogger';
import {
  appendKuaiziLog,
  getKuaiziApiKey,
  isTransientKuaiziError,
  KuaiziBusinessError,
  requireKuaiziApiKey,
  resolveKuaiziMediaRef,
} from './seedance.ts';
import { buildKuaiziH3Payload } from './minimaxH3Payload.ts';

export { buildKuaiziH3Payload, type KuaiziH3ContentItem } from './minimaxH3Payload.ts';

const BASE_URL = 'https://aiopenapi.kuaizi.cn';
const CREATE_PATH = '/ai-open-platform-api/v2/video_generation';
const QUERY_PATH = '/ai-open-platform-api/v2/query/video_generation';

export interface KuaiziH3RunRequest {
  prompt: string;
  referenceUrls?: string[];
  videoUrls?: string[];
  audioUrls?: string[];
  params?: Record<string, unknown>;
  onProgress?: (phase: string) => void;
  signal?: AbortSignal;
}

export interface KuaiziH3RunResult {
  taskId: string;
  resultPaths: string[];
  resultUrls: string[];
}

type KuaiziH3Status = 'queued' | 'running' | 'succeeded' | 'failed';

interface KuaiziH3Task {
  id?: string;
  status?: KuaiziH3Status;
  content?: { url?: string };
  error?: { code?: string; message?: string };
}

function isKuaiziH3Balance(status: number, detail: string): boolean {
  return status === 429 || /余额不足|insufficient|balance/i.test(detail);
}

async function kuaiziH3CreateTask(payload: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const key = requireKuaiziApiKey();
  let res;
  try {
    res = await tauriFetch(`${BASE_URL}${CREATE_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: Body.json(payload),
      responseType: ResponseType.JSON,
      timeout: 120,
    });
  } catch (err) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    throw new PaidSubmissionUnknownError('筷子 MiniMax H3', err instanceof Error ? err.message : String(err));
  }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const data = res.data as { task_id?: string; error?: { message?: string } };
  if (!res.ok) {
    const detail = data?.error?.message || JSON.stringify(res.data).slice(0, 300);
    if (isKuaiziH3Balance(res.status, detail)) {
      throw new KuaiziBusinessError('balance', `筷子 MiniMax H3 余额不足（HTTP ${res.status}），请充值后重试: ${detail}`);
    }
    if (isAmbiguousPaidSubmitStatus(res.status)) {
      throw new PaidSubmissionUnknownError('筷子 MiniMax H3', `HTTP ${res.status}: ${detail}`);
    }
    throw new Error(`筷子 MiniMax H3 创建任务失败 HTTP ${res.status}: ${detail}`);
  }
  if (!data?.task_id) {
    throw new PaidSubmissionUnknownError('筷子 MiniMax H3', `成功响应未包含 task_id：${JSON.stringify(res.data).slice(0, 300)}`);
  }
  return data.task_id;
}

async function kuaiziH3QueryTask(taskId: string, signal?: AbortSignal): Promise<KuaiziH3Task> {
  const key = getKuaiziApiKey();
  const res = await tauriFetch(`${BASE_URL}${QUERY_PATH}/${encodeURIComponent(taskId)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}` },
    responseType: ResponseType.JSON,
    timeout: 60,
  });
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!res.ok) {
    const detail = JSON.stringify(res.data).slice(0, 300);
    if (isKuaiziH3Balance(res.status, detail)) {
      throw new KuaiziBusinessError('balance', `筷子 MiniMax H3 余额不足（HTTP ${res.status}），请充值后重试: ${detail}`);
    }
    throw new Error(`筷子 MiniMax H3 查询失败 HTTP ${res.status}: ${detail}`);
  }
  return (res.data as { task?: KuaiziH3Task }).task ?? {};
}

async function kuaiziH3PollTask(
  taskId: string,
  opts: { signal?: AbortSignal; onProgress?: (status: string, elapsedMs: number) => void } = {},
): Promise<KuaiziH3Task> {
  const start = Date.now();
  const intervalMs = 10_000; // 官方建议轮询间隔 ≥ 10 秒
  const timeoutMs = 25 * 60 * 1000;
  let transientFailures = 0;
  while (Date.now() - start < timeoutMs) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    let task: KuaiziH3Task;
    try {
      task = await kuaiziH3QueryTask(taskId, opts.signal);
      transientFailures = 0;
    } catch (err) {
      if (!isTransientKuaiziError(err)) throw err;
      transientFailures += 1;
      opts.onProgress?.('running', Date.now() - start);
      await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, intervalMs * Math.min(transientFailures, 3))));
      continue;
    }
    opts.onProgress?.(task.status ?? 'running', Date.now() - start);
    if (task.status === 'succeeded') return task;
    if (task.status === 'failed') {
      const detail = task.error?.message || 'unknown error';
      if (isKuaiziH3Balance(0, detail)) {
        throw new KuaiziBusinessError('balance', `筷子 MiniMax H3 余额不足: ${detail}`);
      }
      throw new KuaiziBusinessError('task_failed', `筷子 MiniMax H3 任务失败: ${detail}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`筷子 MiniMax H3 任务超时: ${taskId}`);
}

export async function runKuaiziMinimaxH3Generation(req: KuaiziH3RunRequest): Promise<KuaiziH3RunResult> {
  req.onProgress?.('上传参考素材到 COS…');
  const imageUrls: string[] = [];
  for (const ref of req.referenceUrls ?? []) imageUrls.push(await resolveKuaiziMediaRef(ref));
  const videoUrls: string[] = [];
  for (const ref of req.videoUrls ?? []) videoUrls.push(await resolveKuaiziMediaRef(ref));
  const audioUrls: string[] = [];
  for (const ref of req.audioUrls ?? []) audioUrls.push(await resolveKuaiziMediaRef(ref));

  const payload = buildKuaiziH3Payload({
    prompt: req.prompt,
    imageUrls,
    videoUrls,
    audioUrls,
    duration: req.params?.duration,
    resolution: req.params?.resolution,
    ratio: req.params?.ratio ?? req.params?.aspectRatio,
  });

  await appendKuaiziLog({
    timestamp: new Date().toISOString(),
    provider: 'kuaizi-minimax-h3',
    event: 'create_request',
    apiKeyConfigured: Boolean(getKuaiziApiKey()),
    payload: { ...payload, content: [{ type: 'text', text: req.prompt.slice(0, 4000) }, '...media...'] },
  });

  req.onProgress?.('提交筷子 MiniMax H3 任务…');
  const taskId = await kuaiziH3CreateTask(payload, req.signal);
  await appendKuaiziLog({ timestamp: new Date().toISOString(), provider: 'kuaizi-minimax-h3', event: 'create_response', taskId });

  let resultPaths: string[];
  try {
    req.onProgress?.('等待筷子 MiniMax H3 生成…');
    const task = await kuaiziH3PollTask(taskId, {
      signal: req.signal,
      onProgress: (s, elapsed) => req.onProgress?.(`${s} · ${Math.round(elapsed / 1000)}s`),
    });
    const videoUrl = task.content?.url;
    if (!videoUrl) throw new Error('生成成功但未返回 content.url');
    req.onProgress?.('下载筷子 MiniMax H3 视频…');
    resultPaths = await rhtvDownloadAll([videoUrl], 'video', 'kuaizi-minimax-h3', req.onProgress);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    if (err instanceof KuaiziBusinessError && (err.kind === 'task_failed' || err.kind === 'balance')) throw err;
    throw new PaidTaskCreatedError('筷子 MiniMax H3', taskId, err instanceof Error ? err.message : String(err));
  }

  await appendKuaiziLog({
    timestamp: new Date().toISOString(),
    provider: 'kuaizi-minimax-h3',
    event: 'success',
    taskId,
    outputPaths: resultPaths,
  });
  for (const p of resultPaths) {
    void appendArtifact({ path: p, type: 'video', engine: 'kuaizi/minimax-h3', prompt: req.prompt, taskId });
  }
  void appendGenerationLog({
    timestamp: new Date().toISOString(),
    director: '',
    taskType: imageUrls.length > 0 || videoUrls.length > 0 ? 'image-to-video' : 'text-to-video',
    engine: 'other',
    prompt: req.prompt,
    outputPath: resultPaths[0],
    outputPaths: resultPaths,
    model: 'kuaizi/minimax-h3',
    taskId,
    params: req.params,
    refs: [
      ...imageUrls.map((source, i) => ({ index: i + 1, type: 'image' as const, source })),
      ...videoUrls.map((source, i) => ({ index: i + 1, type: 'video' as const, source })),
      ...audioUrls.map((source, i) => ({ index: i + 1, type: 'audio' as const, source })),
    ],
  });

  return { taskId, resultPaths, resultUrls: resultPaths.map((p) => convertFileSrc(p)) };
}
