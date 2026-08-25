import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyKuaiziSubmitHttpError } from './errors.ts';

test('kuaizi 429 with documented pre-creation rejection messages is safe to fail over', () => {
  assert.equal(classifyKuaiziSubmitHttpError(429, '钱包余额不足，请充值'), 'rejected_safe');
  assert.equal(classifyKuaiziSubmitHttpError(429, 'InsufficientBalance'), 'rejected_safe');
  assert.equal(classifyKuaiziSubmitHttpError(429, '已超出最大任务数量（当前进行中 50，上限 50）'), 'rejected_safe');
});

test('kuaizi 429 with unknown payload is ambiguous — must NOT trigger a second paid channel', () => {
  // 没有明确拒绝文案的 429：可能上游已受理，禁止容灾重发
  assert.equal(classifyKuaiziSubmitHttpError(429, 'rate limit'), 'ambiguous');
  assert.equal(classifyKuaiziSubmitHttpError(429, ''), 'ambiguous');
  assert.equal(classifyKuaiziSubmitHttpError(429, '{"type":"rate_limit_error"}'), 'ambiguous');
});

test('kuaizi 408/5xx are ambiguous, ordinary 4xx are fatal', () => {
  assert.equal(classifyKuaiziSubmitHttpError(408, 'timeout'), 'ambiguous');
  assert.equal(classifyKuaiziSubmitHttpError(500, 'internal'), 'ambiguous');
  assert.equal(classifyKuaiziSubmitHttpError(503, 'unavailable'), 'ambiguous');
  assert.equal(classifyKuaiziSubmitHttpError(400, 'invalid params'), 'fatal');
  assert.equal(classifyKuaiziSubmitHttpError(401, 'unauthorized'), 'fatal');
  assert.equal(classifyKuaiziSubmitHttpError(404, 'not found'), 'fatal');
});
