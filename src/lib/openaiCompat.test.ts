import test from 'node:test';
import assert from 'node:assert/strict';
import { chatCompletionsCandidates } from './openaiCompat.ts';

test('chatCompletionsCandidates keeps a full endpoint as-is', () => {
  assert.deepEqual(
    chatCompletionsCandidates('https://api.example.com/v1/chat/completions'),
    ['https://api.example.com/v1/chat/completions'],
  );
});

test('chatCompletionsCandidates completes /v1 and host-only bases with 404 fallback order', () => {
  assert.deepEqual(
    chatCompletionsCandidates('https://www.dmxapi.cn/v1'),
    ['https://www.dmxapi.cn/v1/chat/completions', 'https://www.dmxapi.cn/chat/completions'],
  );
  assert.deepEqual(
    chatCompletionsCandidates('https://api.perplexity.ai'),
    ['https://api.perplexity.ai/v1/chat/completions', 'https://api.perplexity.ai/chat/completions'],
  );
  assert.deepEqual(
    chatCompletionsCandidates('https://www.dmxapi.cn/'),
    ['https://www.dmxapi.cn/v1/chat/completions', 'https://www.dmxapi.cn/chat/completions'],
  );
});

test('chatCompletionsCandidates rejects empty input', () => {
  assert.deepEqual(chatCompletionsCandidates(''), []);
  assert.deepEqual(chatCompletionsCandidates('   '), []);
});
