import type {
  AgentMessage,
  AgentUserContentBlock,
  CoordinatorCallbacks,
  ToolCall,
} from './types';
import type { GLMClient } from './glmClient';
import type { ToolRegistry } from './toolRegistry';
import { ContextManager } from './contextManager';
import { buildSystemPrompt, type OutputStyle } from './systemPrompt';
import { agentLog } from './logger';
import { createAbortController, createChildAbortController } from './abortController';
import { chatWithFallback, streamWithFallback, type RouteStrategy } from './providers/router';
import { firePreToolUse, firePostToolUse } from './hooks';
import { findRelevantMemories, loadMemoryBodies } from './findRelevantMemories';
import { shouldAutoCompact, recordAutoCompactAttempt, getEffectiveContextWindowSize } from './autoCompact';
import { getProvider } from './providers/registry';
import { sanitizeProgressText } from './toolSummary';
import { buildTemporalTurnContext, isTimeSensitiveQuery } from './temporalContext';
import { terminalToolResults } from './completionGuard';

export interface CoordinatorConfig {
  glmClient: GLMClient;
  toolRegistry: ToolRegistry;
  cwd: string;
  os?: string;
  shell?: string;
  maxTurns?: number;
  skillDescriptions?: string;
  /** Rebuild the compact skill catalog for the current request and workspace. */
  skillDescriptionResolver?: (query: string) => string | undefined;
  /**
   * Resolve a transient per-run skill-relevance notice. Delivered as a
   * one-run user-message attachment (like memory), never enters the system
   * prompt, keeping the cached prefix byte-stable across turns.
   */
  skillNoticeResolver?: (query: string) => string | null;
  workspace?: string;
  customRules?: string;
  /**
   * When set, this coordinator's abort controller is created as a CHILD
   * of the parent, so aborting the parent propagates to this instance.
   * Used by agentTool to halt sub-agents when the user stops the parent.
   */
  parentAbortController?: AbortController;
  /**
   * Optional provider-router strategy. When provided, streaming goes through
   * the router (with fallback chain). When absent, we fall back to calling
   * `glmClient.streamChat()` directly — keeps the old single-provider path
   * working until all call sites pass a strategy.
   *
   * Compaction still uses `glmClient.chat()` directly (non-streaming, low
   * risk of failure, not worth routing for now).
   */
  routeStrategy?: RouteStrategy;
  /** Tier 4: response tone/style override. Defaults to 'default' (no extra). */
  outputStyle?: OutputStyle;
  /** 生图 API 上下文（注入 system prompt） */
  imageApiContext?: string;
  /** RunningHub API 上下文 */
  runninghubContext?: string;
  /** AIGC 记忆与导演视角上下文 */
  aigcMemoryContext?: string;
}

// Read-only tools that can safely run in parallel. Mutating tools are serial
// unless the tool explicitly supplies a resource-scoped concurrency key.
const READ_ONLY_TOOLS = new Set(['read_file', 'glob_search', 'grep_search', 'list_directory']);
const LIVE_FILESYSTEM_TOOLS = new Set(['read_file', 'glob_search', 'grep_search', 'list_directory']);

function stableToolParams(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableToolParams).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableToolParams(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Repair a possibly mid-tool-execution history snapshot (pure — for abort
 * snapshots taken before the run loop's own cleanup settles). Mirrors
 * cleanupIncompleteToolPairs: synthesizes is_error results for tool_calls
 * whose results never landed, so the snapshot is API-legal for both
 * Anthropic and OpenAI style endpoints.
 */
export function repairToolPairingSnapshot(messages: AgentMessage[]): AgentMessage[] {
  let assistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant' && (msg as { tool_calls?: unknown[] }).tool_calls) {
      assistantIdx = i;
      break;
    }
    if (msg.role === 'user') break;
  }
  if (assistantIdx === -1) return messages;

  const assistantMsg = messages[assistantIdx] as { tool_calls?: { id: string }[] };
  const expectedIds = new Set(assistantMsg.tool_calls?.map((tc) => tc.id) || []);
  const actualIds = new Set<string>();
  for (let i = assistantIdx + 1; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'tool') actualIds.add((msg as { tool_call_id: string }).tool_call_id);
  }
  if (expectedIds.size === actualIds.size) return messages;

  const repaired = messages.slice();
  for (const id of expectedIds) {
    if (!actualIds.has(id)) {
      repaired.push({
        role: 'tool',
        tool_call_id: id,
        content: JSON.stringify({ error: '工具执行被中断（用户中止或发生错误）', is_error: true }),
      });
    }
  }
  return repaired;
}

/**
 * Agent Coordinator — 核心对话循环
 *
 * 流程:
 * 1. 接收用户输入 → 追加到 messages
 * 2. 调用 GLM-5 streamChat() → 流式输出文本 + 收集 tool_calls
 * 3. 若有 tool_calls → 执行（只读工具并行，资源互不冲突的生成可并行，其余写工具串行） → 结果追加到 messages → 回到步骤 2
 * 4. 若无 tool_calls → 对话轮结束
 * 5. maxTurns 限制防死循环
 */
export class AgentCoordinator {
  private messages: AgentMessage[] = [];
  private abortController: AbortController | null = null;
  private config: Required<Pick<CoordinatorConfig, 'maxTurns'>> & CoordinatorConfig;
  private contextManager: ContextManager;
  private isRunning = false;
  /** Invalidates async history restoration when a newer restore/run/clear wins. */
  private historyRevision = 0;
  private currentCallbacks: CoordinatorCallbacks | null = null;
  // Transient per-run memory addendum. Appended to the outbound message list
  // at request time but NEVER pushed into this.messages — keeps recalled
  // memories out of the persisted history (CC-style attachment pattern).
  private transientMemory: AgentMessage | null = null;
  private transientTemporalContext: AgentMessage | null = null;
  // Transient per-run skill-relevance notice (query-dependent, so it must
  // NOT live in the system prompt — same attachment pattern as memory).
  private transientSkillNotice: AgentMessage | null = null;
  /**
   * One-shot transient notices (e.g. turn-budget warning). Included in the
   * next outbound request only, then cleared — never persisted into history.
   */
  private transientOnce: AgentMessage[] = [];
  private pendingGuidance: Array<{ text: string; mediaBlocks: AgentUserContentBlock[] }> = [];

