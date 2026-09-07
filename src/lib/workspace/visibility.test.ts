import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkshopData } from '../workshop/types.ts';
import { setWorkspaceListVisibility, setWorkspaceCanvasVisibility } from './visibility.ts';
import { reconcileWorkspaceCanvasLayout } from './canvasLayout.ts';

test('view removal preserves business objects, drafts and references; restoring is idempotent', () => {
  const data = emptyWorkshopData('visibility');
  const hidden = setWorkspaceListVisibility(data, 'shot:a', false);
  assert.deepEqual(hidden.projectViewState?.workspaceHiddenObjectIds, ['shot:a']);
  assert.equal(hidden.shots, data.shots);
  assert.equal(hidden.projectObjects, data.projectObjects);
  assert.equal(hidden.workspaceDrafts, data.workspaceDrafts);
  assert.equal(setWorkspaceListVisibility(hidden, 'shot:a', false), hidden);
  assert.deepEqual(setWorkspaceListVisibility(hidden, 'shot:a', true).projectViewState?.workspaceHiddenObjectIds, []);
});

test('canvas removal is layout-only and new object reconciliation does not resurrect hidden cards', () => {
  const layout = reconcileWorkspaceCanvasLayout({ schemaVersion: 1, projectId: 'p', positions: {}, nextSlot: 0 }, ['a']);
  const hidden = setWorkspaceCanvasVisibility(layout, 'a', false);
  assert.equal(hidden.positions.a.hidden, true);
  assert.equal(reconcileWorkspaceCanvasLayout(hidden, ['a', 'b']).positions.a.hidden, true);
  const restored = setWorkspaceCanvasVisibility(hidden, 'a', true);
  assert.equal(restored.positions.a.x, layout.positions.a.x);
  assert.equal(restored.positions.a.y, layout.positions.a.y);
  assert.equal(restored.positions.a.pending, layout.positions.a.pending);
});
