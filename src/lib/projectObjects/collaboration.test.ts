import assert from 'node:assert/strict';
import test from 'node:test';
import type { UnifiedProjectRegistry } from './types.ts';
import { applyProjectObjectPatch, undoProjectChangeSet } from './collaboration.ts';
import { applyWorkshopShotPatch, undoWorkshopShotChange } from './workshopCollaboration.ts';
import type { WorkshopData } from '../workshop/types.ts';

function registry(locked = false): UnifiedProjectRegistry {
  return {
    schemaVersion: 1,
    projectId: 'p1',
    updatedAt: 1,
    media: [],
    versions: [],
    objects: [{
      id: 'shot:1', projectId: 'p1', kind: 'shot', source: 'workshop', sourceId: 's1',
      label: '镜头 1', relationIds: [], version: 2, updatedAt: 1, locked,
    }],
  };
}

test('agent write performs optimistic version validation and reports a three-way conflict', () => {
  const result = applyProjectObjectPatch(registry(), {
    objectId: 'shot:1', expectedVersion: 1, patch: { label: 'Agent 名称' }, actor: 'agent', now: 10,
  });
  assert.equal(result.status, 'conflict');
  if (result.status === 'conflict') assert.deepEqual(result.conflict.choices, ['keep-user', 'apply-agent', 'keep-both']);
});

test('locked objects reject agent writes but allow user writes', () => {
  const blocked = applyProjectObjectPatch(registry(true), {
    objectId: 'shot:1', expectedVersion: 2, patch: { label: 'Agent 名称' }, actor: 'agent', now: 10,
  });
  assert.equal(blocked.status, 'locked');
  const userWrite = applyProjectObjectPatch(registry(true), {
    objectId: 'shot:1', expectedVersion: 2, patch: { label: '我的名称' }, actor: 'user', now: 11,
  });
  assert.equal(userWrite.status, 'applied');
});

test('undo restores only untouched agent fields and preserves later user edits', () => {
  const applied = applyProjectObjectPatch(registry(), {
    objectId: 'shot:1', expectedVersion: 2, patch: { label: 'Agent 名称', archived: true }, actor: 'agent', now: 10,
  });
  assert.equal(applied.status, 'applied');
  if (applied.status !== 'applied') return;
  const userEdited = {
    ...applied.registry,
    objects: applied.registry.objects.map((item) => item.id === 'shot:1' ? { ...item, label: '用户新名称', version: 4 } : item),
  };
  const undone = undoProjectChangeSet(userEdited, applied.changeSet, 20);
  const object = undone.registry.objects[0];
  assert.equal(object.label, '用户新名称');
  assert.equal(object.archived, undefined);
  assert.deepEqual(undone.revertedFields, ['archived']);
  assert.deepEqual(undone.skippedFields, ['label']);
});

function workshopFixture(): WorkshopData {
  return {
    projectId: 'p1', currentStep: 'prompts', stepStatuses: {}, script: '', storyFacts: [], bibles: {},
    characters: [], scenes: [], props: [],
    shots: [{ id: 's1', shotNo: '01-01', description: '原描述', dialogue: '', shotType: '中景', camera: '固定', mood: '', durationSec: 8, characterIds: [], sceneId: '' }],
    projectObjects: {
      schemaVersion: 1, projectId: 'p1', updatedAt: 1, media: [], versions: [],
      objects: [{ id: 'shot:s1', projectId: 'p1', kind: 'shot', source: 'workshop', sourceId: 's1', relationIds: [], version: 2, updatedAt: 1 }],
    },
  } as unknown as WorkshopData;
}

test('workshop shot writes reject stale versions and locked objects', () => {
  const stale = applyWorkshopShotPatch(workshopFixture(), { shotNo: '01-01', expectedVersion: 1, patch: { description: 'Agent' }, actor: 'agent' });
  assert.equal(stale.status, 'conflict');
  const lockedData = workshopFixture();
  lockedData.projectObjects!.objects[0].locked = true;
  const locked = applyWorkshopShotPatch(lockedData, { shotNo: '01-01', expectedVersion: 2, patch: { description: 'Agent' }, actor: 'agent' });
  assert.equal(locked.status, 'locked');
});

test('workshop shot undo preserves later user edits', () => {
  const applied = applyWorkshopShotPatch(workshopFixture(), {
    shotNo: '01-01', expectedVersion: 2,
    patch: { description: 'Agent 描述', mood: '紧张' }, actor: 'agent', now: 10,
  });
  assert.equal(applied.status, 'applied');
  if (applied.status !== 'applied') return;
  const later = {
    ...applied.data,
    shots: applied.data.shots.map((shot) => ({ ...shot, description: '用户后来修改' })),
  };
  const undone = undoWorkshopShotChange(later, applied.changeSet, 11);
  assert.equal(undone.data.shots[0].description, '用户后来修改');
  assert.equal(undone.data.shots[0].mood, '');
  assert.deepEqual(undone.revertedFields, ['mood']);
  assert.deepEqual(undone.skippedFields, ['description']);
});
