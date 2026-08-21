export type IdleWorkSchedule = (callback: () => void) => () => void;

function defaultIdleSchedule(callback: () => void): () => void {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    const idleId = window.requestIdleCallback(callback, { timeout: 5_000 });
    return () => window.cancelIdleCallback(idleId);
  }
  const timer = setTimeout(callback, 0);
  return () => clearTimeout(timer);
}

interface PendingWork<T> {
  value: T;
  timer: ReturnType<typeof setTimeout> | null;
  cancelIdle: (() => void) | null;
}

interface CoalescedIdleWorkOptions {
  debounceMs?: number;
  minIntervalMs?: number;
  scheduleIdle?: IdleWorkSchedule;
  now?: () => number;
}

/**
 * Coalesces expensive snapshots by key and starts them only during browser
 * idle time. A minimum interval prevents a long tool sequence from repeatedly
 * serializing the same growing session on the renderer thread.
 */
export class CoalescedIdleWork<T> {
  private readonly pending = new Map<string, PendingWork<T>>();
  private readonly lastStartedAt = new Map<string, number>();
  private readonly worker: (value: T) => void | Promise<void>;
  private readonly debounceMs: number;
  private readonly minIntervalMs: number;
  private readonly scheduleIdle: IdleWorkSchedule;
  private readonly now: () => number;

  constructor(
    worker: (value: T) => void | Promise<void>,
    options: CoalescedIdleWorkOptions = {},
  ) {
    this.worker = worker;
    this.debounceMs = options.debounceMs ?? 1_500;
    this.minIntervalMs = options.minIntervalMs ?? 15_000;
    this.scheduleIdle = options.scheduleIdle ?? defaultIdleSchedule;
    this.now = options.now ?? Date.now;
  }

  schedule(key: string, value: T): void {
    const existing = this.pending.get(key);
    if (existing) {
      existing.value = value;
      return;
    }

    const lastStartedAt = this.lastStartedAt.get(key) ?? 0;
    const untilInterval = Math.max(0, this.minIntervalMs - (this.now() - lastStartedAt));
    const entry: PendingWork<T> = { value, timer: null, cancelIdle: null };
    entry.timer = setTimeout(() => {
      entry.timer = null;
      entry.cancelIdle = this.scheduleIdle(() => {
        entry.cancelIdle = null;
        if (this.pending.get(key) !== entry) return;
        this.pending.delete(key);
        this.lastStartedAt.set(key, this.now());
        void Promise.resolve(this.worker(entry.value)).catch(() => {});
      });
    }, Math.max(this.debounceMs, untilInterval));
    this.pending.set(key, entry);
  }

  async flush(key: string, value?: T): Promise<void> {
    const entry = this.pending.get(key);
    const nextValue = value ?? entry?.value;
    if (entry) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.cancelIdle?.();
      this.pending.delete(key);
    }
    if (nextValue === undefined) return;
    this.lastStartedAt.set(key, this.now());
    await this.worker(nextValue);
  }

  cancel(key: string): void {
    const entry = this.pending.get(key);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.cancelIdle?.();
    this.pending.delete(key);
  }

  cancelAll(): void {
    for (const key of this.pending.keys()) this.cancel(key);
  }
}
