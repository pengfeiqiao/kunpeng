import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCopywritingTaskHarness, buildEditorialJudgmentTurnContext, COPYWRITING_EDITORIAL_JUDGMENT } from './antiAiStyle.ts';

test('editorial judgment covers selection, character intent, restructuring and deletion', () => {
  assert.match(COPYWRITING_EDITORIAL_JUDGMENT, /至少两个有实质差异的进入角度/);
  assert.match(COPYWRITING_EDITORIAL_JUDGMENT, /害怕暴露什么/);
  assert.match(COPYWRITING_EDITORIAL_JUDGMENT, /规则是诊断工具，不是自动改写命令/);
  assert.match(COPYWRITING_EDITORIAL_JUDGMENT, /先重画内容骨架/);
  assert.match(COPYWRITING_EDITORIAL_JUDGMENT, /贡献测试/);
});

test('ordinary chat receives judgment only for actual writing intent', () => {
  assert.match(buildEditorialJudgmentTurnContext('帮我重写这段人物对白'), /主笔判断/);
  assert.match(buildEditorialJudgmentTurnContext('给这个广告找一个更好的创意切口'), /主笔判断/);
  assert.equal(buildEditorialJudgmentTurnContext('检查视频为什么播放卡顿'), '');
  assert.equal(buildEditorialJudgmentTurnContext('[用户正在鲲鹏文案工作室]\n用户请求：\n改写文案'), '');
});

test('judgment is shared by ordinary copy, ads and screenwriting without exposing reasoning', () => {
  for (const task of ['写一篇品牌文案', '修改人物对白', '重写这篇散文']) {
    const prompt = buildCopywritingTaskHarness(task);
    assert.match(prompt, /主笔判断：选择、理解、重构与删改/);
    assert.match(prompt, /不要把内部候选、心理推演、规则裁决或删改清单写进最终成稿/);
  }
});
