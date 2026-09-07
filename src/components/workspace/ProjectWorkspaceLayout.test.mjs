import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as widths from '../../lib/workspace/layoutWidths.ts';

const source = readFileSync(new URL('./ProjectWorkspaceLayout.tsx', import.meta.url), 'utf8');
const elements = (tree) => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(elements)];
const label = (tree, value) => elements(tree).find((node) => node.props?.['aria-label'] === value);
const resizers = (tree) => elements(tree).filter((node) => node.props?.role === 'separator');
function runtime(viewport = 1440) {
  const slots = []; let cursor = 0;
  const slot = (value) => { const index = cursor++; if (!(index in slots)) slots[index] = value(); return index; };
  const effects = []; const listeners = new Map();
  const jsx = (type, props) => ({ type, props });
  const modules = { 'react/jsx-runtime': { jsx, jsxs: jsx }, 'lucide-react': {},
    '@/lib/workspace/layoutWidths': widths,
    react: {
      useState: (value) => { const i = slot(() => typeof value === 'function' ? value() : value); return [slots[i],
        (next) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
      useRef: (current) => slots[slot(() => ({ current }))], useId: () => `id-${slot(() => null)}`,
      useEffect: (effect, deps) => { const i = slot(() => undefined); const old = slots[i];
        if (!old || old.deps.some((item, n) => item !== deps[n])) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; }); },
    } };
  const query = { matches: viewport < 1200, addEventListener: (_, fn) => listeners.set('query', fn), removeEventListener: () => listeners.delete('query') };
  const window = { innerWidth: viewport, matchMedia: () => query,
    addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: (key) => listeners.delete(key) };
  const compiled = ts.transpileModule(source, { reportDiagnostics: true, compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } });
  assert.equal(compiled.diagnostics.length, 0);
  const exports = {};
  runInNewContext(compiled.outputText, { exports, window, require: (id) => {
    if (id.endsWith('.css')) return {};
    assert.ok(id in modules, id); return modules[id];
  } });
  const changes = [];
  const props = { projectName: 'Project', specSummary: 'Spec', surface: 'media', mediaView: 'list',
    assistantState: 'expanded', content: 'CONTENT', inspector: 'INSPECTOR', assistant: 'ASSISTANT', canvas: 'CANVAS',
    widths: { content: 320, assistant: 360 }, onWidths: (value) => { changes.push(value); props.widths = value; },
    onSurface: (value) => { props.surface = value; }, onAssistantState: (value) => { props.assistantState = value; },
    onMediaView: (value) => { props.mediaView = value; }, onBack() {}, onExport() {}, onSpec() {},
  };
  return { props, changes, listeners, query, render() { cursor = 0; return exports.default(props); },
    flush() { while (effects.length) effects.shift()(); }, unmount() { for (const value of slots) value?.cleanup?.(); } };
}
const event = (x = 0) => ({ pointerId: 1, button: 0, clientX: x, preventDefault() {},
  currentTarget: { focus() {}, setPointerCapture() {}, hasPointerCapture: () => false, releasePointerCapture() {} } });

test('desktop exposes two accessible keyboard separators and resets the relevant width on double click', () => {
  const r = runtime(); let tree = r.render();
  assert.equal(resizers(tree).length, 2);
  const content = label(tree, '调整目录宽度');
  assert.equal(content.props['aria-orientation'], 'vertical'); assert.equal(content.props.tabIndex, 0);
  content.props.onKeyDown({ key: 'ArrowRight', preventDefault() {} });
  assert.equal(r.changes[0].content, 330);
  tree = r.render();
  label(tree, '调整助手宽度').props.onKeyDown({ key: 'ArrowLeft', shiftKey: true, preventDefault() {} });
  assert.equal(r.changes[1].assistant, 400);
  label(r.render(), '调整目录宽度').props.onDoubleClick();
  assert.equal(r.changes[2].content, 320); assert.equal(r.changes[2].assistant, 400);
});

test('pointer drag previews locally, commits once, and cancellation never writes persistence', () => {
  const r = runtime(); const handle = label(r.render(), '调整目录宽度');
  handle.props.onPointerDown(event(100)); handle.props.onPointerMove(event(145));
  assert.equal(r.changes.length, 0);
  assert.equal(label(r.render(), '调整目录宽度').props['aria-valuenow'], 365);
  handle.props.onPointerUp(event(145)); assert.equal(r.changes.length, 1); assert.equal(r.changes[0].content, 365);
  const next = label(r.render(), '调整助手宽度');
  next.props.onPointerDown(event(100)); next.props.onPointerMove(event(80)); next.props.onPointerCancel();
  assert.equal(r.changes.length, 1);
  next.props.onPointerDown(event(100)); next.props.onPointerMove(event(80));
  next.props.onKeyDown({ key: 'Escape', preventDefault() {} });
  next.props.onPointerUp(event(80)); assert.equal(r.changes.length, 1);
});

