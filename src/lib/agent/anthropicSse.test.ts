import assert from 'node:assert/strict';
import test from 'node:test';
import { AnthropicSseDataParser } from './anthropicSse.ts';

test('does not duplicate a data line split across transport chunks', () => {
  const parser = new AnthropicSseDataParser();
  assert.deepEqual(parser.push('data: {"type":"content_block_delta","delta":{"partial_'), []);
  assert.deepEqual(parser.push('json":"{\\"path\\":"}}\n\n'), [
    '{"type":"content_block_delta","delta":{"partial_json":"{\\"path\\":"}}',
  ]);
});

test('supports CRLF and multi-line SSE data events', () => {
  const parser = new AnthropicSseDataParser();
  assert.deepEqual(parser.push('data: {"a":1}\r\ndata: {"b":2}\r\n\r\n'), [
    '{"a":1}\n{"b":2}',
  ]);
});

test('flushes a final event when the stream closes without a blank line', () => {
  const parser = new AnthropicSseDataParser();
  assert.deepEqual(parser.push('data: {"type":"message_stop"}'), []);
  assert.deepEqual(parser.finish(), ['{"type":"message_stop"}']);
});
