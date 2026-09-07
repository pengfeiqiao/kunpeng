import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkshopData } from '../workshop/types.ts';
import { createProjectBranch, createProjectSnapshot, restoreProjectSnapshot } from './snapshots.ts';

function workshop(): WorkshopData {
  return {
    projectId: 'p-1',
    currentStep: 'script',
    steps: {} as WorkshopData['steps'],
    synopsis: 'before',
    episodes: [], characters: [], scenes: [], props: [], colorPalettes: [], shots: [], changelog: [],
    projectObjects: {
      schemaVersion: 1,
      projectId: 'p-1',
      objects: [], versions: [], updatedAt: 1,
      media: [{
        id: 'm-1', projectId: 'p-1', kind: 'media-file', source: 'uploaded',
        relationIds: [], version: 1, updatedAt: 1, path: '/media/a.png', mediaType: 'image',
        purpose: 'ordinary-material', includeAsReference: false,
      }],
    },
  };
}

test('snapshot restore rolls back data and only retains media file references', () => {
  const data = workshop();
  const snapshot = createProjectSnapshot(data, { nodes: [], edges: [] }, { now: 10 });
  const current = { ...data, synopsis: 'after', projectSnapshots: [snapshot] };
  const result = restoreProjectSnapshot(current, snapshot);
  assert.equal(result.status, 'restored');
  assert.equal(result.workshop?.synopsis, 'before');
  assert.deepEqual(snapshot.mediaPaths, ['/media/a.png']);
  assert.equal(result.workshop?.projectSnapshots?.[0].id, snapshot.id);
});

test('branch shares media paths without embedding or copying media bytes', () => {
  const snapshot = createProjectSnapshot(workshop(), { nodes: [], edges: [] }, { now: 10 });
  const branch = createProjectBranch(snapshot, '方向 B', 20);
  assert.deepEqual(branch.mediaPaths, snapshot.mediaPaths);
  assert.notEqual(branch.mediaPaths, snapshot.mediaPaths);
  assert.equal(branch.workshopPayload, snapshot.workshopPayload);
});

test('snapshot strips embedded media bytes while retaining stable media paths', () => {
  const data = workshop();
  const snapshot = createProjectSnapshot(data, {
    nodes: [{ id: 'image-1', data: { localPath: '/tmp/frame.png', image: 'data:image/png;base64,AAAA' } }],
    edges: [],
  }, { now: 35 });

  assert.equal(snapshot.canvasPayload.includes('data:image/png;base64'), false);
  assert.deepEqual(snapshot.mediaPaths, ['/media/a.png', '/tmp/frame.png']);
});

test('snapshot with pending paid task requires explicit restore confirmation', () => {
  const snapshot = createProjectSnapshot(workshop(), { nodes: [], edges: [] }, { now: 10 });
  const options = { activePendingTaskIds: ['paid-task-1'] };
  assert.equal(restoreProjectSnapshot(workshop(), snapshot, options).status, 'confirmation-required');
  assert.equal(restoreProjectSnapshot(workshop(), snapshot, { ...options, confirmPending: true }).status, 'restored');
});
