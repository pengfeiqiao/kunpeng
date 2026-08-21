import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getEffectiveContextWindowSize,
  getRawContextWindowSize,
  normalizeContextModelId,
} from './contextWindow.ts';

test('qualified Kimi 1M aliases keep the 1M context budget', () => {
  assert.equal(normalizeContextModelId('other:k3[1m]'), 'k3[1m]');
  assert.equal(getRawContextWindowSize('kimi:k3[1m]'), 1_048_576);
  assert.equal(getEffectiveContextWindowSize('other:k3[1m]'), 1_028_576);
});

test('provider-declared context window wins for future model ids', () => {
  assert.equal(getRawContextWindowSize('future-model', 512_000), 512_000);
  assert.equal(getEffectiveContextWindowSize('future-model', 512_000), 492_000);
});
