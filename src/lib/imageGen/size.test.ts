import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGptImage2Size, normalizeSeedreamProSize, fitSeedreamProPixelSize } from './size.ts';

test('GPT Image 2 auto size follows the requested aspect ratio', () => {
  assert.equal(normalizeGptImage2Size('auto', '16:9'), '2048x1152');
  assert.equal(normalizeGptImage2Size('auto', '9:16'), '1152x2048');
  assert.equal(normalizeGptImage2Size(undefined, '4:3'), '1536x1152');
  assert.equal(normalizeGptImage2Size(undefined, '1:1'), '1024x1024');
});

test('GPT Image 2 preserves an explicit supported pixel size', () => {
  assert.equal(normalizeGptImage2Size('3840x2160', '1:1'), '3840x2160');
});

test('Seedream maps ratio and resolution independently', () => {
  assert.equal(normalizeSeedreamProSize('auto', '9:16', '2k'), '1584x2816');
  assert.equal(normalizeSeedreamProSize('auto', '21:9', '4k'), '4096x1760');
});

test('fitSeedreamProPixelSize keeps in-cap sizes untouched', () => {
  assert.equal(fitSeedreamProPixelSize('2048x2048'), '2048x2048');
  assert.equal(fitSeedreamProPixelSize('2816x1584', { maxPixels: 5_000_000 }), '2816x1584');
  assert.equal(fitSeedreamProPixelSize('auto'), 'auto');
});

test('fitSeedreamProPixelSize mildly shrinks mild over-cap sizes (never over-shrinks)', () => {
  // 2816x1584 = 4.46M px, scale ≈ 0.97 → 轻度缩小保留像素尺寸
  const fitted = fitSeedreamProPixelSize('2816x1584');
  assert.ok(fitted);
  const [w, h] = fitted!.split('x').map(Number);
  assert.ok(w * h <= 4194304);
  assert.ok(w > 2600 && h > 1400, `expected near-original size, got ${fitted}`);
});

test('fitSeedreamProPixelSize returns null when shrink would be too aggressive', () => {
  // 4096x4096 = 16.8M px, scale = 0.5 → 缩太狠，退档位而不是交出小图
  assert.equal(fitSeedreamProPixelSize('4096x4096'), null);
  assert.equal(fitSeedreamProPixelSize('4096x1760', { minScale: 0.8 }), null);
});
