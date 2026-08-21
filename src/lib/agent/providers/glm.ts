/**
 * GLM provider — thin adapter over the existing GLMClient.
 *
 * GLMClient predates the Provider abstraction, so rather than rewrite it we
 * wrap it. Keeps all existing GLM-specific quirks (Anthropic-flavored
 * `/v1/messages` endpoint, `x-api-key` header, content-block conversion)
 * isolated in glmClient.ts; everything else in the system talks to the
 * uniform `Provider` interface.
 *
 * The 429-retry loop inside GLMClient stays for now — Tier 1.4's withRetry
 * will replace it in a follow-up pass once we've verified DeepSeek works.
 */

import { GLMClient } from '../glmClient';
import type {
  Provider,
  ChatRequest,
  ChatOptions,
  ModelDef,
  SimpleCompletionRequest,
} from './types';
import type { StreamDelta } from '../types';

const MODELS: ModelDef[] = [
  {
    id: 'glm-5.3',
    displayName: 'GLM-5.3',
    contextWindow: 1_000_000,
    supportsTools: true,
  },
  {
    id: 'glm-5.2',
    displayName: 'GLM-5.2',
    contextWindow: 1_000_000,
    supportsTools: true,
  },
  {
    id: 'glm-5.1',
    displayName: 'GLM-5.1',
    contextWindow: 128_000,
    supportsTools: true,
  },
  {
    id: 'glm-4.6',
    displayName: 'GLM-4.6',
    contextWindow: 128_000,
    supportsTools: true,
  },
];

export interface GLMProviderConfig {
  apiKey: string;
  baseUrl?: string;
  modelId?: string;
}

export class GLMProvider implements Provider {
  readonly id = 'glm';
  readonly displayName = '智谱 GLM';
  readonly baseUrl: string;
  readonly models = MODELS;
  readonly defaultModelId: string;

  private client: GLMClient;

  constructor(cfg: GLMProviderConfig) {
    this.baseUrl = cfg.baseUrl ?? 'https://open.bigmodel.cn/api/anthropic';
    this.defaultModelId = cfg.modelId ?? 'glm-5.3';
    this.client = new GLMClient({
      apiKey: cfg.apiKey,
      baseUrl: this.baseUrl,
      model: this.defaultModelId,
    });
  }

  /** Expose the underlying GLMClient — Coordinator currently uses it directly. */
  getClient(): GLMClient {
    return this.client;
  }

  async healthCheck(): Promise<boolean> {
    // GLM has no cheap models endpoint we trust; treat presence of key as ok.
    // Fallback layer will catch real failures via the 4xx/5xx returned mid-call.
    return Boolean((this.client as unknown as { config: { apiKey?: string } }).config.apiKey);
  }

  async chat(req: SimpleCompletionRequest, _opts: ChatOptions): Promise<string> {
    return this.client.chat(req.messages, { maxTokens: req.maxTokens, model: req.modelId ?? this.defaultModelId });
  }

  async chatDetailed(req: SimpleCompletionRequest, _opts: ChatOptions) {
    return this.client.chatDetailed(req.messages, { maxTokens: req.maxTokens, model: req.modelId ?? this.defaultModelId });
  }

  async *streamChat(req: ChatRequest, opts: ChatOptions): AsyncGenerator<StreamDelta> {
    yield* this.client.streamChat(req.messages, req.tools, opts.signal, req.modelId ?? this.defaultModelId);
  }
}
