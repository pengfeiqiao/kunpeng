import test from 'node:test';
import assert from 'node:assert/strict';
import { errorText } from './errorText.ts';

test('errorText never renders [object Object] and unwraps nested API error bodies', () => {
  assert.equal(errorText(new Error('网络超时')), '网络超时');
  assert.equal(errorText('plain'), 'plain');
  assert.equal(errorText(undefined), '');
  assert.equal(errorText(null), '');
  assert.equal(errorText({ message: '余额不足' }), '余额不足');
  assert.equal(errorText({ error: { message: '审核拒绝' } }), '审核拒绝');
  assert.equal(errorText({ fail_reason: { error: '内容违规' } }), '内容违规');
  assert.equal(errorText({ status: 429, detail: 'too many requests' }), 'too many requests');
  const nested = errorText({ foo: { bar: 1 } });
  assert.ok(nested && !nested.includes('[object Object]'));
  assert.ok(nested.includes('"bar":1'));
  assert.equal(errorText({}), '');
});
