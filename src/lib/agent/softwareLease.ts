/** A desktop/browser/Blender scene is shared external state, unlike model context.
 * Retain ownership for a turn so another conversation cannot interleave a click
 * between this turn's screenshot and action. Calls within the owner serialize too.
 */
export class SoftwareLease {
  private owner: string | undefined;
  private active = false;
  private ended = new Set<string>();
  private queue: Array<{ owner: string; signal?: AbortSignal; resolve: (release: () => void) => void; reject: (error: Error) => void; abort: () => void }> = [];
  acquire(owner: string, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new Error('操作已中止，未执行工具。'));
    return new Promise((resolve, reject) => {
      const item = { owner, signal, resolve, reject, abort: () => {
        this.queue = this.queue.filter(entry => entry !== item);
        reject(new Error('操作已中止，未执行工具。'));
        this.pump();
      } };
      this.queue.push(item);
      signal?.addEventListener('abort', item.abort, { once: true });
      this.pump();
    });
  }
  endRun(owner: string): void {
    const cancelled = this.queue.filter(item => item.owner === owner);
    this.queue = this.queue.filter(item => item.owner !== owner);
    for (const item of cancelled) {
      item.signal?.removeEventListener('abort', item.abort);
      item.reject(new Error('任务已结束，未执行排队操作。'));
    }
    if (this.owner !== owner) { this.pump(); return; }
    if (this.active) this.ended.add(owner);
    else { this.owner = undefined; this.pump(); }
  }
  private pump(): void {
    if (this.active) return;
    const index = this.owner ? this.queue.findIndex(item => item.owner === this.owner) : 0;
    if (index < 0 || !this.queue[index]) return;
    const item = this.queue.splice(index, 1)[0];
    item.signal?.removeEventListener('abort', item.abort);
    this.owner = item.owner;
    this.active = true;
    let released = false;
    item.resolve(() => {
      if (released) return;
      released = true;
      this.active = false;
      if (this.ended.delete(item.owner)) this.owner = undefined;
      this.pump();
    });
  }
}
export const softwareLease = new SoftwareLease();
export function usesSharedSoftware(name: string): boolean {
  return name === 'browser_control' || /(?:^|[_:-])(?:blender|computer|desktop|computeruse|computer_use)(?:[_:-]|$)/i.test(name);
}
