import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isTerminalRhtvRejection,
  RhtvBusinessError,
  RhtvSubmissionUnknownError,
} from './types.ts';

// Regression: a RunningHub balance/auth rejection must be classified as a
// terminal provider failure, not "a paid task exists". Misclassification used
// to suppress BOTH the MiniMax H3 channel fallback (runninghub → apimart)
// and the MG engine cascade (H3 → Omni → Mini), because every gate saw a
// providerTaskId without providerFailed.

test('balance rejection is terminal — no charge happened, fallback allowed', () => {
  const err = new RhtvBusinessError('balance', 'RunningHub 余额不足: NOT_ENOUGH_BALANCE');
  assert.equal(isTerminalRhtvRejection(err), true);
});

test('auth rejection is terminal — same-provider retry is pointless', () => {
  const err = new RhtvBusinessError('auth', 'RunningHub 认证失败');
  assert.equal(isTerminalRhtvRejection(err), true);
});

test('task_failed is terminal — remote task ended in failed state', () => {
  const err = new RhtvBusinessError('task_failed', '任务失败');
  assert.equal(isTerminalRhtvRejection(err), true);
});

test('bad_request keeps conservative semantics (not terminal)', () => {
  const err = new RhtvBusinessError('bad_request', '参数错误');
  assert.equal(isTerminalRhtvRejection(err), false);
});

test('submission-unknown is never terminal — it must block fallback to prevent double charge', () => {
  const err = new RhtvSubmissionUnknownError('响应丢失');
  assert.equal(isTerminalRhtvRejection(err), false);
});

test('unrelated errors are not terminal', () => {
  assert.equal(isTerminalRhtvRejection(new Error('network')), false);
  assert.equal(isTerminalRhtvRejection('balance'), false);
  assert.equal(isTerminalRhtvRejection(undefined), false);
});
