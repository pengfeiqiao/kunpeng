#!/usr/bin/env node
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const PROTOCOL = 1;
const DEFAULT_CONFIG = path.join(os.homedir(), '.kunpeng', 'cli.json');
const CONFIG_PATH = process.env.KUNPENG_CLI_CONFIG || DEFAULT_CONFIG;

function usage() {
  return `鲲鹏 CLI — 让终端和其他 AI Agent 直接驱动正在运行的鲲鹏

用法:
  kunpeng status [--json]
  kunpeng task <提示词> [选项]
  kunpeng image <生图提示词> [选项]
  kunpeng video <生视频提示词> [选项]
  kunpeng canvas <节点生成提示词> --node <节点ID> --model <引擎> [选项]
  kunpeng workshop --kind <asset|image|video> [--targets <目标>] [选项]
  kunpeng cancel <requestId>
  kunpeng install

Agent 任务选项:
  --session <名称>             同名称会话保留上下文（默认 default）
  --always-approve            自动批准需要确认的工具（可能产生费用）
  --max-turns <1-50>          最大 Agent 轮次（默认 30）
  --timeout <秒>              本地等待上限（默认 600）

生成直连选项（普通对话/画布/工坊，不经过 Agent）:
  --params <JSON>             对应生成工具的完整参数
  --model <模型>              普通对话/画布的模型或引擎
  --node <节点ID>             画布目标节点（画布必填）
  --kind <类型>               工坊 asset / image / video
  --targets <目标>            工坊 missing / all / 逗号分镜号
  --asset-id <资产ID>         工坊资产，可重复传入
  --ratio <比例>              生图默认 16:9，生视频默认 adaptive
  --resolution <分辨率>        按所选渠道支持的分辨率
  --duration <秒>             视频时长
  --reference <路径或URL>      参考素材，可重复传入
  --output <绝对路径>          普通对话生图成品归档路径

通用选项:
  --json                      完成后输出一个 JSON 对象
  --stream-json               输出 NDJSON 进度事件和最终结果
  --output-last-message <路径> 将最终文本写入文件
  --queue <共享目录>          改用远程队列，不连接 127.0.0.1
  --timeout <秒>              直连生成默认 3600 秒

退出码: 0=成功，1=连接或运行错误，2=任务失败，3=超时，130=用户中止。
本机模式从 ~/.kunpeng/cli.json 读取连接令牌且不会打印；队列模式无需密钥。`;
}

