import test from 'node:test';
import assert from 'node:assert/strict';
import type { Tool } from './types.ts';
import type { ToolRegistry } from './toolRegistry.ts';
import {
  SubagentRunner,
  buildSubagentHandoff,
  isSubagentToolAllowed,
  type SubagentCoordinatorFactoryArgs,
} from './subagentRunner.ts';
import { isOrdinarySubagentRun, isSubagentEntryView } from './subagentPolicy.ts';
import { PaidToolIdempotencyGate } from './paidToolIdempotency.ts';

function deferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeTool(name: string): Tool {
  return {
    definition: { name, description: name, parameters: { type: 'object', properties: {} } },
    risk: 'safe',
    execute: async () => ({ success: true, output: name }),
  };
}

class FakeRegistry {
  readonly tools: Tool[];
  constructor(names: string[]) {
    this.tools = names.map(fakeTool);
  }
  project(predicate: (tool: Tool) => boolean): ToolRegistry {
    return new FakeRegistry(this.tools.filter(predicate).map((tool) => tool.definition.name)) as unknown as ToolRegistry;
  }
}

function callbacks(events: Array<Record<string, unknown>>) {
  return {
    onTextDelta: () => {},
    onThinkingDelta: () => {},
    onToolStart: () => {},
    onToolEnd: () => {},
    onComplete: () => {},
    onError: () => {},
    onSubAgentDelta: (_text: string, event?: Record<string, unknown>) => {
      if (event) events.push(event);
    },
  };
}

test('subagent projection removes recursive and view-scoped tools', async () => {
  const parent = new FakeRegistry([
    'agent_delegate',
    'read_file',
    'image_generate',
    'canvas_add_node',
    'workshop_get_state',
    'timeline_add_clip',
    'capability_api_config',
  ]);
  let projectedNames: string[] = [];
  const runner = new SubagentRunner({
    parentRunId: 'parent',
    parentRegistry: parent as unknown as ToolRegistry,
    callbacks: callbacks([]),
    createCoordinator: (args) => {
      projectedNames = (args.registry as unknown as FakeRegistry).tools.map((tool) => tool.definition.name);
      return {
        abort: () => {},
        run: async (_input, childCallbacks) => childCallbacks.onComplete('done'),
      };
    },
  });

  const result = await runner.run({ task: 'read and generate' });
  assert.equal(result.status, 'completed');
  assert.deepEqual(projectedNames, ['read_file', 'image_generate']);
  assert.equal(isSubagentToolAllowed('agent_delegate', ['read', 'generate']), false);
  assert.equal(isSubagentToolAllowed('canvas_add_node', ['project']), false);
});

test('delegate entry is limited to the primary ordinary-chat surface', () => {
  assert.equal(isSubagentEntryView('chat'), true);
  for (const view of ['canvas', 'workshop', 'editor', 'copywriting']) {
    assert.equal(isSubagentEntryView(view), false);
  }
  assert.equal(isOrdinarySubagentRun(true, false, 'chat'), true);
  assert.equal(isOrdinarySubagentRun(false, false, 'chat'), false);
  assert.equal(isOrdinarySubagentRun(true, true, 'chat'), false);
});

test('child namespace and parent paid-ledger namespace stay distinct', async () => {
  const events: Array<Record<string, unknown>> = [];
  const factoryArgs: SubagentCoordinatorFactoryArgs[] = [];
  const childRunIds: string[] = [];
  const runner = new SubagentRunner({
    parentRunId: 'run-root',
    parentRegistry: new FakeRegistry(['read_file']) as unknown as ToolRegistry,
    callbacks: callbacks(events),
    createCoordinator: (args) => {
      factoryArgs.push(args);
      return {
        abort: () => {},
        run: async (_input, childCallbacks, _media, runId) => {
          childRunIds.push(runId ?? '');
          childCallbacks.onComplete('verified');
        },
      };
    },
  });

  const first = await runner.run({ task: 'first' });
  const second = await runner.run({ task: 'second' });
  assert.deepEqual(childRunIds, ['run-root/sub-1', 'run-root/sub-2']);
  assert.deepEqual([first.runId, second.runId], childRunIds);
  assert.ok(factoryArgs.every((args) => args.idempotencyRunId === 'run-root'));
  assert.ok(factoryArgs.every((args) => args.subagentDepth === 1 && args.maxTurns === 20));
  assert.deepEqual(
    events.filter((event) => event.type === 'terminal').map((event) => event.runId),
    childRunIds,
  );
  assert.equal(runner.getActiveCount(), 0);
});

