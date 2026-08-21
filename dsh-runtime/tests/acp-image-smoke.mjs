import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Image-input smoke: same composition as acp-host-smoke.mjs, but the prompt
// carries an ACP image content block. Verifies whether the DeepSeek Harness
// pipeline actually delivers images to the model (识图), or drops/errors them.

const root = resolve(import.meta.dirname, '..');
const node = join(root, 'node', 'bin', 'node');
const bin = join(root, 'node_modules', '@deepseek-ai', 'dsh-acp-demo', 'lib', 'bin.js');
const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
if (!apiKey) throw new Error('DEEPSEEK_API_KEY is required');

const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
const baseURL = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
const imagePath = process.env.SMOKE_IMAGE || '/tmp/smoke-red.png';

const bridgeToken = 'smoke-token';
const bridge = net.createServer((socket) => {
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
      if (message.type === 'hello') { socket.write('{"type":"hello_ok"}\n'); continue; }
      if (message.type === 'list_tools') {
        socket.write(`${JSON.stringify({ type: 'list_tools', requestId: message.requestId, ok: true, result: [] })}\n`);
        continue;
      }
      if (message.type === 'call_tool') {
        socket.write(`${JSON.stringify({ type: 'call_tool', requestId: message.requestId, ok: false, error: 'no tools in image smoke' })}\n`);
      }
    }
  });
});
await new Promise((resolveListen) => bridge.listen(0, '127.0.0.1', resolveListen));
const bridgePort = bridge.address().port;

const work = await mkdtemp(join(root, '.image-smoke-'));
const configPath = join(work, 'cordis.json');
const persistenceRoot = join(work, 'sessions');

const config = [
  {
    id: 'llm-deepseek',
    name: join(root, 'node_modules', '@deepseek-ai', 'dsh-llm-deepseek', 'lib', 'index.js'),
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
    name: join(root, 'kunpeng-acp-host.mjs'),
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
          KUNPENG_DSH_RUN_ID: 'smoke-image',
          KUNPENG_DSH_INSTANCE_ID: 'smoke-image-instance',
        },
        cwd: process.cwd(),
        toolCallTimeoutMs: 1_800_000,
        failOnStartupError: true,
        reconnect: { enabled: false },
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
let replyText = '';
const redact = (text) => text.replaceAll(apiKey, '[REDACTED]');

child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => {
  const text = redact(chunk);
  stderr = `${stderr}${text}`.slice(-20000);
  for (const line of text.split('\n')) {
    if (!line.startsWith('__KUNPENG_DSH_EVENT__')) continue;
    try {
      const event = JSON.parse(line.slice(21));
      const chunkData = event?.update?.chunk;
      if (event?.update?.sessionUpdate === 'agent_message_chunk' && chunkData?.content?.type === 'text') {
        replyText += chunkData.content.text;
      }
    } catch { /* ignore */ }
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

const imageData = (await readFile(imagePath)).toString('base64');

try {
  await request('initialize', {
    protocolVersion: 1,
    clientCapabilities: {},
    clientInfo: { name: 'kunpeng-image-smoke', version: '1.0.0' },
  });
  await new Promise((r) => setTimeout(r, 3_000));
  const session = await request('session/new', { cwd: process.cwd(), mcpServers: [] });
  await new Promise((r) => setTimeout(r, 2_000));
  const prompt = await request('session/prompt', {
    sessionId: session.sessionId,
    prompt: [
      { type: 'image', data: imageData, mimeType: 'image/png' },
      { type: 'text', text: '这张图片的主体是什么颜色？只用一种颜色名称回答。如果你根本收不到图片，请回答：收不到图片。' },
    ],
  });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    note: 'UPSTREAM NOW ACCEPTS IMAGES — re-evaluate the Kunpeng mediaFilter workaround',
    stopReason: prompt?.stopReason,
    replyText: replyText.slice(0, 500),
  })}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  // The Kunpeng media pipeline (src/lib/agent/dsh/mediaFilter.ts) relies on
  // this upstream invariant: dsh-acp rejects image prompt blocks. Treat the
  // known rejection as a PASS so this script can run as a manual regression
  // check; anything else is a real failure.
  if (/only text and resource_link/.test(message)) {
    process.stdout.write(`${JSON.stringify({ ok: true, note: 'upstream rejects image prompts as expected', error: message })}\n`);
  } else {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error: message,
      replyText: replyText.slice(0, 500),
      diagnostics: stderr.slice(-6000),
    })}\n`);
    process.exitCode = 1;
  }
} finally {
  child.kill('SIGTERM');
  bridge.close();
  await rm(work, { recursive: true, force: true });
}
