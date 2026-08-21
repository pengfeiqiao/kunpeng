import assert from 'node:assert/strict';
import test from 'node:test';
import { getMicrocompactPolicy } from './contextRetention.ts';

test('1M context keeps complete ordinary tool history while pressure is low', () => {
  const policy = getMicrocompactPolicy(1_028_576, 300_000);
  assert.equal(policy.preserveFullToolHistory, true);
  assert.equal(policy.recentToolKeep, 48);
  assert.equal(policy.protectedToolHardLimit, 160_000);
});

test('1M context becomes selective only after entering the pressure zone', () => {
  const policy = getMicrocompactPolicy(1_028_576, 850_000);
  assert.equal(policy.preserveFullToolHistory, false);
  assert.equal(policy.recentToolKeep, 48);
});

test('256K and 128K models retain bounded recent tool history', () => {
  const medium = getMicrocompactPolicy(262_144, 20_000);
  const small = getMicrocompactPolicy(128_000, 20_000);
  assert.equal(medium.preserveFullToolHistory, false);
  assert.equal(medium.recentToolKeep, 10);
  assert.equal(small.preserveFullToolHistory, false);
  assert.equal(small.recentToolKeep, 4);
  assert.equal(small.protectedToolHardLimit, 12_000);
});
