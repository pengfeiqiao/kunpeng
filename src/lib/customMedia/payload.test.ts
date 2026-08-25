import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCustomImagePayload,
  buildCustomVideoPayload,
  customSubmitPath,
  customTaskPath,
  normalizeCustomBaseUrl,
  parseCustomTaskId,
  parseOpenaiImagesResponse,
} from './payload.ts';

test('submit/task paths follow the protocol and kind', () => {
  assert.equal(customSubmitPath({ kind: 'image', protocol: 'openai-images' }), '/v1/images/generations');
  assert.equal(customSubmitPath({ kind: 'image', protocol: 'apimart-async' }), '/v1/images/generations');
  assert.equal(customSubmitPath({ kind: 'video', protocol: 'apimart-async' }), '/v1/videos/generations');
  assert.equal(customTaskPath('task_abc'), '/v1/tasks/task_abc');
  assert.equal(normalizeCustomBaseUrl('https://a.com///'), 'https://a.com');
});

test('custom image payload carries model_id, size clamp and refs', () => {
  const p = buildCustomImagePayload({ modelId: 'my-image-model' }, {
    prompt: '一只猫',
    imageUrls: ['https://a/1.png'],
    aspectRatio: '16:9',
    resolution: '2k',
  });
  assert.equal(p.model, 'my-image-model');
  assert.equal(p.size, '16:9');
  assert.equal(p.resolution, '2k');
  assert.deepEqual(p.image_urls, ['https://a/1.png']);
  const weird = buildCustomImagePayload({ modelId: 'm' }, { prompt: 'x', aspectRatio: '7:3' });
  assert.equal(weird.size, 'auto');
  assert.equal(weird.resolution, undefined);
});

test('custom video payload clamps duration and normalizes ratio', () => {
  const p = buildCustomVideoPayload({ modelId: 'my-video-model' }, {
    prompt: '猫在跑',
    duration: 99,
    resolution: '1080P',
    aspectRatio: '21:9',
    videoUrls: ['https://a/v.mp4'],
  });
  assert.equal(p.model, 'my-video-model');
  assert.equal(p.duration, 30);
  assert.equal(p.resolution, '1080P');
  assert.equal(p.size, '21:9');
  assert.deepEqual(p.video_urls, ['https://a/v.mp4']);
  const def = buildCustomVideoPayload({ modelId: 'm' }, { prompt: 'x', aspectRatio: '3:2' });
  assert.equal(def.size, 'adaptive');
  assert.equal(def.duration, 5);
});

test('parseOpenaiImagesResponse reads b64_json and url', () => {
  assert.deepEqual(parseOpenaiImagesResponse({ data: [{ b64_json: 'QUJD' }] }), { b64: 'QUJD', url: undefined });
  assert.deepEqual(parseOpenaiImagesResponse({ data: [{ url: 'https://a/1.png' }] }), { b64: undefined, url: 'https://a/1.png' });
  assert.deepEqual(parseOpenaiImagesResponse({}), { b64: undefined, url: undefined });
});

test('parseCustomTaskId handles all response shapes', () => {
  assert.equal(parseCustomTaskId({ code: 200, data: [{ task_id: 'task_1' }] }), 'task_1');
  assert.equal(parseCustomTaskId({ data: { task_id: 'task_2' } }), 'task_2');
  assert.equal(parseCustomTaskId({ data: { id: 'task_3' } }), 'task_3');
  assert.equal(parseCustomTaskId({ task_id: 'task_4' }), 'task_4');
  assert.equal(parseCustomTaskId({ code: 400 }), '');
});
