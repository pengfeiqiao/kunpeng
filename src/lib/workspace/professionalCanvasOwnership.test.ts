import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkshopData } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects } from '../projectObjects/migrate.ts';
import { registerCanvasGeneration } from '../projectObjects/selectors.ts';
import { createUnclassifiedGeneration } from './inbox.ts';
import { initialWorkspaceDraft } from './drafts.ts';
import { receiveWorkspaceResult } from './submissions.ts';
import { assignProfessionalCanvasMediaCommand } from './professionalCanvasOwnership.ts';
import type { ProjectCommandState } from '../projectObjects/projectCommands.ts';

function fixture() {
  let workshop = migrateWorkshopProjectObjects({ ...emptyWorkshopData('ownership'), canvasProjectId: 'canvas',
    shots: [{ id: 's', shotNo: '01', description: '事实', characterIds: [], imagePath: '/current.png' }] }, 1);
  workshop = createUnclassifiedGeneration(workshop, 'source', 'image', 2)!;
  const draft = { ...initialWorkspaceDraft(workshop, 'generation-task:workspace:source', 'image')!, prompt: '原生成词' };
  workshop = receiveWorkspaceResult(workshop, { submissionId: 'submitted', snapshot: draft }, 'task', ['/candidate.png'], 3);
  const media = workshop.projectObjects!.media.find((item) => item.path === '/candidate.png')!;
  media.canvasNodeId = 'n';
  const owner = workshop.projectObjects!.objects.find((item) => item.id === 'shot:s')!;
  const state: ProjectCommandState = { workshop, canvas: { nodes: [{ id: 'n', type: 'image', position: { x: 4, y: 8 }, data: {
    projectObjectId: media.ownerObjectId, mediaObjectId: media.id, versionObjectId: media.versionObjectId, mediaPurpose: 'unclassified',
    localPath: media.path, generatedImageUrl: media.path, description: draft.prompt,
    workspaceDraftId: draft.id, workspaceProjection: { revision: draft.revision },
    workspaceBinding: { submissionId: 'submitted', snapshot: draft }, generationHistory: [{ url: '/prior.png', timestamp: 1 }],
    referenceImages: [{ url: '/reference.png' }],
  } }], edges: [{ id: 'e', source: 'other', target: 'n' }] } };
  return { state, media, input: { mediaId: media.id, ownerId: owner.id, expectedMediaVersion: media.version, expectedOwnerVersion: owner.version } };
}

test('classification projects stable owner metadata only, preserving candidate bytes, generation binding and every reference', () => {
  const { state, input, media } = fixture(); const bytes = JSON.stringify(state);
  state.workshop.shots[0].shotNo = '99';
  const next = assignProfessionalCanvasMediaCommand(state, input, 4);
  const node = next.canvas.nodes[0]; const old = state.canvas.nodes[0];
  assert.equal(node.data.projectObjectId, 'shot:s'); assert.equal(node.data.mediaObjectId, media.id);
  assert.equal(node.data.versionObjectId, media.versionObjectId); assert.equal(node.data.mediaPurpose, 'candidate-version');
  assert.equal(node.data.workshopRef.shotId, 's'); assert.equal(node.data.workshopRef.shotNoSnapshot, '99');
  assert.equal(node.data.workspaceDraftId, undefined); assert.equal(node.data.workspaceProjection, undefined);
  for (const field of ['localPath', 'generatedImageUrl', 'description', 'workspaceBinding', 'generationHistory', 'referenceImages']) {
    assert.equal(node.data[field], old.data[field]);
  }
  assert.equal(node.position, old.position); assert.equal(next.canvas.edges, state.canvas.edges);
  assert.equal(next.workshop.workspaceDrafts, state.workshop.workspaceDrafts);
  assert.equal(next.workshop.workspaceSubmissions, state.workshop.workspaceSubmissions);
  assert.equal(next.workshop.shots, state.workshop.shots); assert.equal(next.workshop.shots[0].imagePath, '/current.png');
  const version = next.workshop.projectObjects!.versions.find((item) => item.id === media.versionObjectId)!;
  assert.equal(version.selected, false);
  assert.equal(version.generationSnapshot, state.workshop.projectObjects!.versions.find((item) => item.id === media.versionObjectId)!.generationSnapshot);
  assert.equal(next.workshop.projectObjects!.media.length, state.workshop.projectObjects!.media.length);
  state.workshop.shots[0].shotNo = '01'; assert.equal(JSON.stringify(state), bytes);
});

