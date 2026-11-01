import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./kunpeng.mjs', import.meta.url));

function runCli(config, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env: { ...process.env, KUNPENG_CLI_CONFIG: config },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function withMockServer(onMessage, run) {
  const token = 'unit-test-token-never-print';
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.setNoDelay(true);
    let buffer = '';
    let hello = false;
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      while (true) {
        const index = buffer.indexOf('\n');
        if (index < 0) break;
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        if (!hello) {
          assert.equal(message.type, 'hello');
          assert.equal(message.token, token);
          hello = true;
          socket.write(`${JSON.stringify({ type: 'hello_ok', protocol: 1, version: 'test', ready: true })}\n`);
          continue;
        }
        void onMessage(message, socket);
      }
    });
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kunpeng-cli-test-'));
  const config = path.join(dir, 'cli.json');
  await fs.promises.writeFile(config, JSON.stringify({ protocol: 1, host: '127.0.0.1', port: address.port, token }), { mode: 0o600 });
  try {
    return await run(config);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

test('status uses authenticated NDJSON handshake and never prints token', async () => {
  await withMockServer((message, socket) => {
    if (message.type === 'status') socket.write(`${JSON.stringify({ type: 'status', requestId: message.requestId, ok: true, ready: true, activeTasks: 2, protocol: 1, version: 'test' })}\n`);
  }, async (config) => {
    const result = await runCli(config, ['status', '--json']);
    assert.equal(result.code, 0, result.stderr);
    const status = JSON.parse(result.stdout);
    assert.equal(status.ready, true);
    assert.equal(status.activeTasks, 2);
    assert.doesNotMatch(result.stdout + result.stderr, /unit-test-token-never-print/);
  });
});

test('agent task keeps named session and defaults confirmation to deny', async () => {
  await withMockServer((message, socket) => {
    if (message.type !== 'run_task') return;
    assert.equal(message.session, 'film-01');
    assert.equal(message.autoApprove, false);
    socket.write(`${JSON.stringify({ type: 'task_event', requestId: message.requestId, event: { type: 'text', text: '完成' } })}\n`);
    socket.write(`${JSON.stringify({ type: 'task_result', requestId: message.requestId, ok: true, text: '完成', session: message.session })}\n`);
  }, async (config) => {
    const result = await runCli(config, ['task', '总结项目', '--session', 'film-01', '--json']);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).text, '完成');
  });
});

test('canvas direct command preserves node, engine and generation params without Agent', async () => {
  await withMockServer((message, socket) => {
    if (message.type !== 'run_tool') return;
    assert.equal(message.name, 'canvas_generate');
    assert.equal(message.params.node_id, 'node-1');
    assert.equal(message.params.engine, 'gpt-image-2.5');
    assert.equal(message.params.params.aspectRatio, '16:9');
    assert.deepEqual(message.params.reference_urls, ['/tmp/ref.png']);
    socket.write(`${JSON.stringify({ type: 'task_result', requestId: message.requestId, ok: true, text: '节点已更新', data: { tool: message.name } })}\n`);
  }, async (config) => {
    const result = await runCli(config, ['canvas', '生成画面', '--node', 'node-1', '--model', 'gpt-image-2.5', '--ratio', '16:9', '--reference', '/tmp/ref.png', '--json']);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).data.tool, 'canvas_generate');
  });
});

test('workshop direct command targets real workshop generation queue', async () => {
  await withMockServer((message, socket) => {
    if (message.type !== 'run_tool') return;
    assert.equal(message.name, 'workshop_generate');
    assert.equal(message.params.kind, 'video');
    assert.equal(message.params.targets, '01-01,01-02');
    socket.write(`${JSON.stringify({ type: 'task_result', requestId: message.requestId, ok: true, text: '已排队' })}\n`);
  }, async (config) => {
    const result = await runCli(config, ['workshop', '--kind', 'video', '--targets', '01-01,01-02']);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /已排队/);
  });
});

test('stream-json emits task lifecycle and timeout never resubmits paid tool', async () => {
  let submissions = 0;
  await withMockServer((message, socket) => {
    if (message.type === 'run_tool') {
      submissions += 1;
      return;
    }
    if (message.type === 'cancel_task') {
      socket.write(`${JSON.stringify({ type: 'cancel_result', requestId: message.requestId, ok: true })}\n`);
      socket.write(`${JSON.stringify({ type: 'task_result', requestId: message.requestId, ok: false, error: '已取消' })}\n`);
    }
  }, async (config) => {
    const result = await runCli(config, ['image', '付费生成', '--timeout', '1', '--stream-json']);
    assert.equal(result.code, 3, result.stderr);
    const events = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(events[0].type, 'task_started');
    assert.equal(events.at(-1).type, 'result');
    assert.equal(submissions, 1);
  });
});
