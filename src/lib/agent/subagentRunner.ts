import type { ToolRegistry } from './toolRegistry';
import type {
  AgentDelegateRequest,
  AgentDelegateResult,
  AgentUserContentBlock,
  CoordinatorCallbacks,
  SubAgentEvent,
  ToolResult,
} from './types';

export interface SubagentCoordinator {
  run(input: string, callbacks: CoordinatorCallbacks, media?: AgentUserContentBlock[], runId?: string): Promise<void>;
  abort(): void;
}

export interface SubagentCoordinatorFactoryArgs {
  registry: ToolRegistry;
  parentAbortController: AbortController;
  idempotencyRunId: string;
  maxTurns: number;
  subagentDepth: 1;
}

export type SubagentCoordinatorFactory = (args: SubagentCoordinatorFactoryArgs) => SubagentCoordinator;

export interface SubagentRunnerOptions {
  parentRunId: string;
  parentRegistry: ToolRegistry;
  callbacks: CoordinatorCallbacks;
  createCoordinator: SubagentCoordinatorFactory;
  maxConcurrent?: number;
  maxTurns?: number;
  /** Test seam only; production keeps seconds as real seconds. */
  timeoutUnitMs?: number;
}

const DEFAULT_GROUPS = new Set(['read', 'generate']);
const NEVER_DELEGATE = new Set([
  'agent_delegate',
  'ask_user_question',
  'capability_api_config',
  'media_api_plugin',
  'memory_write',
  'schedule_cron',
  'browser_control',
  'browser_install',
  'todo_write',
]);

function hasPrefix(name: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => name.startsWith(prefix));
}

export function isSubagentToolAllowed(name: string, requestedGroups?: string[]): boolean {
  if (NEVER_DELEGATE.has(name)) return false;
  if (hasPrefix(name, ['canvas_', 'workshop_', 'timeline_', 'copywriting_', 'director_', 'touliu_'])) return false;

  const groups = requestedGroups?.length ? new Set(requestedGroups) : DEFAULT_GROUPS;
  if (groups.has('read') && (
    ['read_file', 'glob_search', 'grep_search', 'list_directory', 'task_status', 'image_recognition', 'apimart_route_status'].includes(name)
    || name === 'sleep'
  )) return true;
  if (groups.has('generate') && (
    ['image_generate', 'video_generate', 'doubao_speech_generate', 'aigc_optimize_prompt'].includes(name)
    || name.startsWith('custom-media:')
  )) return true;
  if (groups.has('web') && ['web_search', 'web_fetch'].includes(name)) return true;
  if (groups.has('files') && ['write_file', 'edit_file', 'bash', 'bash_read_output'].includes(name)) return true;
  if (groups.has('project') && name.startsWith('project_')) return true;
  return false;
}

export function buildSubagentHandoff(request: AgentDelegateRequest): string {
  return [
    '[子代理任务]',
    request.task,
    request.context ? `\n[交接上下文]\n${request.context}` : '',
    '\n[执行边界]\n独立完成这项任务；不要向用户追问，不要再次委派。只报告可验证结论和产物路径。',
  ].filter(Boolean).join('\n');
}

