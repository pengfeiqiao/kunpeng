import test from 'node:test';
import assert from 'node:assert/strict';
import { agentDelegateTool, normalizeDelegateRequest } from './agentDelegateTool.ts';

test('delegate request validates task, groups and timeout bounds', () => {
  assert.throws(() => normalizeDelegateRequest({ task: '   ' }), /非空 task/);
  assert.deepEqual(normalizeDelegateRequest({
    task: '  analyze  ',
    context: '  /tmp/a.md  ',
    tool_groups: ['read', 'read', 'unknown', 'web'],
    timeout_sec: 9_999,
  }), {
    task: 'analyze',
    context: '/tmp/a.md',
    toolGroups: ['read', 'web'],
    timeoutSec: 1800,
  });
  assert.equal(normalizeDelegateRequest({ task: 'x', timeout_sec: -3 }).timeoutSec, 1);
});

test('subagent depth guard prevents recursive delegation even with a delegate callback', async () => {
  let called = false;
  const result = await agentDelegateTool.execute({ task: 'nested' }, undefined, {
    runId: 'parent/sub-1',
    subagentDepth: 1,
    delegate: async () => {
      called = true;
      return { status: 'completed', runId: 'bad', conclusion: '', artifacts: [] };
    },
  });
  assert.equal(result.success, false);
  assert.equal(called, false);
  assert.match(result.error ?? '', /深度上限为 1/);
});

test('delegate tool returns the child conclusion, artifacts and terminal status', async () => {
  const result = await agentDelegateTool.execute({ task: 'generate', timeout_sec: 30 }, undefined, {
    runId: 'parent',
    subagentDepth: 0,
    delegate: async (request) => ({
      status: 'completed',
      runId: 'parent/sub-1',
      conclusion: `done:${request.task}`,
      artifacts: ['/tmp/frame.png'],
    }),
  });
  assert.equal(result.success, true);
  assert.deepEqual(JSON.parse(result.output), {
    status: 'completed',
    runId: 'parent/sub-1',
    conclusion: 'done:generate',
    artifacts: ['/tmp/frame.png'],
  });
});