test('an external project-width update cancels an in-flight drag without committing to the new target', () => {
  const r = runtime(); r.render(); r.flush();
  const handle = label(r.render(), '调整目录宽度');
  handle.props.onPointerDown(event(100)); handle.props.onPointerMove(event(130));
  r.props.widths = { content: 250, assistant: 300 }; r.render(); r.flush();
  handle.props.onPointerUp(event(130));
  assert.equal(r.changes.length, 0);
  assert.equal(label(r.render(), '调整目录宽度').props['aria-valuenow'], 250);
});

test('unmount during drag releases pointer capture, removes global listeners and never commits', () => {
  const r = runtime(); const tree = r.render();
  elements(tree).find((node) => node.props?.className === 'workspace-columns').props.ref.current = { getBoundingClientRect: () => ({ width: 1424 }) };
  r.flush();
  assert.equal(r.listeners.size, 3);
  const handle = label(r.render(), '调整目录宽度');
  let captured = false; let releases = 0;
  const pointer = { ...event(100), currentTarget: { focus() {}, setPointerCapture: () => { captured = true; },
    hasPointerCapture: () => captured, releasePointerCapture: () => { captured = false; releases++; } } };
  handle.props.onPointerDown(pointer); handle.props.onPointerMove({ ...pointer, clientX: 150 });
  r.unmount();
  assert.equal(releases, 1); assert.equal(r.listeners.size, 0); assert.equal(captured, false);
  handle.props.onPointerUp(pointer); assert.equal(r.changes.length, 0);
});

test('canvas/editor omit directory tracks and hidden/large assistant adds no empty gutter', () => {
  for (const mode of ['canvas', 'editor']) {
    const r = runtime();
    if (mode === 'canvas') r.props.mediaView = 'canvas'; else r.props.surface = 'editor';
    let tree = r.render(); assert.equal(resizers(tree).length, 0, 'assistant floats over ' + mode + ', no docked tracks');
    assert.equal(label(tree, '项目内容').props['aria-hidden'], true);
    r.props.assistantState = 'hidden'; tree = r.render();
    assert.equal(resizers(tree).length, 0);
    assert.equal(elements(tree).find((node) => node.props?.className === 'workspace-columns').props.style.gridTemplateColumns, 'minmax(0, 1fr)');
    r.props.assistantState = 'expanded'; label(r.render(), '放大助手').props.onClick(); tree = r.render();
    assert.equal(resizers(tree).length, 0);
    assert.equal(elements(tree).find((node) => node.props?.className === 'workspace-columns').props.style.gridTemplateColumns, 'minmax(0, 1fr)');
  }
});

test('1199 and below keep overlay assistant, directory actions and initialAssistantOpen behavior', () => {
  for (const width of [1199, 1024, 390]) {
    const r = runtime(width); let tree = r.render();
    assert.equal(resizers(tree).length, 0);
    assert.equal(label(tree, '项目助手列').props['aria-hidden'], true);
    label(tree, '项目助手').props.onClick(); tree = r.render();
    assert.equal(label(tree, '项目助手列').props['aria-hidden'], false);
    label(tree, '项目目录').props.onClick(); tree = r.render();
    assert.equal(label(tree, '项目内容').props['aria-hidden'], false);
    assert.equal(label(tree, '项目助手列').props['aria-hidden'], true);
    const initial = runtime(width); initial.props.initialAssistantOpen = true;
    assert.equal(label(initial.render(), '项目助手列').props['aria-hidden'], false);
  }
});

test('styling is scoped, uses eight-pixel gutters and glass only on chrome with solid fallback', () => {
  const css = readFileSync(new URL('./workspaceLayoutExperience.css', import.meta.url), 'utf8');
  assert.match(source, /import '\.\/workspaceLayoutExperience.css'/);
  assert.match(css, /width: 8px/); assert.match(css, /border-radius: 6px/);
  assert.match(css, /@supports/); assert.match(css, /background: #202124/);
  assert.match(css, /prefers-reduced-motion: reduce/); assert.match(css, /160ms/);
  const glass = css.slice(css.indexOf('@supports'), css.indexOf('@keyframes'));
  assert.doesNotMatch(glass, /workspace-inspector-column|workspace-prompt|workspace-media-stage/);
});
