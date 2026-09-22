import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as eventQueue from '../../performance/eventQueue.ts';
import { sanitizeOpenAIToolPairing } from './pairing.ts';
const code = ts.transpileModule(readFileSync(new URL('./deepseek.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture({ start, failListener = 0 } = {}) {
  const listeners = new Map(); let registrations = 0, requests = 0, aborts = 0;
  const fire = (kind, payload) => [...listeners].find(([key]) => key.startsWith(`stream-${kind}-`))?.[1]({ payload });
  const modules = {
    '../../performance/eventQueue': eventQueue, './pairing': { sanitizeOpenAIToolPairing },
    '../logger': { agentLog: { warn() {} } }, '../glmClient': {}, '../withRetry': {},
    '@tauri-apps/api/tauri': { invoke: async name => {
      if (name === 'stream_http_request') { requests++; await start?.(fire); }
      else if (name === 'abort_stream_request') aborts++;
      else throw Error(name);
    } },
    '@tauri-apps/api/window': { appWindow: { listen: async (name, fn) => {
      if (++registrations === failListener) throw Error('listener failed');
      listeners.set(name, fn); return () => listeners.delete(name);
    } } },
  };
  const exports = {};
  runInNewContext(code, { exports, require: id => { assert.ok(id in modules, id); return modules[id]; }, DOMException });
  const provider = new exports.DeepSeekProvider({ apiKey: 'test-only', baseUrl: 'https://example.invalid/v1' });
  return { provider, listeners, get requests() { return requests; }, get aborts() { return aborts; } };
}
const request = { messages: [{ role: 'user', content: 'test' }], tools: [] };
const chunk = content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
test('OpenAI-compatible burst drains in order after done and releases every listener', async () => {
  const f = fixture({ start: fire => { for (let i = 0; i < 1000; i++) fire('chunk', { chunk: chunk(`${i},`) }); fire('done', {}); } });
  let text = ''; for await (const d of f.provider.streamChat(request, {})) text += d.choices[0].delta.content;
  assert.equal(text, Array.from({ length: 1000 }, (_, i) => `${i},`).join(''));
  assert.equal(f.listeners.size, 0); assert.ok(f.aborts);
});
test('partial listener registration failure releases earlier registrations without starting a request', async () => {
  const f = fixture({ failListener: 2 });
  await assert.rejects(async () => { for await (const _ of f.provider.streamChat(request, {})) {} }, /listener failed/);
  assert.equal(f.requests, 0); assert.equal(f.listeners.size, 0);
});
test('abort skips pending output; pre-aborted calls do not start network requests', async () => {
  const signal = new AbortController(); signal.abort();
  const idle = fixture();
  await assert.rejects(async () => { for await (const _ of idle.provider.streamChat(request, { signal: signal.signal })) {} }, /Aborted/);
  assert.equal(idle.requests, 0); assert.equal(idle.listeners.size, 0);
  const active = new AbortController();
  const f = fixture({ start: fire => { fire('chunk', { chunk: chunk('first') }); fire('chunk', { chunk: chunk('second') }); fire('done', {}); } });
  let count = 0;
  await assert.rejects(async () => { for await (const _ of f.provider.streamChat(request, { signal: active.signal })) { count++; active.abort(); } }, /Aborted/);
  assert.equal(count, 1); assert.equal(f.listeners.size, 0);
});
