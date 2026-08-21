import assert from 'node:assert/strict';
import test from 'node:test';
import { cursorForTrajectories, freshTrajectories } from './evolutionCursor.ts';

test('durable cursor survives trajectory file trimming', () => {
  const original = Array.from({ length: 800 }, (_, index) => ({ ts: index + 1 }));
  const cursor = { offset: 800, ...cursorForTrajectories(original) };
  const trimmedWithNew = [...original.slice(-599), { ts: 801 }];
  assert.deepEqual(freshTrajectories(trimmedWithNew, cursor), [{ ts: 801 }]);
});

test('cursor ordinal preserves records sharing the same timestamp', () => {
  const cursor = { offset: 0, cursorTs: 20, cursorCountAtTs: 1 };
  assert.deepEqual(
    freshTrajectories([{ ts: 20, id: 'old' }, { ts: 20, id: 'new' }, { ts: 21, id: 'later' }], cursor),
    [{ ts: 20, id: 'new' }, { ts: 21, id: 'later' }],
  );
});

test('legacy offset state remains compatible', () => {
  assert.deepEqual(freshTrajectories([{ ts: 1 }, { ts: 2 }], { offset: 1 }), [{ ts: 2 }]);
});
