import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectWriteQueue } from './projectWriteQueue.ts';

test('same project file writes complete in invocation order, not disk latency order', async () => {
  const queue = new ProjectWriteQueue();
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const values: string[] = [];
  const old = queue.write('a/workshop.json', async () => { await wait; values.push('old'); });
  const recent = queue.write('a/workshop.json', async () => { values.push('reservation'); });
  const other = queue.write('b/workshop.json', async () => { values.push('other-project'); });
  await other;
  assert.deepEqual(values, ['other-project']);
  release(); await Promise.all([old, recent]);
  assert.deepEqual(values, ['other-project', 'old', 'reservation']);
  assert.equal(queue.pendingFiles, 0);
});

test('disk failure propagates to caller but does not poison later writes or leak queue entries', async () => {
  const queue = new ProjectWriteQueue();
  const failure = queue.write('a/file', async () => { throw new Error('mock disk failure'); });
  const next = queue.write('a/file', async () => {});
  await assert.rejects(failure, /mock disk failure/);
  await next;
  assert.equal(queue.pendingFiles, 0);
});
