import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { useSettingsStore } from './settingsStore';
import { resolveApiKey } from '@/lib/credentials';
import { GLMClient } from '@/lib/agent/glmClient';
import { AgentCoordinator, repairToolPairingSnapshot } from '@/lib/agent/coordinator';
import type { RouteStrategy } from '@/lib/agent/providers/router';
import { createDefaultRegistry, ToolRegistry } from '@/lib/agent/toolRegistry';
import { SkillLoader } from '@/lib/agent/skillLoader';
import { McpManager, MCP_SERVERS } from '@/lib/agent/mcp';
import type { AgentMessage, CoordinatorCallbacks, Tool } from '@/lib/agent/types';
import { setAgentHeadless } from '@/lib/agent/headless';
import { useRunStepStore } from '@/stores/runStepStore';
import { MessageIdCache } from '@/lib/messaging/dedup';
import { CircuitBreaker } from '@/lib/messaging/circuitBreaker';
import { normalizeCustomRules } from '@/lib/agent/rulePolicy';
import { withRemoteAgentTimeout } from '@/lib/messaging/remoteRun';
import { compactRemoteHistory } from '@/lib/messaging/remoteHistory';

export interface LarkMessage {
  bot_id: string;
  chat_id: string;
  message_id: string;
  sender_id: string;
  chat_type: string;
  msg_type?: string;
  thread_id?: string | null;
  text: string;
  timestamp: number;
  isBot?: boolean;
  image_key?: string;
  image_local_path?: string;
  file_key?: string;
  file_name?: string;
  file_local_path?: string;
  voice_key?: string;
  voice_local_path?: string;
}

interface LarkStatusEvent {
  bot_id: string;
  state: 'connecting' | 'connected' | 'reconnecting' | 'failed';
  message?: string;
}

export type LarkReplyMode = 'auto' | 'manual' | 'ignore';

export interface LarkPluginSettings {
  streaming: boolean;
  footerElapsed: boolean;
  footerStatus: boolean;
  threadSession: boolean;
  groupPolicy: 'open' | 'allowlist' | 'disabled';
  groupAllowlist: string[];
}

export interface LarkContact {
  chatId: string;
  lastMessage: string;
  lastTime: number;
  unread: number;
  chatType?: string;
  lastSenderId?: string;
  replyMode?: LarkReplyMode;
}

export interface LarkBot {
  id: string;
  port: number;
  verificationToken?: string;
  running: boolean;
  connected: boolean;
  lastError?: string;
  statusText?: string;
  lastEventAt?: number;
  contacts: Record<string, LarkContact>;
  messages: Record<string, LarkMessage[]>;
  nicknames: Record<string, string>;
  pluginSettings: LarkPluginSettings;
}

interface LarkState {
  bots: Record<string, LarkBot>;
  activeBotId: string | null;
  selectedContact: string | null;
  replying: boolean;
  queueStatus: { active: number; pending: number };
  configOpen: boolean;

  saveConfig: (config: { appId: string; appSecret: string; verificationToken?: string; port: number }) => Promise<void>;
  updatePluginSettings: (botId: string, patch: Partial<LarkPluginSettings>) => void;
  startServer: (botId: string) => Promise<void>;
  stopServer: (botId: string) => Promise<void>;
  resumeBot: (botId: string) => void;
  sendMessage: (botId: string, chatId: string, text: string) => Promise<void>;
  triggerAiReply: (botId: string, chatId: string) => void;
  setActiveBot: (botId: string | null) => void;
  setSelectedContact: (chatId: string | null) => void;
  markRead: (botId: string, chatId: string) => void;
  setNickname: (botId: string, chatId: string, name: string) => void;
  setReplyMode: (botId: string, chatId: string, mode: LarkReplyMode) => void;
  setConfigOpen: (open: boolean) => void;
  initListener: () => Promise<() => void>;
  restoreSession: () => Promise<void>;
}

async function loadData<T>(key: string): Promise<T | null> {
  try {
    const raw = await invoke<string>('lark_load_data', { key });
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveAgentHistoryTimer: ReturnType<typeof setTimeout> | null = null;
let agentHistories: Record<string, AgentMessage[]> = {};
let agentHistoriesLoaded = false;
let agentHistoriesLoadPromise: Promise<void> | null = null;
function debounceSave(get: () => LarkState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const data: Record<string, { messages: Record<string, LarkMessage[]>; contacts: Record<string, LarkContact> }> = {};
    for (const [id, bot] of Object.entries(get().bots)) {
      data[id] = { messages: bot.messages, contacts: bot.contacts };
    }
    invoke('lark_save_data', { key: 'messages', data: JSON.stringify(data) }).catch(() => {});
  }, 500);
}

