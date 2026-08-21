/**
 * Generic retry-with-backoff for API calls.
 *
 * Inspired by `/tmp/CC-Study/src/services/api/withRetry.ts` but stripped to
 * the parts kunpeng actually needs:
 *   - exponential backoff + jitter
 *   - distinguishes foreground (user waiting) vs background (sub-agent /
 *     summarizer / classifier) so capacity errors don't cause retry storms
 *   - respects AbortSignal — stops retrying the moment the user aborts
 *   - status-code-aware: 429 always retries with backoff; 529 only for
 *     foreground; 5xx retries up to MAX_RETRIES; 4xx (except 429) bails.
 *
 * GLM-specific 429/529 logic in glmClient.ts:338/372 becomes a single call
 * to `withRetry`, and DeepSeek/DMXAPI providers get the same behavior for
 * free (Tier 1.5).
 */

export type QuerySource = 'foreground' | 'background';

export interface RetryableError {
  status?: number;
  message?: string;
}

const DEFAULT_MAX_RETRIES = 10;
const BASE_DELAY_MS = 500;
const MAX_529_RETRIES = 3;
const MAX_BACKOFF_MS = 30_000;

export interface WithRetryOptions {
  source: QuerySource;
  signal?: AbortSignal;
  maxRetries?: number;
  /** Called before each retry with (attempt, delayMs, lastError). */
  onRetry?: (attempt: number, delayMs: number, err: unknown) => void;
}

function isAbortError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: string; message?: string };
  return e.name === 'AbortError' || e.message === 'aborted';
}

function extractStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as { status?: number; response?: { status?: number } };
  return e.status ?? e.response?.status;
}

function shouldRetry(
  err: unknown,
  retry529Count: number,
  source: QuerySource,
): { retry: boolean; reason: string } {
  if (isAbortError(err)) return { retry: false, reason: 'aborted' };

  const status = extractStatus(err);
  if (status === undefined || status === 0) {
    // Network-level error (no HTTP status) — retry up to max.
    return { retry: true, reason: 'network' };
  }
  if (status === 429) return { retry: true, reason: '429 rate-limited' };
  if (status === 529) {
    if (source !== 'foreground') return { retry: false, reason: '529 background (no retry)' };
    if (retry529Count >= MAX_529_RETRIES) return { retry: false, reason: '529 retry cap' };
    return { retry: true, reason: '529 foreground' };
  }
  if (status >= 500 && status < 600) return { retry: true, reason: `${status}` };
  if (status === 408) return { retry: true, reason: 'request timeout' };
  return { retry: false, reason: `${status} (non-retryable)` };
}

function backoffMs(attempt: number): number {
  const exp = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_BACKOFF_MS);
  const jitter = Math.random() * exp * 0.25;
  return Math.floor(exp + jitter);
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: WithRetryOptions,
): Promise<T> {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  let retry529 = 0;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (opts.signal?.aborted) throw opts.signal.reason ?? new Error('aborted');
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt >= maxRetries) break;
      const { retry, reason } = shouldRetry(err, retry529, opts.source);
      if (!retry) {
        console.warn(`[withRetry] not retrying (${reason}):`, err);
        break;
      }
      if (extractStatus(err) === 529) retry529++;
      const delay = backoffMs(attempt);
      opts.onRetry?.(attempt + 1, delay, err);
      console.warn(
        `[withRetry] attempt ${attempt + 1}/${maxRetries} failed (${reason}), retrying in ${delay}ms`,
      );
      await sleepAbortable(delay, opts.signal);
    }
  }
  throw lastErr;
}

async function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal?.reason ?? new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
