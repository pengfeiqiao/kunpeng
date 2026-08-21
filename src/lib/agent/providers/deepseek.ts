/**
 * DeepSeek provider — supports BOTH the official Anthropic-compatible endpoint
 * (`https://api.deepseek.com/anthropic`, the default and recommended path) and
 * the OpenAI-compatible endpoint (`https://api.deepseek.com/v1`).
 *
 * Mode detection is by baseUrl: if it contains `/anthropic`, requests go
 * through GLMClient (which speaks Anthropic Messages API + uses kunpeng's
 * Rust SSE proxy). Otherwise we fall back to the OpenAI-compatible streaming
 * path implemented inline below.
 *
 * Models tracked here as of 2026-04:
 *   - deepseek-v4-pro       (Anthropic API; unknown names fall back to flash)
 *   - deepseek-v4-flash     (Anthropic API)
 *   - deepseek-v4           (OpenAI-compatible API)
 *   - deepseek-chat         (OpenAI-compatible API alias)
 *   - deepseek-reasoner     (R1 series, OpenAI-compatible)
 */

import { invoke } from '@tauri-apps/api/tauri';
import { appWindow } from '@tauri-apps/api/window';
import type { Provider, ChatRequest, ChatOptions, CompletionResult, ModelDef, SimpleCompletionRequest } from './types';
import type { AgentMessage, StreamDelta, ToolDefinition } from '../types';
import { agentLog } from '../logger';
import { withRetry } from '../withRetry';
import { GLMClient } from '../glmClient';
import { sanitizeOpenAIToolPairing } from './pairing';

const MODELS: ModelDef[] = [
  {
    id: 'deepseek-v4-pro',
    displayName: 'DeepSeek V4 Pro (Anthropic API)',
    contextWindow: 1_000_000,
    supportsTools: true,
  },
  {
    id: 'deepseek-v4-flash',
    displayName: 'DeepSeek V4 Flash (Anthropic API)',
    contextWindow: 1_000_000,
    supportsTools: true,
  },
  {
    id: 'deepseek-v4',
    displayName: 'DeepSeek V4 (OpenAI API)',
    contextWindow: 1_000_000,
    supportsTools: true,
  },
  {
    id: 'deepseek-chat',
    displayName: 'DeepSeek Chat (OpenAI API)',
    contextWindow: 1_000_000,
    supportsTools: true,
  },
  {
    id: 'deepseek-reasoner',
    displayName: 'DeepSeek R1 (Reasoner)',
    contextWindow: 64_000,
    supportsTools: false,
  },
];

export interface DeepSeekConfig {
  apiKey: string;
  baseUrl?: string;
  modelId?: string;
}

function isAnthropicBase(url: string): boolean {
  return /\/anthropic(\/|$)/.test(url);
}

export class DeepSeekProvider implements Provider {
  readonly id = 'deepseek';
  readonly displayName = 'DeepSeek';
  readonly baseUrl: string;
  readonly models = MODELS;
  readonly defaultModelId: string;

  private anthropicClient: GLMClient | null = null;

  constructor(private cfg: DeepSeekConfig) {
    this.baseUrl = cfg.baseUrl || 'https://api.deepseek.com/anthropic';
    this.defaultModelId = cfg.modelId || (isAnthropicBase(this.baseUrl) ? 'deepseek-v4-pro' : 'deepseek-v4');

    if (isAnthropicBase(this.baseUrl)) {
      this.anthropicClient = new GLMClient({
        apiKey: cfg.apiKey,
        baseUrl: this.baseUrl,
        model: this.defaultModelId,
      });
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.cfg.apiKey) return false;
    if (this.anthropicClient) {
      // Anthropic mode — GLMClient has no cheap probe; treat key presence as ok.
      // Fallback chain catches real failures via 4xx/5xx mid-stream.
      return true;
    }
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.cfg.apiKey}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async chat(req: SimpleCompletionRequest, opts: ChatOptions): Promise<string> {
    return (await this.chatDetailed(req, opts)).text;
  }

