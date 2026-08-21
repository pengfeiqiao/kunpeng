export const COMPACTED_HISTORY_PREFIX = '[系统提示] 之前的对话过长，已被压缩为以下摘要。';
export const COMPACTED_HISTORY_ACK = '好的，我已了解之前的对话内容。请继续，我会基于以上摘要为你服务。';

export function truncateKeepingEnds(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const marker = `\n\n...[中间 ${text.length - maxChars} 字符已从摘要输入中省略；保留原始目标与最近状态]...\n\n`;
  const available = Math.max(0, maxChars - marker.length);
  const headChars = Math.floor(available * 0.55);
  const tailChars = available - headChars;
  return `${text.slice(0, headChars)}${marker}${text.slice(-tailChars)}`;
}

export function isCompactedHistoryContent(content: unknown): content is string {
  return typeof content === 'string' && content.startsWith(COMPACTED_HISTORY_PREFIX);
}

export function unwrapCompactedHistory(content: string): string {
  const separator = content.indexOf('\n\n');
  const body = separator >= 0 ? content.slice(separator + 2) : content.slice(COMPACTED_HISTORY_PREFIX.length);
  // Older builds recursively summarized the wrapper itself. Remove those
  // synthetic wrapper/ack lines while preserving the actual structured facts.
  return body
    .split('\n')
    .filter((line) => !line.includes(COMPACTED_HISTORY_PREFIX) && !line.includes(COMPACTED_HISTORY_ACK))
    .join('\n')
    .trim();
}

/**
 * Older builds could recursively summarize the synthetic compacted-history
 * wrapper until a long conversation became a few hundred characters. That
 * payload is syntactically valid, so without an explicit quality check it
 * keeps winning over the much richer visible chat during restore.
 */
export function hasDegradedCompactedHistory(
  messages: Array<{ role?: string; content?: unknown }>,
): boolean {
  return messages.some((message) => {
    if (message.role !== 'user' || !isCompactedHistoryContent(message.content)) return false;
    const raw = message.content as string;
    const body = raw.slice(COMPACTED_HISTORY_PREFIX.length);
    const unwrapped = unwrapCompactedHistory(raw);
    return body.includes(COMPACTED_HISTORY_PREFIX) || unwrapped.length < 600;
  });
}

export function mergeCumulativeSummaries(
  previous: string[],
  delta: string,
  maxChars: number,
): string {
  const sections = [
    ...previous.filter(Boolean).map((text) => `## 已确认的既有历史\n${text}`),
    ...(delta.trim() ? [`## 本次新增历史\n${delta.trim()}`] : []),
  ];
  return truncateKeepingEnds(sections.join('\n\n') || '(无内容)', maxChars);
}
