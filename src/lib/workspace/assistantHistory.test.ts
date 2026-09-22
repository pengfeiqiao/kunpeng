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

import { projectAssistantHistory, visibleAssistantHistory } from './assistantHistory.ts';
import type { AssistantQueueItem } from './projectAssistantQueue.ts';
const item = (id: string, objectId: string, messageIds: string[]): AssistantQueueItem => ({ id, target: { ...target, objectId },
  prompt: '修改提示词', status: 'done', threadKey: '', enqueuedAt: 1, files: [], messageIds });

test('history index preserves object, unbound project turns, legacy fallback and explicit receipt ownership', () => {
  const a = item('a', 'shot:a', ['u1', 'a1']); const b = item('b', 'shot:b', ['u2']);
  const messages = [
    { id: 'u0', role: 'user', content: '项目消息' }, { id: 'a0', role: 'assistant', content: '项目回答' },
    { id: 'u1', role: 'user', content: '相同文字' }, { id: 'a1', role: 'assistant', content: 'A回复' },
    { id: 'u2', role: 'user', content: '相同文字' }, { id: 'a2', role: 'assistant', content: 'B回复' },
  ];
  const index = projectAssistantHistory(messages, [a, b], 's', (t, p) => t.context + p);
  assert.deepEqual([...visibleAssistantHistory(index, a.target, 'p')], ['u1', 'a1']);
  assert.deepEqual([...visibleAssistantHistory(index, b.target, 'p')], ['u2', 'a2']);
  assert.deepEqual([...visibleAssistantHistory(index, { ...target, objectId: undefined }, 'p')], ['u0', 'a0']);
  assert.equal(visibleAssistantHistory(index, a.target, 'other').size, 0);
  const context = '[媒体工作台上下文：{"project_id":"p","object_id":"shot:a","output_type":"image"}]\n旧上下文';
  const legacy = projectAssistantHistory([{ id: 'legacy', role: 'user', content: wrapWorkspaceContext('workshop', context) + '修改' }], [], 's', (t, p) => t.context + p);
  assert.deepEqual([...visibleAssistantHistory(legacy, a.target, 'p')], ['legacy']);
});

test('large receipt-backed history serializes each queue item once, not once per message pair', () => {
  const items = Array.from({ length: 1000 }, (_, i) => item(`q${i}`, i % 2 ? 'shot:b' : 'shot:a', [`u${i}`, `a${i}`]));
  const messages = items.flatMap((_, i) => [{ id: `u${i}`, role: 'user', content: `edit ${i}` }, { id: `a${i}`, role: 'assistant', content: 'reply' }]);
  let calls = 0;
  const index = projectAssistantHistory(messages, items, 's', (t, p) => { calls++; return t.context + p; });
  assert.equal(calls, 1000); assert.equal(index.size, 2000);
  assert.equal(visibleAssistantHistory(index, target, 'p').size, 1000);
});
