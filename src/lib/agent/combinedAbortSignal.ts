import { createAbortController } from './abortController';

/**
 * Combines up to two abort signals plus an optional timeout into a single
 * AbortSignal. Returns an explicit `cleanup()` the caller MUST invoke when
 * the covered operation finishes — otherwise the signal listeners (and the
 * timer if any) leak.
 *
 * Port of `/tmp/CC-Study/src/utils/combinedAbortSignal.ts`. We use explicit
 * setTimeout+clearTimeout rather than `AbortSignal.timeout(ms)` so the
 * timer is freed the instant cleanup runs.
 */
export function createCombinedAbortSignal(
  signal: AbortSignal | undefined,
  opts?: { signalB?: AbortSignal; timeoutMs?: number },
): { signal: AbortSignal; cleanup: () => void } {
  const { signalB, timeoutMs } = opts ?? {};
  const combined = createAbortController();

  if (signal?.aborted || signalB?.aborted) {
    combined.abort();
    return { signal: combined.signal, cleanup: () => {} };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const abortCombined = () => {
    if (timer !== undefined) clearTimeout(timer);
    combined.abort();
  };

  if (timeoutMs !== undefined) {
    timer = setTimeout(abortCombined, timeoutMs);
  }
  signal?.addEventListener('abort', abortCombined);
  signalB?.addEventListener('abort', abortCombined);

  const cleanup = () => {
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener('abort', abortCombined);
    signalB?.removeEventListener('abort', abortCombined);
  };

  return { signal: combined.signal, cleanup };
}
