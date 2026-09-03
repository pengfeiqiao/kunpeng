import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDoubaoSpeechRoutingNotice,
  isConflictingDoubaoSpeechGenerationTool,
  isExplicitDoubaoSpeechGenerationRequest,
  shouldRequireDoubaoSpeechToolCall,
} from './speechIntent.ts';

test('recognizes an explicit Doubao dubbing execution request', () => {
  assert.equal(isExplicitDoubaoSpeechGenerationRequest('请用豆包配音念这句：你好世界'), true);
  assert.match(buildDoubaoSpeechRoutingNotice('帮我用豆包生成旁白') ?? '', /doubao_speech_generate/);
});

test('does not turn API questions into paid generation calls', () => {
  assert.equal(isExplicitDoubaoSpeechGenerationRequest('豆包配音 API 怎么调用？'), false);
  assert.equal(buildDoubaoSpeechRoutingNotice('请修复豆包配音的调用代码'), null);
});

test('requires the tool only when the requested utterance is available', () => {
  assert.equal(shouldRequireDoubaoSpeechToolCall('请用豆包配音：你好世界'), true);
  assert.equal(shouldRequireDoubaoSpeechToolCall('请用豆包配音朗读上面这段文字'), true);
  assert.equal(shouldRequireDoubaoSpeechToolCall('帮我用豆包生成旁白'), false);
});

test('blocks competing generation models but allows Seed-Audio tools', () => {
  assert.equal(isConflictingDoubaoSpeechGenerationTool('video_generate'), true);
  assert.equal(isConflictingDoubaoSpeechGenerationTool('canvas_generate'), true);
  assert.equal(isConflictingDoubaoSpeechGenerationTool('doubao_speech_generate'), false);
  assert.equal(isConflictingDoubaoSpeechGenerationTool('workshop_generate_audio'), false);
});
