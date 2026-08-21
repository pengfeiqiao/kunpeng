import test from 'node:test';
import assert from 'node:assert/strict';
import { tailWindow } from './tailWindow.ts';

test('long histories expose only the requested tail in original order', () => {
  const history = Array.from({ length: 1_188 }, (_, index) => index);
  const result = tailWindow(history, 60);

  assert.equal(result.startIndex, 1_128);
  assert.equal(result.items.length, 60);
  assert.deepEqual(result.items, history.slice(1_128));
  assert.equal(result.hasEarlier, true);
});

test('short histories remain complete', () => {
  const result = tailWindow(['a', 'b'], 60);
  assert.deepEqual(result, {
    startIndex: 0,
    items: ['a', 'b'],
    hasEarlier: false,
  });
});