function redactSecrets(text: string): string {
  return text
    .replace(/(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,})/gi, '[已脱敏]')
    .replace(/([?&](?:api_?key|key|token|access_token)=)[^&\s"'<>]+/gi, '$1[已脱敏]')
    .replace(/("(?:apiKey|api_key|authorization|token)"\s*:\s*")[^"]+/gi, '$1[已脱敏]');
}

function cleanProgress(text: string, max = 240): string {
  const clean = redactSecrets(text)
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function collectArtifacts(result: ToolResult, artifacts: Set<string>): void {
  for (const media of result.media ?? []) {
    if (media.type !== 'text' && media.source.type === 'url') artifacts.add(redactSecrets(media.source.url));
  }
  const text = `${result.output ?? ''}\n${result.error ?? ''}`;
  for (const match of text.matchAll(/(?:file:\/\/)?(\/[\w .~@%+(),\-\/]+\.(?:png|jpe?g|webp|gif|mp4|mov|wav|mp3|md|txt|json|pdf))/gi)) {
    artifacts.add(redactSecrets(match[1].trim()));
  }
  for (const match of text.matchAll(/https?:\/\/[^\s"'<>]+/g)) artifacts.add(redactSecrets(match[0]));
}

interface ActiveChild {
  coordinator: SubagentCoordinator;
  controller: AbortController;
  done: Promise<void>;
  resolveDone: () => void;
  interrupt: () => void;
}

function makeActiveChild(
  coordinator: SubagentCoordinator,
  controller: AbortController,
  interrupt: () => void,
): ActiveChild {
  let resolveDone = () => {};
  const done = new Promise<void>((resolve) => { resolveDone = resolve; });
  return { coordinator, controller, done, resolveDone, interrupt };
}

export class SubagentRunner {
  private readonly options: Required<Pick<SubagentRunnerOptions, 'maxConcurrent' | 'maxTurns' | 'timeoutUnitMs'>> & SubagentRunnerOptions;
  private sequence = 0;
  private disposed = false;
  private readonly active = new Map<string, ActiveChild>();

  constructor(options: SubagentRunnerOptions) {
    this.options = {
      ...options,
      maxConcurrent: options.maxConcurrent ?? 3,
      maxTurns: options.maxTurns ?? 20,
      timeoutUnitMs: options.timeoutUnitMs ?? 1_000,
    };
  }

  getActiveCount(): number {
    return this.active.size;
  }

  async run(request: AgentDelegateRequest, parentSignal?: AbortSignal): Promise<AgentDelegateResult> {
    if (this.disposed) throw new Error('父任务已经结束，不能再启动子代理。');
    if (this.active.size >= this.options.maxConcurrent) {
      throw new Error(`同一父任务最多并行 ${this.options.maxConcurrent} 个子代理；请等待已有子任务结束后再委派。`);
    }

    const index = ++this.sequence;
    const id = `sub-${index}`;
    const runId = `${this.options.parentRunId}/${id}`;
    const controller = new AbortController();
    let coordinator: SubagentCoordinator | null = null;
    let resolveInterruption = () => {};
    const interrupted = new Promise<void>((resolve) => { resolveInterruption = resolve; });
    const abortFromParent = () => {
      coordinator?.abort();
      controller.abort(parentSignal?.reason);
      resolveInterruption();
    };
    if (parentSignal?.aborted) abortFromParent();
    else parentSignal?.addEventListener('abort', abortFromParent, { once: true });

    const registry = this.options.parentRegistry.project((tool) =>
      isSubagentToolAllowed(tool.definition.name, request.toolGroups),
    );
    coordinator = this.options.createCoordinator({
      registry,
      parentAbortController: controller,
      idempotencyRunId: this.options.parentRunId,
      maxTurns: this.options.maxTurns,
      subagentDepth: 1,
    });
    if (controller.signal.aborted) coordinator.abort();
    const active = makeActiveChild(coordinator, controller, resolveInterruption);
    this.active.set(runId, active);

    const emit = (text: string, event: SubAgentEvent) => this.options.callbacks.onSubAgentDelta?.(text, event);
    emit('', { type: 'start', id, runId, task: request.task });

    const artifacts = new Set<string>();
    let conclusion = '';
    let failureMessage = '';
    let timedOut = false;
    let acceptsEvents = true;
    let progressBuffer = '';
    const timeoutSec = Math.min(1800, Math.max(1, request.timeoutSec ?? 600));
    const timeoutMs = timeoutSec * this.options.timeoutUnitMs;
    const timer = setTimeout(() => {
      timedOut = true;
      coordinator.abort();
      controller.abort(new DOMException('Subagent timed out', 'TimeoutError'));
      resolveInterruption();
    }, timeoutMs);

    const flushProgress = () => {
      const text = cleanProgress(progressBuffer);
      progressBuffer = '';
      if (text && acceptsEvents) emit(text, { type: 'progress', id, runId, text });
    };

    const callbacks: CoordinatorCallbacks = {
      onTextDelta: (text) => {
        if (!acceptsEvents) return;
        conclusion += text;
        progressBuffer += text;
        if (progressBuffer.length >= 240 || progressBuffer.includes('\n')) flushProgress();
      },
      onThinkingDelta: () => {},
      onProgressText: (_raw, display) => {
        if (!acceptsEvents) return;
        const text = cleanProgress(display ?? _raw);
        if (text) emit(text, { type: 'progress', id, runId, text });
      },
      onToolStart: (toolName) => {
        if (acceptsEvents) emit('', { type: 'tool_start', id, runId, toolName });
      },
      onToolEnd: (toolName, result) => {
        if (!acceptsEvents) return;
        collectArtifacts(result, artifacts);
        emit('', { type: 'tool_end', id, runId, toolName, success: result.success });
      },
      onComplete: (text) => {
        if (acceptsEvents && text.trim()) conclusion = text;
      },
      onError: (error) => {
        if (acceptsEvents) failureMessage = error.message;
      },
      onToolConfirm: this.options.callbacks.onToolConfirm,
      onContextUsage: () => {},
    };

    try {
      const childRun = (async () => {
        try {
          if (!controller.signal.aborted) {
            await coordinator.run(buildSubagentHandoff(request), callbacks, [], runId);
          }
        } catch (error) {
          if (acceptsEvents) failureMessage = error instanceof Error ? error.message : String(error);
        }
      })();
      await Promise.race([childRun, interrupted]);
      flushProgress();
      acceptsEvents = false;
      // An abort-compliant coordinator settles promptly. This catch prevents a
      // broken provider adapter from surfacing an unhandled late rejection
      // after the parent has already received an explicit terminal state.
      void childRun.catch(() => {});
      const status = timedOut
        ? 'timeout'
        : controller.signal.aborted || parentSignal?.aborted
          ? 'aborted'
          : failureMessage
            ? 'failed'
            : 'completed';
      const error = timedOut
        ? `子代理超过 ${timeoutSec} 秒，已停止。`
        : failureMessage || undefined;
      const result: AgentDelegateResult = {
        status,
        runId,
        conclusion: cleanProgress(conclusion, 8_000),
        artifacts: [...artifacts],
        ...(error ? { error } : {}),
      };
      emit('', { type: 'terminal', id, runId, status, conclusion: result.conclusion, error });
      return result;
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abortFromParent);
      this.active.delete(runId);
      active.resolveDone();
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const children = [...this.active.values()];
    for (const child of children) {
      child.coordinator.abort();
      child.controller.abort(new DOMException('Parent run disposed', 'AbortError'));
      child.interrupt();
    }
    await Promise.allSettled(children.map((child) => child.done));
  }
}