function saveNicknames(bots: Record<string, LarkBot>) {
  const data: Record<string, Record<string, string>> = {};
  for (const [id, bot] of Object.entries(bots)) data[id] = bot.nicknames;
  invoke('lark_save_data', { key: 'nicknames', data: JSON.stringify(data) }).catch(() => {});
}

function saveReplyModes(bots: Record<string, LarkBot>) {
  const data: Record<string, Record<string, LarkReplyMode>> = {};
  for (const [id, bot] of Object.entries(bots)) {
    data[id] = {};
    for (const [chatId, contact] of Object.entries(bot.contacts)) {
      if (contact.replyMode) data[id][chatId] = contact.replyMode;
    }
  }
  invoke('lark_save_data', { key: 'reply-modes', data: JSON.stringify(data) }).catch(() => {});
}

const defaultPluginSettings: LarkPluginSettings = {
  streaming: true,
  footerElapsed: true,
  footerStatus: true,
  threadSession: true,
  groupPolicy: 'open',
  groupAllowlist: [],
};

function savePluginSettings(bots: Record<string, LarkBot>) {
  const data: Record<string, LarkPluginSettings> = {};
  for (const [id, bot] of Object.entries(bots)) data[id] = bot.pluginSettings;
  invoke('lark_save_data', { key: 'plugin-settings', data: JSON.stringify(data) }).catch(() => {});
}

async function ensureAgentHistoriesLoaded() {
  if (agentHistoriesLoaded) return;
  if (!agentHistoriesLoadPromise) {
    agentHistoriesLoadPromise = loadData<Record<string, AgentMessage[]>>('agent-histories')
      .then((saved) => {
        agentHistories = saved || {};
        agentHistoriesLoaded = true;
      })
      .finally(() => { agentHistoriesLoadPromise = null; });
  }
  await agentHistoriesLoadPromise;
}

function persistAgentHistory(key: string, coordinator: AgentCoordinator) {
  agentHistories[key] = compactRemoteHistory(repairToolPairingSnapshot(coordinator.getMessages()));
  if (saveAgentHistoryTimer) clearTimeout(saveAgentHistoryTimer);
  saveAgentHistoryTimer = setTimeout(() => {
    invoke('lark_save_data', { key: 'agent-histories', data: JSON.stringify(agentHistories) })
      .catch((error) => console.warn('[lark] agent history save failed:', error));
  }, 350);
}

const coordinators: Record<string, AgentCoordinator> = {};
const larkDedupCache = new MessageIdCache();
const larkReplyDebounceTimers: Record<string, ReturnType<typeof setTimeout>> = {};
const larkCircuitBreakers: Record<string, CircuitBreaker> = {};
const larkCoordinatorLastUsed: Record<string, number> = {};
const MAX_LARK_COORDINATORS = 20;
let larkListenerCleanup: (() => void) | null = null;
let larkListenerInitPromise: Promise<() => void> | null = null;

function getLarkCircuitBreaker(botId: string): CircuitBreaker {
  if (!larkCircuitBreakers[botId]) larkCircuitBreakers[botId] = new CircuitBreaker();
  return larkCircuitBreakers[botId];
}

function evictOldLarkCoordinators() {
  const keys = Object.keys(coordinators);
  if (keys.length <= MAX_LARK_COORDINATORS) return;
  const sorted = keys.sort((a, b) => (larkCoordinatorLastUsed[a] ?? 0) - (larkCoordinatorLastUsed[b] ?? 0));
  const toEvict = sorted.slice(0, keys.length - MAX_LARK_COORDINATORS);
  for (const key of toEvict) {
    delete coordinators[key];
    delete larkCoordinatorLastUsed[key];
  }
  console.log(`[lark] evicted ${toEvict.length} idle coordinators`);
}
let coordinatorConfigPromise: Promise<{
  glmClient: GLMClient;
  cwd: string;
  skillDescriptions: string;
  customRules?: string;
  sharedRegistry: ToolRegistry;
  routeStrategy?: RouteStrategy;
}> | null = null;
let coordinatorConfigSignature = '';

