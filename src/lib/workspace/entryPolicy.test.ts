import test from 'node:test';
import assert from 'node:assert/strict';
import { canOpenProjectWorkspace } from './entryPolicy.ts';
import { emptyWorkshopData } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects } from '../projectObjects/migrate.ts';
import { workspaceSelection } from './contentModel.ts';

test('workspace entry rejects partially loaded or mismatched project identities', () => {
  const empty = emptyWorkshopData('p');
  assert.equal(canOpenProjectWorkspace('p', 'p', empty), false);
  const data = migrateWorkshopProjectObjects({ ...empty, shots: [{ id: 'a', shotNo: '01', description: '司机', characterIds: [] }] }, 1);
  assert.equal(canOpenProjectWorkspace('p', 'p', data), true);
  assert.equal(canOpenProjectWorkspace(null, 'p', data), false);
  assert.equal(canOpenProjectWorkspace('other', 'p', data), false);
  assert.equal(canOpenProjectWorkspace('p', 'other', data), false);
  assert.equal(canOpenProjectWorkspace('p', 'p', null), false);
  assert.equal(canOpenProjectWorkspace('p', 'p', { ...data, projectSpec: undefined }), false);
  assert.equal(canOpenProjectWorkspace('p', 'p', { ...data, projectObjects: { ...data.projectObjects!, projectId: 'other' } }), false);
});

test('a hydrated blank project enters the new workspace without seeding placeholder assets', () => {
  const data = migrateWorkshopProjectObjects(emptyWorkshopData('p'), 1);
  assert.equal(data.colorPalettes.length, 0);
  assert.equal(data.projectObjects!.objects.some((object) => ['shot', 'character', 'scene', 'prop', 'scene-asset'].includes(object.kind)), false);
  assert.equal(canOpenProjectWorkspace('p', 'p', data), true);
  const selection = workspaceSelection(data);
  assert.ok(selection); assert.equal(selection.selected, undefined);
  assert.equal(selection.groups.flatMap((group) => group.items).length, 0);
  assert.equal(canOpenProjectWorkspace('p', 'p', migrateWorkshopProjectObjects(data, 2)), true);
});

test('archiving the last asset does not strand the project in the legacy entry', () => {
  const data = migrateWorkshopProjectObjects({ ...emptyWorkshopData('p'), shots: [{ id: 'a', shotNo: '01', description: '司机', characterIds: [] }] }, 1);
  const archived = { ...data, projectObjects: { ...data.projectObjects!, objects: data.projectObjects!.objects.map((object) => ({ ...object, archived: true })) } };
  assert.equal(canOpenProjectWorkspace('p', 'p', archived), true);
});
