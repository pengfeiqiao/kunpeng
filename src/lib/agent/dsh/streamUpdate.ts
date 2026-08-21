export type DshStreamUpdate =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_call' }
  | { type: 'usage'; used: number; size: number }
  | { type: 'compaction'; phase: 'start' | 'summary' | 'end'; failed: boolean }
  | { type: 'unknown' };

function updateText(update: Record<string, unknown>): string {
  const content = update.content as { type?: string; text?: string } | undefined;
  return content?.type === 'text' ? content.text || '' : '';
}

/** Convert official ACP session/update payloads into Kunpeng's stable UI vocabulary. */
export function parseDshStreamUpdate(update: Record<string, unknown>): DshStreamUpdate {
  const kind = String(update.sessionUpdate || '');
  if (kind === 'agent_message_chunk') return { type: 'text', text: updateText(update) };
  if (kind === 'agent_thought_chunk') return { type: 'thinking', text: updateText(update) };
  if (kind === 'tool_call') return { type: 'tool_call' };
  if (kind === 'usage_update') {
    const used = Number(update.used);
    const size = Number(update.size);
    if (Number.isFinite(used) && Number.isFinite(size) && size > 0) {
      return { type: 'usage', used, size };
    }
  }
  if (kind === 'kunpeng_compaction') {
    const phase = String(update.phase || '');
    if (phase === 'start' || phase === 'summary' || phase === 'end') {
      return { type: 'compaction', phase, failed: update.failed === true };
    }
  }
  return { type: 'unknown' };
}