  /**
   * A repeated live-filesystem call supersedes an older call with identical
   * parameters. Keeping both full snapshots in model context is dangerous:
   * the older one can look internally consistent and win the model's
   * attention even though a newer disk read exists.
   */
  private supersedeOldFilesystemResults(
    prepared: Array<{ call: ToolCall; params: Record<string, unknown>; skip?: string }>,
  ): void {
    const currentIds = new Set(prepared.map((item) => item.call.id));
    const latestSignatures = new Map<string, string>();
    for (const item of prepared) {
      if (item.skip || !LIVE_FILESYSTEM_TOOLS.has(item.call.function.name)) continue;
      latestSignatures.set(
        `${item.call.function.name}:${stableToolParams(item.params)}`,
        item.call.id,
      );
    }
    if (latestSignatures.size === 0) return;

    const staleIds = new Map<string, string>();
    for (const message of this.messages) {
      if (message.role !== 'assistant' || !message.tool_calls) continue;
      for (const call of message.tool_calls) {
        if (currentIds.has(call.id) || !LIVE_FILESYSTEM_TOOLS.has(call.function.name)) continue;
        let params: Record<string, unknown> = {};
        try { params = JSON.parse(call.function.arguments); } catch { /* keep empty */ }
        const signature = `${call.function.name}:${stableToolParams(params)}`;
        if (latestSignatures.has(signature)) staleIds.set(call.id, call.function.name);
      }
    }
    if (staleIds.size === 0) return;
    this.messages = this.messages.map((message) => {
      if (message.role !== 'tool' || !staleIds.has(message.tool_call_id)) return message;
      return {
        ...message,
        content: `[旧结果已失效：${staleIds.get(message.tool_call_id)} 已用相同参数重新扫描实时磁盘，请只使用后续最新结果。]`,
      };
    });
  }

  constructor(config: CoordinatorConfig) {
    this.config = {
      ...config,
      maxTurns: config.maxTurns ?? 30,
    };
    this.contextManager = new ContextManager();
    // 根据当前模型设置正确的上下文窗口
    const { effectiveWindow } = this.resolveModelAndWindow();
    this.contextManager.updateMaxTokens(effectiveWindow);
    this.messages = [{ role: 'system', content: this.buildPrompt() }];
  }

  /** 获取当前运行中的回调 */
  getCurrentCallbacks(): CoordinatorCallbacks | null {
    return this.currentCallbacks;
  }

  /** Queue a user correction while the current model/tool turn is still active. */
  queueGuidance(text: string, mediaBlocks: AgentUserContentBlock[] = []): boolean {
    const cleaned = text.trim();
    if (!this.isRunning || (!cleaned && mediaBlocks.length === 0)) return false;
    this.pendingGuidance.push({ text: cleaned, mediaBlocks });
    const preview = cleaned.replace(/\s+/g, ' ').slice(0, 72);
    this.currentCallbacks?.onProgressText?.(
      '',
      `收到你的补充${preview ? `：“${preview}${cleaned.length > 72 ? '…' : ''}”` : ''}。我会先让当前操作安全结束，再把它并入下一步判断；现有进度不会重启。`,
    );
    return true;
  }

  private flushPendingGuidance(): number {
    const queued = this.pendingGuidance.splice(0);
    for (const item of queued) {
      this.messages.push({
        role: 'user',
        content: item.mediaBlocks.length > 0
          ? [...item.mediaBlocks, { type: 'text', text: item.text }]
          : item.text,
      });
    }
    return queued.length;
  }

  /**
   * 根据当前的 RouteStrategy 或 glmClient 配置，解析出实际使用的模型 ID
   * 和对应的有效上下文窗口大小。用于动态更新 ContextManager 的 maxTokens。
   */
  private resolveModelAndWindow(): { modelId: string; effectiveWindow: number } {
    let modelId: string;
    let providerId: string | undefined;
    if (this.config.routeStrategy) {
      const s = this.config.routeStrategy;
      if (s.kind === 'primary') {
        providerId = s.providerId;
        modelId = s.modelId ?? getProvider(s.providerId)?.defaultModelId ?? 'glm-5.1';
      } else if (s.kind === 'fallback_chain' && s.chain[0]) {
        providerId = s.chain[0].providerId;
        modelId = s.chain[0].modelId ?? getProvider(s.chain[0].providerId)?.defaultModelId ?? 'glm-5.1';
      } else {
        modelId = 'glm-5.1';
      }
    } else {
      modelId = (this.config.glmClient as unknown as { config?: { model?: string } })
        .config?.model ?? 'glm-5.1';
    }
    const declaredWindow = providerId
      ? getProvider(providerId)?.models.find((model) => model.id === modelId)?.contextWindow
      : undefined;
    return {
      modelId,
      effectiveWindow: getEffectiveContextWindowSize(modelId, declaredWindow),
    };
  }

  private resolvePrimaryProviderId(): string | undefined {
    const s = this.config.routeStrategy;
    if (!s) return 'glm';
    if (s.kind === 'primary') return s.providerId;
    if (s.kind === 'fallback_chain') return s.chain[0]?.providerId;
    return undefined;
  }

