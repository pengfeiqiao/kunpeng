import assert from 'node:assert/strict';
import test from 'node:test';
import { compactRemoteHistory } from './remoteHistory.ts';
import type { AgentMessage } from '../agent/types.ts';

test('remote history removes system prompts, reasoning and media payloads', () => {
  const messages: AgentMessage[] = [
    { role: 'system', content: 'secret system prompt' },
    { role: 'user', content: [{ type: 'text', text: '看这张图' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } }] },
    { role: 'assistant', content: '看到了', reasoning_content: 'private reasoning' },
  ];
  const compacted = compactRemoteHistory(messages);
  assert.equal(compacted.length, 2);
  assert.equal(compacted[0].role, 'user');
  assert.equal(JSON.stringify(compacted).includes('abc'), false);
  assert.equal(JSON.stringify(compacted).includes('private reasoning'), false);
});

test('remote history starts at a user turn and bounds tool output', () => {
  const messages: AgentMessage[] = [];
  for (let i = 0; i < 50; i += 1) {
    messages.push({ role: 'user', content: `question ${i}` });
    messages.push({ role: 'assistant', content: null, tool_calls: [{ id: `tool-${i}`, type: 'function', function: { name: 'read_file', arguments: '{}' } }] });
    messages.push({ role: 'tool', tool_call_id: `tool-${i}`, content: 'x'.repeat(10_000) });
  }
  const compacted = compactRemoteHistory(messages);
  assert.equal(compacted[0].role, 'user');
  assert.ok(compacted.length <= 80);
  const tool = compacted.find((message) => message.role === 'tool');
  assert.ok(tool && tool.role === 'tool' && tool.content.length < 7_000);
});
