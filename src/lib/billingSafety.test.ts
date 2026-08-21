import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PaidSubmissionUnknownError,
  PaidTaskCreatedError,
  isAmbiguousPaidSubmitStatus,
  mustNotAutoResubmit,
  paidTaskId,
  paidRetryStoppedMessage,
  shouldStopAutomaticPaidFallback,
} from './billingSafety.ts';

test('ambiguous create outcomes stop automatic paid fallback', () => {
  assert.equal(mustNotAutoResubmit(new PaidSubmissionUnknownError('test', 'timeout')), true);
  assert.equal(mustNotAutoResubmit(new PaidTaskCreatedError('test', 'task-1', 'poll failed')), true);
  assert.equal(mustNotAutoResubmit(Object.assign(new Error('unknown'), { name: 'RhtvSubmissionUnknownError' })), true);
  assert.equal(mustNotAutoResubmit(new Error('explicit bad request')), false);
});

test('only timeout and server errors are ambiguous after a create POST', () => {
  assert.equal(isAmbiguousPaidSubmitStatus(408), true);
  assert.equal(isAmbiguousPaidSubmitStatus(500), true);
  assert.equal(isAmbiguousPaidSubmitStatus(503), true);
  assert.equal(isAmbiguousPaidSubmitStatus(400), false);
  assert.equal(isAmbiguousPaidSubmitStatus(401), false);
  assert.equal(isAmbiguousPaidSubmitStatus(429), false);
});

test('created task id remains recoverable without another submission', () => {
  const err = new PaidTaskCreatedError('test', 'task-abc', 'download failed');
  assert.equal(paidTaskId(err), 'task-abc');
  assert.equal(paidTaskId(new PaidSubmissionUnknownError('test', 'timeout')), undefined);
});

test('product policy allows image, Omni and speech recovery but protects Kuaizi video', () => {
  const ambiguous = new PaidSubmissionUnknownError('test', 'timeout');
  assert.equal(shouldStopAutomaticPaidFallback(ambiguous, 'image'), false);
  assert.equal(shouldStopAutomaticPaidFallback(ambiguous, 'omni'), false);
  assert.equal(shouldStopAutomaticPaidFallback(ambiguous, 'kuaizi-speech'), false);
  assert.equal(shouldStopAutomaticPaidFallback(ambiguous, 'kuaizi-video'), true);
  assert.equal(shouldStopAutomaticPaidFallback(ambiguous, 'other'), true);
  assert.equal(shouldStopAutomaticPaidFallback(new Error('explicit reject'), 'kuaizi-video'), false);
  assert.match(paidRetryStoppedMessage(ambiguous, '筷子'), /停止自动重试/);
  assert.match(paidRetryStoppedMessage(ambiguous, '筷子'), /核对原任务/);
});
