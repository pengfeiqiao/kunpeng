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

/** Index durable receipt identities once; draft keystrokes do not alter this projection. */
export function projectAssistantHistory(
  messages: readonly { id: string; role: string; content: string }[],
  items: readonly import('./projectAssistantQueue.ts').AssistantQueueItem[],
  sessionId: string | null,
  serialize: (target: AssistantTarget, prompt: string) => string,
): Map<string, string | undefined> {
  const owners = new Map<string, AssistantTarget>();
  const exact = new Map<string, AssistantTarget>();
  const current = items.filter(item => item.target.sessionId === sessionId);
  for (const item of current) {
    for (const id of item.messageIds ?? []) if (!owners.has(id)) owners.set(id, item.target);
    for (const text of [serialize(item.target, item.prompt), item.target.context + item.prompt]) {
      if (!exact.has(text)) exact.set(text, item.target);
    }
  }
  const result = new Map<string, string | undefined>();
  let turnTarget: AssistantTarget | undefined;
  for (const message of messages) {
    const owner = owners.get(message.id);
    if (message.role === 'user') {
      // Explicit receipts are authoritative; prose matching only repairs legacy caches.
      turnTarget = owner ?? exact.get(message.content)
        ?? current.find(item => message.content.endsWith(item.prompt) && message.content.includes(item.target.context.trim()))?.target
        ?? assistantHistoryTarget(message.content, sessionId);
    }
    const thread = owner ?? turnTarget;
    result.set(message.id, thread ? assistantConversationKey(thread) : undefined);
  }
  return result;
}

export function visibleAssistantHistory(index: ReadonlyMap<string, string | undefined>, target: AssistantTarget,
  sessionProjectId: string | undefined): Set<string> {
  const result = new Set<string>();
  if (sessionProjectId !== target.projectId) return result;
  const key = assistantConversationKey(target);
  for (const [id, thread] of index) if (thread === key || (!target.objectId && thread === undefined)) result.add(id);
  return result;
}
