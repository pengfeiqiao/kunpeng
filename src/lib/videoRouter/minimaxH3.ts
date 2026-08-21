export type MinimaxH3Channel = 'runninghub' | 'apimart';

export interface MinimaxH3Metric {
  channel: MinimaxH3Channel;
  startedAt: number;
  totalMs: number;
  success: boolean;
  error?: string;
}

const METRICS_KEY = 'kunpeng.minimaxH3RouteMetrics.v1';
const LAST_CHANNEL_KEY = 'kunpeng.minimaxH3LastChannel.v1';
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

export function getMinimaxH3Metrics(): MinimaxH3Metric[] {
  return readJson<MinimaxH3Metric[]>(METRICS_KEY, []);
}

export function recordMinimaxH3Metric(metric: MinimaxH3Metric): void {
  writeJson(METRICS_KEY, [metric, ...getMinimaxH3Metrics()].slice(0, MAX_METRICS));
}

function isHealthy(channel: MinimaxH3Channel, metrics: MinimaxH3Metric[], now: number): boolean {
  const recent = metrics
    .filter((metric) => metric.channel === channel && now - metric.startedAt <= 10 * 60_000)
    .slice(0, 5);
  if (recent.length === 0) return true;
  const firstSuccess = recent.findIndex((metric) => metric.success);
  return firstSuccess < 0 ? recent.length < 2 : firstSuccess < 2;
}

function score(channel: MinimaxH3Channel, metrics: MinimaxH3Metric[]): number {
  const recent = metrics.filter((metric) => metric.channel === channel).slice(0, 10);
  if (recent.length === 0) return 180_000;
  const successCount = recent.filter((metric) => metric.success).length;
  const successful = recent.filter((metric) => metric.success && metric.totalMs > 0);
  const avgMs = successful.length > 0
    ? successful.reduce((sum, metric) => sum + metric.totalMs, 0) / successful.length
    : 180_000;
  return avgMs + (1 - successCount / recent.length) * 600_000;
}

/**
 * Pick by recent health and latency. When evidence is missing or effectively
 * tied, alternate channels so neither provider is permanently hard-coded as
 * primary.
 */
export function selectMinimaxH3Channel(input: {
  available: MinimaxH3Channel[];
  metrics: MinimaxH3Metric[];
  lastSelected?: MinimaxH3Channel;
  now?: number;
}): MinimaxH3Channel | null {
  const available = [...new Set(input.available)];
  if (available.length === 0) return null;
  if (available.length === 1) return available[0];
  const now = input.now ?? Date.now();
  const healthy = available.filter((channel) => isHealthy(channel, input.metrics, now));
  const candidates = healthy.length > 0 ? healthy : available;

  const sampleCount = (channel: MinimaxH3Channel) =>
    input.metrics.filter((metric) => metric.channel === channel).length;
  const untested = candidates.filter((channel) => sampleCount(channel) === 0);
  if (untested.length > 0 && untested.length < candidates.length) {
    return untested.find((channel) => channel !== input.lastSelected) ?? untested[0];
  }

  const ranked = candidates
    .map((channel) => ({ channel, score: score(channel, input.metrics) }))
    .sort((a, b) => a.score - b.score);
  const competitive = ranked.filter((entry) => entry.score <= ranked[0].score + 15_000);
  if (competitive.length > 1) {
    return competitive.find((entry) => entry.channel !== input.lastSelected)?.channel
      ?? competitive[0].channel;
  }
  return ranked[0].channel;
}

export function chooseMinimaxH3Channel(available: MinimaxH3Channel[]): MinimaxH3Channel | null {
  const lastSelected = readJson<MinimaxH3Channel | undefined>(LAST_CHANNEL_KEY, undefined);
  const selected = selectMinimaxH3Channel({
    available,
    metrics: getMinimaxH3Metrics(),
    lastSelected,
  });
  if (selected) writeJson(LAST_CHANNEL_KEY, selected);
  return selected;
}
