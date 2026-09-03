import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasUsableCompletionText,
  isTruncatedFinishReason,
  mergePromptContinuation,
  terminalToolResults,
} from './completionGuard.ts';

test('recognizes Anthropic and OpenAI truncation finish reasons', () => {
  assert.equal(isTruncatedFinishReason('max_tokens'), true);
  assert.equal(isTruncatedFinishReason('max_output_tokens'), true);
  assert.equal(isTruncatedFinishReason('length'), true);
  assert.equal(isTruncatedFinishReason('end_turn'), false);
  assert.equal(isTruncatedFinishReason('stop'), false);
});

test('prompt rewrite output must contain non-whitespace text', () => {
  assert.equal(hasUsableCompletionText('优化后的提示词'), true);
  assert.equal(hasUsableCompletionText('  \n\t'), false);
  assert.equal(hasUsableCompletionText(''), false);
  assert.equal(hasUsableCompletionText(undefined), false);
});

test('merges repeated continuation overlap without losing content', () => {
  assert.equal(
    mergePromptContinuation('镜头推近人物的面部', '人物的面部，随后切到手部特写。'),
    '镜头推近人物的面部，随后切到手部特写。',
  );
});

test('joins a continuation that starts exactly at the cut point', () => {
  assert.equal(
    mergePromptContinuation('镜头从门外缓慢', '推进室内。'),
    '镜头从门外缓慢推进室内。',
  );
});

test('terminal tool failures stop another model turn unless the user sent guidance', () => {
  const paidFailure = { success: false, terminal: true, terminalMessage: '请核对任务' };
  assert.deepEqual(terminalToolResults([paidFailure], false), [paidFailure]);
  assert.deepEqual(terminalToolResults([paidFailure], true), []);
});