test('stale assignment, owner/media/version locks and explicit node conflicts reject before either projection is published', () => {
  for (const data of [{ projectObjectId: 'shot:other' }, { versionObjectId: 'invalid' }, { mediaObjectId: 'invalid' },
    { generatedImageUrl: '/other.png', localPath: '/other.png' }, { isGenerating: true }, { locked: true },
    { workshopRef: { objectId: 'generation-task:workspace:source', projectId: 'other' } }]) {
    const { state, input } = fixture(); Object.assign(state.canvas.nodes[0].data, data); const bytes = JSON.stringify(state);
    assert.throws(() => assignProfessionalCanvasMediaCommand(state, input), /冲突/);
    assert.equal(JSON.stringify(state), bytes);
  }
  for (const collection of ['objects', 'media', 'versions'] as const) {
    const { state, input, media } = fixture();
    const id = collection === 'objects' ? input.ownerId : collection === 'media' ? media.id : media.versionObjectId;
    state.workshop.projectObjects![collection].find((item) => item.id === id)!.locked = true;
    assert.throws(() => assignProfessionalCanvasMediaCommand(state, input), /锁定/);
  }
  const { state, input } = fixture();
  assert.throws(() => assignProfessionalCanvasMediaCommand(state, { ...input, expectedMediaVersion: 0 }), /已改变/);
  assert.throws(() => assignProfessionalCanvasMediaCommand(assignProfessionalCanvasMediaCommand(state, input), input), /已改变/);
});

test('legacy unowned media may use unique provenance plus displayed path, but path alone never binds unrelated nodes', () => {
  const base = fixture();
  const workshop = registerCanvasGeneration(base.state.workshop, { taskId: 'old', nodeId: 'old-node', mediaType: 'image', paths: ['/old.png'] }, 4).data;
  const media = workshop.projectObjects!.media.find((item) => item.path === '/old.png')!;
  const state = { workshop, canvas: { nodes: [
    { id: 'old-node', type: 'image', position: { x: 0, y: 0 }, data: { generatedImageUrl: '/old.png', description: '原词' } },
    { id: 'same-path', type: 'image', position: { x: 0, y: 0 }, data: { generatedImageUrl: '/old.png', description: '自由节点' } },
  ], edges: [] } };
  const next = assignProfessionalCanvasMediaCommand(state, { ...base.input, mediaId: media.id, expectedMediaVersion: media.version });
  assert.equal(next.canvas.nodes[0].data.projectObjectId, 'shot:s');
  assert.equal(next.canvas.nodes[1], state.canvas.nodes[1]);
});

test('provenance reused by later results does not rebind a node or duplicate output when classifying the older result', () => {
  const { state, input, media } = fixture();
  state.canvas.nodes[0].data = { generatedImageUrl: '/newer.png', description: '后来的词' };
  const next = assignProfessionalCanvasMediaCommand(state, input);
  assert.equal(next.canvas.nodes[0], state.canvas.nodes[0]);
  assert.equal(next.workshop.projectObjects!.media.find((item) => item.id === media.id)!.ownerObjectId, 'shot:s');
  assert.equal(next.workshop.projectObjects!.media.length, state.workshop.projectObjects!.media.length);
});

test('ambiguous provenance and explicit stale IDs never fall back to a matching path', () => {
  const { state, input, media } = fixture();
  state.canvas.nodes[0].data = { generatedImageUrl: media.path };
  state.workshop.projectObjects!.media.push({ ...media, id: 'duplicate' });
  assert.throws(() => assignProfessionalCanvasMediaCommand(state, input), /不唯一/);
  state.workshop.projectObjects!.media.pop();
  state.canvas.nodes[0].data.mediaObjectId = 'missing';
  assert.throws(() => assignProfessionalCanvasMediaCommand(state, input), /冲突/);
});

test('headless classification succeeds without fabricating a canvas node; projected metadata survives reload', () => {
  const { state, input } = fixture();
  const next = assignProfessionalCanvasMediaCommand({ ...state, canvas: { nodes: [], edges: [] } }, input);
  assert.equal(next.canvas.nodes.length, 0);
  const projected = assignProfessionalCanvasMediaCommand(state, input);
  const restored = JSON.parse(JSON.stringify(projected));
  assert.equal(restored.canvas.nodes[0].data.projectObjectId, 'shot:s');
  assert.equal(restored.canvas.nodes[0].data.workspaceBinding.snapshot.objectId, 'generation-task:workspace:source');
});
