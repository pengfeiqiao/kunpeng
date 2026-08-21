/**
 * Timeout constants, env-overridable.
 *
 * In a Tauri/browser context, Node-style `process.env` isn't available.
 * We use Vite's build-time `import.meta.env` for compile-time values and
 * also read from `localStorage` at runtime for user-tunable overrides
 * (the Settings UI writes here).
 *
 * Keys follow the KUNPENG_* convention so they're self-documenting when
 * inspected in devtools → Application → Local Storage.
 */

function readMs(key: string, fallbackMs: number): number {
  if (typeof localStorage !== 'undefined') {
    const v = localStorage.getItem(key);
    if (v) {
      const n = parseInt(v, 10);
      if (!isNaN(n) && n > 0) return n;
    }
  }
  // Vite build-time env (prefix VITE_ required; we mirror KUNPENG_ keys under VITE_).
  const viteKey = `VITE_${key}` as const;
  const viteEnv = (import.meta as unknown as { env?: Record<string, string> }).env;
  const viteVal = viteEnv?.[viteKey];
  if (viteVal) {
    const n = parseInt(viteVal, 10);
    if (!isNaN(n) && n > 0) return n;
  }
  return fallbackMs;
}

// Bash tool defaults — match CC-Study
export const getDefaultBashTimeoutMs = () => readMs('KUNPENG_BASH_DEFAULT_TIMEOUT_MS', 120_000);     // 2 min
export const getMaxBashTimeoutMs = () =>
  Math.max(readMs('KUNPENG_BASH_MAX_TIMEOUT_MS', 600_000), getDefaultBashTimeoutMs());              // 10 min cap

// Stream lifecycle (mirrors the Rust-side values in stream_proxy.rs)
export const getStreamFirstChunkTimeoutMs = () => readMs('KUNPENG_STREAM_FIRST_CHUNK_TIMEOUT_MS', 120_000);
export const getStreamIdleTimeoutMs       = () => readMs('KUNPENG_STREAM_IDLE_TIMEOUT_MS',         60_000);

// Sub-agent outer budget
export const getAgentToolTimeoutMs = () => readMs('KUNPENG_AGENT_TOOL_TIMEOUT_MS', 900_000);         // 15 min

// WebFetch default (Tier 3)
export const getWebFetchTimeoutMs = () => readMs('KUNPENG_WEB_FETCH_TIMEOUT_MS', 30_000);
