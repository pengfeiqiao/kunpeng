import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRemoteCommand, REMOTE_COMMAND_HELP } from './remoteCommands.ts';

test('remote commands are exact and support Chinese aliases', () => {
  assert.equal(parseRemoteCommand(' /status '), 'status');
  assert.equal(parseRemoteCommand('/STOP'), 'stop');
  assert.equal(parseRemoteCommand('/新会话'), 'new');
  assert.equal(parseRemoteCommand('/帮助'), 'help');
});

test('normal prompts are never intercepted as remote commands', () => {
  assert.equal(parseRemoteCommand('请 /stop 这个词写进文案'), null);
  assert.equal(parseRemoteCommand('停止'), null);
  assert.equal(parseRemoteCommand('/unknown'), null);
  assert.match(REMOTE_COMMAND_HELP, /\/status/);
});
