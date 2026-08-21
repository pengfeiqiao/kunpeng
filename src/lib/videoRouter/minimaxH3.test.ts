import test from 'node:test';
import assert from 'node:assert/strict';
import { selectMinimaxH3Channel, type MinimaxH3Metric } from './minimaxH3.ts';

test('alternates equally unknown H3 providers instead of fixing a primary', () => {
  assert.equal(selectMinimaxH3Channel({
    available: ['runninghub', 'apimart'], metrics: [], lastSelected: 'runninghub', now: 1,
  }), 'apimart');
  assert.equal(selectMinimaxH3Channel({
    available: ['runninghub', 'apimart'], metrics: [], lastSelected: 'apimart', now: 1,
  }), 'runninghub');
});

test('explores an untested provider before permanently preferring sampled data', () => {
  const metrics: MinimaxH3Metric[] = [
    { channel: 'runninghub', startedAt: 1_000, totalMs: 40_000, success: true },
  ];
  assert.equal(selectMinimaxH3Channel({
    available: ['runninghub', 'apimart'], metrics, lastSelected: 'runninghub', now: 2_000,
  }), 'apimart');
});

test('prefers the healthier proven H3 provider', () => {
  const metrics: MinimaxH3Metric[] = [
    { channel: 'runninghub', startedAt: 3_000, totalMs: 30_000, success: true },
    { channel: 'apimart', startedAt: 2_000, totalMs: 100_000, success: false },
    { channel: 'apimart', startedAt: 1_000, totalMs: 100_000, success: false },
  ];
  assert.equal(selectMinimaxH3Channel({
    available: ['runninghub', 'apimart'], metrics, lastSelected: 'runninghub', now: 3_500,
  }), 'runninghub');
});
