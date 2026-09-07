/** Serialize writes by file without a global lock or blocking unrelated projects. */
export class ProjectWriteQueue {
  private tails = new Map<string, Promise<void>>();

  write(key: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.tails.set(key, current);
    const cleanup = () => { if (this.tails.get(key) === current) this.tails.delete(key); };
    void current.then(cleanup, cleanup);
    return current;
  }

  get pendingFiles(): number { return this.tails.size; }
}
