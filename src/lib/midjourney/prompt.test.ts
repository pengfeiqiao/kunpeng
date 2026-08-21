import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildApimartMidjourneyPrompt,
  isMidjourneyEngineId,
  midjourneyProviderOrder,
  normalizeMidjourneyVersion,
} from './prompt.ts';

test('normalizes supported Midjourney aliases and keeps v8.2 as the production default', () => {
  assert.equal(normalizeMidjourneyVersion('8.2'), 'v8.2');
  assert.equal(normalizeMidjourneyVersion('niji-7'), 'niji7');
  assert.equal(normalizeMidjourneyVersion('unknown'), 'v8.2');
});

test('recognizes canvas Midjourney aliases before generic engine validation', () => {
  assert.equal(isMidjourneyEngineId('midjourney-v82'), true);
  assert.equal(isMidjourneyEngineId('midjourney-v8.2'), true);
  assert.equal(isMidjourneyEngineId('midjourney-v81'), true);
  assert.equal(isMidjourneyEngineId('gpt-image-2'), false);
});

test('uses APIMart as the primary Midjourney provider for every version', () => {
  assert.deepEqual(midjourneyProviderOrder('v8.2'), ['apimart']);
  assert.deepEqual(midjourneyProviderOrder('v8.1'), ['apimart']);
  assert.deepEqual(midjourneyProviderOrder('v7'), ['apimart']);
  assert.deepEqual(midjourneyProviderOrder('niji7'), ['apimart']);
});

test('reference images stay ahead of prompt content and controlled flags are replaced', () => {
  const prompt = buildApimartMidjourneyPrompt({
    prompt: 'cinematic portrait --v 6.1 --ar 1:1 --stylize 20',
    version: 'v8.2',
    aspectRatio: '16:9',
    stylize: 350,
    chaos: 120,
    raw: true,
    quality: 1,
  }, ['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png']);

  assert.equal(
    prompt,
    'https://cdn.example.com/a.png https://cdn.example.com/b.png cinematic portrait --v 8.2 --ar 16:9 --stylize 350 --chaos 100 --style raw',
  );
});

test('v8.1 keeps quality and image references can carry an explicit weight', () => {
  const prompt = buildApimartMidjourneyPrompt({
    prompt: 'weathered machine',
    version: 'v8.1',
    quality: 1,
    imageWeight: 1.25,
  }, ['https://cdn.example.com/ref.png']);
  assert.equal(prompt, 'https://cdn.example.com/ref.png weathered machine --v 8.1 --q 1 --iw 1.25');
});

test('niji versions use the niji flag without also adding a v flag', () => {
  const prompt = buildApimartMidjourneyPrompt({ prompt: 'anime key visual', version: 'niji6' });
  assert.equal(prompt, 'anime key visual --niji 6');
  assert.equal(prompt.includes('--v'), false);
});