  private hardContextBudget(): number {
    const { effectiveWindow } = this.resolveModelAndWindow();
    // Reserve room for completion tokens, tool schema overhead, provider-side
    // message framing, and tokenizer differences. DeepSeek's API rejects the
    // whole request when messages + max_tokens exceed the model limit.
    return Math.floor(effectiveWindow * (effectiveWindow >= 900_000 ? 0.94 : 0.72));
  }

  private enforceHardContextBudget(reason: string): void {
    const before = this.contextManager.estimateMessages(this.messages);
    const budget = this.hardContextBudget();
    if (before <= budget) return;
    this.messages = this.contextManager.hardClamp(this.messages, budget);
    const after = this.contextManager.estimateMessages(this.messages);
    agentLog.warn('Coordinator', `Hard context budget enforced (${reason}): ${before} → ${after}/${budget}`);
  }

  /** 构建完整系统提示词（单一来源，避免参数遗漏） */
  private buildPrompt(): string {
    return buildSystemPrompt({
      cwd: this.config.cwd,
      os: this.config.os || 'macOS',
      shell: this.config.shell || 'zsh',
      skillDescriptions: this.config.skillDescriptions,
      workspace: this.config.workspace,
      customRules: this.config.customRules,
      outputStyle: this.config.outputStyle,
      imageApiContext: this.config.imageApiContext,
      runninghubContext: this.config.runninghubContext,
      aigcMemoryContext: this.config.aigcMemoryContext,
      primaryProviderId: this.resolvePrimaryProviderId(),
    });
  }

  /**
   * Build the request-scoped context consumed by the external DeepSeek
   * Harness. This intentionally reuses the same prompt, skill, temporal and
   * memory policies as the built-in loop without changing that loop.
   */
  async buildHarnessTurnContext(userInput: string): Promise<{
    systemPrompt: string;
    turnContext: string;
  }> {
    this.refreshScopedSkills(userInput);
    const additions: string[] = [];
    if (isTimeSensitiveQuery(userInput)) additions.push(buildTemporalTurnContext());
    try {
      const notice = this.config.skillNoticeResolver?.(userInput);
      if (notice) additions.push(notice);
    } catch (err) {
      agentLog.debug('Coordinator', 'Harness skill notice skipped', err);
    }
    try {
      const ranked = await findRelevantMemories(userInput, 4);
      if (ranked.length > 0) {
        const bodies = await loadMemoryBodies(ranked);
        if (bodies.length > 0) {
          additions.push(`[相关记忆 — 仅用于本轮参考，无需回应此消息]\n\n${bodies.join('\n\n---\n\n')}`);
        }
      }
    } catch (err) {
      agentLog.debug('Coordinator', 'Harness memory recall skipped', err);
    }
    return {
      systemPrompt: this.buildPrompt(),
      turnContext: additions.join('\n\n'),
    };
  }

  /** Keep existing session persistence authoritative after a DSH turn. */
  recordHarnessTurn(
    userInput: string,
    assistantText: string,
    reasoning?: string,
    mediaBlocks: AgentUserContentBlock[] = [],
  ): void {
    this.messages.push({
      role: 'user',
      content: mediaBlocks.length > 0
        ? [...mediaBlocks, { type: 'text', text: userInput }]
        : userInput,
    });
    this.messages.push({
      role: 'assistant',
      content: assistantText,
      ...(reasoning ? { reasoning_content: reasoning } : {}),
    });
    this.enforceHardContextBudget('harness-turn');
  }

  private refreshScopedSkills(query: string): void {
    const resolver = this.config.skillDescriptionResolver;
    if (!resolver) return;
    const next = resolver(query);
    if (next === this.config.skillDescriptions) return;
    this.config.skillDescriptions = next;
    this.refreshSystemPrompt();
  }

  private getCompactChatClient() {
    if (!this.config.routeStrategy) {
      return this.config.glmClient;
    }
    return {
      chat: (
        messages: { role: string; content: string }[],
        options?: { maxTokens?: number },
      ) =>
        chatWithFallback(
          this.config.routeStrategy!,
          { messages, maxTokens: options?.maxTokens },
          {
            source: 'background',
            signal: this.abortController?.signal,
          },
          this.abortController?.signal,
        ),
    };
  }

  /** 刷新系统提示词（用于 MCP 工具动态加载后更新，保留对话历史） */
  refreshSystemPrompt(): void {
    const systemPrompt = this.buildPrompt();
    if (this.messages.length > 0 && this.messages[0].role === 'system') {
      this.messages[0] = { role: 'system', content: systemPrompt };
    } else {
      this.messages.unshift({ role: 'system', content: systemPrompt });
    }
  }

  /** 更新工作目录 */
  setCwd(cwd: string, workspace?: string): void {
    this.config.cwd = cwd;
    if (workspace !== undefined) this.config.workspace = workspace;
    this.refreshSystemPrompt();
  }

  /** Read-only workspace accessor for external Agent runtimes. */
  getCwd(): string {
    return this.config.cwd;
  }

  /** 更新 AIGC 导演视角上下文，刷新系统提示词 */
  setAigcMemoryContext(context: string | undefined): void {
    this.config.aigcMemoryContext = context;
    this.refreshSystemPrompt();
  }

  /** Refresh prompt-only settings without rebuilding or aborting this coordinator. */
  setRuntimePromptConfig(config: {
    customRules?: string;
    outputStyle?: OutputStyle;
    imageApiContext?: string;
    runninghubContext?: string;
    maxTurns?: number;
  }): void {
    this.config.customRules = config.customRules;
    this.config.outputStyle = config.outputStyle;
    this.config.imageApiContext = config.imageApiContext;
    this.config.runninghubContext = config.runninghubContext;
    if (config.maxTurns !== undefined) this.config.maxTurns = Math.max(1, config.maxTurns);
    this.refreshSystemPrompt();
  }

