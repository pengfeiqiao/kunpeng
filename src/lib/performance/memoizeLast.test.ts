import test from 'node:test';
import assert from 'node:assert/strict';
import { memoizeLast } from './memoizeLast.ts';
test('immutable projections skip unrelated updates but invalidate on every dependency and switch', () => {
  let calls = 0;
  const project = memoizeLast((id: string, spec: object | undefined) => ({ id, spec, call: ++calls }));
  const spec = {}; const first = project('p', spec);
  for (let i = 0; i < 1000; i++) assert.equal(project('p', spec), first);
  assert.equal(calls, 1);
  assert.notEqual(project('p', {}), first); project('other', spec); project('p', spec); project('p', undefined);
  assert.equal(calls, 5);
});
