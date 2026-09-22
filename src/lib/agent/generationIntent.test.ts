import test from 'node:test';
import assert from 'node:assert/strict';
import { isPromptOnlyRequest } from './generationIntent.ts';
test('prompt editing is distinct from explicitly requested media generation', () => {
  for (const request of ['只改提示词，不要生成', '帮我优化视频提示词', '生成一段提示词', '不要直接提交生成，先检查提示词', '只完善音色描述']) assert.equal(isPromptOnlyRequest(request), true, request);
  for (const request of ['修改提示词然后生成视频', '用这个提示词生成一张图片', '直接生成', '生成视频，不要生成字幕']) assert.equal(isPromptOnlyRequest(request), false, request);
  assert.equal(isPromptOnlyRequest('孩子语气再激动一些', true), true);
  assert.equal(isPromptOnlyRequest('重新配音', true), false);
  assert.equal(isPromptOnlyRequest('提示词可以了，生成吧', true), false);
});
