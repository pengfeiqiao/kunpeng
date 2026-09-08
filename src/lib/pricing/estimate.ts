/**
 * estimate — 非 RunningHub 渠道的费用预估器。
 *
 * 设计纪律（与 GenerationComposer 的"预估"标注约定一致）：
 * 1. 供应商能实报的渠道不走这里（筷子 tokens / RunningHub consumeMoney 在落账点实记）；
 *    这里只按单价表估算，label 一律带"预估"。
 * 2. 估算失败/无数据返回 null，调用方优雅降级为"费用以渠道结算为准"。
 * 3. APIMart 定价 API 免鉴权——不带任何 key（密钥纪律）。
 */
import {
  DMX_GPT_IMAGE_PRICE_CNY,
  DMX_SEEDREAM_DEFAULT_PRICE_CNY,
  DMX_SEEDREAM_EXTRA_IMAGE_CNY,
  DMX_SEEDREAM_PRICE_CNY,
  JIMENG_VIP_LABEL,
  KUAIZI_SEEDANCE_PER_SECOND,
  MINIMAX_H3_CNY_PER_SECOND,
  MINIMAX_H3_EXTRA_INPUT_IMAGE_CNY,
  MINIMAX_H3_FREE_INPUT_IMAGES,
  USD_TO_CNY,
  WAN3_CNY_PER_SECOND,
  WAN3_PRIME_CNY_PER_SECOND,
  formatCny,
  type CostProvider,
} from './rates.ts';
import { APIMART_BASE_URLS } from '../apimart/gateways.ts';
import { resolveApiKey, type CredentialHostState } from '../credentials.ts';
import {
  discoverConfiguredImageSlots,
  resolveConfiguredApimartApiKey,
  type ConfiguredImageSlot,
} from '../imageRouter/configuredChannels.ts';

export interface PricingCaps {
  apimart: boolean;
  kuaizi: boolean;
  dmxapi: boolean;
  seedanceChannel?: 'kuaizi' | 'runninghub' | 'ark';
}

export interface PricingEstimate {
  label: string;
  detail: string;
  /** 人民币金额；即梦积分等无法折现的渠道不填。 */
  amountCny?: number;
}

interface PricingSettingsState extends Omit<CredentialHostState, 'imageApiSlots'> {
  imageApiSlots?: ConfiguredImageSlot[];
  kuaiziApiKey?: string;
  omniApimartApiKey?: string;
  seedanceEngine?: 'kuaizi' | 'runninghub' | 'ark';
  useRhtvSeedance?: boolean;
}

/** 从设置状态推导渠道可用性（与 useWorkspaceServices 的 capabilities 同源）。 */
export function pricingCapsFromSettings(state: PricingSettingsState): PricingCaps {
  return {
    apimart: Boolean(resolveConfiguredApimartApiKey(state)),
    kuaizi: Boolean(resolveApiKey(state, 'kuaizi', state.kuaiziApiKey ?? '').trim()),
    dmxapi: discoverConfiguredImageSlots(state).some((slot) => slot.provider === 'dmxapi'),
    seedanceChannel: state.seedanceEngine ?? (state.useRhtvSeedance ? 'runninghub' : 'kuaizi'),
  };
}

const SEEDANCE_20_FAMILY = /^(seedance-2\.0|startend-v3\.1-pro|kuaizi-seedance-2\.0)/;

function isJimengSeedance25(engineId: string): boolean {
  return engineId === 'dreamina-seedance-2.5' || engineId === 'seedance-2.5';
}

/**
 * 推断引擎实际走哪个供应商——与 canvasGen 的路由决策保持一致：
 * seedance 2.0 系看 seedanceChannel 设置；wan3 偏好筷子优先；
 * midjourney 只走 APIMart；gpt-image/seedream 优先 DMXAPI 槽位。
 */
