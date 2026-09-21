import { readWorkspaceMessage } from '../agent/workspaceMessage.ts';
import type { AssistantTarget } from './projectAssistantQueue.ts';

/** Display grouping only. Execution always keeps the original frozen target/version. */
export function assistantConversationKey(target: AssistantTarget): string {
  return JSON.stringify([target.projectId, target.sessionId, target.surface ?? 'media',
    target.objectId ?? null, target.objectId ? null : target.mediaId ?? null, target.outputType ?? null,
    target.accessScope ?? null]);
}

/** Recover grouping from durable user messages if the auxiliary queue cache was lost. */
export function assistantHistoryTarget(content: string, sessionId: string | null): AssistantTarget | undefined {
  const envelope = readWorkspaceMessage(content);
  const context = envelope.status === 'valid' ? envelope.context : content;
  const match = /^\[媒体工作台上下文：(\{[^\n]*\})\]\n/.exec(context);
  if (!match) return;
  try {
    const value = JSON.parse(match[1]);
    if (typeof value.project_id !== 'string') return;
    return { projectId: value.project_id, sessionId, surface: value.surface ?? 'media',
      objectId: value.object_id, mediaId: value.media_id, outputType: value.output_type,
      label: '', context };
  } catch { return; }
}
