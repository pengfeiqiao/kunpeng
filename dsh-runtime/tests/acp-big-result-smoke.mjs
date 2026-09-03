import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Node-level reproduction of the exact desktop config from src-tauri/src/dsh.rs:
// llm-deepseek + kunpeng-acp-host.mjs (custom composition with MCP stdio client).
// A minimal fake Kunpeng tool bridge (TCP) stands in for the Rust bridge.

const root = resolve(import.meta.dirname, '..');
// Windows 布局是 node/node.exe，Unix 是 node/bin/node。
const node = join(root, 'node', ...(process.platform === 'win32' ? ['node.exe'] : ['bin', 'node']));
// cordis/loader entry 的 name 直接进 import()：Windows 裸绝对路径会被当成
// URL scheme 'c:'，必须 file:// URL（与 dsh.rs 的 module_specifier 一致）。
const fileUrl = (p) => 'file:///' + p.replace(/\\/g, '/');
const bin = join(root, 'node_modules', '@deepseek-ai', 'dsh-acp-demo', 'lib', 'bin.js');
const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
if (!apiKey) throw new Error('DEEPSEEK_API_KEY is required');

const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
const baseURL = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');

// ---- fake Kunpeng tool bridge ----
const bridgeToken = 'smoke-token';
const bridge = net.createServer((socket) => {
  // Windows 被子进程强杀时 socket 收 RST 而非优雅 FIN，假桥必须吞掉
  // error 事件，否则进程在打印结果前就崩溃（同 PR #2 对生命周期测试的修法）。
  socket.on('error', () => {});
  socket.setEncoding('utf8');
  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const newline = buffer.indexOf('\n');
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message.type === 'hello') {
        socket.write(`${JSON.stringify({ type: 'hello_ok' })}\n`);
        continue;
      }
      if (message.type === 'list_tools') {
        socket.write(`${JSON.stringify({
          type: 'list_tools',
          requestId: message.requestId,
          ok: true,
          result: [{
            name: 'probe_big',
            description: 'Waits 5 seconds then returns a ~6MB text result.',
            inputSchema: {
              type: 'object',
              properties: { text: { type: 'string' } },
              required: ['text'],
            },
          }],
        })}\n`);
        continue;
      }
      if (message.type === 'call_tool') {
        setTimeout(() => {
          const big = 'X'.repeat(6 * 1024 * 1024); // ~6MB 单条 JSON 行
          socket.write(`${JSON.stringify({
            type: 'call_tool',
            requestId: message.requestId,
            ok: true,
            result: { content: [{ type: 'text', text: `BIG_RESULT_6MB:${big.slice(0, 6 * 1024 * 1024)}` }] },
          })}\n`);
        }, 5_000);
      }
    }
  });
});
await new Promise((resolveListen) => bridge.listen(0, '127.0.0.1', resolveListen));
const bridgePort = bridge.address().port;

// Desktop writes the config under ~/.kunpeng/dsh/runs/<id>/ (outside the
// runtime root); SMOKE_WORK_DIR replicates that to test module resolution.
const work = await mkdtemp(join(process.env.SMOKE_WORK_DIR || root, '.host-smoke-'));
const configPath = join(work, 'cordis.json');
const persistenceRoot = join(work, 'sessions');

