import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkshopData } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects } from '../projectObjects/migrate.ts';
import { buildImageRefPaths, buildVideoRefPaths, videoPromptForShot } from '../workshop/shotRefs.ts';
import { applyWorkshopShotPatch, undoWorkshopShotChange } from '../projectObjects/workshopCollaboration.ts';
import { initialWorkspaceDraft, saveWorkspaceDraft } from './drafts.ts';
import { editWorkspaceShot, editWorkspaceProjectTemplate, mergeWorkspaceShots } from './shotEdits.ts';
import { receiveWorkspaceResult } from './submissions.ts';

function fixture() {
  return migrateWorkshopProjectObjects({ ...emptyWorkshopData('shot-edits'), characters: [
    { id: 'driver', name: '司机', appearance: '', personality: '', assetImagePath: '/driver.png' },
  ], scenes: [{ id: 'road', name: '公路', description: '', assetImagePath: '/road.png' }],
  shots: [{ id: 's', shotNo: '01', description: '司机开车', dialogue: '停车', characterIds: ['driver'], sceneId: 'road',
    imagePrompt: '@图片一 公路，@图片二 司机', videoPrompt: '经典内容', universalVideoPrompt: '新版内容', videoPromptTemplate: 'legacy' }],
  }, 1);
}
const context = (data: ReturnType<typeof fixture>) => ({ characters: data.characters, scenes: data.scenes, props: data.props });

test('workspace prompt and references project together to legacy collectors without changing script facts or other output type', () => {
  const before = fixture(); const draft = initialWorkspaceDraft(before, 'shot:s', 'image')!;
  const refs = [...draft.references].reverse();
  const saved = saveWorkspaceDraft(before, { ...draft, prompt: '@图片一 司机，@图片二 公路', references: refs }, 0, 2)!;
  assert.equal(saved.shots[0].imagePrompt, saved.workspaceDrafts![draft.id].prompt);
  assert.deepEqual(buildImageRefPaths(saved.shots[0], context(saved)), ['/driver.png', '/road.png']);
  assert.deepEqual(buildVideoRefPaths(saved.shots[0], context(saved)), ['/road.png', '/driver.png']);
  assert.equal(saved.shots[0].dialogue, before.shots[0].dialogue);
  assert.equal(saved.shots[0].description, before.shots[0].description);
  assert.deepEqual(saved.shots[0].characterIds, before.shots[0].characterIds);
  assert.equal(saved.shots[0].videoPrompt, before.shots[0].videoPrompt);
  const empty = saveWorkspaceDraft(saved, { ...initialWorkspaceDraft(saved, 'shot:s', 'image')!, references: [], prompt: '无参考' }, 1)!;
  assert.deepEqual(buildImageRefPaths(empty.shots[0], context(empty)), []);
});

test('compatibility prompt edits update the same draft/revision; stale async workspace writes cannot overwrite them', () => {
  const before = fixture(); const draft = initialWorkspaceDraft(before, 'shot:s', 'image')!;
  const saved = saveWorkspaceDraft(before, { ...draft, references: [...draft.references].reverse(), prompt: '@图片一 司机' }, 0, 2)!;
  const pending = initialWorkspaceDraft(saved, 'shot:s', 'image')!;
  const edited = editWorkspaceShot(saved, '01', { imagePrompt: '@图片一 司机向右看' }, 3);
  assert.equal(edited.workspaceDrafts![draft.id].prompt, '@图片一 司机向右看');
  assert.equal(edited.workspaceDrafts![draft.id].revision, 2);
  assert.deepEqual(edited.workspaceDrafts![draft.id].references, pending.references);
  assert.equal(saveWorkspaceDraft(edited, { ...pending, prompt: '迟到回复' }, pending.revision), null);
  assert.equal(edited.shots[0].dialogue, before.shots[0].dialogue);
});

test('classic/universal switching preserves both prompt slots and the selected draft uses its own template', () => {
  const before = fixture(); const draft = initialWorkspaceDraft(before, 'shot:s', 'video')!;
  const classic = saveWorkspaceDraft(before, { ...draft, prompt: '经典改词' }, 0)!;
  const universal = editWorkspaceShot(classic, '01', { videoPromptTemplate: 'universal' });
  assert.equal(universal.workspaceDrafts![draft.id].prompt, '新版内容');
  assert.equal(universal.workspaceDrafts![draft.id].promptTemplate, 'universal');
  const changed = saveWorkspaceDraft(universal, { ...initialWorkspaceDraft(universal, 'shot:s', 'video')!, prompt: '新版改词' }, 2)!;
  const inactive = editWorkspaceShot(changed, '01', { videoPrompt: '经典另改' });
  assert.equal(inactive.workspaceDrafts![draft.id].prompt, '新版改词');
  const back = editWorkspaceShot(inactive, '01', { videoPromptTemplate: 'legacy' });
  assert.equal(back.workspaceDrafts![draft.id].prompt, '经典另改');
  assert.equal(back.shots[0].universalVideoPrompt, '新版改词');
  assert.equal(videoPromptForShot(back.shots[0], context(back), { template: 'legacy', includeStoryboardBoards: false }), '经典另改');
});

