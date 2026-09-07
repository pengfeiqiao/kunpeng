import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProjectSpecAgentContext, patchProjectSpec, summarizeProjectSpec } from './projectSpec.ts';
import { defaultProjectSpec } from './types.ts';

test('project spec defaults to paid-only confirmation and patches by revision', () => {
  const base = defaultProjectSpec(10);
  const next = patchProjectSpec(base, { aspectRatio: '16:9', targetDurationSec: 30 }, 20);
  assert.equal(base.generationConfirmation, 'paid-only-confirm');
  assert.equal(next.revision, 2);
  assert.equal(next.updatedAt, 20);
  assert.equal(summarizeProjectSpec(next), '16:9 · 30s');
});

test('project context exposes shared constraints', () => {
  const spec = patchProjectSpec(defaultProjectSpec(10), {
    styleTone: '克制的现实主义',
    continuityFacts: ['人物服装连续'],
    forbidden: ['不得新增对白'],
  }, 20);
  const text = buildProjectSpecAgentContext('测试项目', spec) ?? '';
  assert.match(text, /工坊、画布、剪辑与普通对话共享/);
  assert.match(text, /仅付费生成前确认/);
  assert.match(text, /不得新增对白/);
});
