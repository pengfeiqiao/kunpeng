/**
 * dmxClient — 内置 DMXAPI 客户端，统一给联网搜索 / 图片识别工具使用。
 *
 * 两类端点 auth 不同（已实测）：
 *   - /v1/responses        → header `Authorization: <key>`（无 Bearer）
 *   - /v1/chat/completions  → header `Authorization: Bearer <key>`
 *
 * 用 Tauri HTTP client（绕过 CORS）。流式端点（qwen）由 Tauri 缓冲为完整
 * SSE 文本，我们一次性解析所有 `data:` 行累加 delta —— 不需要真正的逐块流。
 */

import { fetch as tauriFetch, ResponseType, Body } from '@tauri-apps/api/http';
import { useSettingsStore } from '@/stores/settingsStore';
import { resolveApiKey, resolveSlotApiKey } from '@/lib/credentials';
import { getWebFetchTimeoutMs } from '@/lib/timeouts';
import { isKimiK3Configured, kimiK3Vision } from '@/lib/agent/kimiClient';
import { loadImageInput } from '@/lib/agent/mediaInput';
import { agentLog } from '@/lib/agent/logger';
import { CURL_TRANSPORT_THRESHOLD, DEBUG_BODY_THRESHOLD, dumpDebugBody, postJsonViaCurl } from '@/lib/agent/curlTransport';
import { postCustomChat } from '@/lib/openaiCompat';

export { loadImageInput } from '@/lib/agent/mediaInput';

const BASE = 'https://www.dmxapi.cn';

/**
 * 内置 API 统一密钥来源：凭证注册表（'dmx' 引用）→ settings.dmxApiKey →
 * 首个可用的 **dmxapi** 槽位（槽位自身也先解析其 credentialId）。
 * 槽位必须按 provider 过滤：这里的请求固定发往 dmxapi.cn，借用 aihubmix
 * 等其他 provider 的 key 只会得到 401。
 */
export function getDmxApiKey(): string {
  const s = useSettingsStore.getState();
  const slot = [...(s.imageApiSlots ?? [])]
    .filter((x) => x.enabled && resolveSlotApiKey(s, x) && (x.provider || 'dmxapi') === 'dmxapi')
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))[0];
  return resolveApiKey(s, 'dmx', s.dmxApiKey || resolveSlotApiKey(s, slot)).trim();
}

export function getDmxApiKeyStatus(): string {
  const s = useSettingsStore.getState();
  if (resolveApiKey(s, 'dmx', s.dmxApiKey)?.trim()) return '设置中的 DMXAPI Key';
  const slot = [...(s.imageApiSlots ?? [])]
    .filter((x) => x.enabled && resolveSlotApiKey(s, x) && (x.provider || 'dmxapi') === 'dmxapi')
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))[0];
  if (slot) return `生图 API 槽位：${slot.label || 'DMXAPI'}`;
  return '未找到 DMXAPI Key。请在设置 > 生图 API 添加 DMXAPI，或填写 DMXAPI Key。';
}

class MissingKeyError extends Error {
  constructor() {
    super(getDmxApiKeyStatus());
    this.name = 'MissingKeyError';
  }
}

function timeoutSec(): number {
  return Math.ceil(getWebFetchTimeoutMs() / 1000);
}

/** POST /v1/responses（非流式），返回原始 JSON */
export async function dmxResponses(
  model: string,
  input: unknown,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const key = getDmxApiKey();
  if (!key) throw new MissingKeyError();

  const res = await tauriFetch(`${BASE}/v1/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: key },
    body: Body.json({ model, input, ...extra }),
    responseType: ResponseType.Text,
    timeout: timeoutSec(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${String(res.data).slice(0, 300)}`);
  try {
    return JSON.parse(res.data as string) as Record<string, unknown>;
  } catch {
    throw new Error(`返回非 JSON: ${String(res.data).slice(0, 300)}`);
  }
}

/**
 * POST /v1/responses + stream:true。Tauri 缓冲为完整 SSE 文本，
 * 解析所有 `event: response.output_text.delta` 的 `data:` 累加 delta。
 */
