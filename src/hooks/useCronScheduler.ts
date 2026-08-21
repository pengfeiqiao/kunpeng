/**
 * useCronScheduler — ticks once a minute and fires any cron entries whose
 * expression matches the current minute.
 *
 * Firing means: calling `sendMessage(entry.prompt)` to feed the prompt back
 * into the active session, as though the user had typed it. For non-recurring
 * entries, we remove from the store after firing. For recurring, we `markFired`
 * so the scheduler doesn't re-fire within the same minute if multiple ticks
 * land.
 *
 * Entries past `expiresAt` get garbage-collected on every tick.
 *
 * Guardrails:
 *   - Skip firing if the agent isn't ready (no API key / still hydrating).
 *   - Skip if a stream is currently in progress — we queue for the next tick.
 *     This prevents crons from piling up on top of an in-flight response.
 */

import { useEffect, useRef } from 'react';
import { useCronStore, matchesCron, type CronEntry } from '@/stores/cronStore';
import { useChatStore } from '@/stores/chatStore';

const TICK_INTERVAL_MS = 60_000;

export function useCronScheduler(
  isReady: boolean,
  sendMessage: (text: string) => void | Promise<void>,
): void {
  const lastTickRef = useRef<number>(0);

  useEffect(() => {
    if (!isReady) return;

    const tick = async () => {
      const now = Date.now();
      // Avoid double-firing if the tab was backgrounded and setInterval coalesced.
      if (now - lastTickRef.current < TICK_INTERVAL_MS - 5_000) return;
      lastTickRef.current = now;

      const store = useCronStore.getState();
      const chat = useChatStore.getState();
      if (chat.isStreaming) return; // wait for next tick

      const date = new Date();
      const toRemove: string[] = [];
      const toFire: CronEntry[] = [];

      for (const entry of store.entries) {
        if (entry.expiresAt && now > entry.expiresAt) {
          toRemove.push(entry.id);
          continue;
        }
        // Avoid re-firing within the same minute.
        if (entry.lastFiredAt && now - entry.lastFiredAt < TICK_INTERVAL_MS - 5_000) continue;
        // Session-bound entries fire only into the session that scheduled
        // them — otherwise the prompt lands in whatever session happens to
        // be open. Defer (don't drop) while another session is active.
        if (entry.sessionId && entry.sessionId !== chat.currentSessionId) continue;
        if (matchesCron(entry.cron, date)) {
          toFire.push(entry);
        }
      }

      for (const id of toRemove) store.remove(id);

      // Fire sequentially so the coordinator doesn't get clobbered.
      for (const entry of toFire) {
        try {
          await sendMessage(entry.prompt);
        } catch (err) {
          console.warn('[cronScheduler] fire failed for', entry.id, err);
        }
        if (entry.recurring) {
          store.markFired(entry.id);
        } else {
          store.remove(entry.id);
        }
      }
    };

    // Fire once on mount if any entry is overdue; then every minute.
    void tick();
    const handle = setInterval(() => void tick(), TICK_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [isReady, sendMessage]);
}
