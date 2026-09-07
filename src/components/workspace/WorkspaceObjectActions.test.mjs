import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('./WorkspaceObjectActions.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const impact = { mediaIds: ['m'], versionIds: ['v', 'v2'], affectedShotNos: ['01', '03'], timelineClipCount: 4, relationReferenceCount: 5 };

function fixture(overrides = {}) {
  const calls = [];
  const hooks = [], cache = new Map(), events = new Map();
  let cursor = 0, dirty = false, pendingEffects = [], tree;
  const eventPort = (prefix) => ({
    addEventListener(type, fn) { const key = prefix + type; const entries = events.get(key) ?? new Set(); entries.add(fn); events.set(key, entries); },
    removeEventListener(type, fn) { events.get(prefix + type)?.delete(fn); },
  });
  class Element {
    constructor(type = 'button', props = {}) { this.type = type; this.props = props; this.children = []; this.isConnected = true; }
    focus() { if (!this.props.disabled) document.activeElement = this; }
    contains(target) { return this === target || this.children.some((child) => child.contains(target)); }
    getAttribute(key) { return this.props[key]; }
    getBoundingClientRect() { return this.props.role === 'menu' ? { width: 220, height: 180 }
      : { left: 40, top: 50, right: 64, bottom: 74, width: 24, height: 24 }; }
    querySelectorAll(selector) {
      return flatten(this).slice(1).filter((element) => {
        if (selector.includes(':not(:disabled)') && element.props.disabled) return false;
        if (selector.includes('[data-delete-back]')) return element.props['data-delete-back'] !== undefined;
        if (selector.includes('[data-delete-menu]')) return element.props['data-delete-menu'] !== undefined;
        if (selector.includes('[role="menuitem"]')) return element.props.role === 'menuitem';
        return selector.startsWith('button') && element.type === 'button';
      });
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  }
  const flatten = (element) => [element, ...element.children.flatMap(flatten)];
  const anchor = new Element('button', { 'aria-label': '角色操作' });
  const document = { ...eventPort('document:'), body: new Element('body'), activeElement: anchor,
    querySelector() { return null; }, querySelectorAll() { return [anchor]; } };
  const window = { ...eventPort('window:'), innerWidth: 1000, innerHeight: 700 };
  const effect = (fn, deps) => {
    const index = cursor++; const previous = hooks[index];
    if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
      pendingEffects.push(() => { previous?.cleanup?.(); hooks[index] = { deps, cleanup: fn() }; });
    }
  };
  const jsx = (type, props) => ({ type, props });
  const modules = {
    react: {
      useState(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial;
        return [hooks[index], (next) => { const value = typeof next === 'function' ? next(hooks[index]) : next;
          if (!Object.is(hooks[index], value)) { hooks[index] = value; dirty = true; } }]; },
      useRef(value) { const index = cursor++; return hooks[index] ?? (hooks[index] = { current: value }); },
      useEffect: effect, useLayoutEffect: effect,
    },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    'react-dom': { createPortal: (child, target) => { assert.equal(target, document.body); return child; } },
    'lucide-react': new Proxy({}, { get: (_, key) => 'icon-' + String(key) }), './workspaceObjectActions.css': {},
  };
  const exports = {};
  runInNewContext(code, { exports, document, window, HTMLElement: Element, Node: Element,
    require(id) { assert.ok(id in modules, id); return modules[id]; } });
  const props = { label: '角色', impact, onClose: () => calls.push('close'), onAddToChat: () => calls.push('chat'),
    onHide: () => calls.push('hide'), onDelete: async () => { calls.push('delete'); return { status: 'deleted' }; }, ...overrides };
  function build(node, path = 'root') {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap((child, index) => build(child, path + ':' + index));
    if (node.type === 'fragment') return build(node.props.children, path + ':fragment');
    const key = path + ':' + node.type + ':' + (node.props.role ?? '');
    const element = cache.get(key) ?? new Element(node.type); cache.set(key, element);
    element.props = node.props; element.children = build(node.props.children, path + ':children');
    if (node.props.ref) node.props.ref.current = element;
    return [element];
  }
  function render() {
    let rounds = 0;
    do {
      assert.ok(rounds++ < 8, 'render settles'); dirty = false; cursor = 0; pendingEffects = [];
      tree = build(exports.default(props))[0];
      const effects = pendingEffects; pendingEffects = []; effects.forEach((fn) => fn());
    } while (dirty);
    return tree;
  }
  const text = (node) => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props.children) : typeof node === 'string' ? node : '';
  const find = (label) => { const found = flatten(tree).find((node) => node.type === 'button' && text(node.props.children) === label); assert.ok(found, label); return found; };
  const emit = (type, target = document.activeElement, extra = {}) => {
    const event = { target, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
    for (const listener of [...(events.get('document:' + type) ?? [])]) listener(event);
    render(); return event;
  };
  render();
  return { props, render, find, calls, document, window, anchor, exports, events,
    nodes: () => flatten(tree), text: () => text(tree.props.children),
    click(label) { const button = find(label); if (button.props.disabled) return; const result = button.props.onClick(); render(); return result; },
    key(key, extra) { return emit('keydown', document.activeElement, { key, ...extra }); },
    outside() { return emit('pointerdown', document.body); }, inside() { return emit('pointerdown', tree); },
    unmount() { hooks.forEach((hook) => hook?.cleanup?.()); },
  };
}

test('legacy props render an anchored menu rather than a centered dialog', () => {
  const f = fixture();
  assert.equal(f.nodes()[0].props.role, 'menu'); assert.equal(f.nodes().some((node) => node.props.role === 'dialog'), false);
  assert.equal(f.nodes().filter((node) => node.props.role === 'menuitem').length, 3);
  assert.equal(f.nodes()[0].props.style.left, 40); assert.equal(f.nodes()[0].props.style.top, 78);
  assert.equal(f.document.activeElement, f.find('添加到对话')); f.unmount();
});

test('pointer coordinates clamp to viewport; geometry also handles narrow screens and viewport offsets', () => {
  const f = fixture({ position: { x: 990, y: 690 } });
  assert.equal(f.nodes()[0].props.style.left, 772); assert.equal(f.nodes()[0].props.style.top, 512);
  const clamp = f.exports.clampObjectMenuPosition;
  for (const [point, size, viewport, expected] of [
    [{ x: -20, y: -10 }, { width: 220, height: 180 }, { width: 320, height: 240 }, [8, 8]],
    [{ x: 400, y: 300 }, { width: 220, height: 180 }, { width: 320, height: 240 }, [92, 52]],
    [{ x: 999, y: 999 }, { width: 500, height: 700 }, { width: 320, height: 240 }, [8, 8]],
    [{ x: 0, y: 0 }, { width: 220, height: 180 }, { width: 320, height: 240, x: 40, y: 60 }, [48, 68]],
  ]) { const result = clamp(point, size, viewport); assert.deepEqual([result.x, result.y], expected); }
  f.window.innerWidth = 320; f.window.innerHeight = 240;
  for (const callback of f.events.get('window:resize')) callback(); f.render();
  assert.equal(f.nodes()[0].props.style.left, 92); assert.equal(f.nodes()[0].props.style.top, 52); f.unmount();
});

test('background menu only shows creation callbacks and no object actions or dangling separators', () => {
  const f = fixture({ label: '项目内容', impact: null, onAddToChat: undefined, onHide: undefined, onDelete: undefined,
    onNewMaterial() {}, onNewShot() {} });
  assert.equal(f.nodes().filter((node) => node.props.role === 'menuitem').length, 3);
  assert.equal(f.nodes().filter((node) => node.props.role === 'separator').length, 0);
  assert.equal(f.nodes()[0].props['aria-label'], '项目内容操作');
  assert.doesNotMatch(f.text(), /添加到对话|从视图移除|从项目删除/); f.unmount();
});

for (const [label, prop, expected] of [['新增图片素材', 'onNewMaterial', 'image'], ['新增视频素材', 'onNewMaterial', 'video'],
  ['新增镜头', 'onNewShot', 'shot'], ['添加到对话', 'onAddToChat', 'chat'], ['从视图移除', 'onHide', 'hide']]) {
  test(`${label} closes and dispatches its original callback once without deletion`, () => {
    let calls = [];
    const f = fixture({ onClose: () => calls.push('close'), [prop]: (kind) => calls.push(kind ?? expected) });
    f.click(label); f.click(label);
    assert.deepEqual(calls, ['close', expected]); assert.equal(f.document.activeElement, f.anchor); f.unmount();
  });
}

test('Arrow/Home/End move focus with wrapping and skip disabled deletion', () => {
  const f = fixture({ impact: null });
  f.key('End'); assert.equal(f.document.activeElement, f.find('从视图移除'));
  f.key('ArrowDown'); assert.equal(f.document.activeElement, f.find('添加到对话'));
  f.key('ArrowUp'); assert.equal(f.document.activeElement, f.find('从视图移除'));
  f.key('Home'); assert.equal(f.document.activeElement, f.find('添加到对话'));
  f.click('从项目删除'); assert.equal(f.nodes()[0].props.role, 'menu'); assert.deepEqual(f.calls, []); f.unmount();
});

test('Escape, outside pointer and Tab close with focus return; inside pointer does not', () => {
  for (const action of ['escape', 'outside', 'tab']) {
    const f = fixture(); f.inside(); assert.deepEqual(f.calls, []);
    if (action === 'outside') f.outside();
    else { const event = f.key(action === 'escape' ? 'Escape' : 'Tab'); assert.equal(event.prevented, action === 'escape'); }
    assert.deepEqual(f.calls, ['close']); assert.equal(f.document.activeElement, f.anchor);
    f.unmount(); assert.ok([...f.events.values()].every((listeners) => listeners.size === 0));
  }
});

test('delete menu opens existing impact confirmation only; back returns focus to delete menuitem', () => {
  const f = fixture(); f.click('从项目删除');
  assert.equal(f.nodes().some((node) => node.props.role === 'menu'), false);
  assert.equal(f.nodes().some((node) => node.props.role === 'dialog'), true);
  assert.match(f.text(), /媒体文件仍保留/); assert.match(f.text(), /01、03/); assert.deepEqual(f.calls, []);
  assert.equal(f.document.activeElement, f.find('返回'));
  f.key('Tab'); assert.equal(f.document.activeElement, f.find('确认从项目删除'));
  f.click('返回'); assert.equal(f.document.activeElement, f.find('从项目删除')); f.unmount();
});

test('only explicit dialog confirmation deletes, locks duplicate submission and closes on success', async () => {
  let resolve; const promise = new Promise((done) => { resolve = done; }); let count = 0;
  const f = fixture({ onDelete: () => { count++; return promise; } });
  f.click('从项目删除'); const first = f.click('确认从项目删除');
  f.find('处理中').props.onClick(); f.outside(); f.key('Escape');
  assert.equal(count, 1); assert.deepEqual(f.calls, []);
  resolve({ status: 'deleted' }); await first; f.render();
  assert.deepEqual(f.calls, ['close']); assert.equal(f.document.activeElement, f.anchor); f.unmount();
});

test('delete refusal stays in the dialog with original reason, and late completion cannot close another surface', async () => {
  const f = fixture({ onDelete: async () => ({ status: 'invalid', reason: '目标已变化' }) });
  f.click('从项目删除'); await f.click('确认从项目删除'); f.render();
  assert.ok(f.nodes().some((node) => node.props.role === 'alert')); assert.match(f.text(), /目标已变化/);
  assert.deepEqual(f.calls, []); f.unmount();
  let resolve; const late = fixture({ onDelete: () => new Promise((done) => { resolve = done; }) });
  late.click('从项目删除'); const operation = late.click('确认从项目删除'); late.unmount();
  resolve({ status: 'deleted' }); await operation; assert.deepEqual(late.calls, []);
});

test('menu CSS is scoped, fixed, scrollable and constrained without editing parent layout', () => {
  const css = readFileSync(new URL('./workspaceObjectActions.css', import.meta.url), 'utf8');
  assert.match(css, /position: fixed/); assert.match(css, /max-width: calc\(100vw - 16px\)/);
  assert.match(css, /max-height: calc\(100dvh - 16px\)/); assert.match(css, /overflow-y: auto/);
  assert.doesNotMatch(css, /gradient|\.workspace-content-list/);
});
