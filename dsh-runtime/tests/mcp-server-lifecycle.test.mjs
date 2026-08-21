import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeDir = path.resolve(here, '..');
const serverScript = path.join(runtimeDir, 'kunpeng-mcp-server.mjs');

const ENV_BASE = {
  KUNPENG_TOOL_BRIDGE_TOKEN: 'test-token',
  KUNPENG_DSH_RUN_ID: 'run-test',
  KUNPENG_DSH_INSTANCE_ID: 'inst-test',
};

/**
 * Start a fake Kunpeng TCP bridge. The returned object lets each test drive
 * the bridge side of the wire protocol (hello -> hello_ok, requests).
 */
async function startFakeBridge(onConnection) {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    sockets.add(socket);
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line) onConnection(socket, JSON.parse(line));
      }
    });
    socket.on('close', () => sockets.delete(socket));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return {
    port,
    sockets,
    close: () => {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

function spawnMcpServer(port, extraEnv = {}) {
  const child = spawn(process.execPath, [serverScript], {
    cwd: runtimeDir,
    env: {
      ...process.env,
      ...ENV_BASE,
      KUNPENG_TOOL_BRIDGE_ADDR: `127.0.0.1:${port}`,
      ...extraEnv,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  return child;
}

function exitWithin(child, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${label}: process did not exit within ${ms}ms (orphan risk)`));
    }, ms);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

function handshake(socket, message) {
  if (message.type === 'hello') {
    socket.write(`${JSON.stringify({ type: 'hello_ok' })}\n`);
  }
}

test('mcp server exits when the tool bridge socket closes (supervisor relaunch model)', async () => {
  let child;
  const bridge = await startFakeBridge((socket, message) => {
    handshake(socket, message);
    if (message.type === 'hello') {
      // Give the server a moment to finish stdio setup, then drop the bridge.
      setTimeout(() => socket.destroy(), 100);
    }
  });
  try {
    child = spawnMcpServer(bridge.port);
    const { code } = await exitWithin(child, 5000, 'bridge-close exit');
    assert.equal(code, 0, 'clean exit lets the DSH MCP supervisor relaunch a fresh connection');
  } finally {
    bridge.close();
    child?.kill('SIGKILL');
  }
});

test('mcp server exits on stdin EOF instead of lingering as an orphan', async () => {
  const bridge = await startFakeBridge(handshake);
  let child;
  try {
    child = spawnMcpServer(bridge.port);
    // Wait for the hello handshake before cutting stdin.
    await new Promise((resolve) => setTimeout(resolve, 500));
    child.stdin.end();
    const { code } = await exitWithin(child, 5000, 'stdin-EOF exit');
    assert.equal(code, 0);
  } finally {
    bridge.close();
    child?.kill('SIGKILL');
  }
});

test('mcp tools/list round-trips through the TCP bridge with run identity', async () => {
  let seenHello = null;
  let sawListTools = null;
  const bridge = await startFakeBridge((socket, message) => {
    if (message.type === 'hello') {
      seenHello = message;
      socket.write(`${JSON.stringify({ type: 'hello_ok' })}\n`);
      return;
    }
    if (message.type === 'list_tools') {
      sawListTools = message;
      socket.write(`${JSON.stringify({
        requestId: message.requestId,
        ok: true,
        result: [{ name: 'canvas_probe', description: 'probe', inputSchema: { type: 'object' } }],
      })}\n`);
    }
  });
  let child;
  try {
    child = spawnMcpServer(bridge.port);
    let stdoutBuffer = '';
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no tools/list response within 5s')), 5000);
      child.stdout.on('data', (chunk) => {
        stdoutBuffer += chunk;
        const idx = stdoutBuffer.indexOf('\n');
        if (idx >= 0) {
          clearTimeout(timer);
          resolve(JSON.parse(stdoutBuffer.slice(0, idx)));
        }
      });
    });
    // MCP stdio transport is newline-delimited JSON-RPC.
    await new Promise((resolve) => setTimeout(resolve, 500));
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })}\n`);
    const message = await response;

    assert.equal(seenHello?.token, 'test-token');
    assert.equal(seenHello?.runId, 'run-test');
    assert.equal(seenHello?.instanceId, 'inst-test');
    assert.ok(sawListTools?.requestId, 'bridge request carries a requestId');
    assert.equal(message.id, 1);
    assert.equal(message.result.tools[0].name, 'canvas_probe');
  } finally {
    bridge.close();
    child?.kill('SIGKILL');
  }
});

test('mcp server refuses to start without bridge configuration (fail fast, no half-mounted state)', async () => {
  const child = spawn(process.execPath, [serverScript], {
    cwd: runtimeDir,
    env: { ...process.env }, // no KUNPENG_TOOL_BRIDGE_* / run identity
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const { code } = await exitWithin(child, 5000, 'missing-config exit');
  assert.notEqual(code, 0);
});

test('mcp server fails fast when the bridge never answers hello (no startup hang)', async () => {
  // Bridge accepts TCP but stays silent: the hello handshake timeout must
  // kill the server quickly instead of hanging the DSH plugin tree.
  const bridge = await startFakeBridge(() => {});
  let child;
  try {
    child = spawnMcpServer(bridge.port, { KUNPENG_TOOL_BRIDGE_HELLO_TIMEOUT_MS: '500' });
    const { code } = await exitWithin(child, 5000, 'hello-timeout exit');
    assert.notEqual(code, 0, 'handshake timeout must fail startup, not linger');
  } finally {
    bridge.close();
    child?.kill('SIGKILL');
  }
});
