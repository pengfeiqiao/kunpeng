import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const address = process.env.KUNPENG_TOOL_BRIDGE_ADDR;
const token = process.env.KUNPENG_TOOL_BRIDGE_TOKEN;
const runId = process.env.KUNPENG_DSH_RUN_ID ?? '';
const instanceId = process.env.KUNPENG_DSH_INSTANCE_ID ?? '';
const missingEnv = [
  ['KUNPENG_TOOL_BRIDGE_ADDR', address],
  ['KUNPENG_TOOL_BRIDGE_TOKEN', token],
  ['KUNPENG_DSH_RUN_ID', runId],
  ['KUNPENG_DSH_INSTANCE_ID', instanceId],
].filter(([, value]) => !value).map(([name]) => name);
if (missingEnv.length > 0) {
  throw new Error(`Kunpeng tool bridge is not configured: missing ${missingEnv.join(', ')}`);
}

const [host, portText] = address.split(':');
const port = Number(portText);
if (!host || !Number.isInteger(port) || port <= 0) {
  throw new Error('Kunpeng tool bridge address is invalid');
}

const socket = net.createConnection({ host, port });
socket.setEncoding('utf8');
socket.setNoDelay(true);
socket.setKeepAlive(true, 10_000);

let buffer = '';
const pending = new Map();
let readyResolve;
let readyReject;
const ready = new Promise((resolve, reject) => {
  readyResolve = resolve;
  readyReject = reject;
});

function send(message) {
  socket.write(`${JSON.stringify(message)}\n`);
}

function request(type, payload = {}) {
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`Kunpeng bridge ${type} timed out`));
    }, 30 * 60 * 1000);
    pending.set(requestId, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });
    send({ type, requestId, ...payload });
  });
}

socket.on('connect', () => {
  send({ type: 'hello', token, runId, instanceId });
});

socket.on('data', (chunk) => {
  buffer += chunk;
  while (true) {
    const newline = buffer.indexOf('\n');
    if (newline < 0) break;
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.type === 'hello_ok') {
      readyResolve();
      continue;
    }
    const waiter = pending.get(message.requestId);
    if (!waiter) continue;
    pending.delete(message.requestId);
    if (message.ok === false) {
      waiter.reject(new Error(message.error || 'Kunpeng tool bridge request failed'));
    } else {
      waiter.resolve(message.result);
    }
  }
});

socket.on('error', (error) => {
  readyReject(error);
  for (const waiter of pending.values()) waiter.reject(error);
  pending.clear();
});

socket.on('close', () => {
  const error = new Error('Kunpeng tool bridge closed');
  for (const waiter of pending.values()) waiter.reject(error);
  pending.clear();
  // Exit this stdio generation so DSH's MCP supervisor can relaunch it with
  // a clean TCP connection. Remaining alive would leave a tool server that
  // can answer MCP requests but can no longer reach Kunpeng.
  process.exit(0);
});

// If the DSH parent dies without unwinding its MCP client, our stdin hits EOF.
// Never linger as an orphan in that case.
process.stdin.on('end', () => process.exit(0));
process.on('disconnect', () => process.exit(0));

// The bridge handshake must complete promptly. Without a bound, a bridge
// that accepts TCP but never answers `hello` would hang the whole DSH plugin
// tree at startup (failOnStartupError), and the user would stare at a dead
// Harness until the ACP timeout. Fail fast with an actionable message.
const helloTimeoutMs = Number(process.env.KUNPENG_TOOL_BRIDGE_HELLO_TIMEOUT_MS) || 15_000;
let readyTimer;
const readyTimeout = new Promise((_, reject) => {
  readyTimer = setTimeout(() => reject(new Error(
    `Kunpeng tool bridge handshake timed out after ${helloTimeoutMs}ms (${address})`,
  )), helloTimeoutMs);
});
try {
  await Promise.race([ready, readyTimeout]);
} finally {
  clearTimeout(readyTimer);
}

const server = new Server(
  { name: 'kunpeng', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = await request('list_tools');
  return { tools: Array.isArray(tools) ? tools : [] };
});

server.setRequestHandler(CallToolRequestSchema, async (requestMessage) => {
  const result = await request('call_tool', {
    name: requestMessage.params.name,
    arguments: requestMessage.params.arguments ?? {},
  });
  if (result && typeof result === 'object' && Array.isArray(result.content)) {
    return result;
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(result ?? null) }],
  };
});

await server.connect(new StdioServerTransport());
