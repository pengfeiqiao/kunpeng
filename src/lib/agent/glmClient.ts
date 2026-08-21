import type { AgentMessage, StreamDelta, ToolDefinition } from './types';
import { agentLog } from './logger';
import { AnthropicSseDataParser } from './anthropicSse';
import { invoke } from '@tauri-apps/api/tauri';
import { appWindow } from '@tauri-apps/api/window';
import { fetch as tauriFetch, Body, ResponseType } from '@tauri-apps/api/http';

export interface GLMClientConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  thinkingEffort?: 'low' | 'high' | 'max';
  userAgent?: string;
  appId?: string;
  maxOutputTokens?: number;
  /** Also send `Authorization: Bearer <key>` alongside x-api-key — some
   * Anthropic-compatible gateways (DashScope, Ark) expect Bearer auth. */
  bearerAuth?: boolean;
}

/**
 * GLM-5.3 and later always think; the endpoint rejects requests that omit the
 * thinking param (error 1210: "该模型始终思考，不支持关闭思考"). Older GLM
 * models treat the same param as optional, so we only force it here.
 */
function modelRequiresThinking(model: string): boolean {
  return /^glm-5\.[3-9]/i.test(model.trim()) || /^glm-[6-9]/i.test(model.trim());
}

/**
 * Native multimodal capability by host+model. Kimi and MiniMax accept media
 * blocks for every model; DeepSeek's official API only accepts images on its
 * vision models (e.g. deepseek-v4-flash-vision-exp — other models either
 * substitute an "[Unsupported Image]" placeholder or hard-reject the request,
 * both verified against the live endpoints).
 */
export function supportsNativeVision(baseUrl: string, model: string): boolean {
  if (/api\.kimi\.com|minimaxi\.com|minimax\.io/i.test(baseUrl)) return true;
  if (/deepseek\.com/i.test(baseUrl)) return /vision/i.test(model);
  return false;
}

const IMAGE_UNSUPPORTED_RE = /does not support image|unsupported image|image.*not.*support|invalid image|无法.*图|不支持.*图/i;

function hasImageBlocks(messages: AgentMessage[]): boolean {
  return messages.some((message) => {
    if (message.role === 'tool' && message.media?.some((block) => block.type === 'image')) return true;
    if (message.role === 'user' && Array.isArray(message.content)) {
      return message.content.some((block) => block.type === 'image');
    }
    return false;
  });
}

const DEFAULT_CONFIG: Partial<GLMClientConfig> = {
  baseUrl: 'https://open.bigmodel.cn/api/anthropic',
  model: 'glm-5.1',
};

// ── Event Queue for Tauri Events ─────────────────────────────────────────────

class EventQueue<T> {
  private queue: T[] = [];
  private resolve: ((v: T) => void) | null = null;

  push(item: T) {
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r(item);
    } else {
      this.queue.push(item);
    }
  }

  async next(timeoutMs?: number): Promise<T | undefined> {
    if (this.queue.length > 0) return this.queue.shift()!;
    return new Promise((r) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      this.resolve = (v) => {
        if (timer) clearTimeout(timer);
        r(v);
      };
      if (timeoutMs && timeoutMs > 0) {
        timer = setTimeout(() => {
          this.resolve = null;
          r(undefined);
        }, timeoutMs);
      }
    });
  }
}

// ── Retry ─────────────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;
const STREAM_FIRST_EVENT_TIMEOUT_MS = 120_000;
const STREAM_IDLE_EVENT_TIMEOUT_MS = 90_000;
let streamRequestSequence = 0;

