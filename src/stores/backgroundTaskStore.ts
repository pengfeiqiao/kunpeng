import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeLocalStorage } from '@/lib/safeStorage';

// ── Types ──────────────────────────────────────────��──────────────────────────

/**
 * Tier 2.6 typed task states (borrowed from CC-Study Task.ts).
 *   - pending: queued but not yet started
 *   - running: actively executing (was: 'pending' in v1)
 *   - completed: succeeded (was: 'success' in v1)
 *   - failed: errored
 *   - killed: user-cancelled (terminal but distinct from failure)
 *
 * Backwards-compat: persisted v1 entries with `status: 'pending' | 'success'`
 * are migrated in the `version: 2` migration below.
 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'killed';

const TERMINAL_STATUSES = new Set<TaskStatus>(['completed', 'failed', 'killed']);

/** Convenience helper: true once a task is in a terminal state. */
export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export interface BackgroundTask {
  id: string;
  type: 'dreamina';
  submitId: string;
  status: TaskStatus;
  description: string;
  createdAt: number;
  completedAt?: number;
  resultUrl?: string;
  /** Absolute local path of the downloaded result file (filled by poller). */
  resultPath?: string;
  error?: string;
  sessionId: string;
  notified: boolean;
  /** Canvas node ID to write-back when generation completes. */
  nodeId?: string;
  /** Kind of generation (image or video), determines which node field to update. */
  genKind?: 'image' | 'video';
}

interface BackgroundTaskState {
  tasks: BackgroundTask[];
  addTask: (task: Omit<BackgroundTask, 'id' | 'createdAt' | 'status' | 'notified'>) => string;
  updateTask: (id: string, patch: Partial<BackgroundTask>) => void;
  markNotified: (id: string) => void;
  removeTask: (id: string) => void;
  clearCompleted: () => void;
}

// ── Store ─────────────────────────────────────────────────────────────────────

let counter = 0;
function genId() {
  // Type-prefixed id (`b-` for background) — see CC-Study Task.ts convention.
  return `b-${Date.now()}-${++counter}`;
}

export const useBackgroundTaskStore = create<BackgroundTaskState>()(
  persist(
    (set) => ({
      tasks: [],

      addTask: (task) => {
        const id = genId();
        set((state) => ({
          tasks: [
            ...state.tasks,
            { ...task, id, status: 'pending', createdAt: Date.now(), notified: false },
          ],
        }));
        return id;
      },

      updateTask: (id, patch) =>
        set((state) => ({
          tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        })),

      markNotified: (id) =>
        set((state) => ({
          tasks: state.tasks.map((t) => (t.id === id ? { ...t, notified: true } : t)),
        })),

      removeTask: (id) =>
        set((state) => ({
          tasks: state.tasks.filter((t) => t.id !== id),
        })),

      clearCompleted: () =>
        set((state) => ({
          tasks: state.tasks.filter((t) => !isTerminalTaskStatus(t.status)),
        })),
    }),
    {
      name: 'kunpeng-background-tasks',
      storage: createJSONStorage(() => safeLocalStorage),
      version: 3,
      migrate: (persistedState: unknown, version: number) => {
        const state = persistedState as { tasks?: BackgroundTask[] };
        if (version <= 1 && Array.isArray(state.tasks)) {
          state.tasks = state.tasks.map((t) => {
            const oldStatus = t.status as unknown as string;
            // v1: pending | success | failed → pending | completed | failed
            if (oldStatus === 'success') return { ...t, status: 'completed' as TaskStatus };
            return t;
          });
        }
        if (version <= 2 && Array.isArray(state.tasks)) {
          // 'running' means "claimed by this session's poller". After a
          // restart nothing is polling it, so reset to 'pending' — the
          // poller re-claims it on next tick. (v2 migrated the other way,
          // which orphaned tasks: poller only picked up 'pending'.)
          state.tasks = state.tasks.map((t) =>
            (t.status as string) === 'running' ? { ...t, status: 'pending' as TaskStatus } : t,
          );
        }
        return state as BackgroundTaskState;
      },
    },
  ),
);
