import test from 'node:test';
import assert from 'node:assert/strict';
import type { Node, Edge } from 'reactflow';
import { emptyWorkshopData } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects } from './migrate.ts';
import { selectProjectVersionCommand, deleteProjectObjectCommand } from './projectCommands.ts';
import { collectReferencesFromSnapshot } from '../canvas/collectRefsModel.ts';

function fixture() {
  const workshop = migrateWorkshopProjectObjects({
    ...emptyWorkshopData('commands'),
    characters: [{ id: 'c', name: '角色', personality: '', appearance: '', assetImagePath: '/v1.png', candidates: [
      { path: '/v1.png', source: 'upload' as const, createdAt: 1 },
      { path: '/v2.png', source: 'generate' as const, createdAt: 2 },
    ] }],
    shots: [{ id: 's', shotNo: '01', description: '人物行走', dialogue: '别走', characterIds: ['c'] }],
  }, 10);
  const canvas = {
    nodes: [
      { id: 'owner', type: 'image', data: { projectObjectId: 'character:c', generatedImageUrl: '/v1.png' }, position: { x: 50, y: 50 } },
      { id: 'target', type: 'video', data: { referenceImages: [{ url: '/v1.png' }], generatedVideoUrl: '/output.mp4' }, position: { x: 300, y: 50 } },
    ] as Node[],
    edges: [{ id: 'ref', source: 'owner', target: 'target' }] as Edge[],
  };
  return { workshop, canvas };
}

test('version command publishes consistent workshop, registry and canvas without changing edges or source facts', () => {
  const state = fixture();
  const v2 = state.workshop.projectObjects!.versions.find((item) => !item.selected)!;
  const next = selectProjectVersionCommand(state, 'character:c', v2.id, 20)!;
  assert.equal(next.workshop.characters[0].assetImagePath, '/v2.png');
  const selected = next.workshop.projectObjects!.versions.find((item) => item.selected)!;
  assert.equal(selected.id, v2.id);
  assert.equal(next.workshop.projectObjects!.media.find((item) => item.id === selected.mediaObjectId)!.path, '/v2.png');
  assert.equal(next.canvas.nodes[0].data.generatedImageUrl, '/v2.png');
  assert.equal(next.canvas.edges, state.canvas.edges);
  assert.deepEqual(next.canvas.nodes[0].position, state.canvas.nodes[0].position);
  assert.equal(next.workshop.shots, state.workshop.shots);
  assert.equal(state.workshop.characters[0].assetImagePath, '/v1.png');
  assert.equal(next.workshop.projectObjects!.versions.length, 2);
  assert.deepEqual(collectReferencesFromSnapshot('target', next.canvas).images.map((ref) => ref.url), ['/v2.png']);
  const reopened = migrateWorkshopProjectObjects(next.workshop, 30);
  assert.deepEqual(reopened.projectObjects!.media.map((item) => item.id).sort(), next.workshop.projectObjects!.media.map((item) => item.id).sort());
  assert.equal(reopened.projectObjects!.versions.find((item) => item.selected)?.mediaObjectId, v2.mediaObjectId);
});

test('candidate media nodes and other media types never get overwritten when adopting a version', () => {
  const state = fixture();
  const v2 = state.workshop.projectObjects!.versions.find((item) => !item.selected)!;
  const candidate: Node = { id: 'candidate', type: 'image', position: { x: 0, y: 0 }, data: {
    projectObjectId: 'character:c', mediaObjectId: 'old-media', versionObjectId: 'old-version', mediaPurpose: 'candidate-version', generatedImageUrl: '/candidate.png',
  } };
  const audio: Node = { id: 'audio', type: 'audio', position: { x: 0, y: 0 }, data: { projectObjectId: 'character:c', audioUrl: '/voice.mp3' } };
  state.canvas.nodes.push(candidate, audio);
  const next = selectProjectVersionCommand(state, 'character:c', v2.id)!;
  assert.equal(next.canvas.nodes.find((node) => node.id === candidate.id), candidate);
  assert.equal(next.canvas.nodes.find((node) => node.id === audio.id), audio);
});

