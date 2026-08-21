/**
 * Fixed-size circular buffer with O(1) push and automatic eviction of the
 * oldest item when full. Port of `/tmp/CC-Study/src/utils/CircularBuffer.ts`.
 *
 * Use case in kunpeng: bound the live-streaming display buffer
 * (`streamingContent`) so very long GLM outputs don't balloon memory /
 * render cost. Full content still accumulates to `message.content`.
 */
export class CircularBuffer<T> {
  private buffer: T[];
  private head = 0;
  private size = 0;

  constructor(private capacity: number) {
    this.buffer = new Array(capacity);
  }

  add(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }

  addAll(items: T[]): void {
    for (const item of items) this.add(item);
  }

  getRecent(count: number): T[] {
    const result: T[] = [];
    const start = this.size < this.capacity ? 0 : this.head;
    const available = Math.min(count, this.size);
    for (let i = 0; i < available; i++) {
      const index = (start + this.size - available + i) % this.capacity;
      result.push(this.buffer[index]!);
    }
    return result;
  }

  toArray(): T[] {
    if (this.size === 0) return [];
    const result: T[] = [];
    const start = this.size < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.size; i++) {
      const index = (start + i) % this.capacity;
      result.push(this.buffer[index]!);
    }
    return result;
  }

  clear(): void {
    this.buffer.length = 0;
    this.head = 0;
    this.size = 0;
  }

  length(): number {
    return this.size;
  }
}
