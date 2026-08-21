/**
 * Ark 模型列表动态同步（09 文档 §3.2）。
 *
 * 用用户已配置的 Ark Key 调方舟 OpenAI 兼容的 `GET {baseUrl}/api/v3/models`，
 * 把 doubao-seedance / doubao-seedream 族模型合并进本地缓存
 * （settingsStore.arkModelsCache）；同步失败由调用方回退到静态注册表
 * （src/lib/channels/arkModels.ts）并在 UI 提示。
 *
 * 安全约束：绝不打印 / 抛出包含 API Key 本体的内容。
 */

import { fetch, ResponseType } from '@tauri-apps/api/http';
import { useSettingsStore } from '@/stores/settingsStore';
import { resolveApiKey, resolveCredential } from '@/lib/credentials';
import { isArkCatalogModelId, type ArkModelsCache } from '@/lib/channels/arkModels';

export const ARK_DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com';

/** 凭证里存的 baseUrl 可能带 /api/v3 后缀；models 接口固定在 {host}/api/v3/models。 */
function arkApiV3Base(baseUrl: string): string {
  const trimmed = (baseUrl || ARK_DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  return trimmed.endsWith('/api/v3') ? trimmed : `${trimmed}/api/v3`;
}

interface ArkModelsResponse {
  data?: { id?: string }[];
}

/**
 * 拉取方舟模型目录并返回缓存结构；失败抛错（错误信息不含 key）。
 * 只保留 seedance/seedream 族目录 ID；用户自建接入点（ep-xxx）不属于目录同步范围。
 */
export async function syncArkModels(): Promise<ArkModelsCache> {
  const state = useSettingsStore.getState();
  const apiKey = resolveApiKey(state, 'ark', state.arkApiKey);
  if (!apiKey) throw new Error('未配置火山方舟 API Key，请先填写后再同步');

  const credBaseUrl = resolveCredential(state, state.credentialRefs?.ark)?.baseUrl ?? '';
  const url = `${arkApiV3Base(credBaseUrl)}/models`;

  const resp = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    responseType: ResponseType.JSON,
    timeout: 30,
  });
  if (!resp.ok) {
    throw new Error(`方舟模型列表请求失败（HTTP ${resp.status}）`);
  }
  const data = resp.data as ArkModelsResponse;
  const raw = Array.isArray(data?.data) ? data.data : [];
  const models = raw
    .map((m) => ({ id: typeof m?.id === 'string' ? m.id : '' }))
    .filter((m) => m.id && isArkCatalogModelId(m.id));
  return { models, syncedAt: Date.now() };
}
