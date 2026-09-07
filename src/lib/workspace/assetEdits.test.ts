import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkshopData } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects } from '../projectObjects/migrate.ts';
import { initialWorkspaceDraft, saveWorkspaceDraft } from './drafts.ts';
import { editWorkspaceAssetPrompt, editWorkspaceAssetSettings } from './assetEdits.ts';
import { receiveWorkspaceResult } from './submissions.ts';

function fixture() {
  return migrateWorkshopProjectObjects({ ...emptyWorkshopData('asset-edits'), characters: [{ id: 'c', name: '司机',
    appearance: '灰衣', personality: '沉稳', assetImagePath: '/original.png', assetPrompt: '普通中文', assetPromptMj: 'cinematic driver',
    assetEngine: 'midjourney-v8.2', assetAspectRatio: '9:16', assetResolution: '4k' }],
    scenes: [{ id: 's', name: '公路', description: '雨夜', assetPrompt: '雨夜公路' }],
    props: [{ id: 'p', name: '方向盘', description: '旧皮革', assetPrompt: '道具细节' }],
    colorPalettes: [{ id: 'palette', name: '冷雨', createdAt: 1, assetPrompt: '低饱和' }],
  }, 1);
}

test('asset draft initializes the selected model prompt and original per-asset parameters', () => {
  const data = fixture(); const draft = initialWorkspaceDraft(data, 'character:c', 'image')!;
  assert.equal(draft.prompt, 'cinematic driver');
  assert.equal(draft.params.aspectRatio, '9:16');
  assert.equal(draft.params.resolution, '4k');
  const freshSwitch = saveWorkspaceDraft(data, { ...draft, engineId: 'gpt-image-2' }, 0, 2)!;
  assert.equal(freshSwitch.workspaceDrafts![draft.id].prompt, '普通中文');
  const gpt = editWorkspaceAssetSettings(data, 'character', 'c', { engineId: 'gpt-image-2' }, 2);
  assert.equal(gpt.workspaceDrafts!['character:c::image'].prompt, '普通中文');
  assert.equal(gpt.characters[0].assetPromptMj, 'cinematic driver');
});

test('active asset prompt edits are shared; inactive family edits and model switching retain both templates', () => {
  let data = fixture();
  data = editWorkspaceAssetPrompt(data, 'character', 'c', 'MJ修改', 'mj', 2);
  const pending = initialWorkspaceDraft(data, 'character:c', 'image')!;
  data = editWorkspaceAssetPrompt(data, 'character', 'c', '普通修改', 'gpt', 3);
  assert.equal(data.workspaceDrafts![pending.id].prompt, 'MJ修改');
  data = editWorkspaceAssetSettings(data, 'character', 'c', { engineId: 'gpt-image-2', aspectRatio: '3:4', resolution: '2k' }, 4);
  assert.equal(data.workspaceDrafts![pending.id].prompt, '普通修改');
  assert.equal(data.characters[0].assetEngine, 'gpt-image-2');
  assert.equal(data.characters[0].assetAspectRatio, '3:4');
  assert.equal(data.characters[0].assetResolution, '2k');
  assert.equal(saveWorkspaceDraft(data, { ...pending, prompt: '迟到MJ' }, pending.revision), null);
  const active = initialWorkspaceDraft(data, pending.objectId, 'image')!;
  const back = saveWorkspaceDraft(data, { ...active, engineId: 'midjourney-v8.1' }, active.revision, 5)!;
  assert.equal(back.workspaceDrafts![pending.id].prompt, 'MJ修改');
  assert.equal(back.characters[0].assetPrompt, '普通修改');
});

test('asset projection preserves identity, references, adopted media, history and migration idempotence', () => {
  const data = fixture(); const draft = initialWorkspaceDraft(data, 'character:c', 'image')!;
  const saved = saveWorkspaceDraft(data, { ...draft, prompt: '新MJ', references: [{ id: 'ref', path: '/reference.png', label: '参考', type: 'image' }] }, 0, 2)!;
  const done = receiveWorkspaceResult(saved, { submissionId: 'a', snapshot: saved.workspaceDrafts![draft.id] }, 't', ['/candidate.png'], 3);
  const history = JSON.stringify(done.workspaceSubmissions);
  const after = editWorkspaceAssetPrompt(done, 'character', 'c', '更改MJ', 'mj', 4);
  assert.equal(after.characters[0].appearance, '灰衣');
  assert.equal(after.characters[0].personality, '沉稳');
  assert.equal(after.characters[0].assetImagePath, '/original.png');
  assert.deepEqual(after.workspaceDrafts![draft.id].references, saved.workspaceDrafts![draft.id].references);
  assert.equal(JSON.stringify(after.workspaceSubmissions), history);
  const rebuilt = migrateWorkshopProjectObjects(after, 5);
  assert.equal(rebuilt.characters[0].assetPromptMj, '更改MJ');
  assert.deepEqual(migrateWorkshopProjectObjects(rebuilt, 6), rebuilt);
});

test('all four asset kinds use the same command and locked/deleted assets reject edits', () => {
  const data = fixture();
  for (const [kind, id, objectId] of [['scene', 's', 'scene:s'], ['prop', 'p', 'prop:p'], ['colorPalette', 'palette', 'scene-asset:palette']] as const) {
    const edited = editWorkspaceAssetPrompt(data, kind, id, '统一修改', 'gpt');
    assert.equal(edited.workspaceDrafts![`${objectId}::image`].prompt, '统一修改');
  }
  const locked = { ...data, projectObjects: { ...data.projectObjects!, objects: data.projectObjects!.objects.map((o) => o.id === 'character:c' ? { ...o, locked: true } : o) } };
  assert.equal(editWorkspaceAssetPrompt(locked, 'character', 'c', '拒绝', 'mj'), locked);
  assert.equal(editWorkspaceAssetSettings(locked, 'character', 'c', { engineId: 'gpt-image-2' }), locked);
  assert.equal(editWorkspaceAssetPrompt(data, 'character', 'missing', '拒绝'), data);
});
