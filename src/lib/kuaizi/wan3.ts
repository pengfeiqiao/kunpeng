/**
 * Kuaizi (筷子) 万相 3.0（wan3.0-video）兼容端点客户端 —— 阿里云百炼 DashScope
 * 视频生成协议级兼容：
 * 创建 POST /ai-open-platform-api/api/v1/services/aigc/video-generation/video-synthesis
 * 查询 GET  /ai-open-platform-api/api/v1/tasks/{task_id}
 * 必传 X-DashScope-Async: enable；鉴权 Authorization: Bearer <筷子 ApiKey>。
 * 用途：wan-3.0 引擎的主渠道。
 * 注意：参数校验由阿里云异步返回 FAILED；余额不足在创建时同步 HTTP 429。
 */
import { fetch as tauriFetch, ResponseType, Body } from '@tauri-apps/api/http';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { PaidSubmissionUnknownError, PaidTaskCreatedError } from '@/lib/billingSafety';
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
import { classifyKuaiziSubmitHttpError } from './errors.ts';
import { buildKuaiziWan3Payload } from './wan3Payload.ts';

export { buildKuaiziWan3Payload, type KuaiziWan3MediaType } from './wan3Payload.ts';

const BASE_URL = 'https://aiopenapi.kuaizi.cn';
const CREATE_PATH = '/ai-open-platform-api/api/v1/services/aigc/video-generation/video-synthesis';
const QUERY_PATH = '/ai-open-platform-api/api/v1/tasks';

export interface KuaiziWan3RunRequest {
  prompt: string;
  referenceUrls?: string[];
  videoUrls?: string[];
  audioUrls?: string[];
  /** 文档 URL（docx/pdf/md 等，与 linkUrl 互斥） */
  documentUrl?: string;
  /** 公开网页 URL（与 documentUrl 互斥） */
  linkUrl?: string;
  params?: Record<string, unknown>;
  onProgress?: (phase: string) => void;
  /** 远端任务创建成功立即回调（上层据此把 task_id 写入任务存储，供中断恢复）。 */
  onProviderTaskCreated?: (taskId: string) => void;
  signal?: AbortSignal;
}

export interface KuaiziWan3RunResult {
  taskId: string;
  resultPaths: string[];
  resultUrls: string[];
}

type KuaiziWan3Status = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'UNKNOWN';

export interface KuaiziWan3Output {
  task_id?: string;
  task_status?: KuaiziWan3Status;
  video_url?: string;
  code?: string;
  message?: string;
}

function isKuaiziWan3Balance(status: number, detail: string): boolean {
  return status === 429 || /InsufficientBalance|余额不足|insufficient|balance/i.test(detail);
}

