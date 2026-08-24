import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { readTextFile, exists, BaseDirectory } from '@tauri-apps/api/fs';
import { invoke } from '@tauri-apps/api/tauri';
import { safeLocalStorage } from '@/lib/safeStorage';
import { migrateLegacyCredentials, type Credential } from '@/lib/credentials';
import type { ArkModelsCache } from '@/lib/channels/arkModels';
import type { AgentMeta } from '@/types/agent';

/** 生图 API 提供商 */
export type ImageProvider = 'dmxapi' | 'aihubmix' | 'zexapi';

/** 固化的提供商信息 */
export const IMAGE_PROVIDERS: Record<ImageProvider, { label: string; baseUrl: string }> = {
  dmxapi: { label: 'DMXAPI', baseUrl: 'https://www.dmxapi.cn' },
  aihubmix: { label: 'AiHubMix', baseUrl: 'https://api.inferera.com' },
  zexapi: { label: 'ZexAPI', baseUrl: 'https://zexapi.com' },
};

// Dreamina CLI v1.4.12+ exposes Seedream 5.0 Pro as model_version=5.0Pro.
// It is part of the shared Seedream route and uses the local OAuth login.

export const OMNI_ZEXAPI_BASE_URL = 'https://zexapi.com';
export const OMNI_DEFAULT_BASE_URL = 'https://api.apimart.ai';
export const OMNI_DEFAULT_FALLBACK_BASE_URLS = [
  'https://apib.ai',
  'https://aiuxu.com',
  'https://aishuch.com',
];
export const OMNI_DEFAULT_CREDIT_PRICE_PER_10 = 7;

/** 生图 API 槽位 */
export interface ImageApiSlot {
  id: string;
  label: string;
  provider: ImageProvider;
  baseUrl: string;
  /** @deprecated 兼容路径：优先用 credentialId 引用凭证注册表，apiKey 仅作回退。 */
  apiKey: string;
  /** 引用凭证注册表（settingsStore.credentials）中的凭证；读取时优先于 apiKey。 */
  credentialId?: string;
  enabled: boolean;
  priority: number;
  mode?: 'text-to-image' | 'image-to-image';
  tier?: 'cheap' | 'standard';
}

/**
 * 旧 key setter 的写透镜像：该能力若已挂凭证引用，把新 key 同步写进凭证，
 * 保证无论从「API 凭证」页还是旧字段入口修改，所有消费方都读到同一份。
 */
function mirrorCredentialWrite(
  state: { credentials: Credential[]; credentialRefs: Record<string, string> },
  cap: string,
  apiKey: string,
): { credentials?: Credential[] } {
  const refId = state.credentialRefs?.[cap];
  if (!refId) return {};
  let changed = false;
  const credentials = state.credentials.map((c) => {
    if (c.id !== refId || c.apiKey === apiKey) return c;
    changed = true;
    return { ...c, apiKey };
  });
  return changed ? { credentials } : {};
}

// ── Tauri file-system storage adapter ─────────────────────────────────────────
// Primary: localStorage (synchronous, guarantees hydration completes)
// Secondary: file at ~/.kunpeng/settings.json (survives app restart)
// On load: localStorage first; if empty, async recover from file + rehydrate.

const SETTINGS_REL_PATH = '.kunpeng/settings.json';
const LS_KEY = 'kunpeng-settings';

async function readFileSettings(): Promise<string | null> {
  try {
    const fileExists = await exists(SETTINGS_REL_PATH, { dir: BaseDirectory.Home });
    if (!fileExists) return null;
    return await readTextFile(SETTINGS_REL_PATH, { dir: BaseDirectory.Home });
  } catch (err) {
    console.warn('[settingsStore] file read failed:', err);
    return null;
  }
}

async function writeFileSettings(value: string): Promise<void> {
  try {
    // Owner-only (0600) write: settings.json carries every API key.
    await invoke('write_text_file_private', { path: SETTINGS_REL_PATH, contents: value });
  } catch (err) {
    console.error('[settingsStore] file write failed:', err);
  }
}

// StateStorage implementation: localStorage + async file mirror
//
// Race guard: on a cold start localStorage can be empty (dev vs prod app use
// different WebView origins) while settings.json has the real keys. If any
// store setter fires before the async file recovery lands, the old code
// wrote the EMPTY state straight over settings.json — wiping the user's
// API keys. File writes now wait for recovery to finish and always persist
// the freshest localStorage value.
let fileRecovery: Promise<void> = Promise.resolve();
let fileWriteQueue: Promise<void> = Promise.resolve();

