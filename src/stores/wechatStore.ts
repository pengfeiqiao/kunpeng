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
import type { AgentMessage, CoordinatorCallbacks } from '@/lib/agent/types';
import { setAgentHeadless } from '@/lib/agent/headless';
import { useRunStepStore } from '@/stores/runStepStore';
import { MessageIdCache } from '@/lib/messaging/dedup';
import { CircuitBreaker } from '@/lib/messaging/circuitBreaker';
import { formatToolSummary } from '@/lib/agent/toolSummary';
import { normalizeCustomRules } from '@/lib/agent/rulePolicy';
import { getShellInfo, osDisplayName } from '@/lib/platform';
import { withRemoteAgentTimeout } from '@/lib/messaging/remoteRun';
import { compactRemoteHistory } from '@/lib/messaging/remoteHistory';

export interface FileAttachment {
  url: string;
  name: string;
  size: number;
}

export interface WechatMessage {
  from_user_id: string;
  to_user_id: string;
  message_id: string;
  text: string;
  room_id: string;
  msg_type: number;
  bot_id: string;
  timestamp: number;
  isBot?: boolean;
  images?: string[];
  files?: FileAttachment[];
  videos?: string[];
  voice_url?: string;
  voice_text?: string;
}

export interface WechatContact {
  userId: string;
  lastMessage: string;
  lastTime: number;
  unread: number;
  replyMode?: WechatReplyMode;
  isGroup?: boolean;
  lastSenderId?: string;
}

export type WechatReplyMode = 'auto' | 'manual' | 'ignore';

export interface WechatBot {
  id: string; // account_id
  connected: boolean;
  polling: boolean;
  reconnecting?: boolean;
  lastError?: string;
  lastSeenAt?: number;
  contacts: Record<string, WechatContact>;
  messages: Record<string, WechatMessage[]>;
  nicknames: Record<string, string>;
}

interface WechatStatusEvent {
  bot_id: string;
  state: 'connected' | 'degraded';
  message?: string;
}

interface WechatState {
  bots: Record<string, WechatBot>;
  activeBotId: string | null;
  selectedContact: string | null;
  replying: boolean;
  queueStatus: { active: number; pending: number };
  processingStatus: Record<string, {
    stage: 'thinking' | 'tool' | 'generating';
    toolName?: string;
    startedAt: number;
  }>;

  // Login flow
  qrcodeUrl: string | null;
  qrcodeToken: string | null;
  pollBaseUrl: string | null;
  loginStatus: 'idle' | 'loading' | 'waiting' | 'expired' | 'error';
  loginScanning: boolean;

  fetchQrcode: () => Promise<void>;
  pollQrcodeStatus: () => Promise<'wait' | 'scaned' | 'confirmed' | 'expired' | 'error'>;
  startPolling: (botId: string) => Promise<void>;
  stopPolling: (botId: string) => Promise<void>;
  resumeBot: (botId: string) => void;
  disconnect: (botId: string) => Promise<void>;
  sendMessage: (botId: string, toUserId: string, text: string) => Promise<void>;
  sendFile: (botId: string, toUserId: string, filePath: string) => Promise<void>;
  triggerAiReply: (botId: string, userId: string) => void;
  setActiveBot: (botId: string | null) => void;
  setSelectedContact: (userId: string | null) => void;
  markRead: (botId: string, userId: string) => void;
  initListener: () => Promise<() => void>;
  restoreSession: () => Promise<void>;
  setNickname: (botId: string, userId: string, name: string) => void;
  setReplyMode: (botId: string, userId: string, mode: WechatReplyMode) => void;
  addContact: (botId: string, userId: string, nickname?: string) => void;
  resetLogin: () => void;
}

const reconnectTimers: Record<string, ReturnType<typeof setTimeout>> = {};
const reconnectAttempts: Record<string, number> = {};
const wechatDedupCache = new MessageIdCache();
const replyDebounceTimers: Record<string, ReturnType<typeof setTimeout>> = {};
const wechatCircuitBreakers: Record<string, CircuitBreaker> = {};
const coordinatorLastUsed: Record<string, number> = {};
const MAX_COORDINATORS = 20;
let wechatListenerCleanup: (() => void) | null = null;
let wechatListenerInitPromise: Promise<() => void> | null = null;

function getCircuitBreaker(botId: string): CircuitBreaker {
  if (!wechatCircuitBreakers[botId]) wechatCircuitBreakers[botId] = new CircuitBreaker();
  return wechatCircuitBreakers[botId];
}

function evictOldCoordinators() {
  const keys = Object.keys(coordinators);
  if (keys.length <= MAX_COORDINATORS) return;
  const sorted = keys.sort((a, b) => (coordinatorLastUsed[a] ?? 0) - (coordinatorLastUsed[b] ?? 0));
  const toEvict = sorted.slice(0, keys.length - MAX_COORDINATORS);
  for (const key of toEvict) {
    delete coordinators[key];
    delete coordinatorLastUsed[key];
  }
  console.log(`[wechat] evicted ${toEvict.length} idle coordinators`);
}

function clearReconnect(botId: string) {
  if (reconnectTimers[botId]) {
    clearTimeout(reconnectTimers[botId]);
    delete reconnectTimers[botId];
  }
  delete reconnectAttempts[botId];
}

