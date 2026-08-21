/**
 * Tauri/Rust transport failures use status=0. Treat them like a missing HTTP
 * status so DNS, TLS, socket, and proxy failures can retry or use a fallback.
 */
export function isRetryableFallbackStatus(
  status: number | undefined,
  triggers: number[],
): boolean {
  return status === undefined || status === 0 || triggers.includes(status);
}
