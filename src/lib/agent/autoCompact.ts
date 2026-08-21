/**
 * AutoCompact — token-budget-aware context compaction.
 *
 * Layered on top of ContextManager.compact():
 *   1. Compute an EFFECTIVE context window: (model_window - reserved_summary_budget).
 *      We reserve MAX_OUTPUT_TOKENS_FOR_SUMMARY so that when we actually call
 *      the summarizer, there's headroom for the summary's output. Without this,
 *      a "successful" compact can still OOM the next turn because we didn't
 *      account for summary size.
 *   2. Circuit breaker: if the last N compaction attempts failed, stop trying
 *      automatically — the user gets a visible error instead of a silent retry
 *      storm. Resets on first success.
 *   3. Env override: KUNPENG_AUTO_COMPACT_WINDOW lets power users pin the
 *      window size for testing (e.g. force 8k to exercise the path).
 *
 * Usage: call `shouldAutoCompact(messages, modelId)` before each turn;
 * if true, call `contextManager.compact(messages, client, true)` wrapped in
 * `recordAutoCompactAttempt()`.
 */

import { agentLog } from './logger';
import { getEffectiveContextWindowSize } from './contextWindow';

export {
  getEffectiveContextWindowSize,
  getRawContextWindowSize,
  MAX_OUTPUT_TOKENS_FOR_SUMMARY,
  normalizeContextModelId,
} from './contextWindow';
const CIRCUIT_BREAKER_LIMIT = 3;

let consecutiveFailures = 0;

export function shouldAutoCompact(
  estimatedTokens: number,
  modelId: string,
): { compact: boolean; reason?: string } {
  if (consecutiveFailures >= CIRCUIT_BREAKER_LIMIT) {
    return { compact: false, reason: `circuit breaker open (${consecutiveFailures} failures)` };
  }
  const effective = getEffectiveContextWindowSize(modelId);
  // Million-token models should actually benefit from their larger window.
  // Tool results are micro-compacted before this check, so 90% still leaves
  // ample output/schema headroom without repeatedly summarizing healthy history.
  const triggerRatio = effective >= 900_000 ? 0.9 : 0.8;
  const trigger = effective * triggerRatio;
  if (estimatedTokens > trigger) {
    return { compact: true, reason: `${estimatedTokens} > ${Math.floor(trigger)} (${Math.round(triggerRatio * 100)}% of ${effective})` };
  }
  return { compact: false };
}

/** Wrap a compact call to feed the circuit breaker. */
export async function recordAutoCompactAttempt<T>(fn: () => Promise<T>): Promise<T> {
  try {
    const result = await fn();
    if (consecutiveFailures > 0) {
      agentLog.info('AutoCompact', `recovered after ${consecutiveFailures} failures`);
    }
    consecutiveFailures = 0;
    return result;
  } catch (err) {
    consecutiveFailures += 1;
    agentLog.warn('AutoCompact', `attempt failed (${consecutiveFailures}/${CIRCUIT_BREAKER_LIMIT})`, err);
    throw err;
  }
}

/** Reset manually — used by tests and when the user clears the conversation. */
export function resetAutoCompactCircuit(): void {
  consecutiveFailures = 0;
}
