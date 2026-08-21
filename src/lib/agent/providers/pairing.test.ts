/**
 * sanitizeOpenAIToolPairing — P0 回归测试：abort 持久化的孤儿 tool_calls /
 * tool 结果不得再让 OpenAI 兼容端点每轮 400。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeOpenAIToolPairing } from './pairing.ts';
import type { AgentMessage } from '../types.ts';

const assistantWithCalls = (ids: string[]): AgentMessage =>
  ({
    role: 'assistant',
    content: '调工具',
    tool_calls: ids.map((id) => ({ id, type: 'function', function: { name: 'read_file', arguments: '{}' } })),
  }) as AgentMessage;

const toolResult = (id: string): AgentMessage =>
  ({ role: 'tool', tool_call_id: id, content: 'ok' }) as AgentMessage;

test('complete pairing passes through untouched', () => {
  const messages: AgentMessage[] = [
    { role: 'user', content: 'hi' },
    assistantWithCalls(['a', 'b']),
    toolResult('a'),
    toolResult('b'),
    { role: 'assistant', content: 'done' },
  ];
  const out = sanitizeOpenAIToolPairing(messages) as Array<Record<string, unknown>>;
  assert.equal(out.length, 5);
  assert.ok(Array.isArray(out[1].tool_calls));
  assert.equal(out[2].tool_call_id, 'a');
});

test('abort snapshot: assistant tool_calls with no results are stripped', () => {
  const messages: AgentMessage[] = [
    { role: 'user', content: 'hi' },
    assistantWithCalls(['a']),
  ];
  const out = sanitizeOpenAIToolPairing(messages) as Array<Record<string, unknown>>;
  assert.equal(out.length, 2);
  assert.equal(out[1].tool_calls, undefined);
  assert.equal(out[1].content, '调工具');
});

test('partial results: unanswered calls strip BOTH calls and partial results', () => {
  const messages: AgentMessage[] = [
    { role: 'user', content: 'hi' },
    assistantWithCalls(['a', 'b']),
    toolResult('a'),
    { role: 'user', content: '下一步' },
  ];
  const out = sanitizeOpenAIToolPairing(messages) as Array<Record<string, unknown>>;
  assert.equal(out.length, 3);
  assert.equal(out[1].tool_calls, undefined);
  assert.ok(!out.some((m) => m.role === 'tool'));
});

test('orphan tool result without matching call is dropped', () => {
  const messages: AgentMessage[] = [
    { role: 'user', content: 'hi' },
    toolResult('ghost'),
    { role: 'assistant', content: 'ok' },
  ];
  const out = sanitizeOpenAIToolPairing(messages) as Array<Record<string, unknown>>;
  assert.equal(out.length, 2);
  assert.ok(!out.some((m) => m.role === 'tool'));
});

test('multiple turns are handled independently', () => {
  const messages: AgentMessage[] = [
    assistantWithCalls(['ok1']),
    toolResult('ok1'),
    assistantWithCalls(['bad1']),
    { role: 'assistant', content: 'final' },
  ];
  const out = sanitizeOpenAIToolPairing(messages) as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(out[0].tool_calls));
  assert.equal(out[1].tool_call_id, 'ok1');
  assert.equal(out[2].tool_calls, undefined);
  assert.equal(out[3].content, 'final');
});