export async function dmxResponsesStream(
  model: string,
  input: unknown,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const key = getDmxApiKey();
  if (!key) throw new MissingKeyError();

  const payload = {
    model,
    input,
    stream: true,
    stream_options: { include_usage: true },
    ...extra,
  };
  if (JSON.stringify(payload).length > DEBUG_BODY_THRESHOLD) void dumpDebugBody('dmx-responses-body', payload);
  let raw: string;
  if (JSON.stringify(payload).length > CURL_TRANSPORT_THRESHOLD) {
    agentLog.warn('DMX', `请求体超过 ${CURL_TRANSPORT_THRESHOLD / 1024}KB，改走 curl 传输（${model}）`);
    const r = await postJsonViaCurl(`${BASE}/v1/responses`, ['Content-Type: application/json', `Authorization: ${key}`], payload);
    if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status}: ${r.data.slice(0, 300)}`);
    raw = r.data;
  } else {
    const res = await tauriFetch(`${BASE}/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: key },
      body: Body.json(payload),
      responseType: ResponseType.Text,
      timeout: timeoutSec(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${String(res.data).slice(0, 300)}`);
    raw = typeof res.data === 'string' ? res.data : '';
  }
  let event: string | null = null;
  let text = '';
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (t.startsWith('event: ')) {
      event = t.slice(7);
    } else if (t.startsWith('data: ')) {
      const payload = t.slice(6);
      if (payload === '[DONE]') continue;
      if (event === 'response.output_text.delta') {
        try {
          const j = JSON.parse(payload) as { delta?: string };
          if (j.delta) text += j.delta;
        } catch {
          /* skip malformed chunk */
        }
      }
    }
  }
  return text;
}

/** POST /v1/chat/completions（标准 OpenAI），返回 content */
export async function dmxChat(model: string, messages: unknown): Promise<string> {
  const key = getDmxApiKey();
  if (!key) throw new MissingKeyError();

  const payload = { model, messages };
  if (JSON.stringify(payload).length > DEBUG_BODY_THRESHOLD) void dumpDebugBody('dmx-chat-body', payload);
  let status: number;
  let raw: string;
  if (JSON.stringify(payload).length > CURL_TRANSPORT_THRESHOLD) {
    agentLog.warn('DMX', `请求体超过 ${CURL_TRANSPORT_THRESHOLD / 1024}KB，改走 curl 传输（${model}）`);
    const r = await postJsonViaCurl(`${BASE}/v1/chat/completions`, ['Content-Type: application/json', `Authorization: Bearer ${key}`], payload);
    status = r.status;
    raw = r.data;
  } else {
    const res = await tauriFetch(`${BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: Body.json(payload),
      responseType: ResponseType.Text,
      timeout: timeoutSec(),
    });
    status = res.status;
    raw = String(res.data);
  }
  if (status < 200 || status >= 300) throw new Error(`HTTP ${status}: ${raw.slice(0, 300)}`);
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`返回非 JSON: ${raw.slice(0, 300)}`);
  }
  const choices = j.choices as Array<{ message?: { content?: string } }> | undefined;
  return choices?.[0]?.message?.content || '';
}

/** One-shot vision description: local path / URL + instruction → text. */
export async function dmxVisionDescribe(image: string, instruction: string): Promise<string> {
  const result = await visionWithFallback(image, instruction);
  return result.text;
}

