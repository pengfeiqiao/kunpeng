import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantConversationKey, assistantHistoryTarget } from './assistantHistory.ts';
import { wrapWorkspaceContext } from '../agent/workspaceMessage.ts';
const target = { projectId: 'p', sessionId: 's', objectId: 'shot:a', outputType: 'image' as const, label: 'A', context: 'v1', mediaId: 'm1', versionId: 'v1' };
test('conversation follows object through generations while preserving project/session/scope boundaries', () => {
  assert.equal(assistantConversationKey(target), assistantConversationKey({ ...target, mediaId: 'm2', versionId: 'v2', context: 'new' }));
  for (const change of [{ projectId: 'p2' }, { sessionId: 's2' }, { objectId: 'shot:b' }, { outputType: 'video' as const }, { accessScope: 'project' as const }]) {
    assert.notEqual(assistantConversationKey(target), assistantConversationKey({ ...target, ...change }));
  }
});
test('durable message context restores thread grouping without the queue cache', () => {
  const context = '[媒体工作台上下文：'+JSON.stringify({ project_id: 'p', object_id: 'shot:a', output_type: 'image', media_id: 'old' })+']\n原始指令';
  assert.equal(assistantConversationKey(assistantHistoryTarget(wrapWorkspaceContext('workshop', context)+'修改', 's')!), assistantConversationKey(target));
  assert.equal(assistantHistoryTarget('普通聊天', 's'), undefined);
});
