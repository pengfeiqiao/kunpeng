import { useSettingsStore } from '@/stores/settingsStore';
import { resolveApiKey, resolveSlotApiKey } from '@/lib/credentials';
import { APIMART_GPT_IMAGE2_SLOT_ID, APIMART_SEEDREAM_SLOT_ID } from '@/lib/apimart/contracts';

export type ImageRouteMode = 'text-to-image' | 'image-to-image';
export type ImageRouteTier = 'cheap' | 'standard';
export type ImageRouteSortMode = 'cheap-first' | 'speed-first';
export type ImageRouteModel = 'gpt-image-2' | 'seedream-v5-pro';

export interface ImageRouteDefinition {
  id: string;
  label: string;
  provider: 'runninghub' | 'dmxapi' | 'aihubmix' | 'zexapi' | 'dreamina' | 'apimart';
  mode: ImageRouteMode;
  tier: ImageRouteTier;
  model: ImageRouteModel;
  slotId?: string;
  engineId?: string;
}

export interface ImageRouteMetric {
  routeId: string;
  engineId: string;
  mode: ImageRouteMode;
  startedAt: string;
  uploadMs?: number;
  submitMs?: number;
  queueMs?: number;
  downloadMs?: number;
  totalMs: number;
  success: boolean;
  errorType?: string;
  errorMessage?: string;
  webappId?: string;
}

interface RouteStats {
  routeId: string;
  attempts: number;
  successes: number;
  failures: number;
  successRate: number;
  avgMs: number;
  lastError?: string;
}

const STORAGE_KEY = 'kunpeng.imageRouteMetrics.v1';
const DAILY_KEY = 'kunpeng.imageRouteExplore.v1';
const ORDER_KEY = 'kunpeng.imageRouteOrder.v1';
const SORT_MODE_KEY = 'kunpeng.imageRouteSortMode.v1';
const SELECTED_AT_KEY = 'kunpeng.imageRouteSelectedAt.v1';
const MAX_METRICS = 300;
const RHTV_ROUTES: ImageRouteDefinition[] = [
  // 2026-08: RunningHub 海外节点（GPT-Image-2 低价/官方通道）已下线，RHTV
  // 侧只保留国内节点的 Seedream 路由。GPT-Image-2 由下方 api: 槽位承接。
  { id: 'seedream-v5-pro-rhtv', label: 'RunningHub Seedream 5 Pro 文生', provider: 'runninghub', mode: 'text-to-image', tier: 'standard', model: 'seedream-v5-pro', engineId: 'seedream-v5-pro' },
  { id: 'seedream-v5-pro-rhtv-i2i', label: 'RunningHub Seedream 5 Pro 图生', provider: 'runninghub', mode: 'image-to-image', tier: 'standard', model: 'seedream-v5-pro', engineId: 'seedream-v5-pro-i2i' },
  { id: 'dreamina:seedream-v5-pro:text-to-image', label: '即梦 Seedream 5 Pro 文生', provider: 'dreamina', mode: 'text-to-image', tier: 'standard', model: 'seedream-v5-pro', engineId: 'seedream-v5-pro' },
  { id: 'dreamina:seedream-v5-pro:image-to-image', label: '即梦 Seedream 5 Pro 图生', provider: 'dreamina', mode: 'image-to-image', tier: 'standard', model: 'seedream-v5-pro', engineId: 'seedream-v5-pro-i2i' },
];

function defaultRouteRank(route: ImageRouteDefinition): number {
  const modeOffset = route.mode === 'text-to-image' ? 0 : 100;
  if (route.provider === 'zexapi') return modeOffset + 0;
  if (route.provider === 'dmxapi' && route.tier === 'standard') return modeOffset + 10;
  if (route.provider === 'aihubmix') return modeOffset + 20;
  if (route.provider === 'dmxapi' && route.tier === 'cheap') return modeOffset + 30;
  if (route.provider === 'runninghub' && route.tier === 'standard') return modeOffset + 40;
  if (route.provider === 'runninghub' && route.tier === 'cheap') return modeOffset + 50;
  // RunningHub and APIMart are peers for Seedream. Runtime health/latency
  // decides between them; neither provider is a permanently fixed primary.
  if (route.provider === 'apimart') return modeOffset + 40;
  // Dreamina depends on a local login session and account credits. Keep it as the
  // last Seedream fallback so a missing session cannot mask healthy API routes.
  if (route.provider === 'dreamina') return modeOffset + 80;
  return modeOffset + 90;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Metrics are helpful but non-critical.
  }
}

