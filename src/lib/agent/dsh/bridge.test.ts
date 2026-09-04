import test from 'node:test';
import assert from 'node:assert/strict';
import type { CoordinatorCallbacks, Tool, ToolResult } from '../types.ts';
import type { ToolRegistry } from '../toolRegistry.ts';
import { sanitizeOpenAIToolPairing } from '../providers/pairing.ts';
import { parseDshStreamUpdate } from './streamUpdate.ts';
import { executeDshToolCall, isAgentDelegateDshAvailable, serializeDshTools } from './toolRpc.ts';

function callbacks(confirm = true): CoordinatorCallbacks {
  return {
    onTextDelta: () => {},
    onThinkingDelta: () => {},
    onToolStart: () => {},
    onToolEnd: () => {},
    onComplete: () => {},
    onError: () => {},
    onToolConfirm: async () => confirm,
  };
}

function registryFor(tool: Tool): ToolRegistry {
  return {
    getDefinitions: () => [tool.definition],
    get: (name: string) => name === tool.definition.name ? tool : undefined,
    execute: (name: string, params: Record<string, unknown>, signal?: AbortSignal) => {
      if (name !== tool.definition.name) return Promise.resolve({ success: false, output: '', error: 'missing' });
      return tool.execute(params, signal);
    },
  } as unknown as ToolRegistry;
}

function fakeDelegateTool(): Tool {
  return {
    definition: {
      name: 'agent_delegate',
      description: 'delegate',
      parameters: { type: 'object', properties: { task: { type: 'string' } }, required: ['task'] },
    },
    risk: 'ask',
    execute: async () => ({ success: true, output: 'done' }),
  };
}

test('mock ACP stream maps reasoning, text, tools and native usage', () => {
  assert.deepEqual(parseDshStreamUpdate({
    sessionUpdate: 'agent_thought_chunk',
    content: { type: 'text', text: '分析中' },
  }), { type: 'thinking', text: '分析中' });
  assert.deepEqual(parseDshStreamUpdate({
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: '完成' },
  }), { type: 'text', text: '完成' });
  assert.deepEqual(parseDshStreamUpdate({ sessionUpdate: 'tool_call' }), { type: 'tool_call' });
  assert.deepEqual(parseDshStreamUpdate({ sessionUpdate: 'usage_update', used: 321, size: 1_000_000 }), {
    type: 'usage', used: 321, size: 1_000_000,
  });
  assert.deepEqual(parseDshStreamUpdate({
    sessionUpdate: 'kunpeng_compaction', phase: 'end', failed: false,
  }), { type: 'compaction', phase: 'end', failed: false });
});

test('MCP RPC serializes and executes the active Kunpeng tool with confirmation', async () => {
  let executed = 0;
  const tool: Tool = {
    definition: {
      name: 'canvas_probe',
      description: 'probe canvas',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
    risk: 'ask',
    execute: async (params): Promise<ToolResult> => {
      executed += 1;
      return { success: true, output: `node:${String(params.id)}` };
    },
  };
  const registry = registryFor(tool);
  assert.deepEqual(serializeDshTools(registry), [{
    name: 'canvas_probe',
    description: 'probe canvas',
    inputSchema: tool.definition.parameters,
  }]);
  const result = await executeDshToolCall(
    { runId: 'run', instanceId: 'instance', requestId: 'request', name: 'canvas_probe', arguments: { id: '42' } },
    registry,
    callbacks(true),
    new AbortController().signal,
  );
  assert.equal(result.output, 'node:42');
  assert.equal(executed, 1);
});

test('DSH exposes agent_delegate only after the frontend binds that run', () => {
  const delegate = fakeDelegateTool();
  const availableRuns = new Set<string>();
  const registry = {
    getDefinitions: () => [delegate.definition],
    hasDelegateForRun: (runId: string) => availableRuns.has(runId),
  } as unknown as ToolRegistry;
  assert.equal(isAgentDelegateDshAvailable(registry, 'run-a'), false);
  assert.deepEqual(serializeDshTools(registry, 'run-a'), []);
  availableRuns.add('run-a');
  assert.equal(isAgentDelegateDshAvailable(registry, 'run-a'), true);
  assert.equal(serializeDshTools(registry, 'run-a')[0]?.name, 'agent_delegate');
});

test('MCP RPC does not execute an ask-risk tool after rejection', async () => {
  let executed = false;
  const tool: Tool = {
    definition: { name: 'danger', description: 'danger', parameters: { type: 'object', properties: {} } },
    risk: 'ask',
    execute: async () => {
      executed = true;
      return { success: true, output: 'bad' };
    },
  };
  const result = await executeDshToolCall(
    { runId: 'run', instanceId: 'instance', requestId: 'request', name: 'danger', arguments: {} },
    registryFor(tool),
    callbacks(false),
    new AbortController().signal,
  );
  assert.equal(result.success, false);
  assert.equal(executed, false);
});

test('MCP RPC forwards bridge cancellation to the running Kunpeng tool', async () => {
  let sawAbort = false;
  const tool: Tool = {
    definition: { name: 'long_task', description: 'long task', parameters: { type: 'object', properties: {} } },
    risk: 'safe',
    execute: async (_params, signal): Promise<ToolResult> => new Promise((resolve) => {
      if (signal?.aborted) {
        sawAbort = true;
        resolve({ success: false, output: '', error: 'aborted' });
        return;
      }
      signal?.addEventListener('abort', () => {
        sawAbort = true;
        resolve({ success: false, output: '', error: 'aborted' });
      }, { once: true });
    }),
  };
  const controller = new AbortController();
  const pending = executeDshToolCall(
    { runId: 'run', instanceId: 'instance', requestId: 'request', name: 'long_task', arguments: {} },
    registryFor(tool),
    callbacks(true),
    controller.signal,
  );
  controller.abort();
  const result = await pending;
  assert.equal(sawAbort, true);
  assert.equal(result.success, false);
});

test('abort persistence repair removes an incomplete tool pair before legacy fallback', () => {
  const repaired = sanitizeOpenAIToolPairing([
    { role: 'user', content: '继续任务' },
    {
      role: 'assistant',
      content: '正在调用工具',
      tool_calls: [{ id: 'dsh-call', type: 'function', function: { name: 'canvas_probe', arguments: '{}' } }],
    },
  ]) as Array<Record<string, unknown>>;
  assert.equal(repaired.length, 2);
  assert.equal(repaired[1].tool_calls, undefined);
});
