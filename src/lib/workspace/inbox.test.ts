import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkshopData } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects } from '../projectObjects/migrate.ts';
import { registerCanvasGeneration } from '../projectObjects/selectors.ts';
import { selectProjectVersionCommand } from '../projectObjects/projectCommands.ts';
import { createUnclassifiedGeneration, createWorkspaceAsset, createWorkspaceShot, renameWorkspaceObject, assignUnclassifiedMedia } from './inbox.ts';
import { initialWorkspaceDraft, saveWorkspaceDraft } from './drafts.ts';
import { workspaceContentGroups, workspaceSelection, selectWorkspaceObject } from './contentModel.ts';
import { workspaceMediaVersions } from './mediaView.ts';
import { submitWorkspaceGeneration, type WorkspaceGenerationPort } from './generationCommand.ts';
import { receiveWorkspaceResult } from './submissions.ts';

function fixture() {
  const data = migrateWorkshopProjectObjects({ ...emptyWorkshopData('inbox-test'), characters: [
    { id: 'driver', name: '司机', appearance: '', personality: '', assetImagePath: '/driver.jpg' },
  ], shots: [{ id: 'a', shotNo: '01', description: '司机开车', dialogue: '停一下', characterIds: ['driver'], imagePath: '/old.jpg' }],
  projectViewState: { workspaceObjectId: 'shot:a', workspaceOutputType: 'image', activeConversationId: 'conversation' } }, 1);
  data.projectSpec = { ...data.projectSpec!, generationConfirmation: 'always-confirm' };
  const old = data.projectObjects!.media.find((item) => item.path === '/old.jpg')!;
  return selectProjectVersionCommand({ workshop: data, canvas: { nodes: [], edges: [] } }, 'shot:a', old.versionObjectId!, 1)!.workshop;
}

test('context-menu shot creation appends a blank stable object without copying story, references or paid history', () => {
  const before = fixture();
  const next = createWorkspaceShot(before, 'new-shot', 4)!;
  assert.deepEqual(next.shots[0], before.shots[0]);
  const added = next.shots[next.shots.length - 1]!;
  assert.equal(added.shotNo, '02');
  assert.equal(added.description, '');
  assert.equal(added.dialogue, undefined);
  assert.equal(added.imagePath, undefined);
  assert.deepEqual(added.characterIds, []);
  assert.equal(next.projectViewState?.activeConversationId, 'conversation');
  assert.equal(workspaceSelection(next).selected?.id, 'shot:workspace-shot-new-shot');
  const draft = initialWorkspaceDraft(next, 'shot:workspace-shot-new-shot', 'video')!;
  assert.equal(draft.prompt, '');
  assert.deepEqual(draft.references, []);
  assert.equal(createWorkspaceShot(next, 'new-shot'), null);
  assert.equal(createWorkspaceShot(next, ''), null);
  assert.deepEqual(migrateWorkshopProjectObjects(JSON.parse(JSON.stringify(next)), 5).shots, JSON.parse(JSON.stringify(next.shots)));
});

test('blank project and mixed legacy shot labels are supported without renumbering existing shots', () => {
  const empty = createWorkspaceShot(emptyWorkshopData('empty'), 'first', 1)!;
  assert.equal(empty.shots[0].shotNo, '01');
  const before = { ...fixture(), shots: [{ id: 'legacy', shotNo: '03-02', description: '原文', characterIds: [] },
    { id: 'n', shotNo: '09', description: '原文2', characterIds: [] }] };
  const next = createWorkspaceShot(before, 'next', 2)!;
  assert.deepEqual(next.shots.map(shot => shot.shotNo), ['03-02', '09', '10']);
  assert.equal(before.shots.length, 2);
});

