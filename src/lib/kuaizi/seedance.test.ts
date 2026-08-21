import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeKuaiziDuration } from './duration.ts';

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
