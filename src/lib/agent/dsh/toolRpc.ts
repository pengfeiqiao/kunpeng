import type { CoordinatorCallbacks, ToolResult } from '../types';
import type { ToolRegistry } from '../toolRegistry';
import type { DshToolCallEvent } from './types';

export interface DshToolHooks {
  before?: (name: string, params: Record<string, unknown>) => Promise<{ cancel?: boolean; reason?: string }>;
  after?: (name: string, params: Record<string, unknown>, result: ToolResult, durationMs: number) => Promise<void>;
}

export function serializeDshTools(registry: ToolRegistry): Array<Record<string, unknown>> {
  return registry.getDefinitions().map((definition) => ({
    name: definition.name,
    description: definition.description,
    inputSchema: definition.parameters,
  }));
}

/** Execute one MCP-originated call through Kunpeng's registry and confirmation surface. */
export async function executeDshToolCall(
  call: DshToolCallEvent,
  registry: ToolRegistry,
  callbacks: CoordinatorCallbacks,
  signal: AbortSignal,
  hooks: DshToolHooks = {},
): Promise<ToolResult> {
  const params = call.arguments ?? {};
  const tool = registry.get(call.name);
  if (!tool) return { success: false, output: '', error: `Unknown tool: ${call.name}` };

  const riskCheck = tool.checkRisk?.(params);
  const risk = riskCheck?.risk ?? tool.risk ?? 'safe';
  if (risk === 'deny') {
    return { success: false, output: '', error: riskCheck?.reason || `工具 ${call.name} 被禁止执行` };
  }
  if (risk === 'ask' && callbacks.onToolConfirm) {
    const allowed = await callbacks.onToolConfirm(call.name, params, riskCheck?.reason);
    if (!allowed) {
      return { success: false, output: '', error: '用户拒绝执行此操作。请询问用户是否有其他方案。' };
    }
  }

  const pre = await hooks.before?.(call.name, params);
  callbacks.onToolBatchStart?.([{ name: call.name, params }]);
  callbacks.onToolStart(call.name, params);
  const startedAt = Date.now();
  const result = pre?.cancel
    ? { success: false, output: '', error: pre.reason || 'cancelled by hook' }
    : await registry.execute(call.name, params, signal);
  callbacks.onToolEnd(call.name, result);
  callbacks.onToolBatchEnd?.([{ name: call.name, success: result.success }]);
  await hooks.after?.(call.name, params, result, Date.now() - startedAt);
  return result;
}