export function inferCostProvider(engineId: string, caps: PricingCaps): CostProvider | null {
  // Seedance 2.5 默认走筷子丽帧（mode=seedance2.5，按 token 计费），仅未配置筷子时降级即梦 CLI（VIP 积分）
  if (isJimengSeedance25(engineId)) return caps.kuaizi ? 'kuaizi' : 'jimeng';
  if (SEEDANCE_20_FAMILY.test(engineId)) {
    const channel = caps.seedanceChannel ?? 'kuaizi';
    if (channel === 'kuaizi') return caps.kuaizi ? 'kuaizi' : null;
    if (channel === 'ark') return 'ark';
    return 'runninghub';
  }
  if (engineId === 'minimax-hailuo-h3' || engineId === 'minimax-h3') {
    if (caps.kuaizi) return 'kuaizi';
    if (caps.apimart) return 'apimart';
    return 'runninghub';
  }
  if (engineId === 'wan-3.0' || engineId === 'wan-3.0-prime') {
    if (caps.kuaizi) return 'kuaizi';
    return 'runninghub';
  }
  if (engineId.startsWith('midjourney')) return caps.apimart ? 'apimart' : null;
  if (engineId === 'suno' || engineId === 'suno-v5') return caps.apimart ? 'apimart' : null;
  if (engineId.startsWith('gpt-image') || engineId.startsWith('seedream')) {
    if (caps.dmxapi) return 'dmxapi';
    if (caps.apimart) return 'apimart';
    return null; // RunningHub 实时估价或即梦免费渠道，不在这里估
  }
  return null;
}

// ── 筷子（kuaizi）：官方按秒公示价（rates.ts，2026-09 用户提供）───────────────

/** 分辨率归一到价表档位：native1080p/2K 并入 1080p；未知按 720p。 */
function kuaiziResolutionKey(resolution: unknown): string {
  const value = String(resolution ?? '720p').toLowerCase();
  if (value.includes('480')) return '480p';
  if (value.includes('4k')) return '4k';
  if (value.includes('1080') || value.includes('2k')) return '1080p';
  return '720p';
}

function estimateSeconds(duration: unknown): number {
  const raw = Number(duration);
  // -1 是"自动时长"语义，按默认 5 秒估
  return Number.isFinite(raw) && raw > 0 ? raw : 5;
}

function kuaiziVideoEstimate(
  engineId: string,
  params: Record<string, unknown>,
  refs: { images: number; videos: number; audios: number },
): PricingEstimate | null {
  const duration = estimateSeconds(params.duration);
  const resolution = kuaiziResolutionKey(params.resolution);
  // 万相 3.0 / Prime：按秒固定价，无参考价区分
  if (engineId === 'wan-3.0' || engineId === 'wan-3.0-prime') {
    const prime = engineId === 'wan-3.0-prime';
    const table = prime ? WAN3_PRIME_CNY_PER_SECOND : WAN3_CNY_PER_SECOND;
    const rate = table[resolution] ?? table['720p'];
    const amountCny = duration * rate;
    return {
      label: `约 ¥${formatCny(amountCny)}`,
      detail: '',
      amountCny,
    };
  }
  // MiniMax H3：输出按秒 + 输入图片超 5 张每张 ¥0.2；输入视频按同时长单价另计（时长未知，不含在内）
  if (engineId === 'minimax-hailuo-h3' || engineId === 'minimax-h3') {
    const resKey = String(params.resolution ?? '2K').toLowerCase().includes('768') ? '768p' : '2k';
    const rate = MINIMAX_H3_CNY_PER_SECOND[resKey];
    const imageOverage = Math.max(0, refs.images - MINIMAX_H3_FREE_INPUT_IMAGES) * MINIMAX_H3_EXTRA_INPUT_IMAGE_CNY;
    const amountCny = duration * rate + imageOverage;
    return {
      label: `约 ¥${formatCny(amountCny)}`,
      detail: '',
      amountCny,
    };
  }
  // Seedance 2.0 系 / 2.5：按档位 + 分辨率查官方按秒价；有参考视频时按官方区间中位估
  const tier = isJimengSeedance25(engineId) ? 'seedance25'
    : engineId.includes('mini') ? 'mini'
    : engineId.includes('fast') ? 'fast'
    : SEEDANCE_20_FAMILY.test(engineId) ? 'pro' : null;
  if (!tier) return null;
  const table = KUAIZI_SEEDANCE_PER_SECOND[tier];
  const entry = table[resolution] ?? table['720p'];
  const [baseRate, refRange] = entry;
  const hasVideoRef = refs.videos > 0;
  const rate = hasVideoRef ? (refRange[0] + refRange[1]) / 2 : baseRate;
  const amountCny = duration * rate;
  return {
    label: `约 ¥${formatCny(amountCny)}`,
    detail: '',
    amountCny,
  };
}

