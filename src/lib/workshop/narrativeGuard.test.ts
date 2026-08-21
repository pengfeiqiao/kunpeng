import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyWorkshopEditScope,
  findUnsupportedPromptDialogue,
  findUnsupportedRelationshipClaims,
} from './narrativeGuard.ts';

test('prompt edits do not acquire story-edit permission from negated wording', () => {
  assert.equal(classifyWorkshopEditScope('帮我优化视频提示词，不要改剧本和台词'), 'prompts');
});

test('explicit script and dialogue requests acquire story-edit permission', () => {
  assert.equal(classifyWorkshopEditScope('修改剧本，把巫史的台词改成今晚出发'), 'story');
  assert.equal(classifyWorkshopEditScope('让姮氏回答“我明白了”'), 'story');
});

test('shot restructuring is separate from story editing', () => {
  assert.equal(classifyWorkshopEditScope('重新调整分镜结构，把第 3 镜拆成两镜'), 'shots');
  assert.equal(classifyWorkshopEditScope('重新拆解一下剧本'), 'unknown');
});

test('prompt dialogue must be supported by the canonical shot dialogue', () => {
  assert.deepEqual(findUnsupportedPromptDialogue({
    videoPrompt: '巫史低声说：“今晚出发。”',
    canonicalDialogue: '今晚出发。',
  }), []);

  assert.deepEqual(findUnsupportedPromptDialogue({
    videoPrompt: '巫史低声说：“明天攻城。”',
    canonicalDialogue: '今晚出发。',
  }), ['明天攻城。']);
});

test('audio prompt dialogue is checked against the same canonical evidence', () => {
  assert.deepEqual(findUnsupportedPromptDialogue({
    audioPrompts: [{ prompt: '沉稳男声念出：“不要回头。”' }],
    canonicalDialogue: '继续向前。',
  }), ['不要回头。']);
});

test('cinematic detail may expand while unsupported relationships are blocked', () => {
  assert.deepEqual(findUnsupportedRelationshipClaims({
    prompts: ['暖色侧光下，两人隔桌对视，父亲缓慢收紧手指。'],
    canonicalFacts: '巫史与姮氏隔桌对视。',
  }), ['父亲']);
  assert.deepEqual(findUnsupportedRelationshipClaims({
    prompts: ['暖色侧光下，父亲缓慢收紧手指。'],
    canonicalFacts: '父亲坐在桌边。',
  }), []);
});
