import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPipelineStagePrefix, detectPipelineStage, resolveTodoAwareMaxTurns } from './pipelineStages.ts';

test('detects representative pipeline stages conservatively', () => {
  assert.equal(detectPipelineStage('写一个 30 秒科技短片剧本')?.id, 'script');
  assert.equal(detectPipelineStage('把这个剧本拆成八个分镜')?.id, 'storyboard');
  assert.equal(detectPipelineStage('生成一张城市夜景概念图')?.id, 'image');
  assert.equal(detectPipelineStage('用参考图生成一段 10 秒视频')?.id, 'video');
  assert.equal(detectPipelineStage('把三个视频片段剪成完整成片')?.id, 'edit');
  assert.equal(detectPipelineStage('给这段旁白做豆包配音')?.id, 'voice');
  assert.equal(detectPipelineStage('先把现有剧本润色一下')?.id, 'script');
});

test('specific action beats a generic stage noun', () => {
  assert.equal(detectPipelineStage('根据剧本制作一套故事板')?.id, 'storyboard');
  assert.equal(detectPipelineStage('把分镜图做成视频')?.id, 'video');
});

test('ordinary small talk has no stage prefix', () => {
  assert.equal(buildPipelineStagePrefix('你好，今天怎么样'), null);
});

test('coding contexts do not hit the script stage', () => {
  // 「脚本」在编码语境里指 script 文件，不是剧本——裸词命中曾把剧本卡注入编码任务。
  assert.equal(buildPipelineStagePrefix('帮我改一下这个 python 脚本'), null);
  assert.equal(buildPipelineStagePrefix('这个 shell 脚本报错了，帮我修'), null);
  assert.equal(detectPipelineStage('写一个自动化部署脚本'), null);
  assert.equal(detectPipelineStage('写一个广告自动化部署脚本'), null);
  assert.equal(detectPipelineStage('写一个广告投放数据清洗脚本'), null);
  assert.equal(detectPipelineStage('写一个 30 秒广告片')?.id, 'script');
});

test('stage prefix names its entry tool', () => {
  const prefix = buildPipelineStagePrefix('请生成一张场景概念图');
  assert.match(prefix ?? '', /image_generate/);
  assert.match(prefix ?? '', /剧本 → 分镜 → 生图 → 生视频 → 剪辑 → 配音/);
});

test('todo-aware max turns only expands unfinished runs', () => {
  assert.equal(resolveTodoAwareMaxTurns(undefined, false), 30);
  assert.equal(resolveTodoAwareMaxTurns(30, true), 60);
  assert.equal(resolveTodoAwareMaxTurns(80, true), 80);
});

test('cross-stage request advances from script to storyboard to image using run state', () => {
  const request = '写一个 30 秒短片剧本，然后拆成分镜并生成 1 张分镜图';
  assert.equal(detectPipelineStage(request)?.id, 'script');
  assert.equal(detectPipelineStage(request, {
    completedTools: ['skill_invoke', 'write_file'],
  })?.id, 'storyboard');
  assert.equal(detectPipelineStage(request, {
    completedTools: ['skill_invoke', 'write_file', 'workshop_get_state', 'storyboard_list_targets'],
  })?.id, 'image');
  assert.match(buildPipelineStagePrefix(request) ?? '', /先用 todo_write/);
});