const hybridStateStorage: StateStorage = {
  getItem: (name: string): string | null => {
    const lsValue = localStorage.getItem(name);

    // Async: recover from file if localStorage is empty (e.g. after app restart)
    fileRecovery = readFileSettings().then((fileValue) => {
      if (fileValue && fileValue !== lsValue) {
        // File wins only when localStorage has nothing meaningful yet —
        // otherwise the in-memory session (newer) is the source of truth.
        if (!lsValue) {
          safeLocalStorage.setItem(name, fileValue);
          useSettingsStore.persist.rehydrate();
        }
      }
    }).catch(() => {});

    return lsValue;
  },
  setItem: (name: string, value: string): void => {
    // safeLocalStorage：settings 是最关键的键（API keys），quota 满时先清
    // 可再生缓存腾位再写，绝不能静默丢失。
    safeLocalStorage.setItem(name, value);
    // Defer the file mirror until recovery completed, then write the
    // CURRENT localStorage value (post-rehydrate, includes recovered keys).
    fileWriteQueue = fileWriteQueue
      .then(() => fileRecovery)
      .then(() => writeFileSettings(localStorage.getItem(name) ?? value))
      .catch(() => {});
  },
  removeItem: (name: string): void => {
    localStorage.removeItem(name);
  },
};

// ── Store ──────────────────────────────────────────────────────────────────────

interface SettingsState {
  // Setup wizard
  setupComplete: boolean;
  setSetupComplete: (complete: boolean) => void;
  /** 用户主动跳过初始引导；true 时不再自动弹向导，设置页显示补配横幅。 */
  setupSkipped: boolean;
  setSetupSkipped: (skipped: boolean) => void;
  /** 引导向导浮层开关（设置页横幅可重新打开）。 */
  wizardOpen: boolean;
  setWizardOpen: (open: boolean) => void;

  // Agent metadata (dynamic, user-configurable)
  agentMetas: Record<string, AgentMeta>;
  setAgentMeta: (agentId: string, meta: AgentMeta) => void;
  setAllAgentMetas: (metas: Record<string, AgentMeta>) => void;

  // Session titles generated locally (persisted, set once per session)
  sessionTitles: Record<string, string>;
  setSessionTitle: (sessionId: string, title: string) => void;

  // Client-side deleted session IDs (persisted so they survive page reload)
  deletedSessionIds: string[];
  addDeletedSessionId: (id: string) => void;

  // Sound
  soundEnabled: boolean;
  soundVolume: number;
  setSoundEnabled: (enabled: boolean) => void;
  setSoundVolume: (volume: number) => void;

  // Agent Engine (鲲鹏)
  glmApiKey: string;
  glmBaseUrl: string;
  glmModel: string;
  defaultCwd: string;
  maxTurns: number;
  setGlmApiKey: (key: string) => void;
  setGlmBaseUrl: (url: string) => void;
  setGlmModel: (model: string) => void;
  setDefaultCwd: (cwd: string) => void;
  setMaxTurns: (turns: number) => void;

  // UI
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  // Agent 工具确认模式：manual=危险操作弹窗确认；auto=跳过确认直接执行
  toolConfirmMode: 'manual' | 'auto';
  setToolConfirmMode: (m: 'manual' | 'auto') => void;

  // Agent
  defaultAgentId: string | null;
  setDefaultAgentId: (id: string | null) => void;

  // Theme
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;

  // API Keys
  geminiApiKey: string;
  setGeminiApiKey: (key: string) => void;
  dmxApiKey: string;
  setDmxApiKey: (key: string) => void;
  bananaProApiKey: string;
  setBananaProApiKey: (key: string) => void;
  arkApiKey: string;
  setArkApiKey: (key: string) => void;
  /** Ark 模型列表本地缓存（设置页「同步模型列表」写入；null = 未同步过，回退静态注册表） */
  arkModelsCache: ArkModelsCache | null;
  setArkModelsCache: (cache: ArkModelsCache | null) => void;
  happyHorseBaseUrl: string;
  happyHorseApiKey: string;
  setHappyHorseBaseUrl: (url: string) => void;
  setHappyHorseApiKey: (key: string) => void;
  runninghubApiKey: string;
  setRunninghubApiKey: (key: string) => void;
  /** RunningHub 站点：cn=国内站（runninghub.cn，默认）、ai=国际站（runninghub.ai）。两站账号与 Key 互不通用。 */
  runninghubSite: 'cn' | 'ai';
  setRunninghubSite: (site: 'cn' | 'ai') => void;
  /** RunningHub 国际站 API Key（runninghub.ai），仅在 runninghubSite='ai' 时使用。 */
  runninghubIntlApiKey: string;
  setRunninghubIntlApiKey: (key: string) => void;
  kuaiziApiKey: string;
  setKuaiziApiKey: (key: string) => void;
  useRhtvSeedance: boolean;
  setUseRhtvSeedance: (enabled: boolean) => void;
  /** Seedance 2.0 通道选择：kuaizi=筷子丽帧（默认）；runninghub=RHTV；ark=火山方舟。
   *  取代旧的 useRhtvSeedance 布尔（v31 迁移保留原选择）。 */
  seedanceEngine: 'kuaizi' | 'runninghub' | 'ark';
  setSeedanceEngine: (engine: 'kuaizi' | 'runninghub' | 'ark') => void;
  /** MiniMax H3 渠道偏好：auto=按健康度自动容灾（默认）；runninghub/apimart/kuaizi=优先该渠道，失败仍容灾其余渠道。 */
  minimaxH3Channel: 'auto' | 'runninghub' | 'apimart' | 'kuaizi';
  setMinimaxH3Channel: (channel: 'auto' | 'runninghub' | 'apimart' | 'kuaizi') => void;
  /** 万相 3.0 渠道偏好：auto=筷子主渠道按健康度容灾（默认）；其余=优先该渠道，失败仍容灾剩余渠道。 */
  wan3Channel: 'auto' | 'kuaizi' | 'runninghub' | 'apimart';
  setWan3Channel: (channel: 'auto' | 'kuaizi' | 'runninghub' | 'apimart') => void;
  kimiEditModel: string;
  setKimiEditModel: (model: string) => void;
  kimiEditUseCos: boolean;
  setKimiEditUseCos: (enabled: boolean) => void;
  doubaoSpeechApiKey: string;
  setDoubaoSpeechApiKey: (key: string) => void;
  // 配音通道：true=筷子丽帧 seed_audio 优先（失败自动回退豆包官方）；false=豆包官方
  speechKuaiziFirst: boolean;
  setSpeechKuaiziFirst: (enabled: boolean) => void;
  omniApiKey: string;
  omniZeroFallApiKey: string;
  omniApimartApiKey: string;
  omniBaseUrl: string;
  omniFallbackBaseUrls: string[];
  omniCreditPricePer10: number;
  setOmniApiKey: (key: string) => void;
  setOmniZeroFallApiKey: (key: string) => void;
  setOmniApimartApiKey: (key: string) => void;
  setOmniBaseUrl: (url: string) => void;
  setOmniFallbackBaseUrls: (urls: string[]) => void;
  setOmniCreditPricePer10: (price: number) => void;

