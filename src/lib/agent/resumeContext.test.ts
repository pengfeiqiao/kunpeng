import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTaskResumeContext, extractResumeArtifactPaths, TaskResumeContextQueue } from './resumeContext.ts';

test('restored context includes unfinished todos and artifact paths', () => {
  const context = buildTaskResumeContext({
    todos: [
      { content: '生成第一张分镜图', status: 'in_progress' },
      { content: '已写剧本', status: 'completed' },
    ],
    agentMessages: [{ role: 'tool', content: '文件：/Users/demo/work/shot-01.png' }],
    uiMessages: [{ metadata: { toolExecutions: [{ result: { output: '视频：/tmp/final.mp4' } }] } }],
  });
  assert.match(context ?? '', /生成第一张分镜图/);
  assert.doesNotMatch(context ?? '', /已写剧本/);
  assert.match(context ?? '', /\/Users\/demo\/work\/shot-01\.png/);
  assert.match(context ?? '', /\/tmp\/final\.mp4/);
  assert.match(context ?? '', /不要重复已完成或已付费/);
});

test('resume context is consumed once per session without cross-session leakage', () => {
  const queue = new TaskResumeContextQueue();
  queue.stage('a', 'continue a');
  queue.stage('b', 'continue b');
  assert.equal(queue.consume('a'), 'continue a');
  assert.equal(queue.consume('a'), null);
  assert.equal(queue.consume('b'), 'continue b');
});

test('undelivered resume context can be restored without replacing newer state', () => {
  const queue = new TaskResumeContextQueue();
  queue.stage('a', 'original context');
  const consumed = queue.consume('a');
  queue.restore('a', consumed);
  assert.equal(queue.consume('a'), 'original context');

  queue.stage('a', 'newer context');
  queue.restore('a', 'stale context');
  assert.equal(queue.consume('a'), 'newer context');
});

test('artifact extraction is unique and empty sessions add no context', () => {
  assert.deepEqual(extractResumeArtifactPaths([
    { output: '文件：/tmp/a.png' },
    { output: '文件：/tmp/a.png' },
  ]), ['/tmp/a.png']);
  assert.equal(buildTaskResumeContext({ todos: [], agentMessages: [], uiMessages: [] }), null);
});
