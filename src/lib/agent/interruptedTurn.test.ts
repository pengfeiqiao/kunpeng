import test from 'node:test';
import assert from 'node:assert/strict';
import { appendInterruptedTurnCheckpoint, buildInterruptedResumeContext } from './interruptedTurn.ts';

test('interrupted harness turn keeps the active user request and a resumable closer', () => {
  const result = appendInterruptedTurnCheckpoint([], {
    userRequest: '分析所有素材并生成分镜',
    partialAssistant: '已读取两个文件',
    tools: [{ toolName: 'workshop_generate', status: 'running' }],
  });
  assert.equal(result[0]?.role, 'user');
  assert.match(String(result[1]?.content), /结果未知/);
  assert.match(String(result[1]?.content), /不得盲目重试/);
});

test('checkpoint does not duplicate a user request already in coordinator history', () => {
  const result = appendInterruptedTurnCheckpoint([{ role: 'user', content: '继续这个任务' }], {
    userRequest: '继续这个任务',
  });
  assert.equal(result.filter((message) => message.role === 'user').length, 1);
});

test('resume context carries attachments, completed tools and unfinished todos', () => {
  const context = buildInterruptedResumeContext({
    userRequest: '做完影片', filePaths: ['/tmp/a.mp4'], unfinishedTodos: ['导出'],
    tools: [{ toolName: 'read_file', status: 'completed', result: { success: true, output: '已读取' } }],
  });
  assert.match(context, /\/tmp\/a\.mp4/);
  assert.match(context, /\[已完成\] read_file/);
  assert.match(context, /导出/);
});
