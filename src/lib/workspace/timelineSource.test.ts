import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkshopData } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects } from '../projectObjects/migrate.ts';
import { resolveTimelineSource, timelineInspectorRequest, validateTimelineInspectorRequest,
  dispatchTimelineInspectorRequest, WORKSPACE_INSPECTOR_REQUEST_EVENT } from './timelineSource.ts';

function fixture() {
  const data = migrateWorkshopProjectObjects({ ...emptyWorkshopData('p'), shots: [
    { id: 'one', shotNo: '01', description: '原镜头', characterIds: [], videoPath: '/old.mp4' },
    { id: 'two', shotNo: '02', description: '另一个镜头', characterIds: [], videoPath: '/two.mp4' },
  ] }, 1);
  const registry = data.projectObjects!;
  const original = registry.media.find((media) => media.path === '/old.mp4')!;
  const old = registry.versions.find((version) => version.mediaObjectId === original.id)!;
  registry.media.push({ ...original, id: 'new-media', versionObjectId: 'new-version', path: '/new.mp4' });
  registry.versions.push({ ...old, id: 'new-version', mediaObjectId: 'new-media', ordinal: 2, selected: true });
  old.selected = false;
  data.shots[0].videoPath = '/new.mp4';
  return { data, original, old, clip: { id: 'clip-one', path: '/old.mp4' } };
}

test('old clip resolves actual path and historical version after adoption changes without mutation', () => {
  const { data, clip, old } = fixture(); const before = JSON.stringify({ data, clip });
  const result = resolveTimelineSource(data, 'p', clip);
  assert.equal(result.status, 'resolved');
  if (result.status !== 'resolved') return;
  assert.equal(result.versionId, old.id); assert.equal(result.objectId, 'shot:one');
  assert.equal(result.adopted, false); assert.equal(result.path, '/old.mp4');
  assert.equal(JSON.stringify({ data, clip }), before);
});

test('explicit version/media binding must agree with actual path, never falls back to current adopted version', () => {
  const { data, clip } = fixture();
  assert.equal(resolveTimelineSource(data, 'p', { ...clip, versionId: 'new-version' }).status, 'mismatch');
  assert.equal(resolveTimelineSource(data, 'p', { ...clip, mediaId: 'new-media' }).status, 'mismatch');
  assert.equal(resolveTimelineSource(data, 'p', { ...clip, path: '/other/old.mp4' }).status, 'unavailable');
});

test('same path shared by multiple owners is ambiguous unless exact node provenance disambiguates', () => {
  const { data, clip, original } = fixture();
  data.projectObjects!.media.push({ ...original, id: 'duplicate', ownerObjectId: 'shot:two', canvasNodeId: 'node-two' });
  assert.equal(resolveTimelineSource(data, 'p', clip).status, 'ambiguous');
  const result = resolveTimelineSource(data, 'p', { ...clip, sourceNodeId: 'node-two' });
  assert.equal(result.status, 'resolved'); if (result.status === 'resolved') assert.equal(result.objectId, 'shot:two');
});

test('unhydrated/cross-project/deleted/unclassified sources refuse navigation', () => {
  const { data, clip, original } = fixture();
  assert.equal(resolveTimelineSource(data, null, clip).status, 'mismatch');
  assert.equal(resolveTimelineSource(data, 'other', clip).status, 'mismatch');
  original.ownerObjectId = undefined;
  assert.equal(resolveTimelineSource(data, 'p', clip).status, 'unavailable');
  original.ownerObjectId = 'shot:one'; data.shots = data.shots.filter((shot) => shot.id !== 'one');
  assert.equal(resolveTimelineSource(data, 'p', clip).status, 'unavailable');
});

test('legacy path with no historical version is marked unknown rather than assigned a fabricated v1', () => {
  const { data, clip, original } = fixture();
  data.projectObjects!.versions = data.projectObjects!.versions.filter((version) => version.mediaObjectId !== original.id);
  const result = resolveTimelineSource(data, 'p', clip);
  assert.equal(result.status, 'resolved'); if (result.status === 'resolved') assert.equal(result.ordinal, undefined);
});

test('Inspector event uses original identities, validates live clip and never creates project/shot copies', () => {
  const { data, clip } = fixture(); const before = JSON.stringify(data);
  const result = resolveTimelineSource(data, 'p', clip); assert.equal(result.status, 'resolved');
  if (result.status !== 'resolved') return;
  const request = timelineInspectorRequest(result, clip, 'main');
  const target = new EventTarget(); const received: unknown[] = [];
  target.addEventListener(WORKSPACE_INSPECTOR_REQUEST_EVENT, (event) => received.push((event as CustomEvent).detail));
  dispatchTimelineInspectorRequest(request, target);
  assert.deepEqual(received, [request]);
  assert.deepEqual(validateTimelineInspectorRequest(data, 'p', clip, request), request);
  assert.equal(validateTimelineInspectorRequest(data, 'p', { ...clip, path: '/new.mp4' }, request), null);
  assert.equal(validateTimelineInspectorRequest(data, 'p', clip, { ...request, objectId: 'shot:two' }), null);
  assert.equal(validateTimelineInspectorRequest(data, 'p', undefined, request), null);
  assert.equal(JSON.stringify(data), before);
});

test('locked sources request inspect only and archived versions never silently resolve to another version', () => {
  const { data, clip, old } = fixture();
  data.projectObjects!.objects.find((object) => object.id === 'shot:one')!.locked = true;
  const result = resolveTimelineSource(data, 'p', clip); assert.equal(result.status, 'resolved');
  if (result.status === 'resolved') assert.equal(timelineInspectorRequest(result, clip, 'audio').intent, 'inspect');
  old.archived = true;
  assert.equal(resolveTimelineSource(data, 'p', { ...clip, versionId: old.id }).status, 'mismatch');
});

test('reference-only attachment is not output provenance and cannot invent an originating shot', () => {
  const { data, clip, original } = fixture();
  data.projectObjects!.media.push({ ...original, id: 'reference', ownerObjectId: 'shot:two', purpose: 'generation-reference' });
  const result = resolveTimelineSource(data, 'p', clip);
  assert.equal(result.status, 'resolved');
  if (result.status === 'resolved') assert.equal(result.objectId, 'shot:one');
  original.purpose = 'generation-reference';
  assert.equal(resolveTimelineSource(data, 'p', clip).status, 'unavailable');
});

test('legacy shots without id resolve via shotNo, including validated Inspector requests', () => {
  const data = migrateWorkshopProjectObjects({ ...emptyWorkshopData('legacy'), shots: [
    { shotNo: '03-02', description: '旧镜头原文', characterIds: [], videoPath: '/legacy-original.mp4' },
  ] }, 1);
  const clip = { id: 'legacy-clip', path: '/legacy-original.mp4' };
  const before = JSON.stringify(data);
  const source = resolveTimelineSource(data, 'legacy', clip);
  assert.equal(source.status, 'resolved');
  if (source.status !== 'resolved') return;
  assert.equal(source.objectId, 'shot:03-02');
  assert.equal(source.shotId, '03-02');
  assert.equal(source.label, '镜头 03-02');
  const request = timelineInspectorRequest(source, clip, 'main');
  assert.deepEqual(validateTimelineInspectorRequest(data, 'legacy', clip, request), request);
  assert.equal(JSON.stringify(data), before);
});
