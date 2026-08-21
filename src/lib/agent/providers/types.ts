/**
 * Provider abstraction — the "shape" every model backend (GLM, DeepSeek,
 * DMXAPI's Gemini/GPT, future ones) must implement.
 *
 * Designed so adding a new backend is a single new file + a registry entry.
 * The Coordinator only ever talks to `Provider`, never directly to a vendor SDK.
 *
 * See plan Tier 1.5 for context. The choice to mirror Anthropic's `streamChat`
 * yielding `StreamDelta` (the GLMClient shape) keeps Coordinator intact —
 * existing call sites work unchanged when a provider is plugged in.
 */

import type { AgentMessage, StreamDelta, ToolDefinition } from '../types';

export interface ModelDef {
  id: string;
  displayName: string;
  contextWindow: number;
  supportsTools: boolean;
  /** Per-million-tokens, for UI hints. Optional — leave undefined if unknown. */
  pricing?: { input: number; output: number };
}

export interface ChatRequest {
  messages: AgentMessage[];
  tools?: ToolDefinition[];
  modelId?: string;     // Provider may override default model
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: 'low' | 'high' | 'max';
}

/** Source of a request — controls retry behavior (see withRetry.ts). */
export type QuerySource = 'foreground' | 'background';

export interface ChatOptions {
  source: QuerySource;
  signal?: AbortSignal;
  onProviderFallback?: (event: {
    from: string;
    to: string;
    reason: string;
  }) => void;
}

/** Non-streaming completion (used for compaction summaries, classifiers, etc). */
export interface SimpleCompletionRequest {
  messages: { role: string; content: string }[];
  modelId?: string;
  maxTokens?: number;
  reasoningEffort?: 'low' | 'high' | 'max';
}

export interface CompletionResult {
  text: string;
  /** Anthropic: end_turn/max_tokens; OpenAI: stop/length. */
  finishReason?: string | null;
}

export interface Provider {
  /** Stable identifier, e.g. 'glm', 'deepseek', 'dmxapi-gemini'. */
  readonly id: string;
  /** Human-readable name shown in settings UI. */
  readonly displayName: string;
  /** Origin we preconnect at startup. Used by apiPreconnect. */
  readonly baseUrl: string;
  /** Models this provider serves. UI uses this for dropdowns. */
  readonly models: ModelDef[];
  /** Default model id when caller doesn't pin one. */
  readonly defaultModelId: string;

  /** Streaming chat — yields StreamDelta chunks compatible with Coordinator. */
  streamChat(req: ChatRequest, opts: ChatOptions): AsyncGenerator<StreamDelta>;

  /** Non-streaming chat — for short internal queries (compaction, etc). */
  chat(req: SimpleCompletionRequest, opts: ChatOptions): Promise<string>;
  /** Optional detailed completion used when callers must reject truncated output. */
  chatDetailed?(req: SimpleCompletionRequest, opts: ChatOptions): Promise<CompletionResult>;

  /** Cheap connectivity check — return false if API key invalid / network down. */
  healthCheck?(): Promise<boolean>;
}
