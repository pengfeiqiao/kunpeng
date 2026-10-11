import { getEngineFormula } from '../aigc/promptTemplate.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveVideoPromptTemplate, readGlobalVideoPromptTemplate, VIDEO_PROMPT_DRAFTING_POLICY } from './template.ts';
import { buildSystemPrompt } from '../agent/systemPrompt.ts';
import { DIALOGUE_DIRECTION_GUIDE } from './performance.ts';

test('new and invalid preferences use universal; explicit legacy is preserved', () => {
  for (const value of [undefined, null, '', 'universal', 'stale']) assert.equal(resolveVideoPromptTemplate(value), 'universal');
  assert.equal(resolveVideoPromptTemplate('legacy'), 'legacy');
  assert.equal(readGlobalVideoPromptTemplate(), 'universal');
});
test('browser preference and denied local storage are handled without overwriting a user selection', () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'window');
  try {
    for (const value of ['legacy', 'universal', null]) {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: {localStorage: {getItem: () => value}} });
      assert.equal(readGlobalVideoPromptTemplate(), value === 'legacy' ? 'legacy' : 'universal');
    }
    Object.defineProperty(globalThis, 'window', { configurable: true, get() { throw Error('blocked'); } });
    assert.equal(readGlobalVideoPromptTemplate(), 'universal');
  } finally {
    if (prior) Object.defineProperty(globalThis, 'window', prior);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
test('all agent providers receive current drafting and dialogue direction without changing model selection', () => {
  for (const primaryProviderId of ['deepseek', 'kimi', 'gpt']) {
    const prompt = buildSystemPrompt({cwd:'/workspace',os:'macOS',shell:'zsh',primaryProviderId});
    assert.ok(prompt.includes(VIDEO_PROMPT_DRAFTING_POLICY));
    assert.ok(prompt.includes(DIALOGUE_DIRECTION_GUIDE));
  }
});

test('prompt optimizer uses the same current format policy as ordinary chat', () => {
  assert.ok(getEngineFormula('seedance').includes(VIDEO_PROMPT_DRAFTING_POLICY));
  assert.ok(!getEngineFormula('midjourney').includes(VIDEO_PROMPT_DRAFTING_POLICY));
});
