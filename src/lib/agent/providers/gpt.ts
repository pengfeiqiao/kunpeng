import { invoke } from '@tauri-apps/api/tauri';
import { appWindow } from '@tauri-apps/api/window';
import { fetch as httpFetch, ResponseType } from '@tauri-apps/api/http';
import { EventFifo, StreamWorkBudget } from '../../performance/eventQueue';
import type { Provider, ChatRequest, ChatOptions, SimpleCompletionRequest, CompletionResult } from './types';
import type { StreamDelta } from '../types';
import { GPT_MODELS, gptBaseUrl, buildGptRequest, ResponsesDecoder } from './gptResponses';

export class GptProvider implements Provider {
  readonly id = 'gpt';
  readonly displayName = 'GPT · DMXAPI';
  readonly models = GPT_MODELS;
  readonly baseUrl: string;
  readonly defaultModelId: string;
  constructor(private cfg: { apiKey: string; baseUrl?: string; modelId?: string }) {
    this.baseUrl = gptBaseUrl(cfg.baseUrl);
    this.defaultModelId = cfg.modelId || GPT_MODELS[0].id;
  }
  private headers() { return { Authorization: `Bearer ${this.cfg.apiKey}`, 'Content-Type': 'application/json' }; }
  async healthCheck(): Promise<boolean> {
    try {
      const result = await httpFetch<{ data?: { id: string }[] }>(`${this.baseUrl}/models`, {
        method: 'GET', headers: this.headers(), responseType: ResponseType.JSON, timeout: 15,
      });
      return result.ok && Boolean(result.data.data?.some(model => model.id === this.defaultModelId));
    } catch { return false; }
  }
  async chat(req: SimpleCompletionRequest, opts: ChatOptions): Promise<string> {
    return (await this.chatDetailed(req, opts)).text;
  }
  async chatDetailed(req: SimpleCompletionRequest, opts: ChatOptions): Promise<CompletionResult> {
    let text = '', finishReason: string | null = null;
    for await (const chunk of this.streamChat({ ...req, messages: req.messages.map(message => ({
      role: message.role === 'system' ? 'system' : message.role === 'assistant' ? 'assistant' : 'user', content: message.content,
    })) }, opts)) {
      text += chunk.choices[0]?.delta.content ?? '';
      finishReason = chunk.choices[0]?.finish_reason ?? finishReason;
    }
    return { text, finishReason };
  }
  async *streamChat(req: ChatRequest, opts: ChatOptions): AsyncGenerator<StreamDelta> {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const model = req.modelId || this.defaultModelId;
    const body = buildGptRequest(req, model, this.baseUrl);
    const requestId = `gpt-${crypto.randomUUID()}`;
    const queue = new EventFifo<{ type: 'chunk' | 'done' | 'error'; data?: string; status?: number }>();
    let wake: (() => void) | undefined;
    const push = (event: { type: 'chunk' | 'done' | 'error'; data?: string; status?: number }) => { queue.push(event); wake?.(); wake = undefined; };
    const stops: (() => void)[] = [];
    const abort = () => { void invoke('abort_stream_request', { requestId }).catch(() => {}); push({ type: 'done' }); };
    opts.signal?.addEventListener('abort', abort, { once: true });
    const decoder = new ResponsesDecoder(model, this.baseUrl);
    const budget = new StreamWorkBudget();
    try {
      stops.push(await appWindow.listen<{ chunk: string }>(`stream-chunk-${requestId}`, event => push({ type: 'chunk', data: event.payload.chunk })));
      stops.push(await appWindow.listen(`stream-done-${requestId}`, () => push({ type: 'done' })));
      stops.push(await appWindow.listen<{ status: number }>(`stream-error-${requestId}`, event => push({ type: 'error', status: event.payload.status })));
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      await invoke('stream_http_request', { requestId, url: `${this.baseUrl}/responses`, headers: this.headers(), body: JSON.stringify(body) });
      while (true) {
        const pause = budget.checkpoint(); if (pause) await pause;
        if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        if (!queue.length) await new Promise<void>(resolve => { wake = resolve; });
        if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const event = queue.shift()!;
        if (event.type === 'error') {
          const error = new Error(`GPT 中转请求失败（HTTP ${event.status ?? 0}），请检查模型权限、Key 和服务地址。`) as Error & { status: number };
          error.status = event.status ?? 0; throw error;
        }
        const chunks = event.type === 'done' ? decoder.end() : decoder.feed(event.data ?? '');
        for (const chunk of chunks) {
          if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          yield chunk;
        }
        if (decoder.completed || event.type === 'done') return;
      }
    } finally {
      void invoke('abort_stream_request', { requestId }).catch(() => {});
      stops.forEach(stop => stop()); queue.clear(); opts.signal?.removeEventListener('abort', abort);
    }
  }
}
