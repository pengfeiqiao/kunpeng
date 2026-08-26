/**
 * openaiCompat — 自定义 OpenAI 兼容端点调用（识图/联网模块的用户自定义 API）。
 * 端点路径自动适配：用户填 host、/v1 或完整 /chat/completions 都可以，
 * 404 时自动在 /v1/chat/completions 与 /chat/completions 之间互换重试一次。
 */
import { fetch as tauriFetch, ResponseType, Body } from '@tauri-apps/api/http';

/** 根据用户填写的 baseUrl 生成候选 chat/completions 地址（按尝试顺序）。 */
export function chatCompletionsCandidates(baseUrl: string): string[] {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (!base) return [];
  if (base.endsWith('/chat/completions')) return [base];
  if (base.endsWith('/v1')) return [`${base}/chat/completions`, `${base.slice(0, -3)}/chat/completions`];
  return [`${base}/v1/chat/completions`, `${base}/chat/completions`];
}

export interface CustomChatInput {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: unknown[];
  timeoutSec?: number;
}

/** 调用自定义 OpenAI 兼容端点，返回文本内容。 */
export async function postCustomChat(input: CustomChatInput): Promise<string> {
  const candidates = chatCompletionsCandidates(input.baseUrl);
  if (candidates.length === 0) throw new Error('未填写自定义端点地址（Base URL）');
  if (!input.apiKey.trim()) throw new Error('未填写自定义端点的 API Key');
  if (!input.model.trim()) throw new Error('未填写自定义端点的模型名');

  let lastError = '';
  for (const url of candidates) {
    const res = await tauriFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.apiKey.trim()}` },
      body: Body.json({ model: input.model.trim(), messages: input.messages }),
      responseType: ResponseType.Text,
      timeout: input.timeoutSec ?? 120,
    });
    if (res.status === 404 && candidates.length > 1) {
      lastError = `HTTP 404: ${String(res.data).slice(0, 200)}`;
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${String(res.data).slice(0, 300)}`);
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(res.data as string) as Record<string, unknown>;
    } catch {
      throw new Error(`返回非 JSON: ${String(res.data).slice(0, 300)}`);
    }
    const choices = j.choices as Array<{ message?: { content?: string } }> | undefined;
    const text = choices?.[0]?.message?.content || '';
    if (!text.trim()) throw new Error('自定义端点返回空内容');
    return text.trim();
  }
  throw new Error(lastError || '自定义端点请求失败');
}
