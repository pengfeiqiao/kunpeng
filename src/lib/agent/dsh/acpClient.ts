import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import type { AgentUserContentBlock } from '../types';
import { agentLog } from '../logger';
import { buildAcpPromptContent } from './mediaFilter.ts';
import type { DshAcpLineEvent, DshHarnessEvent, DshStartOptions } from './types';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: number;
}

export interface AcpUpdate {
  sessionId: string;
  update: Record<string, unknown>;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

let warnedDroppedMedia = false;

export class DshAcpClient {
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private unlisten: UnlistenFn[] = [];
  private started = false;
  private startPromise: Promise<void> | null = null;
  private closed = false;
  private sessionId: string | null = null;
  private stderr = '';
  private channelError: Error | null = null;

  constructor(
    private readonly options: DshStartOptions,
    private readonly instanceId: string,
    private readonly onUpdate: (update: AcpUpdate) => void,
  ) {}

  start(): Promise<void> {
    if (this.closed) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    // All concurrent callers must await the same complete handshake.
    return this.startPromise ??= this.startSession().catch(async (error) => {
      await this.dispose();
      throw error;
    });
  }

  private async registerListener<T>(name: string, handler: Parameters<typeof listen<T>>[1]): Promise<void> {
    if (this.closed) throw new DOMException('Aborted', 'AbortError');
    const stop = await listen<T>(name, handler);
    // dispose() may have run while Tauri was registering this listener.
    if (this.closed) {
      stop();
      throw new DOMException('Aborted', 'AbortError');
    }
    this.unlisten.push(stop);
  }

