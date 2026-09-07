import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueProjectIntake } from './projectIntakeHandoff.ts';
import { ProjectAssistantQueue } from '../workspace/projectAssistantQueue.ts';
import { readWorkspaceMessage } from '../agent/workspaceMessage.ts';
import { serializeWorkspaceAssistantMessage } from '../workspace/workspaceAssistantMessage.ts';

const intake = { brief: '一位司机在雨夜发现公路异响，先写剧本', mode: 'idea' as const,
  automation: 'stage-confirm' as const, createdAt: 123, attachments: [{ path: '/reference.jpg', kind: 'image' as const }] };

test('project creation hands off the unchanged idea and files to its project conversation', async () => {
  const queue = new ProjectAssistantQueue(undefined, 0);
  const id = enqueueProjectIntake(queue, 'p', 's', intake);
  const item = queue.getSnapshot().items[0];
  assert.equal(item.id, id); assert.equal(item.prompt, intake.brief);
  assert.deepEqual(item.files, ['/reference.jpg']);
  assert.equal(item.target.accessScope, 'project'); assert.equal(item.target.objectId, undefined);
  assert.equal(queue.draft('p', 's')?.target.context, item.target.context);
  assert.equal(readWorkspaceMessage(serializeWorkspaceAssistantMessage(item.target, item.prompt)).status, 'valid');
  assert.match(item.target.context, /逐阶段确认/); assert.match(item.target.context, /付费/);
  let calls = 0;
  const detach = queue.attach({ projectId: 'p', safe: () => true, send: async (entry) => { calls++; assert.equal(entry.prompt, intake.brief); } });
  await new Promise((resolve) => setTimeout(resolve, 30)); detach();
  assert.equal(calls, 1); assert.equal(queue.getSnapshot().items[0].status, 'done');
  assert.equal(enqueueProjectIntake(queue, 'p', 's', intake), id);
  assert.equal(queue.getSnapshot().items.length, 1);
});

test('empty projects send nothing; attachment-only intake is visible; persisted uncertain handoff never replays', () => {
  const queue = new ProjectAssistantQueue();
  assert.equal(enqueueProjectIntake(queue, 'empty', 'e', { ...intake, brief: '', attachments: [] }), undefined);
  assert.equal(queue.getSnapshot().items.length, 0);
  enqueueProjectIntake(queue, 'p', 's', { ...intake, brief: '' });
  const state = queue.getSnapshot();
  assert.match(state.items[0].prompt, /上传的素材/);
  const restored = new ProjectAssistantQueue();
  restored.restore(JSON.stringify({ ...state, items: state.items.map((item) => ({ ...item, status: 'running' })) }));
  const id = restored.getSnapshot().items[0].id;
  assert.equal(enqueueProjectIntake(restored, 'p', 's', { ...intake, brief: '' }), id);
  assert.equal(restored.getSnapshot().items[0].status, 'uncertain');
  assert.equal(restored.getSnapshot().items.length, 1);
});