test('same parent allows at most three concurrent children and releases slots', async () => {
  const releases: Array<ReturnType<typeof deferred>> = [];
  const runner = new SubagentRunner({
    parentRunId: 'parent',
    parentRegistry: new FakeRegistry(['read_file']) as unknown as ToolRegistry,
    callbacks: callbacks([]),
    createCoordinator: () => {
      const release = deferred();
      releases.push(release);
      return { abort: () => release.resolve(), run: async () => release.promise };
    },
  });

  const running = [1, 2, 3].map((index) => runner.run({ task: `task-${index}` }));
  assert.equal(runner.getActiveCount(), 3);
  await assert.rejects(runner.run({ task: 'task-4' }), /最多并行 3 个子代理/);
  releases.forEach((release) => release.resolve());
  await Promise.all(running);
  assert.equal(runner.getActiveCount(), 0);
});

test('parent abort cascades and produces an explicit aborted terminal event', async () => {
  const events: Array<Record<string, unknown>> = [];
  const parent = new AbortController();
  let childWasAborted = false;
  const runner = new SubagentRunner({
    parentRunId: 'parent',
    parentRegistry: new FakeRegistry(['read_file']) as unknown as ToolRegistry,
    callbacks: callbacks(events),
    createCoordinator: ({ parentAbortController }) => {
      return {
        abort: () => {},
        run: async () => new Promise<void>((resolve) => {
          parentAbortController.signal.addEventListener('abort', () => {
            childWasAborted = parentAbortController.signal.aborted;
            resolve();
          }, { once: true });
        }),
      };
    },
  });

  const pending = runner.run({ task: 'wait' }, parent.signal);
  parent.abort(new DOMException('stop', 'AbortError'));
  const result = await pending;
  assert.equal(childWasAborted, true);
  assert.equal(result.status, 'aborted');
  assert.equal(events[events.length - 1]?.type, 'terminal');
  assert.equal(events[events.length - 1]?.status, 'aborted');
});

test('timeout aborts the child and always emits a timeout terminal event', async () => {
  const events: Array<Record<string, unknown>> = [];
  let aborted = false;
  const runner = new SubagentRunner({
    parentRunId: 'parent',
    parentRegistry: new FakeRegistry(['read_file']) as unknown as ToolRegistry,
    callbacks: callbacks(events),
    timeoutUnitMs: 5,
    createCoordinator: ({ parentAbortController }) => ({
      abort: () => { aborted = true; },
      run: async () => new Promise<void>((resolve) => {
        parentAbortController.signal.addEventListener('abort', () => resolve(), { once: true });
      }),
    }),
  });

  const result = await runner.run({ task: 'slow', timeoutSec: 1 });
  assert.equal(aborted, true);
  assert.equal(result.status, 'timeout');
  assert.match(result.error ?? '', /超过 1 秒/);
  assert.equal(events[events.length - 1]?.status, 'timeout');
  assert.equal(runner.getActiveCount(), 0);
});

test('timeout reaches a terminal state even if a provider ignores abort', async () => {
  const events: Array<Record<string, unknown>> = [];
  const runner = new SubagentRunner({
    parentRunId: 'parent',
    parentRegistry: new FakeRegistry(['read_file']) as unknown as ToolRegistry,
    callbacks: callbacks(events),
    timeoutUnitMs: 5,
    createCoordinator: () => ({
      abort: () => {},
      run: async () => new Promise<void>(() => {}),
    }),
  });

  const result = await runner.run({ task: 'stuck provider', timeoutSec: 1 });
  const terminalEvent = events[events.length - 1];
  assert.equal(result.status, 'timeout');
  assert.equal(terminalEvent?.type, 'terminal');
  assert.equal(terminalEvent?.status, 'timeout');
  assert.equal(runner.getActiveCount(), 0);
});

