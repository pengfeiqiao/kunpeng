import test from 'node:test';
import assert from 'node:assert/strict';
import { applyKuaiziEditingConstraints, normalizeKuaiziDuration } from './duration.ts';

test('Kuaizi duration preserves a 15 second canvas selection', () => {
  assert.equal(normalizeKuaiziDuration('15'), 15);
  assert.equal(normalizeKuaiziDuration(15), 15);
});

test('Kuaizi duration stays within the supported 4 to 15 second range', () => {
  assert.equal(normalizeKuaiziDuration('4'), 4);
  assert.equal(normalizeKuaiziDuration('1'), 4);
  assert.equal(normalizeKuaiziDuration('30'), 15);
  assert.equal(normalizeKuaiziDuration(6.9), 6);
  assert.equal(normalizeKuaiziDuration('not-a-number'), 5);
  assert.equal(normalizeKuaiziDuration('-1'), 5);
  assert.equal(normalizeKuaiziDuration(undefined), 5);
});

test('Kuaizi seedance2.5 mode allows up to 30 seconds', () => {
  assert.equal(normalizeKuaiziDuration('4', 5, 'seedance2.5'), 4);
  assert.equal(normalizeKuaiziDuration('15', 5, 'seedance2.5'), 15);
  assert.equal(normalizeKuaiziDuration('30', 5, 'seedance2.5'), 30);
  assert.equal(normalizeKuaiziDuration(30, 5, 'seedance2.5'), 30);
  assert.equal(normalizeKuaiziDuration('31', 5, 'seedance2.5'), 30);
  assert.equal(normalizeKuaiziDuration(100, 5, 'seedance2.5'), 30);
  assert.equal(normalizeKuaiziDuration('1', 5, 'seedance2.5'), 4);
  assert.equal(normalizeKuaiziDuration(6.9, 5, 'seedance2.5'), 6);
  assert.equal(normalizeKuaiziDuration('not-a-number', 5, 'seedance2.5'), 5);
  assert.equal(normalizeKuaiziDuration('-1', 5, 'seedance2.5'), 5);
  assert.equal(normalizeKuaiziDuration(undefined, 5, 'seedance2.5'), 5);
});

test('Kuaizi non-2.5 modes keep the 15 second ceiling', () => {
  assert.equal(normalizeKuaiziDuration('30', 5, 'pro'), 15);
  assert.equal(normalizeKuaiziDuration('30', 5, 'fast'), 15);
  assert.equal(normalizeKuaiziDuration('30', 5, 'mini'), 15);
});

test('Kuaizi editing constraints apply only in explicit video-edit mode with ref videos', () => {
  // videoEdit=true + 有参考视频 → adaptive + -1
  assert.deepEqual(applyKuaiziEditingConstraints(true, true, '16:9', 8), { ratio: 'adaptive', duration: -1 });
  // videoEdit=true 但没有参考视频 → 不应用约束
  assert.deepEqual(applyKuaiziEditingConstraints(true, false, '16:9', 8), { ratio: '16:9', duration: 8 });
  // 参考视频作多参（videoEdit=false）→ 保留原参数
  assert.deepEqual(applyKuaiziEditingConstraints(false, true, '9:16', 15), { ratio: '9:16', duration: 15 });
  assert.deepEqual(applyKuaiziEditingConstraints(false, false, 'adaptive', 5), { ratio: 'adaptive', duration: 5 });
});