test('old Agent optimistic patch and undo share draft commands; new workspace edits invalidate stale owner revision', () => {
  const before = fixture(); const owner = before.projectObjects!.objects.find((item) => item.id === 'shot:s')!;
  const manual = saveWorkspaceDraft(before, { ...initialWorkspaceDraft(before, owner.id, 'image')!, prompt: '人工稿' }, 0)!;
  assert.equal(applyWorkshopShotPatch(manual, { shotNo: '01', expectedVersion: owner.version, patch: { imagePrompt: '迟到Agent' }, actor: 'agent' }).status, 'conflict');
  const applied = applyWorkshopShotPatch(manual, { shotNo: '01', expectedVersion: owner.version + 1, patch: { imagePrompt: 'Agent稿' }, actor: 'agent', now: 3 });
  assert.equal(applied.status, 'applied'); if (applied.status !== 'applied') return;
  assert.equal(applied.data.workspaceDrafts!['shot:s::image'].prompt, 'Agent稿');
  const undone = undoWorkshopShotChange(applied.data, applied.changeSet, 4);
  assert.equal(undone.data.shots[0].imagePrompt, '人工稿');
  assert.equal(undone.data.workspaceDrafts!['shot:s::image'].prompt, '人工稿');
  const afterUser = editWorkspaceShot(applied.data, '01', { imagePrompt: '后来的人工稿' }, 4);
  assert.deepEqual(undoWorkshopShotChange(afterUser, applied.changeSet).skippedFields, ['imagePrompt']);
});

test('migration rebuilds read-only prompt/reference projection from canonical drafts and preserves submitted historical settings', () => {
  const before = fixture(); const draft = initialWorkspaceDraft(before, 'shot:s', 'video')!;
  const saved = saveWorkspaceDraft(before, { ...draft, prompt: '生成时的词' }, 0, 2)!;
  const done = receiveWorkspaceResult(saved, { submissionId: 'submission', snapshot: saved.workspaceDrafts![draft.id] }, 'task', ['/out.mp4'], 3);
  const history = JSON.stringify(done.workspaceSubmissions);
  const edited = editWorkspaceShot(done, '01', { videoPrompt: '之后修改的词' }, 4);
  const corrupted = { ...edited, shots: edited.shots.map((shot) => ({ ...shot, videoPrompt: '旧投影', workspaceReferenceProjection: undefined })) };
  const restored = migrateWorkshopProjectObjects(corrupted, 5);
  assert.equal(restored.shots[0].videoPrompt, '之后修改的词');
  assert.deepEqual(buildVideoRefPaths(restored.shots[0], context(restored)), draft.references.map((r) => r.path));
  assert.equal(JSON.stringify(restored.workspaceSubmissions), history);
  assert.equal(restored.projectObjects!.versions.find((item) => item.generationSnapshot)?.generationSnapshot?.prompt, '生成时的词');
  const twice = migrateWorkshopProjectObjects(restored, 6);
  assert.deepEqual(migrateWorkshopProjectObjects(twice, 7), twice);
});

test('global template changes update only inheriting drafts and clearing a shot override resumes project template', () => {
  const before = fixture(); before.shots.push({ ...before.shots[0], id: 'b', shotNo: '02', videoPromptTemplate: undefined });
  let data = migrateWorkshopProjectObjects(before, 2);
  for (const id of ['shot:s', 'shot:b']) data = saveWorkspaceDraft(data, initialWorkspaceDraft(data, id, 'video')!, 0, 3)!;
  const updated = editWorkspaceProjectTemplate(data, 'universal', 4);
  assert.equal(updated.workspaceDrafts!['shot:s::video'].promptTemplate, 'legacy');
  assert.equal(updated.workspaceDrafts!['shot:b::video'].promptTemplate, 'universal');
  assert.equal(updated.workspaceDrafts!['shot:b::video'].prompt, '新版内容');
  const inherited = editWorkspaceShot(updated, '01', { videoPromptTemplate: undefined }, 5);
  assert.equal(inherited.workspaceDrafts!['shot:s::video'].promptTemplate, 'universal');
});

test('facts and task status do not change explicit references; locked objects reject prompt edits but allow task receipts', () => {
  const before = fixture(); const draft = initialWorkspaceDraft(before, 'shot:s', 'image')!;
  const saved = saveWorkspaceDraft(before, { ...draft, references: [], prompt: '无参考' }, 0)!;
  const edited = editWorkspaceShot(saved, '01', { description: '原本允许的人工剧情修改', characterIds: [] });
  assert.equal(edited.workspaceDrafts, saved.workspaceDrafts);
  assert.deepEqual(buildImageRefPaths(edited.shots[0], context(edited)), []);
  const locked = { ...edited, projectObjects: { ...edited.projectObjects!, objects: edited.projectObjects!.objects.map((o) => o.id === 'shot:s' ? { ...o, locked: true } : o) } };
  assert.equal(editWorkspaceShot(locked, '01', { imagePrompt: '不应覆盖' }), locked);
  const receipt = editWorkspaceShot(locked, '01', { genStatus: 'done', genTaskId: 'task' });
  assert.equal(receipt.shots[0].genStatus, 'done');
  assert.equal(receipt.projectObjects, locked.projectObjects);
});