// ── DMXAPI：静态单价表（人民币）──────────────────────────────────────────────

function dmxImageEstimate(
  engineId: string,
  params: Record<string, unknown>,
  refs: { images: number },
): PricingEstimate | null {
  if (engineId.startsWith('seedream')) {
    const resolution = String(params.resolution ?? '').toLowerCase();
    const base = DMX_SEEDREAM_PRICE_CNY[resolution] ?? DMX_SEEDREAM_DEFAULT_PRICE_CNY;
    // DMX 规则：输入图首免，超出每张 ￥0.02
    const extraImages = Math.max(0, refs.images - 1);
    const amountCny = base + extraImages * DMX_SEEDREAM_EXTRA_IMAGE_CNY;
    return {
      label: `约 ¥${formatCny(amountCny)}`,
      detail: '',
      amountCny,
    };
  }
  if (engineId.startsWith('gpt-image')) {
    return {
      label: `约 ¥${formatCny(DMX_GPT_IMAGE_PRICE_CNY)}`,
      detail: '',
      amountCny: DMX_GPT_IMAGE_PRICE_CNY,
    };
  }
  return null;
}

// ── APIMart：免鉴权定价 API（模块级缓存 1 小时）──────────────────────────────

interface ApimartModelPricing {
  resolutionPrices: Record<string, number>;
  actionPrices: Record<string, number>;
  defaultPrice?: number;
}

const pricingCache = new Map<string, { at: number; value: ApimartModelPricing | null }>();
const PRICING_CACHE_MS = 60 * 60_000;
/** 实测 apib.ai 线路可用、apimart.ai 直连超时——把可用线路排在最前。 */
const PRICING_GATEWAY_ORDER = [
  'https://apib.ai',
  ...APIMART_BASE_URLS.filter((base) => base !== 'https://apib.ai'),
];

function numericRecord(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!value || typeof value !== 'object') return out;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const num = Number(raw);
    if (Number.isFinite(num) && num >= 0) out[key] = num;
  }
  return out;
}

function parseApimartPricing(raw: unknown): ApimartModelPricing | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as Record<string, unknown>;
  const data = (body.data && typeof body.data === 'object' ? body.data : body) as Record<string, unknown>;
  const pricing: ApimartModelPricing = {
    resolutionPrices: numericRecord(data.resolution_prices),
    actionPrices: numericRecord(data.action_prices),
  };
  // effective_rates / rates 里的兜底单价（不同线路字段名都试）
  for (const key of ['effective_rates', 'rates']) {
    const rates = numericRecord(data[key]);
    for (const candidate of ['default', 'generate', 'imagine']) {
      if (pricing.defaultPrice === undefined && rates[candidate] !== undefined) {
        pricing.defaultPrice = rates[candidate];
      }
    }
  }
  if (pricing.defaultPrice === undefined) {
    const direct = Number(data.price ?? data.effective_price);
    if (Number.isFinite(direct) && direct >= 0) pricing.defaultPrice = direct;
  }
  if (pricing.defaultPrice === undefined
    && Object.keys(pricing.resolutionPrices).length === 0
    && Object.keys(pricing.actionPrices).length === 0) return null;
  return pricing;
}

async function fetchApimartPricing(model: string): Promise<ApimartModelPricing | null> {
  const hit = pricingCache.get(model);
  if (hit && Date.now() - hit.at < PRICING_CACHE_MS) return hit.value;
  let value: ApimartModelPricing | null = null;
  for (const base of PRICING_GATEWAY_ORDER) {
    try {
      // 定价 API 免鉴权：不带任何 key（密钥纪律）
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6_000);
      try {
        const resp = await fetch(`${base}/api/pricing/model?model=${encodeURIComponent(model)}`, {
          signal: controller.signal,
        });
        if (!resp.ok) continue;
        value = parseApimartPricing(await resp.json());
      } finally {
        clearTimeout(timer);
      }
      if (value) break;
    } catch {
      // 单条线路失败静默换下一条；全部失败则 value=null 优雅降级
    }
  }
  pricingCache.set(model, { at: Date.now(), value });
  return value;
}