  // Tencent COS
  cosBucket: string;
  cosRegion: string;
  cosSecretId: string;
  cosSecretKey: string;
  cosTransitEndpoint: string;
  setCosBucket: (v: string) => void;
  setCosRegion: (v: string) => void;
  setCosSecretId: (v: string) => void;
  setCosSecretKey: (v: string) => void;
  setCosTransitEndpoint: (v: string) => void;

  // Optional display name used in greetings (「你好！」 when empty).
  // Private builds can preset it via private.defaults.json (gitignored).
  greetingName: string;
  setGreetingName: (v: string) => void;

  // Unread tracking (persisted)
  sessionLastReadAt: Record<string, number>;
  markSessionRead: (sessionId: string) => void;

  // Multi-provider (Tier 1.5) — keyed by provider id (`glm`, `deepseek`, ...)
  providerApiKeys: Record<string, string>;
  setProviderApiKey: (providerId: string, key: string) => void;
  // Per-provider base URL + model overrides (empty = provider's default).
  providerBaseUrls: Record<string, string>;
  providerModels: Record<string, string>;
  setProviderBaseUrl: (providerId: string, url: string) => void;
  setProviderModel: (providerId: string, model: string) => void;
  // Main DeepSeek Agent engine only. Other providers always keep the
  // existing coordinator implementation.
  deepseekEngine: 'harness' | 'builtin';
  setDeepseekEngine: (engine: SettingsState['deepseekEngine']) => void;
  // Default provider id + ordered fallback chain; router consumes these.
  providerDefault: string;
  providerFallbackChain: string[];
  setProviderDefault: (id: string) => void;
  setProviderFallbackChain: (chain: string[]) => void;
  // Optional per-workspace LLM override. Missing/"global" inherits the global
  // providerDefault + providerModels selection.
  workspaceAgentModels: Record<'canvas' | 'workshop' | 'editor', string>;
  setWorkspaceAgentModel: (scope: 'canvas' | 'workshop' | 'editor', selection: string) => void;

  // Composer model preferences. These guide normal-chat generation tools;
  // canvas/workshop nodes keep their own per-node model settings.
  chatImageModel: 'gpt-image-2' | 'seedream-v5-pro' | 'midjourney-v81' | 'midjourney-v82';
  chatVideoModel: 'seedance-2.0' | 'seedance-2.0-fast' | 'seedance-2.0-mini' | 'seedance-2.5' | 'minimax-h3' | 'omni-mg-animation' | 'wan-3.0';
  setChatImageModel: (model: SettingsState['chatImageModel']) => void;
  setChatVideoModel: (model: SettingsState['chatVideoModel']) => void;

  // Tier 4: Output style & UX
  outputStyle: 'default' | 'concise' | 'verbose' | 'coding';
  setOutputStyle: (style: SettingsState['outputStyle']) => void;
  notificationsEnabled: boolean;
  setNotificationsEnabled: (enabled: boolean) => void;
  // 联网搜索开关（默认关闭；开启后 web_search 工具才暴露给模型）
  webSearchEnabled: boolean;
  setWebSearchEnabled: (enabled: boolean) => void;

