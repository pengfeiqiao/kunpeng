/**
 * quickChat — 给非 agent 旁路代码（风格改写、文本节点生成等）用的轻量聊天入口。
 *
 * 复用鲲鹏自己的 provider 体系（registry + router fallback chain），自动享受
 * 多 provider 降级、key 复用、超时重试。不再走 dmxChat 单模型直连——那个旁路
 * 绑死了某个可能下线的模型名，挂了就挂了。
 *
 * 策略来自 settings 的 providerDefault + providerFallbackChain（与主 agent 同源），
 * 只纳入已配 key 的 provider。
 */
import { fetch as tauriFetch, ResponseType } from '@tauri-apps/api/http';
import type { RouteStrategy } from './providers/router';
import { chatWithFallbackDetailed } from './providers/router';
import type { CompletionResult, SimpleCompletionRequest } from './providers/types';
import { useSettingsStore } from '@/stores/settingsStore';
import { resolveApiKey } from '@/lib/credentials';
import { buildChatRouteStrategy } from './routeStrategy';
import { isTruncatedFinishReason, mergePromptContinuation } from './completionGuard';

/** 从 settings 构建 fallback 链策略（与 useAgent 的 buildRouteStrategy 同逻辑）。 */
export function buildRouteStrategyFromSettings(preferredProviderId?: string): RouteStrategy | undefined {
  const s = useSettingsStore.getState();
  return buildChatRouteStrategy(s, {
    legacyGlmApiKey: s.glmApiKey,
    primary: preferredProviderId ? { providerId: preferredProviderId } : null,
  });
}

export interface QuickChatOptions {
  /** 偏好 provider id（可选，如 'glm'）；不传则用 settings 默认 + 链 */
  preferredProviderId?: string;
  maxTokens?: number;
  signal?: AbortSignal;
  /**
   * 直连 deepseek OpenAI 兼容端点（绕过 GLMClient/Anthropic 协议）。
   * deepseek 走 Anthropic 端点时 reasoning_tokens 会挤占 max_tokens 额度，
   * 导致结构化长输出被截断；OpenAI 端点无此问题。风格改写等需要稳定长输出的
   * 场景设 true。
   */
  directDeepseek?: boolean;
  /** 检测到 max_tokens/length 时自动从中断处续写，避免把半截结果写入输入框。 */
  continueOnTruncation?: boolean;
  /** 自动续写次数，默认 2。全部用尽仍被截断时会明确报错。 */
  maxContinuations?: number;
}

type QuickMessage = { role: string; content: string };

/**
 * 直连 deepseek OpenAI 兼容端点（/v1/chat/completions），绕过 GLMClient。
 * key/model 取自 settings.providerApiKeys.deepseek + providerModels.deepseek。
 */
async function quickChatDirectDeepseek(
  messages: QuickMessage[],
  maxTokens?: number,
): Promise<CompletionResult> {
  const s = useSettingsStore.getState();
  const key = resolveApiKey(s, 'provider:deepseek', s.providerApiKeys?.deepseek ?? '').trim();
  if (!key) throw new Error('未配置 DeepSeek API Key（设置 → Agent 引擎）');
  const model = s.providerModels?.deepseek || 'deepseek-v4-flash-vision-exp';
  const resp = await tauriFetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: { type: 'Json', payload: { model, messages, max_tokens: maxTokens ?? 2000, stream: false } },
    responseType: ResponseType.JSON,
    timeout: 120,
  });
  if (!resp.ok) throw new Error(`DeepSeek ${resp.status}: ${JSON.stringify(resp.data).slice(0, 200)}`);
  const data = resp.data as { choices?: { message?: { content?: string }; finish_reason?: string | null }[] };
  return {
    text: data.choices?.[0]?.message?.content ?? '',
    finishReason: data.choices?.[0]?.finish_reason ?? null,
  };
}

/**
 * 非流式聊天（带 fallback）。messages 用通用 {role, content} 格式。
 * 抛错情况：没有任何已配 key 的 provider，或所有 provider 都失败。
 */
export async function quickChat(
  messages: QuickMessage[],
  opts: QuickChatOptions = {},
): Promise<string> {
  let directError: unknown;
  let directEnabled = Boolean(opts.directDeepseek);
  let strategy: RouteStrategy | undefined;

  const completeOnce = async (turnMessages: QuickMessage[]): Promise<CompletionResult> => {
    if (directEnabled) {
      try {
        return await quickChatDirectDeepseek(turnMessages, opts.maxTokens);
      } catch (error) {
        // Direct DeepSeek is an optimization for long structured output, not a hard
        // dependency. Do not retry the broken direct route for continuation turns.
        directEnabled = false;
        directError = error;
        console.warn('[quickChat] DeepSeek direct route failed, using provider fallback:', error);
      }
    }

    strategy ??= buildRouteStrategyFromSettings(opts.preferredProviderId);
    if (!strategy) {
      if (directError) throw directError;
      throw new Error('未配置任何可用的 AI provider Key（设置 → Agent 引擎）');
    }
    const req: SimpleCompletionRequest = {
      messages: turnMessages,
      ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}),
    };
    return chatWithFallbackDetailed(strategy, req, { source: 'background' }, opts.signal);
  };

  let result = await completeOnce(messages);
  let text = result.text;
  if (!opts.continueOnTruncation || !isTruncatedFinishReason(result.finishReason)) return text;

  const maxContinuations = Math.max(1, Math.min(4, opts.maxContinuations ?? 2));
  for (let attempt = 0; attempt < maxContinuations && isTruncatedFinishReason(result.finishReason); attempt += 1) {
    result = await completeOnce([
      ...messages,
      { role: 'assistant', content: text },
      {
        role: 'user',
        content: '上一条输出因长度限制中断。仅从中断处继续输出尚未完成的部分，不要重复已有内容，不要重新开头，不要解释。',
      },
    ]);
    if (!result.text.trim()) throw new Error('模型提示词续写返回为空，已保留原节点内容');
    text = mergePromptContinuation(text, result.text);
  }

  if (isTruncatedFinishReason(result.finishReason)) {
    throw new Error('提示词连续达到模型输出上限，未写入不完整结果；请精简原要求或切换输出能力更强的模型');
  }
  return text;
}