test('batch merge edits materialized drafts without resetting references or submitted history', () => {
  const before = fixture(); const draft = initialWorkspaceDraft(before, 'shot:s', 'image')!;
  const prepared = saveWorkspaceDraft(before, { ...draft, references: [], prompt: '手写' }, 0, 2)!;
  const saved = receiveWorkspaceResult(prepared, { submissionId: 'batch-history', snapshot: prepared.workspaceDrafts![draft.id] }, 'batch-task', ['/old-image.png'], 2);
  const history = JSON.stringify(saved.projectObjects!.versions);
  const pending = initialWorkspaceDraft(saved, 'shot:s', 'image')!;
  const after = mergeWorkspaceShots(saved, [{ shotNo: '01', imagePrompt: '批量改词' } as typeof saved.shots[0]], () => 'new', 3);
  assert.equal(after.workspaceDrafts![draft.id].prompt, '批量改词');
  assert.equal(after.shots[0].imagePrompt, '批量改词');
  assert.deepEqual(after.workspaceDrafts![draft.id].references, []);
  assert.equal(after.shots[0].dialogue, before.shots[0].dialogue);
  assert.equal(saveWorkspaceDraft(after, { ...pending, prompt: '迟到改词' }, pending.revision), null);
  assert.equal(after.workspaceSubmissions, saved.workspaceSubmissions);
  assert.equal(JSON.stringify(after.projectObjects!.versions), history);
});

test('batch merge follows stable identity through simultaneous renumbering and creates new object drafts', () => {
  const before = fixture(); before.shots.push({ ...before.shots[0], id: 'b', shotNo: '02', imagePrompt: 'B' });
  let data = migrateWorkshopProjectObjects(before, 2);
  data = saveWorkspaceDraft(data, initialWorkspaceDraft(data, 'shot:s', 'image')!, 0)!;
  const after = mergeWorkspaceShots(data, [
    { id: 's', shotNo: '02', imagePrompt: 'A改号' },
    { id: 'b', shotNo: '01', imagePrompt: 'B改号' },
    { shotNo: '03', imagePrompt: 'C新增', description: '新镜头', characterIds: [] },
  ] as typeof data.shots, () => 'c', 3);
  assert.deepEqual(after.shots.map((s) => [s.id, s.shotNo, s.imagePrompt]), [['s', '02', 'A改号'], ['b', '01', 'B改号'], ['c', '03', 'C新增']]);
  assert.equal(after.workspaceDrafts!['shot:s::image'].prompt, 'A改号');
  assert.equal(after.workspaceDrafts!['shot:b::image'].prompt, 'B改号');
  assert.equal(after.workspaceDrafts!['shot:c::image'].prompt, 'C新增');
  assert.ok(after.projectObjects!.objects.some((o) => o.id === 'shot:c'));
});

test('batch merge rejects locked, duplicate and colliding identities atomically', () => {
  const before = fixture(); before.shots.push({ ...before.shots[0], id: 'b', shotNo: '02' });
  const data = migrateWorkshopProjectObjects(before, 2);
  const locked = { ...data, projectObjects: { ...data.projectObjects!, objects: data.projectObjects!.objects.map((o) => o.id === 'shot:b' ? { ...o, locked: true } : o) } };
  const original = JSON.stringify(locked);
  assert.throws(() => mergeWorkspaceShots(locked, [{ shotNo: '01', imagePrompt: '不落盘' }, { shotNo: '02', imagePrompt: '锁定' }] as typeof data.shots, () => 'new'), /锁定/);
  assert.equal(JSON.stringify(locked), original);
  assert.throws(() => mergeWorkspaceShots(data, [{ id: 'unknown', shotNo: '01' }] as typeof data.shots, () => 'new'), /已被其他对象/);
  assert.throws(() => mergeWorkspaceShots(data, [{ id: 's', shotNo: '03' }, { id: 's', shotNo: '04' }] as typeof data.shots, () => 'new'), /重复对象/);
});

test('legacy shots without IDs keep the migration identity when merging and empty batches are no-ops', () => {
  const before = fixture(); before.shots[0].id = undefined; before.projectObjects = undefined;
  const data = migrateWorkshopProjectObjects(before, 1);
  const saved = saveWorkspaceDraft(data, initialWorkspaceDraft(data, 'shot:01', 'image')!, 0)!;
  const after = mergeWorkspaceShots(saved, [{ shotNo: '01', imagePrompt: '兼容旧项目' }] as typeof data.shots, () => 'new', 2);
  assert.equal(after.shots[0].id, '01');
  assert.equal(after.workspaceDrafts!['shot:01::image'].prompt, '兼容旧项目');
  assert.equal(mergeWorkspaceShots(after, [], () => 'new'), after);
});