function scheduleReconnect(botId: string, get: () => WechatState, reason = '连接中断，正在尝试恢复') {
  if (reconnectTimers[botId]) return;
  const cb = getCircuitBreaker(botId);
  cb.recordFailure();
  if (cb.isOpen()) {
    useWechatStore.setState((s) => {
      const bot = s.bots[botId];
      if (!bot) return s;
      return {
        bots: {
          ...s.bots,
          [botId]: { ...bot, connected: false, polling: false, reconnecting: false, lastError: '连接反复失败，已暂停。点击"恢复"重试' },
        },
      };
    });
    return;
  }
  const attempt = (reconnectAttempts[botId] ?? 0) + 1;
  reconnectAttempts[botId] = attempt;
  const delay = Math.min(30_000, 1_500 * attempt);
  useWechatStore.setState((s) => {
    const bot = s.bots[botId];
    if (!bot) return s;
    return {
      bots: {
        ...s.bots,
        [botId]: { ...bot, connected: false, polling: false, reconnecting: true, lastError: reason },
      },
    };
  });
  reconnectTimers[botId] = setTimeout(() => {
    delete reconnectTimers[botId];
    const bot = get().bots[botId];
    if (!bot) return;
    get().startPolling(botId).catch(() => {
      scheduleReconnect(botId, get, '恢复失败，稍后继续重试');
    });
  }, delay);
}

// ── Persistence helpers ────────────────────────────────────────────────────

let saveMessagesTimer: ReturnType<typeof setTimeout> | null = null;
let saveAgentHistoryTimer: ReturnType<typeof setTimeout> | null = null;
let agentHistories: Record<string, AgentMessage[]> = {};
let agentHistoriesLoaded = false;
let agentHistoriesLoadPromise: Promise<void> | null = null;

function debounceSaveMessages(get: () => WechatState) {
  if (saveMessagesTimer) clearTimeout(saveMessagesTimer);
  saveMessagesTimer = setTimeout(() => {
    const { bots } = get();
    // Save all bots' messages and contacts
    const data: Record<string, { messages: Record<string, WechatMessage[]>; contacts: Record<string, WechatContact> }> = {};
    for (const [id, bot] of Object.entries(bots)) {
      data[id] = { messages: bot.messages, contacts: bot.contacts };
    }
    invoke('wechat_save_data', { key: 'messages', data: JSON.stringify(data) }).catch(() => {});
  }, 500);
}

function saveNicknames(bots: Record<string, WechatBot>) {
  const allNicknames: Record<string, Record<string, string>> = {};
  for (const [id, bot] of Object.entries(bots)) {
    allNicknames[id] = bot.nicknames;
  }
  invoke('wechat_save_data', { key: 'nicknames', data: JSON.stringify(allNicknames) }).catch(() => {});
}

function saveReplyModes(bots: Record<string, WechatBot>) {
  const allModes: Record<string, Record<string, WechatReplyMode>> = {};
  for (const [id, bot] of Object.entries(bots)) {
    const modes: Record<string, WechatReplyMode> = {};
    for (const [userId, contact] of Object.entries(bot.contacts)) {
      if (contact.replyMode) modes[userId] = contact.replyMode;
    }
    allModes[id] = modes;
  }
  invoke('wechat_save_data', { key: 'reply-modes', data: JSON.stringify(allModes) }).catch(() => {});
}

