/**
 * rhtv poll — drive a submitted task to a terminal state.
 *
 * Status protocol (verified against runninghub.py):
 *   SUCCESS → done, results[] has urls
 *   FAILED  → terminal failure (balance errors surfaced as business errors)
 *   anything else → still in progress
 */
import { rhtvQuery } from './client';
import { RhtvBusinessError, type RhtvQueryResponse, type RhtvTaskResult } from './types';

export interface RhtvPollOptions {
  signal?: AbortSignal;
  onProgress?: (status: string, elapsedMs: number) => void;
  /** Hard cap. Default 20 min (image tasks finish in seconds, video in minutes). */
  maxMs?: number;
  /** Initial interval; backs off to maxIntervalMs. */
  intervalMs?: number;
  maxIntervalMs?: number;
}

function extractResult(taskId: string, resp: RhtvQueryResponse): RhtvTaskResult {
  const items = resp.results ?? [];
  return {
    taskId,
    urls: items.map((r) => r.url || r.outputUrl || '').filter(Boolean),
    texts: items.map((r) => r.text || '').filter(Boolean),
  };
}

function failureFrom(resp: RhtvQueryResponse): Error {
  const msg = resp.errorMessage || '生成失败';
  const code = String(resp.errorCode ?? '');
  const reason = resp.failedReason
    ? `；详情: ${typeof resp.failedReason === 'string' ? resp.failedReason : JSON.stringify(resp.failedReason).slice(0, 500)}`
    : '';
  const haystack = `${msg} ${code}`.toLowerCase();
  if (/balance|insufficient|余额|credit/.test(haystack)) {
    return new RhtvBusinessError('balance', `RunningHub 余额不足: ${msg}${reason}`);
  }
  return new RhtvBusinessError('task_failed', `[${code}] ${msg}${reason}`);
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

export async function rhtvPollTask(
  taskId: string,
  opts: RhtvPollOptions = {},
): Promise<RhtvTaskResult> {
  const maxMs = opts.maxMs ?? 20 * 60 * 1000;
  const maxInterval = opts.maxIntervalMs ?? 8_000;
  let interval = opts.intervalMs ?? 3_000;
  const startedAt = Date.now();
  let consecutiveErrors = 0;

  for (;;) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const elapsed = Date.now() - startedAt;
    if (elapsed > maxMs) {
      throw new Error(`RunningHub 任务 ${taskId} 超时（${Math.round(maxMs / 60000)} 分钟）`);
    }

    let resp: RhtvQueryResponse | null = null;
    try {
      resp = await rhtvQuery(taskId, opts.signal);
      consecutiveErrors = 0;
    } catch (err) {
      if (err instanceof RhtvBusinessError) throw err;
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      consecutiveErrors += 1;
      if (consecutiveErrors >= 5) throw err;
    }

    if (resp) {
      const status = resp.status ?? 'UNKNOWN';
      opts.onProgress?.(status, elapsed);
      if (status === 'SUCCESS') return extractResult(taskId, resp);
      // ERROR/TIMEOUT/CANCELED 等未在 SUCCESS/FAILED 枚举里的失败终态，
      // 曾被当"进行中"空转到 maxMs 超时（默认 20 分钟）
      if (status === 'FAILED' || /^(ERROR|TIMEOUT|TIMED_OUT|CANCELED|CANCELLED|ABORTED)$/i.test(status)) {
        throw failureFrom(resp);
      }
    }

    await sleep(interval, opts.signal);
    interval = Math.min(Math.round(interval * 1.5), maxInterval);
  }
}
