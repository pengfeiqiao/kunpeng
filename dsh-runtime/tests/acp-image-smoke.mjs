import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Image-input smoke: same composition as acp-host-smoke.mjs, but the prompt
// carries an ACP image content block. Verifies whether the DeepSeek Harness
// pipeline actually delivers images to the model (识图), or drops/errors them.

const root = resolve(import.meta.dirname, '..');
// Windows 布局是 node/node.exe，Unix 是 node/bin/node。
const node = join(root, 'node', ...(process.platform === 'win32' ? ['node.exe'] : ['bin', 'node']));
// cordis/loader entry 的 name 直接进 import()：Windows 裸绝对路径会被当成
// URL scheme 'c:'，必须 file:// URL（与 dsh.rs 的 module_specifier 一致）。
const fileUrl = (p) => 'file:///' + p.replace(/\\/g, '/');
const bin = join(root, 'node_modules', '@deepseek-ai', 'dsh-acp-demo', 'lib', 'bin.js');
const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
if (!apiKey) throw new Error('DEEPSEEK_API_KEY is required');

const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash-vision-exp';
const baseURL = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
const imagePath = process.env.SMOKE_IMAGE || '/tmp/smoke-red.png';

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
    // KUNPENG: 视觉轮次走 pi-ai 适配器（dsh-llm-deepseek 是 text-only 设计），
    // 模型级声明 input:[text,image]；图片经 attachment store 落盘后 base64 内联进模型。
    id: 'llm-pi-ai',
    name: fileUrl(join(root, 'node_modules', '@deepseek-ai', 'dsh-llm-pi-ai', 'lib', 'index.js')),
    config: {
      providers: {
        deepseek: {
          apiKeyEnv: 'DEEPSEEK_API_KEY',
          api: 'openai-completions',
          baseURL: `${baseURL}/v1`,
          models: [{ id: model, name: model, contextWindow: 1_000_000, maxTokens: 4096, input: ['text', 'image'] }],
        },
      },
    },
  },
  {
    id: 'acp',
    name: fileUrl(join(root, 'kunpeng-acp-host.mjs')),
    config: {
      provider: 'deepseek',
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
let thoughtText = '';
const redact = (text) => text.replaceAll(apiKey, '[REDACTED]');

child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => {
  const text = redact(chunk);
  stderr = `${stderr}${text}`.slice(-20000);
  for (const line of text.split('\n')) {
    if (!line.startsWith('__KUNPENG_DSH_EVENT__')) continue;
    try {
      const event = JSON.parse(line.slice(21));
      // 侧通道事件形态不统一：部分包 {update:{...}}，部分是扁平 {sessionUpdate,content}
      const update = event?.update ?? event;
      const chunkData = update?.chunk ?? update;
      if (update?.sessionUpdate === 'agent_message_chunk' && chunkData?.content?.type === 'text') {
        replyText += chunkData.content.text;
      }
      // pi-ai 视觉路由的答案可能随思考流输出，判定"是否看到图"两条流都要看
      if (update?.sessionUpdate === 'agent_thought_chunk' && chunkData?.content?.type === 'text') {
        thoughtText += chunkData.content.text;
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
    // ACP 通知（无 id）：正文经 session/update 的 agent_message_chunk 流出
    if (message.method === 'session/update') {
      const content = message.params?.update?.content;
      if (content?.type === 'text') replyText += content.text;
      continue;
    }
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
      { type: 'text', text: '请直接描述这张图片里有什么（颜色、形状、内容）。' },
    ],
  });
  const allText = `${replyText}\n${thoughtText}`;
  // 判定：最终正文或思考流提到红色（测试图是纯红色块）
  const sawImage = /红/.test(allText);
  process.stdout.write(`${JSON.stringify({
    ok: sawImage,
    note: sawImage
      ? 'KUNPENG fork bridge delivers native images to the vision model'
      : 'model did NOT see the image',
    stopReason: prompt?.stopReason,
    replyText: replyText.slice(0, 500),
    ...(!sawImage ? { diagnostics: stderr.slice(-8000) } : {}),
  })}\n`);
  if (!sawImage) process.exitCode = 1;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: message,
    replyText: replyText.slice(0, 500),
    diagnostics: stderr.slice(-6000),
  })}\n`);
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
  bridge.close();
  await rm(work, { recursive: true, force: true });
}
