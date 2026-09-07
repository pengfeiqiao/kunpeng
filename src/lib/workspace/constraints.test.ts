import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkshopData } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects } from '../projectObjects/migrate.ts';
import { selectAssetVersion } from '../projectObjects/selectors.ts';
import { deleteProjectObject } from '../projectObjects/deletion.ts';
import { constraintGenerationDraft, constraintGenerationErrors, createWorkspaceConstraint, putWorkspaceConstraint, saveConstraintVideoDraft, setDraftConstraint, staleConstraintDrafts } from './constraints.ts';
import { initialWorkspaceDraft, saveWorkspaceDraft, workspaceDraftErrors } from './drafts.ts';
import { submitWorkspaceGeneration, type WorkspaceGenerationPort } from './generationCommand.ts';
import { buildWorkspaceAgentContext } from './agentContext.ts';

function fixture() {
  const migrated = migrateWorkshopProjectObjects({ ...emptyWorkshopData('constraint-test'),
    characters: [{ id: 'driver', name: '司机', appearance: '', personality: '', assetImagePath: '/driver.png' }],
    scenes: [{ id: 'road', name: '公路', description: '', assetImagePath: '/road.png' }],
    props: [{ id: 'car', name: '车', description: '', assetImagePath: '/car.png' }],
    shots: ['a', 'b'].map((id, index) => ({ id, shotNo: String(index + 1), characterIds: ['driver'], propIds: ['car'],
      sceneId: 'road', description: '司机握住方向盘，听到异响', videoPrompt: '@图片一 公路 @图片二 司机 @图片三 车' })),
  }, 1);
  migrated.projectSpec = { ...migrated.projectSpec!, generationConfirmation: 'always-confirm' };
  return migrated;
}

test('constraint metadata creation is scene/shot isolated, idempotently migratable and cannot replace a concurrent card', () => {
  const data = createWorkspaceConstraint(fixture(), 'shot:a', 'scene', 'shared')!;
  assert.equal(data.scenes[0].directorConstraintCard!.id, 'shared');
  assert.equal(data.shots[0].directorConstraintCard, undefined);
  assert.deepEqual(data.projectObjects!.objects.find((item) => item.id === 'director-constraint:shared')!.relationIds, ['scene:road']);
  assert.equal(createWorkspaceConstraint(data, 'shot:b', 'scene', 'other'), null);
  const again = migrateWorkshopProjectObjects(migrateWorkshopProjectObjects(data, 2), 2);
  assert.equal(again.projectObjects!.objects.filter((item) => item.id === 'director-constraint:shared').length, 1);
  assert.deepEqual(again.workspaceDrafts, data.workspaceDrafts);
  const local = createWorkspaceConstraint(data, 'shot:b', 'shot', 'local')!;
  assert.equal(local.shots[1].directorConstraintCard!.id, 'local');
  assert.equal(local.scenes[0].directorConstraintCard!.id, 'shared');
});

test('constraint draft contains only scene pixels, with character/prop names and actions in text', () => {
  const data = createWorkspaceConstraint(fixture(), 'shot:a', 'shot', 'local')!;
  const draft = initialWorkspaceDraft(data, 'director-constraint:local', 'image')!;
  assert.deepEqual(draft.references.map((ref) => ref.path), ['/road.png']);
  assert.match(draft.prompt, /司机/); assert.match(draft.prompt, /方向盘/); assert.match(draft.prompt, /车/);
  assert.deepEqual(constraintGenerationErrors(data, draft), []);
  assert.ok(constraintGenerationErrors(data, { ...draft, references: [] }).length);
  assert.ok(constraintGenerationErrors(data, { ...draft, references: [...draft.references,
    { id: 'person', type: 'image', path: '/driver.png', label: '人' }] }).length);
});

