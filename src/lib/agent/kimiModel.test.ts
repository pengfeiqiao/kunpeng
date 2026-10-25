import test from 'node:test';
import assert from 'node:assert/strict';
import { toKimiWireModel } from './kimiModel.ts';
import { getRawContextWindowSize } from './contextWindow.ts';

test('Kimi K3.1 picker IDs are sent unchanged to Kimi Code', () => {
  assert.equal(toKimiWireModel('k3.1-pro'), 'k3.1-pro');
  assert.equal(toKimiWireModel('k3.1-pro-highspeed'), 'k3.1-pro-highspeed');
});

test('Moonshot-prefixed K3.1 IDs migrate to Kimi Code wire IDs', () => {
  assert.equal(toKimiWireModel('kimi-k3.1-pro'), 'k3.1-pro');
  assert.equal(toKimiWireModel('kimi-k3.1-pro-highspeed'), 'k3.1-pro-highspeed');
});

test('both K3.1 variants use the official 1M context window', () => {
  assert.equal(getRawContextWindowSize('kimi:k3.1-pro'), 1_048_576);
  assert.equal(getRawContextWindowSize('kimi:k3.1-pro-highspeed'), 1_048_576);
});
