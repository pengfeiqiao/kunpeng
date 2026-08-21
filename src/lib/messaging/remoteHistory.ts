import type { AgentMessage } from '@/lib/agent/types';

const MAX_MESSAGES = 80;
const MAX_TEXT_CHARS = 20_000;
const MAX_TOOL_CHARS = 6_000;

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n[较早内容已截断]`;
}

/**
 * Keep remote-channel sessions useful across restarts without persisting
 * unbounded tool output, model reasoning, or local media payloads.
 */
export function compactRemoteHistory(messages: AgentMessage[]): AgentMessage[] {
  const withoutSystem = messages.filter((message) => message.role !== 'system');
  let start = Math.max(0, withoutSystem.length - MAX_MESSAGES);
  while (start < withoutSystem.length && withoutSystem[start].role !== 'user') start += 1;
  const selected = withoutSystem.slice(start < withoutSystem.length ? start : 0);

  return selected.map((message): AgentMessage => {
    if (message.role === 'user') {
      if (typeof message.content === 'string') {
        return { role: 'user', content: truncate(message.content, MAX_TEXT_CHARS) };
      }
      return {
        role: 'user',
        content: message.content.map((block) => block.type === 'text'
          ? { type: 'text' as const, text: truncate(block.text, MAX_TEXT_CHARS) }
          : { type: 'text' as const, text: `[${block.type === 'video' ? '视频' : '图片'}附件未写入远程会话历史]` }),
      };
    }
    if (message.role === 'assistant') {
      return {
        role: 'assistant',
        content: message.content ? truncate(message.content, MAX_TEXT_CHARS) : message.content,
        tool_calls: message.tool_calls,
      };
    }
    if (message.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: message.tool_call_id,
        content: truncate(message.content, MAX_TOOL_CHARS),
      };
    }
    return message;
  });
}
