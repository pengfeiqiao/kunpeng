import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkshopData } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects } from '../projectObjects/migrate.ts';
import { prepareLegacyShotGeneration } from './legacyShotGeneration.ts';
import { reserveWorkspaceSubmission, receiveWorkspaceResult } from './submissions.ts';
import { replaceLegacyShots, removeLegacyShot, applyLegacyShotCommand, mergeLegacyShotEdits } from './legacyShotReplacement.ts';
import { restoreProjectSnapshot } from '../projectObjects/snapshots.ts';
import type { ProjectCommandState } from '../projectObjects/projectCommands.ts';

function fixture(): ProjectCommandState {
  let data = migrateWorkshopProjectObjects({ ...emptyWorkshopData('replace'), shots: ['a', 'b'].map((id, index) => ({ id,
    shotNo: String(index + 1), description: id, characterIds: [], imagePrompt: id, videoPrompt: id, imagePath: `/${id}.png`,
  })) }, 1);
  data = prepareLegacyShotGeneration(data, ['a', 'b'], 'image', 2).data;
  data = reserveWorkspaceSubmission(data, data.workspaceDrafts!['shot:a::image'], 'paid', 3)!;
  return { workshop: data, canvas: { nodes: ['a', 'b'].map((id, index) => ({ id, type: 'image', position: { x: index * 400, y: 50 },
    data: { projectObjectId: `shot:${id}`, generatedImageUrl: `/${id}.png` } })), edges: [{ id: 'e', source: 'a', target: 'b' }] } };
}

test('replace reuses stable IDs, deletes omitted objects through projectCommands and takes one restorable pre-edit snapshot', () => {
  const before = fixture(); const bytes = JSON.stringify(before);
  const next = replaceLegacyShots(before, [{ ...before.workshop.shots[1], shotNo: '1', imagePrompt: 'B 新稿' },
    { id: 'c', shotNo: '2', characterIds: [], description: 'C', imagePrompt: 'C 新稿' }], () => 'new', 4);
  assert.deepEqual(next.workshop.shots.map((shot) => shot.id), ['b', 'c']);
  assert.equal(next.workshop.workspaceDrafts!['shot:b::image'].prompt, 'B 新稿');
  assert.equal(next.workshop.workspaceDrafts!['shot:a::image'], undefined);
  assert.equal(next.workshop.projectObjects!.objects.some((item) => item.id === 'shot:a'), false);
  assert.equal(next.canvas.nodes.some((node) => node.id === 'a'), false); assert.equal(next.canvas.edges.length, 0);
  assert.equal(next.workshop.projectSnapshots!.length, 1);
  assert.deepEqual(next.workshop.workspaceSubmissions, before.workshop.workspaceSubmissions);
  const restored = restoreProjectSnapshot(next.workshop, next.workshop.projectSnapshots![0]);
  assert.equal(restored.status, 'restored'); assert.deepEqual(restored.workshop?.shots, before.workshop.shots);
  assert.deepEqual(restored.canvas, before.canvas); assert.equal(JSON.stringify(before), bytes);
});

test('renumbering swaps identity without swapping drafts; no-ID compatibility matches original labels', () => {
  const before = fixture();
  const next = replaceLegacyShots(before, [{ ...before.workshop.shots[0], shotNo: '2' }, { ...before.workshop.shots[1], shotNo: '1' }], () => 'new', 5);
  assert.deepEqual(next.workshop.shots.map((shot) => [shot.id, shot.shotNo]), [['a', '2'], ['b', '1']]);
  assert.equal(next.workshop.workspaceDrafts!['shot:a::image'].prompt, 'a');
  const compat = replaceLegacyShots(before, [{ shotNo: '1', description: 'updated', characterIds: [] }], () => 'new', 5);
  assert.equal(compat.workshop.shots[0].id, 'a');
  assert.equal(compat.workshop.shots[0].imagePath, '/a.png');
});

test('remove preserves paid binding; late output goes to inbox, not reused shot number; deleted task identity cannot be recreated', () => {
  const before = fixture(); const binding = { submissionId: 'paid', snapshot: before.workshop.workspaceSubmissions!.paid.draft };
  const next = removeLegacyShot(before, 'a', 4);
  const late = receiveWorkspaceResult(next.workshop, binding, 'native', ['/late.png'], 5);
  assert.equal(late.shots.length, 1); assert.equal(late.shots[0].id, 'b');
  assert.equal(late.projectObjects!.media.find((item) => item.path === '/late.png')?.ownerObjectId, undefined);
  assert.throws(() => replaceLegacyShots(next, [{ id: 'a', shotNo: '1', description: '', characterIds: [] }], () => 'new'), /历史生成任务/);
});

test('locked objects, duplicate identity/labels and stale project publication reject the whole transaction', () => {
  const before = fixture();
  assert.throws(() => replaceLegacyShots(before, [before.workshop.shots[0], before.workshop.shots[0]], () => 'new'), /重复/);
  before.workshop.projectObjects!.objects.find((item) => item.id === 'shot:a')!.locked = true;
  assert.throws(() => replaceLegacyShots(before, [], () => 'new'), /锁定/);
  assert.throws(() => removeLegacyShot(before, 'a'), /锁定/);
  let writes = 0;
  assert.equal(applyLegacyShotCommand({ read: () => before, publish: () => { writes++; return true; } }, 'other', () => before), false);
  assert.equal(writes, 0);
  assert.equal(applyLegacyShotCommand({ read: () => before, publish: () => false }, 'replace', () => before), false);
});

test('merge reference edits do not replay the original prompt patch after rebasing; new shots retain multimodal defaults', () => {
  let before = fixture().workshop;
  before = migrateWorkshopProjectObjects({ ...before, characters: [{ id: 'actor', name: 'A', appearance: '', personality: '',
    assetImagePath: '/actor.png', voicePath: '/voice.wav' }],
    shots: before.shots.map((shot) => ({ ...shot, extraRefImages: ['/ref.png'], workspaceReferenceProjection: undefined })), workspaceDrafts: undefined });
  before.shots[0].imagePrompt = '@图片一 提示词';
  const next = mergeLegacyShotEdits(before, [{ ...before.shots[0], extraRefImages: [], imagePrompt: '@图片一 提示词' },
    { id: 'c', shotNo: '3', characterIds: ['actor'], voiceCharacterIds: ['actor'], description: '',
      videoPrompt: '@图片一 人物 @音频一 台词', directorPrevisVideoPaths: ['/previs.mp4'] }], () => 'new');
  assert.match(next.workspaceDrafts!['shot:a::image'].prompt, /参考已移除/);
  assert.deepEqual(next.workspaceDrafts!['shot:c::video'].references.map((ref) => ref.path), ['/actor.png', '/previs.mp4', '/voice.wav']);
});
