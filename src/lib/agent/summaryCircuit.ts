/** Each coordinator owns one circuit; provider/model failures cannot disable another conversation. */
export class SummaryCircuit {
  private states = new Map<string, { failures: number; retryAfter: number }>();
  private readonly now: () => number;
  private readonly cooldownMs: number;
  constructor(now = Date.now, cooldownMs = 60_000) { this.now = now; this.cooldownMs = cooldownMs; }
  available(key: string): boolean { return this.now() >= (this.states.get(key)?.retryAfter ?? 0); }
  reset(): void { this.states.clear(); }
  async run<T>(key: string, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const cancelled = () => { const error = new Error('Summary cancelled'); error.name = 'AbortError'; return error; };
    if (signal?.aborted) throw cancelled();
    let detach = () => {};
    try {
      const result = await new Promise<T>((resolve, reject) => {
        const abort = () => reject(cancelled());
        signal?.addEventListener('abort', abort, { once: true });
        detach = () => signal?.removeEventListener('abort', abort);
        Promise.resolve().then(() => {
          if (signal?.aborted) throw cancelled();
          return work();
        }).then(resolve, reject);
      });
      if (signal?.aborted) throw cancelled();
      this.states.delete(key);
      return result;
    } catch (error) {
      if (signal?.aborted || (error as Error)?.name === 'AbortError') throw cancelled();
      const failures = (this.states.get(key)?.failures ?? 0) + 1;
      this.states.set(key, { failures, retryAfter: failures >= 3 ? this.now() + this.cooldownMs : 0 });
      throw error;
    } finally { detach(); }
  }
}