async function kuaiziWan3CreateTask(payload: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const key = requireKuaiziApiKey();
  let res;
  try {
    res = await tauriFetch(`${BASE_URL}${CREATE_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'X-DashScope-Async': 'enable',
      },
      body: Body.json(payload),
      responseType: ResponseType.JSON,
      timeout: 120,
    });
  } catch (err) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    throw new PaidSubmissionUnknownError('筷子 万相3.0', err instanceof Error ? err.message : String(err));
  }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const data = res.data as { output?: KuaiziWan3Output; code?: string; message?: string };
  if (!res.ok) {
    const detail = data?.message || data?.code || JSON.stringify(res.data).slice(0, 300);
    const kind = classifyKuaiziSubmitHttpError(res.status, `${data?.code ?? ''} ${detail}`);
    if (kind === 'rejected_safe') {
      throw new KuaiziBusinessError('balance', `筷子 万相3.0 创建被拒绝（HTTP ${res.status}，未扣费）: ${detail}`);
    }
    if (kind === 'ambiguous') {
      throw new PaidSubmissionUnknownError('筷子 万相3.0', `HTTP ${res.status}: ${detail}`);
    }
    throw new Error(`筷子 万相3.0 创建任务失败 HTTP ${res.status}: ${detail}`);
  }
  const taskId = data?.output?.task_id;
  if (!taskId) {
    throw new PaidSubmissionUnknownError('筷子 万相3.0', `成功响应未包含 task_id：${JSON.stringify(res.data).slice(0, 300)}`);
  }
  return taskId;
}

/** 单次查询（恢复钩子也用）。 */
export async function kuaiziWan3QueryTask(taskId: string, signal?: AbortSignal): Promise<KuaiziWan3Output> {
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
    // 查询阶段的 429 是限流（瞬态），不是余额问题——任务已创建，交给轮询退避重试；
    // 绝不能在这里归为 balance，否则上层会把仍在运行的付费任务误判为可降级而重复提交。
    if (res.status === 429) {
      throw new Error(`筷子 万相3.0 查询限流 HTTP 429: ${detail}`);
    }
    throw new Error(`筷子 万相3.0 查询失败 HTTP ${res.status}: ${detail}`);
  }
  return (res.data as { output?: KuaiziWan3Output }).output ?? {};
}

async function kuaiziWan3PollTask(
  taskId: string,
  opts: { signal?: AbortSignal; onProgress?: (status: string, elapsedMs: number) => void } = {},
): Promise<KuaiziWan3Output> {
  const start = Date.now();
  const intervalMs = 15_000; // 官方建议轮询间隔 ≥ 15 秒
  const timeoutMs = 25 * 60 * 1000;
  let transientFailures = 0;
  while (Date.now() - start < timeoutMs) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    let output: KuaiziWan3Output;
    try {
      output = await kuaiziWan3QueryTask(taskId, opts.signal);
      transientFailures = 0;
    } catch (err) {
      if (!isTransientKuaiziError(err)) throw err;
      transientFailures += 1;
      opts.onProgress?.('RUNNING', Date.now() - start);
      await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, intervalMs * Math.min(transientFailures, 2))));
      continue;
    }
    opts.onProgress?.(output.task_status ?? 'RUNNING', Date.now() - start);
    if (output.task_status === 'SUCCEEDED') return output;
    if (output.task_status === 'FAILED' || output.task_status === 'CANCELED' || output.task_status === 'UNKNOWN') {
      const detail = output.message || output.code || 'unknown error';
      if (isKuaiziWan3Balance(0, `${output.code ?? ''} ${detail}`)) {
        throw new KuaiziBusinessError('balance', `筷子 万相3.0 余额不足: ${detail}`);
      }
      throw new KuaiziBusinessError('task_failed', `筷子 万相3.0 任务失败（${output.task_status}）: ${detail}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`筷子 万相3.0 任务超时: ${taskId}`);
}

export async function runKuaiziWan3Generation(req: KuaiziWan3RunRequest): Promise<KuaiziWan3RunResult> {
  req.onProgress?.('上传参考素材到 COS…');
  const imageUrls: string[] = [];
  for (const ref of req.referenceUrls ?? []) imageUrls.push(await resolveKuaiziMediaRef(ref));
  const videoUrls: string[] = [];
  for (const ref of req.videoUrls ?? []) videoUrls.push(await resolveKuaiziMediaRef(ref));
  const audioUrls: string[] = [];
  for (const ref of req.audioUrls ?? []) audioUrls.push(await resolveKuaiziMediaRef(ref));

  const payload = buildKuaiziWan3Payload({
    prompt: req.prompt,
    imageUrls,
    videoUrls,
    audioUrls,
    documentUrl: req.documentUrl,
    linkUrl: req.linkUrl,
    duration: req.params?.duration,
    resolution: req.params?.resolution,
    ratio: req.params?.ratio ?? req.params?.aspectRatio,
    audio: req.params?.generateAudio ?? req.params?.audio,
    seed: req.params?.seed,
  });

  await appendKuaiziLog({
    timestamp: new Date().toISOString(),
    provider: 'kuaizi-wan3',
    event: 'create_request',
    apiKeyConfigured: Boolean(getKuaiziApiKey()),
    payload: {
      ...payload,
      input: {
        ...(payload.input as Record<string, unknown>),
        prompt: req.prompt.slice(0, 4000),
      },
    },
  });

  req.onProgress?.('提交筷子 万相3.0 任务…');
  const taskId = await kuaiziWan3CreateTask(payload, req.signal);
  try { req.onProviderTaskCreated?.(taskId); } catch { /* caller progress hook must not break generation */ }
  await appendKuaiziLog({ timestamp: new Date().toISOString(), provider: 'kuaizi-wan3', event: 'create_response', taskId });

  let resultPaths: string[];
  try {
    req.onProgress?.('等待筷子 万相3.0 生成…');
    const output = await kuaiziWan3PollTask(taskId, {
      signal: req.signal,
      onProgress: (s, elapsed) => req.onProgress?.(`${s} · ${Math.round(elapsed / 1000)}s`),
    });
    if (!output.video_url) throw new Error('生成成功但未返回 video_url');
    req.onProgress?.('下载筷子 万相3.0 视频…');
    resultPaths = await rhtvDownloadAll([output.video_url], 'video', 'kuaizi-wan3', req.onProgress);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    if (err instanceof KuaiziBusinessError && (err.kind === 'task_failed' || err.kind === 'balance')) throw err;
    throw new PaidTaskCreatedError('筷子 万相3.0', taskId, err instanceof Error ? err.message : String(err));
  }

  await appendKuaiziLog({
    timestamp: new Date().toISOString(),
    provider: 'kuaizi-wan3',
    event: 'success',
    taskId,
    outputPaths: resultPaths,
  });
  for (const p of resultPaths) {
    void appendArtifact({ path: p, type: 'video', engine: 'kuaizi/wan-3.0', prompt: req.prompt, taskId });
  }
  void appendGenerationLog({
    timestamp: new Date().toISOString(),
    director: '',
    taskType: imageUrls.length > 0 || videoUrls.length > 0 ? 'image-to-video' : 'text-to-video',
    engine: 'other',
    prompt: req.prompt,
    outputPath: resultPaths[0],
    outputPaths: resultPaths,
    model: 'kuaizi/wan-3.0',
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
