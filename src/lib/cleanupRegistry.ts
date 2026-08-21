/**
 * Global registry for cleanup functions that should run during graceful
 * shutdown (Tauri window close / React root unmount / unhandled error).
 *
 * Port of `/tmp/CC-Study/src/utils/cleanupRegistry.ts`.
 *
 * Wire-up points (see Tier 1.3 / Tier 2.5 of the plan):
 *   - `App.tsx` top-level useEffect: attach window.onbeforeunload → runAll
 *   - `main.tsx`: before React.unmount, run cleanup
 *   - Tauri side: `tauri::RunEvent::ExitRequested` emits a cleanup event
 *     that the frontend listens for and calls runAll
 */

const cleanupFunctions = new Set<() => Promise<void> | void>();

/**
 * Register a cleanup function. Returns an unregister callback — call it
 * when the resource is released naturally so we don't keep calling a
 * no-op cleanup on shutdown.
 */
export function registerCleanup(fn: () => Promise<void> | void): () => void {
  cleanupFunctions.add(fn);
  return () => cleanupFunctions.delete(fn);
}

/**
 * Run all registered cleanup functions in parallel. Errors are swallowed
 * per-function so one failing handler doesn't block the others.
 */
export async function runCleanupFunctions(): Promise<void> {
  const fns = Array.from(cleanupFunctions);
  await Promise.all(
    fns.map(async (fn) => {
      try {
        await fn();
      } catch (err) {
        console.warn('[cleanupRegistry] handler threw:', err);
      }
    }),
  );
}

/**
 * Test helper — NOT for production code paths.
 */
export function _clearAllForTests(): void {
  cleanupFunctions.clear();
}
