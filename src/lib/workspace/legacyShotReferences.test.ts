import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkshopData } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects } from '../projectObjects/migrate.ts';
import { saveWorkspaceDraft } from './drafts.ts';
import { editLegacyShotReferences, legacyShotDraft, setLegacySceneReferences, setLegacyGlobalPalette, preserveLegacyReferenceDrafts } from './legacyShotReferences.ts';
import { reserveWorkspaceSubmission } from './submissions.ts';
import { remapShotPromptRefs } from '../workshop/shotRefs.ts';

function fixture() {
  return migrateWorkshopProjectObjects({ ...emptyWorkshopData('refs'), characters: ['a', 'b'].map((id) => ({ id, name: id,
    appearance: '', personality: '', assetImagePath: `/${id}.png`, voicePath: `/${id}.wav` })),
    shots: [{ id: 's', shotNo: '1', description: '原描述', dialogue: '原对白', characterIds: ['a', 'b'], voiceCharacterIds: ['a', 'b'],
      imagePrompt: '@图片一 A @图片二 B', videoPrompt: '@图片二 B @图片一 A @音频一 A @音频二 B' }] }, 1);
}

test('legacy image and audio reference reorder writes shared drafts and per-output projection, not submitted history', () => {
  const before = fixture(); const draft = legacyShotDraft(before, before.shots[0], 'video')!;
  const reserved = reserveWorkspaceSubmission(before, draft, 'frozen', 2)!;
  const next = editLegacyShotReferences(reserved, '1', { characterIds: ['b', 'a'], voiceCharacterIds: ['b', 'a'] }, 3);
  assert.equal(next.workspaceDrafts!['shot:s::image'].prompt, '@图片二 A @图片一 B');
  assert.equal(next.workspaceDrafts!['shot:s::video'].prompt, '@图片一 B @图片二 A @音频二 A @音频一 B');
  assert.deepEqual(next.shots[0].workspaceReferenceProjection?.video, next.workspaceDrafts!['shot:s::video'].references);
  assert.deepEqual(next.workspaceSubmissions, reserved.workspaceSubmissions);
  assert.equal(next.shots[0].description, '原描述'); assert.equal(next.shots[0].dialogue, '原对白');
});

test('removing legacy references keeps missing markers; old UI pre-remapping cannot strip them or double-renumber', () => {
  let before = fixture();
  for (const type of ['image', 'video'] as const) before = saveWorkspaceDraft(before, legacyShotDraft(before, before.shots[0], type)!, 0)!;
  const shot = before.shots[0]; const patch = { characterIds: ['b'] };
  const uiRemap = remapShotPromptRefs(shot, { ...shot, ...patch }, before);
  const next = editLegacyShotReferences(before, '1', { ...uiRemap, ...patch });
  assert.match(next.workspaceDrafts!['shot:s::image'].prompt, /【参考已移除：角色 a】 A @图片一 B/);
  assert.deepEqual(next.workspaceDrafts!['shot:s::image'].references.map((ref) => ref.path), ['/b.png']);
  assert.equal(before.workspaceDrafts!['shot:s::image'].prompt, '@图片一 A @图片二 B');
});

test('explicit custom reference order survives unrelated legacy changes; image and video draft scopes remain separate', () => {
  let before = fixture();
  const image = legacyShotDraft(before, before.shots[0], 'image')!;
  before = saveWorkspaceDraft(before, { ...image, prompt: '@图片一 自选', references: [{ id: 'custom', type: 'image', label: '自选', path: '/custom.png' }] }, 0)!;
  const next = editLegacyShotReferences(before, '1', { extraRefImages: ['/extra.png'] });
  assert.deepEqual(next.workspaceDrafts!['shot:s::image'].references.map((ref) => ref.path), ['/custom.png', '/extra.png']);
  assert.deepEqual(next.workspaceDrafts!['shot:s::video'].references.map((ref) => ref.path), ['/a.png', '/b.png', '/a.wav', '/b.wav', '/extra.png']);
  assert.equal(next.workspaceDrafts!['shot:s::image'].prompt, '@图片一 自选');
});

test('reference edits reject locked or changed stable identity before any mutation', () => {
  const before = fixture(); const bytes = JSON.stringify(before);
  assert.throws(() => editLegacyShotReferences(before, '1', { id: 'other', characterIds: [] }), /稳定 ID/);
  assert.equal(JSON.stringify(before), bytes);
  before.projectObjects!.objects.find((item) => item.id === 'shot:s')!.locked = true;
  assert.throws(() => editLegacyShotReferences(before, '1', { characterIds: [] }), /锁定/);
  assert.equal(before.workspaceDrafts, undefined);
});

test('scene reference defaults and global palette controls update shared drafts; per-shot overrides and frozen tasks remain', () => {
  let before = fixture();
  before = migrateWorkshopProjectObjects({ ...before, scenes: [{ id: 'scene', name: 'S', description: '', assetImagePath: '/scene.png' }],
    colorPalettes: [{ id: 'palette', name: 'P', colors: [], assetImagePath: '/palette.png', createdAt: 1 }],
    shots: before.shots.map((shot) => ({ ...shot, sceneId: 'scene', imagePrompt: '@图片一 场景 @图片二 A @图片三 B' })) });
  const next = setLegacySceneReferences(before, 'scene', ['/angle.png']);
  assert.deepEqual(next.workspaceDrafts!['shot:s::image'].references.map((ref) => ref.path), ['/angle.png', '/a.png', '/b.png']);
  assert.match(next.workspaceDrafts!['shot:s::image'].prompt, /参考已移除/);
  assert.equal(next.shots[0].sceneImagePaths, undefined);
  const palette = setLegacyGlobalPalette(next, 'palette');
  assert.deepEqual(palette.workspaceDrafts!['shot:s::image'].references.map((ref) => ref.path), ['/angle.png', '/a.png', '/b.png', '/palette.png']);
  assert.equal(palette.shots[0].colorPaletteId, undefined);
  const override = { ...before, shots: before.shots.map((shot) => ({ ...shot, sceneImagePaths: ['/override.png'] })) };
  assert.equal(setLegacySceneReferences(override, 'scene', ['/angle.png']).workspaceDrafts, undefined);
});

test('adopting a different asset version does not silently change existing or legacy generation references', () => {
  const before = fixture();
  const after = { ...before, characters: before.characters.map((character) => character.id === 'a' ? { ...character, assetImagePath: '/new-a.png' } : character) };
  const next = preserveLegacyReferenceDrafts(before, after);
  assert.equal(next.characters[0].assetImagePath, '/new-a.png');
  assert.deepEqual(next.workspaceDrafts!['shot:s::image'].references.map((ref) => ref.path), ['/a.png', '/b.png']);
  assert.equal(next.shots[0].imagePrompt, before.shots[0].imagePrompt);
  assert.equal(preserveLegacyReferenceDrafts(next, { ...next, characters: after.characters }).workspaceDrafts, next.workspaceDrafts);
});