function currentCoordinatorConfigSignature(): string {
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

async function initCoordinatorConfig() {
  const settings = useSettingsStore.getState();
  const { glmBaseUrl, glmModel, defaultCwd, providerDefault, providerApiKeys, providerFallbackChain } = settings;
  const glmApiKey = resolveApiKey(settings, 'glm', settings.glmApiKey);
  const anyProviderKey = Object.keys(providerApiKeys || {}).some(
    (id) => resolveApiKey(settings, `provider:${id}`, providerApiKeys[id]).trim(),
  );
  if (!glmApiKey && !anyProviderKey) throw new Error('未配置 API Key');

  let homeDir = '~';
  try { homeDir = await invoke<string>('get_home_dir'); } catch { /* noop */ }

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
    } catch { /* noop */ }
  }
  if (customRules) {
    const normalized = normalizeCustomRules(customRules);
    customRules = [
      normalized.notices.length > 0 ? `## 自定义规则兼容说明\n${normalized.notices.map((item) => `- ${item}`).join('\n')}` : '',
      normalized.rules,
    ].filter(Boolean).join('\n\n');
  }

  const sharedRegistry = createDefaultRegistry();
  const mcpManager = new McpManager(MCP_SERVERS);
  try {
    const { tools } = await mcpManager.initialize(glmApiKey);
    for (const tool of tools) sharedRegistry.register(tool);
  } catch (err) {
    console.warn('[lark] MCP init error:', err);
  }

  // Build routeStrategy — respect providerDefault & fallback chain
  const enabledChain: { providerId: string }[] = [];
  const seen = new Set<string>();
  const tryAdd = (id: string) => {
    if (seen.has(id)) return;
    const legacyKey = id === 'glm' ? (providerApiKeys?.glm ?? glmApiKey) : providerApiKeys?.[id];
    const key = resolveApiKey(settings, `provider:${id}`, legacyKey ?? '');
    if (!key?.trim()) return;
    enabledChain.push({ providerId: id });
    seen.add(id);
  };
  tryAdd(providerDefault || 'glm');
  for (const id of (providerFallbackChain || [])) tryAdd(id);
  tryAdd('glm');

  let routeStrategy: RouteStrategy | undefined;
  if (enabledChain.length >= 2) {
    routeStrategy = { kind: 'fallback_chain', chain: enabledChain };
  } else if (enabledChain.length === 1) {
    routeStrategy = { kind: 'primary', providerId: enabledChain[0].providerId };
  }

  return {
    glmClient,
    cwd: defaultCwd || homeDir,
    skillDescriptions: loader.getDescriptionText() || '',
    customRules,
    sharedRegistry,
    routeStrategy,
  };
}

function getCoordinatorConfig() {
  const signature = currentCoordinatorConfigSignature();
  if (coordinatorConfigSignature && coordinatorConfigSignature !== signature) {
    coordinatorConfigPromise = null;
    for (const key of Object.keys(coordinators)) delete coordinators[key];
    for (const key of Object.keys(larkCoordinatorLastUsed)) delete larkCoordinatorLastUsed[key];
  }
  coordinatorConfigSignature = signature;
  coordinatorConfigPromise ||= initCoordinatorConfig();
  return coordinatorConfigPromise;
}

async function getCoordinator(botId: string, chatId: string) {
  const key = `${botId}:${chatId}`;
  larkCoordinatorLastUsed[key] = Date.now();
  if (coordinators[key]) return coordinators[key];
  const config = await getCoordinatorConfig();
  const registry = config.sharedRegistry.clone();
  const sendFileTool: Tool = {
    definition: {
      name: 'send_file_to_user',
      description: '发送本地文件（图片、文档等）给当前飞书会话。参数 file_path 必须是绝对路径。图片以图片消息发送，其他格式以文件消息发送。',
      parameters: {
        type: 'object',
        properties: { file_path: { type: 'string', description: '要发送的文件绝对路径' } },
        required: ['file_path'],
      },
    },
    execute: async (params: Record<string, unknown>) => {
      const filePath = String(params.file_path || '');
      if (!filePath) return { success: false, output: '', error: '缺少 file_path 参数' };
      const ext = filePath.split('.').pop()?.toLowerCase() || '';
      try {
        if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(ext)) {
          await invoke('lark_send_image', { botId, chatId, filePath });
        } else {
          await invoke('lark_send_file', { botId, chatId, filePath });
        }
        return { success: true, output: `已发送文件: ${filePath}` };
      } catch (e) {
        return { success: false, output: '', error: `发送失败: ${e}` };
      }
    },
  };
  registry.register(sendFileTool);
  const coordinator = new AgentCoordinator({
    glmClient: config.glmClient,
    toolRegistry: registry,
    cwd: config.cwd,
    os: 'macOS',
    shell: 'zsh',
    maxTurns: 15,
    skillDescriptions: config.skillDescriptions || undefined,
    customRules: config.customRules,
    routeStrategy: config.routeStrategy,
  });
  await ensureAgentHistoriesLoaded();
  const savedHistory = agentHistories[key];
  if (savedHistory?.length) {
    try {
      await coordinator.restoreMessages(savedHistory);
    } catch (error) {
      console.warn('[lark] ignored invalid saved agent history:', error);
      delete agentHistories[key];
    }
  }
  coordinators[key] = coordinator;
  return coordinator;
}

function getSessionId(botId: string, msg: LarkMessage, settings: LarkPluginSettings) {
  const key = settings.threadSession && msg.thread_id ? `${msg.chat_id}:${msg.thread_id}` : msg.chat_id;
  return `lark:${botId}:${key}`;
}