const config = [
  {
    id: 'llm-deepseek',
    // Bare package names resolve relative to the CONFIG FILE's directory
    // (boot() sets ctx.baseUrl to it). The desktop writes the config under
    // ~/.kunpeng/dsh/runs/, outside the runtime root, so a bare specifier
    // cannot be resolved there; the desktop config must use the absolute
    // entry path, exactly like the ACP host above.
    name: process.env.LLM_ENTRY
      || fileUrl(join(root, 'node_modules', '@deepseek-ai', 'dsh-llm-deepseek', 'lib', 'index.js')),
    config: {
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      baseURL,
      thinking: 'enabled',
      reasoningEffort: 'high',
      maxTokens: 4096,
      defaultContextWindow: 1_000_000,
      models: [{ id: model, name: model, contextWindow: 1_000_000, maxTokens: 4096 }],
    },
  },
  {
    id: 'acp',
    name: fileUrl(join(root, 'kunpeng-acp-host.mjs')),
    config: {
      provider: 'deepseek-official',
      model,
      persona: 'Reply concisely.',
      workspaceContext: false,
      skills: { enabled: false },
      toolBash: false,
      toolJobs: false,
      goals: false,
      maxParallelToolCalls: 1,
      persistenceRoot,
      contextWindow: 1_000_000,
      packChunks: true,
      persistenceCompression: 'none',
      mcp: {
        transport: 'stdio',
        serverName: 'kunpeng',
        command: node,
        args: [join(root, 'kunpeng-mcp-server.mjs')],
        env: {
          KUNPENG_TOOL_BRIDGE_ADDR: `127.0.0.1:${bridgePort}`,
          KUNPENG_TOOL_BRIDGE_TOKEN: bridgeToken,
          KUNPENG_DSH_RUN_ID: 'smoke',
          KUNPENG_DSH_INSTANCE_ID: 'smoke-instance',
        },
        cwd: process.cwd(),
        toolCallTimeoutMs: 1_800_000,
        failOnStartupError: true,
        reconnect: { enabled: true, initialDelayMs: 250, maxDelayMs: 10_000, maxAttempts: 12 },
      },
    },
  },
];
await writeFile(configPath, JSON.stringify(config, null, 2));

const child = spawn(node, [bin, '--config', configPath], {
  cwd: process.cwd(),
  env: {
    HOME: process.env.HOME,
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    DEEPSEEK_API_KEY: apiKey,
    DEEPSEEK_BASE_URL: baseURL,
    DSH_TELEMETRY_MODE: 'DISABLED',
    NODE_USE_ENV_PROXY: '1',
    ...(process.env.HTTP_PROXY ? { HTTP_PROXY: process.env.HTTP_PROXY } : {}),
    ...(process.env.HTTPS_PROXY ? { HTTPS_PROXY: process.env.HTTPS_PROXY } : {}),
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let buffer = '';
let stderr = '';
let nextId = 1;
const pending = new Map();
const observerEvents = [];

const redact = (text) => text.replaceAll(apiKey, '[REDACTED]');

child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => {
  const text = redact(chunk);
  stderr = `${stderr}${text}`.slice(-20000);
  for (const line of text.split('\n')) {
    if (line.startsWith('__KUNPENG_DSH_EVENT__')) observerEvents.push(line.slice(21));
  }
});

child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  while (buffer.includes('\n')) {
    const newline = buffer.indexOf('\n');
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (typeof message.id !== 'number' || message.method) continue;
    const waiter = pending.get(message.id);
    if (!waiter) continue;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message || 'ACP request failed'));
    else waiter.resolve(message.result);
  }
});

child.on('exit', (code, signal) => {
  process.stderr.write(`${JSON.stringify({ childExit: code, signal })}\n`);
});

function request(method, params, timeoutMs = 120_000) {
  const id = nextId++;
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      rejectPromise(new Error(`ACP timeout: ${method}`));
    }, timeoutMs);
    pending.set(id, {
      resolve: (value) => { clearTimeout(timer); resolvePromise(value); },
      reject: (error) => { clearTimeout(timer); rejectPromise(error); },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

const promptText = process.env.SMOKE_PROMPT
  || 'Call the probe_echo tool with text "hello", then reply with exactly the tool result.';

try {
  const initialized = await request('initialize', {
    protocolVersion: 1,
    clientCapabilities: {},
    clientInfo: { name: 'kunpeng-host-smoke', version: '1.0.0' },
  });
  // Give the composition a moment: if anything unwinds asynchronously after
  // initialize, session/new is where it surfaces.
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 3_000));
  const session = await request('session/new', { cwd: process.cwd(), mcpServers: [] });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
  const prompt = await request('session/prompt', {
    sessionId: session.sessionId,
    prompt: [{ type: 'text', text: promptText }],
  });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    agent: initialized?.agentInfo?.name,
    session: Boolean(session?.sessionId),
    stopReason: prompt?.stopReason,
    observerEventCount: observerEvents.length,
  })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    diagnostics: stderr.slice(-6000),
  })}\n`);
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
  bridge.close();
  await rm(work, { recursive: true, force: true });
}
