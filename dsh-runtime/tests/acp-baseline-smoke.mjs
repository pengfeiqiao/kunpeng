import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const node = join(root, 'node', 'bin', 'node');
const bin = join(root, 'node_modules', '@deepseek-ai', 'dsh-acp-demo', 'lib', 'bin.js');
const apiKey = process.env.DEEPSEEK_API_KEY?.trim();

if (!apiKey) {
  throw new Error('DEEPSEEK_API_KEY is required');
}

// The Cordis loader resolves plugin package names relative to the config
// file's directory, so the work dir must live under the runtime root (which
// contains node_modules), not the system temp dir.
const work = await mkdtemp(join(root, '.baseline-'));
const configPath = join(work, 'cordis.json');
const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const baseURL = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');

await writeFile(configPath, JSON.stringify([
  {
    id: 'llm-deepseek',
    name: '@deepseek-ai/dsh-llm-deepseek',
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
    name: '@deepseek-ai/dsh-acp-demo',
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
      persistenceRoot: join(work, 'sessions'),
      packChunks: true,
      persistenceCompression: 'none',
    },
  },
], null, 2));

const child = spawn(node, [bin, '--config', configPath], {
  cwd: process.cwd(),
  env: {
    HOME: process.env.HOME,
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR || tmpdir(),
    DEEPSEEK_API_KEY: apiKey,
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

child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => {
  stderr = `${stderr}${chunk}`.slice(-12000);
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

function request(method, params) {
  const id = nextId++;
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      rejectPromise(new Error(`ACP timeout: ${method}`));
    }, 60_000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        rejectPromise(error);
      },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

try {
  const initialized = await request('initialize', {
    protocolVersion: 1,
    clientCapabilities: {},
    clientInfo: { name: 'kunpeng-smoke', version: '1.0.0' },
  });
  const session = await request('session/new', { cwd: process.cwd(), mcpServers: [] });
  const prompt = await request('session/prompt', {
    sessionId: session.sessionId,
    prompt: [{ type: 'text', text: 'Reply exactly: DSH baseline OK' }],
  });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    agent: initialized?.agentInfo?.name,
    session: Boolean(session?.sessionId),
    stopReason: prompt?.stopReason,
  })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    diagnostics: stderr.replaceAll(apiKey, '[REDACTED]').slice(-4000),
  })}\n`);
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
  await rm(work, { recursive: true, force: true });
}