  async chatDetailed(req: SimpleCompletionRequest, opts: ChatOptions): Promise<CompletionResult> {
    if (this.anthropicClient) {
      const target = req.modelId ?? this.defaultModelId;
      return this.anthropicClient.chatDetailed(req.messages, { maxTokens: req.maxTokens, model: target });
    }
    const body = {
      model: req.modelId ?? this.defaultModelId,
      messages: req.messages,
      max_tokens: req.maxTokens ?? 2000,
      stream: false,
    };
    return withRetry(async () => {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: opts.signal,
      });
      if (!res.ok) {
        const text = await res.text();
        const err = new Error(`DeepSeek ${res.status}: ${text}`) as Error & { status: number };
        err.status = res.status;
        throw err;
      }
      const data = await res.json();
      return {
        text: data.choices?.[0]?.message?.content ?? '',
        finishReason: data.choices?.[0]?.finish_reason ?? null,
      };
    }, { source: opts.source, signal: opts.signal });
  }

  async *streamChat(req: ChatRequest, opts: ChatOptions): AsyncGenerator<StreamDelta> {
    if (this.anthropicClient) {
      const target = req.modelId ?? this.defaultModelId;
      yield* this.anthropicClient.streamChat(req.messages, req.tools, opts.signal, target);
      return;
    }

    const { messages, tools, modelId, maxTokens, temperature } = req;
    const body = {
      model: modelId ?? this.defaultModelId,
      messages: convertMessagesForOpenAI(messages),
      tools: convertToolsForOpenAI(tools),
      max_tokens: maxTokens ?? 16_000,
      temperature: temperature ?? 0.7,
      stream: true,
    };

    // Use the Rust SSE proxy so we inherit idle-timeout + abort plumbing.
    const requestId = `deepseek-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const queue: { type: 'chunk' | 'done' | 'error'; data?: string; status?: number; message?: string }[] = [];
    let resolveNext: ((v: void) => void) | null = null;
    const wake = () => { resolveNext?.(); resolveNext = null; };

    const offChunk = await appWindow.listen<{ chunk: string }>(
      `stream-chunk-${requestId}`,
      (e) => { queue.push({ type: 'chunk', data: e.payload.chunk }); wake(); },
    );
    const offDone = await appWindow.listen<unknown>(
      `stream-done-${requestId}`,
      () => { queue.push({ type: 'done' }); wake(); },
    );
    const offError = await appWindow.listen<{ status: number; message: string }>(
      `stream-error-${requestId}`,
      (e) => { queue.push({ type: 'error', status: e.payload.status, message: e.payload.message }); wake(); },
    );

    const onAbort = () => {
      void invoke('abort_stream_request', { requestId }).catch(() => {});
      // Rust cancels the in-flight task WITHOUT emitting stream-done/error,
      // so the loop below would await `resolveNext` forever (run never
      // settles, listeners leak). Push a terminal event ourselves — mirrors
      // glmClient's abort path. The coordinator turns this into AbortError.
      queue.push({ type: 'done' });
      wake();
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      await invoke('stream_http_request', {
        requestId,
        url: `${this.baseUrl}/chat/completions`,
        headers: this.headers(),
        body: JSON.stringify(body),
      });

      // Parse SSE-formatted text into StreamDelta chunks.
      let buf = '';
      while (true) {
        if (queue.length === 0) {
          await new Promise<void>((r) => { resolveNext = r; });
        }
        const ev = queue.shift()!;
        if (ev.type === 'error') {
          throw makeStatusError(ev.status ?? 0, ev.message ?? 'unknown');
        }
        if (ev.type === 'done') {
          if (buf.trim().length > 0) {
            for (const delta of parseSSEBlock(buf)) yield delta;
          }
          return;
        }
        buf += ev.data ?? '';
        let sep = buf.indexOf('\n\n');
        while (sep !== -1) {
          const block = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          for (const delta of parseSSEBlock(block)) yield delta;
          sep = buf.indexOf('\n\n');
        }
      }
    } finally {
      // A consumer can stop after receiving partial output without aborting
      // the run-wide signal. Tear down the Rust request as well as listeners.
      void invoke('abort_stream_request', { requestId }).catch(() => {});
      offChunk();
      offDone();
      offError();
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.cfg.apiKey}`,
    };
  }
}

function makeStatusError(status: number, message: string): Error {
  const err = new Error(`DeepSeek ${status}: ${message}`) as Error & { status: number };
  err.status = status;
  return err;
}

function convertMessagesForOpenAI(messages: AgentMessage[]): unknown[] {
  return sanitizeOpenAIToolPairing(messages);
}

function convertToolsForOpenAI(tools?: ToolDefinition[]): unknown[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/**
 * Parse one SSE block (`data: {...json...}` lines) into one or more
 * StreamDelta chunks. OpenAI emits one chunk per block.
 */
function parseSSEBlock(block: string): StreamDelta[] {
  const out: StreamDelta[] = [];
  for (const line of block.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const parsed = JSON.parse(payload);
      out.push(parsed as StreamDelta);
    } catch (err) {
      agentLog.warn('DeepSeek', `Failed to parse SSE line: ${payload}`, err);
    }
  }
  return out;
}
