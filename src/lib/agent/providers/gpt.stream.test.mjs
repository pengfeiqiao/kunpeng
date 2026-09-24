import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as eventQueue from '../../performance/eventQueue.ts';
import * as responses from './gptResponses.ts';
const code = ts.transpileModule(readFileSync(new URL('./gpt.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture({ start, failListener = 0 } = {}) {
  const listeners = new Map(); let registrations = 0, requests = 0, aborts = 0, body;
  const fire = (kind, payload) => [...listeners].find(([key]) => key.startsWith(`stream-${kind}-`))?.[1]({ payload });
  const modules = {
    '../../performance/eventQueue': eventQueue, './gptResponses': responses,
    '@tauri-apps/api/http': {},
    '@tauri-apps/api/tauri': { invoke: async (name, args) => {
      if (name === 'stream_http_request') { requests++; body = JSON.parse(args.body); assert.equal(args.url, 'https://example.invalid/v1/responses'); await start?.(fire); }
      else if (name === 'abort_stream_request') aborts++;
      else throw Error(name);
    } },
    '@tauri-apps/api/window': { appWindow: { listen: async (name, fn) => {
      if (++registrations === failListener) throw Error('listener failed');
      listeners.set(name, fn); return () => listeners.delete(name);
    } } },
  };
  const exports = {};
  runInNewContext(code, { exports, require: id => { assert.ok(id in modules, id); return modules[id]; }, DOMException, crypto });
  const provider = new exports.GptProvider({ apiKey: 'test-only', baseUrl: 'https://example.invalid/v1' });
  return { provider, listeners, get body() { return body; }, get requests() { return requests; }, get aborts() { return aborts; } };
}
const request = { modelId: 'gpt-6-sol-cdx', messages: [{ role: 'user', content: 'test' }], tools: [] };
const chunk = event => `data: ${JSON.stringify(event)}\n\n`;
const completed = { type: 'response.completed', response: { status: 'completed', output: [] } };
test('GPT native transport drains burst and completes without waiting for relay socket close', async () => {
  const f = fixture({ start: fire => { for (let i = 0; i < 300; i++) fire('chunk', { chunk: chunk({ type: 'response.output_text.delta', output_index: 0, delta: `${i},` }) }); fire('chunk', { chunk: chunk(completed) }); } });
  let text = ''; for await (const d of f.provider.streamChat(request, {})) text += d.choices[0].delta.content ?? '';
  assert.equal(text, Array.from({ length: 300 }, (_, i) => `${i},`).join(''));
  assert.equal(f.body.model, 'gpt-6-sol-cdx'); assert.equal(f.requests, 1);
  assert.equal(f.listeners.size, 0); assert.ok(f.aborts);
});
test('GPT partial listener registration failure cleans up without starting request', async () => {
  const f = fixture({ failListener: 2 });
  await assert.rejects(async () => { for await (const _ of f.provider.streamChat(request, {})) {} }, /listener failed/);
  assert.equal(f.requests, 0); assert.equal(f.listeners.size, 0);
});
test('GPT abort releases listeners and makes no automatic retry', async () => {
  const controller = new AbortController();
  const f = fixture({ start: fire => { fire('chunk', { chunk: chunk({ type: 'response.output_text.delta', delta: 'first' }) }); } });
  await assert.rejects(async () => { for await (const _ of f.provider.streamChat(request, { signal: controller.signal })) controller.abort(); }, /Aborted/);
  assert.equal(f.requests, 1); assert.equal(f.listeners.size, 0);
});
test('GPT EOF before completed fails, and HTTP errors never expose relay body secrets', async () => {
  for (const kind of ['done', 'error']) {
    const f = fixture({ start: fire => fire(kind, { status: 401, message: 'test-only' }) });
    await assert.rejects(async () => { for await (const _ of f.provider.streamChat(request, {})) {} }, err => !String(err).includes('test-only'));
    assert.equal(f.requests, 1); assert.equal(f.listeners.size, 0);
  }
});

test('abort within a single completed SSE batch never releases its remaining tool calls', async () => {
  const controller = new AbortController();
  const f = fixture({ start: fire => fire('chunk', { chunk: chunk({ type: 'response.completed', response: { output: [
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'inspect' }] },
    { type: 'function_call', call_id: 'call', name: 'inspect', arguments: '{}' },
  ] } }) }) });
  let count = 0;
  await assert.rejects(async () => {
    for await (const delta of f.provider.streamChat(request, { signal: controller.signal })) {
      count++; assert.equal(delta.choices[0].delta.tool_calls, undefined); controller.abort();
    }
  }, /Aborted/);
  assert.equal(count, 1); assert.equal(f.listeners.size, 0);
});
