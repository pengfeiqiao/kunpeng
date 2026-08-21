import { fetch as tauriFetch, ResponseType } from '@tauri-apps/api/http';

/**
 * APIMart is reachable through several equivalent gateway domains. Keep the
 * documented API host in the pool and select the currently healthy route
 * before a paid submission instead of pinning any single domain.
 */
export const APIMART_BASE_URLS = [
  'https://api.apimart.ai',
  'https://apib.ai',
  'https://aiuxu.com',
  'https://aishuch.com',
] as const;

export const APIMART_BASE_URL = 'https://api.apimart.ai';

export interface ApimartRouteProbeResult {
  baseUrl: string;
  host: string;
  reachable: boolean;
  status?: number;
  latencyMs: number;
  error?: string;
}

const CACHE_MS = 2 * 60_000;
const FAILURE_COOLDOWN_MS = 60_000;
let cached: { baseUrl: string; expiresAt: number } | undefined;
let pendingProbe: Promise<string> | undefined;
const routeCooldowns = new Map<string, number>();

function cleanBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function availableCandidates(excluded: Set<string>): string[] {
  const now = Date.now();
  const all = APIMART_BASE_URLS
    .map(cleanBaseUrl)
    .filter((baseUrl) => !excluded.has(baseUrl));
  const outsideCooldown = all.filter((baseUrl) => (routeCooldowns.get(baseUrl) ?? 0) <= now);
  return outsideCooldown.length > 0 ? outsideCooldown : all;
}

async function probe(baseUrl: string, apiKey: string): Promise<string> {
  const response = await tauriFetch(`${baseUrl}/v1/models`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    responseType: ResponseType.JSON,
    timeout: 10,
  });
  // 4xx still proves that DNS, TCP and TLS reached the APIMart gateway. A 5xx
  // gateway is skipped so generation does not start on an unhealthy route.
  if (response.status <= 0 || response.status >= 500) {
    throw new Error(`HTTP ${response.status}`);
  }
  return baseUrl;
}

async function probeWithDetails(baseUrl: string, apiKey: string): Promise<ApimartRouteProbeResult> {
  const startedAt = performance.now();
  try {
    const response = await tauriFetch(`${baseUrl}/v1/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      responseType: ResponseType.JSON,
      timeout: 10,
    });
    const reachable = response.status > 0 && response.status < 500;
    return {
      baseUrl,
      host: new URL(baseUrl).host,
      reachable,
      status: response.status,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      ...(!reachable ? { error: `HTTP ${response.status}` } : {}),
    };
  } catch (error) {
    return {
      baseUrl,
      host: new URL(baseUrl).host,
      reachable: false,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Read-only connectivity diagnostics for Agent and settings surfaces. */
export async function probeApimartRoutes(
  apiKey: string,
  options: { refreshSelection?: boolean } = {},
): Promise<{ selectedBaseUrl?: string; routes: ApimartRouteProbeResult[] }> {
  if (options.refreshSelection) invalidateApimartBaseUrl();
  const routes = await Promise.all(APIMART_BASE_URLS.map((baseUrl) => probeWithDetails(baseUrl, apiKey)));
  const selected = routes
    .filter((route) => route.reachable)
    .sort((a, b) => a.latencyMs - b.latencyMs)[0];
  if (selected) cached = { baseUrl: selected.baseUrl, expiresAt: Date.now() + CACHE_MS };
  return { selectedBaseUrl: selected?.baseUrl, routes };
}

function raceHealthyBase(apiKey: string, excluded = new Set<string>()): Promise<string> {
  const candidates = availableCandidates(excluded);
  if (candidates.length === 0) throw new Error('没有可用的 APIMart 线路');

  return new Promise((resolve, reject) => {
    let settled = false;
    let remaining = candidates.length;
    const failures: string[] = [];
    for (const baseUrl of candidates) {
      void probe(baseUrl, apiKey)
        .then((healthy) => {
          if (settled) return;
          settled = true;
          resolve(healthy);
        })
        .catch((error) => {
          failures.push(`${baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
        })
        .finally(() => {
          remaining -= 1;
          if (!settled && remaining === 0) {
            reject(new Error(`APIMart 所有线路均不可达：${failures.join('；')}`));
          }
        });
    }
  });
}

export async function resolveApimartBaseUrl(
  apiKey: string,
  options: { force?: boolean; exclude?: string[] } = {},
): Promise<string> {
  const excluded = new Set((options.exclude ?? []).map(cleanBaseUrl));
  const now = Date.now();
  if (!options.force && cached && cached.expiresAt > now && !excluded.has(cached.baseUrl)) {
    return cached.baseUrl;
  }
  if (!options.force && pendingProbe && excluded.size === 0) return pendingProbe;

  const request = raceHealthyBase(apiKey, excluded).then((baseUrl) => {
    cached = { baseUrl, expiresAt: Date.now() + CACHE_MS };
    return baseUrl;
  });
  if (excluded.size === 0) pendingProbe = request;
  try {
    return await request;
  } finally {
    if (pendingProbe === request) pendingProbe = undefined;
  }
}

export function invalidateApimartBaseUrl(baseUrl?: string): void {
  if (!baseUrl) {
    cached = undefined;
    routeCooldowns.clear();
    return;
  }
  const normalized = cleanBaseUrl(baseUrl);
  routeCooldowns.set(normalized, Date.now() + FAILURE_COOLDOWN_MS);
  if (cached?.baseUrl === normalized) cached = undefined;
}

/**
 * A request that failed before TCP/TLS connected is known not to have reached
 * the paid create endpoint. Only this narrow failure class may switch gateway
 * and repeat a POST automatically.
 */
export function isApimartPreConnectFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:tcp connect error|error trying to connect|connection refused|failed to lookup address|dns error|network is unreachable|host is unreachable|os error 60)/i.test(message);
}

export class ApimartAllRoutesConnectError extends Error {
  constructor(detail: string) {
    super(`APIMart 四条线路当前均无法建立连接：${detail}`);
    this.name = 'ApimartAllRoutesConnectError';
  }
}

export async function withApimartSubmitFailover<T>(
  apiKey: string,
  request: (baseUrl: string) => Promise<T>,
): Promise<{ baseUrl: string; value: T }> {
  const failures: string[] = [];
  const tried: string[] = [];
  for (let attempt = 0; attempt < APIMART_BASE_URLS.length; attempt += 1) {
    const baseUrl = await resolveApimartBaseUrl(apiKey, {
      force: attempt > 0,
      exclude: tried,
    });
    tried.push(baseUrl);
    try {
      return { baseUrl, value: await request(baseUrl) };
    } catch (error) {
      if (!isApimartPreConnectFailure(error)) throw error;
      failures.push(`${baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
      invalidateApimartBaseUrl(baseUrl);
    }
  }
  throw new ApimartAllRoutesConnectError(failures.join('；'));
}

export async function withApimartGetFailover<T>(
  apiKey: string,
  request: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const failures: string[] = [];
  const tried: string[] = [];
  for (let attempt = 0; attempt < APIMART_BASE_URLS.length; attempt += 1) {
    const baseUrl = await resolveApimartBaseUrl(apiKey, {
      force: attempt > 0,
      exclude: tried,
    });
    tried.push(baseUrl);
    try {
      return await request(baseUrl);
    } catch (error) {
      failures.push(`${baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
      invalidateApimartBaseUrl(baseUrl);
    }
  }
  throw new Error(`APIMart 查询线路全部失败：${failures.join('；')}`);
}
