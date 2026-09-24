import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function fixture() {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('./chatStore.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, { exports, require });
  return exports.useChatStore;
}
test('attachment drafts survive page switches, remain session scoped, and clear after sending', () => {
  const store = fixture(); const paths = ['/ref.png'];
  store.getState().setDraftFiles('s', paths); paths.push('/not-added.png');
  for (const view of ['chat', 'copywriting', 'canvas', 'editor', 'workshop']) {
    store.getState().setActiveView(view);
    assert.deepEqual(Array.from(store.getState().draftFiles.s), ['/ref.png']);
  }
  store.getState().setDraftFiles('other', ['/other.pdf']);
  store.getState().setDraftFiles('s', prior => [...prior, '/second.png']);
  assert.equal(store.getState().draftFiles.s.length, 2);
  store.getState().setDraftFiles('s', []);
  assert.equal(store.getState().draftFiles.s, undefined);
  assert.deepEqual(Array.from(store.getState().draftFiles.other), ['/other.pdf']);
});
