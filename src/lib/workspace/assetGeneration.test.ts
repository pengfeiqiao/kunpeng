import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyWorkshopData } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects } from '../projectObjects/migrate.ts';
import { initialWorkspaceDraft, saveWorkspaceDraft } from './drafts.ts';
import { prepareWorkspaceAssetGeneration } from './assetGeneration.ts';
import { submitWorkspaceGeneration, type WorkspaceGenerationPort } from './generationCommand.ts';
import { workspaceAssetCandidates } from './assetCandidates.ts';
import { receiveWorkspaceResult } from './submissions.ts';
import { selectProjectVersionCommand } from '../projectObjects/projectCommands.ts';

function fixture() {
  const migrated = migrateWorkshopProjectObjects({ ...emptyWorkshopData('asset-generation'), characters: [{ id: 'driver', name: '司机',
    appearance: '灰衣', personality: '沉稳', assetImagePath: '/adopted.png', assetPrompt: '只调整衣袖，不修改人脸',
    assetPromptMj: 'cinematic driver', assetEngine: 'gpt-image-2.5', assetAspectRatio: '9:16' }],
  }, 1);
  migrated.projectSpec = { ...migrated.projectSpec!, generationConfirmation: 'always-confirm' };
  return migrated;
}

test('legacy asset generation materializes exact visible prompt; no forced three-view rewrite or implicit output reference', () => {
  const before = fixture(); const prepared = prepareWorkspaceAssetGeneration(before, 'character', 'driver', undefined, 2);
  assert.ok(!('error' in prepared)); if ('error' in prepared) return;
  assert.equal(prepared.draft.prompt, '只调整衣袖，不修改人脸');
  assert.deepEqual(prepared.draft.references, []);
  assert.equal(prepared.data.characters[0].assetImagePath, '/adopted.png');
  assert.equal(before.workspaceDrafts, undefined);
  const repeated = prepareWorkspaceAssetGeneration(prepared.data, 'character', 'driver');
  assert.ok(!('error' in repeated)); if ('error' in repeated) return;
  assert.equal(repeated.data, prepared.data);
  assert.equal(repeated.draft.revision, prepared.draft.revision);
});

test('asset preparation preserves explicit reference order, params and edited prompt; engine override reads retained model template', () => {
  const before = fixture(); const draft = initialWorkspaceDraft(before, 'character:driver', 'image')!;
  const data = saveWorkspaceDraft(before, { ...draft, prompt: '@图片二 服装，@图片一 面部', params: { aspectRatio: '3:4', resolution: '4k' },
    references: [{ id: 'a', type: 'image', label: '人脸', path: '/face.png' }, { id: 'b', type: 'image', label: '衣服', path: '/clothes.png' }] }, 0)!;
  const prepared = prepareWorkspaceAssetGeneration(data, 'character', 'driver');
  assert.ok(!('error' in prepared)); if ('error' in prepared) return;
  assert.deepEqual(prepared.draft, data.workspaceDrafts![draft.id]);
  const mj = prepareWorkspaceAssetGeneration(data, 'character', 'driver', 'midjourney-v8.2');
  assert.ok(!('error' in mj)); if ('error' in mj) return;
  assert.equal(mj.draft.prompt, 'cinematic driver');
  assert.equal(mj.draft.engineId, 'midjourney-v8.2');
  assert.deepEqual(mj.draft.references, prepared.draft.references);
  assert.equal(mj.data.characters[0].assetPrompt, prepared.draft.prompt);
});

test('missing prompt, references, deleted or locked asset fail before publication or execution', () => {
  const before = fixture(); before.characters[0].assetPrompt = '';
  assert.match((prepareWorkspaceAssetGeneration(before, 'character', 'driver') as {error:string}).error, /提示词/);
  before.characters[0].assetPrompt = '@图片一 没有对应参考';
  assert.match((prepareWorkspaceAssetGeneration(before, 'character', 'driver') as {error:string}).error, /对应参考/);
  assert.ok('error' in prepareWorkspaceAssetGeneration(before, 'character', 'missing'));
  before.projectObjects!.objects.find((o) => o.id === 'character:driver')!.locked = true;
  assert.match((prepareWorkspaceAssetGeneration(before, 'character', 'driver') as {error:string}).error, /锁定/);
  assert.equal(before.workspaceDrafts, undefined);
});