  // 生图 API 槽位（多 API 降级链）
  imageApiSlots: ImageApiSlot[];
  setImageApiSlots: (slots: ImageApiSlot[]) => void;
  // 测速缓存（slotId → {latencyMs, testedAt}）
  imageApiLatency: Record<string, { latencyMs: number; testedAt: number }>;
  setImageApiLatency: (id: string, latencyMs: number) => void;

  // ── 凭证注册表（API Key 单一事实源）──
  // 旧平铺 key 字段全部保留作 resolver 回退；读侧经 resolveApiKey/resolveSlotApiKey。
  credentials: Credential[];
  /** capability → credentialId。capability 取值：'dmx'/'ark'/.../'cos'、'provider:<id>'。 */
  credentialRefs: Record<string, string>;
  upsertCredential: (cred: Credential) => void;
  removeCredential: (id: string) => void;
  setCredentialRef: (cap: string, credentialId: string | null) => void;

}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      // Setup wizard
      setupComplete: false,
      setSetupComplete: (setupComplete) => set({ setupComplete }),
      setupSkipped: false,
      setSetupSkipped: (setupSkipped) => set({ setupSkipped }),
      wizardOpen: false,
      setWizardOpen: (wizardOpen) => set({ wizardOpen }),

      // Agent metadata
      agentMetas: {},
      setAgentMeta: (agentId, meta) =>
        set((state) => ({ agentMetas: { ...state.agentMetas, [agentId]: meta } })),
      setAllAgentMetas: (agentMetas) => set({ agentMetas }),

      // Session titles
      sessionTitles: {},
      setSessionTitle: (sessionId, title) =>
        set((state) => ({ sessionTitles: { ...state.sessionTitles, [sessionId]: title } })),

      // Deleted sessions (client-side soft-delete)
      deletedSessionIds: [],
      addDeletedSessionId: (id) =>
        set((state) => ({
          deletedSessionIds: state.deletedSessionIds.includes(id)
            ? state.deletedSessionIds
            : [...state.deletedSessionIds, id],
        })),

      // Sound
      soundEnabled: true,
      soundVolume: 0.5,
      setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
      setSoundVolume: (soundVolume) => set({ soundVolume }),

      // Agent Engine (鲲鹏)
      glmApiKey: '',
      glmBaseUrl: 'https://open.bigmodel.cn/api/anthropic',
      glmModel: 'glm-5.3',
      defaultCwd: '',
      maxTurns: 30,
      setGlmApiKey: (glmApiKey) => set((s) => ({ glmApiKey, ...mirrorCredentialWrite(s, 'glm', glmApiKey) })),
      setGlmBaseUrl: (glmBaseUrl) => set({ glmBaseUrl }),
      setGlmModel: (glmModel) => set({ glmModel }),
      setDefaultCwd: (defaultCwd) => set({ defaultCwd }),
      setMaxTurns: (maxTurns) => set({ maxTurns }),

      // UI
      sidebarCollapsed: false,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      toolConfirmMode: 'manual' as const,
      setToolConfirmMode: (m) => set({ toolConfirmMode: m }),

      // Agent
      defaultAgentId: null,
      setDefaultAgentId: (defaultAgentId) => set({ defaultAgentId }),

      // Theme
      theme: 'light',
      setTheme: (theme) => set({ theme }),

      // API Keys（旧字段 deprecated：保留作 resolver 回退；写时镜像到凭证注册表）
      geminiApiKey: '',
      setGeminiApiKey: (geminiApiKey) => set((s) => ({ geminiApiKey, ...mirrorCredentialWrite(s, 'gemini', geminiApiKey) })),
      dmxApiKey: '',
      setDmxApiKey: (dmxApiKey) => set((s) => ({ dmxApiKey, ...mirrorCredentialWrite(s, 'dmx', dmxApiKey) })),
      bananaProApiKey: '',
      setBananaProApiKey: (bananaProApiKey) => set((s) => ({ bananaProApiKey, ...mirrorCredentialWrite(s, 'bananaPro', bananaProApiKey) })),
      arkApiKey: '',
      setArkApiKey: (arkApiKey) => set((s) => ({ arkApiKey, ...mirrorCredentialWrite(s, 'ark', arkApiKey) })),
      arkModelsCache: null,
      setArkModelsCache: (arkModelsCache) => set({ arkModelsCache }),
      happyHorseBaseUrl: '',
      happyHorseApiKey: '',
      setHappyHorseBaseUrl: (happyHorseBaseUrl) => set({ happyHorseBaseUrl }),
      setHappyHorseApiKey: (happyHorseApiKey) => set((s) => ({ happyHorseApiKey, ...mirrorCredentialWrite(s, 'happyHorse', happyHorseApiKey) })),
      runninghubApiKey: '',
      setRunninghubApiKey: (runninghubApiKey) => set((s) => ({ runninghubApiKey, ...mirrorCredentialWrite(s, 'runninghub', runninghubApiKey) })),
      runninghubSite: 'cn',
      setRunninghubSite: (runninghubSite) => set({ runninghubSite }),
      runninghubIntlApiKey: '',
      setRunninghubIntlApiKey: (runninghubIntlApiKey) => set((s) => ({ runninghubIntlApiKey, ...mirrorCredentialWrite(s, 'runninghubIntl', runninghubIntlApiKey) })),
      kuaiziApiKey: '',
      setKuaiziApiKey: (kuaiziApiKey) => set((s) => ({ kuaiziApiKey, ...mirrorCredentialWrite(s, 'kuaizi', kuaiziApiKey) })),
      useRhtvSeedance: false,
      setUseRhtvSeedance: (useRhtvSeedance) => set({ useRhtvSeedance }),
      seedanceEngine: 'kuaizi',
      setSeedanceEngine: (seedanceEngine) => set({ seedanceEngine }),
      minimaxH3Channel: 'auto',
      setMinimaxH3Channel: (minimaxH3Channel) => set({ minimaxH3Channel }),
      wan3Channel: 'auto',
      setWan3Channel: (wan3Channel) => set({ wan3Channel }),
      kimiEditModel: '',
      setKimiEditModel: (kimiEditModel) => set({ kimiEditModel }),
      kimiEditUseCos: true,
      setKimiEditUseCos: (kimiEditUseCos) => set({ kimiEditUseCos }),
      doubaoSpeechApiKey: '',
      setDoubaoSpeechApiKey: (doubaoSpeechApiKey) => set((s) => ({ doubaoSpeechApiKey, ...mirrorCredentialWrite(s, 'doubaoSpeech', doubaoSpeechApiKey) })),
      speechKuaiziFirst: true,
      setSpeechKuaiziFirst: (speechKuaiziFirst) => set({ speechKuaiziFirst }),
      omniApiKey: '',
      omniZeroFallApiKey: '',
      omniApimartApiKey: '',
      omniBaseUrl: OMNI_DEFAULT_BASE_URL,
      omniFallbackBaseUrls: OMNI_DEFAULT_FALLBACK_BASE_URLS,
      omniCreditPricePer10: OMNI_DEFAULT_CREDIT_PRICE_PER_10,
      setOmniApiKey: (omniApiKey) => set((s) => ({ omniApiKey, ...mirrorCredentialWrite(s, 'omni', omniApiKey) })),
      setOmniZeroFallApiKey: (omniZeroFallApiKey) => set((s) => ({ omniZeroFallApiKey, ...mirrorCredentialWrite(s, 'omniZeroFall', omniZeroFallApiKey) })),
      setOmniApimartApiKey: (omniApimartApiKey) => set((s) => ({ omniApimartApiKey, ...mirrorCredentialWrite(s, 'omniApimart', omniApimartApiKey) })),
      setOmniBaseUrl: (omniBaseUrl) => set({ omniBaseUrl }),
      setOmniFallbackBaseUrls: (omniFallbackBaseUrls) => set({ omniFallbackBaseUrls }),
      setOmniCreditPricePer10: (omniCreditPricePer10) => set({ omniCreditPricePer10 }),

      // Tencent COS
      cosBucket: '',
      cosRegion: 'ap-guangzhou',
      cosSecretId: '',
      cosSecretKey: '',
      cosTransitEndpoint: '',
      setCosBucket: (cosBucket) => set({ cosBucket }),
      setCosRegion: (cosRegion) => set({ cosRegion }),
      // COS 凭证以 `SecretId:SecretKey` 合并存储，写两侧都镜像合成值
      setCosSecretId: (cosSecretId) => set((s) => ({
        cosSecretId,
        ...mirrorCredentialWrite(s, 'cos', `${cosSecretId}:${s.cosSecretKey}`),
      })),
      setCosSecretKey: (cosSecretKey) => set((s) => ({
        cosSecretKey,
        ...mirrorCredentialWrite(s, 'cos', `${s.cosSecretId}:${cosSecretKey}`),
      })),
      setCosTransitEndpoint: (cosTransitEndpoint) => set({ cosTransitEndpoint }),
      greetingName: '',
      setGreetingName: (greetingName) => set({ greetingName }),

      // Unread tracking
      sessionLastReadAt: {},
      markSessionRead: (sessionId) =>
        set((state) => ({
          sessionLastReadAt: { ...state.sessionLastReadAt, [sessionId]: Date.now() },
        })),

      // Multi-provider (Tier 1.5)
      providerApiKeys: {},
      setProviderApiKey: (providerId, key) =>
        set((state) => ({
          providerApiKeys: { ...state.providerApiKeys, [providerId]: key },
          ...mirrorCredentialWrite(state, `provider:${providerId}`, key),
        })),
      providerBaseUrls: {},
      providerModels: {},
      setProviderBaseUrl: (providerId, url) =>
        set((state) => ({
          providerBaseUrls: { ...state.providerBaseUrls, [providerId]: url },
        })),
      setProviderModel: (providerId, model) =>
        set((state) => ({
          providerModels: { ...state.providerModels, [providerId]: model },
        })),
      deepseekEngine: 'harness',
      setDeepseekEngine: (deepseekEngine) => set({ deepseekEngine }),
      providerDefault: 'deepseek',
      providerFallbackChain: ['deepseek', 'glm'],
      setProviderDefault: (providerDefault) => set({ providerDefault }),
      setProviderFallbackChain: (providerFallbackChain) => set({ providerFallbackChain }),
      workspaceAgentModels: {
        canvas: 'global',
        workshop: 'global',
        editor: 'global',
      },
      setWorkspaceAgentModel: (scope, selection) =>
        set((state) => ({
          workspaceAgentModels: { ...state.workspaceAgentModels, [scope]: selection },
        })),
      chatImageModel: 'gpt-image-2',
      chatVideoModel: 'seedance-2.0',
      setChatImageModel: (chatImageModel) => set({ chatImageModel }),
      setChatVideoModel: (chatVideoModel) => set({ chatVideoModel }),

      // Tier 4
      outputStyle: 'default',
      setOutputStyle: (outputStyle) => set({ outputStyle }),
      notificationsEnabled: true,
      setNotificationsEnabled: (notificationsEnabled) => set({ notificationsEnabled }),
      webSearchEnabled: false,
      setWebSearchEnabled: (webSearchEnabled) => set({ webSearchEnabled }),

      // 生图 API 槽位
      imageApiSlots: [],
      setImageApiSlots: (imageApiSlots) =>
        set((state) => {
          // 槽位挂了 credentialId 时，把内联 apiKey 的修改镜像写回凭证
          let credentials = state.credentials;
          let changed = false;
          for (const slot of imageApiSlots) {
            if (!slot.credentialId) continue;
            const idx = credentials.findIndex((c) => c.id === slot.credentialId);
            if (idx >= 0 && credentials[idx].apiKey !== slot.apiKey) {
              if (!changed) { credentials = [...credentials]; changed = true; }
              credentials[idx] = { ...credentials[idx], apiKey: slot.apiKey };
            }
          }
          return changed ? { imageApiSlots, credentials } : { imageApiSlots };
        }),
      imageApiLatency: {},
      setImageApiLatency: (id, latencyMs) =>
        set((state) => ({
          imageApiLatency: {
            ...state.imageApiLatency,
            [id]: { latencyMs, testedAt: Date.now() },
          },
        })),

      // 凭证注册表
      credentials: [],
      credentialRefs: {},
      upsertCredential: (cred) =>
        set((state) => ({
          credentials: state.credentials.some((c) => c.id === cred.id)
            ? state.credentials.map((c) => (c.id === cred.id ? cred : c))
            : [...state.credentials, cred],
        })),
      removeCredential: (id) =>
        set((state) => ({
          credentials: state.credentials.filter((c) => c.id !== id),
          // 摘掉所有引用，resolver 自动回退旧字段，删除凭证不会造成能力失效
          credentialRefs: Object.fromEntries(
            Object.entries(state.credentialRefs).filter(([, refId]) => refId !== id),
          ),
          imageApiSlots: state.imageApiSlots.map((slot) =>
            slot.credentialId === id ? { ...slot, credentialId: undefined } : slot,
          ),
        })),
      setCredentialRef: (cap, credentialId) =>
        set((state) => {
          const credentialRefs = { ...state.credentialRefs };
          if (credentialId) credentialRefs[cap] = credentialId;
          else delete credentialRefs[cap];
          return { credentialRefs };
        }),

    }),
    {
      name: LS_KEY,
      storage: createJSONStorage(() => hybridStateStorage),
      version: 32,
      migrate: (persistedState: unknown, version: number) => {
        const state = persistedState as Partial<SettingsState>;
        let result = { ...state } as any;
        if (version <= 4) {
          delete result.openclawPath;
          delete result.gatewayUrl;
          delete result.gatewayToken;
          result.glmApiKey = result.glmApiKey ?? '';
          result.glmBaseUrl = result.glmBaseUrl ?? 'https://open.bigmodel.cn/api/anthropic';
          result.glmModel = result.glmModel ?? 'glm-5.1';
          result.defaultCwd = result.defaultCwd ?? '';
          result.maxTurns = result.maxTurns ?? 30;
        }
        if (version <= 6) {
          // v6 → v7: switch to Anthropic Messages API endpoint (Claude Code compatible)
          const OLD_URLS = [
            'https://open.bigmodel.cn/api/paas/v4',
            'https://open.bigmodel.cn/api/coding/paas/v4',
          ];
          if (!result.glmBaseUrl || OLD_URLS.includes(result.glmBaseUrl)) {
            result.glmBaseUrl = 'https://open.bigmodel.cn/api/anthropic';
          }
        }
        if (version <= 7) {
          // v7 → v8: seed multi-provider map from the existing single glmApiKey
          // so existing users don't have to re-paste.
          result.providerApiKeys = result.providerApiKeys ?? {};
          if (result.glmApiKey && !result.providerApiKeys.glm) {
            result.providerApiKeys.glm = result.glmApiKey;
          }
          result.providerDefault = result.providerDefault ?? 'glm';
          result.providerFallbackChain = result.providerFallbackChain ?? ['glm', 'deepseek'];
        }
        if (version <= 8) {
          // v8 → v9: seed per-provider baseUrl/model from legacy glm fields
          result.providerBaseUrls = result.providerBaseUrls ?? {};
          result.providerModels = result.providerModels ?? {};
          if (result.glmBaseUrl && !result.providerBaseUrls.glm) {
            result.providerBaseUrls.glm = result.glmBaseUrl;
          }
          if (result.glmModel && !result.providerModels.glm) {
            result.providerModels.glm = result.glmModel;
          }
        }
        if (version <= 9) {
          // v9 → v10: seed imageApiSlots from existing dmxApiKey
          result.imageApiSlots = result.imageApiSlots ?? [];
          result.imageApiLatency = result.imageApiLatency ?? {};
          if (result.dmxApiKey && result.imageApiSlots.length === 0) {
            result.imageApiSlots = [{
              id: 'dmxapi-default',
              label: 'DMXAPI',
              provider: 'dmxapi' as ImageProvider,
              baseUrl: 'https://www.dmxapi.cn',
              apiKey: result.dmxApiKey,
              enabled: true,
              priority: 0,
            }];
          }
        }
        if (version <= 10) {
          // v10 → v11: add HappyHorse fields
          result.happyHorseBaseUrl = result.happyHorseBaseUrl ?? '';
          result.happyHorseApiKey = result.happyHorseApiKey ?? '';
        }
        if (version <= 11) {
          // v11 → v12: add provider field to imageApiSlots, fix baseUrl
          if (Array.isArray(result.imageApiSlots)) {
            result.imageApiSlots = result.imageApiSlots.map((s: any) => {
              if (s.provider) return s; // already migrated
              let provider: ImageProvider = 'dmxapi';
              if (s.baseUrl?.includes('aihubmix')) provider = 'aihubmix';
              const info = IMAGE_PROVIDERS[provider];
              return { ...s, provider, baseUrl: info.baseUrl, label: s.label || info.label };
            });
          }
        }
        if (version <= 12) delete result.lastContextMemoryPath;
        if (version <= 13) {
          // v13 → v14: add Kuaizi LZ Seedance key for hidden provider trials
          result.kuaiziApiKey = result.kuaiziApiKey ?? '';
          if (result.useRhtvSeedance === undefined) result.useRhtvSeedance = false;
        }
        if (version <= 14) {
          // v14 → v15: add hidden Kimi edit-agent preferences.
          result.kimiEditModel = result.kimiEditModel ?? '';
          result.kimiEditUseCos = result.kimiEditUseCos ?? true;
        }
        if (version <= 15) {
          // v15 → v16: split compatible image API slots by use case and price tier.
          if (Array.isArray(result.imageApiSlots)) {
            result.imageApiSlots = result.imageApiSlots.map((s: any) => ({
              ...s,
              mode: s.mode ?? 'text-to-image',
              tier: s.tier ?? 'standard',
            }));
          }
        }
        if (version <= 16) {
          // v16 → v17: add doubaoSpeechApiKey for Doubao Speech (openspeech) API
          result.doubaoSpeechApiKey = result.doubaoSpeechApiKey ?? '';
        }
        if (version <= 17) {
          // v17 → v18: aihubmix.com 大陆不可达，迁移到备用域名
          if (Array.isArray(result.imageApiSlots)) {
            result.imageApiSlots = result.imageApiSlots.map((s: any) => {
              if (s.baseUrl?.includes('aihubmix.com')) {
                return { ...s, baseUrl: s.baseUrl.replace('aihubmix.com', 'api.inferera.com') };
              }
              return s;
            });
          }
        }
        if (version <= 18) {
          // v18 → v19: add Gemini Omni / APIMart MG animation provider settings.
          result.omniApiKey = result.omniApiKey ?? '';
          result.omniBaseUrl = result.omniBaseUrl ?? OMNI_DEFAULT_BASE_URL;
          result.omniFallbackBaseUrls = Array.isArray(result.omniFallbackBaseUrls)
            ? result.omniFallbackBaseUrls
            : OMNI_DEFAULT_FALLBACK_BASE_URLS;
          result.omniCreditPricePer10 = result.omniCreditPricePer10 ?? OMNI_DEFAULT_CREDIT_PRICE_PER_10;
        }
        if (version <= 19) {
          // v19 → v20: add ZexAPI as a low-cost global image provider.
          if (Array.isArray(result.imageApiSlots)) {
            result.imageApiSlots = result.imageApiSlots.map((s: any) => {
              if (s.provider === 'zexapi') {
                return { ...s, baseUrl: IMAGE_PROVIDERS.zexapi.baseUrl, label: s.label || IMAGE_PROVIDERS.zexapi.label };
              }
              return s;
            });
          }
        }
        if (version <= 20) {
          // v20 → v21: add ZeroFall Omni key for omni-flash-vref route.
          result.omniZeroFallApiKey = result.omniZeroFallApiKey ?? '';
        }
        if (version <= 21) {
          // v21 → v22: split APIMart-compatible fallback key from the ZexAPI key.
          result.omniApimartApiKey = result.omniApimartApiKey ?? result.omniApiKey ?? '';
        }
        if (version <= 22) delete result.lastContextMemoryPath;
        if (version <= 23) {
          result.chatImageModel = result.chatImageModel ?? 'gpt-image-2';
          result.chatVideoModel = result.chatVideoModel ?? 'seedance-2.0';
        }
        if (version <= 24) {
          result.workspaceAgentModels = {
            canvas: 'global',
            workshop: 'global',
            editor: 'global',
            ...(result.workspaceAgentModels ?? {}),
          };
        }
        if (version <= 25) {
          // v25 → v26: add speechKuaiziFirst（配音默认走筷子丽帧 seed_audio 通道）
          result.speechKuaiziFirst = result.speechKuaiziFirst ?? true;
        }
        if (version <= 26) {
          // v26 -> v27: DeepSeek main Agent defaults to official Harness.
          result.deepseekEngine = result.deepseekEngine ?? 'harness';
        }
        if (version <= 28) {
          // v28 -> v29: all four APIMart gateways participate in dynamic
          // health selection. A transient timeout must not retire a domain.
          result.omniBaseUrl = result.omniBaseUrl || OMNI_DEFAULT_BASE_URL;
          const fallbacks = Array.isArray(result.omniFallbackBaseUrls)
            ? result.omniFallbackBaseUrls
            : [];
          result.omniFallbackBaseUrls = [...new Set([
            ...fallbacks,
            ...OMNI_DEFAULT_FALLBACK_BASE_URLS,
          ])];
        }
        if (version <= 29) {
          // v29 → v30: 凭证注册表。把旧平铺 key 字段「复制」归并进 credentials
          // （同 baseUrl+key 合并为一条），并记录各能力的 credentialId 引用。
          // 安全约束：旧字段一律保留原值作 resolver 回退，绝不在此清空。
          const migrated = migrateLegacyCredentials(result);
          result.credentials = migrated.credentials;
          result.credentialRefs = migrated.credentialRefs;
          if (migrated.imageApiSlots) result.imageApiSlots = migrated.imageApiSlots;
        }
        if (version <= 30) {
          // v30 → v31: Seedance 2.0 通道从布尔开关升级为引擎选择，
          // 保留老用户的原选择；MiniMax H3 渠道偏好默认自动容灾。
          result.seedanceEngine = result.seedanceEngine
            ?? (result.useRhtvSeedance ? 'runninghub' : 'kuaizi');
          result.minimaxH3Channel = result.minimaxH3Channel ?? 'auto';
        }
        if (version <= 31) {
          // v31 → v32: DeepSeek 默认模型切换为官方视觉模型
          // deepseek-v4-flash-vision-exp（2026-08-21 上线，原生识图默认开启）。
          // 按产品决策覆盖此前的任何 DeepSeek 模型选择。
          result.providerModels = result.providerModels ?? {};
          result.providerModels.deepseek = 'deepseek-v4-flash-vision-exp';
        }
        // Tier 4 seeds (idempotent)
        result.arkModelsCache = result.arkModelsCache ?? null;
        result.outputStyle = result.outputStyle ?? 'default';
        result.notificationsEnabled = result.notificationsEnabled ?? true;
        result.webSearchEnabled = result.webSearchEnabled ?? false;
        result.deepseekEngine = result.deepseekEngine ?? 'harness';
        result.chatImageModel = result.chatImageModel ?? 'gpt-image-2';
        result.chatVideoModel = result.chatVideoModel ?? 'seedance-2.0';
        result.wan3Channel = result.wan3Channel ?? 'auto';
        result.runninghubSite = result.runninghubSite ?? 'cn';
        result.runninghubIntlApiKey = result.runninghubIntlApiKey ?? '';
        result.workspaceAgentModels = {
          canvas: 'global',
          workshop: 'global',
          editor: 'global',
          ...(result.workspaceAgentModels ?? {}),
        };
        result.omniApiKey = result.omniApiKey ?? '';
        result.omniZeroFallApiKey = result.omniZeroFallApiKey ?? '';
        result.omniApimartApiKey = result.omniApimartApiKey ?? '';
        delete result.dmxUsageUserId;
        result.omniBaseUrl = result.omniBaseUrl ?? OMNI_DEFAULT_BASE_URL;
        result.omniFallbackBaseUrls = Array.isArray(result.omniFallbackBaseUrls)
          ? result.omniFallbackBaseUrls
          : OMNI_DEFAULT_FALLBACK_BASE_URLS;
        result.omniCreditPricePer10 = result.omniCreditPricePer10 ?? OMNI_DEFAULT_CREDIT_PRICE_PER_10;
        return result;
      },
    }
  )
);
