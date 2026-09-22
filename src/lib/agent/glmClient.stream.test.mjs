import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { AnthropicSseDataParser } from './anthropicSse.ts';
import * as eventQueue from '../performance/eventQueue.ts';

function fixture(emit) {
  const handlers = new Map(); let removed = 0; let aborted = 0;
  const fire = (kind, payload) => {
    const handler = [...handlers].find(([name]) => name.startsWith(`stream-${kind}-`))?.[1];
    assert.ok(handler, kind); handler({ payload });
  };
  const modules = {
    '../performance/eventQueue': eventQueue,
    './logger': { agentLog: { info() {}, warn() {}, error() {}, debug() {} } },
    './anthropicSse': { AnthropicSseDataParser },
    '@tauri-apps/api/tauri': { invoke: async (name) => {
      if (name === 'stream_http_request') await emit(fire);
      else if (name === 'abort_stream_request') aborted++;
      else throw Error(name);
    } },
    '@tauri-apps/api/window': { appWindow: { listen: async (name, handler) => {
      handlers.set(name, handler); return () => { handlers.delete(name); removed++; };
    } } },
    '@tauri-apps/api/http': {},
  };
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('./glmClient.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, { exports, require: id => { assert.ok(id in modules, id); return modules[id]; },
    setTimeout, clearTimeout, DOMException, crypto });
  const client = new exports.GLMClient({ apiKey: 'test-only', model: 'test' });
  return { client, handlers, get removed() { return removed; }, get aborted() { return aborted; } };
}
const sse = event => `data: ${JSON.stringify(event)}\n\n`;
const text = value => sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: value } });

test('transport done before consumer drains preserves all queued text and terminal stop', async () => {
  const f = fixture(fire => {
    for (let i = 0; i < 1000; i++) fire('chunk', { chunk: text(`${i},`) });
    fire('chunk', { chunk: sse({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }) });
    fire('done', {});
  });
  const out = []; for await (const delta of f.client.streamChat([{ role: 'user', content: 'test' }])) out.push(delta);
  assert.equal(out.map(d => d.choices[0].delta.content ?? '').join(''), Array.from({ length: 1000 }, (_, i) => `${i},`).join(''));
  assert.equal(out.at(-1).choices[0].finish_reason, 'end_turn');
  assert.equal(f.removed, 3); assert.equal(f.handlers.size, 0);
});

test('queued tool argument fragments survive early done and retain exact JSON', async () => {
  const f = fixture(fire => {
    fire('chunk', { chunk: sse({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call', name: 'read_file', input: {} } }) });
    for (const value of ['{"path":', '"作品.txt"', '}']) fire('chunk', { chunk: sse({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: value } }) });
    fire('chunk', { chunk: sse({ type: 'message_delta', delta: { stop_reason: 'tool_use' } }) });
    fire('done', {});
  });
  const out = []; for await (const delta of f.client.streamChat([{ role: 'user', content: 'test' }])) out.push(delta);
  const args = out.flatMap(d => d.choices[0].delta.tool_calls ?? []).map(c => c.function?.arguments ?? '').join('');
  assert.deepEqual(JSON.parse(args), { path: '作品.txt' });
  assert.equal(out.at(-1).choices[0].finish_reason, 'tool_use');
});

test('queued transport error is not swallowed by completed transport flag', async () => {
  const f = fixture(fire => { fire('chunk', { chunk: text('partial') }); fire('error', { status: 429, message: 'rate limited' }); });
  const out = [];
  await assert.rejects(async () => { for await (const delta of f.client.streamChat([{ role: 'user', content: 'test' }])) out.push(delta); }, error => error.status === 429);
  assert.equal(out[0].choices[0].delta.content, 'partial'); assert.equal(f.handlers.size, 0);
});

test('abort during buffered drain stops promptly and removes listeners', async () => {
  const abort = new AbortController();
  const f = fixture(fire => { for (let i = 0; i < 100; i++) fire('chunk', { chunk: text('part') }); fire('done', {}); });
  let count = 0;
  await assert.rejects(async () => { for await (const _ of f.client.streamChat([{ role: 'user', content: 'test' }], undefined, abort.signal)) { count++; abort.abort(); } }, /Aborted/);
  assert.equal(count, 1); assert.equal(f.handlers.size, 0);
});

test('consumer stopping early tears down transport and listeners', async () => {
  const f = fixture(fire => { fire('chunk', { chunk: text('one') }); fire('chunk', { chunk: text('two') }); });
  for await (const _ of f.client.streamChat([{ role: 'user', content: 'test' }])) break;
  assert.equal(f.handlers.size, 0); assert.equal(f.removed, 3); assert.ok(f.aborted);
});
