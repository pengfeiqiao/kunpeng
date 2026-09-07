import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkshopData } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects } from '../projectObjects/migrate.ts';
import { selectWorkspaceObject, workspaceContentGroups, workspaceSelection } from './contentModel.ts';
import { initialWorkspaceDraft, saveWorkspaceDraft } from './drafts.ts';

function fixture() {
  return migrateWorkshopProjectObjects({ ...emptyWorkshopData('selection-test'), scenes: [
    { id: 'road', name: '公路', description: '' }, { id: 'car', name: '车内', description: '' },
  ], shots: [
    { id: 'a', shotNo: '01', sceneId: 'road', description: '司机察觉异响', characterIds: [], durationSec: 8, imagePath: '/a.png' },
    { id: 'b', shotNo: '02', sceneId: 'car', description: '转头', characterIds: [], durationSec: 5 },
    { id: 'c', shotNo: '03', sceneId: 'road', description: '回到公路', characterIds: [] },
  ] }, 1);
}

test('content groups preserve narrative order when a scene is revisited and expose all five shot fields', () => {
  const data = fixture();
  const groups = workspaceContentGroups(data).filter((group) => group.id !== 'assets');
  assert.deepEqual(groups.map((group) => group.label), ['公路', '车内', '公路']);
  assert.deepEqual(groups.flatMap((group) => group.items.map((item) => item.shotNo)), ['01', '02', '03']);
  const a = groups[0].items[0];
  assert.deepEqual([a.durationSec, a.description, a.thumbnailPath, a.status], [8, '司机察觉异响', '/a.png', '已有媒体']);
});

test('object selection persists stable identity but never overwrites drafts or reference relationships', () => {
  let data = fixture();
  const a = initialWorkspaceDraft(data, 'shot:a', 'image')!;
  data = saveWorkspaceDraft(data, { ...a, prompt: 'A草稿' }, 0)!;
  const snapshot = JSON.stringify(data);
  const b = selectWorkspaceObject(data, 'shot:b', 'video')!;
  assert.equal(b.selectedShotId, 'b');
  assert.deepEqual(b.selectedObjectIds, ['shot:b']);
  assert.equal(JSON.stringify(data), snapshot);
  const next = { ...data, projectViewState: b };
  assert.equal(workspaceSelection(next).selected?.id, 'shot:b');
  const restored = { ...next, projectViewState: selectWorkspaceObject(next, 'shot:a', 'image')! };
  assert.equal(initialWorkspaceDraft(restored, 'shot:a', 'image')!.prompt, 'A草稿');
  assert.equal(workspaceSelection(restored).media?.media.path, '/a.png');
  assert.equal(selectWorkspaceObject(data, 'deleted'), null);
});

test('stale media selection cannot preview another object and invalid stored output falls back safely', () => {
  const data = fixture();
  const aMedia = workspaceSelection({ ...data, projectViewState: { workspaceObjectId: 'shot:a', workspaceOutputType: 'image' } }).media!;
  const selected = workspaceSelection({ ...data, projectViewState: { workspaceObjectId: 'shot:b', workspaceMediaId: aMedia.media.id, workspaceOutputType: 'audio' } });
  assert.equal(selected.media, undefined);
  assert.equal(selected.outputType, 'video');
  const stale = workspaceSelection({ ...data, projectViewState: { workspaceObjectId: 'deleted', selectedShotId: 'c' } });
  assert.equal(stale.selected?.id, 'shot:c');
});

test('generated voice media is visible and directly selectable without becoming a generation reference', () => {
  const base = fixture();
  const data = migrateWorkshopProjectObjects({ ...base, shots: base.shots.map((shot, i) => i ? shot : {
    ...shot, generatedAudios: [{ characterName: '司机', characterId: 'driver', path: '/voice.wav', duration: 3 }],
  }) }, 2);
  const item = workspaceContentGroups(data).find((group) => group.id === 'audio')!.items[0];
  const view = selectWorkspaceObject(data, item.id)!;
  assert.equal(view.workspaceOutputType, 'audio');
  const selected = workspaceSelection({ ...data, projectViewState: view });
  assert.equal(selected.outputType, 'audio');
  assert.equal(selected.media?.media.path, '/voice.wav');
  assert.equal(selected.media?.media.purpose, 'candidate-version');
});
