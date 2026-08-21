/**
 * cronStore — tracks scheduled prompts created via the `schedule_cron` tool.
 *
 * Session-only. The scheduler hook (`useCronScheduler`) ticks once a minute
 * and fires any entries whose next-fire time has passed.
 *
 * We implement a tiny 5-field cron matcher inline — pulling in `cron-parser`
 * would be overkill for the subset the agent uses (e.g. daily at 9am, every
 * 15 min). See `matchesCron()` for supported syntax.
 */

import { create } from 'zustand';

export interface CronEntry {
  id: string;
  cron: string;
  prompt: string;
  recurring: boolean;
  reason: string;
  createdAt: number;
  expiresAt: number;
  lastFiredAt?: number;
  /** Session the entry was registered from. Fires only when this session is active. */
  sessionId?: string;
}

interface CronState {
  entries: CronEntry[];
  add: (input: Omit<CronEntry, 'id' | 'createdAt' | 'lastFiredAt'>) => string;
  markFired: (id: string) => void;
  remove: (id: string) => void;
  clear: () => void;
}

let counter = 0;
function genId() {
  return `c-${Date.now()}-${++counter}`;
}

export const useCronStore = create<CronState>((set) => ({
  entries: [],
  add: (input) => {
    const id = genId();
    set((state) => ({
      entries: [...state.entries, { ...input, id, createdAt: Date.now() }],
    }));
    return id;
  },
  markFired: (id) =>
    set((state) => ({
      entries: state.entries.map((e) =>
        e.id === id ? { ...e, lastFiredAt: Date.now() } : e,
      ),
    })),
  remove: (id) =>
    set((state) => ({ entries: state.entries.filter((e) => e.id !== id) })),
  clear: () => set({ entries: [] }),
}));

/** Match a single cron field against a value. Supports: *, N, N-M, star/N. */
function matchField(field: string, value: number): boolean {
  if (field === '*') return true;
  for (const part of field.split(',')) {
    // */N stepping
    const stepM = /^\*\/(\d+)$/.exec(part);
    if (stepM) {
      const step = parseInt(stepM[1], 10);
      if (step > 0 && value % step === 0) return true;
      continue;
    }
    // N-M range
    const rangeM = /^(\d+)-(\d+)$/.exec(part);
    if (rangeM) {
      const lo = parseInt(rangeM[1], 10);
      const hi = parseInt(rangeM[2], 10);
      if (value >= lo && value <= hi) return true;
      continue;
    }
    // literal N
    if (parseInt(part, 10) === value) return true;
  }
  return false;
}

/** Check if the given `date` matches the cron expression at minute precision. */
export function matchesCron(cron: string, date: Date): boolean {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [min, hr, dom, mon, dow] = fields;
  return (
    matchField(min, date.getMinutes()) &&
    matchField(hr, date.getHours()) &&
    matchField(dom, date.getDate()) &&
    matchField(mon, date.getMonth() + 1) &&
    matchField(dow, date.getDay())
  );
}
