import test from 'node:test';
import assert from 'node:assert/strict';
import { CoalescedIdleWork, type IdleWorkSchedule } from './coalescedIdleWork.ts';

const waitForTimer = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

test('coalesces repeated work by key and persists only the latest snapshot', async () => {
  const idleCallbacks: Array<() => void> = [];
  const scheduleIdle: IdleWorkSchedule = (callback) => {
    idleCallbacks.push(callback);
    return () => {
      const index = idleCallbacks.indexOf(callback);
      if (index >= 0) idleCallbacks.splice(index, 1);
    };
  };
  const persisted: string[] = [];
  const work = new CoalescedIdleWork<string>((value) => {
    persisted.push(value);
  }, { debounceMs: 0, minIntervalMs: 0, scheduleIdle });

  work.schedule('session-a', 'old');
  work.schedule('session-a', 'latest');
  await waitForTimer();

  assert.equal(idleCallbacks.length, 1);
  idleCallbacks[0]();
  await Promise.resolve();
  assert.deepEqual(persisted, ['latest']);
});

test('flush cancels pending idle work and writes exactly once', async () => {
  const idleCallbacks: Array<() => void> = [];
  const persisted: string[] = [];
  const work = new CoalescedIdleWork<string>((value) => {
    persisted.push(value);
  }, {
    debounceMs: 0,
    minIntervalMs: 0,
    scheduleIdle: (callback) => {
      idleCallbacks.push(callback);
      return () => {
        const index = idleCallbacks.indexOf(callback);
        if (index >= 0) idleCallbacks.splice(index, 1);
      };
    },
  });

  work.schedule('session-a', 'pending');
  await waitForTimer();
  await work.flush('session-a');

  assert.equal(idleCallbacks.length, 0);
  assert.deepEqual(persisted, ['pending']);
});

test('forty tool-event snapshots collapse into one latest idle write', async () => {
  const idleCallbacks: Array<() => void> = [];
  const persisted: number[] = [];
  const work = new CoalescedIdleWork<number>((value) => {
    persisted.push(value);
  }, {
    debounceMs: 0,
    minIntervalMs: 0,
    scheduleIdle: (callback) => {
      idleCallbacks.push(callback);
      return () => {
        const index = idleCallbacks.indexOf(callback);
        if (index >= 0) idleCallbacks.splice(index, 1);
      };
    },
  });

  for (let index = 0; index < 40; index += 1) {
    work.schedule('long-agent-run', index);
  }
  await waitForTimer();

  assert.equal(idleCallbacks.length, 1);
  idleCallbacks[0]();
  await Promise.resolve();
  assert.deepEqual(persisted, [39]);
});