export function getImageRouteMetrics(): ImageRouteMetric[] {
  return readJson<ImageRouteMetric[]>(STORAGE_KEY, []);
}

export function recordImageRouteMetric(metric: ImageRouteMetric): void {
  const metrics = getImageRouteMetrics();
  metrics.unshift(metric);
  writeJson(STORAGE_KEY, metrics.slice(0, MAX_METRICS));
}

export function clearImageRouteMetrics(): void {
  writeJson(STORAGE_KEY, []);
}

export function getImageRouteStats(): RouteStats[] {
  const recent = getImageRouteMetrics().slice(0, 120);
  const groups = new Map<string, ImageRouteMetric[]>();
  for (const m of recent) {
    const arr = groups.get(m.routeId) ?? [];
    arr.push(m);
    groups.set(m.routeId, arr);
  }
  return [...groups.entries()].map(([routeId, arr]) => {
    const successes = arr.filter((m) => m.success);
    return {
      routeId,
      attempts: arr.length,
      successes: successes.length,
      failures: arr.length - successes.length,
      successRate: arr.length ? successes.length / arr.length : 0,
      avgMs: successes.length
        ? Math.round(successes.reduce((sum, m) => sum + m.totalMs, 0) / successes.length)
        : 0,
      lastError: arr.find((m) => !m.success)?.errorMessage,
    };
  }).sort((a, b) => {
    const scoreA = a.successRate * 100000 - a.avgMs;
    const scoreB = b.successRate * 100000 - b.avgMs;
    return scoreB - scoreA;
  });
}

