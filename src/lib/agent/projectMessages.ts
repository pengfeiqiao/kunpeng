import type { Message } from '@/types';
import type { AgentMessage } from './types';
import { hasDegradedCompactedHistory } from './contextCompaction';

/**
 * Project UI Message[] back into AgentMessage[] when the canonical
 * `kunpeng-agent-messages-{sid}` entry has been lost (storage eviction,
 * dev↔prod origin switch, etc.).
 *
 * UI messages don't preserve tool_calls; we only recover the
 * user/assistant text turns. The agent loses tool history but keeps
 * conversational memory — which is what the user perceives as
 * "remembering what we talked about".
 *
 * Skips system messages (the coordinator owns its own system prompt) and
 * empty content. Drops trailing assistant messages with no content.
 */
export function projectUIMessagesToAgentMessages(messages: Message[]): AgentMessage[] {
  const out: AgentMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    const content = (m.content ?? '').trim();
    if (!content) continue;
    if (m.role === 'user') {
      out.push({ role: 'user', content });
    } else if (m.role === 'assistant') {
      out.push({ role: 'assistant', content });
    }
  }
  return out;
}

/** Prefer visible conversation text when an old recursive summary has collapsed. */
export function recoverDegradedAgentHistory(
  saved: AgentMessage[],
  uiMessages: Message[],
): AgentMessage[] {
  if (!hasDegradedCompactedHistory(saved)) return saved;
  const projected = projectUIMessagesToAgentMessages(uiMessages);
  const projectedChars = projected.reduce(
    (total, message) => total + (typeof message.content === 'string' ? message.content.length : 0),
    0,
  );
  if (projected.length < 2 || projectedChars < 600) return saved;
  return projected;
}
