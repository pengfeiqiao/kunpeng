import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const code = ts.transpileModule(readFileSync(new URL('./canvasStore.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText;
test('late startup image migration cannot overwrite a loaded project or newly edited nodes', async () => {
  let state, options, finish;
  const pending = new Promise(r => { finish = r; });
  const store = { getState: () => state, setState: patch => { state = { ...state, ...patch }; } };
  const modules = {
    zustand: { create: () => init => { state = init(store.setState, store.getState); return store; } },
    'zustand/middleware': { persist: (init, opts) => { options = opts; return init; } },
    reactflow: {}, nanoid: {}, '@/lib/safeStorage': {}, '@/lib/workspace/canvasLayout': {},
    '@/lib/canvas/assetPersist': { migrateNodeImages: () => pending },
    '@/lib/canvas/referencePolicy': { migrateLegacyVideoNodeReferences: nodes => ({ nodes }) },
    '@/lib/performance/coalescedIdleWork': { CoalescedIdleWork: class {} },
  };
  runInNewContext(code, { exports: {}, require: id => { assert.ok(id in modules, id); return modules[id]; }, window: { addEventListener() {} }, console });
  state.nodes = [{ id: 'old', data: { generatedImageUrl: 'data:image/png;base64,AAA' } }];
  options.onRehydrateStorage()(state);
  const live = [{ id: 'new-project-node', data: {} }];store.setState({ nodes: live });
  finish({ changed: true, nodes: [{ id: 'old', data: { generatedImageUrl: '/old.png' } }] });
  await pending;await Promise.resolve();
  assert.equal(store.getState().nodes, live);
});