export function getImageRouteDefinitions(): ImageRouteDefinition[] {
  const settings = useSettingsStore.getState();
  const slots = settings.imageApiSlots ?? [];
  const apiRoutes = slots
    .filter((s) => s.enabled && s.baseUrl && resolveSlotApiKey(settings, s))
    .flatMap<ImageRouteDefinition>((slot) => {
      const provider = slot.provider ?? (slot.baseUrl.includes('aihubmix') ? 'aihubmix' : slot.baseUrl.includes('zexapi') ? 'zexapi' : 'dmxapi');
      const providerLabel = provider === 'aihubmix' ? 'AiHubMix' : provider === 'zexapi' ? 'ZexAPI' : 'DMX';
      const gptCombos: Array<{ mode: ImageRouteMode; tier: ImageRouteTier }> = provider === 'dmxapi'
        ? [
            { mode: 'text-to-image', tier: 'cheap' },
            { mode: 'image-to-image', tier: 'cheap' },
            { mode: 'text-to-image', tier: 'standard' },
            { mode: 'image-to-image', tier: 'standard' },
          ]
        : provider === 'zexapi'
          ? [
              { mode: 'text-to-image', tier: 'cheap' },
              { mode: 'image-to-image', tier: 'cheap' },
            ]
        : [
            { mode: 'text-to-image', tier: 'standard' },
            { mode: 'image-to-image', tier: 'standard' },
          ];
      const gptRoutes = gptCombos.map(({ mode, tier }) => {
        const tierLabel = tier === 'cheap' ? '低价' : '普通';
        const modeLabel = mode === 'image-to-image' ? '图生' : '文生';
        return {
          id: `api:${slot.id}:${tier}:${mode}`,
          label: `${providerLabel} ${tierLabel}${modeLabel}`,
          provider,
          mode,
          tier,
          model: 'gpt-image-2' as const,
          slotId: slot.id,
        };
      });
      const seedreamRoutes = provider === 'dmxapi'
        ? ([
            { mode: 'text-to-image' as const, tier: 'standard' as const },
            { mode: 'image-to-image' as const, tier: 'standard' as const },
          ].map(({ mode, tier }) => {
            const modeLabel = mode === 'image-to-image' ? '图生' : '文生';
            return {
              id: `api:${slot.id}:seedream-v5-pro:${mode}`,
              label: `${providerLabel} Seedream 5 Pro ${modeLabel}`,
              provider,
              mode,
              tier,
              model: 'seedream-v5-pro' as const,
              slotId: slot.id,
            };
          }))
        : [];
      return [...gptRoutes, ...seedreamRoutes];
    });
  // Do not advertise a built-in API route when it cannot possibly run. The
  // fallback loop treats every definition as a real attempt, so including an
  // unconfigured RunningHub route produced a misleading extra failure and
  // could hide the useful error from the next configured provider.
  const builtInRoutes = RHTV_ROUTES.filter((route) => (
    route.provider !== 'runninghub' || Boolean(resolveApiKey(settings, 'runninghub', settings.runninghubApiKey).trim())
  ));
  const apimartKey = resolveApiKey(settings, 'omniApimart', settings.omniApimartApiKey).trim();
  const apimartSeedreamRoutes: ImageRouteDefinition[] = apimartKey
    ? [
        {
          id: `api:${APIMART_SEEDREAM_SLOT_ID}:seedream-v5-pro:text-to-image`,
          label: 'APIMart Seedream 5 Pro 文生',
          provider: 'apimart',
          mode: 'text-to-image',
          tier: 'standard',
          model: 'seedream-v5-pro',
          slotId: APIMART_SEEDREAM_SLOT_ID,
        },
        {
          id: `api:${APIMART_SEEDREAM_SLOT_ID}:seedream-v5-pro:image-to-image`,
          label: 'APIMart Seedream 5 Pro 图生',
          provider: 'apimart',
          mode: 'image-to-image',
          tier: 'standard',
          model: 'seedream-v5-pro',
          slotId: APIMART_SEEDREAM_SLOT_ID,
        },
      ]
    : [];
  // APIMart GPT-Image-2（异步任务接口，与生图槽位同池容灾；多域名线路由
  // apimart/client 的并行健康检测挑选）。
  const apimartGptImage2Routes: ImageRouteDefinition[] = apimartKey
    ? [
        {
          id: `api:${APIMART_GPT_IMAGE2_SLOT_ID}:gpt-image-2:text-to-image`,
          label: 'APIMart GPT-Image-2 文生',
          provider: 'apimart',
          mode: 'text-to-image',
          tier: 'standard',
          model: 'gpt-image-2',
          slotId: APIMART_GPT_IMAGE2_SLOT_ID,
        },
        {
          id: `api:${APIMART_GPT_IMAGE2_SLOT_ID}:gpt-image-2:image-to-image`,
          label: 'APIMart GPT-Image-2 图生',
          provider: 'apimart',
          mode: 'image-to-image',
          tier: 'standard',
          model: 'gpt-image-2',
          slotId: APIMART_GPT_IMAGE2_SLOT_ID,
        },
      ]
    : [];
  return [...builtInRoutes, ...apiRoutes, ...apimartSeedreamRoutes, ...apimartGptImage2Routes];
}

export function getImageRouteDefinition(routeId: string): ImageRouteDefinition | undefined {
  return getImageRouteDefinitions().find((r) => r.id === routeId);
}

export function getImageRouteOrder(): string[] {
  const defs = getImageRouteDefinitions();
  const defaultOrder = [...defs].sort((a, b) => defaultRouteRank(a) - defaultRouteRank(b)).map((r) => r.id);
  const saved = readJson<string[]>(ORDER_KEY, []);
  return [
    ...saved.filter((id) => defs.some((r) => r.id === id)),
    ...defaultOrder.filter((id) => !saved.includes(id)),
  ];
}

export function setImageRouteOrder(order: string[]): void {
  const uniq = Array.from(new Set(order.filter(Boolean)));
  writeJson(ORDER_KEY, uniq);
}

export function moveImageRoute(routeId: string, dir: -1 | 1): void {
  const order = getImageRouteOrder();
  const idx = order.indexOf(routeId);
  const to = idx + dir;
  if (idx < 0 || to < 0 || to >= order.length) return;
  [order[idx], order[to]] = [order[to], order[idx]];
  setImageRouteOrder(order);
}

