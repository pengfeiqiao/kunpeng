import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGptImage2Size, normalizeSeedreamProSize } from './size.ts';

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
