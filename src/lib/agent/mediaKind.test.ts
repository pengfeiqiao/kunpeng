import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isImageMediaPath,
  isVideoMediaPath,
  requiresNativeImageConversion,
} from './mediaKind.ts';

test('HEIC and HEIF attachments are native image candidates', () => {
  assert.equal(isImageMediaPath('/Users/test/IMG_4749.HEIC'), true);
  assert.equal(isImageMediaPath('file:///Users/test/photo.heif?source=picker'), true);
  assert.equal(requiresNativeImageConversion('/Users/test/IMG_4749.HEIC'), true);
});

test('standard image, video and data URLs are classified without overlap', () => {
  assert.equal(isImageMediaPath('data:image/png;base64,aGVsbG8='), true);
  assert.equal(isVideoMediaPath('data:video/mp4;base64,aGVsbG8='), true);
  assert.equal(isImageMediaPath('/tmp/clip.MP4'), false);
  assert.equal(isVideoMediaPath('/tmp/clip.MP4'), true);
});
