import test from 'node:test';
import assert from 'node:assert/strict';
import type { Node } from 'reactflow';
import { canWriteWorkspaceCanvasLayout, readWorkspaceCanvasLayout, writeWorkspaceCanvasLayout, reconcileWorkspaceCanvasLayout, moveWorkspaceObject } from './canvasLayout.ts';
import { emptyWorkshopData } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects } from '../projectObjects/migrate.ts';
import { workspaceSelection } from './contentModel.ts';
import { initialWorkspaceDraft, saveWorkspaceDraft } from './drafts.ts';
import { deleteProjectObjectCommand } from '../projectObjects/projectCommands.ts';
import { collectReferencesFromSnapshot } from '../canvas/collectRefsModel.ts';

test('canvas layout adds objects without moving existing cards or creating a second business object', () => {
  let layout = reconcileWorkspaceCanvasLayout(readWorkspaceCanvasLayout([], 'p'), ['shot:a', 'shot:b']);
  layout = moveWorkspaceObject(layout, 'shot:a', { x: -350, y: 700 });
  const next = reconcileWorkspaceCanvasLayout(layout, ['shot:c', 'shot:a', 'shot:b']);
  assert.deepEqual(next.positions['shot:a'], layout.positions['shot:a']);
  assert.deepEqual(next.positions['shot:b'], layout.positions['shot:b']);
  assert.equal(next.positions['shot:c'].pending, true);
  assert.equal(next.positions['shot:a'].pending, false);
  assert.equal(reconcileWorkspaceCanvasLayout(next, ['shot:a', 'shot:b', 'shot:c']), next);
  assert.equal(moveWorkspaceObject(next, 'absent', { x: 0, y: 0 }), next);
  assert.equal(moveWorkspaceObject(next, 'shot:a', { x: NaN, y: 0 }), next);
});

test('layout-only canvas persistence keeps legacy nodes, original reference edge order and snapshot round-trip', () => {
  const legacy: Node = { id: 'old', type: 'video', position: { x: 1, y: 2 }, data: { prompt: 'old', taskId: 'paid-task' } };
  const nodes = [legacy];
  const edges = [{ id: 'r2', source: 'two', target: 'old' }, { id: 'r1', source: 'one', target: 'old' }];
  const layout = reconcileWorkspaceCanvasLayout(readWorkspaceCanvasLayout(nodes, 'p'), ['shot:a']);
  const next = writeWorkspaceCanvasLayout(nodes, layout);
  assert.equal(next[0], legacy);
  assert.deepEqual(Object.keys(next[1].data), ['workspaceLayout']);
  assert.equal(next[1].hidden, true);
  assert.equal(writeWorkspaceCanvasLayout(next, layout), next);
  const restored = JSON.parse(JSON.stringify({ nodes: next, edges }));
  assert.deepEqual(readWorkspaceCanvasLayout(restored.nodes, 'p'), layout);
  assert.deepEqual(restored.edges, edges);
  assert.deepEqual(readWorkspaceCanvasLayout(next, 'other').positions, {});
});

test('list/canvas changes preserve object, media, draft, selected version, references and conversation', () => {
  let data = migrateWorkshopProjectObjects({ ...emptyWorkshopData('p'), shots: [{ id: 'a', shotNo: '01', description: '司机开车', characterIds: [], imagePath: '/a.jpg' }],
    projectViewState: { workspaceObjectId: 'shot:a', workspaceOutputType: 'image', activeConversationId: 'same-conversation' } }, 1);
  const draft = initialWorkspaceDraft(data, 'shot:a', 'image')!;
  data = saveWorkspaceDraft(data, { ...draft, prompt: '同一份完整草稿' }, 0)!;
  const selection = workspaceSelection(data);
  const next = { ...data, projectViewState: { ...data.projectViewState, workspaceMediaView: 'canvas' as const } };
  assert.deepEqual(workspaceSelection(next), selection);
  assert.equal(next.workspaceDrafts, data.workspaceDrafts);
  assert.equal(next.projectObjects, data.projectObjects);
  assert.equal(next.projectViewState.activeConversationId, 'same-conversation');
  assert.equal(initialWorkspaceDraft(next, 'shot:a', 'image')!.prompt, '同一份完整草稿');
});

test('object deletion removes only its layout pointer, keeps a restorable layout snapshot and never adds references', () => {
  const workshop = migrateWorkshopProjectObjects({ ...emptyWorkshopData('p'), shots: [
    { id: 'a', shotNo: '01', description: 'A', characterIds: [], imagePath: '/a.jpg' },
    { id: 'b', shotNo: '02', description: 'B', characterIds: [] },
  ] }, 1);
  const layout = reconcileWorkspaceCanvasLayout(readWorkspaceCanvasLayout([], 'p'), ['shot:a', 'shot:b']);
  const canvas = { nodes: writeWorkspaceCanvasLayout([], layout), edges: [] };
  assert.deepEqual(collectReferencesFromSnapshot('shot:b', canvas), { images: [], videos: [], audios: [] });
  const result = deleteProjectObjectCommand({ workshop, canvas }, 'shot:a', 2)!;
  assert.equal(readWorkspaceCanvasLayout(result.canvas.nodes, 'p').positions['shot:a'], undefined);
  assert.deepEqual(readWorkspaceCanvasLayout(result.canvas.nodes, 'p').positions['shot:b'], layout.positions['shot:b']);
  const snapshot = result.workshop.projectSnapshots!.find((item) => item.id === result.snapshotId)!;
  assert.deepEqual(readWorkspaceCanvasLayout(JSON.parse(snapshot.canvasPayload).nodes, 'p'), layout);
  assert.ok(snapshot.mediaPaths.includes('/a.jpg'));
});

test('layout writes reject project switching, missing canvases and late callbacks from another project', () => {
  const identity = { workshopProjectId: 'p', activeCanvasId: 'canvas-p', linkedProjectId: 'p', activeUnifiedId: 'p', switching: false };
  assert.equal(canWriteWorkspaceCanvasLayout('p', identity), true);
  assert.equal(canWriteWorkspaceCanvasLayout('p', { ...identity, linkedProjectId: undefined, workshopCanvasProjectId: 'canvas-p' }), true);
  for (const patch of [{ switching: true }, { activeCanvasId: null }, { activeUnifiedId: 'other' }, { workshopProjectId: 'other' }, { linkedProjectId: 'other' }]) {
    assert.equal(canWriteWorkspaceCanvasLayout('p', { ...identity, ...patch }), false);
  }
  assert.equal(canWriteWorkspaceCanvasLayout('', identity), false);
});