async function loadData<T>(key: string): Promise<T | null> {
  try {
    const raw = await invoke<string>('wechat_load_data', { key });
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function wechatHistoryKey(botId: string, userId: string) {
  return `${botId}:${userId}`;
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

function persistAgentHistory(botId: string, userId: string, coordinator: AgentCoordinator) {
  const key = wechatHistoryKey(botId, userId);
  agentHistories[key] = compactRemoteHistory(repairToolPairingSnapshot(coordinator.getMessages()));
  if (saveAgentHistoryTimer) clearTimeout(saveAgentHistoryTimer);
  saveAgentHistoryTimer = setTimeout(() => {
    invoke('wechat_save_data', { key: 'agent-histories', data: JSON.stringify(agentHistories) })
      .catch((error) => console.warn('[wechat] agent history save failed:', error));
  }, 350);
}

// ── Agent Coordinator for WeChat ───────────────────────────────────────────

const coordinators: Record<string, AgentCoordinator> = {};
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
  try { homeDir = await invoke<string>('get_home_dir'); } catch { /* */ }

  const loader = new SkillLoader([
    `${homeDir}/.kunpeng/skills`,
    `${homeDir}/kunpeng/skills`,
  ]);
  await loader.loadAll();

  const client = new GLMClient({
    apiKey: glmApiKey,
    baseUrl: glmBaseUrl || 'https://open.bigmodel.cn/api/anthropic',
    model: glmModel || 'glm-5.1',
  });

  let customRules: string | undefined;
  try {
    for (const filename of ['AGENT.md', 'CLAUDE.md']) {
      const path = `${homeDir}/.kunpeng/${filename}`;
      try {
        const result = await invoke<{ content: string }>('read_file', { path });
        if (result?.content?.trim()) {
          customRules = result.content.replace(/^\s*\d+\t/gm, '');
          break;
        }
      } catch { /* */ }
    }
  } catch { /* */ }
  if (customRules) {
    const normalized = normalizeCustomRules(customRules);
    customRules = [
      normalized.notices.length > 0 ? `## 自定义规则兼容说明\n${normalized.notices.map((item) => `- ${item}`).join('\n')}` : '',
      normalized.rules,
    ].filter(Boolean).join('\n\n');
  }

  const cwd = defaultCwd || homeDir;

  // Create shared registry with built-in tools
  const sharedRegistry = createDefaultRegistry();

  // Load MCP tools (including vision) — await to ensure tools are ready before use
  const mcpManager = new McpManager(MCP_SERVERS);
  try {
    const { tools: mcpTools, errors } = await mcpManager.initialize(glmApiKey);
    for (const tool of mcpTools) {
      sharedRegistry.register(tool);
    }
    console.log(`[wechat] MCP: ${mcpTools.length} tools loaded for WeChat coordinators`);
    if (errors.length) {
      console.warn('[wechat] MCP partial failures:', errors);
    }
  } catch (err) {
    console.error('[wechat] MCP init error:', err);
  }

  // Build routeStrategy like main agent — respect providerDefault & fallback chain
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
  // Also try glm as final fallback if it has a key
  tryAdd('glm');

  let routeStrategy: RouteStrategy | undefined;
  if (enabledChain.length >= 2) {
    routeStrategy = { kind: 'fallback_chain', chain: enabledChain };
  } else if (enabledChain.length === 1) {
    routeStrategy = { kind: 'primary', providerId: enabledChain[0].providerId };
  }
  console.log('[wechat] routeStrategy:', JSON.stringify(routeStrategy), 'providerDefault:', providerDefault);

  return {
    glmClient: client,
    cwd,
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
    for (const key of Object.keys(coordinatorLastUsed)) delete coordinatorLastUsed[key];
  }
  coordinatorConfigSignature = signature;
  if (!coordinatorConfigPromise) {
    coordinatorConfigPromise = initCoordinatorConfig();
  }
  return coordinatorConfigPromise;
}

// coordinatorKey = botId:userId to keep per-bot-per-contact coordinators
async function getCoordinator(botId: string, userId: string): Promise<AgentCoordinator> {
  const key = `${botId}:${userId}`;
  coordinatorLastUsed[key] = Date.now();
  if (coordinators[key]) return coordinators[key];

  const config = await getCoordinatorConfig();
  const registry = config.sharedRegistry.clone();
  registry.register({
    definition: {
      name: 'send_file_to_user',
      description: '发送本地文件（图片、文档、视频等）给当前微信会话。参数 file_path 必须是绝对路径。',
      parameters: {
        type: 'object',
        properties: { file_path: { type: 'string', description: '要发送的文件绝对路径' } },
        required: ['file_path'],
      },
    },
    execute: async (params: Record<string, unknown>) => {
      const filePath = String(params.file_path || '');
      if (!filePath) return { success: false, output: '', error: '缺少 file_path 参数' };
      try {
        await useWechatStore.getState().sendFile(botId, userId, filePath);
        return { success: true, output: `文件已发送给用户: ${filePath}` };
      } catch (e) {
        return { success: false, output: '', error: `发送失败: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  });

  const shellEnv = await getShellInfo();
  const coordinator = new AgentCoordinator({
    glmClient: config.glmClient,
    toolRegistry: registry,
    cwd: config.cwd,
    os: osDisplayName(shellEnv.platform),
    shell: shellEnv.shell,
    maxTurns: 15,
    skillDescriptions: config.skillDescriptions || undefined,
    customRules: config.customRules,
    routeStrategy: config.routeStrategy,
  });

  await ensureAgentHistoriesLoaded();
  const savedHistory = agentHistories[wechatHistoryKey(botId, userId)];
  if (savedHistory?.length) {
    try {
      await coordinator.restoreMessages(savedHistory);
    } catch (error) {
      console.warn('[wechat] ignored invalid saved agent history:', error);
      delete agentHistories[wechatHistoryKey(botId, userId)];
    }
  }

  coordinators[key] = coordinator;
  return coordinator;
}

/** Strip markdown formatting for plain text WeChat reply */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (m) => {
      const lines = m.split('\n');
      return lines.slice(1, -1).join('\n');
    })
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/^\s*\d+\.\s+/gm, (m) => m.trim() + ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

// ── Auto-reply queue ────────────────────────────────────────────────────────

type WechatReplyTask = { botId: string; userId: string; force?: boolean };
let replyQueue: WechatReplyTask[] = [];
const activeReplyKeys = new Set<string>();
let activeReplyWorkers = 0;
const MAX_CONCURRENT_REPLIES = 2;

function wechatReplyKey(task: WechatReplyTask) {
  return `${task.botId}:${task.userId}`;
}

function getSessionKey(msg: Pick<WechatMessage, 'from_user_id' | 'room_id'>): string {
  return msg.room_id || msg.from_user_id;
}

function defaultReplyModeForContact(contact?: WechatContact): WechatReplyMode {
  return contact?.isGroup ? 'ignore' : (contact?.replyMode ?? 'auto');
}

async function processReplyTask(get: () => WechatState, task: WechatReplyTask) {
    const { botId, userId, force } = task;
    // Hoisted so the catch block can finish THIS run (not whatever run
    // happens to hold the global currentRunId slot by then). An empty string
    // is a safe no-op target if startRun was never reached.
    let wechatRunId = '';
    try {
      const coordinator = await getCoordinator(botId, userId);

      const bot = get().bots[botId];
      if (!bot) return;
      if (bot.contacts[userId]?.isGroup) return;
      if (!force && defaultReplyModeForContact(bot.contacts[userId]) !== 'auto') return;
      const msgs = bot.messages[userId] || [];
      const lastMsg = msgs[msgs.length - 1];
      if (!lastMsg || lastMsg.isBot) return;
      const contact = bot.contacts[userId];

      const runSteps = useRunStepStore.getState();
      // Capture this run's id: concurrent UI/lark/wizard runs replace the
      // store's global currentRunId, so every step below must target this run
      // explicitly or it will write into (or finish) someone else's run.
      const wechatRunIdValue = runSteps.startRun({
        sessionId: `wechat:${botId}:${userId}`,
        userRequest: lastMsg.text || (lastMsg.images?.length ? '[微信图片消息]' : lastMsg.videos?.length ? '[微信视频消息]' : lastMsg.voice_url ? '[微信语音消息]' : lastMsg.files?.length ? '[微信文件消息]' : '[微信消息]'),
        modelProvider: 'WeChat',
        modelId: 'Kunpeng Agent',
      });
      wechatRunId = wechatRunIdValue;
      runSteps.ensureSystemStep('收到微信消息', `来自 ${userId}`, wechatRunId);

      // Build input that includes text + image/file info so the agent is aware of media
      let userText = lastMsg.text || '';
      if (contact?.isGroup) {
        userText = `[微信群聊消息。会话ID: ${userId}，最新发言人: ${lastMsg.from_user_id}。回复时要默认简洁、避免打扰群聊，除非用户明确要求展开。]\n${userText}`;
      }
      if (lastMsg.images?.length) {
        const imgDesc = lastMsg.images
          .map((p) => `[用户发送了一张图片，本地路径: ${p}。请使用 vision 相关工具识别图片内容后再回复。]`)
          .join('\n');
        userText = userText ? `${imgDesc}\n${userText}` : imgDesc;
      }
      if (lastMsg.files?.length) {
        const fileDesc = lastMsg.files
          .map((f) => `[用户发送了文件: ${f.name}（${f.size} bytes），本地路径: ${f.url}]`)
          .join('\n');
        userText = userText ? `${userText}\n${fileDesc}` : fileDesc;
      }
      if (lastMsg.videos?.length) {
        const vidDesc = lastMsg.videos
          .map((p) => `[用户发送了一个视频，本地路径: ${p}]`)
          .join('\n');
        userText = userText ? `${userText}\n${vidDesc}` : vidDesc;
      }
      if (lastMsg.voice_url) {
        const voiceDesc = lastMsg.voice_text
          ? `[用户发送了一条语音消息，语音转文字内容: "${lastMsg.voice_text}"，本地路径: ${lastMsg.voice_url}]`
          : `[用户发送了一条语音消息，本地路径: ${lastMsg.voice_url}]`;
        userText = userText ? `${userText}\n${voiceDesc}` : voiceDesc;
      }
      console.log('[wechat] agent processing', { botId, userId, inputChars: userText.length });
      runSteps.ensureSystemStep('整理上下文', '合并文本、图片和文件信息，准备交给 Agent 处理。', wechatRunId);

      coordinator.refreshSystemPrompt();

      // Send typing status to WeChat + keep alive every 10s
      invoke('wechat_send_typing', { botId, toUserId: userId, status: 1 }).catch(() => {});
      const typingInterval = setInterval(() => {
        invoke('wechat_send_typing', { botId, toUserId: userId, status: 1 }).catch(() => {});
      }, 10_000);

      const statusKey = `${botId}:${userId}`;
      const setStatus = (stage: 'thinking' | 'tool' | 'generating', toolName?: string) => {
        useWechatStore.setState((s) => ({
          processingStatus: { ...s.processingStatus, [statusKey]: { stage, toolName, startedAt: Date.now() } },
        }));
      };
      const clearStatus = () => {
        useWechatStore.setState((s) => {
          const { [statusKey]: _, ...rest } = s.processingStatus;
          return { processingStatus: rest };
        });
      };
      setStatus('thinking');

      setAgentHeadless(true);
      let reply: string;
      const toolSteps: string[] = [];
      let progressMsgSent = false;
      try {
        reply = await withRemoteAgentTimeout(new Promise<string>((resolve, reject) => {
          const callbacks: CoordinatorCallbacks = {
            onTextDelta: () => { setStatus('generating'); },
            onThinkingDelta: () => { setStatus('thinking'); },
            onToolStart: (name, params) => {
              console.log('[wechat] tool:', name);
              setStatus('tool', name);
              const summary = formatToolSummary(name, params);
              toolSteps.push(summary);
              if (!progressMsgSent) {
                progressMsgSent = true;
                get().sendMessage(botId, userId, '稍等，我查一下...').catch(() => {});
              }
              const id = useRunStepStore.getState().startTool(name, params, wechatRunId);
              if (id) (callbacks as unknown as { __runningToolId?: string }).__runningToolId = id;
            },
            onToolEnd: (_name, result) => {
              setStatus('thinking');
              const id = (callbacks as unknown as { __runningToolId?: string }).__runningToolId ?? null;
              useRunStepStore.getState().finishTool(id, result.success, result, wechatRunId);
            },
            onComplete: (finalText) => { resolve(finalText); },
            onError: (err) => { reject(err); },
            onToolConfirm: async () => true,
            onSubAgentDelta: () => {},
            onCompacting: () => {},
          };
          coordinator.run(userText, callbacks).catch((e) => {
            console.error('[wechat] coordinator.run unhandled rejection:', e);
            reject(e);
          });
        }), () => coordinator.abort());
      } finally {
        persistAgentHistory(botId, userId, coordinator);
        clearInterval(typingInterval);
        clearStatus();
        setAgentHeadless(false);
      }

      if (reply) {
        const plainReply = stripMarkdown(reply);
        console.log('[wechat] agent reply ready', { botId, userId, outputChars: plainReply.length });
        invoke('wechat_send_typing', { botId, toUserId: userId, status: 2 }).catch(() => {});
        if (plainReply) {
          // Prepend tool execution summary so user sees what agent did
          let fullReply = plainReply;
          if (toolSteps.length > 0) {
            const toolSummary = toolSteps.join('、');
            fullReply = `${plainReply}\n\n（以上回复参考了${toolSummary}的结果）`;
          }
          useRunStepStore.getState().ensureSystemStep('发送微信回复', plainReply.slice(0, 180), wechatRunId);
          await get().sendMessage(botId, userId, fullReply);
        }
        useRunStepStore.getState().finishRun('done', wechatRunId);
      } else {
        invoke('wechat_send_typing', { botId, toUserId: userId, status: 2 }).catch(() => {});
        useRunStepStore.getState().finishRun('done', wechatRunId);
      }
    } catch (e) {
      invoke('wechat_send_typing', { botId, toUserId: userId, status: 2 }).catch(() => {});
      const errMsg = e instanceof Error ? e.message : String(e);
      useRunStepStore.getState().ensureSystemStep('微信回复失败', errMsg, wechatRunId);
      useRunStepStore.getState().finishRun('failed', wechatRunId);
      console.error('[wechat] auto-reply error:', e);
      // Surface error to store so user can see it without dev console
      useWechatStore.setState((s) => {
        const bot = s.bots[botId];
        if (!bot) return s;
        return { bots: { ...s.bots, [botId]: { ...bot, lastError: `回复失败: ${errMsg.slice(0, 100)}` } } };
      });
    }
}

function processReplyQueue(get: () => WechatState) {
  while (activeReplyWorkers < MAX_CONCURRENT_REPLIES) {
    const index = replyQueue.findIndex((task) => !activeReplyKeys.has(wechatReplyKey(task)));
    if (index < 0) break;
    const [task] = replyQueue.splice(index, 1);
    const key = wechatReplyKey(task);
    activeReplyWorkers += 1;
    activeReplyKeys.add(key);
    useWechatStore.setState({ replying: true, queueStatus: { active: activeReplyWorkers, pending: replyQueue.length } });
    void processReplyTask(get, task).finally(() => {
      activeReplyWorkers = Math.max(0, activeReplyWorkers - 1);
      activeReplyKeys.delete(key);
      useWechatStore.setState({
        replying: activeReplyWorkers > 0 || replyQueue.length > 0,
        queueStatus: { active: activeReplyWorkers, pending: replyQueue.length },
      });
      evictOldCoordinators();
      processReplyQueue(get);
    });
  }
}

function enqueueReply(botId: string, userId: string, get: () => WechatState, force = false) {
  if (replyQueue.some((item) => item.botId === botId && item.userId === userId)) return;
  replyQueue.push({ botId, userId, force });
  useWechatStore.setState({ queueStatus: { active: activeReplyWorkers, pending: replyQueue.length } });
  processReplyQueue(get);
}

// ── Helper: create empty bot ───────────────────────────────────────────────

function createEmptyBot(id: string): WechatBot {
  return { id, connected: true, polling: false, contacts: {}, messages: {}, nicknames: {}, lastSeenAt: Date.now() };
}

// ── Store ───────────────────────────────────────────────────────────────────

export const useWechatStore = create<WechatState>()((set, get) => ({
  bots: {},
  activeBotId: null,
  selectedContact: null,
  replying: false,
  queueStatus: { active: 0, pending: 0 },
  processingStatus: {},

  qrcodeUrl: null,
  qrcodeToken: null,
  pollBaseUrl: null,
  loginStatus: 'idle',
  loginScanning: false,

  resetLogin: () => {
    set({ qrcodeUrl: null, qrcodeToken: null, pollBaseUrl: null, loginStatus: 'idle', loginScanning: false });
  },

  fetchQrcode: async () => {
    try {
      set({ loginStatus: 'loading' });
      const result = await invoke<{ qrcode: string; qrcode_url: string }>('wechat_get_qrcode');
      set({ qrcodeUrl: result.qrcode_url, qrcodeToken: result.qrcode, pollBaseUrl: null, loginStatus: 'waiting', loginScanning: false });
    } catch (e) {
      console.error('[wechat] fetchQrcode error:', e);
      set({ loginStatus: 'error' });
    }
  },

  pollQrcodeStatus: async () => {
    const { qrcodeToken, pollBaseUrl } = get();
    if (!qrcodeToken) return 'error';
    try {
      const result = await invoke<{
        status: string;
        account_id: string | null;
        bot_token: string | null;
        base_url: string | null;
      }>('wechat_poll_qrcode', {
        qrcode: qrcodeToken,
        baseUrl: pollBaseUrl,
      });

      if (result.status === 'confirmed') {
        const botId = result.account_id || '';
        set((s) => ({
          bots: {
            ...s.bots,
            [botId]: s.bots[botId] || createEmptyBot(botId),
          },
          activeBotId: botId,
          qrcodeUrl: null,
          qrcodeToken: null,
          loginStatus: 'idle',
          loginScanning: false,
        }));
        return 'confirmed';
      }
      if (result.status === 'scaned_but_redirect') {
        set({ pollBaseUrl: result.base_url, loginScanning: true });
        return 'scaned';
      }
      if (result.status === 'expired') {
        set({ loginStatus: 'expired' });
        return 'expired';
      }
      if (result.status === 'scaned') {
        set({ loginScanning: true });
        return 'scaned';
      }
      return 'wait';
    } catch (e) {
      console.error('[wechat] pollQrcodeStatus error:', e);
      return 'error';
    }
  },

  startPolling: async (botId: string) => {
    try {
      await invoke('wechat_start_polling', { botId });
      clearReconnect(botId);
      set((s) => {
        const bot = s.bots[botId];
        if (!bot) return s;
        return { bots: { ...s.bots, [botId]: { ...bot, connected: true, polling: true, reconnecting: false, lastError: undefined, lastSeenAt: Date.now() } } };
      });
    } catch (e) {
      console.error('[wechat] startPolling error:', e);
      set((s) => {
        const bot = s.bots[botId];
        if (!bot) return s;
        return { bots: { ...s.bots, [botId]: { ...bot, connected: false, polling: false, reconnecting: false, lastError: String(e) } } };
      });
      throw e;
    }
  },

  resumeBot: (botId: string) => {
    getCircuitBreaker(botId).reset();
    clearReconnect(botId);
    get().startPolling(botId).catch(() => {
      scheduleReconnect(botId, get, '恢复失败，稍后继续重试');
    });
  },

  stopPolling: async (botId: string) => {
    try {
      clearReconnect(botId);
      await invoke('wechat_stop_polling', { botId });
      set((s) => {
        const bot = s.bots[botId];
        if (!bot) return s;
        return { bots: { ...s.bots, [botId]: { ...bot, polling: false } } };
      });
    } catch (e) {
      console.error('[wechat] stopPolling error:', e);
    }
  },

  disconnect: async (botId: string) => {
    try {
      clearReconnect(botId);
      await invoke('wechat_disconnect', { botId });
      set((s) => {
        const newBots = { ...s.bots };
        delete newBots[botId];
        const remaining = Object.keys(newBots);
        return {
          bots: newBots,
          activeBotId: s.activeBotId === botId ? (remaining[0] || null) : s.activeBotId,
          selectedContact: s.activeBotId === botId ? null : s.selectedContact,
        };
      });
    } catch (e) {
      console.error('[wechat] disconnect error:', e);
    }
  },

  sendMessage: async (botId: string, toUserId: string, text: string) => {
    try {
      if (get().bots[botId]?.contacts[toUserId]?.isGroup) {
        throw new Error('当前微信插件暂不支持群聊发送');
      }
      await invoke('wechat_send_message', { botId, toUserId, text });
      const msg: WechatMessage = {
        from_user_id: 'self',
        to_user_id: toUserId,
        message_id: `local-${Date.now()}`,
        text,
        room_id: '',
        msg_type: 2,
        bot_id: botId,
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
              messages: { ...bot.messages, [toUserId]: [...(bot.messages[toUserId] || []), msg] },
            },
          },
        };
      });
      debounceSaveMessages(get);
    } catch (e) {
      console.error('[wechat] sendMessage error:', e);
      throw e;
    }
  },

  sendFile: async (botId: string, toUserId: string, filePath: string) => {
    try {
      if (get().bots[botId]?.contacts[toUserId]?.isGroup) {
        throw new Error('当前微信插件暂不支持群聊发送文件');
      }
      const result = await invoke<{ is_image: boolean; file_name: string; file_size: number }>('wechat_send_file', { botId, toUserId, filePath });
      const msg: WechatMessage = {
        from_user_id: 'self',
        to_user_id: toUserId,
        message_id: `local-${Date.now()}`,
        text: '',
        room_id: '',
        msg_type: 2,
        bot_id: botId,
        timestamp: Date.now(),
        isBot: true,
        images: result.is_image ? [filePath] : undefined,
        files: result.is_image ? undefined : [{ url: filePath, name: result.file_name, size: result.file_size }],
      };
      set((s) => {
        const bot = s.bots[botId];
        if (!bot) return s;
        return {
          bots: {
            ...s.bots,
            [botId]: {
              ...bot,
              messages: { ...bot.messages, [toUserId]: [...(bot.messages[toUserId] || []), msg] },
            },
          },
        };
      });
      debounceSaveMessages(get);
    } catch (e) {
      console.error('[wechat] sendFile error:', e);
      throw e;
    }
  },

  setActiveBot: (botId) => {
    set({ activeBotId: botId, selectedContact: null });
  },

  setSelectedContact: (userId) => {
    set({ selectedContact: userId });
    if (userId) {
      const { activeBotId } = get();
      if (activeBotId) get().markRead(activeBotId, userId);
    }
  },

  markRead: (botId, userId) => {
    set((s) => {
      const bot = s.bots[botId];
      if (!bot || !bot.contacts[userId]) return s;
      return {
        bots: {
          ...s.bots,
          [botId]: {
            ...bot,
            contacts: { ...bot.contacts, [userId]: { ...bot.contacts[userId], unread: 0 } },
          },
        },
      };
    });
  },

  setNickname: (botId, userId, name) => {
    set((s) => {
      const bot = s.bots[botId];
      if (!bot) return s;
      return {
        bots: {
          ...s.bots,
          [botId]: { ...bot, nicknames: { ...bot.nicknames, [userId]: name } },
        },
      };
    });
    saveNicknames(get().bots);
  },

  setReplyMode: (botId, userId, mode) => {
    set((s) => {
      const bot = s.bots[botId];
      if (!bot) return s;
      const contact = bot.contacts[userId] || { userId, lastMessage: '', lastTime: Date.now(), unread: 0 };
      return {
        bots: {
          ...s.bots,
          [botId]: {
            ...bot,
            contacts: {
              ...bot.contacts,
              [userId]: { ...contact, replyMode: mode },
            },
          },
        },
      };
    });
    saveReplyModes(get().bots);
  },

  addContact: (botId, userId, nickname?) => {
    const trimmedId = userId.trim();
    if (!trimmedId) return;
    const bot = get().bots[botId];
    if (!bot) return;
    if (bot.contacts[trimmedId]) {
      set({ selectedContact: trimmedId });
      if (nickname) get().setNickname(botId, trimmedId, nickname);
      return;
    }
    set((s) => {
      const b = s.bots[botId];
      if (!b) return s;
      return {
        bots: {
          ...s.bots,
          [botId]: {
            ...b,
            contacts: {
              ...b.contacts,
              [trimmedId]: {
                userId: trimmedId,
                lastMessage: '',
                lastTime: Date.now(),
                unread: 0,
                isGroup: trimmedId.includes('room'),
                replyMode: trimmedId.includes('room') ? 'ignore' : 'auto',
              },
            },
          },
        },
        selectedContact: trimmedId,
      };
    });
    if (nickname) get().setNickname(botId, trimmedId, nickname);
    debounceSaveMessages(get);
  },

  triggerAiReply: (botId, userId) => {
    if (get().bots[botId]?.contacts[userId]?.isGroup) return;
    enqueueReply(botId, userId, get, true);
  },

  initListener: async () => {
    if (wechatListenerCleanup) return wechatListenerCleanup;
    if (wechatListenerInitPromise) return wechatListenerInitPromise;

    wechatListenerInitPromise = (async () => {
      const unlisten1 = await listen<WechatMessage>('wechat-message', (event) => {
      const msg = { ...event.payload, timestamp: Date.now() };
      const botId = msg.bot_id;
      const userId = getSessionKey(msg);
      const isGroup = !!msg.room_id;

      if (wechatDedupCache.has(msg.message_id)) return;
      wechatDedupCache.add(msg.message_id);

      set((s) => {
        const bot = s.bots[botId] || createEmptyBot(botId);
        const existingMsgs = bot.messages[userId] || [];
        if (existingMsgs.some((m) => m.message_id === msg.message_id)) return s;

        const contact: WechatContact = bot.contacts[userId] || {
          userId, lastMessage: '', lastTime: 0, unread: 0,
        };
        const replyMode = isGroup ? 'ignore' : (contact.replyMode ?? 'auto');
        const isViewing = s.activeBotId === botId && s.selectedContact === userId;
        const preview = msg.text || (msg.images?.length ? '[图片]' : msg.files?.length ? '[文件]' : '...');
        const capped = existingMsgs.length >= 500 ? [...existingMsgs.slice(-499), msg] : [...existingMsgs, msg];
        return {
          bots: {
            ...s.bots,
            [botId]: {
              ...bot,
              connected: true,
              polling: true,
              reconnecting: false,
              lastError: undefined,
              lastSeenAt: Date.now(),
              messages: { ...bot.messages, [userId]: capped },
              contacts: {
                ...bot.contacts,
                [userId]: {
                  ...contact,
                  isGroup,
                  lastSenderId: msg.from_user_id,
                  replyMode,
                  lastMessage: preview,
                  lastTime: msg.timestamp,
                  unread: isViewing ? 0 : contact.unread + 1,
                },
              },
            },
          },
        };
      });

      debounceSaveMessages(get);

      const mode = defaultReplyModeForContact(get().bots[botId]?.contacts[userId]);
      if (mode === 'auto' && (msg.text || msg.images?.length || msg.files?.length)) {
        const debounceKey = `${botId}:${userId}`;
        if (replyDebounceTimers[debounceKey]) clearTimeout(replyDebounceTimers[debounceKey]);
        replyDebounceTimers[debounceKey] = setTimeout(() => {
          delete replyDebounceTimers[debounceKey];
          enqueueReply(botId, userId, get);
        }, 3000);
      }
      });

      const unlisten2 = await listen<string | { bot_id?: string; reason?: string }>('wechat-disconnected', (event) => {
        const payload = event.payload;
        const botId = typeof payload === 'string' ? payload : payload.bot_id;
        if (!botId) return;
        const reason = typeof payload === 'string' ? undefined : payload.reason;
        scheduleReconnect(botId, get, reason || '微信连接已断开，正在自动恢复');
      });

      const unlisten3 = await listen<string>('wechat-session-expired', (event) => {
        const botId = event.payload;
        clearReconnect(botId);
        console.warn('[wechat] session expired for', botId, '— removing from store');
        set((s) => {
          const newBots = { ...s.bots };
          delete newBots[botId];
          const remaining = Object.keys(newBots);
          return {
            bots: newBots,
            activeBotId: s.activeBotId === botId ? (remaining[0] || null) : s.activeBotId,
            selectedContact: s.activeBotId === botId ? null : s.selectedContact,
          };
        });
      });

      const unlisten4 = await listen<WechatStatusEvent>('wechat-status', (event) => {
        const status = event.payload;
        set((s) => {
          const bot = s.bots[status.bot_id];
          if (!bot) return s;
          const healthy = status.state === 'connected';
          return {
            bots: {
              ...s.bots,
              [status.bot_id]: {
                ...bot,
                connected: healthy,
                polling: true,
                reconnecting: !healthy,
                lastError: healthy ? undefined : (status.message || '网络波动，后台正在恢复'),
                lastSeenAt: healthy ? Date.now() : bot.lastSeenAt,
              },
            },
          };
        });
      });

      const healthTimer = window.setInterval(() => {
        invoke<{ bots: { account_id: string; polling: boolean }[]; connected: boolean }>('wechat_get_status')
          .then((status) => {
            const rustPolling = new Map(status.bots.map((b) => [b.account_id, b.polling]));
            const bots = get().bots;
            for (const [botId, bot] of Object.entries(bots)) {
              if (!rustPolling.has(botId)) continue;
              if (!rustPolling.get(botId) && bot.connected && !bot.reconnecting) {
                scheduleReconnect(botId, get, '轮询已停止，正在自动恢复');
              }
            }
          })
          .catch(() => {});
      }, 15_000);

      const cleanup = () => {
        unlisten1();
        unlisten2();
        unlisten3();
        unlisten4();
        window.clearInterval(healthTimer);
        if (wechatListenerCleanup === cleanup) wechatListenerCleanup = null;
        wechatListenerInitPromise = null;
      };
      wechatListenerCleanup = cleanup;
      return cleanup;
    })().catch((error) => {
      wechatListenerInitPromise = null;
      throw error;
    });

    return wechatListenerInitPromise;
  },

  restoreSession: async () => {
    if ((useWechatStore as unknown as { _restored?: boolean })._restored) return;
    (useWechatStore as unknown as { _restored?: boolean })._restored = true;
    try {
      // Load persisted data
      const [savedMsgs, savedNicknames, savedReplyModes] = await Promise.all([
        loadData<Record<string, { messages: Record<string, WechatMessage[]>; contacts: Record<string, WechatContact> }>>('messages'),
        loadData<Record<string, Record<string, string>>>('nicknames'),
        loadData<Record<string, Record<string, WechatReplyMode>>>('reply-modes'),
      ]);

      // Restore session from Rust
      const result = await invoke<{ restored: boolean; bots?: { account_id: string }[] }>('wechat_restore_session');

      if (result.restored && result.bots) {
        const newBots: Record<string, WechatBot> = {};
        for (const b of result.bots) {
          const id = b.account_id;
          const saved = savedMsgs?.[id];
          // Also try old format (non-per-bot)
          const contacts = saved?.contacts || {};
          const modes = savedReplyModes?.[id] || {};
          for (const [userId, mode] of Object.entries(modes)) {
            contacts[userId] = contacts[userId]
              ? { ...contacts[userId], replyMode: mode }
              : { userId, lastMessage: '', lastTime: Date.now(), unread: 0, replyMode: mode };
          }
          newBots[id] = {
            id,
            connected: true,
            polling: false,
            contacts,
            messages: saved?.messages || {},
            nicknames: savedNicknames?.[id] || {},
          };
        }

        // If old format data exists (not keyed by bot id), try to migrate
        if (!savedMsgs && savedNicknames === null) {
          // Try loading old single-bot format
          const oldMsgs = await loadData<{ messages: Record<string, WechatMessage[]>; contacts: Record<string, WechatContact> }>('messages');
          if (oldMsgs?.messages) {
            const firstBot = result.bots[0];
            if (firstBot && newBots[firstBot.account_id]) {
              newBots[firstBot.account_id].messages = oldMsgs.messages;
              newBots[firstBot.account_id].contacts = oldMsgs.contacts || {};
            }
          }
          const oldNick = await loadData<Record<string, string>>('nicknames');
          if (oldNick && typeof Object.values(oldNick)[0] === 'string') {
            const firstBot = result.bots[0];
            if (firstBot && newBots[firstBot.account_id]) {
              newBots[firstBot.account_id].nicknames = oldNick;
            }
          }
        }

        const botIds = Object.keys(newBots);
        set({
          bots: newBots,
          activeBotId: botIds[0] || null,
        });

        // Start polling for all bots
        for (const id of botIds) {
          get().startPolling(id).catch(() => {
            scheduleReconnect(id, get, '恢复会话后启动轮询失败，正在重试');
          });
        }
      }
    } catch (e) {
      (useWechatStore as unknown as { _restored?: boolean })._restored = false;
      console.error('[wechat] restoreSession error:', e);
    }
  },
}));
