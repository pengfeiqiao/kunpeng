import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { workspaceContentTree } from '../../lib/workspace/contentTree.ts';

const source = readFileSync(new URL('./ProjectContentList.tsx', import.meta.url), 'utf8');
const flatten = (node) => Array.isArray(node) ? node.flatMap(flatten) : node && typeof node === 'object' ? [node, ...flatten(node.props?.children)] : [];
const made = (id, kind = 'shot') => ({ id, label: id, kind, description: id + ' description', status: '待生成', locked: false });
const click = (extra = {}) => ({ preventDefault() {}, ...extra });

function runtime(overrides = {}) {
  const scopes = new Map(); const effects = []; const observers = []; const listeners = new Set();
  let active; let cursor = 0;
  const jsx = (type, props, key) => ({ type, props, key });
  const slot = (initial) => { const i = cursor++; if (!(i in active)) active[i] = initial(); return i; };
  const modules = { 'react/jsx-runtime': { jsx, jsxs: jsx }, react: {
    useMemo: (fn) => fn(),
    useState: (initial) => { const states = active; const i = slot(() => typeof initial === 'function' ? initial() : initial);
      return [states[i], (value) => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
    useRef: (value) => active[slot(() => ({ current: value }))],
    useId: () => `excerpt-${slot(() => null)}`,
    useEffect: (effect, deps) => { const states = active; const i = slot(() => undefined); const previous = states[i];
      if (!previous || deps.some((value, n) => value !== previous.deps[n])) effects.push(() => {
        previous?.cleanup?.(); states[i] = { deps, cleanup: effect() };
      }); },
  }, 'lucide-react': new Proxy({}, { get: (_, key) => key }), '@/lib/workspace/contentTree': { workspaceContentTree },
    './WorkspaceVisibleItem': { default: 'visible-item' }, './workspace.css': {}, './contentTree.css': {} };
  const exports = {};
  const parsed = ts.transpileModule(source, { reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } });
  assert.equal(parsed.diagnostics.length, 0);
  runInNewContext(parsed.outputText, { exports, require: (id) => { assert.ok(id in modules, id); return modules[id]; }, Set,
    window: { addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) },
    ResizeObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } },
  });
  const calls = []; const batches = [];
  const props = { groups: [{ id: 'assets', label: '项目元素', items: [made('角色A', 'character'), made('场景B', 'scene')] },
    { id: 'scene-run:1', label: '第一场', items: ['镜头1', '镜头2', '镜头3'].map((id) => made(id)) }],
    mediaSrc: (path) => path, onSelect: (id) => calls.push(id), onAddToChat: (ids) => batches.push([...ids]),
    onScriptTools: () => calls.push('script'), renderMediaGroup: (item) => jsx('div', { 'aria-label': item.id + '媒体组' }), ...overrides };
  const renderScope = (component, props, scope) => {
    if (!scopes.has(scope)) scopes.set(scope, []);
    active = scopes.get(scope); cursor = 0; return flatten(component(props));
  };
  const render = () => renderScope(exports.default, props, 'root');
  const find = (label) => { const node = render().find((node) => node.props?.['aria-label'] === label); assert.ok(node, label); return node; };
  const expandAll = () => { for (let i = 0; i < 6; i++) {
    const heads = render().filter((node) => typeof node.props?.className === 'string' && node.props.className.includes('workspace-group-heading') && node.props['aria-expanded'] === false);
    if (!heads.length) break;
    heads.forEach((node) => node.props.onClick());
  } };
  return { props, calls, batches, observers, listeners, render, find, expandAll,
    chosen: () => render().filter((node) => node.props?.className === 'workspace-content-open' && node.props['aria-pressed']).map((node) => node.props['aria-label'].slice(2)),
    excerpt(label) { const child = render().find((node) => typeof node.type === 'function' && node.props.label === label); assert.ok(child, label);
      return renderScope(child.type, child.props, label + child.key); },
    flush() { while (effects.length) effects.shift()(); },
    unmount() { for (const states of scopes.values()) for (const value of states) value?.cleanup?.(); },
  };
}

test('default rows have no checkbox, more button or reserved selection control', () => {
  const r = runtime({ onObjectMenu() {} }); r.expandAll();
  assert.equal(r.render().some((node) => node.props?.type === 'checkbox'), false);
  assert.equal(r.render().some((node) => node.props?.className?.includes('workspace-object-menu-button')), false);
  assert.equal(r.render().some((node) => node.props?.['aria-label'] === '多选工具'), false);
  assert.match(r.find('打开镜头1').props.title, /Cmd\/Ctrl.*Shift/);
});

test('Cmd/Ctrl toggle batch targets without switching the inspector; plain click clears batch', () => {
  const r = runtime({ selectedId: '镜头1' }); r.expandAll();
  r.find('打开镜头2').props.onClick(click({ metaKey: true }));
  assert.deepEqual(r.chosen(), ['镜头1', '镜头2']);
  r.find('打开镜头3').props.onClick(click({ ctrlKey: true }));
  r.find('打开镜头2').props.onClick(click({ ctrlKey: true }));
  assert.deepEqual(r.chosen(), ['镜头1', '镜头3']);
  r.find('批量添加到对话').props.onClick(); assert.deepEqual(r.batches, [['镜头1', '镜头3']]);
  assert.deepEqual(r.calls, []);
  r.find('打开场景B').props.onClick(click());
  assert.deepEqual(r.chosen(), []); assert.deepEqual(r.calls, ['场景B']);
});

