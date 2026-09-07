import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { ProjectAssistantQueue, AssistantQueueFailure, assistantThreadKey, type AssistantTarget } from './projectAssistantQueue.ts';

const target = (patch: Partial<AssistantTarget> = {}): AssistantTarget => ({ projectId: 'p', sessionId: 's', objectId: 'a', label: '镜头01', context: 'context-a', ...patch });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; };

test('queue deduplicates only equal project/session/frozen target/context/files', () => {
  const q = new ProjectAssistantQueue();
  const a = q.enqueue(target(), 'same', ['a', 'b']);
  assert.equal(q.enqueue(target(), 'same', ['a', 'b']), a);
  for (const patch of [{ projectId: 'p2' }, { sessionId: 's2' }, { objectId: 'b' }, { context: 'changed' }, { mediaId: 'm' }]) q.enqueue(target(patch), 'same', ['a', 'b']);
  q.enqueue(target(), 'same', ['b', 'a']);
  assert.equal(q.getSnapshot().items.length, 7);
});

test('unmount before dispatch cancels timer without stranding running; remount sends once', async () => {
  const q = new ProjectAssistantQueue(undefined, 15); let sends = 0;
  const port = { projectId: 'p', safe: () => true, send: async () => { sends++; } };
  q.enqueue(target(), 'a'); const detach = q.attach(port); detach();
  await wait(25); assert.equal(sends, 0); assert.equal(q.getSnapshot().items[0].status, 'queued');
  const stop = q.attach(port); await wait(25); stop();
  assert.equal(sends, 1); assert.equal(q.getSnapshot().items[0].status, 'done');
});

test('running promise survives unmount and remount without replay; idle alone cannot release it', async () => {
  const q = new ProjectAssistantQueue(undefined, 1); const run = deferred(); let sends = 0;
  const port = { projectId: 'p', safe: () => true, send: () => { sends++; return sends === 1 ? run.promise : Promise.resolve(); } };
  q.enqueue(target(), 'a'); q.enqueue(target(), 'b'); const detach = q.attach(port);
  await wait(15); detach(); const stop = q.attach(port); q.kick(); await wait(15);
  assert.equal(sends, 1); assert.equal(q.getSnapshot().items[0].status, 'running');
  run.resolve(); await wait(20); stop(); assert.equal(sends, 2);
  assert.deepEqual(q.getSnapshot().items.map((item) => item.status), ['done', 'done']);
});

test('failed preparation keeps frozen text/files and allows manual retry only', async () => {
  const q = new ProjectAssistantQueue(undefined, 1); let calls = 0;
  const id = q.enqueue(target(), 'preserved', ['local.png'])!;
  const detach = q.attach({ projectId: 'p', safe: () => true, send: async () => { if (++calls === 1) throw new AssistantQueueFailure('not sent', true); } });
  await wait(15); assert.equal(q.getSnapshot().items[0].status, 'failed'); q.kick(); await wait(10); assert.equal(calls, 1);
  q.update(id, 'retry'); await wait(15); detach(); assert.equal(calls, 2);
  assert.equal(q.getSnapshot().items[0].prompt, 'preserved'); assert.deepEqual(q.getSnapshot().items[0].files, ['local.png']);
});

test('unknown submission cannot be retried through edit, promotion, or retry', async () => {
  const q = new ProjectAssistantQueue(undefined, 1); let calls = 0;
  const id = q.enqueue(target(), 'paid?')!;
  const detach = q.attach({ projectId: 'p', safe: () => true, send: async () => { calls++; throw new Error('unknown transport result'); } });
  await wait(15);
  q.update(id, 'retry'); q.update(id, 'edit', 'changed'); q.update(id, 'prioritize'); await wait(15); detach();
  assert.equal(calls, 1); assert.equal(q.getSnapshot().items[0].status, 'uncertain'); assert.equal(q.getSnapshot().items[0].prompt, 'paid?');
});

test('safety is checked again at timer fire and blocked queue never sends', async () => {
  const q = new ProjectAssistantQueue(undefined, 10); let safe = true; let calls = 0;
  q.enqueue(target(), 'a'); const detach = q.attach({ projectId: 'p', safe: () => safe, send: async () => { calls++; } });
  safe = false; await wait(20); assert.equal(calls, 0); assert.equal(q.getSnapshot().items[0].status, 'queued');
  safe = true; q.kick(); await wait(20); detach(); assert.equal(calls, 1);
});

