import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadCompletedLabel, downloadProgressLabel } from './downloadLabels.ts';

test('download progress labels are explicit for every media kind', () => {
  assert.equal(downloadProgressLabel('image'), '下载图片中…');
  assert.equal(downloadProgressLabel('video'), '下载视频中…');
  assert.equal(downloadProgressLabel('audio'), '下载音频中…');
  assert.equal(downloadCompletedLabel('image'), '图片下载完成');
  assert.equal(downloadCompletedLabel('video'), '视频下载完成');
  assert.equal(downloadCompletedLabel('audio'), '音频下载完成');
});
