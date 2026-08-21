/**
 * Cross-platform cache/config directory resolution.
 *
 * CC-Study uses the npm `env-paths` package (XDG on Linux, Library on macOS,
 * AppData on Windows). In a Tauri context the backend already exposes
 * `app_dir()` / `app_config_dir()` via `@tauri-apps/api/path`, so we wrap
 * those rather than pulling a Node-only dep into the webview bundle.
 *
 * `djb2Hash` (same as CC-Study) gives stable short filenames from arbitrary
 * session keys — used for session-resume jsonl files (Tier 4).
 */

import { appCacheDir, appConfigDir, appDataDir, join } from '@tauri-apps/api/path';

/** Path under which kunpeng caches ephemeral data (compaction, preconnect, etc). */
export async function getCachePath(...segments: string[]): Promise<string> {
  const base = await appCacheDir();
  return segments.length > 0 ? await join(base, ...segments) : base;
}

/** Path for durable user config (provider keys, preferences, hooks). */
export async function getConfigPath(...segments: string[]): Promise<string> {
  const base = await appConfigDir();
  return segments.length > 0 ? await join(base, ...segments) : base;
}

/** Path for durable user data (sessions, todo lists, agent memory). */
export async function getDataPath(...segments: string[]): Promise<string> {
  const base = await appDataDir();
  return segments.length > 0 ? await join(base, ...segments) : base;
}

/**
 * djb2 hash — stable, dependency-free, filesystem-safe. Used for deriving
 * short slugs from long/unsafe keys (session IDs, prompt prefixes, etc).
 */
export function djb2Hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i); // h * 33 XOR c
  }
  return (h >>> 0).toString(36);
}
