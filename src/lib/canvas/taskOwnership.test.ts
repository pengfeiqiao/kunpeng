import test from 'node:test';
import assert from 'node:assert/strict';
import { isLatestCanvasTask } from './taskOwnership.ts';
test('late output/failed state never attaches to a different canvas with a colliding node ID', () => {
  const a = { id: 'a', nodeId: 'node', canvasProjectId: 'A' };
  const b = { id: 'b', nodeId: 'node', canvasProjectId: 'B' };
  assert.equal(isLatestCanvasTask(a, [a, b], 'B'), false);
  assert.equal(isLatestCanvasTask(a, [a, b], 'A'), true);
  assert.equal(isLatestCanvasTask(b, [a, b], 'B'), true);
  const old = { id: 'old', nodeId: 'node' };
  assert.equal(isLatestCanvasTask(old, [old, a], 'A'), false);
});
