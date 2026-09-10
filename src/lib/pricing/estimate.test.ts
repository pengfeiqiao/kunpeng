/**
 * estimate 预估器测试：渠道路由、token/单价折算、汇率换算、优雅降级。
 * 全部离线——APIMart 定价 API 用 fetch stub，绝不触网；并断言不带任何鉴权头（密钥纪律）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateEngineCost,
  estimateEngineCostSync,
  inferCostProvider,
  pricingCapsFromSettings,
  type PricingCaps,
} from './estimate.ts';
import {
  KUAIZI_CNY_PER_TOKEN,
  KUAIZI_TOKENS_PER_SECOND,
  USD_TO_CNY,
  formatCny,
  kuaiziActualCnyFromTokens,
} from './rates.ts';

const noRefs = { images: 0, videos: 0, audios: 0 };
const kuaiziCaps: PricingCaps = { apimart: false, kuaizi: true, dmxapi: false, seedanceChannel: 'kuaizi' };

test('kuaizi 官方按秒价表：档位 × 分辨率 × 时长；有参考视频按区间中位', async () => {
  // Seedance 2.0 pro 5s 720p 无参考视频：5 × 0.99 = ¥4.95
  const est = await estimateEngineCost('seedance-2.0', { duration: '5', resolution: '720p' }, noRefs, kuaiziCaps);
  assert.ok(est); assert.match(est.label, /^约 ¥4.95$/);
  assert.equal(est.amountCny, 5 * 0.99);
  // 480p ×0.46 → ¥2.3；1080p ×2.47 → ¥12.35
  assert.match((await estimateEngineCost('seedance-2.0', { duration: '5', resolution: '480p' }, noRefs, kuaiziCaps))!.label, /¥2\.3/);
  assert.match((await estimateEngineCost('seedance-2.0', { duration: '5', resolution: '1080p' }, noRefs, kuaiziCaps))!.label, /¥12\.35/);
  // duration -1（自动时长）按 5s 估；fast 档 720p ×0.8 → ¥4
  assert.match((await estimateEngineCost('startend-v3.1-pro', { duration: '-1' }, noRefs, kuaiziCaps))!.label, /¥4\.95/);
  assert.match((await estimateEngineCost('seedance-2.0-fast', { duration: '5', resolution: '720p' }, noRefs, kuaiziCaps))!.label, /¥4$/);
  // 有参考视频按官方区间中位：720p (1.05+1.2)/2=1.125 × 5s ≈ ¥5.63
  const withVideo = await estimateEngineCost('seedance-2.0', { duration: '5', resolution: '720p' }, { images: 0, videos: 1, audios: 0 }, kuaiziCaps);
  assert.match(withVideo!.label, /¥5\.63/);
  // 万相 3.0：5s 720p × 0.6 = ¥3；MiniMax H3：5s 2K × 0.8 = ¥4
  assert.match((await estimateEngineCost('wan-3.0', { duration: '5', resolution: '720P' }, noRefs, kuaiziCaps))!.label, /¥3$/);
  assert.match((await estimateEngineCost('wan-3.0-prime', { duration: '5', resolution: '720P' }, noRefs, kuaiziCaps))!.label, /¥4\.5/);
  assert.match((await estimateEngineCost('minimax-hailuo-h3', { duration: '5', resolution: '2K' }, noRefs, kuaiziCaps))!.label, /¥4$/);
  // H3 输入图片超 5 张每张 ¥0.2：7 张 → +¥0.4
  assert.match((await estimateEngineCost('minimax-hailuo-h3', { duration: '5', resolution: '2K' }, { images: 7, videos: 0, audios: 0 }, kuaiziCaps))!.label, /¥4\.4/);
});

test('seedance channel routing: ark/runninghub 渠道不走筷子价表（RunningHub 有实时估价，ark 无价表降级）', async () => {
  assert.equal(inferCostProvider('seedance-2.0', { ...kuaiziCaps, seedanceChannel: 'ark' }), 'ark');
  assert.equal(await estimateEngineCost('seedance-2.0', { duration: '5' }, noRefs, { ...kuaiziCaps, seedanceChannel: 'ark' }), null);
  assert.equal(await estimateEngineCost('seedance-2.0', { duration: '5' }, noRefs, { ...kuaiziCaps, seedanceChannel: 'runninghub' }), null);
  // 筷子未配置时 seedance 估不出 → null（调用方降级"费用以渠道结算为准"）
  assert.equal(await estimateEngineCost('seedance-2.0', { duration: '5' }, noRefs,
    { apimart: false, kuaizi: false, dmxapi: false, seedanceChannel: 'kuaizi' }), null);
});

test('dmxapi static price table: seedream 按分辨率 + 输入图首免，gpt-image 固定次价', async () => {
  const dmxCaps: PricingCaps = { apimart: false, kuaizi: false, dmxapi: true };
  const oneK = await estimateEngineCost('seedream-v5-pro', { resolution: '1k' }, noRefs, dmxCaps);
  assert.equal(oneK!.amountCny, 0.3); assert.match(oneK!.label, /约 ¥0.3/);
  // 2K ￥0.6；3 张参考图超出首免 2 张 × ￥0.02
  const twoK = await estimateEngineCost('seedream-v5-pro', { resolution: '2k' }, { ...noRefs, images: 3 }, dmxCaps);
  assert.equal(twoK!.amountCny, 0.64);
  // gpt-image-2.5-flare 分段计价折算 ≈ ￥0.16/次；旧引擎 id 'gpt-image-2' 同价（startsWith 匹配）
  const gpt = await estimateEngineCost('gpt-image-2.5', {}, noRefs, dmxCaps);
  assert.equal(gpt!.amountCny, 0.16);
  const legacyGpt = await estimateEngineCost('gpt-image-2', {}, noRefs, dmxCaps);
  assert.equal(legacyGpt!.amountCny, 0.16);
  // 没有 dmxapi 槽位且没有 apimart → null 降级
  assert.equal(await estimateEngineCost('seedream-v5-pro', { resolution: '1k' }, noRefs,
    { apimart: false, kuaizi: false, dmxapi: false }), null);
});

test('jimeng seedance 2.5: 只标 VIP 积分口径，绝不编造金额', async () => {
  const est = await estimateEngineCost('dreamina-seedance-2.5', { duration: '5' }, noRefs,
    { apimart: false, kuaizi: false, dmxapi: false });
  assert.ok(est); assert.match(est.label, /即梦 VIP 积分扣减（499元\/15000积分）/);
  assert.equal(est.amountCny, undefined);
});

test('seedance 2.5 默认走筷子：按官方按秒价给出金额预估', async () => {
  const est = await estimateEngineCost('dreamina-seedance-2.5', { duration: '8', resolution: '720p' }, noRefs,
    { apimart: false, kuaizi: true, dmxapi: false });
  assert.ok(est);
  // 2.5 720p 无参考视频：8 × 1.51 = ¥12.08
  assert.match(est.label, /^约 ¥12\.08$/);
  assert.ok((est.amountCny ?? 0) > 0);
});

test('apimart pricing API: 美元报价按估算汇率折算，免鉴权不带任何 key', async () => {
  const original = globalThis.fetch;
  const seen: { url: string; headers?: unknown }[] = [];
  try {
    globalThis.fetch = async (url, init) => {
      seen.push({ url: String(url), headers: (init as RequestInit | undefined)?.headers });
      return new Response(JSON.stringify({ data: { action_prices: { imagine: 0.04504 } } }), { status: 200 });
    };
    const est = await estimateEngineCost('midjourney-v8.2', {}, noRefs,
      { apimart: true, kuaizi: false, dmxapi: false });
    assert.ok(est);
    // $0.04504 × 7.2 ≈ ¥0.32
    assert.equal(est.amountCny, 0.04504 * USD_TO_CNY);
    assert.match(est.label, /约 ¥0.32/);
    // 密钥纪律：免鉴权定价 API 不得带 Authorization 等任何头
    assert.ok(seen.length > 0);
    for (const call of seen) assert.equal(call.headers, undefined);
    assert.match(seen[0]!.url, /^https:\/\/apib\.ai\/api\/pricing\/model\?model=midjourney$/);
  } finally { globalThis.fetch = original; }
});

test('apimart gpt-image-2.5-flare 新格式：size_quality_prices 优先，resolution_prices["比例@分辨率"] fallback', async () => {
  const original = globalThis.fetch;
  const seen: string[] = [];
  try {
    // 定价响应同时带两种格式，验证优先级（模块级缓存 1 小时，本测试只取一次）
    globalThis.fetch = async (url) => {
      seen.push(String(url));
      return new Response(JSON.stringify({
        data: {
          size_quality_prices: { '16:9': { low: 0.0036, medium: 0.0084, high: 0.03234 } },
          resolution_prices: { '1:1@4k': 0.05 },
        },
      }), { status: 200 });
    };
    // high 质量价优先（应用默认发 quality:'high'）：$0.03234 × 7.2 ≈ ¥0.23
    const est = await estimateEngineCost('gpt-image-2.5', { aspectRatio: '16:9', resolution: '2k' }, noRefs,
      { apimart: true, kuaizi: false, dmxapi: false });
    assert.ok(est);
    assert.equal(est.amountCny, 0.03234 * USD_TO_CNY);
    assert.match(seen[0]!, /model=gpt-image-2\.5-flare/);
    // 该比例无 quality 表 → fallback resolution_prices["1:1@4k"]
    const byKey = await estimateEngineCost('gpt-image-2.5', { aspectRatio: '1:1', resolution: '4k' }, noRefs,
      { apimart: true, kuaizi: false, dmxapi: false });
    assert.equal(byKey!.amountCny, 0.05 * USD_TO_CNY);
    // 比例与分辨率键都缺失 → null 优雅降级
    const missing = await estimateEngineCost('gpt-image-2.5', { aspectRatio: '3:2', resolution: '4k' }, noRefs,
      { apimart: true, kuaizi: false, dmxapi: false });
    assert.equal(missing, null);
  } finally { globalThis.fetch = original; }
});

test('apimart unreachable → null graceful degradation（不报错、不伪装实账）', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error('offline'); };
    const est = await estimateEngineCost('minimax-h3', { duration: '5', resolution: '768P' }, noRefs,
      { apimart: true, kuaizi: false, dmxapi: false });
    assert.equal(est, null);
  } finally { globalThis.fetch = original; }
});

test('sync estimate: 筷子/DMX/即梦同步出估，APIMart 联网分支同步返回 null', () => {
  assert.ok(estimateEngineCostSync('seedance-2.0', { duration: '5' }, noRefs, kuaiziCaps));
  assert.ok(estimateEngineCostSync('seedream-v5-pro', { resolution: '1k' }, noRefs,
    { apimart: false, kuaizi: false, dmxapi: true }));
  assert.equal(estimateEngineCostSync('midjourney-v8.2', {}, noRefs,
    { apimart: true, kuaizi: false, dmxapi: false }), null);
  // providerHint 以任务真实路由为准，覆盖推断（如 minimax 实际走了 apimart）
  assert.equal(estimateEngineCostSync('minimax-hailuo-h3', { duration: '5' }, noRefs, kuaiziCaps, 'apimart'), null);
  assert.ok(estimateEngineCostSync('seedance-2.0', { duration: '5' }, noRefs,
    { apimart: false, kuaizi: false, dmxapi: false }, 'kuaizi'));
});

test('rates constants & 实账换算: 汇率 7.2，筷子实付 0.0000686 元/token', () => {
  assert.equal(USD_TO_CNY, 7.2);
  assert.equal(KUAIZI_TOKENS_PER_SECOND, 22000);
  assert.ok(Math.abs(KUAIZI_CNY_PER_TOKEN - 0.0000686) < 1e-10);
  assert.ok(Math.abs(kuaiziActualCnyFromTokens(108900) - 7.47054) < 1e-6);
  assert.equal(formatCny(7.5), '7.5');
  assert.equal(formatCny(0.324288), '0.32');
});

test('pricingCapsFromSettings: 空设置全 false，seedanceChannel 默认筷子', () => {
  const caps = pricingCapsFromSettings({});
  assert.deepEqual(caps, { apimart: false, kuaizi: false, dmxapi: false, seedanceChannel: 'kuaizi' });
  assert.equal(pricingCapsFromSettings({ seedanceEngine: 'ark' }).seedanceChannel, 'ark');
});