test('delete command removes project/edge/direct reference pointers and captures media paths for restore', () => {
  const state = fixture();
  const next = deleteProjectObjectCommand(state, 'character:c', 30)!;
  assert.equal(next.workshop.characters.length, 0);
  assert.deepEqual(next.workshop.shots[0].characterIds, []);
  assert.deepEqual(next.canvas.nodes.map((node) => node.id), ['target']);
  assert.deepEqual(next.canvas.edges, []);
  assert.deepEqual(collectReferencesFromSnapshot('target', next.canvas).images, []);
  const snapshot = next.workshop.projectSnapshots!.find((item) => item.id === next.snapshotId)!;
  assert.ok(snapshot.mediaPaths.includes('/v1.png'));
  assert.ok(snapshot.canvasPayload.includes('/output.mp4'));
  assert.equal(state.canvas.nodes.length, 2);
  const ids = new Set([...next.impact.objectIds, ...next.impact.mediaIds, ...next.impact.versionIds]);
  for (const record of [...next.workshop.projectObjects!.objects, ...next.workshop.projectObjects!.media, ...next.workshop.projectObjects!.versions]) {
    assert.ok(record.relationIds.every((id) => !ids.has(id)));
  }
});

test('locked selection and unknown deletion do not produce partial project mutations', () => {
  const state = fixture();
  state.workshop.projectObjects!.versions.find((item) => item.selected)!.locked = true;
  const other = state.workshop.projectObjects!.versions.find((item) => !item.selected)!;
  assert.equal(selectProjectVersionCommand(state, 'character:c', other.id), null);
  assert.equal(deleteProjectObjectCommand(state, 'missing'), null);
  assert.equal(state.workshop.characters[0].assetImagePath, '/v1.png');
});

test('legacy workshopRef nodes are removed only in their own project', () => {
  const state = fixture();
  state.canvas.nodes.push(...['commands', 'another'].map((projectId) => ({
    id: projectId, type: 'image', position: { x: 0, y: 0 },
    data: { workshopRef: { projectId, kind: 'character', id: 'c' } },
  })));
  const next = deleteProjectObjectCommand(state, 'character:c')!;
  assert.deepEqual(next.canvas.nodes.map((node) => node.id), ['target', 'another']);
});

test('deleting adopted media projects the remaining version into a surviving owner node', () => {
  const state = fixture();
  const current = state.workshop.projectObjects!.versions.find((item) => item.selected)!;
  Object.assign(state.canvas.nodes[0].data, { mediaObjectId: current.mediaObjectId, versionObjectId: current.id, mediaPurpose: 'current-version' });
  const next = deleteProjectObjectCommand(state, current.id)!;
  assert.equal(next.workshop.characters[0].assetImagePath, '/v2.png');
  assert.equal(next.canvas.nodes.find((node) => node.id === 'owner')!.data.generatedImageUrl, '/v2.png');
  assert.equal(next.canvas.edges.length, 1);
  assert.deepEqual(collectReferencesFromSnapshot('target', next.canvas).images.map((item) => item.url), ['/v2.png']);
});

test('deleting a shot removes its private constraint and media without dangling ownership', () => {
  const state = fixture();
  state.workshop.shots[0].directorConstraintCard = { id: 'card', imagePath: '/card.png', createdAt: 1 };
  state.workshop = migrateWorkshopProjectObjects(state.workshop, 20);
  const next = deleteProjectObjectCommand(state, 'shot:s')!;
  assert.equal(next.workshop.projectObjects!.objects.some((item) => item.id === 'director-constraint:card'), false);
  assert.equal(next.workshop.projectObjects!.media.some((item) => item.path === '/card.png'), false);
});

test('deleted audio and legacy storyboard bytes are not resurrected on project reopen', () => {
  const state = fixture();
  Object.assign(state.workshop.shots[0], {
    generatedAudios: [{ characterId: 'c', characterName: '角色', path: '/voice.mp3', duration: 2 }],
    storyboardFrames: [{ id: 'frame', prompt: '', imagePath: '/frame.png', candidates: [{ path: '/frame.png', source: 'upload', createdAt: 1 }] }],
    storyboardBoards: [{ id: 'board', frameIds: ['frame'], imagePath: '/board.png', createdAt: 1 }],
  });
  state.workshop = migrateWorkshopProjectObjects(state.workshop, 20);
  for (const path of ['/voice.mp3', '/frame.png', '/board.png']) {
    const media = state.workshop.projectObjects!.media.find((item) => item.path === path)!;
    state.workshop = deleteProjectObjectCommand(state, media.id)!.workshop;
    state.workshop = migrateWorkshopProjectObjects(state.workshop, 30);
    assert.equal(state.workshop.projectObjects!.media.some((item) => item.path === path), false, path);
  }
});
