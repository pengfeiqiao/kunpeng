import type { AssistantTarget, AssistantQueueItem } from './projectAssistantQueue.ts';
import { canvasTargetOf } from './workspaceCanvasAgent.ts';
import { readWorkspaceMessage, wrapWorkspaceContext, type WorkspaceMessageScope } from '../agent/workspaceMessage.ts';

export function assistantTargetScope(target: AssistantTarget): WorkspaceMessageScope {
  if (canvasTargetOf(target) || target.context.startsWith('[画布上下文：')
    || target.context.startsWith('[用户正在画布视图中操作')) return 'canvas';
  const envelope = readWorkspaceMessage(target.context);
  if (envelope.status === 'valid') return envelope.scope;
  return target.surface === 'editor' ? 'editor' : 'workshop';
}

export function serializeWorkspaceAssistantMessage(target: AssistantTarget, prompt: string): string {
  const envelope = readWorkspaceMessage(target.context);
  // A restored/prepared target may already hold the transport envelope. Never nest it.
  const context = envelope.status === 'valid' ? envelope.context : target.context;
  return wrapWorkspaceContext(assistantTargetScope(target), context) + prompt;
}

/** The dispatching item owns tools even while the user browses a different surface. */
export function workspaceExecutionTarget(items: readonly AssistantQueueItem[], frozen?: AssistantTarget): AssistantTarget | undefined {
  return items.find((item) => item.status === 'running')?.target ?? frozen;
}

export function readDirectorAssistantRequest(prompt: string): { context: string; request: string } | null {
  if (!prompt.startsWith('[导演台上下文：')) return null;
  const end = prompt.indexOf(']\n\n');
  if (end < 0) throw new Error('导演上下文格式不完整，未发送。');
  return { context: prompt.slice(0, end + 3), request: prompt.slice(end + 3) };
}