function nextStreamRequestId(): string {
  streamRequestSequence = (streamRequestSequence + 1) % Number.MAX_SAFE_INTEGER;
  const randomPart = globalThis.crypto?.randomUUID?.()
    ?? Math.random().toString(36).slice(2, 12);
  return `stream-${Date.now()}-${streamRequestSequence}-${randomPart}`;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

// ── Convert messages for Anthropic format ─────────────────────────────────────

interface AContentBlock {
  type: string;
  [key: string]: unknown;
}

interface AMessage {
  role: string;
  content: string | AContentBlock[];
}

function convertMessages(
  messages: AgentMessage[],
  opts?: { injectThinking?: boolean; allowMedia?: boolean },
): { system: string; messages: AMessage[] } {
  let system = '';
  const result: AMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = msg.content;
      continue;
    }

    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        if (msg.content.trim()) result.push({ role: 'user', content: msg.content });
      } else {
        const content = msg.content.flatMap((block): AContentBlock[] => {
          if (block.type === 'text') {
            return block.text.trim() ? [{ type: 'text', text: block.text }] : [];
          }
          if (opts?.allowMedia) {
            // Kimi Code accepts inline video data or files previously uploaded
            // to its own file service (`ms://...`). Arbitrary HTTP video URLs
            // are rejected and would poison every later request in the same
            // session, so preserve them as context text instead.
            if (
              block.type === 'video' &&
              block.source.type === 'url' &&
              !block.source.url.startsWith('ms://')
            ) {
              return [{
                type: 'text',
                text: `[此前的视频公网链接未直接附加：${block.source.url}。Kimi 视频必须先上传到其文件服务。]`,
              }];
            }
            return [block as AContentBlock];
          }
          return [{
            type: 'text',
            text: block.type === 'video'
              ? '[本轮附有视频；当前模型不支持原生视频块，请按消息中的本地路径调用视频分析或转写工具。]'
              : '[本轮附有图片；当前模型不支持原生图片块，请按消息中的本地路径调用图片识别工具。]',
          }];
        });
        if (content.length) result.push({ role: 'user', content });
      }
      continue;
    }

    if (msg.role === 'assistant') {
      const blocks: AContentBlock[] = [];
      // Thinking blocks MUST come first in the content array (Anthropic spec).
      // DeepSeek rejects requests that drop them; GLM tolerates either way.
      if (msg.thinking_blocks?.length) {
        for (const tb of msg.thinking_blocks) {
          blocks.push({
            type: 'thinking',
            thinking: tb.thinking,
            ...(tb.signature ? { signature: tb.signature } : {}),
          } as AContentBlock);
        }
      } else if (opts?.injectThinking && (msg.content?.trim() || msg.tool_calls?.length)) {
        // DeepSeek requires every assistant turn to start with a thinking block
        // even when we're in a legacy session whose assistant turns were
        // produced before thinking capture was wired up. Inject a synthetic
        // empty one so the request validates.
        blocks.push({ type: 'thinking', thinking: '' } as AContentBlock);
      }
      if (msg.content) {
        blocks.push({ type: 'text', text: msg.content });
      }
      if (msg.tool_calls?.length) {
        for (const tc of msg.tool_calls) {
          let input: Record<string, unknown> = {};
          try { input = JSON.parse(tc.function.arguments); } catch { /* empty */ }
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input });
        }
      }
      if (blocks.length === 1 && blocks[0].type === 'text') {
        result.push({ role: 'assistant', content: blocks[0].text as string });
      } else if (blocks.length > 0) {
        result.push({ role: 'assistant', content: blocks });
      }
      continue;
    }

    if (msg.role === 'tool') {
      // Tool results → user message with tool_result blocks
      // Merge consecutive tool results into one user message
      const mediaBlocks = opts?.allowMedia
        ? (msg.media ?? []).filter((item) => item.type === 'image' || item.type === 'video') as AContentBlock[]
        : [];
      const block: AContentBlock = {
        type: 'tool_result',
        tool_use_id: msg.tool_call_id || '',
        content: mediaBlocks.length
          ? [{ type: 'text', text: msg.content }, ...mediaBlocks]
          : msg.content,
      };
      const last = result[result.length - 1];
      if (
        last?.role === 'user' &&
        Array.isArray(last.content) &&
        (last.content as AContentBlock[]).every((b) => b.type === 'tool_result')
      ) {
        (last.content as AContentBlock[]).push(block);
      } else {
        result.push({ role: 'user', content: [block] });
      }
    }
  }

  return { system, messages: sanitizeToolPairing(result) };
}

