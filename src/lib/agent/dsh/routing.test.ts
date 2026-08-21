import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deepseekBuiltinRoute,
  shouldFallbackHarnessToBuiltin,
} from './routing.ts';

test('Harness failure before visible output falls back to built-in DeepSeek', () => {
  assert.equal(shouldFallbackHarnessToBuiltin(new Error('ACP bridge disposed'), false), true);
  assert.equal(shouldFallbackHarnessToBuiltin(new Error('HTTP 503 unavailable'), false), true);
  assert.equal(shouldFallbackHarnessToBuiltin(new Error('HTTP 400 invalid request'), false), true);
});

test('Harness never restarts after output or user abort', () => {
  assert.equal(shouldFallbackHarnessToBuiltin(new Error('socket closed'), true), false);
  assert.equal(shouldFallbackHarnessToBuiltin(new DOMException('Aborted', 'AbortError'), false), false);
  const namedAbort = new Error('cancelled');
  namedAbort.name = 'AbortError';
  assert.equal(shouldFallbackHarnessToBuiltin(namedAbort, false), false);
});

test('built-in handoff preserves the DeepSeek model and disables provider fallback', () => {
  assert.deepEqual(deepseekBuiltinRoute('deepseek-v4-flash'), {
    kind: 'primary',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
  });
});
