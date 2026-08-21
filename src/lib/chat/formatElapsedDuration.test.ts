import assert from 'node:assert/strict';
import test from 'node:test';
import { formatElapsedDuration } from './formatElapsedDuration.ts';

test('formats execution time using Codex-style hour, minute, and second units', () => {
  assert.equal(formatElapsedDuration(0), '0s');
  assert.equal(formatElapsedDuration(59), '59s');
  assert.equal(formatElapsedDuration(60), '1m 0s');
  assert.equal(formatElapsedDuration(125), '2m 5s');
  assert.equal(formatElapsedDuration(3600), '1h 0m 0s');
  assert.equal(formatElapsedDuration(3661), '1h 1m 1s');
});

test('normalizes partial and invalid execution durations', () => {
  assert.equal(formatElapsedDuration(2.9), '2s');
  assert.equal(formatElapsedDuration(-5), '0s');
  assert.equal(formatElapsedDuration(Number.NaN), '0s');
});
