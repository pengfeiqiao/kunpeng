import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPaidSubmission, isPaidTool, PaidToolIdempotencyGate } from './paidToolIdempotency.ts';

test('blocks same paid call in one run after submission', () => {
  const gate = new PaidToolIdempotencyGate();
  gate.record('run-a', 'image_generate', { prompt: 'x', size: '1:1' }, { success: true, output: 'ok' });
  assert.match(gate.check('run-a', 'image_generate', { size: '1:1', prompt: 'x' }) ?? '', /阻止重复执行/);
});

test('parent and child share the parent run ledger namespace', () => {
  const gate = new PaidToolIdempotencyGate();
  const parentLedgerId = 'run-parent';
  const params = { prompt: 'same storyboard frame', size: '16:9' };
  assert.equal(gate.reserve(parentLedgerId, 'image_generate', params), null);
  gate.record(parentLedgerId, 'image_generate', params, {
    success: true,
    output: '{"task_id":"paid-1","status":"submitted"}',
  });
  assert.match(
    gate.reserve(parentLedgerId, 'image_generate', params) ?? '',
    /阻止重复执行/,
  );
  assert.equal(gate.reserve('run-parent/sub-1', 'image_generate', params), null);
});

test('atomically blocks a concurrent duplicate before the first call returns', () => {
  const gate = new PaidToolIdempotencyGate();
  assert.equal(gate.reserve('run-a', 'timeline_mg_generate', { prompt: 'x' }), null);
  assert.match(gate.reserve('run-a', 'timeline_mg_generate', { prompt: 'x' }) ?? '', /正在执行/);
  gate.record('run-a', 'timeline_mg_generate', { prompt: 'x' }, {
    success: false,
    output: '',
    error: 'validation failed before submission',
  });
  assert.equal(gate.reserve('run-a', 'timeline_mg_generate', { prompt: 'x' }), null);
});

test('changed params, force and another run pass', () => {
  const gate = new PaidToolIdempotencyGate();
  gate.record('run-a', 'video_generate', { prompt: 'x' }, { success: true, output: 'submitted task_id=1' });
  assert.equal(gate.check('run-a', 'video_generate', { prompt: 'y' }), null);
  assert.equal(gate.check('run-a', 'video_generate', { prompt: 'x', force: true }), null);
  assert.equal(gate.check('run-b', 'video_generate', { prompt: 'x' }), null);
});

test('explicit validation failures do not lock retries but unknown submission does', () => {
  const gate = new PaidToolIdempotencyGate();
  gate.record('run-a', 'doubao_speech_generate', { text: 'x' }, { success: false, output: '', error: 'validation failed' });
  assert.equal(gate.check('run-a', 'doubao_speech_generate', { text: 'x' }), null);
  gate.record('run-a', 'doubao_speech_generate', { text: 'x' }, { success: false, output: '', error: 'network timeout after submit' });
  assert.match(gate.check('run-a', 'doubao_speech_generate', { text: 'x' }) ?? '', /状态不明/);
});

test('paid tool catalog covers image, video, MG, Omni, speech and custom media calls', () => {
  for (const name of [
    'image_generate',
    'video_generate',
    'canvas_generate_batch',
    'timeline_omni_mg_generate_batch',
    'mg_generate_with_reference_boards',
    'doubao_speech_generate',
    'custom-media:vendor-video',
  ]) assert.equal(isPaidTool(name), true, name);
  assert.equal(isPaidTool('task_status'), false);
});

test('a validation message mentioning task_id is not mistaken for a submitted task', () => {
  assert.equal(classifyPaidSubmission({
    success: false,
    output: '',
    error: 'validation failed: task_id is required',
  }), 'not_submitted');
  assert.equal(classifyPaidSubmission({
    success: false,
    output: '',
    error: 'network timeout, response missing task id',
  }), 'unknown');
  assert.equal(classifyPaidSubmission({
    success: true,
    output: '{"task_id":"task_12345","status":"submitted"}',
  }), 'submitted');
});
