import { GLMClient } from '../glmClient';
import type { StreamDelta } from '../types';
import type { Provider, ChatRequest, ChatOptions, ModelDef, SimpleCompletionRequest } from './types';
import { toKimiWireModel } from '../kimiModel';

const MODELS: ModelDef[] = [
  {
    id: 'k3[1m]',
    displayName: 'Kimi K3 1M',
    contextWindow: 1_048_576,
    supportsTools: true,
  },
  {
    id: 'k3',
    displayName: 'Kimi K3',
    contextWindow: 262_144,
    supportsTools: true,
  },
];

export interface KimiConfig {
  apiKey: string;
  baseUrl?: string;
  modelId?: string;
}

function normalizeAnthropicBase(baseUrl?: string): string {
  const input = (baseUrl || 'https://api.kimi.com/coding/').replace(/\/$/, '');
  return input.replace(/\/coding\/v1$/i, '/coding');
}

export class KimiProvider implements Provider {
  readonly id = 'kimi';
  readonly displayName = 'Kimi';
  readonly baseUrl: string;
  readonly models = MODELS;
  readonly defaultModelId: string;

  private client: GLMClient;

  constructor(cfg: KimiConfig) {
    this.baseUrl = normalizeAnthropicBase(cfg.baseUrl);
    this.defaultModelId = cfg.modelId || 'k3[1m]';
    this.client = new GLMClient({
      apiKey: cfg.apiKey,
      baseUrl: this.baseUrl,
      model: toKimiWireModel(this.defaultModelId),
      thinkingEffort: 'max',
      userAgent: 'Kunpeng/2.6.24',
      appId: 'kunpeng',
      maxOutputTokens: 32_768,
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      const text = await this.client.chat(
        [{ role: 'user', content: '只回复 OK' }],
        { maxTokens: 64 },
      );
      return Boolean(text.trim());
    } catch {
      return false;
    }
  }

  async chat(req: SimpleCompletionRequest, _opts: ChatOptions): Promise<string> {
    const wireModel = toKimiWireModel(req.modelId ?? this.defaultModelId);
    return this.client.chat(req.messages, { maxTokens: req.maxTokens, model: wireModel });
  }

  async chatDetailed(req: SimpleCompletionRequest, _opts: ChatOptions) {
    const wireModel = toKimiWireModel(req.modelId ?? this.defaultModelId);
    return this.client.chatDetailed(req.messages, { maxTokens: req.maxTokens, model: wireModel });
  }

  async *streamChat(req: ChatRequest, opts: ChatOptions): AsyncGenerator<StreamDelta> {
    const wireModel = toKimiWireModel(req.modelId ?? this.defaultModelId);
    yield* this.client.streamChat(req.messages, req.tools, opts.signal, wireModel);
  }
}
