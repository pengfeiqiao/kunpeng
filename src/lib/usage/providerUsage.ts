import { Body, fetch as tauriFetch, ResponseType } from '@tauri-apps/api/http';
import { rhtvAccountStatus } from '@/lib/rhtv/client';
import { APIMART_BASE_URLS } from '@/lib/apimart/baseUrl';
import { useSettingsStore, type ImageApiSlot } from '@/stores/settingsStore';
import { resolveApiKey, resolveSlotApiKey } from '@/lib/credentials';

const DMX_USAGE_USER_ID = '24147';

export type MediaUsageStatus =
  | 'available'
  | 'unsupported'
  | 'unconfigured'
  | 'needs_setup'
  | 'error';

export interface MediaUsageSnapshot {
  id: string;
  name: string;
  category: '图像' | '视频' | '综合';
  configured: boolean;
  status: MediaUsageStatus;
  remaining?: string;
  used?: string;
  secondary?: string;
  detail: string;
  source?: string;
  docsUrl?: string;
}

interface ApimartBalanceResponse {
  success?: boolean;
  message?: string;
  remain_balance?: number;
  used_balance?: number;
  remain_credits?: number;
  used_credits?: number;
  unlimited_quota?: boolean;
}

interface DmxTokenResponse {
  success?: boolean;
  message?: string;
  data?: {
    name?: string;
    status?: number;
    used_quota?: number;
    remain_quota?: number;
    unlimited_quota?: boolean;
    remain_count?: number;
    unlimited_count?: boolean;
  };
}

interface KuaiziBalanceResponse {
  code?: number;
  message?: string;
  data?: {
    wallet_balance?: number;
  };
  trace_id?: string;
}

interface AiHubMixKeyBalanceResponse {
  object?: string;
  total_usage?: number;
  error?: {
    message?: string;
  };
}

function trimBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
}

function formatNumber(value: unknown, digits = 2): string | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return undefined;
  return number.toLocaleString('zh-CN', { maximumFractionDigits: digits });
}

async function getJson<T>(
  url: string,
  headers: Record<string, string>,
  timeout = 12,
): Promise<{ status: number; data: T }> {
  const response = await tauriFetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json', ...headers },
    responseType: ResponseType.Text,
    timeout,
  });
  let data: T;
  try {
    data = JSON.parse(String(response.data ?? '{}')) as T;
  } catch {
    throw new Error(`服务返回了无法识别的数据（HTTP ${response.status}）`);
  }
  return { status: response.status, data };
}

function configuredImageSlot(
  settings: ReturnType<typeof useSettingsStore.getState>,
  provider: ImageApiSlot['provider'],
): ImageApiSlot | undefined {
  return (settings.imageApiSlots ?? []).find(
    (slot) => slot.provider === provider && Boolean(resolveSlotApiKey(settings, slot).trim()),
  );
}

