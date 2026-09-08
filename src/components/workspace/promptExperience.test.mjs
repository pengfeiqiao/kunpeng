import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as drafts from '../../lib/workspace/drafts.ts';

const source = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
const jsx = (type, props, key) => ({ type, props, key });
function elements(tree) {
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...[tree.props?.children].flat(Infinity).flatMap(elements)];
}
const byLabel = (tree, label) => elements(tree).find((node) => node.props?.['aria-label'] === label);
// 组件级 aria（如 MentionPromptInput 的 ariaLabel prop）
const byAriaLabel = (tree, label) => elements(tree).find((node) => node.props?.ariaLabel === label);
const byClass = (tree, name) => elements(tree).find((node) => node.props?.className === name);

// Compile the actual components; all side-effecting ports are absent from this runtime.
function runtime(file, extra = {}) {
  const slots = [];
  let cursor = 0;
  const slot = (init) => { const index = cursor++; if (!(index in slots)) slots[index] = init(); return index; };
  const modules = {
    react: {
      useRef: (value) => slots[slot(() => ({ current: value }))],
      useState: (value) => { const index = slot(() => typeof value === 'function' ? value() : value);
        return [slots[index], (next) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
      useId: () => `title-${slot(() => null)}`,
      useEffect: () => {},
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'lucide-react': {},
    '../canvas/StyleLibraryPicker': { default: 'style-picker' },
    './WorkspaceEngineMenu': { default: 'engine-menu' },
    // 功能等价的最小 mock：保留 textarea 语义（aria-label/受控 onChange），不含 @ 选择器 UI
    './MentionPromptInput': { default: (p) => jsx('textarea', { className: 'workspace-prompt', 'aria-label': p.ariaLabel, value: p.draft.prompt, disabled: p.disabled, spellCheck: false, onChange: (event) => p.onChange({ ...p.draft, prompt: event.target.value }) }) },
    '@/lib/workspace/drafts': drafts,
    ...extra,
  };
  const compiled = ts.transpileModule(source(file), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  }, reportDiagnostics: true });
  assert.equal(compiled.diagnostics.length, 0);
  const exports = {};
  runInNewContext(compiled.outputText, { exports, require(id) {
    if (id.endsWith('.css')) return {};
    assert.ok(id in modules, `Unexpected dependency: ${id}`);
    return modules[id];
  }, AbortController });
  return { render(props) { cursor = 0; return exports.default(props); }, slots };
}

const engine = { id: 'fixture', label: 'Fixture', kind: 'video', params: [
  { key: 'ratio', label: '比例', type: 'list', options: ['16:9', '9:16'], default: '16:9' },
  { key: 'duration', label: '时长', type: 'int', default: 5 },
  { key: 'audio', label: '声音', type: 'boolean', default: false },
  { key: 'extra', label: '附加参数', type: 'string', default: '' },
] };
const draft = (objectId = 'A', projectId = 'P') => ({ id: `${objectId}::video`, projectId, objectId,
  outputType: 'video', prompt: '原始正文', engineId: 'fixture', params: {}, references: [], revision: 0, updatedAt: 0 });
function composer(overrides = {}) {
  const run = runtime('./GenerationComposer.tsx');
  const changes = [];
  const props = { draft: draft(), engines: [{ engine }], mediaSrc: (path) => path,
    onChange: (next) => { changes.push(next); props.draft = { ...next, revision: next.revision + 1 }; },
    onGenerate() {}, onClose() {}, onAddReference() {}, onOptimize() {}, onApplyStyle() {}, ...overrides };
  return { run, props, changes, render: () => run.render(props) };
}

test('inline and expanded editors share the latest controlled draft including revisions', () => {
  const c = composer();
  let tree = c.render();
  byAriaLabel(tree, '完整提示词').props.onChange({ ...byAriaLabel(tree, '完整提示词').props.draft, prompt: '面板编辑' });
  tree = c.render();
  assert.equal(byLabel(tree, '大编辑器提示词').props.value, '面板编辑');
  byLabel(tree, '大编辑器提示词').props.onChange({ target: { value: '弹窗编辑' } });
  tree = c.render();
  assert.equal(byAriaLabel(tree, '完整提示词').props.draft.prompt, '弹窗编辑');
  assert.equal(c.changes[1].revision, 1);
  c.props.draft = { ...c.props.draft, prompt: '外部优化结果', revision: 10 };
  tree = c.render();
  assert.equal(byLabel(tree, '大编辑器提示词').props.value, '外部优化结果');
  assert.equal(byAriaLabel(tree, '完整提示词').props.draft.prompt, '外部优化结果');
  assert.equal(c.run.slots.filter((value) => typeof value === 'string').length, 0);
});

test('native modal opens with textarea focus; Escape and both close buttons return focus without resaving', () => {
  const c = composer(); const tree = c.render();
  const dialog = elements(tree).find((node) => node.type === 'dialog');
  const input = byLabel(tree, '大编辑器提示词');
  const trigger = byLabel(tree, '展开大编辑器');
  const events = [];
  dialog.props.ref.current = { showModal: () => events.push('modal'), close: () => { events.push('close'); dialog.props.onClose(); } };
  input.props.ref.current = { focus: () => events.push('input-focus') };
  trigger.props.ref.current = { isConnected: true, focus: () => events.push('trigger-focus') };
  trigger.props.onClick();
  assert.deepEqual(events, ['modal', 'input-focus']);
  dialog.props.onCancel({ preventDefault: () => events.push('prevent') });
  assert.deepEqual(events.slice(2), ['prevent', 'close', 'trigger-focus']);
  byLabel(tree, '返回编辑面板').props.onClick();
  elements(dialog).find((node) => node.type === 'button' && node.props.children === '完成').props.onClick();
  assert.equal(events.filter((event) => event === 'close').length, 3);
  trigger.props.ref.current.isConnected = false;
  dialog.props.onClose();
  assert.equal(events.filter((event) => event === 'trigger-focus').length, 3);
  assert.equal(c.changes.length, 0);
});

test('retained A editor callback never writes A text into B after object selection changes', () => {
  const c = composer(); const oldEditor = byLabel(c.render(), '大编辑器提示词');
  c.props.draft = draft('B'); c.render();
  oldEditor.props.onChange({ target: { value: 'A的未完成输入' } });
  assert.equal(c.changes[0].objectId, 'A');
  assert.equal(c.changes[0].id, 'A::video');
  assert.equal(c.changes[0].projectId, 'P');
});

test('component identity remounts dialogs for project, object, output type and draft switches', () => {
  const run = runtime('./WorkspaceMediaPanel.tsx', {
    '@/lib/workspace/drafts': { ...drafts, initialWorkspaceDraft: (data) => data.fixture },
    '@/lib/workspace/contentModel': { workspaceSelection: (data) => ({ selected: { id: data.fixture.objectId, kind: 'shot', label: 'Shot' }, outputType: data.fixture.outputType, versions: [] }) },
    '@/lib/workspace/submissions': { pendingWorkspaceSubmission: () => null },
    '@/lib/workspace/services': { workspacePriceKey: () => 'quote' },
    '@tauri-apps/api/dialog': { open: async () => null },
    '@/lib/artifacts': { listArtifacts: async () => [] },
    '@/lib/workspace/mediaTools': { workspaceMediaTools: () => [], workspaceMediaToolDraft: () => null },
    './GenerationComposer': { default: 'composer' }, './MediaInspector': { default: 'inspector' },
  });
  const key = (value) => elements(run.render({ data: { fixture: value }, engines: [], onViewState() {} }))
    .find((node) => node.type === 'inspector').props.composer.key;
  const original = key(draft());
  assert.equal(key({ ...draft(), prompt: '新输入', revision: 9 }), original);
  for (const value of [draft('B'), draft('A', 'Q'), { ...draft(), outputType: 'image' }, { ...draft(), id: 'replacement' }]) {
    assert.notEqual(key(value), original);
  }
});

test('common ratio/duration stay directly editable and advanced settings retain all other parameter types', () => {
  const c = composer(); let tree = c.render();
  // 参数默认收进统一抽屉，不占据底栏长列
  assert.equal(byClass(tree, 'workspace-params-drawer'), undefined);
  assert.equal(c.changes.length, 0);
  byLabel(tree, '生成参数设置').props.onClick();
  tree = c.render();
  const drawer = byClass(tree, 'workspace-params-drawer');
  assert.ok(byLabel(drawer, '时长'));
  assert.ok(byLabel(drawer, '附加参数'));
  byLabel(drawer, '比例').props.onChange({ target: { value: '9:16' } });
  byLabel(c.render(), '时长').props.onChange({ target: { value: '8' } });
  elements(c.render()).find((node) => node.props?.type === 'checkbox').props.onChange({ target: { checked: true } });
  byLabel(c.render(), '附加参数').props.onChange({ target: { value: '保留全部' } });
  assert.deepEqual({ ...c.props.draft.params }, { ratio: '9:16', duration: 8, audio: true, extra: '保留全部' });
  c.props.busy = true;
  assert.equal(byLabel(c.render(), '附加参数').props.disabled, true);
});

test('classic/new optimization and full style picker remain wired to supplied callbacks', () => {
  const optimized = []; const styled = [];
  const c = composer({ onOptimize: (value) => optimized.push(value), onApplyStyle: (value) => styled.push(value) });
  const select = byLabel(c.render(), '优化提示词');
  for (const value of ['legacy', 'universal']) select.props.onChange({ target: { value } });
  assert.deepEqual(optimized, ['legacy', 'universal']);
  byLabel(c.render(), '风格库').props.onClick();
  let picker = elements(c.render()).find((node) => node.type === 'style-picker');
  assert.equal(picker.props.library, 'general');
  const style = { id: 'full-library-style', name: '风格' }; picker.props.onApply(style);
  assert.equal(styled[0], style);
  c.props.draft = { ...c.props.draft, engineId: 'midjourney-v7' };
  picker = elements(c.render()).find((node) => node.type === 'style-picker');
  assert.equal(picker.props.library, 'midjourney');
});

test('compact references retain add, reorder, remove and mention rewriting', () => {
  let additions = 0;
  const c = composer({ draft: { ...draft(), prompt: '@图片一 @图片二', references: [
    { id: 'r1', label: '参考甲', type: 'image', path: '/fake/a.png' },
    { id: 'r2', label: '参考乙', type: 'image', path: '/fake/b.png' },
  ] }, onAddReference: () => additions++ });
  byLabel(c.render(), '添加参考素材').props.onClick(); assert.equal(additions, 1);
  byLabel(c.render(), '后移参考甲').props.onClick();
  assert.equal(c.props.draft.references[0].id, 'r2');
  assert.equal(c.props.draft.prompt, '@图片二 @图片一');
  byLabel(c.render(), '移除参考甲').props.onClick();
  assert.equal(c.props.draft.references.length, 1);
  assert.match(c.props.draft.prompt, /参考已移除/);
});

test('generation, estimate and error guards preserve the existing command boundary', () => {
  let generates = 0; let estimates = 0;
  const c = composer({ onGenerate: () => generates++, onEstimate: () => estimates++ });
  byClass(c.render(), 'workspace-primary').props.onClick();
  byLabel(c.render(), '查询费用预估').props.onClick();
  assert.equal(generates, 1); assert.equal(estimates, 1);
  for (const patch of [{ busy: true }, { saving: true }, { engines: [] },
    { engines: [{ engine, unavailableReason: '未配置' }] }, { draft: { ...draft(), prompt: '' } }]) {
    const blocked = composer(patch);
    assert.equal(byClass(blocked.render(), 'workspace-primary').props.disabled, true);
  }
  const panel = source('./WorkspaceMediaPanel.tsx');
  assert.match(panel, /const stored = save\(snapshot\);\s*if \(!stored\) return;/);
  assert.match(panel, /props.onGenerate\(cloneWorkspaceDraft\(stored\)\)/);
  assert.doesNotMatch(source('./GenerationComposer.tsx'), /fetch\(|invoke\(|apiKey|useSettingsStore/);
});

test('assistant action has visible text and retains its exact onEdit callback', () => {
  const run = runtime('./MediaInspector.tsx', {
    '@/lib/workspace/mediaView': { workspaceHistoricalParameters: () => '历史规格' },
    '@/lib/workspace/engineCatalog': { workspaceEngine: () => null },
    'react-dom': { createPortal: (child) => child },
  });
  let edits = 0;
  const tree = run.render({ title: '素材', versions: [], selected: { ordinal: 1,
    media: { id: 'm', path: '/fake/a.png', mediaType: 'image' } }, mediaSrc: (path) => path, onEdit: () => edits++ });
  const action = byLabel(tree, '让助手修改');
  assert.ok(elements(action).some((node) => node.type === 'span' && node.props.children === '让助手修改'));
  action.props.onClick(); assert.equal(edits, 1);
});

test('scoped stylesheet retains compact preview, large body, mobile dialog and reduced motion', () => {
  const css = source('./promptExperience.css');
  assert.match(css, /workspace-prompt-inspector\.workspace-inspector-editing \.workspace-media-stage \{[^}]*height: 140px/);
  assert.match(css, /workspace-prompt-experience \.workspace-prompt \{[^}]*min-height: 220px/);
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.match(css, /100dvh/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /transition: none !important/);
  assert.match(css, /\.workspace-prompt-dialog\[open\]/);
  for (const file of ['./GenerationComposer.tsx', './MediaInspector.tsx']) assert.match(source(file), /import '\.\/promptExperience.css'/);
});
