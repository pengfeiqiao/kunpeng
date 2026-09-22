import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkshopSaveNormalizer } from './saveNormalizer.ts';
import { migrateWorkshopProjectObjects } from '../projectObjects/migrate.ts';
import { emptyWorkshopData } from './types.ts';

test('selection/history saves preserve references; content or registry edits still reconcile', () => {
  let calls = 0;
  const normalize = createWorkshopSaveNormalizer(data => { calls++; return migrateWorkshopProjectObjects(data, calls); });
  const initial = normalize(emptyWorkshopData('p'));
  const view = { ...initial, projectViewState: { selectedObjectIds: ['character:c'] }, projectSnapshots: [] };
  assert.equal(normalize(view), view); assert.equal(normalize(view), view); assert.equal(calls, 1);
  const edited = normalize({ ...view, characters: [{ id: 'c', name: '新人', appearance: '', personality: '' }] });
  assert.equal(calls, 2); assert.ok(edited.projectObjects?.objects.some(o => o.id === 'character:c'));
  normalize({ ...edited, projectObjects: { ...edited.projectObjects!, updatedAt: 100 } });
  assert.equal(calls, 3);
  normalize(emptyWorkshopData('other')); assert.equal(calls, 4);
});