async function queryRunningHub(configured: boolean): Promise<MediaUsageSnapshot> {
  const base: MediaUsageSnapshot = {
    id: 'runninghub',
    name: 'RunningHub',
    category: '综合',
    configured,
    status: configured ? 'error' : 'unconfigured',
    detail: configured ? '正在读取账户余额。' : '尚未配置 RunningHub API Key。',
    docsUrl: 'https://www.runninghub.cn/runninghub-api-doc-cn/api-425761030',
  };
  if (!configured) return base;
  try {
    const result = await rhtvAccountStatus();
    const money = formatNumber(result.remainMoney);
    const currency = typeof result.currency === 'string' ? result.currency : 'CNY';
    return {
      ...base,
      status: 'available',
      remaining: money ? `${currency === 'CNY' ? '¥' : `${currency} `}${money}` : '人民币余额暂不可读',
      detail: '账户人民币实时余额',
      source: 'RunningHub 官方账户接口',
    };
  } catch (error) {
    return {
      ...base,
      status: 'error',
      detail: `查询失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function queryApimart(
  key: string,
  configuredBases: string[],
): Promise<MediaUsageSnapshot> {
  const configured = Boolean(key.trim());
  const base: MediaUsageSnapshot = {
    id: 'apimart',
    name: 'APIMart / APIB',
    category: '视频',
    configured,
    status: configured ? 'error' : 'unconfigured',
    detail: configured ? '正在读取令牌额度。' : '尚未配置 APIMart 兼容通道 Key。',
    docsUrl: 'https://docs.apimart.ai/cn/api-reference/account/token-balance',
  };
  if (!configured) return base;

  const candidates = Array.from(new Set(configuredBases.map(trimBaseUrl).filter(Boolean)));
  const errors: string[] = [];
  for (const candidate of candidates) {
    try {
      const { status, data } = await getJson<ApimartBalanceResponse>(
        `${candidate}/v1/balance`,
        { Authorization: `Bearer ${key.trim()}` },
      );
      if (status < 200 || status >= 300 || data.success !== true) {
        errors.push(`${new URL(candidate).host}: ${data.message || `HTTP ${status}`}`);
        continue;
      }
      const unlimited = data.unlimited_quota === true;
      const remainCredits = formatNumber(data.remain_credits);
      const usedCredits = formatNumber(data.used_credits);
      const remainBalance = formatNumber(data.remain_balance);
      const usedBalance = formatNumber(data.used_balance);
      return {
        ...base,
        status: 'available',
        remaining: unlimited
          ? '无限额度'
          : remainCredits
            ? `${remainCredits} 积分`
            : remainBalance
              ? `${remainBalance} 额度`
              : '可用',
        used: usedCredits
          ? `已用 ${usedCredits} 积分`
          : usedBalance
            ? `已用 ${usedBalance} 额度`
            : undefined,
        secondary: usedCredits && usedBalance ? `计费额度 ${usedBalance}` : undefined,
        detail: '当前 Omni 令牌实时额度',
        source: new URL(candidate).host,
      };
    } catch (error) {
      errors.push(`${new URL(candidate).host}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    ...base,
    status: 'error',
    detail: errors.length > 0 ? `查询失败：${errors[0]}` : '没有可用的余额查询地址。',
  };
}

async function queryDmx(
  slot: ImageApiSlot | undefined,
  apiKey: string,
): Promise<MediaUsageSnapshot> {
  const configured = Boolean(apiKey);
  const base: MediaUsageSnapshot = {
    id: 'dmxapi',
    name: 'DMXAPI',
    category: '图像',
    configured,
    status: configured ? 'error' : 'unconfigured',
    detail: configured ? '正在读取当前生成 Key 的额度。' : '尚未配置 DMXAPI 生图 Key。',
    docsUrl: 'https://doc.dmxapi.cn/key-yuer.html',
  };
  if (!configured || !slot) return base;

  try {
    const providerBase = trimBaseUrl(slot.baseUrl || 'https://www.dmxapi.cn');
    const { status, data } = await getJson<DmxTokenResponse>(
      `${providerBase}/api/token/key/${encodeURIComponent(apiKey)}`,
      { 'Rix-Api-User': DMX_USAGE_USER_ID },
    );
    if (status < 200 || status >= 300 || data.success !== true || !data.data) {
      throw new Error(data.message || `HTTP ${status}`);
    }
    const item = data.data;
    const unlimited = item.unlimited_quota === true;
    const remaining = unlimited ? '无限额度' : `¥${formatNumber((item.remain_quota ?? 0) / 500000, 4) ?? '0'}`;
    const used = `已用 ¥${formatNumber((item.used_quota ?? 0) / 500000, 4) ?? '0'}`;
    const count = item.unlimited_count
      ? '次数不限'
      : item.remain_count != null
        ? `剩余 ${formatNumber(item.remain_count, 0)} 次`
        : undefined;
    return {
      ...base,
      status: 'available',
      remaining,
      used,
      secondary: count,
      detail: item.name ? `令牌：${item.name}` : '当前生成 Key 实时额度',
      source: 'DMXAPI 令牌接口',
    };
  } catch (error) {
    return {
      ...base,
      status: 'error',
      detail: `查询失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function queryKuaizi(key: string): Promise<MediaUsageSnapshot> {
  const configured = Boolean(key.trim());
  const base: MediaUsageSnapshot = {
    id: 'kuaizi',
    name: '筷子丽帧',
    category: '视频',
    configured,
    status: configured ? 'error' : 'unconfigured',
    detail: configured ? '正在读取钱包点数。' : '尚未配置筷子丽帧 API Key。',
    docsUrl: 'https://aiopenapi.kuaizi.cn',
  };
  if (!configured) return base;

  try {
    const response = await tauriFetch<KuaiziBalanceResponse>(
      'https://aiopenapi.kuaizi.cn/ai-open-platform-api/v1/user/balance',
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ApiKey: key.trim(),
        },
        body: Body.json({}),
        responseType: ResponseType.JSON,
        timeout: 12,
      },
    );
    const data = response.data;
    if (!response.ok || data?.code !== 0 || data.data?.wallet_balance == null) {
      const trace = data?.trace_id ? `（trace_id: ${data.trace_id}）` : '';
      throw new Error(`${data?.message || `HTTP ${response.status}`}${trace}`);
    }
    const points = data.data.wallet_balance / 100;
    return {
      ...base,
      status: 'available',
      remaining: `${formatNumber(points, 2) ?? '0'} 点`,
      detail: '钱包实时可用点数',
      source: '筷子科技官方钱包接口',
    };
  } catch (error) {
    return {
      ...base,
      status: 'error',
      detail: `查询失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function queryAiHubMix(slot: ImageApiSlot | undefined, apiKey: string): Promise<MediaUsageSnapshot> {
  const configured = Boolean(apiKey);
  const base: MediaUsageSnapshot = {
    id: 'aihubmix',
    name: 'Inferera / AiHubMix',
    category: '图像',
    configured,
    status: configured ? 'error' : 'unconfigured',
    detail: configured ? '正在读取当前生成 Key 的可用额度。' : '尚未配置 Inferera / AiHubMix 生图 Key。',
    docsUrl: 'https://docs.aihubmix.com/cn/api/Cli',
  };
  if (!configured || !slot) return base;

  const candidates = Array.from(new Set([
    trimBaseUrl(slot.baseUrl || ''),
    'https://api.inferera.com',
    'https://aihubmix.com',
  ].filter(Boolean)));
  const errors: string[] = [];
  for (const candidate of candidates) {
    try {
      const { status, data } = await getJson<AiHubMixKeyBalanceResponse>(
        `${candidate}/dashboard/billing/remain`,
        { Authorization: `Bearer ${apiKey}` },
      );
      if (status < 200 || status >= 300 || typeof data.total_usage !== 'number') {
        errors.push(`${new URL(candidate).host}: ${data.error?.message || `HTTP ${status}`}`);
        continue;
      }
      const unlimited = data.total_usage < 0;
      return {
        ...base,
        status: 'available',
        remaining: unlimited ? '无限额度' : `$${formatNumber(data.total_usage, 4) ?? '0'}`,
        detail: unlimited ? '当前生成 Key 未设置额度上限' : '当前生成 Key 实时可用额度',
        source: new URL(candidate).host,
      };
    } catch (error) {
      errors.push(`${new URL(candidate).host}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    ...base,
    status: 'error',
    detail: errors.length > 0 ? `查询失败：${errors[0]}` : '没有可用的余额查询地址。',
  };
}

function staticSnapshot(
  id: string,
  name: string,
  category: MediaUsageSnapshot['category'],
  configured: boolean,
  detail: string,
  docsUrl?: string,
): MediaUsageSnapshot {
  return {
    id,
    name,
    category,
    configured,
    status: configured ? 'unsupported' : 'unconfigured',
    detail: configured ? detail : '尚未配置该服务。',
    docsUrl,
  };
}

export async function queryMediaUsage(): Promise<MediaUsageSnapshot[]> {
  const settings = useSettingsStore.getState();
  const dmxSlot = configuredImageSlot(settings, 'dmxapi');
  const aihubSlot = configuredImageSlot(settings, 'aihubmix');
  const zexSlot = configuredImageSlot(settings, 'zexapi');
  const apimartBases = [
    settings.omniBaseUrl,
    ...settings.omniFallbackBaseUrls,
    ...APIMART_BASE_URLS,
  ];

  const [runninghub, apimart, dmx, kuaizi, aihubmix] = await Promise.all([
    queryRunningHub(Boolean(resolveApiKey(settings, 'runninghub', settings.runninghubApiKey).trim())),
    queryApimart(resolveApiKey(settings, 'omniApimart', settings.omniApimartApiKey), apimartBases),
    queryDmx(dmxSlot, dmxSlot ? resolveSlotApiKey(settings, dmxSlot).trim() : ''),
    queryKuaizi(resolveApiKey(settings, 'kuaizi', settings.kuaiziApiKey)),
    queryAiHubMix(aihubSlot, aihubSlot ? resolveSlotApiKey(settings, aihubSlot).trim() : ''),
  ]);

  return [
    runninghub,
    apimart,
    dmx,
    kuaizi,
    aihubmix,
    staticSnapshot(
      'zexapi',
      'ZexAPI',
      '综合',
      Boolean(resolveApiKey(settings, 'omni', settings.omniApiKey).trim() || zexSlot),
      '当前生成 Key 未开放余额查询接口，请在平台控制台查看。',
      'https://zexapi.com',
    ),
    staticSnapshot(
      'zerofall',
      'ZeroFall',
      '视频',
      Boolean(resolveApiKey(settings, 'omniZeroFall', settings.omniZeroFallApiKey).trim()),
      '当前生成 Key 未开放余额查询接口，请在平台控制台查看。',
      'https://llm.zerofall.top',
    ),
    staticSnapshot(
      'ark',
      '火山方舟',
      '视频',
      Boolean(resolveApiKey(settings, 'ark', settings.arkApiKey).trim()),
      '方舟余额属于云账户账单体系，当前 API Key 不能直接查询。',
      'https://console.volcengine.com/ark',
    ),
    staticSnapshot(
      'happyhorse',
      'HappyHorse',
      '视频',
      Boolean(resolveApiKey(settings, 'happyHorse', settings.happyHorseApiKey).trim()),
      '自定义服务未声明统一余额接口。',
    ),
    staticSnapshot(
      'dreamina',
      '即梦 CLI',
      '图像',
      true,
      '即梦使用本机登录会话，CLI 暂未提供余额查询接口。',
      'https://jimeng.jianying.com',
    ),
  ];
}
