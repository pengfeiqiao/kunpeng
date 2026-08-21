export class MessageIdCache {
  private cache = new Map<string, number>();
  private callsSincePrune = 0;

  constructor(private maxSize = 1000, private ttlMs = 300_000) {}

  has(id: string): boolean {
    if (++this.callsSincePrune >= 100) this.prune();
    return this.cache.has(id);
  }

  add(id: string): void {
    this.cache.set(id, Date.now());
    if (this.cache.size > this.maxSize) {
      const oldest = this.cache.keys().next().value!;
      this.cache.delete(oldest);
    }
  }

  private prune(): void {
    this.callsSincePrune = 0;
    const now = Date.now();
    for (const [id, ts] of this.cache) {
      if (now - ts > this.ttlMs) this.cache.delete(id);
    }
  }
}
