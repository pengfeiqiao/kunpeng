import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfirmationQueue } from './confirmationQueue.ts';
import { confirmToolItems } from './confirmBatch.ts';
import { executeDshToolCall } from './dsh/toolRpc.ts';
import type { CoordinatorCallbacks, Tool } from './types.ts';
import type { ToolRegistry } from './toolRegistry.ts';

test('three concurrent confirmations are displayed FIFO; rejecting second never executes it', async () => {
  const queue = new ConfirmationQueue<number>();
  const executed: number[] = [];
  const requests = [1, 2, 3].map(async (n) => { if (await queue.request(n)) executed.push(n); });
  assert.deepEqual(queue.getSnapshot().pending.map((item) => item.payload), [1, 2, 3]);
  for (const allowed of [true, false, true]) {
    queue.decide(queue.getSnapshot().pending[0].id, allowed);
    await Promise.resolve();
  }
  await Promise.all(requests);
  assert.deepEqual(executed, [1, 3]);
  assert.deepEqual(queue.getSnapshot(), { pending: [], total: 0 });
});

test('approve all releases only the displayed run group, in FIFO order', async () => {
  const queue = new ConfirmationQueue<number>();
  const executed: number[] = [];
  const requests = [1, 2, 3].map(async (n) => {
    if (await queue.request(n, { scope: 'parent' })) executed.push(n);
  });
  const visible = queue.getSnapshot().pending;
  const other = queue.request(4, { scope: 'other' });
  const later = queue.request(5, { scope: 'parent' });
  queue.approveGroup(visible[0].id, visible.map((item) => item.id));
  await Promise.all(requests);
  assert.deepEqual(executed, [1, 2, 3]);
  assert.deepEqual(queue.getSnapshot().pending.map((item) => item.payload), [4, 5]);
  queue.cancelScope('other');
  queue.cancelScope('parent');
  assert.deepEqual(await Promise.all([other, later]), [false, false]);
});

test('stale approve/reject/all events cannot settle the next request; single request remains compatible', async () => {
  const queue = new ConfirmationQueue<string>();
  const first = queue.request('first');
  const firstId = queue.getSnapshot().pending[0].id;
  queue.decide(firstId, true);
  assert.equal(await first, true);
  const second = queue.request('second');
  const secondId = queue.getSnapshot().pending[0].id;
  queue.decide(firstId, true);
  queue.decide(firstId, false);
  queue.approveGroup(firstId, [secondId]);
  assert.equal(queue.getSnapshot().pending[0].id, secondId);
  assert.equal(queue.getSnapshot().pending[0].position, 1);
  queue.decide(secondId, false);
  assert.equal(await second, false);
});

test('abort removes exactly its request, settles false and detaches listeners', async () => {
  const queue = new ConfirmationQueue<string>();
  const controller = new AbortController();
  let removed = 0;
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean) => {
    removed++;
    if (listener) remove(type, listener, options);
  };
  const first = queue.request('aborted', { scope: 'a', signal: controller.signal });
  const second = queue.request('kept', { scope: 'b' });
  controller.abort();
  assert.equal(await first, false);
  assert.equal(removed, 1);
  assert.equal(queue.getSnapshot().pending[0].payload, 'kept');
  queue.decide(queue.getSnapshot().pending[0].id, true);
  assert.equal(await second, true);
  assert.equal(await queue.request('already aborted', { signal: controller.signal }), false);
  assert.equal(queue.getSnapshot().pending.length, 0);
});

test('DSH concurrent paid tools share queue; cancellation cannot reach tool body', async () => {
  const queue = new ConfirmationQueue<number>();
  const executed: number[] = [];
  const tool: Tool = {
    definition: { name: 'image_generate', description: 'mock paid tool', parameters: { type: 'object', properties: {} } },
    risk: 'ask',
    execute: async (params) => { executed.push(Number(params.n)); return { success: true, output: 'mock' }; },
  };
  const registry = {
    get: () => tool,
    execute: (_name: string, params: Record<string, unknown>, signal?: AbortSignal) => tool.execute(params, signal),
  } as unknown as ToolRegistry;
  const callbacks: CoordinatorCallbacks = {
    onTextDelta: () => {}, onThinkingDelta: () => {}, onToolStart: () => {},
    onToolEnd: () => {}, onComplete: () => {}, onError: () => {},
    onToolConfirm: (_name, params, _reason, signal) => queue.request(Number(params.n), { scope: 'run', signal }),
  };
  const controllers = [1, 2, 3].map(() => new AbortController());
  const results = controllers.map((controller, i) => executeDshToolCall({
    name: 'image_generate', runId: 'run', instanceId: 'instance', requestId: String(i), arguments: { n: i + 1 },
  }, registry, callbacks, controller.signal));
  controllers[1].abort();
  const visible = queue.getSnapshot().pending;
  queue.approveGroup(visible[0].id, visible.map((item) => item.id));
  assert.deepEqual((await Promise.all(results)).map((result) => result.success), [true, false, true]);
  assert.deepEqual(executed, [1, 3]);
});

test('one batch expands into individual drafts; rejecting second passes only first and third to executor', async () => {
  const queue = new ConfirmationQueue<Record<string, unknown>>();
  const params = { jobs: [{ node_id: 'a' }, { node_id: 'b' }, { node_id: 'c' }] };
  const pending = confirmToolItems('canvas_generate_batch', params, (item) => queue.request(item.params));
  assert.deepEqual(queue.getSnapshot().pending.map((item) => item.payload.node_id), ['a', 'b', 'c']);
  for (const allowed of [true, false, true]) queue.decide(queue.getSnapshot().pending[0].id, allowed);
  assert.equal(await pending, true);
  assert.deepEqual(params.jobs, [{ node_id: 'a' }, { node_id: 'c' }]);
});

test('MG batch inherits common fields, supports approve all, and abort never releases batch', async () => {
  const queue = new ConfirmationQueue<Record<string, unknown>>();
  const params = { engine: 'omni', segments: [{ prompt: 'one' }, { prompt: 'two', engine: 'minimax-h3' }] };
  const controller = new AbortController();
  const pending = confirmToolItems('timeline_omni_mg_generate_batch', params, (item) => queue.request(item.params), controller.signal);
  const visible = queue.getSnapshot().pending;
  assert.deepEqual(visible.map((item) => item.payload.engine), ['omni', 'minimax-h3']);
  queue.approveGroup(visible[0].id, visible.map((item) => item.id));
  controller.abort();
  assert.equal(await pending, false);
});
