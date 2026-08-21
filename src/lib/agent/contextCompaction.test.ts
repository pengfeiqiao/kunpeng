import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMPACTED_HISTORY_PREFIX,
  hasDegradedCompactedHistory,
  isCompactedHistoryContent,
  mergeCumulativeSummaries,
  truncateKeepingEnds,
  unwrapCompactedHistory,
} from './contextCompaction.ts';
import { ContextManager } from './contextManager.ts';

test('keeps both the original goal and latest verified state when trimming', () => {
  const text = `ORIGINAL_GOAL\n${'中间资料'.repeat(20_000)}\nLATEST_VERIFIED_STATE`;
  const trimmed = truncateKeepingEnds(text, 36_000);
  assert.match(trimmed, /ORIGINAL_GOAL/);
  assert.match(trimmed, /LATEST_VERIFIED_STATE/);
  assert.ok(trimmed.length <= 36_000);
});

test('unwraps a previous compacted history without nesting its wrapper', () => {
  const fact = '用户选择导演约束卡，并且只传场景图。';
  const wrapped = `${COMPACTED_HISTORY_PREFIX}请继续。\n\n用户: ${COMPACTED_HISTORY_PREFIX}\n${fact}`;
  assert.equal(isCompactedHistoryContent(wrapped), true);
  assert.equal(unwrapCompactedHistory(wrapped), fact);
});

test('cumulative summary carries previous facts and new facts together', () => {
  const merged = mergeCumulativeSummaries(
    ['早期决定：保留经典版提示词。'],
    '新增决定：新版作为默认。',
    24_000,
  );
  assert.match(merged, /保留经典版提示词/);
  assert.match(merged, /新版作为默认/);
  assert.doesNotMatch(merged, /之前的对话过长，已被压缩/);
});

test('detects recursively collapsed compacted history', () => {
  const collapsed = `${COMPACTED_HISTORY_PREFIX}\n\n${COMPACTED_HISTORY_PREFIX}\n\n用户要求保留上下文。`;
  assert.equal(hasDegradedCompactedHistory([{ role: 'user', content: collapsed }]), true);
  const healthy = `${COMPACTED_HISTORY_PREFIX}\n\n${'已验证历史。'.repeat(200)}`;
  assert.equal(hasDegradedCompactedHistory([{ role: 'user', content: healthy }]), false);
});

test('hard clamp does not return a still-over-budget recent tool batch', () => {
  const manager = new ContextManager(128_000);
  const huge = '超大工具参数'.repeat(25_000);
  const messages = [
    { role: 'system' as const, content: '保持工具契约。' },
    { role: 'user' as const, content: '请继续完成任务。' },
    {
      role: 'assistant' as const,
      content: '',
      tool_calls: [{ id: 'call-1', type: 'function' as const, function: { name: 'write_file', arguments: huge } }],
    },
    { role: 'tool' as const, tool_call_id: 'call-1', content: huge },
  ];
  const clamped = manager.hardClamp(messages, 8_000);
  assert.ok(manager.estimateMessages(clamped) <= 8_000);
  assert.equal(clamped.some((message) => message.role === 'assistant' && Boolean(message.tool_calls?.length)), false);
});
