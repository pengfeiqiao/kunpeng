import test from 'node:test';
import assert from 'node:assert/strict';
import { ContextManager } from './contextManager.ts';

const bigBase64 = 'A'.repeat(230_000); // 约 172KB 图片的 base64 体积

test('user message with base64 image block is estimated by visual allowance, not transport bytes', () => {
  const cm = new ContextManager(128_000);
  const messages = [
    { role: 'system', content: 'sys' },
    {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: bigBase64 } },
        { type: 'text', text: '看得见我发了什么图吗' },
      ],
    },
  ] as never[];
  const estimate = cm.estimateMessages(messages as never);
  // 文本 + 固定视觉额度（1800/块）+ 消息开销，绝不能把 23 万 base64 字符当 token
  assert.ok(estimate < 5_000, `estimate ${estimate} should stay small`);
});

test('a single image turn does not trigger compaction', () => {
  const cm = new ContextManager(128_000);
  const messages = [
    { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: bigBase64 } }, { type: 'text', text: '看图' }] },
  ] as never[];
  assert.equal(cm.shouldCompact(messages as never), false);
});

test('text-only array content still counts text', () => {
  const cm = new ContextManager(128_000);
  const longText = '很长的文本'.repeat(1000);
  const withText = cm.estimateMessages([
    { role: 'user', content: [{ type: 'text', text: longText }] },
  ] as never);
  const asString = cm.estimateMessages([{ role: 'user', content: longText }] as never);
  assert.equal(withText, asString);
});