test('Shift ranges follow visible order, support reverse/additive selection and ignore filtered anchors', () => {
  const r = runtime(); r.expandAll();
  r.find('打开镜头3').props.onClick();
  r.find('打开镜头1').props.onClick(click({ shiftKey: true }));
  assert.deepEqual(r.chosen(), ['镜头1', '镜头2', '镜头3']);
  r.find('取消多选').props.onClick();
  r.find('打开角色A').props.onClick(click({ metaKey: true }));
  r.find('打开镜头1').props.onClick(click({ metaKey: true }));
  r.find('打开镜头3').props.onClick(click({ shiftKey: true, metaKey: true }));
  assert.deepEqual(r.chosen(), ['角色A', '镜头1', '镜头2', '镜头3']);
  r.find('搜索项目内容').props.onChange({ target: { value: '镜头2' } });
  r.find('打开镜头2').props.onClick(click({ shiftKey: true }));
  assert.deepEqual(r.chosen(), ['镜头2']);
});

test('collapsed groups stay outside Shift ranges and deleted IDs never reach batch actions', () => {
  const r = runtime(); r.expandAll(); r.find('打开角色A').props.onClick();
  const scene = r.render().find((node) => node.type === 'button' && node.props.className === 'workspace-group-heading'
    && flatten(node).some((entry) => entry.props?.children === '场景'));
  scene.props.onClick(); r.find('打开镜头1').props.onClick(click({ shiftKey: true }));
  assert.deepEqual(r.chosen(), ['角色A', '镜头1']);
  r.props.groups = r.props.groups.map((group) => ({ ...group, items: group.items.filter((item) => item.id !== '角色A') }));
  r.find('批量添加到对话').props.onClick(); assert.deepEqual(r.batches, [['镜头1']]);
});

test('article menu receives exact ID/client position, blocks native menu and bubbling, keeps one-arg compatibility', () => {
  const menus = []; const r = runtime({ onObjectMenu: (...args) => menus.push(args) }); r.expandAll();
  const article = r.render().find((node) => node.type === 'article' && flatten(node).some((item) => item.props?.['aria-label'] === '打开镜头2'));
  let prevented = 0; let stopped = 0;
  article.props.onContextMenu({ clientX: 72, clientY: 193, preventDefault: () => prevented++, stopPropagation: () => stopped++ });
  assert.equal(menus[0][0], '镜头2'); assert.deepEqual({ ...menus[0][1] }, { x: 72, y: 193 });
  assert.equal(prevented, 1); assert.equal(stopped, 1); assert.deepEqual(r.calls, []);
  const legacy = runtime({ onObjectMenu: (id) => menus.push(id) }); legacy.expandAll();
  legacy.render().find((node) => node.type === 'article').props.onContextMenu({ clientX: 0, clientY: 0, preventDefault() {}, stopPropagation() {} });
  assert.equal(menus[1], '角色A');
});

test('background menu only fires on blank directory containers, not controls or media descendants', () => {
  const menus = []; const r = runtime({ onBackgroundMenu: (point) => menus.push(point) });
  const menu = r.find('项目内容列表').props.onContextMenu;
  let prevented = 0;
  const event = { clientX: 25, clientY: 350, preventDefault: () => prevented++, stopPropagation() {}, target: { matches: () => true, closest: () => null } };
  menu(event); assert.deepEqual({ ...menus[0] }, { x: 25, y: 350 });
  menu({ ...event, target: { matches: () => false, closest: () => null } });
  menu({ ...event, target: { matches: () => true, closest: () => ({}) } });
  assert.equal(menus.length, 1); assert.equal(prevented, 1);
});

test('description/script text expand independently, preserve every character and expose accessible controls', () => {
  const long = '完整画面描述，保留所有细节。'.repeat(20);
  const r = runtime({ scriptExcerpt: long, groups: [{ id: 'assets', label: '项目元素', items: [{ ...made('角色A', 'character'), description: long }] }] }); r.expandAll();
  r.find('展开角色A素材').props.onClick();
  const text = (label) => r.excerpt(label).find((node) => node.type === 'p');
  const toggle = (label) => r.excerpt(label).find((node) => node.type === 'button');
  assert.equal(text('角色A描述').props['data-expanded'], false); assert.equal(text('角色A描述').props.children, long);
  assert.equal(toggle('角色A描述').props['aria-controls'], text('角色A描述').props.id);
  toggle('角色A描述').props.onClick();
  assert.equal(text('角色A描述').props['data-expanded'], true); assert.equal(text('剧本摘录').props['data-expanded'], false);
  assert.equal(toggle('角色A描述').props['aria-label'], '收起角色A描述');
  toggle('剧本摘录').props.onClick(); toggle('角色A描述').props.onClick();
  assert.equal(text('剧本摘录').props['data-expanded'], true); assert.equal(text('角色A描述').props.children, long);
  assert.deepEqual(r.calls, []);
});