test('prepared asset uses shared confirmation and canvasGen contract: cancellation zero calls, all results candidate, uncertain never retries', async () => {
  const prepared = prepareWorkspaceAssetGeneration(fixture(), 'character', 'driver');
  assert.ok(!('error' in prepared)); if ('error' in prepared) return;
  let data = prepared.data; let calls = 0; let approved = false; let uncertain = false;
  const port: WorkspaceGenerationPort = {
    readProject: id => id === data.projectId ? data : null,
    publish: (before, after) => { if (before !== data) return false; data = after; return true; },
    persist: async () => {}, bindTask: () => {}, confirm: async snapshot => { assert.equal(snapshot.prompt, prepared.draft.prompt); return approved; },
    runGeneration: async request => { calls++; assert.equal(request.strictPaidSafety, true);
      assert.equal(request.workspaceBinding?.snapshot.objectId, 'character:driver');
      assert.deepEqual(request.referenceUrls, []);
      return uncertain ? { success: false, taskId: '', submissionUncertain: true, error: 'unknown', resultPaths: [], resultUrls: [] }
        : { success: true, taskId: 'task', resultPaths: ['/candidate1.png', '/candidate2.png'], resultUrls: [] };
    },
  };
  assert.equal((await submitWorkspaceGeneration(port, prepared.draft, 'cancel', 'ask')).status, 'cancelled');
  assert.equal(calls, 0);
  approved = true;
  assert.equal((await submitWorkspaceGeneration(port, prepared.draft, 'success', 'ask')).status, 'succeeded');
  assert.equal(calls, 1);
  assert.equal(data.characters[0].assetImagePath, '/adopted.png');
  const candidates = data.projectObjects!.versions.filter((v) => v.generationSnapshot);
  assert.equal(candidates.length, 2); assert.ok(candidates.every((v) => !v.selected));
  assert.deepEqual(data.workspaceDrafts![prepared.draft.id].references, []);
  uncertain = true;
  assert.equal((await submitWorkspaceGeneration(port, prepared.draft, 'unknown', 'ask')).status, 'uncertain');
  assert.equal((await submitWorkspaceGeneration(port, prepared.draft, 'retry', 'ask')).status, 'invalid');
  assert.equal(calls, 2);
});

test('legacy store asset button delegates once and has no second executor, file copy or automatic adoption', () => {
  const source = readFileSync(new URL('../../stores/workshopStore.ts', import.meta.url), 'utf8');
  const body = source.split('  generateAsset: async (kind, id, engineId) => {')[1].split('  generateSceneVariants:')[0];
  assert.equal((body.match(/await generateWorkspaceAsset\(/g) ?? []).length, 1);
  assert.doesNotMatch(body, /runGeneration\(|addAssetCandidate\(|copyIntoProject\(|styleSuffix|three-view/);
  assert.match(body, /project\.id !== data\.projectId/);
});

test('compatibility candidate projection sees registry outputs without array copies; adoption uses the same version and preserves history', () => {
  const before = fixture(); const draft = initialWorkspaceDraft(before, 'character:driver', 'image')!;
  const data = receiveWorkspaceResult(before, { submissionId: 'new', snapshot: draft }, 't', ['/new.png'], 2);
  assert.equal(data.characters[0].candidates, undefined);
  const views = workspaceAssetCandidates(data, 'character', 'driver');
  assert.deepEqual(views.map((v) => v.path), ['/adopted.png', '/new.png']);
  assert.equal(views[1].prompt, draft.prompt);
  const version = data.projectObjects!.versions.find((v) => v.generationSnapshot)!;
  const selected = selectProjectVersionCommand({ workshop: data, canvas: { nodes: [], edges: [] } }, 'character:driver', version.id)!.workshop;
  assert.equal(selected.characters[0].assetImagePath, '/new.png');
  assert.equal(selected.projectObjects!.versions.find((v) => v.id === version.id)!.selected, true);
  assert.deepEqual(workspaceAssetCandidates(selected, 'character', 'driver').map((v) => v.path), ['/adopted.png', '/new.png']);
  assert.equal(selected.workspaceSubmissions, data.workspaceSubmissions);
  const unindexed = { ...selected, characters: selected.characters.map((c) => ({ ...c, candidates: [{ path: '/upload.png', source: 'upload' as const, createdAt: 3 }] })) };
  assert.equal(workspaceAssetCandidates(unindexed, 'character', 'driver').length, 3);
  const source = readFileSync(new URL('../../stores/workshopStore.ts', import.meta.url), 'utf8');
  assert.match(source.split('  selectAssetCandidate: (kind, id, path) => {')[1].split('  setShotSceneImages:')[0], /selectProjectAssetVersion\(ownerId, version.id\)/);
});
