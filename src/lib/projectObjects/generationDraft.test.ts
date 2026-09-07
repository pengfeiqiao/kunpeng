import assert from 'node:assert/strict';
import test from 'node:test';
import { CANVAS_VIDEO_ENGINES } from '../rhtv/canvasEngines.ts';
import {
  buildGenerationDraft,
  calibrateGenerationForEngine,
  classifyGenerationFailure,
  describeGenerationFailure,
  shouldConfirmGeneration,
} from './generationDraft.ts';

test('generation draft preserves the actual ordered references and generation summary', () => {
  const draft = buildGenerationDraft('canvas_generate', {
    engine: 'seedance-2.5',
    prompt: '让人物转身',
    reference_urls: ['a.png', 'b.png'],
    video_urls: ['c.mp4'],
    params: { duration: 12, ratio: '16:9' },
    count: 2,
  });
  assert.ok(draft);
  assert.equal(draft.prompt, '让人物转身');
  assert.deepEqual(draft.references.map((item) => [item.type, item.value]), [
    ['image', 'a.png'], ['image', 'b.png'], ['video', 'c.mp4'],
  ]);
  assert.deepEqual(draft.references.map((item) => item.ordinal), [1, 2, 1]);
  assert.equal(draft.count, 2);
  assert.equal(draft.params.duration, 12);
});

test('project generation preference only bypasses confirmation when explicitly direct', () => {
  assert.equal(shouldConfirmGeneration('always-confirm', false), true);
  assert.equal(shouldConfirmGeneration('paid-only-confirm', true), true);
  assert.equal(shouldConfirmGeneration('paid-only-confirm', false), false);
  assert.equal(shouldConfirmGeneration('direct-execute', true), false);
});

test('engine calibration replaces invalid choices and clamps references with a visible notice', () => {
  const h3 = CANVAS_VIDEO_ENGINES.find((engine) => engine.id === 'minimax-hailuo-h3');
  assert.ok(h3);
  const result = calibrateGenerationForEngine(h3, {
    duration: '30',
    ratio: '2:1',
    resolution: '720p',
  }, {
    images: Array.from({ length: 12 }, (_, index) => `i${index}.png`),
    videos: Array.from({ length: 4 }, (_, index) => `v${index}.mp4`),
  });
  assert.equal(result.params.duration, '5');
  assert.equal(result.params.ratio, 'adaptive');
  assert.equal(result.params.resolution, '2K');
  assert.equal(result.references.images.length, 9);
  assert.equal(result.references.videos.length, 3);
  assert.ok(result.adjustments.length >= 5);
});

test('generation failures are categorized for actionable UI', () => {
  assert.equal(classifyGenerationFailure(new Error('账户余额不足')), 'balance');
  assert.equal(classifyGenerationFailure(new Error('tcp connect timed out')), 'network-timeout');
  assert.equal(classifyGenerationFailure(new Error('内容安全审核拒绝')), 'content-review');
});

test('ambiguous paid failures never expose an immediate retry action', () => {
  assert.equal(describeGenerationFailure('network timeout after submit').canRetry, false);
  assert.equal(describeGenerationFailure('task poll status unknown').canRetry, false);
  assert.equal(describeGenerationFailure('429 rate limit before submit').canRetry, true);
});