  /** Switch the LLM route for the next turn without losing conversation state. */
  setRouteStrategy(strategy: RouteStrategy | undefined): void {
    if (this.isRunning) {
      throw new Error('任务执行中不能切换模型，请先停止或等待完成。');
    }
    this.config.routeStrategy = strategy;
    const { effectiveWindow } = this.resolveModelAndWindow();
    this.contextManager.updateMaxTokens(effectiveWindow);
    this.refreshSystemPrompt();
  }

  /** 核心对话循环 */
  async run(
    userInput: string,
    callbacks: CoordinatorCallbacks,
    mediaBlocks: AgentUserContentBlock[] = [],
  ): Promise<void> {
    if (this.isRunning) {
      callbacks.onError(new Error('Coordinator is already running'));
      return;
    }

    // A restore may be awaiting LLM compaction. Once a real run starts its
    // eventual result must never replace the live conversation history.
    this.historyRevision += 1;
    this.isRunning = true;
    this.abortController = this.config.parentAbortController
      ? createChildAbortController(this.config.parentAbortController)
      : createAbortController();
    this.currentCallbacks = callbacks;

    try {
      this.refreshScopedSkills(userInput);
      this.transientTemporalContext = isTimeSensitiveQuery(userInput)
        ? { role: 'user', content: buildTemporalTurnContext() }
        : null;
      try {
        const notice = this.config.skillNoticeResolver?.(userInput);
        this.transientSkillNotice = notice ? { role: 'user', content: notice } : null;
      } catch (err) {
        agentLog.debug('Coordinator', 'skillNoticeResolver skipped', err);
        this.transientSkillNotice = null;
      }
      // Add user message
      this.messages.push({
        role: 'user',
        content: mediaBlocks.length > 0
          ? [...mediaBlocks, { type: 'text', text: userInput }]
          : userInput,
      });

      // Tier 2.3: pick 3-4 memories relevant to this user turn and inject
      // them as a transient addendum on the outbound request only. They are
      // not stored in this.messages, so history/persistence stay clean.
      // Keyword-scored only; failures are silent (memory is a nice-to-have).
      try {
        const ranked = await findRelevantMemories(userInput, 4);
        if (ranked.length > 0) {
          const bodies = await loadMemoryBodies(ranked);
          if (bodies.length > 0) {
            this.transientMemory = {
              role: 'user',
              content: `[相关记忆 — 仅用于本轮参考，无需回应此消息]\n\n${bodies.join('\n\n---\n\n')}`,
            };
          }
        }
      } catch (err) {
        agentLog.debug('Coordinator', 'findRelevantMemories skipped', err);
      }

      // Compact context if needed (with UI feedback)
      // Tier 2.1: resolve model-aware context window before compaction.
      // This correctly handles RouteStrategy-based providers (e.g. DeepSeek
      // with 1M context) rather than relying on glmClient.config.model which
      // reflects the old single-provider config.
      const { modelId, effectiveWindow } = this.resolveModelAndWindow();
      this.contextManager.updateMaxTokens(effectiveWindow);
      // Clear reproducible tool output and old media payloads silently. Only
      // show "整理上下文" when an actual LLM summary is about to run.
      this.messages = this.contextManager.microcompact(this.messages);
      const estimated = this.contextManager.estimateMessages(this.messages);
      agentLog.info(
        'Context',
        `Active model=${modelId}, effectiveWindow=${effectiveWindow}, estimated=${estimated}, hardBudget=${this.hardContextBudget()}`,
      );
      const autoCompact = shouldAutoCompact(estimated, modelId);
      if (autoCompact.compact) {
        agentLog.info('Coordinator', `auto-compact: ${autoCompact.reason}`);
        callbacks.onCompacting?.();
        this.messages = await recordAutoCompactAttempt(() =>
          this.contextManager.compact(this.messages, this.getCompactChatClient(), true),
        );
      }
      this.enforceHardContextBudget('run-start');

      let continuationText = '';
      let emptyFinalRetryCount = 0;
      let todoNudgeCount = 0;
      // Soft warning threshold: nudge the model to converge at ~70% of the
      // turn budget instead of hitting the hard maxTurns cutoff mid-task.
      const budgetWarnTurn = Math.floor(this.config.maxTurns * 0.7);
      for (let turn = 0; turn < this.config.maxTurns; turn++) {
        // Check if user aborted before each turn (including after tool execution)
        if (this.abortController?.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        this.flushPendingGuidance();
        // A tool may have switched workspaces during the previous turn.
        this.refreshScopedSkills(userInput);
        agentLog.info('Coordinator', `Turn ${turn + 1}/${this.config.maxTurns}`);
        if (turn === budgetWarnTurn && budgetWarnTurn > 0) {
          this.transientOnce.push({
            role: 'user',
            content: `[系统提醒 — 仅供你参考，无需回应此消息] 本次任务的工具轮次已用约 70%（${turn + 1}/${this.config.maxTurns}）。请收敛后续操作：优先完成最关键的剩余步骤，避免开启新的大范围操作，尽快给出最终答复。`,
          });
        }
        // Stream response from GLM-5
        const response = await this.streamToCompletion(callbacks);

        agentLog.info('Coordinator', `Turn ${turn + 1} finished: finish_reason=${response.finishReason}, toolCalls=${response.toolCalls.length}, textLen=${response.text.length}`);

        // Handle max_tokens truncation — model was cut off mid-output
        // Save what we have and ask the model to continue
        if (response.finishReason === 'max_tokens' && !response.toolCalls.length) {
          agentLog.warn('Coordinator', 'Response truncated by max_tokens, requesting continuation');
          continuationText += response.text || '';
          this.messages.push({
            role: 'assistant',
            content: response.text || '',
            ...(response.thinkingBlocks.length ? { thinking_blocks: response.thinkingBlocks } : {}),
          });
          this.messages.push({
            role: 'user',
            content: '继续',
          });
          continue;
        }

        // If no tool_calls, conversation turn is done
        if (!response.toolCalls.length) {
          const fullText = continuationText + (response.text || '');
          if (this.pendingGuidance.length > 0) {
            this.messages.push({
              role: 'assistant',
              content: response.text || '',
              ...(response.thinkingBlocks.length ? { thinking_blocks: response.thinkingBlocks } : {}),
            });
            const interimProgress = sanitizeProgressText(response.text || '');
            if (interimProgress) callbacks.onProgressText?.(response.text, interimProgress);
            this.flushPendingGuidance();
            continuationText = '';
            emptyFinalRetryCount = 0;
            continue;
          }
          if (!fullText.trim()) {
            if (emptyFinalRetryCount < 1) {
              emptyFinalRetryCount += 1;
              agentLog.warn('Coordinator', 'Model ended without display text; requesting a final user-facing answer');
              this.messages.push({
                role: 'user',
                content: '请基于已经完成的分析和工具结果，直接给用户一段清楚、完整的最终答复。不要只返回思考过程，也不要返回空内容。',
              });
              continue;
            }
            throw new Error('模型已结束任务，但连续两次没有返回可展示的回复。请重试或切换模型。');
          }
          // Unfinished-work guard (e.g. todo list still has pending items):
          // give the model one chance to continue instead of silently
          // stopping half-way. Capped at one nudge per run to avoid loops.
          if (todoNudgeCount < 1) {
            const nudge = callbacks.shouldContinue?.();
            if (nudge) {
              todoNudgeCount += 1;
              agentLog.info('Coordinator', 'Model stopped with unfinished work; injecting continue reminder');
              this.messages.push({
                role: 'assistant',
                content: response.text || '',
                ...(response.thinkingBlocks.length ? { thinking_blocks: response.thinkingBlocks } : {}),
              });
              this.messages.push({ role: 'user', content: nudge });
              continuationText = '';
              continue;
            }
          }
          // Save assistant message to history so next turn has context
          this.messages.push({
            role: 'assistant',
            content: response.text || '',
            ...(response.thinkingBlocks.length ? { thinking_blocks: response.thinkingBlocks } : {}),
          });
          callbacks.onComplete(fullText);
          return;
        }

        // Add assistant message with tool_calls.
        // thinking_blocks (if any) are echoed back next turn — DeepSeek's
        // Anthropic API rejects requests that drop them.
        this.messages.push({
          role: 'assistant',
          content: response.text || '',
          tool_calls: response.toolCalls,
          ...(response.thinkingBlocks.length ? { thinking_blocks: response.thinkingBlocks } : {}),
        });

        // Execute tool_calls — read-only tools in parallel. Mutations remain
        // serial unless their tool declares distinct resource keys.
        // First: pre-process all calls (risk checks, confirmations)
        interface PreparedCall {
          call: typeof response.toolCalls[0];
          params: Record<string, unknown>;
          skip?: string; // reason to skip (denied/rejected)
        }
        const prepared: PreparedCall[] = [];

        for (const call of response.toolCalls) {
          let params: Record<string, unknown>;
          try {
            params = JSON.parse(call.function.arguments);
          } catch {
            agentLog.warn('Coordinator', `Failed to parse tool args for ${call.function.name}`, call.function.arguments);
            params = {};
          }

          // Check tool risk level (dynamic check > static risk)
          const tool = this.config.toolRegistry.get(call.function.name);
          let risk = tool?.risk || 'safe';
          let riskReason: string | undefined;

          if (tool?.checkRisk) {
            const check = tool.checkRisk(params);
            risk = check.risk;
            riskReason = check.reason;
          }

          if (risk === 'deny') {
            const reason = riskReason || `工具 ${call.function.name} 被禁止执行`;
            agentLog.warn('Coordinator', `Tool ${call.function.name} denied: ${reason}`);
            prepared.push({ call, params, skip: `[denied] ${reason}` });
            continue;
          }

          if (risk === 'ask' && callbacks.onToolConfirm) {
            const allowed = await callbacks.onToolConfirm(
              call.function.name,
              params,
              riskReason,
            );
            if (!allowed) {
              agentLog.info('Coordinator', `Tool ${call.function.name} rejected by user`);
              prepared.push({ call, params, skip: `[rejected] 用户拒绝执行此操作。请询问用户是否有其他方案。` });
              continue;
            }
          }

          prepared.push({ call, params });
        }

        const visibleCalls = prepared
          .filter((item) => !item.skip)
          .map((item) => ({ name: item.call.function.name, params: item.params }));
        const rawProgress = response.text.trim();
        const cleanedProgress = sanitizeProgressText(rawProgress);
        // Public progress should come from the model's concrete update. Tool
        // rows already show silent tool-only turns; fabricating a generic
        // paragraph here makes every task sound identical and often repeats
        // the previous, more specific update.
        const displayProgress = cleanedProgress;
        if (displayProgress) {
          callbacks.onProgressText?.(response.text, displayProgress);
        }

        callbacks.onToolBatchStart?.(
          visibleCalls,
        );

        // Execute: batch read-only tools, flush batch before any write tool
        const executeOne = async (p: PreparedCall): Promise<{
          callId: string;
          content: string;
          name: string;
          success: boolean;
          media?: AgentUserContentBlock[];
          terminal?: boolean;
          terminalMessage?: string;
        }> => {
          if (p.skip) {
            return { callId: p.call.id, content: p.skip, name: p.call.function.name, success: false };
          }
          // Tier 2.4: PreToolUse hook can cancel the call (e.g. user denies confirm)
          const pre = await firePreToolUse({ toolName: p.call.function.name, params: p.params });
          if (pre.cancel) {
            const reason = pre.reason ?? 'cancelled by hook';
            callbacks.onToolStart(p.call.function.name, p.params);
            callbacks.onToolEnd(p.call.function.name, { success: false, output: '', error: reason });
            return { callId: p.call.id, content: `[tool cancelled: ${reason}]`, name: p.call.function.name, success: false };
          }
          callbacks.onToolStart(p.call.function.name, p.params);
          const startedAt = Date.now();
          const result = await this.config.toolRegistry.execute(
            p.call.function.name,
            p.params,
            this.abortController?.signal,
          );
          callbacks.onToolEnd(p.call.function.name, result);
          await firePostToolUse({
            toolName: p.call.function.name,
            params: p.params,
            result,
            durationMs: Date.now() - startedAt,
          });
          return {
            callId: p.call.id,
            content: result.output || result.error || '(no output)',
            name: p.call.function.name,
            success: result.success,
            media: result.media,
            terminal: result.terminal,
            terminalMessage: result.terminalMessage,
          };
        };

        let readBatch: PreparedCall[] = [];
        let mutationBatch: PreparedCall[] = [];
        const mutationKeys = new Set<string>();
        const results: {
          callId: string;
          content: string;
          name: string;
          success: boolean;
          media?: AgentUserContentBlock[];
          terminal?: boolean;
          terminalMessage?: string;
        }[] = [];

        const flushReadBatch = async () => {
          if (readBatch.length === 0) return;
          const batch = readBatch;
          readBatch = [];
          const batchResults = await Promise.all(batch.map(executeOne));
          results.push(...batchResults);
        };

        const flushMutationBatch = async () => {
          if (mutationBatch.length === 0) return;
          const batch = mutationBatch;
          mutationBatch = [];
          mutationKeys.clear();
          const batchResults = await Promise.all(batch.map(executeOne));
          results.push(...batchResults);
        };

        for (const p of prepared) {
          if (p.skip || READ_ONLY_TOOLS.has(p.call.function.name)) {
            await flushMutationBatch();
            readBatch.push(p);
          } else {
            await flushReadBatch();
            const parallelKey = this.config.toolRegistry
              .get(p.call.function.name)
              ?.concurrencyKey?.(p.params);
            if (parallelKey) {
              // The same node/resource must never be written concurrently.
              if (mutationKeys.has(parallelKey)) await flushMutationBatch();
              mutationBatch.push(p);
              mutationKeys.add(parallelKey);
            } else {
              await flushMutationBatch();
              const r = await executeOne(p);
              results.push(r);
            }
          }
        }
        // Flush remaining batches in call order.
        await flushReadBatch();
        await flushMutationBatch();

        callbacks.onToolBatchEnd?.(results.map(({ name, success }) => ({ name, success })));

        // Add all tool results to messages (in original call order)
        this.supersedeOldFilesystemResults(prepared);
        for (const r of results) {
          this.messages.push({
            role: 'tool',
            tool_call_id: r.callId,
            content: r.content,
            ...(r.media?.length ? { media: r.media } : {}),
          });
        }

        const hasPendingGuidance = this.pendingGuidance.length > 0;
        this.flushPendingGuidance();

        // A paid generation tool that has already downloaded and attached the
        // requested video is a complete user outcome. Avoid another LLM turn:
        // it can take tens of seconds, issue redundant inspection calls, and
        // leaves the UI looking busy after the artifact is visibly ready.
        // Guidance sent while the task was running always wins and continues.
        const terminalResults = terminalToolResults(results, hasPendingGuidance);
        if (terminalResults.length > 0) {
          const finalText = terminalResults
            .map((result) => result.terminalMessage || result.content)
            .filter(Boolean)
            .join('\n');
          this.messages.push({ role: 'assistant', content: finalText });
          callbacks.onComplete(finalText);
          return;
        }

        // Keep cheap micro-compaction invisible. A visible context-summary step
        // is reserved for the active model's real context threshold.
        this.messages = this.contextManager.microcompact(this.messages);
        const nextBudget = this.resolveModelAndWindow();
        this.contextManager.updateMaxTokens(nextBudget.effectiveWindow);
        const compactDecision = shouldAutoCompact(
          this.contextManager.estimateMessages(this.messages),
          nextBudget.modelId,
        );
        if (compactDecision.compact) {
          agentLog.info('Coordinator', `auto-compact after tools: ${compactDecision.reason}`);
          callbacks.onCompacting?.();
          this.messages = await recordAutoCompactAttempt(() =>
            this.contextManager.compact(this.messages, this.getCompactChatClient(), true),
          );
        }
        this.enforceHardContextBudget('after-tools');
      }

      // Max turns reached
      agentLog.warn('Coordinator', `Max turns (${this.config.maxTurns}) reached`);
      const maxTurnsMessage = '[鲲鹏] 已达到最大工具调用轮次限制，停止执行。';
      this.messages.push({ role: 'assistant', content: maxTurnsMessage });
      callbacks.onComplete(maxTurnsMessage);
    } catch (err) {
      // 清理不完整的 tool_calls/tool 配对，避免下次调用 API 报格式错误
      this.cleanupIncompleteToolPairs();

      if (err instanceof DOMException && err.name === 'AbortError') {
        agentLog.info('Coordinator', 'Aborted by user');
        callbacks.onComplete('[鲲鹏] 操作已中止。');
      } else {
        agentLog.error('Coordinator', 'Run error', err);
        callbacks.onError(
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    } finally {
      // Local media is sent inline only for the active run. Keeping Base64 in
      // durable history would balloon session files and settings exports.
      this.stripInlineMediaFromHistory();
      this.isRunning = false;
      this.abortController = null;
      this.currentCallbacks = null;
      this.transientMemory = null;
      this.transientTemporalContext = null;
      this.pendingGuidance = [];
    }
  }

  private stripInlineMediaFromHistory(): void {
    this.messages = this.messages.map((message) => {
      if (message.role !== 'user' || !Array.isArray(message.content)) return message;
      const content = message.content.map((block) => {
        if (block.type === 'text') return block;
        // Kimi `ms://` file references and third-party video URLs are only
        // valid for the active run. Persisting them can make a later turn fail
        // after the temporary file expires, and keeps old videos attached to
        // every subsequent request.
        if (block.type === 'video') {
          return {
            type: 'text' as const,
            text: '[此前已向模型提供视频附件；文件路径保留在本轮文字中。]',
          };
        }
        if (block.source.type === 'url') return block;
        return {
          type: 'text' as const,
          text: '[此前已向模型提供本地图片附件；文件路径保留在本轮文字中。]',
        };
      });
      return { ...message, content };
    });
  }

  /**
   * 清理不完整的 tool_calls/tool 配对。
   * 如果 assistant 消息有 N 个 tool_calls 但只有 < N 个 tool result，
   * 回退消息到最近的一致状态。
   */
  private cleanupIncompleteToolPairs(): void {
    // 从尾部向前找最后一个含 tool_calls 的 assistant 消息
    let assistantIdx = -1;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      if (msg.role === 'assistant' && (msg as { tool_calls?: unknown[] }).tool_calls) {
        assistantIdx = i;
        break;
      }
      // 如果先遇到 user 消息，说明没有不完整配对
      if (msg.role === 'user') break;
    }

    if (assistantIdx === -1) return;

    const assistantMsg = this.messages[assistantIdx] as { tool_calls?: { id: string }[] };
    const expectedIds = new Set(assistantMsg.tool_calls?.map((tc) => tc.id) || []);

    // 统计后面有多少 tool result
    const actualIds = new Set<string>();
    for (let i = assistantIdx + 1; i < this.messages.length; i++) {
      const msg = this.messages[i];
      if (msg.role === 'tool') {
        actualIds.add((msg as { tool_call_id: string }).tool_call_id);
      }
    }

    // 如果配对完整，不需要清理
    if (expectedIds.size === actualIds.size) return;

    // 为缺失的 tool_call 合成 is_error 结果（CC-Study 中断安全模式）：
    // 保留 assistant 已产出的文本和已完成的工具结果，而不是把整段 slice 掉
    // —— 这样用户中止时不会丢失部分输出，消息序列也保持 API 合法。
    let synthesized = 0;
    for (const id of expectedIds) {
      if (!actualIds.has(id)) {
        this.messages.push({
          role: 'tool',
          tool_call_id: id,
          content: JSON.stringify({ error: '工具执行被中断（用户中止或发生错误）', is_error: true }),
        });
        synthesized += 1;
      }
    }
    agentLog.warn('Coordinator', `Synthesized ${synthesized} interrupted tool results (${actualIds.size}/${expectedIds.size} completed)`);
  }

  /** 流式获取完整响应 (文本 + thinking + tool_calls) */
  private async streamToCompletion(
    callbacks: CoordinatorCallbacks,
  ): Promise<{
    text: string;
    reasoningText: string;
    toolCalls: ToolCall[];
    finishReason: string | null;
    thinkingBlocks: import('./types').ThinkingBlock[];
  }> {
    let text = '';
    let reasoningText = '';
    let finishReason: string | null = null;
    const toolCallsMap: Map<
      number,
      { id: string; name: string; arguments: string }
    > = new Map();
    const thinkingBlocks: import('./types').ThinkingBlock[] = [];

    // Outbound view of the conversation: persisted history plus the
    // transient turn addenda (placed before the latest user message so the
    // model reads them as context, not as the newest instruction).
    let outbound = this.messages;
    const transientAddenda = [
      this.transientTemporalContext,
      this.transientMemory,
      this.transientSkillNotice,
      ...this.transientOnce,
    ].filter((message): message is AgentMessage => message !== null);
    // One-shot notices are consumed by this request only.
    this.transientOnce = [];
    if (transientAddenda.length > 0) {
      const lastUserIdx = (() => {
        for (let i = this.messages.length - 1; i >= 0; i--) {
          if (this.messages[i].role === 'user') return i;
        }
        return -1;
      })();
      outbound =
        lastUserIdx >= 0
          ? [
              ...this.messages.slice(0, lastUserIdx),
              ...transientAddenda,
              ...this.messages.slice(lastUserIdx),
            ]
          : [...this.messages, ...transientAddenda];
    }

    const outboundBudget = this.hardContextBudget();
    const outboundEstimate = this.contextManager.estimateMessages(outbound);
    if (outboundEstimate > outboundBudget) {
      outbound = this.contextManager.hardClamp(outbound, outboundBudget);
      agentLog.warn(
        'Coordinator',
        `Outbound context hard-clamped: ${outboundEstimate} → ${this.contextManager.estimateMessages(outbound)}/${outboundBudget}`,
      );
    }

    const stream = this.config.routeStrategy
      ? streamWithFallback(
          this.config.routeStrategy,
          {
            messages: outbound,
            tools: this.config.toolRegistry.getDefinitions(),
          },
          {
            source: 'foreground',
            signal: this.abortController?.signal,
            onProviderFallback: ({ from, to, reason }) => {
              this.currentCallbacks?.onProgressText?.(
                '',
                `${from} 暂时不可用（${reason === 'network' ? '网络连接失败' : reason}），已按容灾设置切换到 ${to} 继续处理。`,
              );
            },
          },
          this.abortController?.signal,
        )
      : this.config.glmClient.streamChat(
          outbound,
          this.config.toolRegistry.getDefinitions(),
          this.abortController?.signal,
        );

    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      if (!choice) continue;

      const delta = choice.delta;

      // Track finish_reason (last non-null value wins)
      if (choice.finish_reason) {
        finishReason = choice.finish_reason;
      }

      // Handle reasoning content (thinking)
      if (delta.reasoning_content) {
        reasoningText += delta.reasoning_content;
        callbacks.onThinkingDelta(delta.reasoning_content);
      }

      // Handle text content
      if (delta.content) {
        text += delta.content;
        callbacks.onTextDelta(delta.content);
      }

      // Collect completed thinking blocks (emitted on content_block_stop)
      if (delta.thinking_block) {
        thinkingBlocks.push(delta.thinking_block);
      }

      // Handle tool_calls (accumulate arguments across chunks)
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = toolCallsMap.get(tc.index);
          if (existing) {
            // Append arguments
            if (tc.function?.arguments) {
              existing.arguments += tc.function.arguments;
            }
          } else {
            // New tool_call
            toolCallsMap.set(tc.index, {
              id: tc.id || `call_${tc.index}_${Date.now()}`,
              name: tc.function?.name || '',
              arguments: tc.function?.arguments || '',
            });
          }
        }
      }

      // Track token usage
      if (chunk.usage) {
        this.contextManager.updateUsage({
          promptTokens: chunk.usage.prompt_tokens,
          completionTokens: chunk.usage.completion_tokens,
          totalTokens: chunk.usage.total_tokens,
        });
      }
    }

