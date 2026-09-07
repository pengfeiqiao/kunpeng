import type { WorkspaceMessageScope } from './workspaceMessage.ts';

const readers = new Set<() => WorkspaceMessageScope | null>();
const dispatchGuards = new Map<string, (name: string, params: Record<string, unknown>) => string | null>();

export function bindWorkspaceDispatchGuard(runId: string, guard: (name: string, params: Record<string, unknown>) => string | null): () => void {
  dispatchGuards.set(runId, guard);
  // A late callback must not turn an ended scoped run back into an unrestricted run.
  return () => { if (dispatchGuards.get(runId) === guard) dispatchGuards.set(runId, () => '工作台任务已结束，迟到工具未执行。'); };
}

export function checkWorkspaceDispatch(name: string, params: Record<string, unknown>, context: { runId?: string; idempotencyRunId?: string }): string | null {
  const guard = (context.runId && dispatchGuards.get(context.runId))
    || (context.idempotencyRunId && dispatchGuards.get(context.idempotencyRunId));
  if (!guard) return null;
  try { return guard(name, params); }
  catch { return '工作台范围校验失败，工具未执行。'; }
}

/** Only mounted embedded assistants register. Legacy views retain their original gating. */
export function registerWorkspaceToolScope(read: () => WorkspaceMessageScope | null): () => void {
  readers.add(read);
  return () => { readers.delete(read); };
}

export function effectiveToolView(activeView: string): string {
  if (activeView !== 'workshop') return activeView;
  const scopes = [...readers].map((read) => read()).filter((scope) => scope !== null);
  return scopes[scopes.length - 1] ?? activeView;
}
