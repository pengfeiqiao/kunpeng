/**
 * 万相 3.0 三渠道选路：筷子（主渠道，默认优先）→ RunningHub → APIMart。
 * 与 minimaxH3 路由同构：按近 10 分钟健康度跳过连续失败的渠道，
 * 同健康时保持「筷子优先」的固定顺序（用户明确要求筷子为主渠道，
 * 不做 minimaxH3 那样的 latency 轮换）。
 */
export type Wan3Channel = 'kuaizi' | 'runninghub' | 'apimart';

export interface Wan3Metric {
  channel: Wan3Channel;
  startedAt: number;
  totalMs: number;
  success: boolean;
  error?: string;
}

/** 主渠道优先顺序：筷子 → RunningHub → APIMart */
export const WAN3_CHANNEL_PREFERENCE: Wan3Channel[] = ['kuaizi', 'runninghub', 'apimart'];

const METRICS_KEY = 'kunpeng.wan3RouteMetrics.v1';
const MAX_METRICS = 100;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // Routing history improves selection but must never block generation.
  }
}

export function getWan3Metrics(): Wan3Metric[] {
  return readJson<Wan3Metric[]>(METRICS_KEY, []);
}

export function recordWan3Metric(metric: Wan3Metric): void {
  writeJson(METRICS_KEY, [metric, ...getWan3Metrics()].slice(0, MAX_METRICS));
}

function isHealthy(channel: Wan3Channel, metrics: Wan3Metric[], now: number): boolean {
  const recent = metrics
    .filter((metric) => metric.channel === channel && now - metric.startedAt <= 10 * 60_000)
    .slice(0, 5);
  if (recent.length === 0) return true;
  const firstSuccess = recent.findIndex((metric) => metric.success);
  return firstSuccess < 0 ? recent.length < 2 : firstSuccess < 2;
}

/**
 * 按偏好顺序选出第一个健康的可用渠道；全都不健康时仍返回偏好序第一个
 * （让它失败并触发后续容灾，而不是直接放弃）。
 */
export function selectWan3Channel(input: {
  available: Wan3Channel[];
  metrics: Wan3Metric[];
  now?: number;
}): Wan3Channel | null {
  const available = WAN3_CHANNEL_PREFERENCE.filter((channel) => input.available.includes(channel));
  if (available.length === 0) return null;
  const now = input.now ?? Date.now();
  const healthy = available.filter((channel) => isHealthy(channel, input.metrics, now));
  return healthy[0] ?? available[0];
}

export function chooseWan3Channel(available: Wan3Channel[]): Wan3Channel | null {
  return selectWan3Channel({ available, metrics: getWan3Metrics() });
}

/** 容灾顺序：从偏好序中去掉已试过的渠道 */
export function wan3FallbackOrder(available: Wan3Channel[], tried: Wan3Channel[]): Wan3Channel[] {
  return WAN3_CHANNEL_PREFERENCE.filter(
    (channel) => available.includes(channel) && !tried.includes(channel),
  );
}

const WAN3_DOC_EXT = /\.(docx?|xlsx?|pptx?|pdf|txt|key|pages|numbers|md)([?#].*)?$/i;

/** 万相 3.0 参考链接分类：文档扩展名 → file（文档），其余公网 URL → link（网页）。 */
export function classifyWan3LinkUrl(url: string): 'document' | 'link' {
  return WAN3_DOC_EXT.test(url.trim()) ? 'document' : 'link';
}
