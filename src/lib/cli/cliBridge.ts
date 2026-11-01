import { invoke } from '@tauri-apps/api/tauri';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useSettingsStore } from '@/stores/settingsStore';
import { useRunStepStore, type RunStatus } from '@/stores/runStepStore';
import { resolveApiKey } from '@/lib/credentials';
import { AgentCoordinator, repairToolPairingSnapshot } from '@/lib/agent/coordinator';
import { GLMClient } from '@/lib/agent/glmClient';
import { createDefaultRegistry, ToolRegistry } from '@/lib/agent/toolRegistry';
import { SkillLoader } from '@/lib/agent/skillLoader';
import { McpManager, MCP_SERVERS } from '@/lib/agent/mcp';
import type { AgentMessage, CoordinatorCallbacks, ToolResult } from '@/lib/agent/types';
import type { RouteStrategy } from '@/lib/agent/providers/router';
import { setAgentHeadless } from '@/lib/agent/headless';
import { normalizeCustomRules } from '@/lib/agent/rulePolicy';
import { getShellInfo, osDisplayName } from '@/lib/platform';
import { withRemoteAgentTimeout } from '@/lib/messaging/remoteRun';
import { compactRemoteHistory } from '@/lib/messaging/remoteHistory';
import { firePostToolUse, firePreToolUse } from '@/lib/agent/hooks';

interface CliTaskRequest {
  connectionId: string;
  requestId: string;
  prompt: string;
  session: string;
  autoApprove: boolean;
  maxTurns: number;
}

interface CliToolRequest {
  connectionId: string;
  requestId: string;
  session: string;
  name: 'image_generate' | 'video_generate' | 'canvas_generate' | 'workshop_generate';
  params: Record<string, unknown>;
}

interface CliCancelRequest {
  connectionId: string;
  requestId: string;
  reason?: string;
}

interface ActiveTask {
  connectionId: string;
  requestId: string;
  session: string;
  cancelled: boolean;
  responded: boolean;
  controller: AbortController;
  coordinator?: AgentCoordinator;
}

interface CoordinatorConfig {
  glmClient: GLMClient;
  cwd: string;
  skillDescriptions: string;
  customRules?: string;
  sharedRegistry: ToolRegistry;
  routeStrategy?: RouteStrategy;
}

const coordinators: Record<string, AgentCoordinator> = {};
const coordinatorLastUsed: Record<string, number> = {};
const activeSessions = new Set<string>();
const activeTasks = new Map<string, ActiveTask>();
const sessionQueues = new Map<string, Promise<void>>();
const MAX_COORDINATORS = 20;
let coordinatorConfigPromise: Promise<CoordinatorConfig> | null = null;
let coordinatorConfigSignature = '';
let bridgeCleanup: (() => void) | null = null;
let bridgeInitPromise: Promise<() => void> | null = null;
let agentHistories: Record<string, AgentMessage[]> = {};
let historiesLoaded = false;
let historiesLoadPromise: Promise<void> | null = null;
let historySaveTimer: ReturnType<typeof setTimeout> | null = null;

function taskKey(connectionId: string, requestId: string): string {
  return `${connectionId}:${requestId}`;
}

function emitEvent(task: ActiveTask, event: Record<string, unknown>): void {
  if (task.responded) return;
  void invoke('cli_task_event', {
    connectionId: task.connectionId,
    requestId: task.requestId,
    event,
  }).catch(() => {});
}