test('blank generation has an independent persistent target and never inherits selected shot references or facts', () => {
  const before = fixture();
  const next = createUnclassifiedGeneration(before, 'blank-1', 'video', 2)!;
  const selection = workspaceSelection(next);
  assert.equal(selection.selected?.id, 'generation-task:workspace:blank-1');
  assert.equal(selection.selected?.kind, 'material');
  assert.equal(selection.outputType, 'video');
  assert.equal(selection.versions.length, 0);
  const draft = initialWorkspaceDraft(next, selection.selected!.id, 'video')!;
  assert.deepEqual(draft.references, []);
  assert.equal(draft.prompt, '');
  assert.equal(next.shots, before.shots);
  assert.equal(next.characters, before.characters);
  assert.equal(next.projectViewState?.activeConversationId, 'conversation');
  assert.equal(createUnclassifiedGeneration(next, 'blank-1', 'video'), null);
  assert.equal(createUnclassifiedGeneration(next, '', 'image'), null);
  const restored = migrateWorkshopProjectObjects(JSON.parse(JSON.stringify(next)), 3);
  assert.equal(workspaceSelection(restored).selected?.id, selection.selected?.id);
  assert.deepEqual(initialWorkspaceDraft(restored, draft.objectId, 'video')?.references, []);
});

test('blank generation uses the real shared command: cancel makes zero calls, approval creates unclassified version with frozen settings', async () => {
  let data = createUnclassifiedGeneration(fixture(), 'blank-2', 'image', 2)!;
  const objectId = data.projectViewState!.workspaceObjectId!;
  data = saveWorkspaceDraft(data, { ...initialWorkspaceDraft(data, objectId, 'image')!, prompt: '孤立素材', params: { aspectRatio: '9:16', resolution: '2k' } }, 1)!;
  const draft = initialWorkspaceDraft(data, objectId, 'image')!;
  let approved = false;
  let calls = 0;
  let confirms = 0;
  const port: WorkspaceGenerationPort = {
    readProject: () => data, publish: (before, after) => { if (before !== data) return false; data = after; return true; }, persist: async () => {},
    confirm: async (snapshot) => { confirms++; assert.equal(snapshot.objectId, objectId); assert.deepEqual(snapshot.references, []); return approved; },
    bindTask: () => {}, runGeneration: async (request) => {
      calls++; assert.equal(request.strictPaidSafety, true); assert.deepEqual(request.referenceUrls, []);
      request.onTaskCreated?.('inbox-paid-task');
      return { success: true, taskId: 'inbox-paid-task', resultPaths: ['/inbox.png'], resultUrls: [] };
    },
  };
  assert.equal((await submitWorkspaceGeneration(port, draft, 'cancelled', 'ask')).status, 'cancelled');
  assert.equal(calls, 0);
  approved = true;
  assert.equal((await submitWorkspaceGeneration(port, draft, 'approved', 'ask')).status, 'succeeded');
  assert.equal(calls, 1); assert.equal(confirms, 2);
  const media = data.projectObjects!.media.find((item) => item.path === '/inbox.png')!;
  assert.equal(media.purpose, 'unclassified');
  assert.equal(media.ownerObjectId, objectId);
  assert.notEqual(media.ownerObjectId, 'shot:a');
  const version = data.projectObjects!.versions.find((item) => item.id === media.versionObjectId)!;
  assert.equal(version.selected, false);
  assert.equal(version.generationSnapshot?.params.aspectRatio, '9:16');
  assert.equal(data.shots[0].imagePath, '/old.jpg');
  assert.equal(workspaceMediaVersions(data, objectId, 'image')[0].snapshot?.prompt, '孤立素材');
});

function withResult() {
  let data = createUnclassifiedGeneration(fixture(), 'assign', 'image', 2)!;
  const draft = { ...initialWorkspaceDraft(data, 'generation-task:workspace:assign', 'image')!, prompt: '原创新素材' };
  data = receiveWorkspaceResult(data, { submissionId: 'paid', snapshot: draft }, 'done-task', ['/new.png'], 3);
  return { data, draft, media: data.projectObjects!.media.find((item) => item.path === '/new.png')! };
}

