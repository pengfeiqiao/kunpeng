import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { imageAttemptStopError } from './attemptPolicy.ts';
import { PaidSubmissionUnknownError, PaidTaskCreatedError } from '../billingSafety.ts';

test('strict workspace image attempts stop on ambiguity and local-save errors; legacy policy unchanged', () => {
  const ambiguous = new PaidSubmissionUnknownError('mock', 'timeout');
  assert.equal(imageAttemptStopError(ambiguous, true), ambiguous);
  assert.equal(imageAttemptStopError(ambiguous), null);
  const created = new PaidTaskCreatedError('mock', 'task', 'save failed');
  assert.equal(imageAttemptStopError(created, true), created);
  assert.equal(imageAttemptStopError(created), null);
  assert.ok(imageAttemptStopError(new Error('unclassified transport failure'), true) instanceof PaidSubmissionUnknownError);
  const abort = new DOMException('Aborted', 'AbortError');
  assert.equal(imageAttemptStopError(abort, true), abort);
});

test('strict stop prevents a mock slot cascade and compression replay', async () => {
  let requests = 0;
  async function mockSlots(strict: boolean) {
    for (const compress of [false, true]) {
      for (const slot of ['a', 'b']) {
        try { requests++; throw new Error(`${slot}:${compress}`); }
        catch (error) { const stop = imageAttemptStopError(error, strict); if (stop) throw stop; }
      }
    }
  }
  await assert.rejects(mockSlots(true), PaidSubmissionUnknownError);
  assert.equal(requests, 1);
  requests = 0;
  await mockSlots(false);
  assert.equal(requests, 4);
});

test('all native canvasGen task creation sites persist workspace binding before callbacks', () => {
  const core = readFileSync(new URL('../canvasGen/index.ts', import.meta.url), 'utf8');
  const taskBlocks = [...core.matchAll(/(?:taskStore|useCanvasTaskStore\.getState\(\))\.addTask\(\{([\s\S]*?)\n  \}\);/g)];
  assert.equal(taskBlocks.length, 12);
  for (const [, block] of taskBlocks) assert.match(block, /workspaceBinding: (?:req|routedReq)\.workspaceBinding/);
  assert.match(core, /if \(task\.workspaceBinding\) return \{ success: false/);
  assert.match(core, /strictPaidSafety: req\.strictPaidSafety/);
  assert.match(core, /req\.strictPaidSafety && \(mustNotAutoResubmit\(fbErr\)/);
  const image = readFileSync(new URL('./client.ts', import.meta.url), 'utf8');
  assert.equal((image.match(/imageAttemptStopError\((?:e|err), params\.strictPaidSafety\)/g) ?? []).length, 2);
});
