import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkshopHistoryStorage } from './historyStorage.ts';
import type { WorkshopData } from './types';
function fixture() {
  const files = new Map<string, string>(); const writes: string[] = [];
  let fail = false;
  const storage = new WorkshopHistoryStorage({ read: async (_id, path) => files.get(path) ?? null,
    write: async (_id, path, body) => { if (fail) throw Error('disk'); files.set(path, body); writes.push(path); } });
  const data = { projectId: 'p', shots: [], projectSnapshots: [{ id: 's', label: '历史', createdAt: 1,
    workshopPayload: JSON.stringify({ projectId: 'p', shots: [] }), canvasPayload: '{"nodes":[],"edges":[]}',
    mediaPaths: ['/media.png'], pendingTaskIds: [] }] } as unknown as WorkshopData;
  return { files, writes, storage, data, fail: () => { fail = true; } };
}
test('legacy history survives split storage and repeated edits only write the live index', async () => {
  const f = fixture(); await f.storage.save('p', f.data);
  const stored = JSON.parse(f.files.get('workshop.json')!);
  assert.equal(stored.projectSnapshots[0].workshopPayload, undefined);
  assert.equal(f.writes.length, 2);
  await f.storage.save('p', { ...f.data, synopsis: 'changed' });
  assert.equal(f.writes.length, 3);
  const loaded = await f.storage.hydrate('p', stored);
  assert.deepEqual(loaded.projectSnapshots, f.data.projectSnapshots);
  await f.storage.save('p', loaded); assert.equal(f.writes.length, 4);
});
test('missing history is not silently discarded and write failure cannot replace the old index', async () => {
  const f = fixture(); f.files.set('workshop.json', 'original'); f.fail();
  await assert.rejects(f.storage.save('p', f.data)); assert.equal(f.files.get('workshop.json'), 'original');
  const g = fixture(); await g.storage.save('p', g.data);
  const stored = JSON.parse(g.files.get('workshop.json')!);
  g.files.delete(stored.projectSnapshots[0].historyPayloadFile);
  await assert.rejects(g.storage.hydrate('p', stored), /历史文件缺失/);
  stored.projectSnapshots[0].historyPayloadFile = '../other.json';
  await assert.rejects(g.storage.hydrate('p', stored), /索引无效/);
});
test('overlapping saves preserve invocation order and branches round-trip', async () => {
  const f = fixture(); const snap = f.data.projectSnapshots![0];
  const data = { ...f.data, projectBranches: [{ id: 'b', name: '分支', createdAt: 1, sourceSnapshotId: 's',
    workshopPayload: snap.workshopPayload, canvasPayload: snap.canvasPayload, mediaPaths: snap.mediaPaths }] };
  await Promise.all([f.storage.save('p', data), f.storage.save('p', { ...data, synopsis: 'latest' })]);
  const loaded = await f.storage.hydrate('p', JSON.parse(f.files.get('workshop.json')!));
  assert.equal(loaded.synopsis, 'latest'); assert.deepEqual(loaded.projectBranches, data.projectBranches);
});
test('40 large snapshots no longer contribute to ordinary save traffic', async () => {
  const f = fixture(); const payload = 'a'.repeat(900_000);
  f.data.projectSnapshots = Array.from({ length: 40 }, (_, i) => ({ ...f.data.projectSnapshots![0], id: `s${i}`, workshopPayload: `${payload}${i}` }));
  const before = JSON.stringify(f.data).length;
  await f.storage.save('p', f.data);
  const after = f.files.get('workshop.json')!.length;
  assert.ok(after < before / 100);
  const count = f.writes.length;
  await f.storage.save('p', { ...f.data, synopsis: 'edit' });
  assert.equal(f.writes.length - count, 1);
  console.log(`history benchmark: inline=${before} bytes, live index=${after} bytes, history retained=40`);
});

test('changed payloads on a reused record cannot reuse stale history files', async () => {
  const f = fixture(); await f.storage.save('p', f.data);
  f.data.projectSnapshots![0].workshopPayload = '{"projectId":"p","shots":["edited"]}';
  f.data.projectSnapshots![0].mediaPaths.push('/new.png');
  await f.storage.save('p', f.data);
  const loaded = await f.storage.hydrate('p', JSON.parse(f.files.get('workshop.json')!));
  assert.deepEqual(loaded.projectSnapshots, f.data.projectSnapshots);
});
