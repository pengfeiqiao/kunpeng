import test from 'node:test';
import assert from 'node:assert/strict';
import type { MediaFileRecord, UnifiedProjectRegistry } from '../../lib/projectObjects/types.ts';
import { isAssistantTargetAvailable, resolveAssistantTargetRequest } from './assistantTarget.ts';

const base = { projectId: 'p', source: 'generated' as const, relationIds: [], version: 1, updatedAt: 1 };
const media = (id: string, patch: Partial<MediaFileRecord>): MediaFileRecord => ({ ...base, kind: 'media-file', id,
  mediaType: 'image', purpose: 'candidate-version', path: `/offline/${id}`, ...patch });
const registry: UnifiedProjectRegistry = { schemaVersion: 1, projectId: 'p', updatedAt: 1,
  objects: [{ ...base, kind: 'shot', id: 'a' }, { ...base, kind: 'shot', id: 'b' }], versions: [], media: [
    media('audio', { mediaType: 'audio', ownerObjectId: 'a' }),
    media('loose', { purpose: 'unclassified', ownerObjectId: 'generation-group' }),
    media('owned', { ownerObjectId: 'a' }),
  ] };

test('known direct audio and unclassified media ignore a different owner when self-addressed', () => {
  for (const id of ['audio', 'loose']) {
    assert.equal(isAssistantTargetAvailable(registry, { projectId: 'p', objectId: id, mediaId: id }), true);
    assert.equal(resolveAssistantTargetRequest(registry, { projectId: 'p', objectId: id })?.mediaId, id);
  }
});
test('direct-media exception never admits unknown, archived, historical or ordinary owned images', () => {
  for (const id of ['missing', 'owned']) assert.equal(isAssistantTargetAvailable(registry, { projectId: 'p', objectId: id, mediaId: id }), false);
  for (const patch of [{ archived: true }, { purpose: 'historical' as const }, { projectId: 'other' }]) {
    const changed = { ...registry, media: registry.media.map((item) => item.id === 'audio' ? { ...item, ...patch } : item) };
    assert.equal(isAssistantTargetAvailable(changed, { projectId: 'p', objectId: 'audio', mediaId: 'audio' }), false);
  }
});
test('owned targets retain strict media ownership and project checks', () => {
  assert.equal(isAssistantTargetAvailable(registry, { projectId: 'p', objectId: 'a', mediaId: 'owned' }), true);
  assert.equal(isAssistantTargetAvailable(registry, { projectId: 'p', objectId: 'b', mediaId: 'owned' }), false);
  assert.equal(isAssistantTargetAvailable(registry, { projectId: 'other', objectId: 'a', mediaId: 'owned' }), false);
  assert.equal(isAssistantTargetAvailable(registry, { projectId: 'p', objectId: 'audio', mediaId: 'loose' }), false);
});
test('explicit target requests resolve real type and reject malformed or stale identities', () => {
  assert.deepEqual(resolveAssistantTargetRequest(registry, { projectId: 'p', objectId: 'audio', mediaId: 'audio' }),
    { projectId: 'p', objectId: 'audio', mediaId: 'audio', outputType: 'audio', accessScope: 'media' });
  for (const input of [null, {}, { projectId: 'other', objectId: 'a' }, { projectId: 'p', objectId: 'missing' },
    { projectId: 'p', objectId: 'a', mediaId: 42 }, { projectId: 'p', objectId: 'b', mediaId: 'owned' }]) {
    assert.equal(resolveAssistantTargetRequest(registry, input), null);
  }
});

test('shot-menu scope is explicit and cannot be requested for a media object', () => {
  assert.equal(resolveAssistantTargetRequest(registry, { projectId: 'p', objectId: 'a' })?.accessScope, 'shot');
  assert.equal(resolveAssistantTargetRequest(registry, { projectId: 'p', objectId: 'a', mediaId: 'owned' })?.accessScope, 'media');
  assert.equal(resolveAssistantTargetRequest(registry, { projectId: 'p', objectId: 'audio', accessScope: 'shot' }), null);
  assert.equal(resolveAssistantTargetRequest(registry, { projectId: 'p', objectId: 'a', accessScope: 'project' }), null);
});
