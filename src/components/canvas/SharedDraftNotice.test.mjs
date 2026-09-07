import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { PROFESSIONAL_DRAFT_REQUEST_EVENT } from '../../lib/workspace/professionalDraftProjection.ts';

test('selected professional conflict notice is visible and opens its own draft without mutating or submitting', () => {
  let state = { selectedNodeId: 'a', nodes: [{ id: 'a', data: { workspaceDraftConflict: { reason: '保留本地编辑', revision: 2 } } },
    { id: 'b', data: {} }] };
  const window = new EventTarget();
  const requests = [];
  window.addEventListener(PROFESSIONAL_DRAFT_REQUEST_EVENT, (event) => requests.push(event.detail));
  const jsx = (type, props) => ({ type, props });
  const modules = {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'lucide-react': { AlertTriangle: 'icon-alert', ArrowUpRight: 'icon-open' },
    '@/stores/canvasStore': { useCanvasStore: (selector) => selector(state) },
    '@/lib/workspace/professionalDraftProjection': { PROFESSIONAL_DRAFT_REQUEST_EVENT },
  };
  const compiled = ts.transpileModule(readFileSync(new URL('./SharedDraftNotice.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  runInNewContext(compiled.outputText, { exports, require: (id) => {
    assert.ok(id in modules, `unexpected dependency: ${id}`); return modules[id];
  }, window, CustomEvent });
  const before = JSON.stringify(state);
  const tree = exports.default();
  assert.equal(tree.props.role, 'status');
  const button = tree.props.children.find((item) => item.type === 'button');
  assert.ok(button); button.props.onClick();
  assert.equal(requests.length, 1); assert.equal(requests[0].nodeId, 'a');
  assert.deepEqual(Object.keys(requests[0]), ['nodeId']);
  assert.equal(JSON.stringify(state), before);
  state = { ...state, selectedNodeId: 'b' };
  assert.equal(exports.default(), null);
  state = { ...state, selectedNodeId: null };
  assert.equal(exports.default(), null);
});
