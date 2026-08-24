import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_DRAMA_BAN,
  findAiDramaPerformanceHits,
  PERFORMANCE_GUIDE,
} from './performance.ts';
import { buildAutoRunPrompt, buildOptimizeShotPrompt, buildShotPromptsPrompt } from '../workshop/workshopPrompts.ts';

test('performance guide covers layering timeline and behavior purpose', () => {
  assert.match(PERFORMANCE_GUIDE, /触发期/);
  assert.match(PERFORMANCE_GUIDE, /发酵期/);
  assert.match(PERFORMANCE_GUIDE, /释放期/);
  assert.match(PERFORMANCE_GUIDE, /开关式瞬变/);
  assert.match(PERFORMANCE_GUIDE, /行为目的/);
  assert.match(PERFORMANCE_GUIDE, /性格锚点/);
});

test('AI drama ban lists the exaggerated-performance tells', () => {
  for (const term of ['瞪眼', '嘶吼', '嚎啕大哭', '开关式情绪瞬变', '邪魅', '暴跳如雷']) {
    assert.ok(AI_DRAMA_BAN.includes(term), `AI_DRAMA_BAN should mention ${term}`);
  }
  assert.match(AI_DRAMA_BAN, /除非用户明确要求/);
});

test('findAiDramaPerformanceHits flags drama-style wording only', () => {
  assert.deepEqual(findAiDramaPerformanceHits('陈墨瞪眼嘶吼，暴跳如雷'), ['瞪眼', '嘶吼', '暴跳如雷']);
  assert.deepEqual(findAiDramaPerformanceHits('眼眶泛红，泪珠在眼眶聚集未落，下唇被牙齿轻咬'), []);
  assert.deepEqual(findAiDramaPerformanceHits(undefined), []);
  assert.deepEqual(findAiDramaPerformanceHits(''), []);
});

test('workshop prompt builders carry the performance brief', () => {
  for (const prompt of [buildShotPromptsPrompt(), buildShotPromptsPrompt('', 'universal'), buildOptimizeShotPrompt('1'), buildAutoRunPrompt()]) {
    assert.ok(prompt.includes('触发→发酵→释放'), 'builder output should include the performance layering rule');
    assert.ok(prompt.includes('行为目的'), 'builder output should include the behavior-purpose rule');
    assert.ok(prompt.includes('AI 短剧/漫剧风'), 'builder output should include the AI-drama ban');
  }
});