/**
 * Two-way sanitize tool_use / tool_result pairing.
 *
 * Anthropic/DeepSeek require: every tool_use in an assistant message must be
 * followed by a matching tool_result in the next user message, and vice versa.
 * A one-sided filter (drop orphan tool_results only) leaves orphan tool_uses
 * that cause the upstream to hang or 400. This helper builds the set of
 * valid pairs and drops BOTH sides of any broken pair.
 */
function sanitizeToolPairing(messages: AMessage[]): AMessage[] {
  // Pass 1: find valid (assistantIdx, toolUseId) pairs where the *immediately
  // following* user message contains a matching tool_result.
  const validIds = new Set<string>();
  for (let i = 0; i < messages.length - 1; i++) {
    const a = messages[i];
    const u = messages[i + 1];
    if (a.role !== 'assistant' || !Array.isArray(a.content)) continue;
    if (u.role !== 'user' || !Array.isArray(u.content)) continue;

    const resultIds = new Set<string>();
    for (const b of u.content as AContentBlock[]) {
      if (b.type === 'tool_result') {
        const id = (b as { tool_use_id?: string }).tool_use_id;
        if (id) resultIds.add(id);
      }
    }
    for (const b of a.content as AContentBlock[]) {
      const bid = b.id as string | undefined;
      if (b.type === 'tool_use' && bid && resultIds.has(bid)) {
        validIds.add(bid);
      }
    }
  }

  // Pass 2: rebuild, dropping orphan tool_use / tool_result blocks.
  const out: AMessage[] = [];
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) {
      // Anthropic-compatible APIs reject empty turns. They can appear after an
      // interrupted tool run or when a model emitted thinking without display
      // text. Dropping them is safe; consecutive same-role turns are combined
      // by the Messages API.
      if (msg.content.trim()) out.push(msg);
      continue;
    }
    const kept = (msg.content as AContentBlock[]).filter((b) => {
      if (b.type === 'tool_use') { const bid = b.id as string | undefined; return !!bid && validIds.has(bid); }
      if (b.type === 'tool_result') {
        const id = (b as { tool_use_id?: string }).tool_use_id;
        return !!id && validIds.has(id);
      }
      return true;
    });
    // If this was a user-with-only-tool_results and all are gone, drop it.
    if (
      msg.role === 'user' &&
      kept.length === 0 &&
      (msg.content as AContentBlock[]).every((b) => b.type === 'tool_result')
    ) {
      continue;
    }
    // Never preserve a removed tool turn as an empty message. Kimi and the
    // stricter Anthropic gateways reject it before the model starts.
    if (kept.length === 0) {
      continue;
    }
    out.push({ ...msg, content: kept });
  }
  return out;
}

