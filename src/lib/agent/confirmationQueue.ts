export interface ConfirmationEntry<T> {
  id: number;
  position: number;
  scope?: string;
  payload: T;
}

export interface ConfirmationSnapshot<T> {
  pending: readonly ConfirmationEntry<T>[];
  total: number;
}

/** Promise resolvers stay outside UI state; every removal settles its caller. */
export class ConfirmationQueue<T> {
  private nextId = 0;
  private state: ConfirmationSnapshot<T> = { pending: [], total: 0 };
  private waiters = new Map<number, { resolve: (allowed: boolean) => void; cleanup: () => void }>();
  private changed: (state: ConfirmationSnapshot<T>) => void;

  constructor(changed: (state: ConfirmationSnapshot<T>) => void = () => {}) {
    this.changed = changed;
  }

  getSnapshot(): ConfirmationSnapshot<T> { return this.state; }

  request(payload: T, options: { scope?: string; signal?: AbortSignal } = {}): Promise<boolean> {
    if (options.signal?.aborted) return Promise.resolve(false);
    const id = ++this.nextId;
    const position = this.state.pending.length ? this.state.total + 1 : 1;
    return new Promise((resolve) => {
      const cancel = () => this.settle([id], false);
      this.waiters.set(id, {
        resolve,
        cleanup: () => options.signal?.removeEventListener('abort', cancel),
      });
      options.signal?.addEventListener('abort', cancel, { once: true });
      this.state = {
        pending: [...this.state.pending, { id, position, scope: options.scope, payload }],
        total: position,
      };
      this.changed(this.state);
      if (options.signal?.aborted) cancel();
    });
  }

  decide(id: number, allowed: boolean): void {
    // A stale click on the previous dialog may never authorize the next item.
    if (this.state.pending[0]?.id !== id) return;
    this.settle([id], allowed);
  }

  approveGroup(currentId: number, visibleIds: readonly number[]): void {
    const current = this.state.pending[0];
    if (!current || current.id !== currentId) return;
    const visible = new Set(visibleIds);
    this.settle(this.state.pending
      .filter((item) => item.scope === current.scope && visible.has(item.id))
      .map((item) => item.id), true);
  }

  cancelScope(scope: string): void {
    this.settle(this.state.pending.filter((item) => item.scope === scope).map((item) => item.id), false);
  }

  private settle(ids: readonly number[], allowed: boolean): void {
    const targets = new Set(ids);
    const settled = this.state.pending.filter((item) => targets.has(item.id));
    if (!settled.length) return;
    const pending = this.state.pending.filter((item) => !targets.has(item.id));
    this.state = { pending, total: pending.length ? this.state.total : 0 };
    this.changed(this.state);
    for (const item of settled) {
      const waiter = this.waiters.get(item.id);
      this.waiters.delete(item.id);
      waiter?.cleanup();
      waiter?.resolve(allowed);
    }
  }
}
