import { Body, fetch as tauriFetch, ResponseType } from '@tauri-apps/api/http';
import { useSettingsStore } from '@/stores/settingsStore';
import { resolveApiKey } from '@/lib/credentials';
import { loadImageInput } from './mediaInput';
import { withRetry } from './withRetry';
import { toKimiWireModel } from './kimiModel';

export interface KimiK3Result {
  text: string;
  model: string;
  label: 'Kimi K3';
}

interface KimiConfig {
  apiKey: string;
  anthropicBaseUrl: string;
  openAIBaseUrl: string;
  model: string;
}

export function getKimiK3Config(): KimiConfig | null {
  const settings = useSettingsStore.getState();
  const apiKey = resolveApiKey(settings, 'provider:kimi', settings.providerApiKeys.kimi || '').trim();
  if (!apiKey) return null;
  const configuredBase = (settings.providerBaseUrls.kimi || 'https://api.kimi.com/coding/').replace(/\/$/, '');
  const codingBase = configuredBase.replace(/\/coding\/v1$/i, '/coding');
  return {
    apiKey,
    anthropicBaseUrl: codingBase,
    openAIBaseUrl: /\/coding$/i.test(codingBase) ? `${codingBase}/v1` : codingBase,
    model: toKimiWireModel(settings.providerModels.kimi || 'k3[1m]'),
  };
}

export function isKimiK3Configured(): boolean {
  return Boolean(getKimiK3Config());
}

function parseDataUrl(url: string): { mediaType: string; data: string } | null {
  if (!url.startsWith('data:')) return null;
  const match = url.match(/^data:([^;,]+);base64,(.+)$/s);
  if (!match) throw new Error('Kimi K3 收到无效的媒体 data URL');
  return { mediaType: match[1], data: match[2] };
}

function mediaSource(url: string): { type: 'base64'; media_type: string; data: string } | { type: 'url'; url: string } {
  const parsed = parseDataUrl(url);
  return parsed
    ? { type: 'base64', media_type: parsed.mediaType, data: parsed.data }
    : { type: 'url', url };
}

function toAnthropicContent(content: unknown): unknown {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content ?? '');
  return content.map((part) => {
    const value = part as {
      type?: string;
      text?: string;
      image_url?: { url?: string };
      video_url?: { url?: string };
    };
    if (value.type === 'text') return { type: 'text', text: value.text ?? '' };
    if (value.type === 'image_url' && value.image_url?.url) {
      return { type: 'image', source: mediaSource(value.image_url.url) };
    }
    if (value.type === 'video_url' && value.video_url?.url) {
      if (!value.video_url.url.startsWith('data:') && !value.video_url.url.startsWith('ms://')) {
        return {
          type: 'text',
          text: `[视频公网链接未直接附加：${value.video_url.url}。Kimi 视频必须先上传到其文件服务。]`,
        };
      }
      return { type: 'video', source: mediaSource(value.video_url.url) };
    }
    return { type: 'text', text: JSON.stringify(part) };
  });
}

function toAnthropicMessages(messages: unknown[]): { system: string; messages: unknown[] } {
  const system: string[] = [];
  const converted: unknown[] = [];
  for (const message of messages) {
    const value = message as { role?: string; content?: unknown };
    if (value.role === 'system') {
      system.push(typeof value.content === 'string' ? value.content : JSON.stringify(value.content));
      continue;
    }
    converted.push({
      role: value.role === 'assistant' ? 'assistant' : 'user',
      content: toAnthropicContent(value.content),
    });
  }
  return { system: system.join('\n\n'), messages: converted };
}

function statusError(label: string, status: number, data: unknown): Error & { status: number } {
  const error = new Error(`${label} HTTP ${status}: ${String(data).slice(0, 500)}`) as Error & { status: number };
  error.status = status;
  return error;
}

async function anthropicChat(config: KimiConfig, messages: unknown[], extra: Record<string, unknown>): Promise<string> {
  const timeout = Math.max(30, Number(extra.timeout ?? 600));
  const requestExtra = { ...extra };
  delete requestExtra.timeout;
  delete requestExtra.response_format;
  const converted = toAnthropicMessages(messages);
  const response = await tauriFetch(`${config.anthropicBaseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'User-Agent': 'Kunpeng/2.6.24',
      'x-app': 'kunpeng',
    },
    body: Body.json({
      model: config.model,
      system: converted.system,
      messages: converted.messages,
      thinking: { type: 'enabled', effort: 'max' },
      max_tokens: 16_000,
      temperature: 0.3,
      ...requestExtra,
      stream: false,
    }),
    responseType: ResponseType.Text,
    timeout,
  });
  if (!response.ok) throw statusError('Kimi K3 Anthropic', response.status, response.data);
  const data = JSON.parse(String(response.data)) as { content?: Array<{ type?: string; text?: string }> };
  const text = (data.content ?? []).filter((part) => part.type === 'text').map((part) => part.text ?? '').join('').trim();
  if (!text) throw new Error('Kimi K3 Anthropic 返回为空');
  return text;
}

async function openAIChat(config: KimiConfig, messages: unknown[], extra: Record<string, unknown>): Promise<string> {
  const timeout = Math.max(30, Number(extra.timeout ?? 600));
  const requestExtra = { ...extra };
  delete requestExtra.timeout;
  const response = await tauriFetch(`${config.openAIBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      'User-Agent': 'Kunpeng/2.6.24',
    },
    body: Body.json({
      model: config.model,
      messages,
      reasoning_effort: 'max',
      temperature: 0.3,
      max_tokens: 16_000,
      stream: false,
      ...requestExtra,
    }),
    responseType: ResponseType.Text,
    timeout,
  });
  if (!response.ok) throw statusError('Kimi K3 OpenAI 备用', response.status, response.data);
  const data = JSON.parse(String(response.data)) as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content?.trim() ?? '';
  if (!text) throw new Error('Kimi K3 OpenAI 备用返回为空');
  return text;
}

export async function kimiK3Chat(messages: unknown[], extra: Record<string, unknown> = {}): Promise<string> {
  const config = getKimiK3Config();
  if (!config) throw new Error('未配置 Kimi API Key');
  const signal = extra.signal instanceof AbortSignal ? extra.signal : undefined;
  const requestExtra = { ...extra };
  delete requestExtra.signal;
  try {
    return await withRetry(
      () => anthropicChat(config, messages, requestExtra),
      { source: 'foreground', signal, maxRetries: 3 },
    );
  } catch (error) {
    console.warn('[Kimi K3] Anthropic endpoint failed, trying OpenAI fallback:', error);
    return withRetry(
      () => openAIChat(config, messages, requestExtra),
      { source: 'foreground', signal, maxRetries: 3 },
    );
  }
}

export async function kimiK3Vision(image: string, instruction: string): Promise<KimiK3Result> {
  const imageUrl = await loadImageInput(image);
  const config = getKimiK3Config();
  const text = await kimiK3Chat([
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: imageUrl } },
        { type: 'text', text: instruction },
      ],
    },
  ]);
  return { text, model: config?.model || 'k3', label: 'Kimi K3' };
}