function convertTools(tools?: ToolDefinition[]) {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

// ── Anthropic SSE → OpenAI StreamDelta adapter ────────────────────────────────

interface SSEEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * State machine for converting Anthropic SSE events to OpenAI StreamDelta.
 * Tracks content block types and tool_use indexing.
 */
class AnthropicStreamAdapter {
  private messageId = `msg_${Date.now()}`;
  private blockTypes = new Map<number, string>();
  /** Whether message_delta already delivered a real stop_reason. */
  private sawStopReason = false;
  /** Maps Anthropic content block index → { tool info + sequential tool call index } */
  private toolUseBlocks = new Map<number, { id: string; name: string; seqIdx: number }>();
  private nextToolIdx = 0;
  /** Maps thinking-block index → accumulating {thinking, signature}. Emitted on content_block_stop. */
  private thinkingBlocks = new Map<number, { thinking: string; signature?: string }>();

  /** Strip U+FFFD replacement characters caused by incomplete UTF-8 at chunk boundaries */
  private static cleanText(text: string | undefined | null): string {
    if (!text) return '';
    return text.replace(/\uFFFD/g, '');
  }

  convert(event: SSEEvent): StreamDelta | null {
    switch (event.type) {
      case 'error': {
        const payload = event.error as { type?: string; message?: string } | undefined;
        const errorType = payload?.type ?? 'stream_error';
        const status = errorType === 'rate_limit_error'
          ? 429
          : errorType === 'overloaded_error'
            ? 529
            : errorType === 'authentication_error'
              ? 401
              : errorType === 'invalid_request_error'
                ? 400
                : 0;
        const err = new Error(`${status || 'network'}: ${payload?.message || errorType}`) as Error & { status: number };
        err.status = status;
        throw err;
      }
      case 'message_start': {
        const msg = event.message as Record<string, unknown> | undefined;
        if (msg?.id) this.messageId = msg.id as string;
        const usage = msg?.usage as { input_tokens?: number; output_tokens?: number } | undefined;
        if (usage) {
          return this.wrap({}, {
            prompt_tokens: usage.input_tokens || 0,
            completion_tokens: usage.output_tokens || 0,
            total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
          });
        }
        return null;
      }

      case 'content_block_start': {
        const idx = event.index as number;
        const block = event.content_block as Record<string, unknown>;
        const btype = block?.type as string;
        this.blockTypes.set(idx, btype);
        agentLog.debug('Anthropic', `content_block_start idx=${idx} type=${btype} keys=[${Object.keys(block || {}).join(',')}]`);

        if (btype === 'tool_use') {
          const seqIdx = this.nextToolIdx++;
          const id = (block.id as string) || `call_${idx}_${Date.now()}`;
          const name = (block.name as string) || '';
          this.toolUseBlocks.set(idx, { id, name, seqIdx });
          return this.wrap({
            tool_calls: [{
              index: seqIdx,
              id,
              type: 'function',
              function: { name, arguments: '' },
            }],
          });
        }

        if (btype === 'thinking') {
          // Initialize accumulator; signature may arrive in a later
          // `signature_delta`. We emit the completed block on content_block_stop.
          const initial = block.thinking as string | undefined;
          this.thinkingBlocks.set(idx, {
            thinking: initial ?? '',
            signature: block.signature as string | undefined,
          });
        }
        return null;
      }

      case 'content_block_delta': {
        const idx = event.index as number;
        const delta = event.delta as Record<string, unknown>;
        const dtype = delta?.type as string;
        if (dtype && dtype !== 'text_delta' && dtype !== 'input_json_delta') {
          agentLog.debug('Anthropic', `content_block_delta idx=${idx} dtype=${dtype} keys=[${Object.keys(delta || {}).join(',')}]`);
        }

        if (dtype === 'text_delta') {
          const text = AnthropicStreamAdapter.cleanText(delta.text as string);
          return text ? this.wrap({ content: text }) : null;
        }

        if (dtype === 'thinking_delta') {
          const text = AnthropicStreamAdapter.cleanText(delta.thinking as string);
          if (text) {
            const tb = this.thinkingBlocks.get(idx);
            if (tb) tb.thinking += text;
          }
          return text ? this.wrap({ reasoning_content: text }) : null;
        }

        if (dtype === 'signature_delta') {
          // Signature arrives separately from thinking text. Accumulate so the
          // completed block emitted at content_block_stop carries it.
          const sig = delta.signature as string | undefined;
          if (sig) {
            const tb = this.thinkingBlocks.get(idx);
            if (tb) tb.signature = (tb.signature ?? '') + sig;
          }
          return null;
        }

        if (dtype === 'input_json_delta') {
          const tu = this.toolUseBlocks.get(idx);
          const partialJson = delta.partial_json;
          if (tu && typeof partialJson === 'string') {
            return this.wrap({
              tool_calls: [{
                index: tu.seqIdx,
                function: { arguments: partialJson },
              }],
            });
          }
        }
        return null;
      }

      case 'message_delta': {
        const delta = event.delta as Record<string, unknown>;
        const usage = event.usage as { output_tokens?: number } | undefined;
        const stopReason = (delta?.stop_reason as string) || null;
        // Remember the real stop reason — a following `message_stop` must not
        // clobber 'max_tokens' with a generic 'stop' (that silently disabled
        // the coordinator's truncation-continuation path).
        if (stopReason) this.sawStopReason = true;
        return {
          id: this.messageId,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: stopReason,
          }],
          usage: usage ? {
            prompt_tokens: 0,
            completion_tokens: usage.output_tokens || 0,
            total_tokens: usage.output_tokens || 0,
          } : undefined,
        };
      }

      case 'content_block_stop': {
        const idx = event.index as number;
        const tb = this.thinkingBlocks.get(idx);
        if (tb) {
          this.thinkingBlocks.delete(idx);
          // Emit completed thinking block so the coordinator can persist it
          // and echo it back on the next request. DeepSeek's Anthropic API
          // rejects requests that drop prior thinking blocks.
          return this.wrap({
            thinking_block: {
              type: 'thinking',
              thinking: tb.thinking,
              signature: tb.signature,
            },
          });
        }
        return null;
      }

      case 'message_stop': {
        return {
          id: this.messageId,
          choices: [{
            index: 0,
            delta: {},
            // message_delta already carried the real stop_reason ('max_tokens'
            // etc.); don't overwrite it with a generic 'stop'.
            finish_reason: this.sawStopReason ? null : 'stop',
          }],
        };
      }

      default:
        return null;
    }
  }

  private wrap(
    delta: StreamDelta['choices'][0]['delta'],
    usage?: StreamDelta['usage'],
  ): StreamDelta {
    return {
      id: this.messageId,
      choices: [{ index: 0, delta, finish_reason: null }],
      usage,
    };
  }
}

