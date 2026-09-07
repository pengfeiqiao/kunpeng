import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_WORKSPACE_LAYOUT_WIDTHS, WORKSPACE_COLUMN_GAP, WORKSPACE_COLUMN_LIMITS,
  fitWorkspaceLayoutWidths, normalizeWorkspaceLayoutWidths, resizeWorkspaceColumn,
  workspaceColumnKeyboardDelta, workspaceColumnMaximum } from './layoutWidths.ts';
import { patchProjectViewState } from '../projectObjects/viewState.ts';

test('layout defaults and persisted widths are finite, bounded, rounded and independently copied', () => {
  assert.deepEqual(normalizeWorkspaceLayoutWidths(), { content: 320, assistant: 360 });
  assert.deepEqual(normalizeWorkspaceLayoutWidths({ content: NaN, assistant: Infinity }), { content: 320, assistant: 360 });
  assert.deepEqual(normalizeWorkspaceLayoutWidths({ content: -12, assistant: 9999 }), { content: 220, assistant: 560 });
  assert.equal(normalizeWorkspaceLayoutWidths({ content: 323.7 }).content, 324);
  const input = { content: 300, assistant: 400 };
  const a = patchProjectViewState(undefined, { workspaceLayoutWidths: input, workspaceSurface: 'media' });
  input.content = 450;
  const b = patchProjectViewState(a, { workspaceSurface: 'editor' });
  assert.deepEqual(b.workspaceLayoutWidths, { content: 300, assistant: 400 });
  b.workspaceLayoutWidths!.assistant = 500;
  assert.equal(a.workspaceLayoutWidths!.assistant, 400);
  const otherProject = patchProjectViewState(undefined, {});
  assert.equal(otherProject.workspaceLayoutWidths, undefined);
});

test('every docked combination fits its total budget and preserves at least 420px center', () => {
  for (const content of [false, true]) for (const assistant of [false, true]) for (const collapsed of [false, true]) {
    for (let available = 300; available <= 1800; available += 7) {
      const columns = { content, assistant, collapsed };
      const result = fitWorkspaceLayoutWidths({ content: 480, assistant: 560 }, available, columns);
      if (result.compact) { assert.equal(result.center, available); continue; }
      const rail = !assistant && collapsed ? 36 : 0;
      const gap = WORKSPACE_COLUMN_GAP * (Number(content) + Number(assistant || Boolean(rail)));
      const total = result.center + (content ? result.content : 0) + (assistant ? result.assistant : 0) + rail + gap;
      assert.equal(total, available);
      assert.ok(result.center >= 420, JSON.stringify({ available, columns, result }));
      assert.ok(result.content >= 220); assert.ok(result.assistant >= 280);
    }
  }
});

test('viewport clamps are transient and recover the preferred widths when space returns', () => {
  const preferred = { content: 480, assistant: 560 };
  const columns = { content: true, assistant: true, collapsed: false };
  const small = fitWorkspaceLayoutWidths(preferred, 1100, columns);
  assert.ok(small.content < preferred.content); assert.ok(small.assistant < preferred.assistant);
  assert.deepEqual(preferred, { content: 480, assistant: 560 });
  const restored = fitWorkspaceLayoutWidths(preferred, 1600, columns);
  assert.equal(restored.content, 480); assert.equal(restored.assistant, 560);
  assert.equal(fitWorkspaceLayoutWidths(preferred, 935, columns).compact, true);
  assert.equal(fitWorkspaceLayoutWidths(preferred, 936, columns).center, 420);
});

test('hidden directory and hidden or enlarged assistant reserve no phantom tracks or gaps', () => {
  const full = fitWorkspaceLayoutWidths(undefined, 1000, { content: false, assistant: false, collapsed: false });
  assert.equal(full.center, 1000);
  const rail = fitWorkspaceLayoutWidths(undefined, 1000, { content: false, assistant: false, collapsed: true });
  assert.equal(rail.center, 1000 - 36 - 8);
  const right = fitWorkspaceLayoutWidths(undefined, 1200, { content: false, assistant: true, collapsed: false });
  assert.equal(right.center, 1200 - 360 - 8);
});

test('resize clamps the selected pane and retains the other effective pane without center overflow', () => {
  const columns = { content: true, assistant: true, collapsed: false };
  for (const available of [936, 1100, 1184, 1264, 1424, 1900]) {
    for (const column of ['content', 'assistant'] as const) {
      const before = fitWorkspaceLayoutWidths(DEFAULT_WORKSPACE_LAYOUT_WIDTHS, available, columns);
      const next = resizeWorkspaceColumn(DEFAULT_WORKSPACE_LAYOUT_WIDTHS, column, 10000, available, columns);
      const other = column === 'content' ? 'assistant' : 'content';
      assert.equal(next[other], before[other]);
      assert.equal(next[column], workspaceColumnMaximum(column, available, before, columns));
      assert.ok(fitWorkspaceLayoutWidths(next, available, columns).center >= 420);
      assert.equal(resizeWorkspaceColumn(next, column, -100, available, columns)[column], WORKSPACE_COLUMN_LIMITS[column].min);
    }
  }
});

test('arrows track separator motion on both sides with fine and shift increments', () => {
  assert.equal(workspaceColumnKeyboardDelta('content', 'ArrowRight'), 10);
  assert.equal(workspaceColumnKeyboardDelta('content', 'ArrowLeft', true), -40);
  assert.equal(workspaceColumnKeyboardDelta('assistant', 'ArrowLeft'), 10);
  assert.equal(workspaceColumnKeyboardDelta('assistant', 'ArrowRight', true), -40);
  assert.equal(workspaceColumnKeyboardDelta('assistant', 'Enter'), null);
});
