import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGptRequest, gptBaseUrl, ResponsesDecoder, responsesInput } from './gptResponses.ts';
import type { AgentMessage } from '../types.ts';
const endpoint = gptBaseUrl();
const frame = (event: unknown) => `data: ${JSON.stringify(event)}\r\n\r\n`;
const call = { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'blender_execute', arguments: '{"code":"print(1)"}' };
const reasoning = { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'opaque' };
const output = [reasoning, call];
test('GPT exact relay aliases, stateless request, optional schema and serial desktop actions', () => {
  const body = buildGptRequest({ messages: [{ role: 'user', content: '建模' }], temperature: .7,
    tools: [{ name: 'blender_execute', description: 'Blender', parameters: { type: 'object', properties: { code: { type: 'string' } } } }] }, 'gpt-6-sol-cdx', endpoint);
  assert.equal(body.model, 'gpt-6-sol-cdx'); assert.equal(body.store, false); assert.equal(body.parallel_tool_calls, false);
  assert.equal(body.tools![0].strict, false); assert.equal('temperature' in body, false);
  assert.ok(body.input[0].content.includes('最近画面')); assert.ok(body.input[0].content.includes('.blend'));
  assert.equal(gptBaseUrl('https://www.dmxapi.cn/v1/responses/'), endpoint);
  assert.equal(gptBaseUrl('   '), endpoint);
});
test('tool-return screenshots and Blender renders are native images, not placeholder text', () => {
  const messages: AgentMessage[] = [{ role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: call.name, arguments: call.arguments } }],
    responses_output: { model: 'gpt-6-luna', endpoint, items: output } },
    { role: 'tool', tool_call_id: 'call_1', content: 'render complete', media: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } }] }];
  const input = responsesInput(messages, 'gpt-6-luna', endpoint);
  assert.deepEqual(input.slice(0, 2), output);
  assert.equal(input[2].call_id, 'call_1'); assert.equal(input[2].output[1].type, 'input_image');
  assert.equal(input[2].output[1].image_url, 'data:image/png;base64,aGVsbG8=');
  assert.equal(responsesInput(messages, 'gpt-6-sol-cdx', endpoint).some(item => item.type === 'reasoning'), false);
  assert.equal(responsesInput(messages, 'gpt-6-luna', 'https://different.invalid/v1').some(item => item.type === 'reasoning'), false);
  assert.deepEqual(responsesInput(messages.slice(0, 1), 'gpt-6-luna', endpoint), []);
});
test('fragmented CRLF stream yields calls only after completed and preserves encrypted reasoning', () => {
  const decoder = new ResponsesDecoder('gpt-6-luna', endpoint);
  const early = frame({ type: 'response.output_item.done', output_index: 1, item: call });
  for (const char of early) assert.deepEqual(decoder.feed(char), []);
  const deltas = decoder.feed(frame({ type: 'response.completed', response: { status: 'completed', output, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } }));
  assert.deepEqual(deltas[0].choices[0].delta.responses_output?.items, output);
  assert.equal(deltas[1].choices[0].delta.tool_calls![0].id, 'call_1');
  assert.equal(deltas[deltas.length - 1].choices[0].finish_reason, 'tool_calls');
  assert.equal(deltas[deltas.length - 1].usage?.total_tokens, 15); assert.deepEqual(decoder.end(), []);
});
test('text delta and completed output do not duplicate, message phase survives', () => {
  const decoder = new ResponsesDecoder('gpt-6-luna', endpoint);
  decoder.feed(frame({ type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'Hello' }));
  const deltas = decoder.feed(frame({ type: 'response.completed', response: { output: [{ type: 'message', phase: 'final_answer', role: 'assistant', content: [{ type: 'output_text', text: 'Hello world' }] }] } }));
  assert.equal(deltas.map(d => d.choices[0].delta.content ?? '').join(''), ' world');
  assert.equal(deltas.find(d => d.choices[0].delta.responses_output)?.choices[0].delta.responses_output?.items[0].phase, 'final_answer');
});
test('EOF, incomplete response and malformed tool args never release executable calls', () => {
  const decoder = new ResponsesDecoder('gpt-6-luna', endpoint);
  decoder.feed(frame({ type: 'response.output_item.done', item: call }));
  assert.throws(() => decoder.end(), /中断/);
  for (const event of [
    { type: 'response.incomplete', response: { output } },
    { type: 'response.completed', response: { output: [{ ...call, arguments: '{' }] } },
    { type: 'response.failed', response: { error: { message: 'secret-fake' } } },
  ]) assert.throws(() => new ResponsesDecoder('gpt-6-luna', endpoint).feed(frame(event)), error => !String(error).includes('secret-fake'));
});
