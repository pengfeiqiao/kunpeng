import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMgReferenceGuide,
  composeMgSubmittedImageRefs,
} from './referenceContract.ts';

test('MG reference guide keeps visible board and source numbering stable', () => {
  const guide = buildMgReferenceGuide([
    { kind: 'master', label: '母版' },
    { kind: 'frame', label: '视觉钩子', stage: 'hook' },
    { kind: 'frame', label: '完整收束', stage: 'payoff' },
  ], 2);

  assert.match(guide, /@图片一: MG 母版概念图/);
  assert.match(guide, /@图片二: 视觉钩子/);
  assert.match(guide, /@图片三: 完整收束/);
  assert.match(guide, /@图片四: 用户原始主体参考/);
  assert.match(guide, /@图片五: 用户原始主体参考/);
});

test('final MG submission only includes visible boards and original image refs', () => {
  const submitted = composeMgSubmittedImageRefs(
    ['/generated/master.png', '/generated/hook.png'],
    ['/user/artifact.png'],
    16,
  );

  assert.deepEqual(submitted, [
    '/generated/master.png',
    '/generated/hook.png',
    '/user/artifact.png',
  ]);
  assert.ok(!submitted.includes('/internal/video-still.jpg'));
});
