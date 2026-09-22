/** FIFO with amortized constant-time reads; consumed payloads are released immediately. */
export class EventFifo<T> {
  private values: (T | undefined)[] = [];
  private head = 0;
  get length() { return this.values.length - this.head; }
  push(value: T) { this.values.push(value); }
  shift(): T | undefined {
    if (!this.length) return undefined;
    const value = this.values[this.head];
    this.values[this.head++] = undefined;
    if (this.head === this.values.length) { this.values = []; this.head = 0; }
    else if (this.head >= 1024 && this.head * 2 >= this.values.length) {
      this.values = this.values.slice(this.head); this.head = 0;
    }
    return value;
  }
  clear() { this.values = []; this.head = 0; }
}

/** Awaiting resolved promises does not yield to input/paint; burst drains need a task boundary. */
export class StreamWorkBudget {
  private started: number;
  private count = 0;
  private readonly now: () => number;
  private readonly pause: () => Promise<void>;
  constructor(now = () => performance.now(),
    pause = () => new Promise<void>(resolve => setTimeout(resolve, 0))) {
    this.now = now;
    this.pause = pause;
    this.started = now();
  }
  checkpoint(): Promise<void> | undefined {
    if (++this.count < 32) return;
    this.count = 0;
    if (this.now() - this.started < 8) return;
    return this.pause().then(() => { this.started = this.now(); });
  }
}
