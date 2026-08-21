import type { RouteStrategy } from '../providers/router';

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  return /\babort(?:ed)?\b/i.test(error instanceof Error ? error.message : String(error ?? ''));
}

/**
 * Harness is an execution engine, not a provider fallback link. If it fails
 * before producing visible output, retry the same DeepSeek model once through
 * Kunpeng's built-in coordinator. Never hand this turn to Kimi/GLM.
 */
export function shouldFallbackHarnessToBuiltin(error: unknown, hasVisibleOutput: boolean): boolean {
  return !hasVisibleOutput && !isAbortError(error);
}

export function deepseekBuiltinRoute(modelId?: string): RouteStrategy {
  return { kind: 'primary', providerId: 'deepseek', modelId };
}
