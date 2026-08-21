import test from 'node:test';
import assert from 'node:assert/strict';
import {
  apimartTaskId,
  buildApimartMinimaxH3Payload,
  buildApimartSeedreamPayload,
  parseApimartTask,
} from './contracts.ts';

test('parses APIMart async receipt and Seedream success response', () => {
  assert.equal(apimartTaskId({ code: 200, data: [{ status: 'submitted', task_id: 'task-1' }] }), 'task-1');
  const state = parseApimartTask({
    data: { status: 'success', progress: 100, result: { images: [{ url: ['https://cdn.test/result.png'] }] } },
  }, 'image');
  assert.deepEqual(state, { status: 'succeeded', progress: 100, urls: ['https://cdn.test/result.png'] });
});

test('keeps signed result URLs even when they have no file extension', () => {
  const state = parseApimartTask({
    code: 200,
    data: {
      status: 'completed',
      result: { videos: [{ url: ['https://cdn.test/download?token=signed'] }] },
    },
  }, 'video');
  assert.deepEqual(state, {
    status: 'succeeded', progress: 100, urls: ['https://cdn.test/download?token=signed'],
  });
});

test('builds Seedream 5 Pro single-image payload with references', () => {
  assert.deepEqual(buildApimartSeedreamPayload({
    prompt: 'test', imageUrls: ['data:image/png;base64,AA=='], aspectRatio: '16:9', resolution: '2k', outputFormat: 'png',
  }), {
    model: 'seedream-5-0-pro', prompt: 'test', n: 1, resolution: '2K', size: '16:9', output_format: 'png', watermark: false,
    image_urls: ['data:image/png;base64,AA=='],
  });
});

test('builds H3 multimodal payload and rejects audio-only input', () => {
  assert.deepEqual(buildApimartMinimaxH3Payload({
    prompt: 'test', imageUrls: ['https://cdn.test/a.png'], videoUrls: ['https://cdn.test/a.mp4'],
    audioUrls: ['https://cdn.test/a.mp3'], duration: 15, resolution: '2K', aspectRatio: '9:16',
  }), {
    model: 'MiniMax-H3', prompt: 'test', duration: 15, resolution: '2K', aspect_ratio: '9:16',
    image_urls: ['https://cdn.test/a.png'], video_urls: ['https://cdn.test/a.mp4'], audio_urls: ['https://cdn.test/a.mp3'],
  });
  assert.throws(() => buildApimartMinimaxH3Payload({ prompt: 'test', audioUrls: ['https://cdn.test/a.mp3'] }), /不能只传音频/);
  assert.throws(() => buildApimartMinimaxH3Payload({
    prompt: 'test', imageUrls: Array.from({ length: 10 }, (_, index) => `https://cdn.test/${index}.png`),
  }), /最多支持 9 张/);
  assert.throws(() => buildApimartSeedreamPayload({
    prompt: 'test', imageUrls: Array.from({ length: 11 }, (_, index) => `https://cdn.test/${index}.png`),
  }), /最多支持 10 张/);
});
