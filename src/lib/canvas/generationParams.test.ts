import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeCanvasNodeGenerationParams } from './generationParams.ts';

test('video generation inherits visible node parameters when the agent omits them', () => {
  assert.deepEqual(
    mergeCanvasNodeGenerationParams('video', {
      duration: 15,
      resolution: '720p',
      aspectRatio: '9:16',
      generateAudio: true,
    }),
    {
      duration: 15,
      resolution: '720p',
      aspectRatio: '9:16',
      ratio: '9:16',
      generateAudio: true,
    },
  );
});

test('explicit generation parameters override inherited node values', () => {
  assert.deepEqual(
    mergeCanvasNodeGenerationParams(
      'video',
      { duration: 15, resolution: '720p', aspectRatio: '9:16' },
      { duration: '6', ratio: '16:9' },
    ),
    {
      duration: '6',
      resolution: '720p',
      aspectRatio: '9:16',
      ratio: '16:9',
    },
  );
});

test('non-video generation parameters are not polluted by video node fields', () => {
  assert.deepEqual(
    mergeCanvasNodeGenerationParams('image', { duration: 15 }, { resolution: '2k' }),
    { resolution: '2k' },
  );
});