async function respond(task: ActiveTask, response: {
  ok: boolean;
  text?: string;
  error?: string;
  runId?: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  if (task.responded) return;
  task.responded = true;
  try {
    await invoke('cli_task_respond', {
      response: {
        connectionId: task.connectionId,
        requestId: task.requestId,
        session: task.session,
        ...response,
      },
    });
  } catch (error) {
    // A disconnected CLI has already triggered cancellation. Keep the error in
    // the local run record instead of retrying a task or paid tool submission.
    console.warn('[cli] task response could not be delivered:', error);
  } finally {
    activeTasks.delete(taskKey(task.connectionId, task.requestId));
  }
}

function currentConfigSignature(): string {
  const s = useSettingsStore.getState();
  return JSON.stringify({
    glmApiKey: s.glmApiKey,
    glmBaseUrl: s.glmBaseUrl,
    glmModel: s.glmModel,
    defaultCwd: s.defaultCwd,
    providerDefault: s.providerDefault,
    providerApiKeys: s.providerApiKeys,
    providerBaseUrls: s.providerBaseUrls,
    providerModels: s.providerModels,
    providerFallbackChain: s.providerFallbackChain,
    credentials: s.credentials,
    credentialRefs: s.credentialRefs,
  });
}

async function initCoordinatorConfig(): Promise<CoordinatorConfig> {
  const settings = useSettingsStore.getState();
  const { glmBaseUrl, glmModel, defaultCwd, providerDefault, providerApiKeys, providerFallbackChain } = settings;
  const glmApiKey = resolveApiKey(settings, 'glm', settings.glmApiKey);
  const anyProviderKey = Object.keys(providerApiKeys || {}).some(
    (id) => resolveApiKey(settings, `provider:${id}`, providerApiKeys[id]).trim(),
  );
  if (!glmApiKey && !anyProviderKey) throw new Error('未配置可用的模型 API Key');

  let homeDir = '~';
  try { homeDir = await invoke<string>('get_home_dir'); } catch { /* use fallback */ }
  const loader = new SkillLoader([`${homeDir}/.kunpeng/skills`, `${homeDir}/kunpeng/skills`]);
  await loader.loadAll();
  const glmClient = new GLMClient({
    apiKey: glmApiKey,
    baseUrl: glmBaseUrl || 'https://open.bigmodel.cn/api/anthropic',
    model: glmModel || 'glm-5.1',
  });

  let customRules: string | undefined;
  for (const filename of ['AGENT.md', 'CLAUDE.md']) {
    try {
      const result = await invoke<{ content: string }>('read_file', { path: `${homeDir}/.kunpeng/${filename}` });
      if (result?.content?.trim()) {
        customRules = result.content.replace(/^\s*\d+\t/gm, '');
        break;
      }
    } catch { /* optional rules */ }
  }
  if (customRules) {
    const normalized = normalizeCustomRules(customRules);
    customRules = [
      normalized.notices.length ? `## 自定义规则兼容说明\n${normalized.notices.map((item) => `- ${item}`).join('\n')}` : '',
      normalized.rules,
    ].filter(Boolean).join('\n\n');
  }

  const sharedRegistry = createDefaultRegistry();
  const mcpManager = new McpManager(MCP_SERVERS);
  try {
    const { tools, errors } = await mcpManager.initialize(
      Object.fromEntries((settings.credentials ?? []).map((credential) => [credential.id, credential.apiKey])),
    );
    for (const tool of tools) sharedRegistry.register(tool);
    if (errors.length) console.warn('[cli] MCP partial failures:', errors);
  } catch (error) {
    console.warn('[cli] MCP init error:', error);
  }

  const enabledChain: { providerId: string }[] = [];
  const seen = new Set<string>();
  const tryAdd = (id: string) => {
    if (seen.has(id)) return;
    const legacyKey = id === 'glm' ? (providerApiKeys?.glm ?? glmApiKey) : providerApiKeys?.[id];
    if (!resolveApiKey(settings, `provider:${id}`, legacyKey ?? '').trim()) return;
    enabledChain.push({ providerId: id });
    seen.add(id);
  };
  tryAdd(providerDefault || 'glm');
  for (const id of providerFallbackChain || []) tryAdd(id);
  tryAdd('glm');
  let routeStrategy: RouteStrategy | undefined;
  if (enabledChain.length >= 2) routeStrategy = { kind: 'fallback_chain', chain: enabledChain };
  else if (enabledChain.length === 1) routeStrategy = { kind: 'primary', providerId: enabledChain[0].providerId };

  return {
    glmClient,
    cwd: defaultCwd || homeDir,
    skillDescriptions: loader.getDescriptionText() || '',
    customRules,
    sharedRegistry,
    routeStrategy,
  };
}

function getCoordinatorConfig(): Promise<CoordinatorConfig> {
  const signature = currentConfigSignature();
  if (coordinatorConfigSignature && coordinatorConfigSignature !== signature) {
    coordinatorConfigPromise = null;
    // Running tasks keep their existing coordinator and finish normally. Only
    // idle sessions are discarded; the next task picks up the new settings.
    for (const key of Object.keys(coordinators)) {
      if (!activeSessions.has(key)) {
        delete coordinators[key];
        delete coordinatorLastUsed[key];
      }
    }
  }
  coordinatorConfigSignature = signature;
  coordinatorConfigPromise ||= initCoordinatorConfig();
  return coordinatorConfigPromise;
}

async function ensureHistoriesLoaded(): Promise<void> {
  if (historiesLoaded) return;
  if (!historiesLoadPromise) {
    historiesLoadPromise = (async () => {
      try {
        const home = await invoke<string>('get_home_dir');
        const result = await invoke<{ content: string }>('read_file', { path: `${home}/.kunpeng/cli-sessions.json` });
        const raw = result.content.replace(/^\s*\d+\t/gm, '');
        agentHistories = JSON.parse(raw) as Record<string, AgentMessage[]>;
      } catch {
        agentHistories = {};
      }
      historiesLoaded = true;
    })().finally(() => { historiesLoadPromise = null; });
  }
  await historiesLoadPromise;
}

function persistHistory(session: string, coordinator: AgentCoordinator): void {
  agentHistories[session] = compactRemoteHistory(repairToolPairingSnapshot(coordinator.getMessages()));
  if (historySaveTimer) clearTimeout(historySaveTimer);
  historySaveTimer = setTimeout(() => {
    void invoke('write_text_file_private', {
      path: '.kunpeng/cli-sessions.json',
      contents: JSON.stringify(agentHistories),
    }).catch((error) => console.warn('[cli] session history save failed:', error));
  }, 350);
}

function evictIdleCoordinators(): void {
  const keys = Object.keys(coordinators);
  if (keys.length <= MAX_COORDINATORS) return;
  const idle = keys.filter((key) => !activeSessions.has(key))
    .sort((a, b) => (coordinatorLastUsed[a] ?? 0) - (coordinatorLastUsed[b] ?? 0));
  for (const key of idle.slice(0, keys.length - MAX_COORDINATORS)) {
    delete coordinators[key];
    delete coordinatorLastUsed[key];
  }
}

async function getCoordinator(session: string): Promise<AgentCoordinator> {
  coordinatorLastUsed[session] = Date.now();
  if (coordinators[session]) return coordinators[session];
  const [config, shellEnv] = await Promise.all([getCoordinatorConfig(), getShellInfo()]);
  const coordinator = new AgentCoordinator({
    glmClient: config.glmClient,
    toolRegistry: config.sharedRegistry.clone(),
    cwd: config.cwd,
    os: osDisplayName(shellEnv.platform),
    shell: shellEnv.shell,
    maxTurns: 30,
    skillDescriptions: config.skillDescriptions || undefined,
    customRules: config.customRules,
    routeStrategy: config.routeStrategy,
  });
  await ensureHistoriesLoaded();
  const saved = agentHistories[session];
  if (saved?.length) {
    try { await coordinator.restoreMessages(saved); }
    catch (error) {
      console.warn('[cli] ignored invalid saved session:', error);
      delete agentHistories[session];
    }
  }
  coordinators[session] = coordinator;
  return coordinator;
}

async function executeAgentTask(request: CliTaskRequest, task: ActiveTask): Promise<void> {
  if (task.cancelled) {
    await respond(task, { ok: false, error: '任务已取消，未开始执行。' });
    return;
  }
  const runSteps = useRunStepStore.getState();
  const runId = runSteps.startRun({
    sessionId: `cli:${request.session}`,
    userRequest: request.prompt,
    modelProvider: 'CLI',
    modelId: 'Kunpeng Agent',
  });
  let status: RunStatus = 'done';
  let coordinator: AgentCoordinator | undefined;
  activeSessions.add(request.session);
  setAgentHeadless(true);
  try {
    const activeCoordinator = await getCoordinator(request.session);
    coordinator = activeCoordinator;
    task.coordinator = activeCoordinator;
    if (task.cancelled) activeCoordinator.abort();
    activeCoordinator.refreshSystemPrompt();
    emitEvent(task, { type: 'status', status: 'running', runId });
    const toolSteps = new Map<string, string[]>();
    const finalText = await withRemoteAgentTimeout(new Promise<string>((resolve, reject) => {
      const callbacks: CoordinatorCallbacks = {
        onTextDelta: (text) => emitEvent(task, { type: 'text', text }),
        onThinkingDelta: () => emitEvent(task, { type: 'status', status: 'thinking' }),
        onProgressText: (_raw, display) => {
          if (display) {
            runSteps.addProgressUpdate(display, runId);
            emitEvent(task, { type: 'progress', text: display });
          }
        },
        onToolStart: (name, params) => {
          const id = runSteps.startTool(name, params, runId);
          const queue = toolSteps.get(name) ?? [];
          if (id) queue.push(id);
          toolSteps.set(name, queue);
          emitEvent(task, { type: 'tool_start', name, params });
        },
        onToolEnd: (name, result) => {
          const queue = toolSteps.get(name) ?? [];
          const id = queue.shift() ?? null;
          if (!queue.length) toolSteps.delete(name);
          runSteps.finishTool(id, result.success, result, runId);
          emitEvent(task, { type: 'tool_end', name, success: result.success, output: result.output, error: result.error });
        },
        onComplete: resolve,
        onError: reject,
        onToolConfirm: async (name, _params, reason) => {
          if (request.autoApprove) return true;
          emitEvent(task, { type: 'confirmation_denied', name, reason });
          return false;
        },
        onCompacting: () => emitEvent(task, { type: 'status', status: 'compacting' }),
      };
      activeCoordinator.run(request.prompt, callbacks, [], runId).catch(reject);
    }), () => activeCoordinator.abort());
    if (task.cancelled) {
      status = 'aborted';
      await respond(task, { ok: false, error: '任务已取消。', text: finalText, runId });
    } else {
      await respond(task, { ok: true, text: finalText, runId });
    }
  } catch (error) {
    status = task.cancelled ? 'aborted' : 'failed';
    await respond(task, {
      ok: false,
      error: task.cancelled ? '任务已取消。' : error instanceof Error ? error.message : String(error),
      runId,
    });
  } finally {
    if (coordinator) persistHistory(request.session, coordinator);
    activeSessions.delete(request.session);
    setAgentHeadless(false);
    runSteps.finishRun(status, runId);
    task.coordinator = undefined;
    evictIdleCoordinators();
  }
}

function queueAgentTask(request: CliTaskRequest, task: ActiveTask): void {
  const previous = sessionQueues.get(request.session);
  if (previous) emitEvent(task, { type: 'status', status: 'queued' });
  const next = (previous ?? Promise.resolve())
    .catch(() => {})
    .then(() => executeAgentTask(request, task));
  sessionQueues.set(request.session, next);
  void next.finally(() => {
    if (sessionQueues.get(request.session) === next) sessionQueues.delete(request.session);
  });
}

async function executeDirectTool(request: CliToolRequest, task: ActiveTask): Promise<void> {
  const prompt = typeof request.params.prompt === 'string'
    ? request.params.prompt
    : `${request.name} ${JSON.stringify(request.params).slice(0, 300)}`;
  const runSteps = useRunStepStore.getState();
  const runId = runSteps.startRun({
    sessionId: `cli:${request.session}`,
    userRequest: prompt,
    modelProvider: 'CLI Direct',
    modelId: request.name,
  });
  let status: RunStatus = 'done';
  let toolId: string | null = null;
  let registry: ToolRegistry | undefined;
  setAgentHeadless(true);
  try {
    // Direct generation must not require a chat-model key or initialize the
    // Agent/MCP stack. Built-in tools read the current media settings directly.
    registry = createDefaultRegistry();
    const sourceView = request.name === 'canvas_generate' ? 'canvas' : request.name === 'workshop_generate' ? 'workshop' : 'chat';
    const decisionSource = {
      sourceView,
      sourceSessionId: `cli:${request.session}`,
      sourceLabel: 'CLI 直连生成',
    } as const;
    registry.bindRunContext(runId, { decisionSource, idempotencyRunId: runId });
    emitEvent(task, { type: 'status', status: 'running', runId, tool: request.name });
    const pre = await firePreToolUse({ toolName: request.name, params: request.params });
    if (pre.cancel) throw new Error(pre.reason || '工具被钩子取消');
    toolId = runSteps.startTool(request.name, request.params, runId);
    emitEvent(task, { type: 'tool_start', name: request.name, params: request.params });
    const startedAt = Date.now();
    const result: ToolResult = await registry.execute(
      request.name,
      request.params,
      task.controller.signal,
      { runId, idempotencyRunId: runId, decisionSource },
    );
    await firePostToolUse({
      toolName: request.name,
      params: request.params,
      result,
      durationMs: Date.now() - startedAt,
    });
    runSteps.finishTool(toolId, result.success, result, runId);
    toolId = null;
    emitEvent(task, {
      type: 'tool_end', name: request.name, success: result.success,
      output: result.output, error: result.error, generatedImages: result.generatedImages,
    });
    status = task.cancelled ? 'aborted' : result.success ? 'done' : 'failed';
    await respond(task, {
      ok: result.success && !task.cancelled,
      text: result.output || result.error || '',
      error: task.cancelled ? '已请求取消；请核对任务记录，已提交的付费生成不会自动重放。' : result.error,
      runId,
      data: {
        tool: request.name,
        generatedImages: result.generatedImages ?? [],
        paidSubmissionState: result.paidSubmissionState,
      },
    });
  } catch (error) {
    status = task.cancelled ? 'aborted' : 'failed';
    if (toolId) runSteps.finishTool(toolId, false, { error: error instanceof Error ? error.message : String(error) }, runId);
    await respond(task, {
      ok: false,
      error: task.cancelled ? '任务已取消；已提交工具不会自动重放。' : error instanceof Error ? error.message : String(error),
      runId,
    });
  } finally {
    registry?.clearRunContext(runId);
    setAgentHeadless(false);
    runSteps.finishRun(status, runId);
  }
}

function cancelTask(request: CliCancelRequest): void {
  const task = activeTasks.get(taskKey(request.connectionId, request.requestId));
  if (!task || task.cancelled) return;
  task.cancelled = true;
  task.controller.abort();
  task.coordinator?.abort();
  emitEvent(task, { type: 'status', status: 'cancelling', reason: request.reason });
}

export async function initCliBridge(): Promise<() => void> {
  if (bridgeCleanup) return bridgeCleanup;
  if (bridgeInitPromise) return bridgeInitPromise;
  bridgeInitPromise = (async () => {
    const listeners: UnlistenFn[] = [];
    listeners.push(await listen<CliTaskRequest>('cli-task-request', ({ payload }) => {
      const task: ActiveTask = {
        connectionId: payload.connectionId,
        requestId: payload.requestId,
        session: payload.session,
        cancelled: false,
        responded: false,
        controller: new AbortController(),
      };
      activeTasks.set(taskKey(payload.connectionId, payload.requestId), task);
      queueAgentTask(payload, task);
    }));
    listeners.push(await listen<CliToolRequest>('cli-tool-request', ({ payload }) => {
      const task: ActiveTask = {
        connectionId: payload.connectionId,
        requestId: payload.requestId,
        session: payload.session,
        cancelled: false,
        responded: false,
        controller: new AbortController(),
      };
      activeTasks.set(taskKey(payload.connectionId, payload.requestId), task);
      void executeDirectTool(payload, task);
    }));
    listeners.push(await listen<CliCancelRequest>('cli-task-cancel', ({ payload }) => cancelTask(payload)));
    await invoke('cli_bridge_ready', { ready: true });
    void invoke('cli_install').catch((error) => console.warn('[cli] client install failed:', error));

    const cleanup = () => {
      for (const stop of listeners.splice(0)) stop();
      for (const task of activeTasks.values()) {
        task.cancelled = true;
        task.controller.abort();
        task.coordinator?.abort();
      }
      void invoke('cli_bridge_ready', { ready: false }).catch(() => {});
      bridgeCleanup = null;
      bridgeInitPromise = null;
    };
    bridgeCleanup = cleanup;
    return cleanup;
  })().catch((error) => {
    bridgeCleanup = null;
    bridgeInitPromise = null;
    throw error;
  });
  return bridgeInitPromise;
}
