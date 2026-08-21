/**
 * AbortController with parent→child cascade.
 *
 * In a browser/webview context, Node's `events.setMaxListeners` is
 * unavailable and listener-limit warnings don't fire — so we skip it.
 * The WeakRef-based cascade logic is adopted verbatim from CC-Study
 * (`/tmp/CC-Study/src/utils/abortController.ts`): parent aborting
 * propagates to live children without the parent keeping dead children
 * alive.
 *
 * Why we need this: coordinator.ts holds a single AbortController, but
 * when agentTool spawns a sub-agent, that sub-agent should stop the
 * moment the parent is aborted. Without cascade the user's "stop"
 * button only halts the outer loop, leaving sub-agents burning tokens.
 */

export function createAbortController(): AbortController {
  return new AbortController();
}

function propagateAbort(
  this: WeakRef<AbortController>,
  weakChild: WeakRef<AbortController>,
): void {
  const parent = this.deref();
  weakChild.deref()?.abort(parent?.signal.reason);
}

function removeAbortHandler(
  this: WeakRef<AbortController>,
  weakHandler: WeakRef<EventListener>,
): void {
  const parent = this.deref();
  const handler = weakHandler.deref();
  if (parent && handler) {
    parent.signal.removeEventListener('abort', handler);
  }
}

/**
 * Creates a child AbortController that aborts when its parent aborts.
 * Aborting the child does NOT affect the parent.
 *
 * WeakRef-based so the parent doesn't keep abandoned children alive.
 */
export function createChildAbortController(parent: AbortController): AbortController {
  const child = createAbortController();

  if (parent.signal.aborted) {
    child.abort(parent.signal.reason);
    return child;
  }

  const weakChild = new WeakRef(child);
  const weakParent = new WeakRef(parent);
  const handler = propagateAbort.bind(weakParent, weakChild) as EventListener;

  parent.signal.addEventListener('abort', handler, { once: true });

  child.signal.addEventListener(
    'abort',
    removeAbortHandler.bind(weakParent, new WeakRef(handler)) as EventListener,
    { once: true },
  );

  return child;
}
