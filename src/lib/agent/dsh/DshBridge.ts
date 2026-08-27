import type { AgentUserContentBlock } from '../types';
import { sanitizeProgressText } from '../toolSummary';
import { DshAcpClient, type AcpUpdate } from './acpClient';
import { DshToolBridge } from './toolBridge';
import { parseDshStreamUpdate } from './streamUpdate';
import type { DshRunOptions, DshRunResult } from './types';

export class DshBridge {
  private running = false;
  private queuedGuidance: Array<{ text: string; media: AgentUserContentBlock[] }> = [];
  private acp: DshAcpClient | null = null;
  private tools: DshToolBridge | null = null;
  private visibleOutput = false;
  private aborted = false;
  private callbacksRef: DshRunOptions['callbacks'] | null = null;

  getIsRunning(): boolean {
    return this.running;
  }

  hasVisibleOutput(): boolean {
    return this.visibleOutput;
  }

  queueGuidance(text: string, media: AgentUserContentBlock[] = []): boolean {
    // 只以 aborted 为界：bridge 注册后、run() 尚未把 running 置真之前有一个
    // 窗口期，此时若用 running 判断会静默丢消息并可能误起并行 Harness 进程
    // （并行 ACP 抢同一工具桥 socket，表现为 MCP "Connection closed"）。
    if (this.aborted || (!text.trim() && media.length === 0)) return false;
    this.queuedGuidance.push({ text: text.trim(), media });
    // 即时确认：补充要等当前轮安全结束才发出，没有这条提示时用户看到的
    // 是"发出去毫无反应"（与 coordinator.queueGuidance 的反馈对齐）。
    const cleaned = text.trim();
    const preview = cleaned.replace(/\s+/g, ' ').slice(0, 72);
    this.callbacksRef?.onProgressText?.(
      '',
      `收到你的补充${preview ? `：“${preview}${cleaned.length > 72 ? '…' : ''}”` : ''}。我会先让当前操作安全结束，再把它并入下一步判断；现有进度不会重启。`,
    );
    return true;
  }

  async run(options: DshRunOptions): Promise<DshRunResult> {
    if (this.running) throw new Error('DeepSeek Harness is already running');
    this.running = true;
    this.aborted = false;
    this.visibleOutput = false;
    this.callbacksRef = options.callbacks;
    let text = '';
    let thinking = '';
    let currentMessage = '';
    let usage = { used: 0, size: options.contextWindow ?? 1_000_000 };
    let stopReason: string | undefined;
    const instanceId = typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const onUpdate = ({ update }: AcpUpdate) => {
      if (!this.running || this.aborted) return;
      const parsed = parseDshStreamUpdate(update);
      if (parsed.type === 'text') {
        const delta = parsed.text;
        if (!delta) return;
        this.visibleOutput = true;
        text += delta;
        currentMessage += delta;
        options.callbacks.onTextDelta(delta);
      } else if (parsed.type === 'thinking') {
        const delta = parsed.text;
        if (!delta) return;
        this.visibleOutput = true;
        thinking += delta;
        options.callbacks.onThinkingDelta(delta);
      } else if (parsed.type === 'tool_call') {
        // A tool call may already have created a paid or irreversible side
        // effect. Treat it as observable progress even when no prose has been
        // streamed yet, so an ACP failure cannot replay the whole turn through
        // built-in DeepSeek and charge the user twice.
        this.visibleOutput = true;
        const progress = sanitizeProgressText(currentMessage);
        if (progress) options.callbacks.onProgressText?.(currentMessage, progress);
        currentMessage = '';
      } else if (parsed.type === 'usage') {
        usage = { used: parsed.used, size: parsed.size };
        options.callbacks.onContextUsage?.({ estimatedTokens: parsed.used, maxTokens: parsed.size });
      } else if (parsed.type === 'compaction') {
        if (parsed.phase === 'start') {
          options.callbacks.onProgressText?.('', '上下文接近容量，我正在整理较早的任务记录，完成后会继续当前步骤。');
        } else if (parsed.phase === 'end') {
          options.callbacks.onProgressText?.(
            '',
            parsed.failed
              ? '较早记录暂时未能整理，但当前任务会继续执行。'
              : '较早记录已整理完成，我会继续处理当前任务。',
          );
        }
      }
    };
    this.tools = new DshToolBridge(
      options.runId,
      instanceId,
      options.toolRegistry,
      options.callbacks,
      // A tool reaching the executor may already have created a paid side
      // effect. Mark visible output here too — the ACP tool_call stream event
      // can be lost if the dsh process dies mid-dispatch, and without this a
      // fallback replay would run the paid tool a second time.
      () => {
        this.visibleOutput = true;
      },
    );
    this.acp = new DshAcpClient(options, instanceId, onUpdate);
    const abort = () => void this.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      try {
        await this.tools.start();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`DeepSeek Harness 工具桥初始化失败: ${message}`);
      }
      try {
        await this.acp.start();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`DeepSeek Harness ACP 启动失败: ${message}`);
      }
      let response = await this.acp.prompt(options.input, options.mediaBlocks);
      stopReason = response.stopReason;
      while (this.queuedGuidance.length > 0 && !options.signal?.aborted) {
        const guidance = this.queuedGuidance.shift()!;
        currentMessage = '';
        options.callbacks.onProgressText?.('', '收到你的补充，我会沿用当前进度继续处理。');
        response = await this.acp.prompt(guidance.text, guidance.media);
        stopReason = response.stopReason;
      }
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const finalText = currentMessage.trim() ? currentMessage : text;
      if (!finalText.trim()) throw new Error('DeepSeek Harness 已结束任务，但没有返回可展示的回复');
      options.callbacks.onContextUsage?.({ estimatedTokens: usage.used, maxTokens: usage.size });
      return { text: finalText, thinking, visibleOutput: this.visibleOutput, stopReason };
    } finally {
      options.signal?.removeEventListener('abort', abort);
      await this.dispose();
    }
  }

  async abort(): Promise<void> {
    // Make cancellation visible synchronously.  The UI can accept a new
    // request immediately after Stop is clicked, so leaving `running` true
    // while an ACP notification is in flight can accidentally append that
    // request to the run being cancelled.
    this.running = false;
    this.aborted = true;
    this.callbacksRef = null;
    this.queuedGuidance = [];
    const tools = this.tools;
    const acp = this.acp;
    this.tools = null;
    this.acp = null;
    tools?.dispose();

    // Killing the owned ACP process is the authoritative cancellation path.
    // A best-effort session/cancel notification is not sufficient when the
    // model is blocked inside a long-running tool call.
    await acp?.dispose();
  }

  private async dispose(): Promise<void> {
    this.queuedGuidance = [];
    this.tools?.dispose();
    this.tools = null;
    const acp = this.acp;
    this.acp = null;
    await acp?.dispose();
    this.running = false;
    this.callbacksRef = null;
  }
}
