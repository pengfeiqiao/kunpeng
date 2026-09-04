// Agent 核心类型定义

/** Tool 的 JSON Schema 描述 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
      default?: unknown;
      items?: unknown;
      properties?: unknown;
      additionalProperties?: unknown;
      required?: string[];
    }>;
    required?: string[];
  };
}

/** Tool 执行结果 */
export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  /** Native multimodal evidence returned by capture/generation tools. */
  media?: AgentUserContentBlock[];
  /**
   * A long-running action may already be the final outcome, including a paid
   * submission whose state is unknown and must not be replayed automatically.
   * The coordinator closes the run instead of spending another model turn on
   * redundant inspection or another chargeable submission.
   */
  terminal?: boolean;
  /** User-facing final copy used when terminal is true. */
  terminalMessage?: string;
}

export type SubAgentTerminalStatus = 'completed' | 'failed' | 'timeout' | 'aborted';

export interface AgentDelegateRequest {
  task: string;
  context?: string;
  toolGroups?: string[];
  timeoutSec?: number;
}

export interface AgentDelegateResult {
  status: SubAgentTerminalStatus;
  runId: string;
  conclusion: string;
  artifacts: string[];
  error?: string;
}

export type SubAgentEvent =
  | { type: 'start'; id: string; runId: string; task: string }
  | { type: 'progress'; id: string; runId: string; text: string }
  | { type: 'tool_start'; id: string; runId: string; toolName: string }
  | { type: 'tool_end'; id: string; runId: string; toolName: string; success: boolean }
  | { type: 'terminal'; id: string; runId: string; status: SubAgentTerminalStatus; conclusion?: string; error?: string };

export interface ToolExecutionContext {
  runId?: string;
  /** Parent run namespace used by paid-call idempotency across delegates. */
  idempotencyRunId?: string;
  subagentDepth?: number;
  delegate?: (request: AgentDelegateRequest, signal?: AbortSignal) => Promise<AgentDelegateResult>;
}

/** Tool 风险级别 */
export type ToolRisk = 'safe' | 'ask' | 'deny';

/** 动态风险检查结果 */
export interface RiskCheckResult {
  risk: ToolRisk;
  reason?: string;
}

/** Tool 接口 */
export interface Tool {
  definition: ToolDefinition;
  risk?: ToolRisk;
  /**
   * Mutating calls are serial by default. Returning a stable resource key
   * opts this call into parallel execution with other calls whose keys differ.
   */
  concurrencyKey?(params: Record<string, unknown>): string | undefined;
  /** 动态风险检查（基于实际参数），优先级高于静态 risk */
  checkRisk?(params: Record<string, unknown>): RiskCheckResult;
  /** signal 可选：长任务工具（如 bash）用它在 abort 时杀掉底层进程 */
  execute(params: Record<string, unknown>, signal?: AbortSignal, context?: ToolExecutionContext): Promise<ToolResult>;
}

/** GLM API tool_call 格式 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/** Anthropic extended-thinking block, captured during streaming so it can be
 * echoed back on the next request (DeepSeek requires this; GLM tolerates it). */
export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature?: string;
}

export type AgentMediaSource =
  | { type: 'base64'; media_type: string; data: string }
  | { type: 'url'; url: string };

export type AgentUserContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: AgentMediaSource }
  | { type: 'video'; source: AgentMediaSource };

/** Agent 消息类型 (兼容 OpenAI messages 格式) */
export type AgentMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | AgentUserContentBlock[] }
  | {
      role: 'assistant';
      content: string | null;
      reasoning_content?: string;
      tool_calls?: ToolCall[];
      /** Extended-thinking blocks that must be echoed back verbatim next turn. */
      thinking_blocks?: ThinkingBlock[];
    }
  | { role: 'tool'; tool_call_id: string; content: string; media?: AgentUserContentBlock[] };

/** Stream delta chunk from GLM API */
export interface StreamDelta {
  id: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string | null;
      reasoning_content?: string | null;
      /** Emitted once per thinking block at `content_block_stop`. The
       * coordinator accumulates these on the assistant message so future
       * requests can echo them back (required by DeepSeek's Anthropic API). */
      thinking_block?: ThinkingBlock;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** Coordinator 回调接口 */
export interface CoordinatorCallbacks {
  onTextDelta: (text: string) => void;
  onThinkingDelta: (text: string) => void;
  /** 一轮回复随后要调用工具时，将面向用户的阶段说明归入任务记录。 */
  onProgressText?: (rawText: string, displayText?: string) => void;
  /** 模型没有主动说明时，用整批工具的目标生成一条用户可读的阶段更新。 */
  onToolBatchStart?: (calls: Array<{ name: string; params: Record<string, unknown> }>) => void;
  /** 一批工具结束后，向用户说明当前结果和后续动作。 */
  onToolBatchEnd?: (results: Array<{ name: string; success: boolean }>) => void;
  onToolStart: (name: string, params: Record<string, unknown>) => void;
  onToolEnd: (name: string, result: ToolResult) => void;
  onComplete: (finalText: string) => void;
  onError: (error: Error) => void;
  /** 工具需要确认时调用，返回 true 表示允许执行 */
  onToolConfirm?: (name: string, params: Record<string, unknown>, reason?: string) => Promise<boolean>;
  /** 子任务文本增量（用于显示任务进度） */
  onSubAgentDelta?: (text: string, event?: SubAgentEvent) => void;
  /** 上下文压缩开始时调用（用于 UI 反馈） */
  onCompacting?: () => void;
  /** Native ACP context-window updates used by the Harness route. */
  onContextUsage?: (stats: { estimatedTokens: number; maxTokens: number }) => void;
  /**
   * 模型准备结束对话（无工具调用）前调用。返回非空字符串表示"还有未完成
   * 事项"，该字符串会作为一轮用户提醒注入、让模型继续；返回 null 表示可以
   * 正常收尾。典型用途：todo 列表仍有 pending/in_progress 项。每个 run 最多
   * 触发一次，避免死循环。
   */
  shouldContinue?: () => string | null;
  /** 当前 run 的动态轮次预算；仅未完成 todo 等明确状态可扩展默认预算。 */
  getMaxTurns?: () => number;
}

/** 工具执行状态 (用于 UI) */
export interface ToolExecution {
  id: string;
  toolName: string;
  params: Record<string, unknown>;
  status: 'running' | 'completed' | 'error';
  result?: ToolResult;
  startTime: number;
  endTime?: number;
}

/** Token 使用统计 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
