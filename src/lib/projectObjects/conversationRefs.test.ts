import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProjectConversationReferenceContext,
  createProjectConversationReference,
  mergeProjectConversationReferences,
  removeProjectConversationReference,
} from './conversationRefs.ts';

test('conversation references dedupe by stable object identity and keep the latest scope', () => {
  const first = createProjectConversationReference({
    objectId: 'shot:a', kind: 'shot', sourceView: 'workshop', label: '镜头 01-01', now: 1,
  });
  const updated = createProjectConversationReference({
    objectId: 'shot:a', kind: 'shot', sourceView: 'workshop', label: '镜头 01-01', operationScope: 'generate', now: 2,
  });
  const merged = mergeProjectConversationReferences([first], [updated]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].operationScope, 'generate');
  assert.equal(merged[0].addedAt, 2);
});

test('conversation reference removal leaves unrelated references alone', () => {
  const a = createProjectConversationReference({ objectId: 'shot:a', kind: 'shot', sourceView: 'workshop', label: 'A', now: 1 });
  const b = createProjectConversationReference({ objectId: 'scene:b', kind: 'scene', sourceView: 'workshop', label: 'B', now: 2 });
  assert.deepEqual(removeProjectConversationReference([a, b], a.id).map((item) => item.objectId), ['scene:b']);
});

test('conversation context preserves labels and stable ids without embedding media paths', () => {
  const ref = createProjectConversationReference({
    objectId: 'media-file:abc', kind: 'media-file', sourceView: 'canvas', sourceId: 'node-1',
    label: '@图片一', version: 3, operationScope: 'read', thumbnailPath: '/tmp/image.png', now: 1,
  });
  const context = buildProjectConversationReferenceContext([ref]);
  assert.match(context, /@图片一/);
  assert.match(context, /media-file:abc/);
  assert.match(context, /版本 v3/);
  assert.doesNotMatch(context, /\/tmp\/image\.png/);
});
