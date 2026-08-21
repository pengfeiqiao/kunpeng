/**
 * sanitizeOpenAIToolPairing — OpenAI 兼容端点的 tool 配对安全网（纯函数）。
 *
 * OpenAI 对两个方向都会 400：
 * - assistant 带了 tool_calls，但后续没有凑齐对应的 tool 结果消息
 * - tool 结果消息找不到对应的 assistant tool_call
 *
 * 中止（abort）恰好会持久化出这种序列（见 coordinator 的
 * cleanupIncompleteToolPairs / repairToolPairingSnapshot；Anthropic 客户端有
 * 自己的 sanitizeToolPairing）。策略：assistant 的调用没有全部应答时，同时
 * 丢弃它的 tool_calls 和已应答的部分结果——损失一轮退化上下文，好过会话
 * 永久 400。
 */

import type { AgentMessage } from '../types.ts';

export function sanitizeOpenAIToolPairing(messages: AgentMessage[]): unknown[] {
  const out: unknown[] = [];
  let pendingIds = new Set<string>();
  let pendingAssistant: Record<string, unknown> | null = null;
  let pendingToolMsgs: unknown[] = [];

  const closePending = () => {
    if (pendingAssistant && pendingIds.size > 0) {
      delete pendingAssistant.tool_calls;
      for (const tm of pendingToolMsgs) {
        const i = out.indexOf(tm);
        if (i >= 0) out.splice(i, 1);
      }
    }
    pendingIds = new Set();
    pendingAssistant = null;
    pendingToolMsgs = [];
  };

  for (const m of messages) {
    if (m.role === 'assistant') {
      closePending();
      const msg: Record<string, unknown> = {
        role: 'assistant',
        content: m.content ?? '',
      };
      if (m.tool_calls?.length) {
        msg.tool_calls = m.tool_calls;
        pendingIds = new Set(m.tool_calls.map((c) => c.id).filter(Boolean));
        pendingAssistant = msg;
      }
      out.push(msg);
      continue;
    }
    if (m.role === 'tool') {
      if (m.tool_call_id && pendingIds.has(m.tool_call_id)) {
        pendingIds.delete(m.tool_call_id);
        const tm = { role: 'tool', tool_call_id: m.tool_call_id, content: m.content };
        pendingToolMsgs.push(tm);
        out.push(tm);
      }
      // else: orphan tool result — dropped
      continue;
    }
    closePending();
    out.push({ role: m.role, content: m.content });
  }
  closePending();
  return out;
}