    // If aborted during streaming, throw so run()'s catch block handles it
    // instead of treating the partial result as a normal completion.
    if (this.abortController?.signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    // Convert accumulated tool_calls
    const toolCalls: ToolCall[] = Array.from(toolCallsMap.values()).map(
      (tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: tc.arguments,
        },
      }),
    );

    return { text, reasoningText, toolCalls, finishReason, thinkingBlocks };
  }

  /** 中止当前操作 */
  abort(): void {
    this.abortController?.abort();
  }

  /** Expose the active abort controller so child coordinators can cascade-abort. */
  getAbortController(): AbortController | null {
    return this.abortController;
  }

  /** 清空对话历史 (保留系统提示词) */
  clear(): void {
    this.historyRevision += 1;
    const system = this.messages.filter((m) => m.role === 'system');
    this.messages = system;
    this.contextManager.resetUsage();
  }

  /** 强制压缩上下文（忽略阈值），用于 /compact 命令 */
  async compactNow(): Promise<void> {
    this.historyRevision += 1;
    const { effectiveWindow } = this.resolveModelAndWindow();
    this.contextManager.updateMaxTokens(effectiveWindow);
    const before = this.messages.length;
    this.messages = await this.contextManager.compact(this.messages, this.getCompactChatClient(), true);
    const after = this.messages.length;
    agentLog.info('Coordinator', `CompactNow: ${before} → ${after} messages`);
  }

  /**
   * 从持久化的 AgentMessage[] 恢复上下文。
   * 保留当前 system prompt，注入历史消息，过多时自动 compact。
   */
  async restoreMessages(savedMessages: AgentMessage[]): Promise<void> {
    const revision = ++this.historyRevision;
    // 保留当前 system prompt
    const system = this.messages.filter((m) => m.role === 'system');
    // 过滤掉已保存的 system 消息（避免重复）
    const nonSystem = savedMessages.filter((m) => m.role !== 'system');

    if (nonSystem.length === 0) return;

    this.messages = [...system, ...nonSystem];
    agentLog.info('Coordinator', `Restored ${nonSystem.length} messages from history`);

    // 根据当前模型设置正确的上下文窗口，再做 compact 检查
    const { effectiveWindow } = this.resolveModelAndWindow();
    this.contextManager.updateMaxTokens(effectiveWindow);

    // 恢复历史时先静默清掉可重建的大型工具结果，再按当前模型真实窗口判断。
    const restored = this.contextManager.microcompact(this.messages);
    this.messages = restored;
    const { modelId } = this.resolveModelAndWindow();
    if (shouldAutoCompact(this.contextManager.estimateMessages(restored), modelId).compact) {
      agentLog.info('Coordinator', `Post-restore compact triggered`);
      const compacted = await this.contextManager.compact(restored, this.getCompactChatClient(), true);
      if (revision !== this.historyRevision || this.isRunning) {
        agentLog.info('Coordinator', 'Discarded stale post-restore compaction');
        return;
      }
      this.messages = compacted;
    }
  }

  /** 获取消息历史 */
  getMessages(): AgentMessage[] {
    return this.messages.map((message) => {
      if (message.role === 'tool' && message.media?.length) {
        return { role: 'tool', tool_call_id: message.tool_call_id, content: message.content };
      }
      if (message.role !== 'user' || !Array.isArray(message.content)) return message;
      return {
        ...message,
        content: message.content.map((block) => {
          if (block.type === 'text') return block;
          if (block.type === 'image' && block.source.type === 'url') return block;
          return {
            type: 'text' as const,
            text: block.type === 'video'
              ? '[视频附件未写入会话文件；路径见本轮文字。]'
              : '[本地图片附件未写入会话文件；路径见本轮文字。]',
          };
        }),
      };
    });
  }

  /** 获取 token 使用统计 */
  getTokenUsage() {
    return this.contextManager.getUsage();
  }

  /**
   * 当前上下文占用快照（本地估算值 / 有效窗口），供 UI 显示上下文用量。
   * estimateMessages 带逐消息缓存，频繁调用开销可忽略。
   */
  getContextStats(): { estimatedTokens: number; maxTokens: number } {
    const { effectiveWindow } = this.resolveModelAndWindow();
    return {
      estimatedTokens: this.contextManager.estimateMessages(this.messages),
      maxTokens: effectiveWindow,
    };
  }

  /** 获取运行状态 */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /** 获取工具注册表 */
  getToolRegistry(): ToolRegistry {
    return this.config.toolRegistry;
  }
}
