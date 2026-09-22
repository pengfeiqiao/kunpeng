import test from 'node:test';
import assert from 'node:assert/strict';
import { EventFifo, StreamWorkBudget } from './eventQueue.ts';

test('large backlog remains ordered through compaction and releases consumed slots', () => {
  const queue = new EventFifo<number>();
  for (let i = 0; i < 100_000; i++) queue.push(i);
  for (let i = 0; i < 80_000; i++) assert.equal(queue.shift(), i);
  for (let i = 100_000; i < 110_000; i++) queue.push(i);
  for (let i = 80_000; i < 110_000; i++) assert.equal(queue.shift(), i);
  assert.equal(queue.length, 0); assert.equal(queue.shift(), undefined);
  queue.push(1); queue.clear(); assert.equal(queue.length, 0);
});
test('stream budget gives input a task boundary only after work budget is exceeded', async () => {
  let clock = 0, yields = 0;
  const budget = new StreamWorkBudget(() => clock, async () => { yields++; });
  for (let i = 0; i < 32; i++) assert.equal(budget.checkpoint(), undefined);
  clock = 10;
  for (let i = 0; i < 31; i++) assert.equal(budget.checkpoint(), undefined);
  await budget.checkpoint(); assert.equal(yields, 1);
  for (let i = 0; i < 32; i++) assert.equal(budget.checkpoint(), undefined);
  clock = 20; for (let i = 0; i < 32; i++) await budget.checkpoint();
  assert.equal(yields, 2);
});
