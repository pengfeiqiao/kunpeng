import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const code = ts.transpileModule(readFileSync(new URL('./projectStore.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText;
function fixture() {
  let state, canvas = { nodes: [{ id: 'live', data: {}, position: { x: 0, y: 0 } }], edges: [] };
  const files = new Map(); const writes = []; const fault = { write: false, rename: false };
  const store = { getState: () => state, setState: (patch) => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; } };
  const modules = {
    zustand: { create: () => (init) => { state = init(store.setState, store.getState); return store; } },
    'zustand/middleware': { persist: (init) => init, createJSONStorage: () => ({}) },
    '@/lib/safeStorage': {}, nanoid: { nanoid: () => 'new' },
    './canvasStore': { useCanvasStore: { getState: () => canvas, setState: (patch) => { canvas = { ...canvas, ...patch }; }, subscribe() {} }, repairNodeIntegrity: (nodes) => nodes },
    '@/lib/canvas/videoThumbs': { getVideoThumb: async () => null },
    '@tauri-apps/api/fs': { BaseDirectory: { Home: 'home' }, createDir: async () => {}, exists: async (p) => files.has(p),
      readTextFile: async (p) => files.get(p), removeDir: async () => {},
      writeTextFile: async (p, value) => { if (fault.write) throw Error('disk full'); writes.push(p); files.set(p, value); },
      renameFile: async (a, b) => { if (fault.rename) throw Error('rename failed'); files.set(b, files.get(a)); files.delete(a); },
    },
  };
  runInNewContext(code, { exports: {}, require: (id) => { assert.ok(id in modules, id); return modules[id]; }, console, setTimeout, clearTimeout });
  store.setState({ activeProjectId: 'a', projects: [{ id: 'a' }, { id: 'b' }] });
  return { store, files, fault, writes, canvas: () => canvas };
}
test('canvas writes publish only after atomic replacement; failure retains old file and rejects', async () => {
  const f = fixture(); const path = '.kunpeng/projects/a/canvas.json';
  f.files.set(path, '{"nodes":[{"id":"old"}],"edges":[]}');
  f.fault.rename = true;
  await assert.rejects(f.store.getState().flushActiveCanvas(), /rename failed/);
  assert.equal(JSON.parse(f.files.get(path)).nodes[0].id, 'old');
  f.fault.rename = false;
  await f.store.getState().flushActiveCanvas();
  assert.equal(JSON.parse(f.files.get(path)).nodes[0].id, 'live');
  assert.ok(f.writes.every((p) => p.endsWith('.tmp')));
});
test('save failure or unreadable target never switches to an empty canvas', async () => {
  const f = fixture(); f.fault.write = true;
  await assert.rejects(f.store.getState().switchProject('b'), /disk full/);
  assert.equal(f.store.getState().activeProjectId, 'a'); assert.equal(f.store.getState().switching, false);
  f.fault.write = false; f.files.set('.kunpeng/projects/b/canvas.json', '{broken');
  await assert.rejects(f.store.getState().switchProject('b'));
  assert.equal(f.store.getState().activeProjectId, 'a'); assert.equal(f.canvas().nodes[0].id, 'live');
});
test('concurrent flushes settle and keep newest canvas snapshot', async () => {
  const f = fixture();
  await Promise.all(Array.from({ length: 10 }, () => f.store.getState().flushActiveCanvas()));
  assert.equal(JSON.parse(f.files.get('.kunpeng/projects/a/canvas.json')).nodes[0].id, 'live');
});

test('a flush queued by the previous completion is not stranded by worker cleanup', async () => {
  const f = fixture();
  await f.store.getState().flushActiveCanvas().then(() => f.store.getState().flushActiveCanvas());
  assert.equal(JSON.parse(f.files.get('.kunpeng/projects/a/canvas.json')).nodes[0].id, 'live');
});
