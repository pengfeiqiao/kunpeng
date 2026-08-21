import test from 'node:test';
import assert from 'node:assert/strict';
import {
  explicitSelfVideoSource,
  isNonReferenceEdgeData,
  migrateLegacyVideoNodeReferences,
} from './referencePolicy.ts';

test('generated video outputs are never implicit self references', () => {
  assert.equal(explicitSelfVideoSource({
    mediaRole: 'output',
  }), '');
  assert.equal(explicitSelfVideoSource({
    generatedVideoUrl: 'asset://localhost/output.mp4',
    localPath: '/output/result.mp4',
  } as never), '');
});

test('explicit user video sources remain available for video editing', () => {
  assert.equal(explicitSelfVideoSource({
    mediaRole: 'reference',
    sourceVideoPath: '/input/original.mp4',
  }), '/input/original.mp4');
  assert.equal(explicitSelfVideoSource({
    mediaRole: 'output',
    sourceVideoPath: '/input/original.mp4',
  }), '/input/original.mp4');
});

test('history and composition edges never become generation references', () => {
  assert.equal(isNonReferenceEdgeData({ relation: 'version' }), true);
  assert.equal(isNonReferenceEdgeData({ relation: 'composition' }), true);
  assert.equal(isNonReferenceEdgeData({ relation: 'reference' }), false);
  assert.equal(isNonReferenceEdgeData(undefined), false);
});

test('legacy uploaded videos migrate to explicit references', () => {
  const result = migrateLegacyVideoNodeReferences([{
    id: 'legacy-upload',
    type: 'video',
    data: {
      generatedVideoUrl: 'asset://localhost/input.mp4',
      localPath: '/Users/demo/input.mp4',
      description: '请修改这个视频',
    },
  }]);
  assert.equal(result.changed, true);
  const data = result.nodes[0].data as Record<string, unknown>;
  assert.equal(data.mediaRole, 'reference');
  assert.equal(data.sourceVideoPath, '/Users/demo/input.mp4');
});

test('legacy generated videos stay outputs', () => {
  const result = migrateLegacyVideoNodeReferences([{
    id: 'legacy-output',
    type: 'video',
    data: {
      generatedVideoUrl: 'asset://localhost/output.mp4',
      localPath: '/workspace/videos/output.mp4',
      modelVersion: 'seedance-2.0',
    },
  }]);
  assert.equal(result.changed, true);
  const data = result.nodes[0].data as Record<string, unknown>;
  assert.equal(data.mediaRole, 'output');
  assert.equal(data.sourceVideoPath, undefined);
});