function getCoordinatorKey(msg: LarkMessage, settings: LarkPluginSettings) {
  return settings.threadSession && msg.thread_id ? `${msg.chat_id}:${msg.thread_id}` : msg.chat_id;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (m) => m.split('\n').slice(1, -1).join('\n'))
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

function truncateCardText(text: string) {
  const clean = stripMarkdown(text || '').trim();
  if (!clean) return '正在整理回复...';
  return clean.length > 3600 ? `${clean.slice(0, 3600)}\n\n...` : clean;
}

function larkStreamCard(params: {
  title: string;
  content: string;
  status?: string;
  elapsedMs?: number;
  done?: boolean;
  failed?: boolean;
  settings: LarkPluginSettings;
}) {
  const footer: string[] = [];
  if (params.settings.footerStatus && params.status) footer.push(params.status);
  if (params.settings.footerElapsed && typeof params.elapsedMs === 'number') footer.push(`耗时 ${Math.max(1, Math.round(params.elapsedMs / 1000))}s`);
  const template = params.failed ? 'red' : params.done ? 'green' : 'blue';
  const elements: unknown[] = [
    { tag: 'markdown', content: truncateCardText(params.content) },
  ];
  if (footer.length) {
    elements.push({ tag: 'hr' });
    elements.push({
      tag: 'note',
      elements: [{ tag: 'plain_text', content: footer.join(' · ') }],
    });
  }
  return {
    config: { wide_screen_mode: true },
    header: {
      template,
      title: { tag: 'plain_text', content: params.title },
    },
    elements,
  };
}

async function sendStreamCard(botId: string, chatId: string, card: unknown) {
  return invoke<string>('lark_send_stream_card', { botId, chatId, card });
}

async function updateStreamCard(botId: string, messageId: string, card: unknown) {
  return invoke<void>('lark_update_stream_card', { botId, messageId, card });
}

function updateMessageLocalPath(
  botId: string,
  chatId: string,
  messageId: string,
  field: 'image_local_path' | 'file_local_path' | 'voice_local_path',
  localPath: string,
) {
  useLarkStore.setState((s) => {
    const bot = s.bots[botId];
    if (!bot) return s;
    const msgs = bot.messages[chatId];
    if (!msgs) return s;
    const idx = msgs.findIndex((m) => m.message_id === messageId);
    if (idx < 0) return s;
    const updated = [...msgs];
    updated[idx] = { ...updated[idx], [field]: localPath };
    return {
      bots: {
        ...s.bots,
        [botId]: { ...bot, messages: { ...bot.messages, [chatId]: updated } },
      },
    };
  });
}

function downloadLarkResource(botId: string, chatId: string, msg: LarkMessage) {
  if (msg.msg_type === 'image' && msg.image_key) {
    invoke<string>('lark_download_resource', {
      botId, messageId: msg.message_id, fileKey: msg.image_key,
      resourceType: 'image', fileName: null,
    }).then((path) => updateMessageLocalPath(botId, chatId, msg.message_id, 'image_local_path', path))
      .catch((e) => console.warn('[lark] image download failed:', e));
  }
  if (msg.msg_type === 'file' && msg.file_key) {
    invoke<string>('lark_download_resource', {
      botId, messageId: msg.message_id, fileKey: msg.file_key,
      resourceType: 'file', fileName: msg.file_name || null,
    }).then((path) => updateMessageLocalPath(botId, chatId, msg.message_id, 'file_local_path', path))
      .catch((e) => console.warn('[lark] file download failed:', e));
  }
  if (msg.msg_type === 'audio' && msg.voice_key) {
    invoke<string>('lark_download_resource', {
      botId, messageId: msg.message_id, fileKey: msg.voice_key,
      resourceType: 'audio', fileName: null,
    }).then((path) => updateMessageLocalPath(botId, chatId, msg.message_id, 'voice_local_path', path))
      .catch((e) => console.warn('[lark] voice download failed:', e));
  }
  if (msg.msg_type === 'media' && msg.file_key) {
    invoke<string>('lark_download_resource', {
      botId, messageId: msg.message_id, fileKey: msg.file_key,
      resourceType: 'media', fileName: msg.file_name || null,
    }).then((path) => updateMessageLocalPath(botId, chatId, msg.message_id, 'file_local_path', path))
      .catch((e) => console.warn('[lark] media download failed:', e));
  }
}

function appendLocalBotMessage(botId: string, chatId: string, chatType: string, text: string, set: (fn: (s: LarkState) => Partial<LarkState> | LarkState) => void, get: () => LarkState) {
  const msg: LarkMessage = {
    bot_id: botId,
    chat_id: chatId,
    message_id: `local-${Date.now()}`,
    sender_id: 'self',
    chat_type: chatType || 'p2p',
    text,
    timestamp: Date.now(),
    isBot: true,
  };
  set((s) => {
    const bot = s.bots[botId];
    if (!bot) return s;
    const existing = bot.messages[chatId] || [];
    const capped = existing.length >= 500 ? [...existing.slice(-499), msg] : [...existing, msg];
    return {
      bots: {
        ...s.bots,
        [botId]: {
          ...bot,
          messages: { ...bot.messages, [chatId]: capped },
        },
      },
    };
  });
  debounceSave(get);
}

