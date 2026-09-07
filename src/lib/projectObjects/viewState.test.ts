import assert from 'node:assert/strict';
import test from 'node:test';
import { patchProjectViewState, selectedShotNoFromViewState } from './viewState.ts';

test('project view state preserves shot, conversation and selection across view changes', () => {
  const initial = patchProjectViewState(undefined, {
    selectedShotId: 'shot-2',
    selectedObjectIds: ['character:a'],
    activeConversationId: 'session-1',
    activeView: 'workshop',
    conversationReferences: [{
      id: 'ref-1', objectId: 'shot-2', kind: 'shot', sourceView: 'workshop',
      label: '镜头 01-02', operationScope: 'edit', addedAt: 1,
    }],
  });
  const switched = patchProjectViewState(initial, { activeView: 'canvas' });

  assert.equal(switched.selectedShotId, 'shot-2');
  assert.equal(switched.activeConversationId, 'session-1');
  assert.deepEqual(switched.selectedObjectIds, ['character:a']);
  assert.equal(switched.conversationReferences?.[0].objectId, 'shot-2');
  assert.equal(selectedShotNoFromViewState(switched, [
    { id: 'shot-1', shotNo: '01-01' },
    { id: 'shot-2', shotNo: '01-02' },
  ]), '01-02');
});

test('conversation references are copied instead of sharing mutable objects', () => {
  const refs = [{
    id: 'ref-1', objectId: 'shot-1', kind: 'shot' as const, sourceView: 'workshop' as const,
    label: '镜头 01-01', operationScope: 'edit' as const, addedAt: 1,
  }];
  const state = patchProjectViewState(undefined, { conversationReferences: refs });
  refs[0].label = 'changed outside';
  assert.equal(state.conversationReferences?.[0].label, '镜头 01-01');
});

test('selected object ids are copied instead of sharing mutable arrays', () => {
  const ids = ['scene:a'];
  const state = patchProjectViewState(undefined, { selectedObjectIds: ids });
  ids.push('scene:b');
  assert.deepEqual(state.selectedObjectIds, ['scene:a']);
});