test('classification is one ownership change; preserves bytes, facts, selected version, every draft/reference and paid snapshot', () => {
  const { data, draft, media } = withResult();
  const before = JSON.stringify(data);
  const owner = data.projectObjects!.objects.find((item) => item.id === 'shot:a')!;
  const classified = assignUnclassifiedMedia(data, { mediaId: media.id, ownerId: owner.id,
    expectedMediaVersion: media.version, expectedOwnerVersion: owner.version }, 4)!;
  assert.ok(classified);
  assert.equal(classified.shots, data.shots);
  assert.equal(classified.workspaceDrafts, data.workspaceDrafts);
  assert.equal(classified.workspaceSubmissions, data.workspaceSubmissions);
  assert.equal(classified.projectViewState, data.projectViewState);
  const moved = classified.projectObjects!.media.find((item) => item.id === media.id)!;
  assert.equal(moved.path, '/new.png'); assert.equal(moved.ownerObjectId, 'shot:a');
  assert.equal(moved.purpose, 'candidate-version');
  const version = classified.projectObjects!.versions.find((item) => item.id === moved.versionObjectId)!;
  assert.equal(version.ownerObjectId, 'shot:a'); assert.equal(version.selected, false);
  assert.deepEqual(version.generationSnapshot, draft);
  assert.equal(version.id, media.versionObjectId);
  assert.equal(JSON.stringify(data), before);
  assert.equal(workspaceContentGroups(classified).some((group) => group.id === 'unclassified'), false);
  const readBack = { ...classified, projectViewState: selectWorkspaceObject(classified, owner.id, 'image')! };
  assert.ok(workspaceSelection(readBack).versions.some((item) => item.media.id === media.id));
  assert.equal(workspaceSelection(readBack).media?.media.path, '/old.jpg');
  const adopted = selectProjectVersionCommand({ workshop: classified, canvas: { nodes: [], edges: [] } }, owner.id, version.id, 5)!;
  assert.equal(adopted.workshop.shots[0].imagePath, '/new.png');
  assert.equal(adopted.workshop.workspaceSubmissions, data.workspaceSubmissions);
});

test('recovery replay and repeated migration do not undo classification, duplicate media or invent references', () => {
  const { data, draft, media } = withResult();
  const owner = data.projectObjects!.objects.find((item) => item.id === 'shot:a')!;
  const classified = assignUnclassifiedMedia(data, { mediaId: media.id, ownerId: owner.id, expectedMediaVersion: media.version, expectedOwnerVersion: owner.version }, 4)!;
  const replay = receiveWorkspaceResult(classified, { submissionId: 'paid', snapshot: draft }, 'done-task', ['/new.png'], 5);
  assert.equal(replay, classified);
  const twice = migrateWorkshopProjectObjects(migrateWorkshopProjectObjects(classified, 6), 7);
  const third = migrateWorkshopProjectObjects(twice, 8);
  assert.equal(JSON.stringify(third), JSON.stringify(twice));
  assert.equal(third.projectObjects!.media.filter((item) => item.path === '/new.png').length, 1);
  assert.equal(third.projectObjects!.media.find((item) => item.id === media.id)?.ownerObjectId, 'shot:a');
  assert.equal(third.workspaceDrafts![draft.id].references.length, 0);
  const duplicate = registerCanvasGeneration(third, { taskId: 'done-task', nodeId: '', paths: ['/new.png'], mediaType: 'image', ownerObjectId: draft.objectId }, 9);
  assert.equal(duplicate.data.projectObjects!.media.find((item) => item.id === media.id)?.ownerObjectId, 'shot:a');
});

test('classification rejects stale revisions, locked media/owners, unsupported owners and repeated assignment', () => {
  const { data, media } = withResult();
  const owner = data.projectObjects!.objects.find((item) => item.id === 'shot:a')!;
  const input = { mediaId: media.id, ownerId: owner.id, expectedMediaVersion: media.version, expectedOwnerVersion: owner.version };
  assert.equal(assignUnclassifiedMedia(data, { ...input, expectedMediaVersion: 0 }), null);
  assert.equal(assignUnclassifiedMedia(data, { ...input, expectedOwnerVersion: 0 }), null);
  assert.equal(assignUnclassifiedMedia(data, { ...input, ownerId: media.ownerObjectId! }), null);
  for (const key of ['locked', 'archived'] as const) {
    const modified = { ...data, projectObjects: { ...data.projectObjects!, media: data.projectObjects!.media.map((item) => item.id === media.id ? { ...item, [key]: true } : item) } };
    assert.equal(assignUnclassifiedMedia(modified, input), null);
  }
  const lockedOwner = { ...data, projectObjects: { ...data.projectObjects!, objects: data.projectObjects!.objects.map((item) => item.id === owner.id ? { ...item, locked: true } : item) } };
  assert.equal(assignUnclassifiedMedia(lockedOwner, input), null);
  for (const key of ['locked', 'archived'] as const) {
    const source = { ...data, projectObjects: { ...data.projectObjects!, objects: data.projectObjects!.objects.map((item) => item.id === media.ownerObjectId ? { ...item, [key]: true } : item) } };
    assert.equal(assignUnclassifiedMedia(source, input), null);
    const version = { ...data, projectObjects: { ...data.projectObjects!, versions: data.projectObjects!.versions.map((item) => item.id === media.versionObjectId ? { ...item, [key]: true } : item) } };
    assert.equal(assignUnclassifiedMedia(version, input), null);
  }
  const assigned = assignUnclassifiedMedia(data, input)!;
  assert.equal(assignUnclassifiedMedia(assigned, input), null);
});

