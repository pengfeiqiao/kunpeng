/**
 * housekeeping — conservative GC of localStorage keys.
 *
 * Previous version aggressively deleted "orphan" messages whose session id
 * wasn't in `kunpeng-sessions`. That assumption is unsafe: if the sessions
 * index drifts (partial shutdown writes, file/localStorage race, multi-agent
 * persistence), legitimate messages get destroyed.
 *
 * Current strategy:
 *   - ONLY delete `kunpeng-messages-*` / `kunpeng-agent-messages-*` for
 *     session ids in `deletedSessionIds` (explicitly user-deleted).
 *   - Optionally prune entries older than STALE_DAYS that are still in the
 *     live index (cheap quota reclaim).
 *
 * Runs once after a 30-second delay from settings ready (see App.tsx), so
 * loadSessions + file hydration have completed first.
 */

const MESSAGES_PREFIX = 'kunpeng-messages-';
const AGENT_MESSAGES_PREFIX = 'kunpeng-agent-messages-';
const SESSIONS_KEY = 'kunpeng-sessions';
const LAST_RUN_KEY = 'kunpeng-housekeeping-last-run';
const MS_PER_DAY = 86_400_000;
const STALE_DAYS = 90;

interface SessionLike { id: string; updatedAt?: number }

function readDeletedSessionIds(): Set<string> {
  try {
    const raw = localStorage.getItem('kunpeng-settings');
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    const ids: string[] = parsed?.state?.deletedSessionIds ?? [];
    return new Set(ids);
  } catch {
    return new Set();
  }
}

function liveSessionMap(): Map<string, number> {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return new Map();
    const parsed: SessionLike[] = JSON.parse(raw);
    const map = new Map<string, number>();
    for (const s of parsed) {
      if (s && typeof s.id === 'string') {
        map.set(s.id, s.updatedAt ?? 0);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

export function runHousekeeping(options: { force?: boolean } = {}): {
  deletedRemoved: number;
  staleRemoved: number;
} {
  try {
    if (!options.force) {
      const last = Number(localStorage.getItem(LAST_RUN_KEY) || '0');
      if (last && Date.now() - last < MS_PER_DAY) {
        return { deletedRemoved: 0, staleRemoved: 0 };
      }
    }

    const deletedIds = readDeletedSessionIds();
    const live = liveSessionMap();
    const now = Date.now();
    const staleThreshold = now - STALE_DAYS * MS_PER_DAY;

    let deletedRemoved = 0;
    let staleRemoved = 0;
    const toDelete: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      let suffix: string | null = null;
      if (key.startsWith(MESSAGES_PREFIX)) suffix = key.slice(MESSAGES_PREFIX.length);
      else if (key.startsWith(AGENT_MESSAGES_PREFIX)) suffix = key.slice(AGENT_MESSAGES_PREFIX.length);
      else continue;

      // Only safe deletion: user-deleted sessions (also check bareUuid)
      const bareUuid = suffix.split(':').pop() || '';
      if (deletedIds.has(suffix) || deletedIds.has(bareUuid)) {
        toDelete.push(key);
        deletedRemoved++;
        continue;
      }

      // Optional stale prune: only if session is in live index AND really old
      const liveUpdatedAt = live.get(suffix);
      if (
        liveUpdatedAt !== undefined &&
        liveUpdatedAt > 0 &&
        liveUpdatedAt < staleThreshold &&
        key.startsWith(MESSAGES_PREFIX)
      ) {
        toDelete.push(key);
        staleRemoved++;
      }
    }

    for (const key of toDelete) {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    }

    localStorage.setItem(LAST_RUN_KEY, String(now));
    if (deletedRemoved + staleRemoved > 0) {
      console.log(
        `[housekeeping] removed ${deletedRemoved} user-deleted + ${staleRemoved} stale (>${STALE_DAYS}d) message entries`,
      );
    }
    return { deletedRemoved, staleRemoved };
  } catch (err) {
    console.warn('[housekeeping] failed', err);
    return { deletedRemoved: 0, staleRemoved: 0 };
  }
}
