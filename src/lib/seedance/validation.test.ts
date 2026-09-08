import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSeedancePrompt } from './validation.ts';

const MOVE_WARNING = '多种运镜';
const hasMoveWarning = (prompt: string) => validateSeedancePrompt(prompt, { allowVideoRefs: true })
  .warnings.some((warning) => warning.includes(MOVE_WARNING));

test('正常措辞（焦点移到/视线切入/推移/推荐/拉近关系）不触发多运镜告警', () => {
  const prompt = [
    '镜头1-1 5s [近景] 焦点移到桌面上的信，人物视线切入门口',
    '镜头1-2 5s [全景] 时间推移，天色渐暗下来',
    '镜头1-3 5s [特写] 他推荐了一本书，两人的关系悄然拉近',
  ].join('\n');
  assert.equal(hasMoveWarning(prompt), false);
});

test('同一镜头行出现两个不同运镜词才告警；同一个词复用不告警', () => {
  assert.equal(hasMoveWarning('镜头1-1 8s [近景] 缓慢推近，继续推近到眼神'), false);
  assert.equal(hasMoveWarning('镜头1-1 8s [近景] 推近之后镜头拉远，露出整个房间'), true);
  assert.equal(hasMoveWarning('镜头1-1 8s [全景] 横移跟拍，随后环绕到人物正面'), true);
});

test('不同镜头行各自的运镜不互相累计', () => {
  const prompt = [
    '镜头1-1 4s [近景] 推近到人物脸部',
    '镜头1-2 4s [全景] 镜头拉远',
  ].join('\n');
  assert.equal(hasMoveWarning(prompt), false);
});