test('explicit constraint selection appends a correctly numbered reference, and disable leaves ordinary refs untouched', () => {
  const data = fixture();
  const draft = initialWorkspaceDraft(data, 'shot:a', 'video')!;
  const card = { id: 'local', imagePath: '/card.png', createdAt: 1 };
  const next = setDraftConstraint(data, draft, card);
  assert.deepEqual(next.references.map((ref) => ref.path), ['/road.png', '/driver.png', '/car.png', '/card.png']);
  assert.match(next.prompt, /@导演约束卡（对应 @图片四）/);
  assert.deepEqual(workspaceDraftErrors(next), []);
  const disabled = setDraftConstraint(data, next);
  assert.deepEqual(disabled.references, draft.references);
  assert.equal(disabled.prompt, draft.prompt);
  assert.equal(draft.references.length, 3);
});

test('legacy constraint at image one remaps to the last reference without losing body mentions', () => {
  let data = fixture();
  const card = { id: 'old', imagePath: '/old.png', createdAt: 1, useInVideo: true };
  data = putWorkspaceConstraint(data, 'shot:a', 'shot', card)!;
  const initial = initialWorkspaceDraft(data, 'shot:a', 'video')!;
  assert.equal(initial.references[0].role, 'director-constraint');
  initial.prompt = '以 @图片一 中的站位拍摄 @图片二 场景';
  const changed = setDraftConstraint(data, initial, card);
  assert.match(changed.prompt, /以 @图片四 中的站位拍摄 @图片一 场景/);
  assert.deepEqual(workspaceDraftErrors(changed), []);
});

test('saved constraint prompt survives reopening and stale async video updates are rejected', () => {
  let data = createWorkspaceConstraint(fixture(), 'shot:a', 'shot', 'card')!;
  const card = data.shots[0].directorConstraintCard!;
  const image = constraintGenerationDraft(data, 'shot:a', card)!;
  data = saveWorkspaceDraft(data, { ...image, prompt: '改后的素模动作关系卡' }, image.revision)!;
  assert.equal(constraintGenerationDraft(data, 'shot:a', card)!.prompt, '改后的素模动作关系卡');
  const a = initialWorkspaceDraft(data, 'shot:a', 'video')!;
  const b = initialWorkspaceDraft(data, 'shot:b', 'video')!;
  data = saveConstraintVideoDraft(data, a, { ...card, imagePath: '/card.png' })!;
  assert.equal(saveConstraintVideoDraft(data, a, card), null);
  assert.equal(initialWorkspaceDraft(data, 'shot:b', 'video')!.prompt, b.prompt);
});

test('scene card uses shared confirmation/candidate flow; adoption flags stale drafts without changing submitted videos', async () => {
  let data = createWorkspaceConstraint(fixture(), 'shot:a', 'scene', 'shared')!;
  const old = { ...data.scenes[0].directorConstraintCard!, imagePath: '/old.png' };
  data = putWorkspaceConstraint(data, 'shot:a', 'scene', old)!;
  const video = initialWorkspaceDraft(data, 'shot:a', 'video')!;
  data = saveConstraintVideoDraft(data, video, old)!;
  const before = structuredClone(data.workspaceDrafts!['shot:a::video']);
  let calls = 0; let confirms = 0;
  const port: WorkspaceGenerationPort = {
    readProject: () => data, publish: (a, b) => { if (a !== data) return false; data = b; return true; }, persist: async () => {},
    bindTask: () => {}, confirm: async () => { confirms++; return true; },
    runGeneration: async (request) => { calls++; assert.deepEqual(request.referenceUrls, ['/road.png']);
      request.onTaskCreated?.('card-task'); return { success: true, taskId: 'card-task', resultPaths: ['/new.png'], resultUrls: [] }; },
  };
  const draft = constraintGenerationDraft(data, 'shot:a', old)!;
  assert.equal((await submitWorkspaceGeneration(port, draft, 'card-submit', 'ask')).status, 'succeeded');
  assert.equal(calls, 1); assert.equal(confirms, 1);
  const version = data.projectObjects!.versions.find((v) => v.generationSnapshot?.objectId === draft.objectId)!;
  assert.equal(version.selected, false);
  assert.equal(data.scenes[0].directorConstraintCard!.imagePath, '/old.png');
  data = selectAssetVersion(data, draft.objectId, version.id);
  assert.equal(data.scenes[0].directorConstraintCard!.imagePath, '/new.png');
  assert.deepEqual(data.workspaceDrafts!['shot:a::video'], before);
  assert.equal(staleConstraintDrafts(data, data.scenes[0].directorConstraintCard!).length, 1);
  assert.equal(data.shots[0].videoPath, undefined);
  assert.equal(data.workspaceSubmissions!['card-submit'].draft.references[0].path, '/road.png');
});

