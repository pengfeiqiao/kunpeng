import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import { firePostToolUse, firePreToolUse } from '../hooks.ts';
import type { AgentUserContentBlock, CoordinatorCallbacks, ToolResult } from '../types';
import type { ToolRegistry } from '../toolRegistry';
import type { DshToolCallEvent, DshToolCancelEvent } from './types';
import { executeDshToolCall, serializeDshTools } from './toolRpc.ts';

function mediaContent(blocks: AgentUserContentBlock[] | undefined): Array<Record<string, unknown>> {
  if (!blocks?.length) return [];
  const content: Array<Record<string, unknown>> = [];
  for (const block of blocks) {
    if (block.type === 'text') content.push({ type: 'text', text: block.text });
    else if (block.type === 'image' && block.source.type === 'base64') {
      content.push({ type: 'image', data: block.source.data, mimeType: block.source.media_type });
    } else if (block.source.type === 'url') {
      content.push({ type: 'text', text: `[${block.type}结果] ${block.source.url}` });
    }
  }
  return content;
}

export class DshToolBridge {
  private unlisten: UnlistenFn[] = [];
  private readonly abortController = new AbortController();
  private readonly inFlight = new Map<string, AbortController>();
  private readonly runId: string;
  private readonly instanceId: string;
  private readonly registry: ToolRegistry;
  private readonly callbacks: CoordinatorCallbacks;
  /**
   * Invoked the moment a tool call reaches the executor. A dispatched tool
   * may already have produced a paid or irreversible side effect, so the
   * owning DshBridge uses this to mark visible output even if the ACP
   * tool_call stream event never arrives (e.g. the dsh process crashes
   * mid-dispatch) — that is what blocks a double-billing replay.
   */
  private readonly onToolDispatched?: () => void;

  // NOTE: no constructor parameter properties (`private x` in the signature)
  // — this file is imported by node --test strip-only type stripping, which
  // rejects that syntax.
  constructor(
    runId: string,
    instanceId: string,
    registry: ToolRegistry,
    callbacks: CoordinatorCallbacks,
    onToolDispatched?: () => void,
  ) {
    this.runId = runId;
    this.instanceId = instanceId;
    this.registry = registry;
    this.callbacks = callbacks;
    this.onToolDispatched = onToolDispatched;
  }

  async start(): Promise<void> {
    const tools = serializeDshTools(this.registry);
    await invoke('dsh_set_tools', { runId: this.runId, instanceId: this.instanceId, tools });
    this.unlisten.push(await listen<DshToolCallEvent>('dsh-tool-call', ({ payload }) => {
      if (payload.runId !== this.runId || payload.instanceId !== this.instanceId) return;
      void this.execute(payload);
    }));
    this.unlisten.push(await listen<DshToolCancelEvent>('dsh-tool-cancel', ({ payload }) => {
      if (payload.runId !== this.runId || payload.instanceId !== this.instanceId) return;
      this.inFlight.get(payload.requestId)?.abort();
    }));
  }

  abort(): void {
    this.abortController.abort();
    for (const controller of this.inFlight.values()) controller.abort();
    this.inFlight.clear();
  }

  dispose(): void {
    this.abort();
    for (const stop of this.unlisten.splice(0)) stop();
  }

  private async execute(call: DshToolCallEvent): Promise<void> {
    this.onToolDispatched?.();
    const callController = new AbortController();
    const abortCall = () => callController.abort();
    if (this.abortController.signal.aborted) callController.abort();
    else this.abortController.signal.addEventListener('abort', abortCall, { once: true });
    this.inFlight.set(call.requestId, callController);
    let result: ToolResult;
    try {
      result = await executeDshToolCall(
        call,
        this.registry,
        this.callbacks,
        callController.signal,
        {
          before: async (name, params) => firePreToolUse({ toolName: name, params }),
          after: async (name, params, toolResult, durationMs) => {
            await firePostToolUse({ toolName: name, params, result: toolResult, durationMs });
          },
        },
      );
    } catch (error) {
      result = { success: false, output: '', error: error instanceof Error ? error.message : String(error) };
    } finally {
      this.abortController.signal.removeEventListener('abort', abortCall);
      this.inFlight.delete(call.requestId);
    }
    if (this.abortController.signal.aborted || callController.signal.aborted) return;
    const text = result.output || result.error || '(no output)';
    await invoke('dsh_tool_respond', {
      response: {
        requestId: call.requestId,
        runId: this.runId,
        instanceId: this.instanceId,
        ok: true,
        result: {
          content: [{ type: 'text', text }, ...mediaContent(result.media)],
          isError: !result.success,
        },
      },
    }).catch((error) => {
      if (this.abortController.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      this.callbacks.onProgressText?.('', `工具结果未能送回 Harness：${message}`);
      // "已结束/已失效" means the Rust side already resolved this tool call
      // (timeout or cancel) and moved on — the run can continue. Any other
      // failure means the result never landed and the Harness would wait up
      // to 30 minutes for it; stop this instance so the run fails fast
      // instead of hanging. The tool already ran, so the run error path will
      // NOT replay it (visible output is marked on dispatch).
      if (!message.includes('已结束') && !message.includes('已失效')) {
        void invoke('dsh_stop', { runId: this.runId, instanceId: this.instanceId }).catch(() => {});
      }
    });
  }

}
