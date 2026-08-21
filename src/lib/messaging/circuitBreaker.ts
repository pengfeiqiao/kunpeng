export type CircuitState = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  private failures = 0;
  private _state: CircuitState = 'closed';
  private lastFailureAt = 0;

  constructor(private threshold = 5, private cooldownMs = 60_000) {}

  get state(): CircuitState { return this._state; }

  recordFailure(): void {
    this.failures++;
    this.lastFailureAt = Date.now();
    if (this.failures >= this.threshold) {
      this._state = 'open';
    }
  }

  recordSuccess(): void {
    this.failures = 0;
    this._state = 'closed';
  }

  isOpen(): boolean {
    if (this._state !== 'open') return false;
    if (Date.now() - this.lastFailureAt > this.cooldownMs) {
      this._state = 'half-open';
      return false;
    }
    return true;
  }

  reset(): void {
    this.failures = 0;
    this._state = 'closed';
    this.lastFailureAt = 0;
  }
}
