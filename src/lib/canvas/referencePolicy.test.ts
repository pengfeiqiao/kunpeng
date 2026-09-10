import test from 'node:test';
import assert from 'node:assert/strict';
import {
  explicitSelfImageSource,
  explicitSelfVideoSource,
  isNonReferenceEdgeData,
  migrateLegacyVideoNodeReferences,
} from './referencePolicy.ts';

test('generated image outputs are never implicit self references（防重 roll 自吞）', () => {
  // AI 产物：generatedImageUrl/localPath 无上传标记 → 不回灌
  assert.equal(explicitSelfImageSource({
    generatedImageUrl: 'asset://localhost/output.png',
    localPath: '/output/result.png',
  }), '');
  assert.equal(explicitSelfImageSource({
    generatedImageUrl: 'asset://localhost/output.png',
    isUploadedImage: false,
  }), '');
  assert.equal(explicitSelfImageSource({}), '');
});

test('explicit user-placed images remain available for image editing', () => {
  // 上传源字段 referenceImage 优先
  assert.equal(explicitSelfImageSource({
    isUploadedImage: true,
    referenceImage: 'asset://localhost/upload.png',
    generatedImageUrl: 'asset://localhost/old-product.png',
  }), 'asset://localhost/upload.png');
  // 上传落在 generatedImageUrl/localPath 的旧节点（ImageNode 上传路径）也认
  assert.equal(explicitSelfImageSource({
    isUploadedImage: true,
    generatedImageUrl: 'asset://localhost/upload.png',
    localPath: '/Users/demo/upload.png',
  }), 'asset://localhost/upload.png');
});

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
