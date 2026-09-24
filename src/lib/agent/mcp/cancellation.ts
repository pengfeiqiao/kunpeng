/** Stop waiting without pretending that a remote side effect has been rolled back. */
export function withCancellation<T>(signal: AbortSignal | undefined, run: () => Promise<T>, cancel: () => Promise<void>): Promise<T> {
  if (signal?.aborted) return Promise.reject(new Error('MCP request cancelled before dispatch'));
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal?.removeEventListener('abort', abort);
      void cancel().catch(() => {});
      reject(new Error('MCP request cancelled; execution status unknown, inspect state before retrying'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => {
      if (signal?.aborted) throw new Error('MCP request cancelled before dispatch');
      return run();
    }).then(resolve, reject).finally(() => signal?.removeEventListener('abort', abort));
  });
}