test('dispose aborts every child and leaves no active runner resources', async () => {
  const runner = new SubagentRunner({
    parentRunId: 'parent',
    parentRegistry: new FakeRegistry(['read_file']) as unknown as ToolRegistry,
    callbacks: callbacks([]),
    createCoordinator: ({ parentAbortController }) => ({
      abort: () => {},
      run: async () => new Promise<void>((resolve) => {
        parentAbortController.signal.addEventListener('abort', () => resolve(), { once: true });
      }),
    }),
  });

  const pending = runner.run({ task: 'background' });
  await runner.dispose();
  assert.equal((await pending).status, 'aborted');
  assert.equal(runner.getActiveCount(), 0);
  await assert.rejects(runner.run({ task: 'late' }), /父任务已经结束/);
});

test('dispose settles even when a provider ignores abort', async () => {
  const runner = new SubagentRunner({
    parentRunId: 'parent',
    parentRegistry: new FakeRegistry(['read_file']) as unknown as ToolRegistry,
    callbacks: callbacks([]),
    createCoordinator: () => ({
      abort: () => {},
      run: async () => new Promise<void>(() => {}),
    }),
  });

  const pending = runner.run({ task: 'stuck until dispose' });
  await Promise.resolve();
  await runner.dispose();

  assert.equal((await pending).status, 'aborted');
  assert.equal(runner.getActiveCount(), 0);
});

test('handoff carries only the explicit task and compact context contract', () => {
  const prompt = buildSubagentHandoff({ task: '审查分镜', context: '/tmp/shot.md' });
  assert.match(prompt, /审查分镜/);
  assert.match(prompt, /\/tmp\/shot\.md/);
  assert.match(prompt, /不要再次委派/);
});

test('ordinary-chat integration smoke runs two storyboard image delegates in parallel', async () => {
  const events: Array<Record<string, unknown>> = [];
  const paidGate = new PaidToolIdempotencyGate();
  let concurrent = 0;
  let peakConcurrent = 0;
  const runner = new SubagentRunner({
    parentRunId: 'smoke-30s-film',
    parentRegistry: new FakeRegistry(['image_generate']) as unknown as ToolRegistry,
    callbacks: callbacks(events),
    createCoordinator: () => ({
      abort: () => {},
      run: async (input, childCallbacks, _media, runId) => {
        concurrent += 1;
        peakConcurrent = Math.max(peakConcurrent, concurrent);
        const shot = input.includes('分镜 A') ? 'A' : 'B';
        const params = { prompt: `30 秒短片分镜 ${shot}`, aspect_ratio: '16:9' };
        assert.equal(paidGate.reserve('smoke-30s-film', 'image_generate', params), null);
        childCallbacks.onToolStart('image_generate', params);
        await new Promise((resolve) => setTimeout(resolve, 5));
        const output = `/tmp/kunpeng-subagent-smoke/storyboard-${shot}.png`;
        const toolResult = { success: true, output };
        paidGate.record('smoke-30s-film', 'image_generate', params, toolResult);
        childCallbacks.onToolEnd('image_generate', toolResult);
        childCallbacks.onComplete(`分镜 ${shot} 已完成：${output}`);
        concurrent -= 1;
        assert.match(runId ?? '', /^smoke-30s-film\/sub-[12]$/);
      },
    }),
  });

  const [a, b] = await Promise.all([
    runner.run({ task: '并行生成分镜 A', context: '30 秒剧本已完成，生成第一张分镜图。' }),
    runner.run({ task: '并行生成分镜 B', context: '30 秒剧本已完成，生成第二张分镜图。' }),
  ]);

  assert.equal(peakConcurrent, 2);
  assert.deepEqual([a.status, b.status], ['completed', 'completed']);
  assert.deepEqual([...a.artifacts, ...b.artifacts].sort(), [
    '/tmp/kunpeng-subagent-smoke/storyboard-A.png',
    '/tmp/kunpeng-subagent-smoke/storyboard-B.png',
  ]);
  assert.equal(events.filter((event) => event.type === 'start').length, 2);
  assert.equal(events.filter((event) => event.type === 'terminal').length, 2);
  assert.match(
    paidGate.reserve('smoke-30s-film', 'image_generate', { prompt: '30 秒短片分镜 A', aspect_ratio: '16:9' }) ?? '',
    /阻止重复执行/,
  );
  assert.equal(runner.getActiveCount(), 0);
});