function lookupCaseInsensitive(record: Record<string, number>, key: string): number | undefined {
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(record)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

/** APIMart 美元报价 → 人民币预估。视频模型的 resolution 单价是 $/秒（实测 MiniMax-H3），按时长乘。 */
async function apimartEstimate(
  engineId: string,
  params: Record<string, unknown>,
): Promise<PricingEstimate | null> {
  let usd: number | undefined;
  if (engineId.startsWith('midjourney')) {
    const pricing = await fetchApimartPricing('midjourney');
    if (!pricing) return null;
    usd = lookupCaseInsensitive(pricing.actionPrices, 'imagine') ?? pricing.defaultPrice;
  } else if (engineId.startsWith('gpt-image')) {
    const pricing = await fetchApimartPricing('gpt-image-2');
    if (!pricing) return null;
    const resolution = String(params.resolution ?? '2k').toLowerCase();
    usd = lookupCaseInsensitive(pricing.resolutionPrices, resolution)
      ?? lookupCaseInsensitive(pricing.resolutionPrices, '2k')
      ?? pricing.defaultPrice;
  } else if (engineId === 'minimax-hailuo-h3' || engineId === 'minimax-h3') {
    const pricing = await fetchApimartPricing('MiniMax-H3');
    if (!pricing) return null;
    const resolution = String(params.resolution ?? '2K');
    const perSecond = lookupCaseInsensitive(pricing.resolutionPrices, resolution)
      ?? lookupCaseInsensitive(pricing.resolutionPrices, '2K')
      ?? pricing.defaultPrice;
    if (perSecond === undefined) return null;
    const rawDuration = Number(params.duration);
    const duration = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 5;
    usd = perSecond * duration;
  } else {
    return null;
  }
  if (usd === undefined || !Number.isFinite(usd) || usd < 0) return null;
  const amountCny = usd * USD_TO_CNY;
  return {
    label: `约 ¥${formatCny(amountCny)}`,
    detail: '',
    amountCny,
  };
}

// ── 入口 ─────────────────────────────────────────────────────────────────────

/**
 * 同步分支（筷子/DMX/即梦）：不调网络，供任务行等同步 UI 使用。
 * APIMart 需要异步定价 API，这里返回 null。
 */
export function estimateEngineCostSync(
  engineId: string,
  params: Record<string, unknown>,
  refs: { images: number; videos: number; audios: number },
  caps: PricingCaps,
  providerHint?: CostProvider,
): PricingEstimate | null {
  const provider = providerHint ?? inferCostProvider(engineId, caps);
  if (!provider) return null;
  switch (provider) {
    // providerHint 是任务真实跑过的渠道（落账场景）：任务既已发生，即使当前
    // 设置里 key 被删掉也照价表估，不再以 caps 门禁（与 dmxapi 分支行为对齐）
    case 'kuaizi': return caps.kuaizi || providerHint === 'kuaizi' ? kuaiziVideoEstimate(engineId, params, refs) : null;
    case 'dmxapi': return dmxImageEstimate(engineId, params, refs);
    case 'jimeng':
      return {
        label: JIMENG_VIP_LABEL,
        detail: '',
      };
    default: return null;
  }
}

/**
 * 预估指定引擎一次生成的费用。返回 null = 无法预估（调用方降级"费用以渠道结算为准"）。
 * providerHint：任务已实际运行时由落账点传入真实渠道，避免与推断路由不一致。
 */
export async function estimateEngineCost(
  engineId: string,
  params: Record<string, unknown>,
  refs: { images: number; videos: number; audios: number },
  caps: PricingCaps,
  providerHint?: CostProvider,
): Promise<PricingEstimate | null> {
  const sync = estimateEngineCostSync(engineId, params, refs, caps, providerHint);
  if (sync) return sync;
  const provider = providerHint ?? inferCostProvider(engineId, caps);
  if (provider === 'apimart' && (caps.apimart || providerHint === 'apimart')) return apimartEstimate(engineId, params);
  return null;
}