test('projects are isolated and priority takes effect only after current promise settles', async () => {
  const q = new ProjectAssistantQueue(undefined, 1); const run = deferred(); const sent: string[] = [];
  q.enqueue(target(), 'first'); q.enqueue(target(), 'second'); const id = q.enqueue(target(), 'third')!;
  q.enqueue(target({ projectId: 'other' }), 'other');
  const detach = q.attach({ projectId: 'p', safe: () => true, send: async (item) => { sent.push(item.prompt); if (item.prompt === 'first') await run.promise; } });
  await wait(15); q.update(id, 'prioritize'); await wait(10); assert.deepEqual(sent, ['first']);
  run.resolve(); await wait(20); detach(); assert.deepEqual(sent, ['first', 'third', 'second']);
  assert.equal(q.getSnapshot().items.find((item) => item.prompt === 'other')?.status, 'queued');
});

test('drafts persist across scopes and snapshot hydration; interrupted running becomes uncertain', async () => {
  let cache = ''; const q = new ProjectAssistantQueue((value) => { cache = value; }, 1);
  q.writeDraft(target(), 'A draft', ['a.png']); q.select(target({ objectId: 'b' })); q.writeDraft(target({ objectId: 'b' }), 'B draft', []);
  q.select(target()); assert.equal(q.draft('p', 's')?.text, 'A draft'); assert.equal(q.draft('other', 's'), undefined);
  const run = deferred(); q.enqueue(target(), 'running'); const detach = q.attach({ projectId: 'p', safe: () => true, send: () => run.promise });
  await wait(10); const restored = new ProjectAssistantQueue(); restored.restore(cache);
  assert.equal(restored.draft('p', 's')?.text, 'A draft'); assert.equal(restored.getSnapshot().items[0].status, 'uncertain');
  assert.equal(restored.getSnapshot().items[0].threadKey, assistantThreadKey(target())); detach(); run.resolve(); await wait(5);
});

test('two mounted consumers share one execution lease and settlement while detached persists', async () => {
  const q = new ProjectAssistantQueue(undefined, 1); const run = deferred(); let calls = 0;
  const port = { projectId: 'p', safe: () => true, send: () => { calls++; return run.promise; } };
  q.enqueue(target(), 'once'); const a = q.attach(port); const b = q.attach(port); await wait(10); a(); b(); run.resolve(); await wait(10);
  assert.equal(calls, 1); assert.equal(q.getSnapshot().items[0].status, 'done');
});

test('new session preparation rekeys drafts and queued targets without changing frozen context', () => {
  const q = new ProjectAssistantQueue(); const t = target({ sessionId: null });
  q.writeDraft(t, 'draft', ['a']); q.enqueue(t, 'next'); q.bindPreparedSession('p', 'created-session');
  assert.equal(q.draft('p', null), undefined); assert.equal(q.draft('p', 'created-session')?.text, 'draft');
  assert.equal(q.getSnapshot().items[0].target.context, t.context); assert.equal(q.getSnapshot().items[0].target.sessionId, 'created-session');
});

test('inactive session queue is retained without blocking the active session', async () => {
  const q = new ProjectAssistantQueue(undefined, 1); const sent: string[] = [];
  q.enqueue(target({ sessionId: 'inactive' }), 'old'); q.enqueue(target(), 'current');
  const detach = q.attach({ projectId: 'p', safe: (item) => item.target.sessionId === 's', send: async (item) => { sent.push(item.prompt); } });
  await wait(15); detach(); assert.deepEqual(sent, ['current']); assert.equal(q.getSnapshot().items[0].status, 'queued');
});

test('media, editor and documents keep separate draft threads across surface switches', () => {
  const q = new ProjectAssistantQueue(); q.writeDraft(target(), 'media', []);
  q.writeDraft(target({ surface: 'editor' }), 'edit timeline', []);
  q.writeDraft(target({ surface: 'documents' }), 'edit specification', []);
  assert.equal(q.draft('p', 's', 'media')?.text, 'media');
  assert.equal(q.draft('p', 's', 'editor')?.text, 'edit timeline');
  assert.equal(q.draft('p', 's', 'documents')?.text, 'edit specification');
});
