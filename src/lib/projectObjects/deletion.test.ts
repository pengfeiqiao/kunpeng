import test from 'node:test';
import assert from 'node:assert/strict';
import type { WorkshopData } from '../workshop/types.ts';
import { emptyWorkshopData } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects, stableProjectObjectId } from './migrate.ts';
import {
  assessProjectObjectDeletion,
  deleteProjectObject,
  projectDeletionTargetForCanvasNode,
  removeCanvasNodesFromView,
} from './deletion.ts';

function fixture(): WorkshopData {
  const base = emptyWorkshopData('project-delete');
  return migrateWorkshopProjectObjects({
    ...base,
    characters: [{ id: 'c1', name: '姮氏', personality: '', appearance: '', assetImagePath: '/media/c1-v2.png', candidates: [
      { path: '/media/c1-v1.png', source: 'upload', createdAt: 1 },
      { path: '/media/c1-v2.png', source: 'generate', createdAt: 2 },
    ] }],
    shots: [{
      id: 's1', shotNo: '01-01', description: '', dialogue: '', durationSec: 5,
      characterIds: ['c1'], voiceCharacterIds: [], videoPrompt: '姮氏走近镜头',
    }],
  }, 10);
}

test('project delete reports affected shots and prompt count', () => {
  const data = fixture();
  const objectId = stableProjectObjectId('character', 'c1');
  const impact = assessProjectObjectDeletion(data, objectId, 20);
  assert.deepEqual(impact?.affectedShotNos, ['01-01']);
  assert.equal(impact?.videoPromptCount, 1);
  assert.equal(impact?.mediaIds.length, 2);
});

test('deleting one media version keeps history and selects a fallback path', () => {
  const data = fixture();
  const ownerId = stableProjectObjectId('character', 'c1');
  const selected = data.projectObjects!.versions.find((item) => item.ownerObjectId === ownerId && item.selected)!;
  const result = deleteProjectObject(data, selected.id, 30);
  assert.equal(result.deleted, true);
  assert.equal(result.data.characters[0].assetImagePath, '/media/c1-v1.png');
  assert.equal(result.data.characters[0].candidates?.length, 1);
  assert.equal(result.data.projectObjects?.versions.some((item) => item.id === selected.id), false);
  assert.equal(result.data.projectObjects?.media.some((item) => item.id === selected.mediaObjectId), false);
});

test('deleting an owner removes project references but never deletes media bytes', () => {
  const data = fixture();
  const ownerId = stableProjectObjectId('character', 'c1');
  const result = deleteProjectObject(data, ownerId, 40);
  assert.equal(result.data.characters.length, 0);
  assert.deepEqual(result.data.shots[0].characterIds, []);
  assert.equal(result.data.shots[0].promptNeedsRefresh, true);
  assert.equal(result.data.projectObjects?.objects.some((item) => item.id === ownerId), false);
  assert.ok(result.impact.mediaIds.length > 0);
});

test('removing a canvas node from view preserves project media and prunes only connected edges', () => {
  const data = fixture();
  const beforeMedia = data.projectObjects!.media.map((item) => item.id);
  const view = removeCanvasNodesFromView(
    [{ id: 'keep' }, { id: 'remove' }],
    [{ source: 'keep', target: 'remove' }, { source: 'keep', target: 'other' }],
    ['remove'],
  );
  assert.deepEqual(view.nodes.map((item) => item.id), ['keep']);
  assert.deepEqual(view.edges, [{ source: 'keep', target: 'other' }]);
  assert.deepEqual(data.projectObjects!.media.map((item) => item.id), beforeMedia);
});

test('canvas node deletion targets the narrowest linked project version first', () => {
  assert.equal(projectDeletionTargetForCanvasNode({
    data: { projectObjectId: 'object', mediaObjectId: 'media', versionObjectId: 'version' },
  }), 'version');
  assert.equal(projectDeletionTargetForCanvasNode({ data: { projectObjectId: 'object' } }), 'object');
});
