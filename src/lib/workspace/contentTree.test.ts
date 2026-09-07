import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceContentTree } from './contentTree.ts';
import type { WorkspaceContentGroup, WorkspaceContentItem } from './contentModel.ts';

const item = (id: string, kind: WorkspaceContentItem['kind']): WorkspaceContentItem => ({ id, kind, label: id, description: '', status: '待生成', locked: false });
test('content tree separates roles/scenes/props and retains repeated scene runs under a visible shot heading', () => {
  const groups: WorkspaceContentGroup[] = [
    { id: 'assets', label: '角色、场景与道具', items: [item('driver', 'character'), item('road', 'scene'), item('car', 'prop')] },
    { id: 'scene-run:1', label: '公路', items: [item('1', 'shot')] },
    { id: 'scene-run:2', label: '车内', items: [item('2', 'shot')] },
    { id: 'scene-run:3', label: '公路', items: [item('3', 'shot')] },
    { id: 'audio', label: '音频', items: [item('voice', 'material')] },
  ];
  const before = JSON.stringify(groups);
  const tree = workspaceContentTree(groups);
  assert.deepEqual(tree.map((section) => section.label), ['项目元素', '分镜', '音频']);
  assert.deepEqual(tree[0].groups.map((group) => group.label), ['角色', '场景', '道具']);
  assert.deepEqual(tree[1].groups.map((group) => group.label), ['公路', '车内', '公路']);
  assert.deepEqual(tree[1].groups.flatMap((group) => group.items.map((entry) => entry.id)), ['1', '2', '3']);
  assert.equal(JSON.stringify(groups), before);
});
test('empty navigation has no fake assets and keeps only the empty shot group', () => {
  assert.deepEqual(workspaceContentTree([]), [{ id: 'shots', label: '分镜', groups: [], nested: true }]);
});
