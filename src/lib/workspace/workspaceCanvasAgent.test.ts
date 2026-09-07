import test from 'node:test';
import assert from 'node:assert/strict';
import type { WorkshopData } from '../workshop/types.ts';
import { captureCanvasAssistantTarget, validateCanvasAssistantTarget, workspaceBindingForNode, selectCanvasNodes, readCanvasRegionRequest } from './workspaceCanvasAgent.ts';
import { serializeWorkspaceAssistantMessage, readDirectorAssistantRequest } from './workspaceAssistantMessage.ts';
import { inferAgentWorkspaceScope } from '../agent/modelCatalog.ts';
import { stripHarnessPrefix } from '../agent/harnessDisplay.ts';
import { ProjectAssistantQueue, AssistantQueueFailure } from './projectAssistantQueue.ts';

function fixture() {
  const data = { projectId: 'P', canvasProjectId: 'C', shots: [], projectObjects: { projectId: 'P',
    objects: [{ id: 'O', projectId: 'P', kind: 'character', sourceId: 'character', version: 1 }],
    media: [{ id: 'M', projectId: 'P', ownerObjectId: 'O', mediaType: 'image', versionObjectId: 'V', version: 1 }],
    versions: [{ id: 'V', projectId: 'P', ownerObjectId: 'O', mediaObjectId: 'M', version: 1 }],
  } } as unknown as WorkshopData;
  const nodes = [{ id: 'N', type: 'image', position: { x: 0, y: 0 }, data: { projectObjectId: 'O', mediaObjectId: 'M', versionObjectId: 'V', description: '原文' } }];
  const project = { activeProjectId: 'C', switching: false, projects: [{ id: 'C', aigcProjectId: 'P' }] };
  return { data, nodes, project, target: captureCanvasAssistantTarget(data, 'C', 'S', { nodes, edges: [] }, ['N']) };
}

test('frozen node target rejects project switches, deleted/reassigned nodes and revision changes', () => {
  const { data, nodes, project, target } = fixture();
  assert.equal(validateCanvasAssistantTarget(target, data, project, 'P', nodes), null);
  assert.ok(validateCanvasAssistantTarget(target, data, project, 'other', nodes));
  assert.ok(validateCanvasAssistantTarget(target, data, { ...project, switching: true }, 'P', nodes));
  assert.ok(validateCanvasAssistantTarget(target, data, project, 'P', []));
  assert.ok(validateCanvasAssistantTarget(target, { ...data, canvasProjectId: undefined }, { ...project, projects: [] }, 'P', nodes));
  assert.ok(validateCanvasAssistantTarget(target, data, project, 'P', [{ ...nodes[0], data: { ...nodes[0].data, projectObjectId: 'other' } }]));
  const changed = structuredClone(data); changed.projectObjects!.objects[0].version++;
  assert.ok(validateCanvasAssistantTarget(target, changed, project, 'P', nodes));
  const serialized = JSON.parse(JSON.stringify(target));
  assert.equal(validateCanvasAssistantTarget(serialized, data, project, 'P', nodes), null);
});

test('registry reverse version links must agree; paths never establish ownership', () => {
  const { data, nodes } = fixture();
  assert.equal(workspaceBindingForNode(nodes[0], data)?.objectId, 'O');
  data.projectObjects!.media[0].versionObjectId = 'different';
  assert.equal(workspaceBindingForNode(nodes[0], data), null);
  assert.equal(workspaceBindingForNode({ ...nodes[0], data: { localPath: '/same.png' } }, data), null);
});

test('explicit legacy version revision is frozen even when media has no reverse version field', () => {
  const { data, nodes, project } = fixture();
  delete data.projectObjects!.media[0].versionObjectId;
  const target = captureCanvasAssistantTarget(data, 'C', 'S', { nodes, edges: [] }, ['N']);
  data.projectObjects!.versions[0].version++;
  assert.ok(validateCanvasAssistantTarget(target, data, project, 'P', nodes));
});

test('version focus updates ReactFlow selection and region requests use their own exact targets', () => {
  const nodes = [{ id: 'A', type: 'image', position: { x: 0, y: 0 }, selected: true, data: {} },
    { id: 'B', type: 'video', position: { x: 0, y: 0 }, selected: false, data: {} }];
  const result = selectCanvasNodes(nodes, ['B']);
  assert.equal(result.selectedNodeId, 'B');
  assert.deepEqual(result.nodes.map((node) => node.selected), [false, true]);
  assert.deepEqual(readCanvasRegionRequest('[画布 AI 区域操作]\n用户在画布上框选了 1 个节点：B(video)。\n指令：只修改B'), { nodeIds: ['B'], request: '只修改B' });
  assert.deepEqual(readCanvasRegionRequest('[画布 AI 区域操作]\n用户在画布空白区域画了一个框。\n指令：创建'), { nodeIds: [], request: '创建' });
  assert.throws(() => readCanvasRegionRequest('[画布 AI 区域操作]\n用户在画布上框选了 2 个节点：B(video)。\n指令：修改'));
});

test('full original action stays in model context while only the button intent authorizes edits', () => {
  const { target } = fixture();
  target.context += '\n原动作：engine="midjourney-v81"，当前文本包含“修改剧本中的人物关系”';
  const message = serializeWorkspaceAssistantMessage(target, '执行画布文本润色操作。');
  assert.equal(inferAgentWorkspaceScope(message), 'canvas');
  assert.equal(stripHarnessPrefix(message), '执行画布文本润色操作。');
  assert.ok(message.includes('midjourney-v81'));
  const director = readDirectorAssistantRequest('[导演台上下文：人工锁定不得覆盖；正式生成和导出仍由用户最终确认。]\n\n调整机位');
  assert.equal(director?.request, '调整机位');
  assert.ok(director?.context.includes('人工锁定不得覆盖'));
});

test('invalid pre-send binding settles failed/retry-safe, not uncertain and never calls send', async () => {
  const { data, project, target } = fixture();
  const queue = new ProjectAssistantQueue(undefined, 0);
  let sent = 0;
  const detach = queue.attach({ projectId: 'P', safe: () => true, send: async (item) => {
    const reason = validateCanvasAssistantTarget(item.target, data, project, 'P', []);
    if (reason) throw new AssistantQueueFailure(reason, true);
    sent++;
  } });
  queue.enqueue(target, 'modify');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(sent, 0); assert.equal(queue.getSnapshot().items[0].status, 'failed'); detach();
});