export async function visionWithFallback(
  image: string,
  instruction: string,
): Promise<{ text: string; model: string; label: string }> {
  // 用户自定义识图端点：OpenAI 兼容 chat/completions（可在「设置 → 识图与联网」配置）
  if (useSettingsStore.getState().visionApiMode === 'custom') {
    const s = useSettingsStore.getState();
    const url = await loadImageInput(image);
    const text = await postCustomChat({
      baseUrl: s.visionCustomBaseUrl,
      apiKey: s.visionCustomApiKey,
      model: s.visionCustomModel,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url } },
            { type: 'text', text: instruction },
          ],
        },
      ],
    }).catch((err) => {
      throw new Error(`自定义识图端点失败: ${err instanceof Error ? err.message : String(err)}（可在「设置 → 识图与联网」检查配置，或切回自动模式）`);
    });
    return { text, model: s.visionCustomModel.trim() || 'custom', label: '自定义端点' };
  }

  let kimiError = '';
  let kimiStatus: number | undefined;
  if (isKimiK3Configured()) {
    try {
      return await kimiK3Vision(image, instruction);
    } catch (error) {
      kimiError = error instanceof Error ? error.message : String(error);
      const status = (error as { status?: number })?.status;
      kimiStatus = typeof status === 'number' ? status : undefined;
    }
  }
  // 配置/鉴权类错误（400/401/403/404）是确定性的：重试和换通道都不会变好，
  // 静默落到 DMX 只会持续烧用户额度（真实问题：用户配了原生 Kimi，DMX
  // kimi-k3 却被大量调用）。直接报错并给出修复指引，不自动降级。
  if (kimiError && kimiStatus !== undefined && [400, 401, 403, 404].includes(kimiStatus)) {
    throw new Error(
      `原生 Kimi K3 识图被拒（HTTP ${kimiStatus}）：${kimiError.slice(0, 200)}。`
      + '这属于配置问题，已停止自动降级到 DMX 备用通道以免持续产生意外扣费。'
      + '请检查「设置 → 模型与服务 → Kimi」的 Key 与 Base URL（coding 套餐与普通开放平台 Key 不通用），'
      + '或在「设置 → 识图与联网」改用自定义端点。',
    );
  }
  try {
    const fallback = await dmxVisionWithFallback(image, instruction);
    // 只有瞬时故障（429/5xx/网络）才走到这里；在结果标注降级及原因，
    // 让本次 DMX 备用消耗对用户可见，而不是无声发生。
    if (kimiError) {
      return {
        ...fallback,
        model: `${fallback.model}（原生 Kimi 暂时失败，已降级 DMX: ${kimiError.replace(/\s+/g, ' ').slice(0, 80)}）`,
      };
    }
    return fallback;
  } catch (error) {
    if (!kimiError) throw error;
    const dmxError = error instanceof Error ? error.message : String(error);
    throw new Error(`Kimi K3 识别失败: ${kimiError}; DMX 备用识别失败: ${dmxError}`);
  }
}

interface VisionModelDef {
  model: string;
  endpoint: 'chat' | 'responses';
  label: string;
}

const VISION_MODELS: VisionModelDef[] = [
  // DMXAPI 上的 kimi-k3 与原生 Kimi K3 同模型且支持视觉（已实测），
  // 未配置原生 Kimi 时的首选；Gemini 已按成本要求移除。
  { model: 'kimi-k3', endpoint: 'chat', label: 'Kimi K3 (DMX)' },
  { model: 'doubao-seed-2-0-lite-260215', endpoint: 'chat', label: '豆包' },
  { model: 'gpt-4o-mini', endpoint: 'chat', label: 'GPT-4o-mini' },
  { model: 'mimo-v2-omni', endpoint: 'chat', label: 'MiMo' },
  { model: 'DeepSeek-OCR', endpoint: 'chat', label: 'DeepSeek' },
  { model: 'qwen3-omni-flash-all', endpoint: 'responses', label: 'Qwen' },
];

export async function dmxVisionWithFallback(
  image: string,
  instruction: string,
): Promise<{ text: string; model: string; label: string }> {
  const url = await loadImageInput(image);
  agentLog.info('DMX', `识图请求就绪: 内联 ${(url.length / 1024).toFixed(0)}KB（data URL）`);
  const messages = [
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url } },
        { type: 'text', text: instruction },
      ],
    },
  ];
  const errors: string[] = [];
  for (const m of VISION_MODELS) {
    try {
      let text: string;
      if (m.endpoint === 'chat') {
        text = await dmxChat(m.model, messages);
      } else {
        text = await dmxResponsesStream(m.model, messages, { modalities: ['text'] });
      }
      if (text.trim()) {
        return { text: text.trim(), model: m.model, label: m.label };
      }
      errors.push(`${m.label}: 空内容`);
    } catch (err) {
      errors.push(`${m.label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`所有识图模型均失败: ${errors.join('; ')}`);
}