test('constraint paid boundary refuses non-scene refs and cancelling confirmation calls no executor', async () => {
  let data = createWorkspaceConstraint(fixture(), 'shot:a', 'scene', 'shared')!;
  const draft = data.workspaceDrafts!['director-constraint:shared::image'];
  let calls = 0;
  const port: WorkspaceGenerationPort = { readProject: () => data, publish: (a, b) => { if (a !== data) return false; data = b; return true; },
    persist: async () => {}, bindTask: () => {}, confirm: async () => false,
    runGeneration: async () => { calls++; throw new Error('must not run'); } };
  assert.equal((await submitWorkspaceGeneration(port, { ...draft, references: [{ id: 'p', type: 'image', path: '/driver.png', label: '人' }] }, 'invalid', 'ask')).status, 'invalid');
  assert.equal((await submitWorkspaceGeneration(port, draft, 'cancelled', 'ask')).status, 'cancelled');
  assert.equal(calls, 0);
});

test('deleting scene/card cleans owned draft and live references but preserves unrelated history', () => {
  let data = createWorkspaceConstraint(fixture(), 'shot:a', 'scene', 'shared')!;
  const card = { ...data.scenes[0].directorConstraintCard!, imagePath: '/card.png' };
  data = putWorkspaceConstraint(data, 'shot:a', 'scene', card)!;
  data = saveConstraintVideoDraft(data, initialWorkspaceDraft(data, 'shot:a', 'video')!, card)!;
  for (const target of ['scene:road', 'director-constraint:shared']) {
    const next = deleteProjectObject(data, target, 5).data;
    assert.equal(next.projectObjects!.objects.some((item) => item.id === 'director-constraint:shared'), false);
    assert.equal(next.workspaceDrafts!['director-constraint:shared::image'], undefined);
    assert.equal(next.workspaceDrafts!['shot:a::video'].references.some((ref) => ref.objectId === 'director-constraint:shared'), false);
    assert.ok(workspaceDraftErrors(next.workspaceDrafts!['shot:a::video']).some((error) => error.includes('移除')));
    assert.equal(next.shots.length, 2);
    assert.equal(next.characters[0].assetImagePath, '/driver.png');
  }
});

test('constraint creation respects scene/shot locks and requires a live shot', () => {
  const data = fixture();
  assert.equal(createWorkspaceConstraint(data, 'missing', 'shot', 'x'), null);
  for (const id of ['shot:a', 'scene:road']) {
    const locked = { ...data, projectObjects: { ...data.projectObjects!, objects: data.projectObjects!.objects.map((item) => item.id === id ? { ...item, locked: true } : item) } };
    assert.equal(createWorkspaceConstraint(locked, 'shot:a', 'scene', 'x'), null);
  }
});

test('legacy card prompt is readable as an image draft and workspace Agent context identifies its separate edit scope', () => {
  const card = { id: 'old', createdAt: 1, imagePath: '/old.png', prompt: '旧约束卡的站位提示词' };
  const data = putWorkspaceConstraint(fixture(), 'shot:a', 'shot', card)!;
  const draft = initialWorkspaceDraft(data, 'director-constraint:old', 'image')!;
  assert.equal(draft.prompt, card.prompt);
  assert.deepEqual(draft.references.map((ref) => ref.path), ['/road.png']);
  assert.equal(initialWorkspaceDraft(data, draft.objectId, 'video'), null);
  const changed = saveWorkspaceDraft(data, { ...draft, prompt: '修改约束卡的机位' }, 0)!;
  assert.equal(changed.shots[0].videoPrompt, data.shots[0].videoPrompt);
  assert.match(buildWorkspaceAgentContext(changed), /output_type 必须为 image/);
});