export function getImageRouteSortMode(): ImageRouteSortMode {
  return readJson<ImageRouteSortMode>(SORT_MODE_KEY, 'cheap-first');
}

export function setImageRouteSortMode(mode: ImageRouteSortMode): void {
  writeJson(SORT_MODE_KEY, mode);
}

function statsByRoute(): Map<string, RouteStats> {
  return new Map(getImageRouteStats().map((s) => [s.routeId, s]));
}

function routeScore(routeId: string): RouteStats | undefined {
  return statsByRoute().get(routeId);
}

function routeRankValue(route: ImageRouteDefinition, mode: ImageRouteSortMode): number {
  const s = routeScore(route.id);
  // Unknown routes need a finite estimate. Infinity made every never-tested
  // route tie, so stale manual order could put Dreamina ahead of API routes.
  const avg = s?.avgMs && s.avgMs > 0 ? s.avgMs : 120_000;
  const successPenalty = s ? (1 - s.successRate) * 600_000 : 60_000;
  if (mode === 'speed-first') return avg + successPenalty;
  const cheapTooSlow = route.tier === 'cheap' && avg > 180_000;
  const runningHubCheapRisky = route.provider === 'runninghub' && route.tier === 'cheap' && (avg > 150_000 || (s && s.successRate < 0.8));
  const tierBias = route.tier === 'cheap' && !cheapTooSlow && !runningHubCheapRisky
      ? (route.provider === 'zexapi' ? -30_000 : route.provider === 'dmxapi' ? 0 : 120_000)
    : route.tier === 'standard'
      ? (route.provider === 'dreamina' ? 360_000 : 60_000)
      : 360_000;
  return tierBias + avg + successPenalty;
}

export function sortImageRouteOrder(mode: ImageRouteSortMode): string[] {
  const defs = getImageRouteDefinitions();
  const current = getImageRouteOrder();
  const byManual = new Map(current.map((id, idx) => [id, idx]));
  const next = [...defs].sort((a, b) => {
    if (a.mode !== b.mode) return a.mode === 'text-to-image' ? -1 : 1;
    const va = routeRankValue(a, mode);
    const vb = routeRankValue(b, mode);
    if (va !== vb) return va - vb;
    return (byManual.get(a.id) ?? 999) - (byManual.get(b.id) ?? 999);
  }).map((r) => r.id);
  setImageRouteSortMode(mode);
  setImageRouteOrder(next);
  return next;
}

function routeHealthy(routeId: string): boolean {
  // 只看最近 10 分钟内的记录——网络抖动导致的失败不应永久标记通道为不健康，
  // 否则一次全网故障会让所有通道固化在不健康状态，之后每次生成都"所有通道均失败"。
  const tenMinAgo = Date.now() - 10 * 60 * 1000;
  const recent = getImageRouteMetrics()
    .filter((m) => m.routeId === routeId && new Date(m.startedAt).getTime() >= tenMinAgo)
    .slice(0, 5);
  if (recent.length === 0) return true; // 近期无记录视为健康（允许尝试）
  const consecutiveFailures = recent.findIndex((m) => m.success);
  return consecutiveFailures < 0 ? recent.length < 2 : consecutiveFailures < 2;
}

function dailyExploreCount(): number {
  const data = readJson<Record<string, number>>(DAILY_KEY, {});
  return data[todayKey()] ?? 0;
}

function bumpDailyExplore(): void {
  const day = todayKey();
  const data = readJson<Record<string, number>>(DAILY_KEY, {});
  writeJson(DAILY_KEY, { ...data, [day]: (data[day] ?? 0) + 1 });
}

function orderedRoutes(routes: string[]): string[] {
  const order = getImageRouteOrder();
  return [...routes].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
}

