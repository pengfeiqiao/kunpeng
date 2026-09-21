import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const code = ts.transpileModule(readFileSync(new URL('./acpClient.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function runtime({ spawnGate, listenerGate, failSession = false } = {}) {
  const handlers = new Map(), calls = [], exports = {};
  let stopped = 0;
  const emit = (name, line) => handlers.get(name)?.({ payload: { runId: 'run', instanceId: 'instance', line } });
  const modules = {
    '@tauri-apps/api/event': { listen: async (name, handler) => {
      if (listenerGate) await listenerGate.promise;
      handlers.set(name, handler);
      return () => { handlers.delete(name); stopped++; };
    } },
    '@tauri-apps/api/tauri': { invoke: async (name, args) => {
      calls.push(name);
      if (name === 'dsh_start' && spawnGate) await spawnGate.promise;
      if (name === 'dsh_send') {
        const message = JSON.parse(args.message);
        emit('dsh-acp-line', JSON.stringify({ id: message.id,
          ...(failSession && message.method === 'session/new' ? { error: { message: 'session failed' } } :
            { result: message.method === 'session/new' ? { sessionId: 'session' } : {} }),
        }));
      }
    } },
    '../logger': { agentLog: { warn() {} } }, './mediaFilter.ts': { buildAcpPromptContent: () => [] },
  };
  runInNewContext(code, { exports, require: id => { assert.ok(id in modules, id); return modules[id]; },
    window: { setTimeout, clearTimeout }, DOMException, console });
  return { client: new exports.DshAcpClient({ runId: 'run', workspace: '/tmp' }, 'instance', () => {}),
    calls, handlers, stopped: () => stopped };
}
const tick = () => new Promise(r => setImmediate(r));
test('concurrent start calls share the complete handshake and one process', async () => {
  const gate = deferred();const r = runtime({ spawnGate: gate });
  const first = r.client.start();const second = r.client.start();
  assert.equal(first, second);await tick();gate.resolve();await Promise.all([first, second]);
  assert.equal(r.calls.filter(x => x === 'dsh_start').length, 1);
  assert.equal(r.calls.filter(x => x === 'dsh_send').length, 2);
  await r.client.dispose();assert.equal(r.handlers.size, 0);
});
test('cancellation during spawn stops the late child and removes listeners', async () => {
  const gate = deferred();const r = runtime({ spawnGate: gate });
  const start = r.client.start();const rejected = assert.rejects(start, { name: 'AbortError' });
  await tick();await r.client.dispose();gate.resolve();await rejected;
  assert.equal(r.calls.filter(x => x === 'dsh_stop').length, 2);
  assert.equal(r.calls.filter(x => x === 'dsh_send').length, 0);
  assert.equal(r.handlers.size, 0);
});
test('cancellation during listener registration never spawns or leaks its listener', async () => {
  const gate = deferred();const r = runtime({ listenerGate: gate });
  const start = r.client.start();const rejected = assert.rejects(start, { name: 'AbortError' });
  await r.client.dispose();gate.resolve();await rejected;
  assert.equal(r.calls.includes('dsh_start'), false);assert.equal(r.handlers.size, 0);assert.equal(r.stopped(), 1);
});
test('failed handshake disposes the process and subscriptions', async () => {
  const r = runtime({ failSession: true });await assert.rejects(r.client.start(), /session failed/);
  assert.equal(r.calls.filter(x => x === 'dsh_stop').length, 1);assert.equal(r.handlers.size, 0);
});
