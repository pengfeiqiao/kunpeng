/**
 * 凭证注册表（Credential Registry）—— API Key 的单一事实源。
 *
 * 本模块刻意保持零依赖（不 import settingsStore / Tauri），这样：
 * 1. `node --test` 可以直接运行 credentials.test.ts；
 * 2. settingsStore 的 persist 迁移可以安全 import 这里的纯函数，无循环依赖。
 *
 * 安全模型：
 * - 迁移只「复制」旧字段进 credentials，从不清空/删除旧字段；
 * - 读取一律走 resolve*()，优先 credentialId 引用的凭证，读不到回退旧字段。
 *   即使迁移有 bug，行为也退化为改造前的现状。
 */

/** 一条 API 凭证。apiKey 永不明文进日志/导出（见 Settings 导出名册）。 */
export interface Credential {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  createdAt: number;
}

/** 迁移只关心槽位的这几个字段；其余字段原样透传。 */
export interface CredentialSlotLike {
  id: string;
  label?: string;
  baseUrl?: string;
  apiKey?: string;
  credentialId?: string;
}

/**
 * 迁移/resolver 需要的最小 state 切面（结构化类型，宽松接收 persist 历史数据）。
 * 刻意不带 index signature：interface（如 SettingsState）没有隐式索引签名，
 * 带的话所有传 SettingsState 的调用点都会编译报错。迁移内部动态读旧字段时自行窄化。
 */
export interface CredentialHostState {
  credentials?: Credential[];
  credentialRefs?: Record<string, string>;
  imageApiSlots?: CredentialSlotLike[];
  providerApiKeys?: Record<string, string>;
  providerBaseUrls?: Record<string, string>;
}

/** 旧平铺 key 字段 → 能力（capability）的映射表。cap 是 credentialRefs 的 key。 */
export interface LegacyCapabilitySpec {
  cap: string;
  label: string;
  keyField: string;
  baseUrlField?: string;
  defaultBaseUrl: string;
}

