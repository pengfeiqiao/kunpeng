import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkshopData } from '../workshop/types.ts';
import { createProjectSnapshot, projectSnapshotList, restoreProjectSnapshot } from './snapshots.ts';

test('persistent list includes deletion and message snapshots after transient toast lifetime', () => {
  const data = emptyWorkshopData('snapshots');
  const canvas = { nodes: [], edges: [] };
  const message = createProjectSnapshot(data, canvas, { now: 1, messageId: 'm1', label: '消息前' });
  const deletion = createProjectSnapshot(data, canvas, { now: 2, label: '删除前' });
  const current = { ...data, projectSnapshots: [message, deletion] };
  const restoredFromDisk = JSON.parse(JSON.stringify(current));
  assert.deepEqual(projectSnapshotList(restoredFromDisk).map((item) => item.id), [deletion.id, message.id]);
  assert.equal(restoreProjectSnapshot(current, projectSnapshotList(current)[0]).status, 'restored');
  assert.deepEqual(current.projectSnapshots.map((item) => item.id), [message.id, deletion.id]);
});

test('list recovery uses existing active-generation guard and rejects foreign projects', () => {
  const data = emptyWorkshopData('one');
  const entry = createProjectSnapshot(data, { nodes: [], edges: [] });
  assert.equal(restoreProjectSnapshot(data, entry, { activePendingTaskIds: ['submitted-task'] }).status, 'confirmation-required');
  assert.equal(restoreProjectSnapshot(emptyWorkshopData('two'), entry).status, 'invalid');
});