type LarkReplyTask = { botId: string; chatId: string; force?: boolean };
let replyQueue: LarkReplyTask[] = [];
const activeReplyKeys = new Set<string>();
let activeReplyWorkers = 0;
const MAX_CONCURRENT_REPLIES = 2;

function larkReplyKey(task: LarkReplyTask) {
  return `${task.botId}:${task.chatId}`;
}

function defaultReplyMode(contact?: LarkContact, settings?: LarkPluginSettings): LarkReplyMode {
  if (contact?.replyMode) return contact.replyMode;
  if (contact?.chatType === 'group' && settings) {
    if (settings.groupPolicy === 'disabled') return 'ignore';
    if (settings.groupPolicy === 'allowlist' && !settings.groupAllowlist.includes(contact.chatId)) return 'ignore';
  }
  return 'auto';
}

async function processReplyTask(get: () => LarkState, task: LarkReplyTask) {
    const { botId, chatId, force } = task;
    // Hoisted so the catch block can finish THIS run (not whatever run
    // happens to hold the global currentRunId slot by then). An empty string
    // is a safe no-op target if startRun was never reached.
    let larkRunId = '';
    try {
      const bot = get().bots[botId];
      if (!bot) return;
      const contact = bot.contacts[chatId];
      if (!force && defaultReplyMode(contact, bot.pluginSettings) !== 'auto') return;
      const msgs = bot.messages[chatId] || [];
      const lastMsg = msgs[msgs.length - 1];
      if (!lastMsg || lastMsg.isBot) return;
      const settings = bot.pluginSettings || defaultPluginSettings;
      const sessionId = getSessionId(botId, lastMsg, settings);

      const runSteps = useRunStepStore.getState();
      // Capture this run's id: concurrent UI/wizard runs replace the store's
      // global currentRunId, so every step below must target this run
      // explicitly or it will write into (or finish) someone else's run.
      const larkRunIdValue = runSteps.startRun({
        sessionId,
        userRequest: lastMsg.text || '[飞书消息]',
        modelProvider: 'Lark',
        modelId: 'Kunpeng Agent',
      });
      larkRunId = larkRunIdValue;
      runSteps.ensureSystemStep('收到飞书消息', `会话 ${chatId}`, larkRunId);

      const userText = `[飞书${lastMsg.chat_type === 'group' ? '群聊' : '单聊'}消息。会话ID: ${chatId}，发送人: ${lastMsg.sender_id}。]\n${lastMsg.text}`;
      const coordinator = await getCoordinator(botId, getCoordinatorKey(lastMsg, settings));
      runSteps.ensureSystemStep('整理上下文', '合并飞书消息上下文，准备交给 Agent 处理。', larkRunId);

      setAgentHeadless(true);
      let reply = '';
      let streamedText = '';
      let streamCardId: string | null = null;
      let lastCardUpdate = 0;
      const startedAt = Date.now();
      if (settings.streaming) {
        try {
          streamCardId = await sendStreamCard(botId, chatId, larkStreamCard({
            title: '鲲鹏正在处理',
            content: '已收到消息，正在思考和调用工具。',
            status: '运行中',
            elapsedMs: 0,
            settings,
          }));
        } catch (err) {
          console.warn('[lark] stream card init failed, fallback to text:', err);
        }
      }
      try {
        reply = await withRemoteAgentTimeout(new Promise<string>((resolve, reject) => {
          const flushCard = (status = '生成中') => {
            if (!streamCardId) return;
            const now = Date.now();
            if (now - lastCardUpdate < 900) return;
            lastCardUpdate = now;
            updateStreamCard(botId, streamCardId, larkStreamCard({
              title: '鲲鹏正在回复',
              content: streamedText || '正在整理回复...',
              status,
              elapsedMs: now - startedAt,
              settings,
            })).catch((err) => console.warn('[lark] stream card update failed:', err));
          };
          const callbacks: CoordinatorCallbacks = {
            onTextDelta: (text) => {
              streamedText += text;
              flushCard('生成中');
            },
            onThinkingDelta: () => {
              flushCard('思考中');
            },
            onToolStart: (name, params) => {
              const id = useRunStepStore.getState().startTool(name, params, larkRunId);
              if (id) (callbacks as unknown as { __runningToolId?: string }).__runningToolId = id;
              if (streamCardId) {
                updateStreamCard(botId, streamCardId, larkStreamCard({
                  title: '鲲鹏正在执行工具',
                  content: streamedText || `正在执行 ${name}`,
                  status: `工具 ${name}`,
                  elapsedMs: Date.now() - startedAt,
                  settings,
                })).catch(() => {});
              }
            },
            onToolEnd: (_name, result) => {
              const id = (callbacks as unknown as { __runningToolId?: string }).__runningToolId ?? null;
              useRunStepStore.getState().finishTool(id, result.success, result, larkRunId);
            },
            onComplete: resolve,
            onError: reject,
            onToolConfirm: async () => true,
            onSubAgentDelta: () => {},
            onCompacting: () => {},
          };
          coordinator.run(userText, callbacks).catch(reject);
        }), () => coordinator.abort());
      } finally {
        persistAgentHistory(`${botId}:${getCoordinatorKey(lastMsg, settings)}`, coordinator);
        setAgentHeadless(false);
      }

      const plain = stripMarkdown(reply);
      if (plain) {
        runSteps.ensureSystemStep('发送飞书回复', plain.slice(0, 180), larkRunId);
        if (streamCardId) {
          try {
            await updateStreamCard(botId, streamCardId, larkStreamCard({
              title: '鲲鹏已回复',
              content: plain,
              status: '完成',
              elapsedMs: Date.now() - startedAt,
              done: true,
              settings,
            }));
            appendLocalBotMessage(botId, chatId, lastMsg.chat_type, plain, useLarkStore.setState, get);
          } catch (error) {
            console.warn('[lark] final stream card update failed, sending text fallback:', error);
            await get().sendMessage(botId, chatId, plain);
          }
        } else {
          await get().sendMessage(botId, chatId, plain);
        }
      }
      runSteps.finishRun('done', larkRunId);
    } catch (e) {
      const bot = get().bots[botId];
      const contact = bot?.contacts[chatId];
      useRunStepStore.getState().ensureSystemStep('飞书回复失败', e instanceof Error ? e.message : String(e), larkRunId);
      useRunStepStore.getState().finishRun('failed', larkRunId);
      if (contact) {
        get().sendMessage(botId, chatId, `处理失败：${e instanceof Error ? e.message : String(e)}`).catch(() => {});
      }
      console.error('[lark] auto reply error:', e);
    }
}

