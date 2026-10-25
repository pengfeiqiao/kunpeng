import type { AgentMessage } from './types.ts';

export interface InterruptedToolState {
  toolName: string;
  status: 'running' | 'completed' | 'error';
  result?: { success?: boolean; output?: string; error?: string };
}

export interface InterruptedTurnCheckpoint {
  userRequest: string;
  filePaths?: string[];
  partialAssistant?: string;
  tools?: InterruptedToolState[];
  unfinishedTodos?: string[];
}

function textOf(content: AgentMessage['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((block) => block.type === 'text' ? block.text : '').filter(Boolean).join('\n');
}

function compactLine(value: string | undefined, max = 240): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function toolCheckpointLines(tools: InterruptedToolState[]): string[] {
  return tools.map((tool) => {
    if (tool.status === 'running') {
      return `- [结果未知，需先核验] ${tool.toolName}：停止时已发起，不得盲目重试有副作用的操作`;
    }
    if (tool.status === 'error' || tool.result?.success === false) {
      return `- [失败] ${tool.toolName}${compactLine(tool.result?.error) ? `：${compactLine(tool.result?.error)}` : ''}`;
    }
    const evidence = compactLine(tool.result?.output);
    return `- [已完成] ${tool.toolName}${evidence ? `：${evidence}` : ''}`;
  });
}

export function buildInterruptedResumeContext(checkpoint: InterruptedTurnCheckpoint): string {
  const tools = checkpoint.tools ?? [];
  const todos = checkpoint.unfinishedTodos ?? [];
  const sections = [
    '[中断任务恢复检查点]',
    `原始任务：${checkpoint.userRequest.trim() || '（未记录）'}`,
    '请从下列状态继续：先核对现状，不要重复已完成的步骤；已发起但结果未知的写操作必须先查状态。',
  ];
  if (checkpoint.filePaths?.length) sections.push('原始附件：', ...checkpoint.filePaths.map((path) => `- ${path}`));
  if (tools.length) sections.push('工具执行状态：', ...toolCheckpointLines(tools));
  if (todos.length) sections.push('未完成待办：', ...todos.map((todo) => `- ${todo}`));
  const partial = checkpoint.partialAssistant?.trim();
  if (partial) sections.push('停止前可见草稿（未完成，仅供续写定位）：', partial.slice(-4_000));
  return sections.join('\n');
}

/** Append a durable, model-visible closer for a stopped turn. */
export function appendInterruptedTurnCheckpoint(
  messages: AgentMessage[],
  checkpoint: InterruptedTurnCheckpoint,
): AgentMessage[] {
  const next = [...messages];
  const request = checkpoint.userRequest.trim();
  const lastUser = [...next].reverse().find((message) => message.role === 'user');
  // Harness turns are not recorded in the Coordinator until they complete.
  // Preserve the active user request before adding the interruption closer.
  if (request && (!lastUser || !textOf(lastUser.content).includes(request))) {
    next.push({ role: 'user', content: request });
  }
  next.push({ role: 'assistant', content: buildInterruptedResumeContext(checkpoint) });
  return next;
}
