import assert from 'node:assert/strict';
import test from 'node:test';
import { TransientNoticeQueue } from './transientNoticeQueue.ts';

function contents(queue: TransientNoticeQueue): string[] {
  return queue.takeForRequest().map((message) => (
    typeof message.content === 'string' ? message.content : ''
  ));
}

test('run notices survive tool rounds while one-shot notices are consumed', () => {
  const queue = new TransientNoticeQueue();
  queue.addRun('stage contract');
  queue.addOnce('budget warning');

  assert.deepEqual(contents(queue), ['stage contract', 'budget warning']);
  assert.deepEqual(contents(queue), ['stage contract']);

  queue.endRun();
  assert.deepEqual(contents(queue), []);
});