function parseArgs(args) {
  const options = {
    session: 'default',
    references: [],
    json: false,
    streamJson: false,
    autoApprove: false,
  };
  const positional = [];
  const take = (flag, index) => {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} 缺少参数`);
    return value;
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    switch (arg) {
      case '--json': options.json = true; break;
      case '--stream-json': options.streamJson = true; break;
      case '--always-approve': options.autoApprove = true; break;
      case '--session': options.session = take(arg, i); i += 1; break;
      case '--queue': options.queue = take(arg, i); i += 1; break;
      case '--timeout': options.timeout = Number(take(arg, i)); i += 1; break;
      case '--max-turns': options.maxTurns = Number(take(arg, i)); i += 1; break;
      case '--params': options.params = take(arg, i); i += 1; break;
      case '--model': options.model = take(arg, i); i += 1; break;
      case '--ratio': options.ratio = take(arg, i); i += 1; break;
      case '--resolution': options.resolution = take(arg, i); i += 1; break;
      case '--duration': options.duration = Number(take(arg, i)); i += 1; break;
      case '--reference': options.references.push(take(arg, i)); i += 1; break;
      case '--node': options.node = take(arg, i); i += 1; break;
      case '--kind': options.kind = take(arg, i); i += 1; break;
      case '--targets': options.targets = take(arg, i); i += 1; break;
      case '--asset-id': (options.assetIds ||= []).push(take(arg, i)); i += 1; break;
      case '--output': options.output = take(arg, i); i += 1; break;
      case '--output-last-message': options.outputLastMessage = take(arg, i); i += 1; break;
      case '--help': options.help = true; break;
      default: throw new Error(`未知选项: ${arg}`);
    }
  }
  if (options.timeout !== undefined && (!Number.isFinite(options.timeout) || options.timeout <= 0)) {
    throw new Error('--timeout 必须是正数');
  }
  if (options.maxTurns !== undefined && (!Number.isInteger(options.maxTurns) || options.maxTurns < 1 || options.maxTurns > 50)) {
    throw new Error('--max-turns 必须是 1-50 的整数');
  }
  options.queue ||= process.env.KUNPENG_QUEUE_DIR || '';
  return { options, positional };
}

function readConfig() {
  let config;
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    throw new Error('无法读取鲲鹏 CLI 连接信息。请先启动鲲鹏，并确认已安装最新版本。');
  }
  if (config.protocol !== PROTOCOL || config.host !== '127.0.0.1'
    || !Number.isInteger(config.port) || typeof config.token !== 'string' || !config.token) {
    throw new Error('鲲鹏 CLI 连接信息无效或版本不兼容，请重启鲲鹏后重试。');
  }
  return config;
}

class CliConnection {
  constructor(socket, config) {
    this.socket = socket;
    this.config = config;
    this.buffer = '';
    this.queue = [];
    this.waiters = [];
    this.closedError = null;
    socket.setNoDelay(true);
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('error', (error) => this.close(new Error(`鲲鹏 CLI 连接失败: ${error.message}`)));
    socket.on('close', () => this.close(new Error('鲲鹏 CLI 连接已断开；任务状态可能未知，请用 requestId 核对，不要自动重放付费生成。')));
  }

  static async open() {
    const config = readConfig();
    const socket = net.createConnection({ host: config.host, port: config.port });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('连接鲲鹏超时，请确认鲲鹏正在运行。')), 5000);
      socket.once('connect', () => { clearTimeout(timer); resolve(); });
      socket.once('error', (error) => { clearTimeout(timer); reject(new Error(`无法连接鲲鹏: ${error.message}`)); });
    });
    const connection = new CliConnection(socket, config);
    connection.send({ type: 'hello', token: config.token, protocol: PROTOCOL });
    const hello = await connection.next();
    if (hello.type !== 'hello_ok' || hello.protocol !== PROTOCOL) {
      connection.close();
      throw new Error(hello.error || '鲲鹏 CLI 握手失败，请重启鲲鹏后重试。');
    }
    return connection;
  }

  onData(chunk) {
    this.buffer += chunk.toString('utf8');
    if (this.buffer.length > 8 * 1024 * 1024 && !this.buffer.includes('\n')) {
      this.socket.destroy(new Error('鲲鹏 CLI 消息超过安全上限'));
      return;
    }
    while (true) {
      const index = this.buffer.indexOf('\n');
      if (index < 0) break;
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      const waiter = this.waiters.shift();
      if (waiter) waiter.resolve(message);
      else this.queue.push(message);
    }
  }

  next() {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    if (this.closedError) return Promise.reject(this.closedError);
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  send(message) {
    if (this.socket.destroyed) throw new Error('鲲鹏 CLI 连接已关闭');
    this.socket.write(`${JSON.stringify(message)}\n`);
  }

  close(error) {
    if (error && !this.closedError) this.closedError = error;
    while (this.waiters.length) this.waiters.shift().reject(this.closedError || new Error('鲲鹏 CLI 连接已关闭'));
    if (!error && !this.socket.destroyed) this.socket.end();
  }
}

function printJson(value, stream) {
  if (stream) process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function saveLastMessage(options, result) {
  if (!options.outputLastMessage) return;
  const target = path.resolve(options.outputLastMessage);
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(target, result.text || '', 'utf8');
}

function queueDirectory(root) {
  const resolved = path.resolve(root);
  for (const name of ['inbox', 'processing', 'results', 'cancel']) {
    fs.mkdirSync(path.join(resolved, name), { recursive: true });
  }
  return resolved;
}

function queueAtomicJson(file, value) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(temp, file);
}

function queueReadJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

function queueSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runQueueTask(request, options) {
  const root = queueDirectory(options.queue);
  const requestId = request.requestId;
  const input = request.directName
    ? { type: 'run_tool', requestId, name: request.directName, params: request.params }
    : {
        type: 'run_task', requestId, prompt: request.prompt, session: options.session,
        autoApprove: options.autoApprove, maxTurns: options.maxTurns,
      };
  queueAtomicJson(path.join(root, 'inbox', `${requestId}.json`), input);
  printJson({ type: 'task_started', requestId, session: request.directName ? `direct:${request.directName}` : options.session, queue: true }, options.streamJson);

  const timeoutMs = (options.timeout ?? (request.directName ? 3600 : 600)) * 1000;
  const deadline = Date.now() + timeoutMs;
  let interrupted = false;
  let timedOut = false;
  let cancelDeadline = 0;
  let eventOffset = 0;
  const eventsPath = path.join(root, 'results', `${requestId}.events.ndjson`);
  const resultPath = path.join(root, 'results', `${requestId}.json`);
  const cancel = () => {
    queueAtomicJson(path.join(root, 'cancel', `${requestId}.json`), { type: 'cancel_task', requestId });
    cancelDeadline = Date.now() + 5000;
  };
  const onSigint = () => {
    if (!interrupted) cancel();
    interrupted = true;
  };
  process.once('SIGINT', onSigint);
  try {
    while (true) {
      if (options.streamJson && fs.existsSync(eventsPath)) {
        const lines = fs.readFileSync(eventsPath, 'utf8').split('\n');
        const complete = lines.at(-1) === '';
        const available = complete ? lines.slice(0, -1) : lines.slice(0, -2);
        for (const line of available.slice(eventOffset)) {
          const message = JSON.parse(line);
          printJson({ type: message.event?.type || 'progress', requestId, ...message.event }, true);
        }
        eventOffset = available.length;
      }
      const result = queueReadJson(resultPath);
      if (result?.type === 'task_result' && result.requestId === requestId) {
        printJson({ ...result, type: 'result' }, options.streamJson);
        if (options.json && !options.streamJson) process.stdout.write(`${JSON.stringify(result)}\n`);
        else if (!options.streamJson && result.ok) process.stdout.write(`${result.text || ''}\n`);
        await saveLastMessage(options, result);
        if (interrupted) return 130;
        if (timedOut) return 3;
        if (!result.ok) {
          if (!options.json && !options.streamJson) process.stderr.write(`${result.error || '任务失败'}\n`);
          return 2;
        }
        return 0;
      }
      if ((interrupted || timedOut) && Date.now() >= cancelDeadline) return interrupted ? 130 : 3;
      if (!interrupted && !timedOut && Date.now() >= deadline) {
        timedOut = true;
        cancel();
      }
      await queueSleep(300);
    }
  } finally {
    process.removeListener('SIGINT', onSigint);
  }
}

async function queueStatus(options) {
  const root = queueDirectory(options.queue);
  const heartbeat = queueReadJson(path.join(root, 'status.json'));
  const heartbeatTime = heartbeat?.updatedAt ? Date.parse(heartbeat.updatedAt) : 0;
  const online = Boolean(heartbeatTime && Date.now() - heartbeatTime < 15_000);
  const count = (name) => fs.readdirSync(path.join(root, name)).filter((file) => file.endsWith('.json')).length;
  const result = {
    type: 'status', ok: true, queue: true, online,
    ready: Boolean(online && heartbeat?.ready),
    activeTasks: count('processing'), queuedTasks: count('inbox'),
    version: heartbeat?.version || null,
  };
  if (options.json || options.streamJson) process.stdout.write(`${JSON.stringify(result)}\n`);
  else process.stdout.write(`鲲鹏远程队列${result.online ? '在线' : '离线'}\n执行桥: ${result.ready ? '就绪' : '未就绪'}\n运行中: ${result.activeTasks}\n排队中: ${result.queuedTasks}\n`);
  return 0;
}

async function queueCancel(requestId, options) {
  if (!requestId) throw new Error('请提供要停止的 requestId');
  const root = queueDirectory(options.queue);
  queueAtomicJson(path.join(root, 'cancel', `${requestId}.json`), { type: 'cancel_task', requestId });
  process.stdout.write(`已向远程队列请求停止任务 ${requestId}\n`);
  return 0;
}

async function runTask(command, options, positional) {
  const prompt = positional.join(' ').trim();
  let params = {};
  if (options.params) {
    try { params = JSON.parse(options.params); } catch { throw new Error('--params 必须是有效 JSON 对象'); }
    if (!params || Array.isArray(params) || typeof params !== 'object') throw new Error('--params 必须是 JSON 对象');
  }
  const directTools = {
    image: 'image_generate', video: 'video_generate', canvas: 'canvas_generate', workshop: 'workshop_generate',
  };
  const directName = directTools[command];
  const direct = Boolean(directName);
  if (!direct && !prompt) throw new Error('请提供任务提示词');
  if (direct) {
    if (prompt) params.prompt = prompt;
    if (command !== 'workshop' && !String(params.prompt || '').trim()) throw new Error('请提供生成提示词');
    if (options.model) params[command === 'image' ? 'model' : 'engine'] = options.model;
    if (command === 'canvas') {
      if (options.node) params.node_id = options.node;
      if (!params.node_id || !params.engine) throw new Error('画布直连必须提供 --node 和 --model');
      params.params = { ...(params.params || {}) };
      if (options.ratio) params.params.aspectRatio = options.ratio;
      if (options.resolution) params.params.resolution = options.resolution;
      if (options.duration !== undefined) params.params.duration = String(options.duration);
    } else if (command === 'workshop') {
      if (options.kind) params.kind = options.kind;
      if (options.targets) params.targets = options.targets;
      if (options.assetIds?.length) params.asset_ids = options.assetIds;
      if (!['asset', 'image', 'video'].includes(params.kind)) throw new Error('工坊直连必须提供 --kind asset|image|video');
    } else {
      if (options.ratio) params[command === 'image' ? 'aspect_ratio' : 'ratio'] = options.ratio;
      if (options.resolution) params.resolution = options.resolution;
      if (options.duration !== undefined && command === 'video') params.duration = options.duration;
    }
    if (options.references.length) {
      const key = command === 'video' ? 'image_urls' : 'reference_urls';
      if (command !== 'workshop') params[key] = options.references;
    }
    if (options.output && command === 'image') params.output_path = options.output;
  }

  const requestId = crypto.randomUUID();
  if (options.queue) return runQueueTask({ requestId, directName, prompt, params }, options);
  const connection = await CliConnection.open();
  const timeoutMs = (options.timeout ?? (direct ? 3600 : 600)) * 1000;
  let timedOut = false;
  let interrupted = false;
  let forceTimer;
  const cancel = () => {
    try { connection.send({ type: 'cancel_task', requestId }); } catch { /* connection already closed */ }
  };
  const timer = setTimeout(() => {
    timedOut = true;
    cancel();
    forceTimer = setTimeout(() => connection.socket.destroy(), 5000);
    forceTimer.unref();
  }, timeoutMs);
  const onSigint = () => {
    interrupted = true;
    cancel();
    forceTimer = setTimeout(() => connection.socket.destroy(), 5000);
    forceTimer.unref();
  };
  process.once('SIGINT', onSigint);
  printJson({ type: 'task_started', requestId, session: direct ? `direct:${command}_generate` : options.session }, options.streamJson);

  try {
    connection.send(direct
      ? { type: 'run_tool', requestId, name: `${command}_generate`, params }
      : {
          type: 'run_task', requestId, prompt, session: options.session,
          autoApprove: options.autoApprove, maxTurns: options.maxTurns,
        });
    while (true) {
      const message = await connection.next();
      if (message.requestId && message.requestId !== requestId) continue;
      if (message.type === 'task_event') {
        printJson({ type: message.event?.type || 'progress', requestId, ...message.event }, options.streamJson);
        continue;
      }
      if (message.type === 'error') throw new Error(message.error || '鲲鹏 CLI 协议错误');
      if (message.type !== 'task_result') continue;
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      printJson({ ...message, type: 'result' }, options.streamJson);
      if (options.json && !options.streamJson) process.stdout.write(`${JSON.stringify(message)}\n`);
      else if (!options.streamJson && message.ok) process.stdout.write(`${message.text || ''}\n`);
      await saveLastMessage(options, message);
      connection.close();
      if (interrupted) return 130;
      if (timedOut) return 3;
      if (!message.ok) {
        if (!options.json && !options.streamJson) process.stderr.write(`${message.error || '任务失败'}\n`);
        return 2;
      }
      return 0;
    }
  } finally {
    clearTimeout(timer);
    if (forceTimer) clearTimeout(forceTimer);
    process.removeListener('SIGINT', onSigint);
    connection.close();
  }
}

async function status(options) {
  if (options.queue) return queueStatus(options);
  const connection = await CliConnection.open();
  try {
    const requestId = crypto.randomUUID();
    connection.send({ type: 'status', requestId });
    while (true) {
      const message = await connection.next();
      if (message.type !== 'status' || message.requestId !== requestId) continue;
      if (options.json || options.streamJson) process.stdout.write(`${JSON.stringify(message)}\n`);
      else process.stdout.write(`鲲鹏 CLI 已连接\n版本: ${message.version}\n执行桥: ${message.ready ? '就绪' : '初始化中'}\n运行中任务: ${message.activeTasks}\n`);
      return 0;
    }
  } finally { connection.close(); }
}

async function cancelTask(requestId, options) {
  if (options.queue) return queueCancel(requestId, options);
  if (!requestId) throw new Error('请提供要停止的 requestId');
  const connection = await CliConnection.open();
  try {
    connection.send({ type: 'cancel_task', requestId });
    while (true) {
      const message = await connection.next();
      if (message.type !== 'cancel_result' || message.requestId !== requestId) continue;
      if (!message.ok) throw new Error(message.error || '停止失败');
      process.stdout.write(`已请求停止任务 ${requestId}\n`);
      return 0;
    }
  } finally { connection.close(); }
}

async function install() {
  const home = os.homedir();
  const dir = path.join(home, '.kunpeng', 'cli');
  await fs.promises.mkdir(dir, { recursive: true });
  const source = fileURLToPath(import.meta.url);
  const script = path.join(dir, 'kunpeng.mjs');
  if (path.resolve(source) !== path.resolve(script)) await fs.promises.copyFile(source, script);
  const readmeSource = path.join(path.dirname(source), 'README.md');
  if (fs.existsSync(readmeSource) && path.resolve(readmeSource) !== path.join(dir, 'README.md')) {
    await fs.promises.copyFile(readmeSource, path.join(dir, 'README.md'));
  }
  let command;
  if (process.platform === 'win32') {
    command = path.join(home, '.kunpeng', 'bin', 'kunpeng.cmd');
    await fs.promises.mkdir(path.dirname(command), { recursive: true });
    await fs.promises.writeFile(command, `@echo off\r\nwhere node >nul 2>nul\r\nif %errorlevel%==0 (\r\n  node "%USERPROFILE%\\.kunpeng\\cli\\kunpeng.mjs" %*\r\n  exit /b %errorlevel%\r\n)\r\nif exist "%USERPROFILE%\\.kunpeng\\dsh\\0.2.1-rc.2\\node\\node.exe" (\r\n  "%USERPROFILE%\\.kunpeng\\dsh\\0.2.1-rc.2\\node\\node.exe" "%USERPROFILE%\\.kunpeng\\cli\\kunpeng.mjs" %*\r\n  exit /b %errorlevel%\r\n)\r\necho kunpeng: Node.js not found 1>&2\r\nexit /b 1\r\n`);
  } else {
    command = path.join(home, '.local', 'bin', 'kunpeng');
    await fs.promises.mkdir(path.dirname(command), { recursive: true });
    await fs.promises.writeFile(command, `#!/bin/sh\nif command -v node >/dev/null 2>&1; then\n  exec node "$HOME/.kunpeng/cli/kunpeng.mjs" "$@"\nfi\nif [ -x "$HOME/.kunpeng/dsh/0.2.1-rc.2/node/bin/node" ]; then\n  exec "$HOME/.kunpeng/dsh/0.2.1-rc.2/node/bin/node" "$HOME/.kunpeng/cli/kunpeng.mjs" "$@"\nfi\necho "kunpeng: 未找到 Node.js" >&2\nexit 1\n`);
    await fs.promises.chmod(command, 0o755);
  }
  process.stdout.write(`鲲鹏 CLI 已安装: ${command}\n`);
  return 0;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const { options, positional } = parseArgs(args);
  if (options.help) { process.stdout.write(`${usage()}\n`); return 0; }
  if (command === 'status') return status(options);
  if (['task', 'exec', 'image', 'video', 'canvas', 'workshop'].includes(command)) return runTask(command, options, positional);
  if (command === 'cancel') return cancelTask(positional[0], options);
  if (command === 'install') return install();
  throw new Error(`未知命令: ${command}\n\n${usage()}`);
}

main().then((code) => { process.exitCode = code; }).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
