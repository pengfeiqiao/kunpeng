/**
 * Warm up TCP+TLS handshakes to API endpoints at app startup so the
 * user's first message lands ~100-200ms faster. Fire-and-forget.
 *
 * Port of `/tmp/CC-Study/src/utils/apiPreconnect.ts`, adapted for Tauri:
 * we target the GLM/DeepSeek/DMXAPI base URLs that `providers/` knows
 * about, skipping anything that routes through a user-configured
 * HTTP proxy (the proxy already pools connections).
 */

const PRECONNECTED = new Set<string>();

export function preconnect(url: string): void {
  if (!url) return;
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return;
  }
  if (PRECONNECTED.has(origin)) return;
  PRECONNECTED.add(origin);
  // HEAD is cheap and servers generally accept it. Even if it 4xx's, we
  // only care that the TCP+TLS handshake completed.
  fetch(origin, { method: 'HEAD', cache: 'no-store' }).catch(() => {
    // Swallow — preconnect is best-effort.
    PRECONNECTED.delete(origin);
  });
}

/**
 * Called once from `App.tsx` at startup. Adds every base URL kunpeng
 * currently knows about; future providers register themselves via
 * providerRegistry (Tier 1.5) and can call `preconnect()` directly.
 */
export function preconnectAll(baseUrls: string[]): void {
  for (const u of baseUrls) preconnect(u);
}
