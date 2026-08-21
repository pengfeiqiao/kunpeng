import test from 'node:test';
import assert from 'node:assert/strict';
import { withRemoteAgentTimeout } from './remoteRun.ts';

test('returns the remote result before timeout', async () => {
  let aborted = false;
  const result = await withRemoteAgentTimeout(Promise.resolve('ok'), () => { aborted = true; }, 50);
  assert.equal(result, 'ok');
  assert.equal(aborted, false);
});

test('aborts a stuck remote run', async () => {
  let aborted = false;
  await assert.rejects(
    withRemoteAgentTimeout(new Promise<string>(() => {}), () => { aborted = true; }, 5),
    /已自动停止/,
  );
  assert.equal(aborted, true);
});