function weightedPick(routes: string[]): string {
  const stats = getImageRouteStats();
  const defs = getImageRouteDefinitions();
  const defById = new Map(defs.map((d) => [d.id, d]));
  const sortMode = getImageRouteSortMode();
  const ranked = orderedRoutes(routes)
    .filter(routeHealthy)
    .sort((a, b) => {
      const sa = stats.find((s) => s.routeId === a);
      const sb = stats.find((s) => s.routeId === b);
      const da = defById.get(a);
      const db = defById.get(b);
      if (da && db) {
        const va = routeRankValue(da, sortMode);
        const vb = routeRankValue(db, sortMode);
        if (va !== vb) return va - vb;
      }
      if (!sa && !sb) return orderedRoutes(routes).indexOf(a) - orderedRoutes(routes).indexOf(b);
      if (!sa) return 1;
      if (!sb) return -1;
      return (sb.successRate - sa.successRate) || (sa.avgMs - sb.avgMs);
    });
  if (ranked.length === 0) return orderedRoutes(routes)[0] ?? routes[0];
  const bestDef = defById.get(ranked[0]);
  const bestScore = bestDef ? routeRankValue(bestDef, sortMode) : 0;
  const competitive = ranked.filter((routeId) => {
    const def = defById.get(routeId);
    return def ? routeRankValue(def, sortMode) <= bestScore + 5_000 : routeId === ranked[0];
  });
  const selectedAt = readJson<Record<string, number>>(SELECTED_AT_KEY, {});
  const selected = competitive.length > 1
    ? [...competitive].sort((a, b) => (selectedAt[a] ?? 0) - (selectedAt[b] ?? 0))[0]
    : ranked[0];
  writeJson(SELECTED_AT_KEY, { ...selectedAt, [selected]: Date.now() });
  return selected;
}

export function pickNextHealthyChannel(mode: ImageRouteMode, excludeIds: Set<string>, model: ImageRouteModel = 'gpt-image-2'): string | null {
  const all = getImageRouteDefinitions()
    .filter((r) => r.model === model && r.mode === mode && !excludeIds.has(r.id))
    .map((r) => r.id);
  if (all.length === 0) return null;
  const healthy = all.filter(routeHealthy);
  // 兜底：所有通道都不健康时（如全网故障后的固化状态），不卡死，按排序取最靠前的尝试。
  // 让用户能重试，而不是永久"所有通道均失败"。
  if (healthy.length === 0) return weightedPick(all) ?? all[0] ?? null;
  return weightedPick(healthy);
}

export function chooseGptImageChannel(requestedEngineId: string, hasReference: boolean): string {
  const mode: ImageRouteMode = hasReference ? 'image-to-image' : 'text-to-image';
  // RunningHub 的 GPT-Image-2 通道（海外节点）已于 2026-08 下线，只能选择
  // 生图 API 槽位（dmxapi/aihubmix/zexapi 等 api: 路由）。
  const apiRoutes = getImageRouteDefinitions()
    .filter((r) => r.model === 'gpt-image-2' && r.mode === mode)
    .map((r) => r.id);
  if (apiRoutes.length === 0) return requestedEngineId;

  if (requestedEngineId.startsWith('gpt-image-2')) {
    const explore = dailyExploreCount() < 5 && Math.random() < 0.35;
    if (explore) {
      const healthyCandidates = apiRoutes.filter(routeHealthy);
      if (healthyCandidates.length > 0) {
        bumpDailyExplore();
        return healthyCandidates[Math.floor(Math.random() * healthyCandidates.length)];
      }
    }
    return weightedPick(apiRoutes);
  }

  return requestedEngineId;
}

export function chooseSeedreamProChannel(requestedEngineId: string, hasReference: boolean): string {
  const mode: ImageRouteMode = hasReference ? 'image-to-image' : 'text-to-image';
  const candidates = getImageRouteDefinitions()
    .filter((r) => r.model === 'seedream-v5-pro' && r.mode === mode)
    .map((r) => r.id);
  if (candidates.length === 0) return requestedEngineId;
  if (requestedEngineId === 'seedream-v5-pro' || requestedEngineId === 'seedream-v5-pro-i2i') {
    return weightedPick(candidates);
  }
  // Explicit provider selections are honored only while that provider is
  // configured. This also makes old projects recover after a key is removed.
  return candidates.includes(requestedEngineId) ? requestedEngineId : weightedPick(candidates);
}

export function imageApiSlotsConfigured(): boolean {
  const settings = useSettingsStore.getState();
  return (settings.imageApiSlots ?? []).some((s) => s.enabled && s.baseUrl && resolveSlotApiKey(settings, s));
}
