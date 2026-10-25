import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCanvasDreaminaVideoRequest } from './dreaminaVideoRequest.ts';

test('canvas Dreamina keeps prompt byte-for-byte and selects dedicated 2.0 route', () => {
  const prompt = '  第一行\n\n@图片1 保持原样。  ';
  const request = buildCanvasDreaminaVideoRequest({ version: 'seedance-2.0', prompt, resolution: '720p', ratio: '16:9', duration: 5 });
  assert.equal(request.prompt, prompt);
  assert.equal(request.engineId, 'dreamina-direct-seedance-2.0');
  assert.equal(request.params.verbatimPrompt, true);
});

test('canvas Dreamina 2.5 uses its dedicated route instead of the shared Kuaizi-first route', () => {
  const request = buildCanvasDreaminaVideoRequest({ version: 'seedance-2.5', prompt: '原文', resolution: '1080p', ratio: '9:16', duration: 12 });
  assert.equal(request.engineId, 'dreamina-direct-seedance-2.5');
  assert.notEqual(request.engineId, 'dreamina-seedance-2.5');
});
