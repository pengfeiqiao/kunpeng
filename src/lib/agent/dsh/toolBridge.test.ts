import test from 'node:test';
import assert from 'node:assert/strict';
import type { CoordinatorCallbacks, Tool, ToolResult } from '../types.ts';
import type { ToolRegistry } from '../toolRegistry.ts';
import type { DshToolCallEvent } from './types.ts';
import { DshToolBridge } from './toolBridge.ts';

function callbacks(confirm = true): CoordinatorCallbacks & { progress: string[] } {
  const progress: string[] = [];
  return {
    progress,
    onTextDelta: () => {},
    onThinkingDelta: () => {},
    onProgressText: (_text, displayText) => { progress.push(displayText || _text); },
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
    get: (name: string) => (name === tool.definition.name ? tool : undefined),
    execute: (name: string, params: Record<string, unknown>, signal?: AbortSignal) => {
      if (name !== tool.definition.name) {
        return Promise.resolve({ success: false, output: '', error: 'missing' });
      }
      return tool.execute(params, signal);
    },
  } as unknown as ToolRegistry;
}

function callEvent(name: string, requestId = 'request-1'): DshToolCallEvent {
  return { runId: 'run', instanceId: 'instance', requestId, name, arguments: {} };
}

async function execute(bridge: DshToolBridge, call: DshToolCallEvent): Promise<void> {
  // execute() is private; reach it directly so the test needs no Tauri event bus.
  await (bridge as unknown as { execute(call: DshToolCallEvent): Promise<void> }).execute(call);
}

test('tool dispatch marks visible side effect BEFORE the tool body runs', async () => {
  let dispatched = false;
  let dispatchWasMarkedWhenToolRan = false;
  const tool: Tool = {
    definition: { name: 'image_gen', description: 'paid image', parameters: { type: 'object', properties: {} } },
    risk: 'safe',
    execute: async (): Promise<ToolResult> => {
      dispatchWasMarkedWhenToolRan = dispatched;
      return { success: true, output: 'ok' };
    },
  };
  const bridge = new DshToolBridge('run', 'instance', registryFor(tool), callbacks(), () => {
    dispatched = true;
  });
  await execute(bridge, callEvent('image_gen'));
  assert.equal(dispatched, true);
  assert.equal(
    dispatchWasMarkedWhenToolRan,
    true,
    'visible output must be marked before execution so a mid-dispatch dsh crash cannot replay the paid tool',
  );
});

test('respond failure is surfaced to the user instead of silently swallowed', async () => {
  const cbs = callbacks();
  const tool: Tool = {
    definition: { name: 'probe', description: 'probe', parameters: { type: 'object', properties: {} } },
    risk: 'safe',
    execute: async (): Promise<ToolResult> => ({ success: true, output: 'ok' }),
  };
  const bridge = new DshToolBridge('run', 'instance', registryFor(tool), cbs);
  // In this test environment invoke() rejects ('window is not defined'),
  // which exercises exactly the respond-failure path.
  await execute(bridge, callEvent('probe'));
  assert.ok(
    cbs.progress.some((text) => text.includes('工具结果未能送回 Harness')),
    `expected a user-visible warning, got: ${JSON.stringify(cbs.progress)}`,
  );
});

test('bridge abort cancels the in-flight tool and skips the respond', async () => {
  let toolSawAbort = false;
  const cbs = callbacks();
  const tool: Tool = {
    definition: { name: 'long_paid_task', description: 'long', parameters: { type: 'object', properties: {} } },
    risk: 'safe',
    execute: async (_params, signal): Promise<ToolResult> => new Promise((resolve) => {
      signal?.addEventListener('abort', () => {
        toolSawAbort = true;
        resolve({ success: false, output: '', error: 'aborted' });
      }, { once: true });
    }),
  };
  const bridge = new DshToolBridge('run', 'instance', registryFor(tool), cbs);
  const pending = execute(bridge, callEvent('long_paid_task'));
  await new Promise((resolve) => setTimeout(resolve, 10));
  bridge.abort();
  await pending;
  assert.equal(toolSawAbort, true);
  assert.equal(
    cbs.progress.some((text) => text.includes('工具结果未能送回 Harness')),
    false,
    'an aborted bridge must not report a respond failure',
  );
});

test('tool results never leak across runs: execute uses only its own runId/instanceId', async () => {
  // Regression guard for instance isolation: the bridge constructed for
  // run A/instance A must execute events carrying those ids and nothing
  // else. The event listener filters by runId+instanceId; here we assert
  // the bridge stores them verbatim for that filter and for dsh_tool_respond.
  const bridge = new DshToolBridge('run-A', 'inst-A', registryFor({
    definition: { name: 'noop', description: 'noop', parameters: { type: 'object', properties: {} } },
    risk: 'safe',
    execute: async (): Promise<ToolResult> => ({ success: true, output: 'ok' }),
  }), callbacks());
  const internals = bridge as unknown as { runId: string; instanceId: string };
  assert.equal(internals.runId, 'run-A');
  assert.equal(internals.instanceId, 'inst-A');
});