function processReplyQueue(get: () => LarkState) {
  while (activeReplyWorkers < MAX_CONCURRENT_REPLIES) {
    const index = replyQueue.findIndex((task) => !activeReplyKeys.has(larkReplyKey(task)));
    if (index < 0) break;
    const [task] = replyQueue.splice(index, 1);
    const key = larkReplyKey(task);
    activeReplyWorkers += 1;
    activeReplyKeys.add(key);
    useLarkStore.setState({ replying: true, queueStatus: { active: activeReplyWorkers, pending: replyQueue.length } });
    void processReplyTask(get, task).finally(() => {
      activeReplyWorkers = Math.max(0, activeReplyWorkers - 1);
      activeReplyKeys.delete(key);
      useLarkStore.setState({
        replying: activeReplyWorkers > 0 || replyQueue.length > 0,
        queueStatus: { active: activeReplyWorkers, pending: replyQueue.length },
      });
      evictOldLarkCoordinators();
      processReplyQueue(get);
    });
  }
}

function enqueueReply(botId: string, chatId: string, get: () => LarkState, force = false) {
  if (replyQueue.some((item) => item.botId === botId && item.chatId === chatId)) return;
  replyQueue.push({ botId, chatId, force });
  useLarkStore.setState({ queueStatus: { active: activeReplyWorkers, pending: replyQueue.length } });
  void processReplyQueue(get);
}

function createBot(id: string, port: number, verificationToken?: string): LarkBot {
  return { id, port, verificationToken, running: false, connected: true, contacts: {}, messages: {}, nicknames: {}, pluginSettings: { ...defaultPluginSettings } };
}

