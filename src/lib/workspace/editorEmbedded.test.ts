import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Editor embedded source contract hides only the old top bar and chat while retaining professional surfaces', async () => {
  const source = await readFile(new URL('../../components/editor/EditorView.tsx', import.meta.url), 'utf8');
  assert.match(source, /embedded\?: boolean/);
  assert.match(source, /embedded = false/);
  assert.match(source, /\{!embedded && <EditorTopBar/);
  assert.match(source, /\{!embedded && <EditorChatPanel/);
  for (const component of ['EditorToolbar', 'PreviewPlayer', 'PropertiesPanel', 'TimelineTracks', 'ShortcutPanel', 'PlanPanel', 'AiBoxOverlay']) {
    assert.match(source, new RegExp(`<${component}\\b`));
  }
  assert.match(source, /\{embedded && <EditorEmbeddedTools/);
});

test('embedded tools retain top-bar-only actions and reuse existing export dialog and editor prompt route', async () => {
  const source = await readFile(new URL('../../components/editor/EditorEmbeddedTools.tsx', import.meta.url), 'utf8');
  for (const label of ['剪辑模式', '剪辑画幅', '自动字幕', '智能剪口播', 'AI 剪流畅', 'AI 配特效', '导出']) assert.ok(source.includes(label));
  assert.match(source, /<ExportDialog/);
  assert.match(source, /dispatchEditorPrompt\(motionRouterPrompt\(\)\)/);
  assert.match(source, /setWorkflowMode/);
  assert.match(source, /setAspect/);
});
