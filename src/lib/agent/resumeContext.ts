export interface ResumeTodoLike {
  content: string;
  status: string;
}

export interface ResumeContextInput {
  todos: ResumeTodoLike[];
  agentMessages?: unknown[];
  uiMessages?: unknown[];
  maxArtifacts?: number;
}

const ABSOLUTE_PATH_RE = /\/(?:Users|Volumes|private|tmp|var|opt|Applications)\/[\w\-.~/%+@ ()\u4e00-\u9fff]+/g;
const TERMINAL_PUNCTUATION = /[\s\n\r\t'"`<>\]}),，。；：]+$/;

function collectStrings(value: unknown, out: string[], seen: WeakSet<object>, depth: number): void {
  if (depth > 7) return;
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 100)) collectStrings(item, out, seen, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    if (/^(content|output|error|filePaths|path|localPath|outputPath|result|metadata|toolExecutions|source)$/i.test(key)) {
      collectStrings(child, out, seen, depth + 1);
    }
  }
}

export function extractResumeArtifactPaths(values: unknown[], limit = 20): string[] {
  const strings: string[] = [];
  const seenObjects = new WeakSet<object>();
  for (const value of values) collectStrings(value, strings, seenObjects, 0);
  const paths = new Set<string>();
  for (const text of strings) {
    for (const match of text.matchAll(ABSOLUTE_PATH_RE)) {
      const path = match[0].replace(TERMINAL_PUNCTUATION, '').trim();
      if (path && /\.[A-Za-z0-9]{1,8}$/.test(path)) paths.add(path);
      if (paths.size >= limit) return [...paths];
    }
  }
  return [...paths];
}

/** Transient context for the first turn after restoring an ordinary chat. */
export function buildTaskResumeContext(input: ResumeContextInput): string | null {
  const unfinished = input.todos.filter((todo) => todo.status !== 'completed' && todo.content.trim());
  const artifacts = extractResumeArtifactPaths(
    [...(input.agentMessages ?? []), ...(input.uiMessages ?? [])],
    input.maxArtifacts ?? 20,
  );
  if (unfinished.length === 0 && artifacts.length === 0) return null;
  const sections = [
    '[任务恢复上下文]',
    '这是会话恢复后的临时状态，只用于继续原任务；先核对现状，不要重复已完成或已付费的生成。',
  ];
  if (unfinished.length > 0) {
    sections.push('未完成待办：', ...unfinished.map((todo) => `- [${todo.status}] ${todo.content.trim()}`));
  }
  if (artifacts.length > 0) {
    sections.push('已有产物：', ...artifacts.map((path) => `- ${path}`));
  }
  return sections.join('\n');
}

/** One-shot session contexts. Switching away does not discard another task's resume state. */
export class TaskResumeContextQueue {
  private readonly contexts = new Map<string, string>();

  stage(sessionId: string, context: string | null): void {
    if (!sessionId) return;
    if (context?.trim()) this.contexts.set(sessionId, context.trim());
    else this.contexts.delete(sessionId);
  }

  consume(sessionId: string | null | undefined): string | null {
    if (!sessionId) return null;
    const context = this.contexts.get(sessionId) ?? null;
    this.contexts.delete(sessionId);
    return context;
  }

  /** Put an undelivered context back without overwriting a newer restore. */
  restore(sessionId: string | null | undefined, context: string | null): void {
    if (!sessionId || !context?.trim() || this.contexts.has(sessionId)) return;
    this.contexts.set(sessionId, context.trim());
  }
}