test('real overflow overrides length heuristic and measurement observers clean up on unmount', () => {
  const r = runtime({ scriptExcerpt: '短文本窄栏也可能换成四行' }); r.expandAll();
  const paragraph = r.excerpt('剧本摘录').find((node) => node.type === 'p');
  paragraph.props.ref.current = { clientHeight: 60, scrollHeight: 90 }; r.flush();
  assert.ok(r.excerpt('剧本摘录').some((node) => node.props?.['aria-label'] === '展开剧本摘录'));
  paragraph.props.ref.current.scrollHeight = 60; r.observers[0].callback();
  assert.equal(r.excerpt('剧本摘录').some((node) => node.type === 'button'), false);
  r.unmount(); assert.equal(r.listeners.size, 0); assert.equal(r.observers[0].disconnected, true);
});

test('typography keeps hierarchy, shallow indent, three-line description and full row titles', () => {
  const css = readFileSync(new URL('./contentTree.css', import.meta.url), 'utf8');
  assert.match(css, /workspace-tree-heading \{[^}]*font-weight: 600; font-size: 13px/);
  assert.match(css, /workspace-group-heading \{[^}]*font-size: 12px; font-weight: 500/);
  assert.match(css, /workspace-content-copy small \{[^}]*font-size: 11px/);
  assert.match(css, /workspace-tree-excerpt-text \{[^}]*-webkit-line-clamp: 3[^}]*font-size: 12px[^}]*line-height: 1.65/);
  assert.match(css, /workspace-tree-subgroup \{ margin-left: 8px/); assert.doesNotMatch(css, /item-line > input/);
  const item = { ...made('镜头1'), shotNo: '01-01', description: '完整描述'.repeat(40) };
  const r = runtime({ groups: [{ id: 'scene-run:1', label: '第一场', items: [item] }] }); r.expandAll();
  assert.ok(flatten(r.find('打开镜头1')).some((node) => node.props?.title === item.description));
});

test('content navigation expands multiple assets independently and script has the same collapsible hierarchy', () => {
  const states = []; let cursor = 0;
  const jsx = (type, props) => ({ type, props });
  const modules = { 'react/jsx-runtime': { jsx, jsxs: jsx }, react: {
    useMemo: (fn) => fn(), useRef: (value) => { const index = cursor++; return states[index] ??= { current: value }; },
    useId: () => 'excerpt', useEffect: () => {}, useState: (initial) => { const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], (value) => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
  }, 'lucide-react': new Proxy({}, { get: (_, key) => key }), '@/lib/workspace/contentTree': { workspaceContentTree },
    './WorkspaceVisibleItem': { default: 'visible-item' }, './workspace.css': {}, './contentTree.css': {} };
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('./ProjectContentList.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (id) => { assert.ok(id in modules, id); return modules[id]; }, Set });
  const made = (id, kind) => ({ id, label: id, kind, description: id + ' description', status: '待生成', locked: false });
  const calls = [];
  const props = { groups: [{ id: 'assets', label: '项目元素', items: [made('角色A', 'character'), made('场景B', 'scene')] }],
    mediaSrc: (path) => path, onSelect: (id) => calls.push(id), onAddToChat: () => {}, onScriptTools: () => calls.push('script'),
    renderMediaGroup: (item) => jsx('div', { 'aria-label': item.id + '媒体组' }) };
  const flatten = (node) => Array.isArray(node) ? node.flatMap(flatten) : node && typeof node === 'object' ? [node, ...flatten(node.props?.children)] : [];
  const render = () => { cursor = 0; return flatten(exports.default(props)); };
  const find = (label) => { const node = render().find((node) => node.props?.['aria-label'] === label); assert.ok(node, label); return node; };
  // 分区默认收起：循环展开（嵌套分组在分区展开后才渲染）
  for (let i = 0; i < 6; i++) {
    const heads = render().filter((node) => typeof node.props?.className === 'string' && node.props.className.includes('workspace-group-heading') && node.props['aria-expanded'] === false);
    if (!heads.length) break;
    heads.forEach((node) => node.props.onClick());
  }
  find('展开角色A素材').props.onClick(); find('展开场景B素材').props.onClick();
  find('角色A媒体组'); find('场景B媒体组');
  assert.deepEqual(calls, [], 'expanding is not a selection/edit');
  find('收起角色A素材').props.onClick();
  assert.equal(render().some((node) => node.props?.['aria-label'] === '角色A媒体组'), false);
  find('场景B媒体组');
  find('打开角色A').props.onClick(); assert.deepEqual(calls, ['角色A']);
  find('角色A媒体组'); find('场景B媒体组');
  const heading = render().find((node) => node.props?.className === 'workspace-group-heading workspace-tree-heading'
    && flatten(node).some((entry) => entry.type === 'span' && entry.props.children === '剧本'));
  assert.equal(heading.props['aria-expanded'], true); heading.props.onClick();
  assert.equal(render().some((node) => node.props?.className === 'workspace-tree-script-open'), false);
});
