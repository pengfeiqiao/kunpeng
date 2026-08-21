export function isTruncatedFinishReason(reason?: string | null): boolean {
  const normalized = String(reason ?? '').trim().toLowerCase();
  return normalized === 'max_tokens'
    || normalized === 'max_output_tokens'
    || normalized === 'length';
}

/** Remove the short overlap some gateways repeat when continuing a completion. */
export function mergePromptContinuation(base: string, continuation: string): string {
  const next = continuation.trimStart();
  if (!base) return next;
  if (!next) return base;
  const maxOverlap = Math.min(600, base.length, next.length);
  for (let size = maxOverlap; size >= 4; size -= 1) {
    if (base.endsWith(next.slice(0, size))) return base + next.slice(size);
  }
  return base + next;
}

/** Pending user guidance always wins over a tool-declared terminal outcome. */
export function terminalToolResults<T extends { terminal?: boolean }>(
  results: T[],
  hasPendingGuidance: boolean,
): T[] {
  return hasPendingGuidance ? [] : results.filter((result) => result.terminal === true);
}
