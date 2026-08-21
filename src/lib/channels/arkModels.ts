/**
 * 火山方舟（Ark）模型目录注册表 —— Ark 渠道模型 ID 的单一事实源。
 *
 * 本模块刻意保持零依赖（不 import settingsStore / Tauri），这样：
 * 1. `node --test` 可以直接运行 arkModels.test.ts；
 * 2. scripts/check-ark-models.mjs 可以 import 本表做发布前校验。
 *
 * 数据基于 2026-08-18 对方舟模型目录的实时查询（见 docs 09-Ark渠道最新模型接入方案 §2）。
 * 目录会变动：画布/工坊/设置页/引导页的 Ark 模型下拉全部从这张表渲染；
 * 设置页「同步模型列表」会用方舟 `GET /api/v3/models` 的实时结果刷新本地缓存，
 * 同步失败时回退到本表。
 *
 * 注意：完整模型 ID 是 `<族名>-<版本日期>` 形式（如 doubao-seedance-2-0-260128），
 * 直接传族名会 404；用户自建推理接入点（ep-xxx）与目录 ID 都允许填入。
 *
 * 别名历史：imageGen 早期把 `doubao-seedream-5-0-pro-260628` 写死为 Seedream 5 Pro
 * 的中转模型 ID（与 Seedance 2.5 同属 260628 批次，曾经可能有效）；但方舟官方目录
 * 里 Seedream 5.0 的正式 ID 是 `doubao-seedream-5-0-260128`，本注册表的默认值已
 * 切换到后者（见 09 文档 §4 任务 3）。
 */

export type ArkModelModality = 'video' | 'image';
export type ArkModelTier = 'flagship' | 'fast' | 'cheap' | 'standard' | 'legacy';
export type ArkModelStatus = 'published' | 'retiring';

export interface ArkModel {
  /** 方舟目录完整模型 ID，如 doubao-seedance-2-0-260128 */
  id: string;
  label: string;
  modality: ArkModelModality;
  tier: ArkModelTier;
  /** retiring = 官方下线中，UI 应显示「即将下线」警告，不要再接入 */
  status: ArkModelStatus;
  note?: string;
}

export const ARK_MODELS: ArkModel[] = [
  // ── 视频（Seedance 家族）──
  {
    id: 'doubao-seedance-2-5-260628',
    label: 'Seedance 2.5',
    modality: 'video',
    tier: 'flagship',
    status: 'published',
    // 开通门槛：账户余额 ≥ 200 元或已购资源包；30 秒长视频、多模态参考最多 50 个。
    // 参数面以官方文档为准：https://docs.volcengine.com/docs/82379/2607688?lang=zh
    note: '最新旗舰：30 秒长视频、多模态参考最多 50 个；开通需余额 ≥ 200 元或资源包',
  },
  {
    id: 'doubao-seedance-2-0-260128',
    label: 'Seedance 2.0',
    modality: 'video',
    tier: 'flagship',
    status: 'published',
    note: '文/图生视频',
  },
  {
    id: 'doubao-seedance-2-0-fast-260128',
    label: 'Seedance 2.0 Fast',
    modality: 'video',
    tier: 'fast',
    status: 'published',
    note: '速度优先',
  },
  {
    id: 'doubao-seedance-2-0-mini-260615',
    label: 'Seedance 2.0 Mini',
    modality: 'video',
    tier: 'cheap',
    status: 'published',
    note: '低成本/高并发',
  },
  {
    id: 'doubao-seedance-1-5-pro-251215',
    label: 'Seedance 1.5 Pro',
    modality: 'video',
    tier: 'standard',
    status: 'published',
    note: '上一代旗舰',
  },
  {
    id: 'doubao-seedance-1-0-pro-250528',
    label: 'Seedance 1.0 Pro',
    modality: 'video',
    tier: 'legacy',
    status: 'published',
  },
  {
    id: 'doubao-seedance-1-0-pro-fast-251015',
    label: 'Seedance 1.0 Pro Fast',
    modality: 'video',
    tier: 'legacy',
    status: 'published',
  },
  // Retiring：保留在表里但标记下线中，UI 显示警告，不要再接入
  {
    id: 'doubao-seedance-1-0-lite-t2v-250428',
    label: 'Seedance 1.0 Lite T2V',
    modality: 'video',
    tier: 'legacy',
    status: 'retiring',
  },
  {
    id: 'doubao-seedance-1-0-lite-i2v-250428',
    label: 'Seedance 1.0 Lite I2V',
    modality: 'video',
    tier: 'legacy',
    status: 'retiring',
  },
  // ── 图片（Seedream 家族）──
  {
    id: 'doubao-seedream-5-0-260128',
    label: 'Seedream 5.0',
    modality: 'image',
    tier: 'flagship',
    status: 'published',
  },
  {
    id: 'doubao-seedream-4-5-251128',
    label: 'Seedream 4.5',
    modality: 'image',
    tier: 'standard',
    status: 'published',
  },
  {
    id: 'doubao-seedream-4-0-250828',
    label: 'Seedream 4.0',
    modality: 'image',
    tier: 'standard',
    status: 'published',
  },
  {
    id: 'doubao-seedream-3-0-t2i-250415',
    label: 'Seedream 3.0 T2I',
    modality: 'image',
    tier: 'legacy',
    status: 'retiring',
  },
];

