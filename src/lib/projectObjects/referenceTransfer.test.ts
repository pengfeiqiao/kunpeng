import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectConversationReference } from './conversationRefs.ts';
import { encodeReferenceTransfer, resolveReferenceTransfer, quoteProjectReference } from './referenceTransfer.ts';

const ref = createProjectConversationReference({ objectId: 'shot:a', sourceId: '1', label: '镜头1', kind: 'shot', sourceView: 'workshop' });
test('drag transfers identity and resolves fresh data only inside the same project', () => {
  const payload = encodeReferenceTransfer('p', { ...ref, thumbnailPath: '/old.png' });
  const fresh = { ...ref, thumbnailPath: '/new.png', label: '已修改' };
  assert.equal(resolveReferenceTransfer(payload, 'p', [fresh]), fresh);
  assert.equal(resolveReferenceTransfer(payload, 'other', [fresh]), null);
  assert.equal(resolveReferenceTransfer(payload, 'p', []), null);
  assert.equal(resolveReferenceTransfer('invalid', 'p', [fresh]), null);
  assert.equal(resolveReferenceTransfer('x'.repeat(8193), 'p', [fresh]), null);
});
test('selection preserves original text and mentions without granting write permission', () => {
  const text = '以 @图片一 为参考\n保留司机，不添加对白。';
  const quote = quoteProjectReference(ref, text)!;
  assert.equal(quote.quotedText, text);
  assert.equal(quote.objectId, ref.objectId);
  assert.equal(quote.kind, 'text-selection');
  assert.equal(quote.operationScope, 'read');
  assert.equal(quoteProjectReference(ref, '  '), null);
});
