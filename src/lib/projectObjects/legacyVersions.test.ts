import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkshopData } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects } from './migrate.ts';
import { reconcileLegacyMediaVersions } from './legacyVersions.ts';
import { selectProjectVersionCommand, deleteProjectObjectCommand } from './projectCommands.ts';
import { workspaceMediaVersions, workspaceHistoricalParameters } from '../workspace/mediaView.ts';
import { initialWorkspaceDraft } from '../workspace/drafts.ts';

function fixture() {
  return { ...emptyWorkshopData('old-versions'), shots: [{ id: 's', shotNo: '01', description: '司机', characterIds: [],
    imagePath: '/old-image.png', videoPath: '/old-video.mp4', extraRefImages: ['/reference.png'],
    generatedAudios: [{ id: 'a', characterId: 'voice', characterName: '旁白', path: '/old.wav', duration: 3 }],
    storyboardBoards: [{ id: 'board', imagePath: '/board.png', frameIds: [], createdAt: 1 }],
  }] };
}

test('old media receives stable selectable versions without invented prompt, engine, price or references', () => {
  const data = migrateWorkshopProjectObjects(fixture(), 1);
  const media = data.projectObjects!.media.find((item) => item.path === '/old-image.png')!;
  const image = workspaceMediaVersions(data, 'shot:s', 'image')[0];
  assert.equal(image.media.id, media.id);
  assert.ok(image.version); assert.equal(image.adopted, false);
  assert.equal(image.version.prompt, undefined); assert.equal(image.version.engineId, undefined);
  assert.equal(image.version.generationSnapshot, undefined);
  assert.equal(workspaceHistoricalParameters(image.version), '历史参数未记录');
  assert.deepEqual(initialWorkspaceDraft(data, 'shot:s', 'video')!.references.map((ref) => ref.path), ['/reference.png']);
  assert.equal(data.projectObjects!.media.find((item) => item.path === '/board.png')!.versionObjectId, undefined);
  assert.equal(data.projectObjects!.media.find((item) => item.path === '/reference.png')!.versionObjectId, undefined);
});

test('old image/video/audio reconciliation remains byte-identical across repeated migrations', () => {
  const data = migrateWorkshopProjectObjects(fixture(), 1);
  const second = migrateWorkshopProjectObjects(data, 2);
  const third = migrateWorkshopProjectObjects(second, 3);
  assert.equal(JSON.stringify(second), JSON.stringify(data)); assert.deepEqual(third, second);
  assert.equal(reconcileLegacyMediaVersions(data.projectObjects!), data.projectObjects);
  assert.equal(data.projectObjects!.versions.length, 3);
});

test('adopting a legacy version uses one command for registry, workshop and canvas and survives reload', () => {
  const data = migrateWorkshopProjectObjects(fixture(), 1);
  const version = workspaceMediaVersions(data, 'shot:s', 'video')[0].version!;
  const canvas = { nodes: [{ id: 'node', type: 'video', position: { x: 20, y: 40 }, data: { projectObjectId: 'shot:s', mediaPurpose: 'current-version' } }], edges: [] };
  const next = selectProjectVersionCommand({ workshop: data, canvas }, 'shot:s', version.id, 2)!;
  assert.equal(next.workshop.shots[0].videoPath, '/old-video.mp4');
  assert.equal(next.canvas.nodes[0].data.localPath, '/old-video.mp4');
  assert.deepEqual(next.canvas.nodes[0].position, canvas.nodes[0].position);
  assert.equal(next.workshop.projectObjects!.versions.find((item) => item.id === version.id)!.selected, true);
  const reloaded = migrateWorkshopProjectObjects(next.workshop, 3);
  assert.equal(workspaceMediaVersions(reloaded, 'shot:s', 'video')[0].adopted, true);
  const locked = { ...next.workshop, projectObjects: { ...next.workshop.projectObjects!, versions: next.workshop.projectObjects!.versions.map((item) => item.id === version.id ? { ...item, locked: true } : item) } };
  const removed = deleteProjectObjectCommand({ workshop: locked, canvas }, version.id, 4)!;
  assert.equal(removed.workshop.shots[0].videoPath, undefined);
  assert.equal(migrateWorkshopProjectObjects(removed.workshop).projectObjects!.media.some((item) => item.path === '/old-video.mp4'), false);
});