export function getArkModel(id: string): ArkModel | undefined {
  return ARK_MODELS.find((m) => m.id === id);
}

/** 按模态过滤；默认排除 retiring（下线中）模型。 */
export function arkModelsByModality(
  modality: ArkModelModality,
  opts?: { includeRetiring?: boolean },
): ArkModel[] {
  return ARK_MODELS.filter(
    (m) => m.modality === modality && (opts?.includeRetiring || m.status === 'published'),
  );
}

/** 该模态的默认模型：第一个 published 的 flagship；没有 flagship 时退到第一个 published。 */
export function defaultArkModel(modality: ArkModelModality): ArkModel {
  const published = arkModelsByModality(modality);
  const flagship = published.find((m) => m.tier === 'flagship');
  const fallback = flagship ?? published[0];
  if (!fallback) throw new Error(`arkModels: 注册表中没有可用的 ${modality} 模型`);
  return fallback;
}

/** 默认图片模型 ID（Seedream 5.0：doubao-seedream-5-0-260128） */
export const DEFAULT_ARK_IMAGE_MODEL = defaultArkModel('image').id;
/** 默认视频模型 ID（Seedance 2.5：doubao-seedance-2-5-260628） */
export const DEFAULT_ARK_VIDEO_MODEL = defaultArkModel('video').id;

/** 是否为方舟目录的 seedance/seedream 族模型 ID（同步缓存时按此过滤）。 */
export function isArkCatalogModelId(id: string): boolean {
  return /^doubao-(seedance|seedream)-/.test(id);
}

/** 设置页「同步模型列表」写入 settingsStore 的本地缓存结构。 */
export interface ArkModelsCache {
  models: { id: string; label?: string }[];
  syncedAt: number;
}

export interface ArkModelOption {
  id: string;
  label: string;
  modality: ArkModelModality;
  /** retiring 仅可能来自静态注册表；缓存里的都是账号当前实际可用模型 */
  status: ArkModelStatus;
  source: 'cache' | 'static';
}

function inferModality(id: string): ArkModelModality {
  return id.startsWith('doubao-seedance-') ? 'video' : 'image';
}

/**
 * 下拉渲染顺序：缓存（如有）→ 静态注册表。
 * 缓存模型在前（账号实际可用），静态注册表条目去重补在后（retiring 的排在最后）。
 */
export function mergeArkModels(cache: ArkModelsCache | null | undefined): ArkModelOption[] {
  const options: ArkModelOption[] = [];
  const seen = new Set<string>();
  for (const m of cache?.models ?? []) {
    if (!m?.id || seen.has(m.id)) continue;
    seen.add(m.id);
    const known = getArkModel(m.id);
    options.push({
      id: m.id,
      label: m.label || known?.label || m.id,
      modality: known?.modality ?? inferModality(m.id),
      status: 'published',
      source: 'cache',
    });
  }
  for (const m of ARK_MODELS) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    options.push({ id: m.id, label: m.label, modality: m.modality, status: m.status, source: 'static' });
  }
  return options;
}
