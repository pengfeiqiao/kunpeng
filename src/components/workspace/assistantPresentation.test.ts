import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantResultMedia, assistantPromptChanges } from './assistantPresentation.ts';
import type { UnifiedProjectRegistry } from '../../lib/projectObjects/types.ts';
import type { Message } from '../../types/index.ts';

const registry: UnifiedProjectRegistry = { schemaVersion: 1, projectId: 'p', updatedAt: 1, objects: [], versions: [], media: [
  { id: 'media-a', kind: 'media-file', projectId: 'p', path: '/offline/a.png', mediaType: 'image', purpose: 'candidate-version', source: 'generated', relationIds: [], version: 1, updatedAt: 1 },
  { id: 'media-other', kind: 'media-file', projectId: 'other', path: '/offline/b.png', mediaType: 'image', purpose: 'candidate-version', source: 'generated', relationIds: [], version: 1, updatedAt: 1 },
] };
const message = (metadata: Message['metadata'] = {}): Message => ({ id: 'reply', role: 'assistant', content: '已生成 /offline/a.png，已同步时间线', timestamp: 1, metadata });
test('media cards require successful structured receipts, not claims or guessed paths', () => {
  assert.deepEqual(assistantResultMedia(message(), registry), []);
  assert.deepEqual(assistantResultMedia(message({ toolExecutions: [{ status: 'error', result: { success: false, output: '{"mediaId":"media-a"}' } }] }), registry), []);
  assert.deepEqual(assistantResultMedia(message({ toolExecutions: [{ status: 'completed', result: { success: true, output: 'file /offline/a.png' } }] }), registry), []);
});
test('media receipts resolve identity, deduplicate, reject deleted and cross-project media', () => {
  const m = message({ toolExecutions: [{ status: 'completed', result: { success: true, output: JSON.stringify({ mediaIds: ['media-a', 'media-other', 'missing'], path: '/offline/a.png' }) } }] });
  assert.deepEqual(assistantResultMedia(m, registry).map((item) => item.id), ['media-a']);
  assert.deepEqual(assistantResultMedia(m, { ...registry, media: registry.media.map((item) => ({ ...item, archived: true })) }), []);
});
test('untrusted malformed and compressed receipts do not invent cards', () => {
  const m = message({ toolExecutions: [null, { status: 'completed', result: { success: true, output: '{"path":"/offline/a.png"...compressed' } }] });
  assert.deepEqual(assistantResultMedia(m, registry), []);
});

test('prompt change summary requires the actual successful mutation receipt and matching project', () => {
  const execution = { toolName: 'project_update_generation_prompt', status: 'completed', result: { success: true,
    output: JSON.stringify({ projectId: 'p', objectId: 'shot:a', outputType: 'video', revision: 3, changed: ['prompt'], generated: false }) } };
  assert.equal(assistantPromptChanges(message({ toolExecutions: [execution, execution] }), 'p').length, 1);
  assert.deepEqual(assistantPromptChanges(message({ toolExecutions: [execution] }), 'other'), []);
  assert.deepEqual(assistantPromptChanges(message({ toolExecutions: [{ ...execution, status: 'error' }] }), 'p'), []);
});