test('old unowned canvas output can be previewed and assigned without fabricating historical parameters', () => {
  const data = registerCanvasGeneration(fixture(), { nodeId: 'legacy-node', taskId: 'legacy-task', mediaType: 'video', paths: ['/old-video.mp4'] }, 2).data;
  const media = data.projectObjects!.media.find((item) => item.path === '/old-video.mp4')!;
  const selected = { ...data, projectViewState: selectWorkspaceObject(data, media.id)! };
  assert.equal(workspaceSelection(selected).outputType, 'video');
  assert.equal(workspaceSelection(selected).media?.media.id, media.id);
  assert.equal(workspaceSelection(selected).media?.snapshot, undefined);
  assert.deepEqual(initialWorkspaceDraft(selected, media.id, 'video')?.references, []);
  const owner = data.projectObjects!.objects.find((item) => item.id === 'shot:a')!;
  const assigned = assignUnclassifiedMedia(selected, { mediaId: media.id, ownerId: owner.id, expectedMediaVersion: media.version, expectedOwnerVersion: owner.version })!;
  const version = assigned.projectObjects!.versions.find((item) => item.mediaObjectId === media.id)!;
  assert.equal(version.generationSnapshot, undefined);
  assert.equal(version.selected, false);
  assert.equal(assigned.shots[0].videoPath, undefined);
});

test('createWorkspaceAsset creates blank character/scene/prop with registry object and no generation', () => {
  for (const kind of ['character', 'scene', 'prop'] as const) {
    const next = createWorkspaceAsset(fixture(), kind, 't1', 5)!;
    const objectId = `workspace-${kind}-t1`;
    const entity = (kind === 'character' ? next.characters : kind === 'scene' ? next.scenes : next.props).find((item) => item.id === objectId);
    assert.ok(entity, `${kind} entity created`);
    const owner = next.projectObjects!.objects.find((item) => item.id === `workspace:${kind}:${objectId}` || item.sourceId === objectId);
    assert.ok(owner, `${kind} registry object created`);
    assert.equal(next.projectObjects!.media.length, fixture().projectObjects!.media.length, 'no media created');
  }
  assert.equal(createWorkspaceAsset(fixture(), 'character', 't1', 5) && createWorkspaceAsset(createWorkspaceAsset(fixture(), 'character', 't1', 5)!, 'character', 't1', 6), null, 'duplicate token refused');
});

test('renameWorkspaceObject updates label and underlying entity; locked or empty input refused', () => {
  const base = fixture();
  const owner = base.projectObjects!.objects.find((item) => item.kind === 'character')!;
  const renamed = renameWorkspaceObject(base, owner.id, { label: '老司机', description: '沉默寡言' }, 7)!;
  assert.equal(renamed.projectObjects!.objects.find((item) => item.id === owner.id)!.label, '老司机');
  assert.equal(renamed.characters.find((item) => item.id === owner.sourceId)!.name, '老司机');
  assert.equal(renamed.characters.find((item) => item.id === owner.sourceId)!.personality, '沉默寡言');
  assert.equal(renameWorkspaceObject(base, owner.id, {}, 7), null);
  const locked = { ...base, projectObjects: { ...base.projectObjects!, objects: base.projectObjects!.objects.map((item) => item.id === owner.id ? { ...item, locked: true } : item) } };
  assert.equal(renameWorkspaceObject(locked, owner.id, { label: 'x' }), null);
});
