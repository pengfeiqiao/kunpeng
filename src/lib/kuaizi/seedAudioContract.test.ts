import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSeedAudioPayload } from './seedAudioContract.ts';

test('builds the documented Seed-Audio snake_case payload', () => {
  assert.deepEqual(buildSeedAudioPayload({
    text: '大家好',
    referenceAudioUrls: ['https://example.com/ref.wav'],
    format: 'mp3',
    sampleRate: 24000,
    speed: 1,
    volume: 1,
    pitch: 0,
  }), {
    text: '参考录音1：大家好',
    references: [{ audio_url: 'https://example.com/ref.wav' }],
    options: { format: 'mp3', sample_rate: 24000, speed: 1, volume: 1, pitch: 0 },
  });
});

test('preserves explicit multi-speaker labels', () => {
  const payload = buildSeedAudioPayload({
    text: '参考录音1：你好\n参考录音2：你好',
    referenceAudioUrls: ['https://example.com/1.wav', 'https://example.com/2.wav'],
  });
  assert.equal(payload.text, '参考录音1：你好\n参考录音2：你好');
  assert.equal(payload.references.length, 2);
});

test('rejects missing, excessive, and non-http references before a paid call', () => {
  assert.throws(() => buildSeedAudioPayload({ text: '你好', referenceAudioUrls: [] }), /1-10/);
  assert.throws(() => buildSeedAudioPayload({
    text: '你好',
    referenceAudioUrls: Array.from({ length: 11 }, (_, i) => `https://example.com/${i}.wav`),
  }), /11 条/);
  assert.throws(() => buildSeedAudioPayload({ text: '你好', referenceAudioUrls: ['/tmp/ref.wav'] }), /HTTP\(S\)/);
});

test('enforces the final labelled text length', () => {
  assert.throws(() => buildSeedAudioPayload({
    text: 'a'.repeat(4096),
    referenceAudioUrls: ['https://example.com/ref.wav'],
  }), /上限 4096/);
});
