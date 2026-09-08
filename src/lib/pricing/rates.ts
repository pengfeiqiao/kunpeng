/**
 * rates — 各渠道单价与折算常量，成本预估/实账折算的唯一事实源。
 *
 * 所有"预估"都基于这里的单价表折算，绝不伪装成供应商实账；
 * 供应商实报（筷子 usage.completion_tokens、RunningHub consumeMoney）
 * 在落账点直接换算，不经过预估表。
 */

/** 成本账本里的供应商标识（ledger store 与 estimate 共用，避免循环依赖）。 */
export type CostProvider =
  | 'kuaizi'
  | 'runninghub'
  | 'apimart'
  | 'dmxapi'
  | 'jimeng'
  | 'ark'
  | 'other';

/** 估算汇率：固定常量，非实时牌价。APIMart 美元报价统一按此折人民币。 */
export const USD_TO_CNY = 7.2;

/**
 * 筷子/丽帧点数折人民币：点数:人民币 = 1:1，充值送 2%（98 折）。
 * 来源：96 条真实扣费记录严格线性拟合 0.00007 点/token（2026-09 实测）。
 */
export const KUAIZI_POINTS_PER_TOKEN = 0.00007;
export const KUAIZI_RECHARGE_DISCOUNT = 0.98;
/** 实付单价 ≈ 0.0000686 元/token。 */
export const KUAIZI_CNY_PER_TOKEN = KUAIZI_POINTS_PER_TOKEN * KUAIZI_RECHARGE_DISCOUNT;

/**
 * 筷子视频每秒 token 估算：22000 tokens/s。
 * 来源：筷子 API 文档计费示例 108900 tokens / 5s 视频。
 */
export const KUAIZI_TOKENS_PER_SECOND = 22000;

/**
 * 分辨率对 token 量的经验系数（预估，非官方数据）：
 * 480p ×0.5、720p ×1、1080p 及以上（含 2K/4K）×1.8。
 */
export const KUAIZI_RESOLUTION_TOKEN_FACTOR = {
  low: 0.5,
  standard: 1,
  high: 1.8,
} as const;

/** 筷子 seed_audio 配音：实测 ≈ 0.02 点/秒。 */
export const KUAIZI_SEED_AUDIO_CNY_PER_SECOND = 0.02 * KUAIZI_RECHARGE_DISCOUNT;

/**
 * 筷子官方按秒公示价（2026-09 用户提供）。
 * 格式：[无参考视频单价, [有参考视频区间下限, 上限]]，单位 元/秒。
 * 「参考视频」特指视频参考输入；图片/音频参考不影响该口径。
 */
export const KUAIZI_SEEDANCE_PER_SECOND: Record<string, Record<string, [number, [number, number]]>> = {
  fast: { '480p': [0.37, [0.38, 0.44]], '720p': [0.8, [0.83, 0.95]] },
  pro: {
    '480p': [0.46, [0.49, 0.56]], '720p': [0.99, [1.05, 1.2]],
    '1080p': [2.47, [2.63, 3.01]], '4k': [5.05, [5.44, 6.22]],
  },
  mini: { '480p': [0.23, [0.25, 0.28]], '720p': [0.5, [0.53, 0.6]] },
  seedance25: { '480p': [0.67, [0.72, 2.82]], '720p': [1.51, [1.63, 6.35]], '1080p': [3.74, [4, 15.65]] },
};

/** 万相 3.0 按秒公示价（元/秒，2026-09 用户提供）；prime 版同理。 */
export const WAN3_CNY_PER_SECOND: Record<string, number> = { '480p': 0.3, '720p': 0.6, '1080p': 1.2 };
export const WAN3_PRIME_CNY_PER_SECOND: Record<string, number> = { '480p': 0.45, '720p': 0.9, '1080p': 1.8 };

/** MiniMax H3 输出单价（元/秒）；输入图片 ≤5 张免费，超出 0.2 元/张；输入视频按同时长单价另计。 */
export const MINIMAX_H3_CNY_PER_SECOND: Record<string, number> = { '768p': 0.5, '2k': 0.8 };
export const MINIMAX_H3_FREE_INPUT_IMAGES = 5;
export const MINIMAX_H3_EXTRA_INPUT_IMAGE_CNY = 0.2;

/**
 * DMXAPI 公示价（人民币，2026-09 采集）：
 * - doubao-seedream-5-0-pro-260628：1K ￥0.3、2K ￥0.6；输入图首免，超出每张 ￥0.02
 * - gpt-image-2-03：￥0.3/次
 */
export const DMX_SEEDREAM_PRICE_CNY: Record<string, number> = { '1k': 0.3, '2k': 0.6 };
export const DMX_SEEDREAM_DEFAULT_PRICE_CNY = 0.6;
export const DMX_SEEDREAM_EXTRA_IMAGE_CNY = 0.02;
export const DMX_GPT_IMAGE_PRICE_CNY = 0.3;

/** 即梦 Seedance 2.5：499 元 / 15000 VIP 积分（2.5 无普通渠道）；单次扣减积分未知，不估金额。 */
export const JIMENG_VIP_LABEL = '即梦 VIP 积分扣减（499元/15000积分）';

/** 金额显示：保留两位小数并去尾零（7.5 → "7.5"，0.32 → "0.32"）。 */
export function formatCny(amount: number): string {
  return String(Math.round(amount * 100) / 100);
}

/** 筷子视频任务实账换算：completion_tokens × 实付单价。 */
export function kuaiziActualCnyFromTokens(completionTokens: number): number {
  return completionTokens * KUAIZI_CNY_PER_TOKEN;
}