  private async startSession(): Promise<void> {
    await this.registerListener<DshAcpLineEvent>('dsh-acp-line', ({ payload }) => {
      if (payload.runId !== this.options.runId || payload.instanceId !== this.instanceId) return;
      this.handleLine(payload.line);
    });
    await this.registerListener<DshHarnessEvent>('dsh-harness-event', ({ payload }) => {
      if (payload.runId !== this.options.runId || payload.instanceId !== this.instanceId || !payload.event || this.closed) return;
      this.onUpdate({ sessionId: this.sessionId || '', update: payload.event });
    });
    await this.registerListener<DshAcpLineEvent>('dsh-acp-stderr', ({ payload }) => {
      if (payload.runId !== this.options.runId || payload.instanceId !== this.instanceId) return;
      this.stderr = `${this.stderr}\n${payload.line}`.trim().slice(-5000);
    });
    await this.registerListener<DshAcpLineEvent>('dsh-acp-closed', ({ payload }) => {
      if (payload.runId !== this.options.runId || payload.instanceId !== this.instanceId || this.closed) return;
      this.channelError = new Error(this.stderr || payload.line || 'DeepSeek Harness 已关闭');
      this.rejectAll(this.channelError);
    });
    await invoke('dsh_start', { request: { ...this.options, instanceId: this.instanceId } });
    if (this.closed) {
      // An earlier stop can arrive before Rust has inserted the new child.
      // Stop again after spawn completes so an aborted startup cannot leak it.
      await invoke('dsh_stop', { runId: this.options.runId, instanceId: this.instanceId }).catch(() => {});
      throw new DOMException('Aborted', 'AbortError');
    }
    await this.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: 'kunpeng', version: '1.0.0' },
    });
    const session = await this.request('session/new', {
      cwd: this.options.workspace,
      mcpServers: [],
    }) as { sessionId?: string };
    if (!session?.sessionId) throw new Error('DeepSeek Harness 未返回 ACP sessionId');
    this.sessionId = session.sessionId;
    this.started = true;
  }

  async prompt(text: string, mediaBlocks: AgentUserContentBlock[] = []): Promise<{ stopReason?: string }> {
    if (!this.sessionId) throw new Error('DeepSeek Harness 会话尚未建立');
    // Native images pass through ACP; unsupported media uses analysis tools.
    const prompt = buildAcpPromptContent(mediaBlocks, () => {
      if (warnedDroppedMedia) return;
      warnedDroppedMedia = true;
      agentLog.warn('DSH', 'Dropped unsupported media block: ACP accepts native images; use analysis tools for video');
    });
    prompt.push({ type: 'text', text });
    return this.request('session/prompt', { sessionId: this.sessionId, prompt }) as Promise<{ stopReason?: string }>;
  }

  async cancel(): Promise<void> {
    if (this.sessionId && this.started && !this.closed) {
      await this.notify('session/cancel', { sessionId: this.sessionId }).catch(() => {});
    }
  }

  async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.rejectAll(new DOMException('Aborted', 'AbortError'));
    for (const stop of this.unlisten.splice(0)) stop();
    await invoke('dsh_stop', { runId: this.options.runId, instanceId: this.instanceId }).catch(() => {});
  }

  private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.closed) throw new Error('DeepSeek Harness ACP 客户端已关闭');
    // The ACP child can close between two JSON-RPC calls. Without a sticky
    // channel state, a close event that arrives before the next request has no
    // pending promise to reject, and that next request waits until the generic
    // 30-minute timeout. Fail synchronously with the already-redacted stderr.
    if (this.channelError) throw this.channelError;
    const id = this.nextId++;
    // Startup handshake must fail fast (a hung composition would otherwise
    // burn the whole 30-minute budget before the user sees anything), while a
    // prompt legitimately outlives it: one turn can chain several long paid
    // tool calls, each allowed up to toolCallTimeoutMs (30 min) upstream.
    const timeoutMs = method === 'session/prompt' ? 60 * 60 * 1000 : 90 * 1000;
    const promise = new Promise<unknown>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`DeepSeek Harness ACP 请求超时: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
    });
    try {
      await this.send({ jsonrpc: '2.0', id, method, params });
    } catch (error) {
      const pending = this.pending.get(id);
      if (pending) {
        this.pending.delete(id);
        window.clearTimeout(pending.timeout);
        pending.reject(asError(error));
      }
    }
    return promise;
  }

  private notify(method: string, params: Record<string, unknown>): Promise<void> {
    return this.send({ jsonrpc: '2.0', method, params });
  }

  private send(message: Record<string, unknown>): Promise<void> {
    if (this.channelError) return Promise.reject(this.channelError);
    return invoke('dsh_send', {
      runId: this.options.runId,
      instanceId: this.instanceId,
      message: JSON.stringify(message),
    });
  }

  private handleLine(line: string): void {
    if (this.closed) return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    // JSON-RPC allows string ids. The current @agentclientprotocol/sdk uses
    // numbers, but a server-side change to string ids must not wedge us: an
    // unanswered session/request_permission hangs the whole tool call.
    const id = (typeof message.id === 'number' || typeof message.id === 'string') ? message.id : null;
    if (id !== null && !message.method) {
      const pending = typeof id === 'number' ? this.pending.get(id) : undefined;
      if (!pending) return;
      this.pending.delete(id as number);
      window.clearTimeout(pending.timeout);
      if (message.error) {
        const error = message.error as { message?: string };
        pending.reject(new Error(error.message || 'DeepSeek Harness ACP 请求失败'));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (message.method === 'session/update') {
      const params = message.params as AcpUpdate | undefined;
      if (params?.update) this.onUpdate(params);
      return;
    }
    if (id !== null && message.method === 'session/request_permission') {
      const params = message.params as { options?: Array<{ kind?: string; optionId?: string }> };
      const selected = params.options?.find((option) => option.kind === 'allow_once') ?? params.options?.[0];
      void this.send({
        jsonrpc: '2.0',
        id,
        result: selected?.optionId
          ? { outcome: { outcome: 'selected', optionId: selected.optionId } }
          : { outcome: { outcome: 'cancelled' } },
      });
    }
  }

  private rejectAll(error: unknown): void {
    const normalized = asError(error);
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timeout);
      pending.reject(normalized);
    }
    this.pending.clear();
  }
}
