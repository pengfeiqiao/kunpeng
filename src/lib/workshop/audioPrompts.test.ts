import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeAudioPrompts } from './audioPrompts.ts';

test('mergeAudioPrompts drops empty-prompt slots and cleanses stored empty slots', () => {
  const merged = mergeAudioPrompts(
    [{ characterId: 'a', prompt: '原台词' }, { characterId: 'b', prompt: '' }],
    [{ characterId: 'c', prompt: '   ' }, { characterId: 'a', prompt: '新台词' }],
  );
  assert.deepEqual(merged, [{ characterId: 'a', prompt: '新台词' }]);
});

test('mergeAudioPrompts keeps incremental merge semantics for valid entries', () => {
  const merged = mergeAudioPrompts(
    [{ characterId: 'a', prompt: '甲的台词' }],
    [{ characterId: 'b', prompt: '乙的台词' }],
  );
  assert.deepEqual(merged, [{ characterId: 'a', prompt: '甲的台词' }, { characterId: 'b', prompt: '乙的台词' }]);
  // 整组替换（existing=[]）时空槽同样不落盘
  assert.deepEqual(mergeAudioPrompts([], [{ characterId: 'a', prompt: '' }]), []);
});