// ── GLMClient (Anthropic Messages API) ────────────────────────────────────────

/**
 * GLM API 客户端 — 使用 Anthropic Messages API 格式
 * 通过 open.bigmodel.cn/api/anthropic 代理访问 GLM 模型
 * 内置 429 重试 + Anthropic→OpenAI 流式格式转换
 */
export class GLMClient {
  private config: GLMClientConfig;

  constructor(config: Partial<GLMClientConfig> & { apiKey: string }) {
    this.config = { ...DEFAULT_CONFIG, ...config } as GLMClientConfig;
  }

  updateConfig(patch: Partial<GLMClientConfig>): void {
    Object.assign(this.config, patch);
  }

  /** 构建请求头（chat / streamChat 共用） */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'claude-code-20250219',
      'User-Agent': this.config.userAgent || 'claude-cli/2.1.69',
      'x-app': this.config.appId || 'cli',
    };
    if (this.config.bearerAuth) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }
    return headers;
  }


  /** 非流式聊天（上下文摘要等内部任务） */
  async chat(
    messages: { role: string; content: string }[],
    options?: { maxTokens?: number; model?: string },
  ): Promise<string> {
    return (await this.chatDetailed(messages, options)).text;
  }

  /** 非流式聊天，保留停止原因供长提示词链路判断是否被截断。 */
  async chatDetailed(
    messages: { role: string; content: string }[],
    options?: { maxTokens?: number; model?: string },
  ): Promise<{ text: string; finishReason?: string | null }> {
    const { system, messages: aMsgs } = convertMessages(messages as AgentMessage[]);

    const model = options?.model ?? this.config.model;
    const body: Record<string, unknown> = {
      model,
      system,
      messages: aMsgs,
      max_tokens: options?.maxTokens ?? 2000,
    };
    if (this.config.thinkingEffort || modelRequiresThinking(model)) {
      // GLM-5.3+ always thinks; omitting the param is treated as "disabled"
      // and rejected (error 1210). Verified against the live endpoint.
      body.thinking = { type: 'enabled', effort: this.config.thinkingEffort ?? 'high' };
    }

    const url = `${this.config.baseUrl}/v1/messages`;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const response = await tauriFetch(url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: Body.json(body),
        responseType: ResponseType.JSON,
      });

      if (!response.ok) {
        const errText = typeof response.data === 'string' ? response.data : '';
        // Gateways occasionally echo credentials in error bodies; never let
        // the configured key reach the UI or persisted history.
        const apiKey = this.config.apiKey;
        const safeErrText = apiKey && apiKey.length >= 8 ? errText.replaceAll(apiKey, '[REDACTED]') : errText;
        if (response.status === 429 && attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          agentLog.warn('GLM', `429 rate limited, retrying in ${delay}ms (${attempt + 1}/${MAX_RETRIES})`);
          await sleep(delay);
          continue;
        }
        throw new Error(`GLM API error ${response.status}: ${safeErrText || 'unknown'}`);
      }

      const data = response.data as Record<string, unknown>;
      const content = data.content as Array<{ type: string; text?: string }> | undefined;
      // Some Anthropic-compatible gateways split one answer into multiple text
      // blocks. Reading only the first block silently discarded the tail.
      const text = content
        ?.filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text || '')
        .join('') || '';
      return {
        text,
        finishReason: typeof data.stop_reason === 'string' ? data.stop_reason : null,
      };
    }

    throw new Error('GLM API 429: 速率限制，已重试 3 次仍失败');
  }

  /**
   * 流式聊天 — AsyncGenerator<StreamDelta>
   * 请求用 Rust 后端代理，通过 Tauri Event 逐块接收 SSE
   * coordinator 无需任何改动
   */
  async *streamChat(
    messages: AgentMessage[],
    tools?: ToolDefinition[],
    signal?: AbortSignal,
    modelOverride?: string,
  ): AsyncGenerator<StreamDelta> {
    const requestModel = modelOverride ?? this.config.model;
    // 原生视觉默认开启：请求带图片且模型支持原生视觉时先走多模态；
    // 若端点拒绝图片内容（未产出任何 delta），自动降级为文本占位符
    // （系统提示会引导模型改用 image_recognition 工具）。
    const requestHadMedia = hasImageBlocks(messages);
    let textOnlyRetry = false;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // Mid-stream failures must NOT be retried here: chunks already delivered
      // downstream would be emitted twice (duplicate UI text, corrupted
      // tool_call arguments). Only retry when nothing was yielded yet — this
      // matches the router's `!yieldedAny` fallback semantics (router.ts).
      let yieldedAny = false;
      try {
        for await (const delta of this._streamChatOnce(messages, tools, signal, requestModel, textOnlyRetry)) {
          yieldedAny = true;
          yield delta;
        }
        return;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (
          requestHadMedia && !textOnlyRetry && !yieldedAny
          && supportsNativeVision(this.config.baseUrl, requestModel)
          && IMAGE_UNSUPPORTED_RE.test(errMsg)
        ) {
          agentLog.warn('GLM', 'endpoint rejected image content, retrying text-only (image_recognition tool path)');
          textOnlyRetry = true;
          continue;
        }
        const status = typeof err === 'object' && err !== null && 'status' in err
          ? Number((err as { status?: number }).status)
          : undefined;
        const is429 = status === 429 || errMsg.includes('429');
        const isTransportFailure =
          status === 0
          || /network|connection|socket|dns|tls|timed? ?out|超时|failed to fetch|error sending request/i.test(errMsg);
        if ((is429 || isTransportFailure) && attempt < MAX_RETRIES && !signal?.aborted && !yieldedAny) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          agentLog.warn(
            'GLM',
            `${is429 ? '429 rate limited' : 'transport failure'}, retrying stream in ${delay}ms (${attempt + 1}/${MAX_RETRIES})`,
          );
          await sleep(delay, signal);
          continue;
        }
        throw err;
      }
    }
  }

  private async *_streamChatOnce(
    messages: AgentMessage[],
    tools?: ToolDefinition[],
    signal?: AbortSignal,
    requestModel = this.config.model,
    forceTextOnly = false,
  ): AsyncGenerator<StreamDelta> {
    // If the signal is already aborted (e.g. user clicked stop during tool
    // execution in the previous turn), throw immediately so the coordinator's
    // catch block handles it properly instead of making a new HTTP request.
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const adapter = new AnthropicStreamAdapter();
    // Only DeepSeek requires a synthetic thinking block for legacy assistant
    // turns. Kimi accepts historical text directly and rejects empty synthetic
    // assistant content in some tool-call histories.
    // DeepSeek AND MiniMax both require thinking blocks echoed back in
    // multi-turn tool-call histories; GLM tolerates the field.
    const requiresThinkingHistory = /deepseek\.com|minimaxi\.com|minimax\.io/i.test(this.config.baseUrl);
    const { system, messages: aMsgs } = convertMessages(messages, {
      injectThinking: requiresThinkingHistory,
      // Native vision is on by default for capable hosts/models (Kimi,
      // MiniMax, and DeepSeek vision models); other providers get text
      // placeholders that route vision through tools.
      allowMedia: !forceTextOnly && supportsNativeVision(this.config.baseUrl, requestModel),
    });
    const aTools = convertTools(tools);

    const body: Record<string, unknown> = {
      model: requestModel,
      system,
      messages: aMsgs,
      max_tokens: this.config.maxOutputTokens ?? 16000,
      stream: true,
    };
    if (aTools) body.tools = aTools;

    // DeepSeek's Anthropic endpoint requires `thinking` param when thinking
    // blocks are echoed in history. Enable it for deepseek.com hosts.
    // GLM tolerates the field; it'll emit thinking blocks as usual.
    // GLM-5.3+ goes further: omitting the param is rejected outright (1210).
    if (/deepseek\.com/i.test(this.config.baseUrl)) {
      body.thinking = { type: 'enabled', budget_tokens: 4000 };
    } else if (this.config.thinkingEffort || modelRequiresThinking(requestModel)) {
      body.thinking = { type: 'enabled', effort: this.config.thinkingEffort ?? 'high' };
    }

    const url = `${this.config.baseUrl}/v1/messages`;
    const headers = this.buildHeaders();

    // Diagnostic: log thinking-block presence in the outgoing assistant turns.
    // Helps debug DeepSeek's "thinking must be passed back" 400.
    const thinkingStat = aMsgs.reduce(
      (acc, m) => {
        if (m.role !== 'assistant') return acc;
        if (Array.isArray(m.content)) {
          const tb = (m.content as Array<{ type: string }>).filter((b) => b.type === 'thinking').length;
          acc.assistantTurns += 1;
          acc.assistantWithThinking += tb > 0 ? 1 : 0;
          acc.totalThinkingBlocks += tb;
        } else {
          acc.assistantTurns += 1;
        }
        return acc;
      },
      { assistantTurns: 0, assistantWithThinking: 0, totalThinkingBlocks: 0 },
    );
    agentLog.info(
      'GLM',
      `→ ${requestModel} @ ${this.config.baseUrl}: ${aMsgs.length} msgs, assistantTurns=${thinkingStat.assistantTurns} (${thinkingStat.assistantWithThinking} w/thinking, ${thinkingStat.totalThinkingBlocks} blocks)`,
    );

    const requestId = nextStreamRequestId();
    const queue = new EventQueue<string>();
    let unlisten: (() => void) | null = null;
    let unlistenDone: (() => void) | null = null;
    let unlistenError: (() => void) | null = null;
    let isDone = false;

    // Abort handler is named so the finally block can detach it from the
    // run-wide signal. Without this, every turn stacked one more {once:true}
    // listener on the shared AbortController and an eventual abort fired
    // abort_stream_request for long-finished request ids.
    const onAbort = () => {
      isDone = true;
      queue.push('[DONE]');
      invoke('abort_stream_request', { requestId }).catch(() => {});
    };

    // Everything from listener registration onward is guarded by try/finally:
    // ANY exit path (normal end, [ERROR] throw, consumer break/return of this
    // generator, abort) must unlisten the Tauri event listeners and stop the
    // Rust-side stream, or both leak for the rest of the session.
    try {
      // Set up event listeners
      agentLog.info('GLM', `Setting up listener for stream-chunk-${requestId}`);
      unlisten = await appWindow.listen(`stream-chunk-${requestId}`, (event) => {
        const chunk = (event.payload as any).chunk;
        queue.push(chunk);
      });

      if (signal) {
        if (signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }

      unlistenDone = await appWindow.listen(`stream-done-${requestId}`, () => {
        agentLog.info('GLM', 'Stream completed');
        isDone = true;
        queue.push('[DONE]');
      });

      unlistenError = await appWindow.listen(`stream-error-${requestId}`, (event) => {
        const error = event.payload as any;
        isDone = true;
        queue.push(`[ERROR]: ${error.status} - ${error.message}`);
      });

      // Start the stream request
      agentLog.info('GLM', `Starting stream with request ID: ${requestId}`);
      await invoke('stream_http_request', {
        requestId,
        url,
        headers,
        body: JSON.stringify(body),
      });

      // Rust slices transport chunks at arbitrary byte boundaries. The parser
      // consumes complete SSE lines only, so a partial `data:` line is never
      // appended once now and then appended again with the next chunk.
      const sseParser = new AnthropicSseDataParser();
      let chunk: string | undefined;
      let gotAnyChunk = false;

      const convertPayload = (payload: string): StreamDelta | null => {
        if (!payload || payload === '[DONE]') return null;
        let event: SSEEvent;
        try {
          event = JSON.parse(payload) as SSEEvent;
        } catch (err) {
          agentLog.warn('Anthropic', `Ignoring malformed SSE event (${payload.length} chars)`, err);
          return null;
        }
        // Adapter errors are intentionally outside the JSON parse catch. An
        // Anthropic `type:error` event must reach the router/fallback layer.
        return adapter.convert(event);
      };

      while (!isDone) {
        chunk = await queue.next(gotAnyChunk ? STREAM_IDLE_EVENT_TIMEOUT_MS : STREAM_FIRST_EVENT_TIMEOUT_MS);
        if (chunk === undefined) {
          const phase = gotAnyChunk ? '空闲' : '首包';
          invoke('abort_stream_request', { requestId }).catch(() => {});
          throw new Error(`模型流式响应${phase}超时（${Math.round((gotAnyChunk ? STREAM_IDLE_EVENT_TIMEOUT_MS : STREAM_FIRST_EVENT_TIMEOUT_MS) / 1000)} 秒无数据）`);
        }
        if (chunk === '[DONE]') {
          break;
        }
        gotAnyChunk = true;
        // Check for error chunk. Format is `[ERROR]: {status} - {message}`;
        // extract the status as a typed property so the router's fallback logic
        // and any upstream error handlers can branch on it.
        if (typeof chunk === 'string' && chunk.startsWith('[ERROR]:')) {
          const rest = chunk.slice(8).trimStart();
          const m = rest.match(/^(\d+)\s*-\s*([\s\S]*)$/);
          const status = m ? parseInt(m[1], 10) : 0;
          const message = m ? m[2] : rest;
          const err = new Error(`${status || 'network'}: ${message}`) as Error & { status: number };
          err.status = status;
          throw err;
        }
        for (const payload of sseParser.push(chunk)) {
          const delta = convertPayload(payload);
          if (delta) yield delta;
        }
      }
      for (const payload of sseParser.finish()) {
        const delta = convertPayload(payload);
        if (delta) yield delta;
      }
    } finally {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (unlisten) {
        unlisten();
        unlisten = null;
      }
      if (unlistenDone) {
        unlistenDone();
        unlistenDone = null;
      }
      if (unlistenError) {
        unlistenError();
        unlistenError = null;
      }
      // If we're exiting before the Rust task finished (error thrown above,
      // or the consumer stopped iterating), make sure the upstream HTTP
      // stream is torn down. No-op if the request already completed.
      if (!isDone) {
        invoke('abort_stream_request', { requestId }).catch(() => {});
      }
    }
  }
}
