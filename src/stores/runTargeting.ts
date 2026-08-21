/**
 * Run-targeting helpers for the execution-chain store.
 *
 * Statically defined tools (e.g. timeline tools) execute without knowing
 * which run they belong to. Writing their progress to the store's global
 * currentRunId lets a concurrent background run (lark/wechat/wizard) steal
 * the note. These helpers resolve the intended run structurally instead.
 */

export interface RunToolCallLike {
  name: string;
  status: string;
  startedAt: number;
}

export interface RunLike {
  id: string;
  status: string;
  steps: Array<{ toolCalls: RunToolCallLike[] }>;
}

/**
 * Resolve which run a step note belongs to. When a toolName is given, the
 * run whose toolCall is currently 'running' under that name is the one
 * executing this code path; ties (same tool in two runs) go to the most
 * recently started call. Without a toolName — or when no running call
 * matches — fall back to the store's currentRunId (legacy behavior).
 */
export function resolveStepNoteTargetRunId(
  runsById: Record<string, RunLike>,
  currentRunId: string | null,
  toolName?: string,
): string | undefined {
  if (toolName) {
    let bestRunId: string | null = null;
    let bestStartedAt = -1;
    for (const run of Object.values(runsById)) {
      if (run.status !== 'running') continue;
      for (const step of run.steps) {
        for (const call of step.toolCalls) {
          if (call.name === toolName && call.status === 'running' && call.startedAt > bestStartedAt) {
            bestRunId = run.id;
            bestStartedAt = call.startedAt;
          }
        }
      }
    }
    if (bestRunId) return bestRunId;
  }
  return currentRunId ?? undefined;
}