export const useLarkStore = create<LarkState>()((set, get) => ({
  bots: {},
  activeBotId: null,
  selectedContact: null,
  replying: false,
  queueStatus: { active: 0, pending: 0 },
  configOpen: false,

  setConfigOpen: (open) => set({ configOpen: open }),

  updatePluginSettings: (botId, patch) => {
    set((s) => {
      const bot = s.bots[botId];
      if (!bot) return s;
      return {
        bots: {
          ...s.bots,
          [botId]: {
            ...bot,
            pluginSettings: { ...(bot.pluginSettings || defaultPluginSettings), ...patch },
          },
        },
      };
    });
    savePluginSettings(get().bots);
  },

  saveConfig: async ({ appId, appSecret, verificationToken, port }) => {
    const cleanToken = verificationToken?.trim() || null;
    await invoke('lark_save_config', {
      appId,
      appSecret,
      verificationToken: cleanToken,
      port,
    });
    set((s) => ({
      bots: {
        ...s.bots,
        [appId]: {
          ...(s.bots[appId] || createBot(appId, port)),
          port,
          verificationToken: cleanToken || undefined,
          pluginSettings: s.bots[appId]?.pluginSettings || { ...defaultPluginSettings },
        },
      },
      activeBotId: appId,
      configOpen: false,
    }));
    await get().startServer(appId);
  },

  startServer: async (botId) => {
    await invoke('lark_start_server', { botId });
    set((s) => {
      const bot = s.bots[botId];
      if (!bot) return s;
      return { bots: { ...s.bots, [botId]: { ...bot, running: true, connected: true, lastError: undefined } } };
    });
  },

  stopServer: async (botId) => {
    await invoke('lark_stop_server', { botId });
    set((s) => {
      const bot = s.bots[botId];
      if (!bot) return s;
      return { bots: { ...s.bots, [botId]: { ...bot, running: false } } };
    });
  },

  resumeBot: (botId) => {
    getLarkCircuitBreaker(botId).reset();
    get().startServer(botId).catch((e) => {
      set((s) => {
        const bot = s.bots[botId];
        if (!bot) return s;
        return { bots: { ...s.bots, [botId]: { ...bot, running: false, lastError: String(e) } } };
      });
    });
  },

  sendMessage: async (botId, chatId, text) => {
    await invoke('lark_send_message', { botId, chatId, text });
    const msg: LarkMessage = {
      bot_id: botId,
      chat_id: chatId,
      message_id: `local-${Date.now()}`,
      sender_id: 'self',
      chat_type: get().bots[botId]?.contacts[chatId]?.chatType || 'p2p',
      text,
      timestamp: Date.now(),
      isBot: true,
    };
    set((s) => {
      const bot = s.bots[botId];
      if (!bot) return s;
      return {
        bots: {
          ...s.bots,
          [botId]: {
            ...bot,
            messages: { ...bot.messages, [chatId]: [...(bot.messages[chatId] || []), msg] },
          },
        },
      };
    });
    debounceSave(get);
  },

  triggerAiReply: (botId, chatId) => enqueueReply(botId, chatId, get, true),
  setActiveBot: (botId) => set({ activeBotId: botId, selectedContact: null }),
  setSelectedContact: (chatId) => {
    set({ selectedContact: chatId });
    const botId = get().activeBotId;
    if (botId && chatId) get().markRead(botId, chatId);
  },
  markRead: (botId, chatId) => {
    set((s) => {
      const bot = s.bots[botId];
      if (!bot || !bot.contacts[chatId]) return s;
      return {
        bots: {
          ...s.bots,
          [botId]: {
            ...bot,
            contacts: { ...bot.contacts, [chatId]: { ...bot.contacts[chatId], unread: 0 } },
          },
        },
      };
    });
  },
  setNickname: (botId, chatId, name) => {
    set((s) => {
      const bot = s.bots[botId];
      if (!bot) return s;
      return { bots: { ...s.bots, [botId]: { ...bot, nicknames: { ...bot.nicknames, [chatId]: name } } } };
    });
    saveNicknames(get().bots);
  },
  setReplyMode: (botId, chatId, mode) => {
    set((s) => {
      const bot = s.bots[botId];
      if (!bot) return s;
      const contact = bot.contacts[chatId] || { chatId, lastMessage: '', lastTime: Date.now(), unread: 0 };
      return {
        bots: {
          ...s.bots,
          [botId]: {
            ...bot,
            contacts: { ...bot.contacts, [chatId]: { ...contact, replyMode: mode } },
          },
        },
      };
    });
    saveReplyModes(get().bots);
  },

  initListener: async () => {
    if (larkListenerCleanup) return larkListenerCleanup;
    if (larkListenerInitPromise) return larkListenerInitPromise;

    larkListenerInitPromise = (async () => {
    const unlisten = await listen<LarkMessage>('lark-message', (event) => {
      const msg = { ...event.payload, timestamp: Date.now() };
      const botId = msg.bot_id;
      const chatId = msg.chat_id;

      if (larkDedupCache.has(msg.message_id)) return;
      larkDedupCache.add(msg.message_id);

      set((s) => {
        const bot = s.bots[botId] || createBot(botId, 0);
        const existing = bot.messages[chatId] || [];
        if (existing.some((m) => m.message_id === msg.message_id)) return s;
        const contact = bot.contacts[chatId] || { chatId, lastMessage: '', lastTime: 0, unread: 0 };
        const isViewing = s.activeBotId === botId && s.selectedContact === chatId;
        const capped = existing.length >= 500 ? [...existing.slice(-499), msg] : [...existing, msg];
        return {
          bots: {
            ...s.bots,
            [botId]: {
              ...bot,
              running: true,
              connected: true,
              lastEventAt: Date.now(),
              messages: { ...bot.messages, [chatId]: capped },
              contacts: {
                ...bot.contacts,
                [chatId]: {
                  ...contact,
                  chatType: msg.chat_type,
                  lastSenderId: msg.sender_id,
                  replyMode: contact.replyMode ?? 'auto',
                  lastMessage: msg.text || '...',
                  lastTime: msg.timestamp,
                  unread: isViewing ? 0 : contact.unread + 1,
                },
              },
            },
          },
        };
      });
      debounceSave(get);
      downloadLarkResource(botId, chatId, msg);
      if (defaultReplyMode(get().bots[botId]?.contacts[chatId], get().bots[botId]?.pluginSettings) === 'auto') {
        const debounceKey = `${botId}:${chatId}`;
        if (larkReplyDebounceTimers[debounceKey]) clearTimeout(larkReplyDebounceTimers[debounceKey]);
        larkReplyDebounceTimers[debounceKey] = setTimeout(() => {
          delete larkReplyDebounceTimers[debounceKey];
          enqueueReply(botId, chatId, get);
        }, 1500);
      }
    });

    const unlistenStatus = await listen<LarkStatusEvent>('lark-status', (event) => {
      const status = event.payload;
      const cb = getLarkCircuitBreaker(status.bot_id);
      if (status.state === 'connected') {
        cb.recordSuccess();
      } else if (status.state === 'failed') {
        cb.recordFailure();
      }
      const circuitOpen = cb.isOpen();
      set((s) => {
        const bot = s.bots[status.bot_id] || createBot(status.bot_id, 0);
        return {
          bots: {
            ...s.bots,
            [status.bot_id]: {
              ...bot,
              running: circuitOpen ? false : status.state !== 'failed',
              connected: status.state === 'connected',
              lastError: circuitOpen ? '连接反复失败，已暂停。点击"恢复"重试' : (status.state === 'failed' ? status.message : undefined),
              statusText: circuitOpen ? '已暂停' : status.message,
            },
          },
        };
      });
    });

    const healthTimer = window.setInterval(() => {
      invoke<{ bots: { app_id: string; port: number; running: boolean }[] }>('lark_get_status')
        .then((status) => {
          set((s) => {
            const next = { ...s.bots };
            for (const b of status.bots) {
              if (!next[b.app_id]) next[b.app_id] = createBot(b.app_id, b.port);
              next[b.app_id] = { ...next[b.app_id], port: b.port, running: b.running };
            }
            return { bots: next };
          });
        })
        .catch(() => {});
    }, 15_000);

    const cleanup = () => {
      unlisten();
      unlistenStatus();
      window.clearInterval(healthTimer);
      larkListenerCleanup = null;
      larkListenerInitPromise = null;
    };
    larkListenerCleanup = cleanup;
    return cleanup;
    })().catch((err) => {
      larkListenerCleanup = null;
      larkListenerInitPromise = null;
      throw err;
    });

    return larkListenerInitPromise;
  },

  restoreSession: async () => {
    try {
      const [savedMsgs, savedNicknames, savedModes, savedPluginSettings, restored] = await Promise.all([
        loadData<Record<string, { messages: Record<string, LarkMessage[]>; contacts: Record<string, LarkContact> }>>('messages'),
        loadData<Record<string, Record<string, string>>>('nicknames'),
        loadData<Record<string, Record<string, LarkReplyMode>>>('reply-modes'),
        loadData<Record<string, LarkPluginSettings>>('plugin-settings'),
        invoke<{ bots: { app_id: string; port: number; verification_token?: string | null }[] }>('lark_restore_config'),
      ]);
      const next: Record<string, LarkBot> = {};
      for (const b of restored.bots || []) {
        const saved = savedMsgs?.[b.app_id];
        const contacts = saved?.contacts || {};
        for (const [chatId, mode] of Object.entries(savedModes?.[b.app_id] || {})) {
          contacts[chatId] = contacts[chatId]
            ? { ...contacts[chatId], replyMode: mode }
            : { chatId, lastMessage: '', lastTime: Date.now(), unread: 0, replyMode: mode };
        }
        next[b.app_id] = {
          id: b.app_id,
          port: b.port,
          verificationToken: b.verification_token || undefined,
          running: false,
          connected: true,
          contacts,
          messages: saved?.messages || {},
          nicknames: savedNicknames?.[b.app_id] || {},
          pluginSettings: { ...defaultPluginSettings, ...(savedPluginSettings?.[b.app_id] || {}) },
        };
      }
      const ids = Object.keys(next);
      set({ bots: next, activeBotId: ids[0] || null, configOpen: ids.length === 0 });
      for (const id of ids) {
        get().startServer(id).catch((e) => {
          set((s) => {
            const bot = s.bots[id];
            if (!bot) return s;
            return { bots: { ...s.bots, [id]: { ...bot, running: false, lastError: String(e) } } };
          });
        });
      }
    } catch (e) {
      console.error('[lark] restore error:', e);
      set({ configOpen: true });
    }
  },
}));