export const LEGACY_CAPABILITIES: LegacyCapabilitySpec[] = [
  { cap: 'glm', label: '智谱 GLM', keyField: 'glmApiKey', baseUrlField: 'glmBaseUrl', defaultBaseUrl: 'https://open.bigmodel.cn/api/anthropic' },
  { cap: 'gemini', label: 'Gemini', keyField: 'geminiApiKey', defaultBaseUrl: 'https://generativelanguage.googleapis.com' },
  { cap: 'dmx', label: 'DMXAPI', keyField: 'dmxApiKey', defaultBaseUrl: 'https://www.dmxapi.cn' },
  { cap: 'bananaPro', label: 'Banana Pro', keyField: 'bananaProApiKey', defaultBaseUrl: '' },
  { cap: 'ark', label: '火山方舟', keyField: 'arkApiKey', defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3' },
  { cap: 'happyHorse', label: 'HappyHorse', keyField: 'happyHorseApiKey', baseUrlField: 'happyHorseBaseUrl', defaultBaseUrl: '' },
  { cap: 'runninghub', label: 'RunningHub', keyField: 'runninghubApiKey', defaultBaseUrl: 'https://www.runninghub.cn' },
  { cap: 'kuaizi', label: '筷子丽帧', keyField: 'kuaiziApiKey', defaultBaseUrl: 'https://aiopenapi.kuaizi.cn' },
  { cap: 'doubaoSpeech', label: '豆包语音', keyField: 'doubaoSpeechApiKey', defaultBaseUrl: 'https://openspeech.bytedance.com' },
  { cap: 'omni', label: 'ZexAPI / Omni', keyField: 'omniApiKey', defaultBaseUrl: 'https://zexapi.com' },
  { cap: 'omniZeroFall', label: 'ZeroFall Omni', keyField: 'omniZeroFallApiKey', defaultBaseUrl: 'https://llm.zerofall.top' },
  { cap: 'omniApimart', label: 'APIMart', keyField: 'omniApimartApiKey', baseUrlField: 'omniBaseUrl', defaultBaseUrl: 'https://api.apimart.ai' },
];

/** 聊天 provider 的内置默认请求地址（与 ProviderSettings 的 KNOWN_PROVIDERS 对齐）。 */
const PROVIDER_DEFAULT_BASE_URLS: Record<string, string> = {
  glm: 'https://open.bigmodel.cn/api/anthropic',
  deepseek: 'https://api.deepseek.com/anthropic',
  kimi: 'https://api.kimi.com/coding/',
  minimax: 'https://api.minimaxi.com/anthropic',
  qwen: 'https://dashscope.aliyuncs.com/apps/anthropic',
  doubao: 'https://ark.cn-beijing.volces.com/api/compatible',
};

/** COS 凭证把 SecretId:SecretKey 合并存进 apiKey 字段（Credential 只有单密钥位）。 */
const COS_SEPARATOR = ':';

export function normalizeBaseUrl(url: string): string {
  const v = (url ?? '').trim().replace(/\/+$/, '');
  if (!v) return '';
  // 只小写 scheme+host，路径保持原样
  return v.replace(/^(https?:\/\/[^/]+)/i, (m) => m.toLowerCase());
}

/** FNV-1a 32bit；用两个种子拼 64bit，id 不含 key 本体且不可逆推。 */
function fnv1a(input: string, seed: number): string {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** 由 (归一化 baseUrl, apiKey) 派生稳定 id：同内容必同 id，天然支持幂等迁移。 */
export function credentialIdFor(baseUrl: string, apiKey: string): string {
  const material = `${normalizeBaseUrl(baseUrl)}\n${apiKey}`;
  return `cred-${fnv1a(material, 0x811c9dc5)}${fnv1a(material, 0x01000193)}`;
}

function contentKey(baseUrl: string, apiKey: string): string {
  return `${normalizeBaseUrl(baseUrl)}\n${apiKey.trim()}`;
}

export interface CredentialMigrationResult {
  credentials: Credential[];
  credentialRefs: Record<string, string>;
  /** 仅当输入带 imageApiSlots 时返回（补挂了 credentialId 的槽位数组）。 */
  imageApiSlots?: CredentialSlotLike[];
}

/**
 * 纯函数：把旧平铺 key 字段归并进凭证注册表。
 * - 同 (归一化 baseUrl, key) 合并为一条凭证；
 * - 已存在的凭证/引用原样保留（幂等：迁两次结果一致）；
 * - 绝不修改、清空任何旧字段——旧字段是 resolver 的回退来源。
 */
export function migrateLegacyCredentials(state: CredentialHostState): CredentialMigrationResult {
  const credentials: Credential[] = Array.isArray(state.credentials) ? [...state.credentials] : [];
  const credentialRefs: Record<string, string> = { ...(state.credentialRefs ?? {}) };
  const byContent = new Map<string, Credential>();
  for (const cred of credentials) {
    if (cred?.apiKey) byContent.set(contentKey(cred.baseUrl ?? '', cred.apiKey), cred);
  }
  const hasId = (id: string | undefined) => Boolean(id) && credentials.some((c) => c.id === id);

  const ensureCredential = (label: string, baseUrl: string, apiKey: string): Credential => {
    const ck = contentKey(baseUrl, apiKey);
    const existing = byContent.get(ck);
    if (existing) return existing;
    let id = credentialIdFor(baseUrl, apiKey.trim());
    // 理论上的 hash 碰撞：追加后缀直到唯一
    while (credentials.some((c) => c.id === id)) id = `${id}x`;
    const cred: Credential = {
      id,
      label,
      baseUrl: normalizeBaseUrl(baseUrl),
      apiKey: apiKey.trim(),
      createdAt: Date.now(),
    };
    credentials.push(cred);
    byContent.set(ck, cred);
    return cred;
  };

  const legacyRecord = state as unknown as Record<string, unknown>;
  const readKey = (field: string): string => {
    const value = legacyRecord[field];
    return typeof value === 'string' ? value.trim() : '';
  };

  // 1) 平铺旧字段
  for (const spec of LEGACY_CAPABILITIES) {
    const key = readKey(spec.keyField);
    if (!key) continue;
    const baseUrl =
      (spec.baseUrlField ? readKey(spec.baseUrlField) : '') || spec.defaultBaseUrl;
    const cred = ensureCredential(spec.label, baseUrl, key);
    if (!hasId(credentialRefs[spec.cap])) credentialRefs[spec.cap] = cred.id;
  }

  // 2) 聊天 provider 表
  const providerApiKeys = state.providerApiKeys ?? {};
  for (const [providerId, rawKey] of Object.entries(providerApiKeys)) {
    const key = typeof rawKey === 'string' ? rawKey.trim() : '';
    if (!key) continue;
    const baseUrl =
      (state.providerBaseUrls?.[providerId] ?? '').trim() ||
      PROVIDER_DEFAULT_BASE_URLS[providerId] ||
      '';
    const cred = ensureCredential(`聊天模型 · ${providerId}`, baseUrl, key);
    const cap = `provider:${providerId}`;
    if (!hasId(credentialRefs[cap])) credentialRefs[cap] = cred.id;
  }

  // 3) 腾讯云 COS（SecretId + SecretKey 合并为一条凭证）
  const cosSecretId = readKey('cosSecretId');
  const cosSecretKey = readKey('cosSecretKey');
  if (cosSecretId && cosSecretKey) {
    const bucket = readKey('cosBucket');
    const region = readKey('cosRegion');
    const baseUrl = bucket
      ? `https://${bucket}.cos.${region || 'ap-guangzhou'}.myqcloud.com`
      : '';
    const cred = ensureCredential('腾讯云 COS', baseUrl, `${cosSecretId}${COS_SEPARATOR}${cosSecretKey}`);
    if (!hasId(credentialRefs.cos)) credentialRefs.cos = cred.id;
  }

  // 4) 生图槽位：给每个带 key 的槽位挂 credentialId（槽位对象保留 apiKey 原值）
  let imageApiSlots = state.imageApiSlots;
  if (Array.isArray(imageApiSlots)) {
    imageApiSlots = imageApiSlots.map((slot) => {
      if (!slot || typeof slot.apiKey !== 'string' || !slot.apiKey.trim()) return slot;
      if (hasId(slot.credentialId)) return slot;
      const cred = ensureCredential(
        slot.label || '生图服务',
        slot.baseUrl ?? '',
        slot.apiKey,
      );
      return { ...slot, credentialId: cred.id };
    });
  }

  return { credentials, credentialRefs, imageApiSlots };
}

// ── 读侧 resolver ────────────────────────────────────────────────────────────

export function resolveCredential(
  state: CredentialHostState,
  credentialId: string | undefined | null,
): Credential | undefined {
  if (!credentialId) return undefined;
  return state.credentials?.find((c) => c.id === credentialId);
}

/**
 * 按能力解析 API Key：优先 credentialRefs[capability] 引用的凭证；
 * 引用缺失/悬空/凭证 key 为空时回退 legacyValue（旧字段）。绝不抛错。
 */
export function resolveApiKey(
  state: CredentialHostState,
  capability: string,
  legacyValue: string = '',
): string {
  const cred = resolveCredential(state, state.credentialRefs?.[capability]);
  if (cred?.apiKey?.trim()) return cred.apiKey;
  return legacyValue ?? '';
}

/** 生图槽位：优先槽位自己引用的凭证，回退槽位内联 apiKey。 */
export function resolveSlotApiKey(
  state: CredentialHostState,
  slot: { apiKey?: string; credentialId?: string } | undefined | null,
): string {
  const cred = resolveCredential(state, slot?.credentialId);
  if (cred?.apiKey?.trim()) return cred.apiKey;
  return slot?.apiKey ?? '';
}

/**
 * 主聊天是否已有任一可用 provider Key（glm 旧字段 + providerApiKeys 表，
 * 均经凭证注册表解析）。引导页汇总、聊天空态补配卡、App 连接状态共用。
 */
export function hasAnyChatProviderKey(
  state: CredentialHostState & { glmApiKey?: string },
): boolean {
  if (resolveApiKey(state, 'glm', state.glmApiKey ?? '').trim()) return true;
  const ids = new Set<string>([
    ...Object.keys(state.providerApiKeys ?? {}),
    ...Object.keys(state.credentialRefs ?? {})
      .filter((cap) => cap.startsWith('provider:'))
      .map((cap) => cap.slice('provider:'.length)),
  ]);
  for (const id of ids) {
    if (resolveApiKey(state, `provider:${id}`, state.providerApiKeys?.[id] ?? '').trim()) return true;
  }
  return false;
}

/** COS：优先 'cos' 凭证（SecretId:SecretKey 合并存储），回退旧字段对。 */
export function resolveCosSecrets(
  state: CredentialHostState,
  legacySecretId: string = '',
  legacySecretKey: string = '',
): { secretId: string; secretKey: string } {
  const cred = resolveCredential(state, state.credentialRefs?.cos);
  const combined = cred?.apiKey ?? '';
  const sep = combined.indexOf(COS_SEPARATOR);
  if (sep > 0) {
    return { secretId: combined.slice(0, sep), secretKey: combined.slice(sep + 1) };
  }
  return { secretId: legacySecretId, secretKey: legacySecretKey };
}

// ── 引用关系（设置页「被哪些能力引用」展示） ──────────────────────────────────

export function capabilityLabel(cap: string): string {
  if (cap.startsWith('provider:')) return `聊天模型 · ${cap.slice('provider:'.length)}`;
  return LEGACY_CAPABILITIES.find((spec) => spec.cap === cap)?.label ?? cap;
}

/** credentialId → 引用它的能力标签列表。 */
export function listCredentialUsages(state: CredentialHostState): Record<string, string[]> {
  const usages: Record<string, string[]> = {};
  for (const [cap, refId] of Object.entries(state.credentialRefs ?? {})) {
    if (!refId) continue;
    (usages[refId] ??= []).push(capabilityLabel(cap));
  }
  for (const slot of state.imageApiSlots ?? []) {
    if (slot?.credentialId) {
      (usages[slot.credentialId] ??= []).push(`生图槽位 · ${slot.label || slot.id}`);
    }
  }
  return usages;
}
