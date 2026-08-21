/**
 * Generic Anthropic-Messages-compatible provider.
 *
 * Several domestic vendors (MiniMax, Aliyun Bailian/Qwen, Volcengine Ark)
 * expose an Anthropic `/v1/messages` endpoint, so one thin GLMClient wrapper
 * covers all of them — same pattern as KimiProvider/GLMProvider, without a
 * bespoke file per vendor. Provider metadata lives in ANTHROPIC_PRESETS
 * below; ProviderSettings/modelCatalog read from the same table.
 */

import { GLMClient } from '../glmClient';
import type { StreamDelta } from '../types';
import type {
  Provider,
  ChatRequest,
  ChatOptions,
  ModelDef,
  SimpleCompletionRequest,
} from './types';

export interface AnthropicPresetModel extends ModelDef {
  /** Short hint shown in model pickers. */
  detail: string;
}

export interface AnthropicPreset {
  id: string;
  displayName: string;
  shortName: string;
  docUrl: string;
  keyPlaceholder: string;
  defaultBaseUrl: string;
  defaultModelId: string;
  models: AnthropicPresetModel[];
  /** Some gateways authenticate with `Authorization: Bearer` instead of (or in
   * addition to) the Anthropic `x-api-key` header. `both` sends both. */
  auth?: 'x-api-key' | 'both';
}

/**
 * Vendor table — single source for the generic Anthropic-compatible
 * providers. Model ids are the exact wire values from each vendor's docs
 * (2026-08); MiniMax/DashScope/Ark expose no model-list endpoint, so this
 * table must be updated by hand when vendors roll new versions.
 */
export const ANTHROPIC_PRESETS: AnthropicPreset[] = [
  {
    id: 'minimax',
    displayName: 'MiniMax',
    shortName: 'MM',
    docUrl: 'https://platform.minimaxi.com/',
    keyPlaceholder: '粘贴 MiniMax API Key',
    defaultBaseUrl: 'https://api.minimaxi.com/anthropic',
    defaultModelId: 'MiniMax-M3',
    models: [
      { id: 'MiniMax-M3', displayName: 'MiniMax M3', detail: '旗舰 · 1M 上下文 · 多模态输入', contextWindow: 1_000_000, supportsTools: true },
      { id: 'MiniMax-M2.7', displayName: 'MiniMax M2.7', detail: '上一代主力 · 204K', contextWindow: 204_800, supportsTools: true },
      { id: 'MiniMax-M2.5', displayName: 'MiniMax M2.5', detail: '高性价比 · 204K', contextWindow: 204_800, supportsTools: true },
    ],
  },
  {
    id: 'qwen',
    displayName: '通义 Qwen',
    shortName: 'QW',
    docUrl: 'https://bailian.console.aliyun.com/',
    keyPlaceholder: '粘贴百炼 DashScope API Key (sk-...)',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/apps/anthropic',
    defaultModelId: 'qwen3.8-max',
    // DashScope's Anthropic gateway authenticates via Bearer token.
    auth: 'both',
    models: [
      { id: 'qwen3.8-max', displayName: 'Qwen 3.8 Max', detail: '旗舰 · 1M 上下文 · 原生视觉', contextWindow: 1_000_000, supportsTools: true },
      { id: 'qwen3.7-max', displayName: 'Qwen 3.7 Max', detail: '上代旗舰 · 1M', contextWindow: 1_000_000, supportsTools: true },
      { id: 'qwen3.7-plus', displayName: 'Qwen 3.7 Plus', detail: '均衡性价比', contextWindow: 1_000_000, supportsTools: true },
    ],
  },
  {
    id: 'doubao',
    displayName: '豆包 Doubao',
    shortName: 'DB',
    docUrl: 'https://console.volcengine.com/ark',
    keyPlaceholder: '粘贴火山方舟 API Key',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/compatible',
    defaultModelId: 'doubao-seed-2-1-pro-260628',
    // Ark's Anthropic-compatible gateway authenticates via Bearer token.
    auth: 'both',
    models: [
      { id: 'doubao-seed-2-1-pro-260628', displayName: '豆包 Seed 2.1 Pro', detail: '旗舰 · 256K · 编程/Agent', contextWindow: 256_000, supportsTools: true },
      { id: 'doubao-seed-2-0-lite-260428', displayName: '豆包 Seed 2.0 Lite', detail: '轻量低成本 · 256K', contextWindow: 256_000, supportsTools: true },
    ],
  },
];

export function getAnthropicPreset(id: string): AnthropicPreset | undefined {
  return ANTHROPIC_PRESETS.find((preset) => preset.id === id);
}

export class AnthropicCompatibleProvider implements Provider {
  readonly id: string;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly models: ModelDef[];
  readonly defaultModelId: string;

  private client: GLMClient;

  constructor(preset: AnthropicPreset, cfg: { apiKey: string; baseUrl?: string; modelId?: string }) {
    this.id = preset.id;
    this.displayName = preset.displayName;
    this.baseUrl = (cfg.baseUrl || preset.defaultBaseUrl).replace(/\/+$/, '');
    this.models = preset.models;
    this.defaultModelId = cfg.modelId || preset.defaultModelId;
    this.client = new GLMClient({
      apiKey: cfg.apiKey,
      baseUrl: this.baseUrl,
      model: this.defaultModelId,
      bearerAuth: preset.auth === 'both',
      userAgent: 'Kunpeng/2.8.6',
      appId: 'kunpeng',
      maxOutputTokens: 32_768,
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      const text = await this.client.chat([{ role: 'user', content: '只回复 OK' }], { maxTokens: 64 });
      return Boolean(text.trim());
    } catch {
      return false;
    }
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
