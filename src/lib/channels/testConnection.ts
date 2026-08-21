/**
 * 「测试连接」共享助手 —— 引导页、聊天空态补配卡、设置页共用。
 *
 * 安全约束：任何失败路径都返回 false 或抛出不含 API Key 本体的错误；
 * 绝不把 key 打进日志。
 */

import { fetch as tauriFetch, ResponseType } from '@tauri-apps/api/http';
import {
  GLMProvider,
  DeepSeekProvider,
  KimiProvider,
  type Provider,
} from '@/lib/agent/providers';

/** 聊天 provider 测试：实例化对应 Provider 并走其 healthCheck（与 ProviderSettings 同一套逻辑）。 */
export async function testChatProviderKey(
  providerId: string,
  apiKey: string,
  baseUrl?: string,
  modelId?: string,
): Promise<boolean> {
  if (!apiKey.trim()) return false;
  let provider: Provider | null = null;
  switch (providerId) {
    case 'glm':
      provider = new GLMProvider({ apiKey, baseUrl: baseUrl || undefined, modelId: modelId || undefined });
      break;
    case 'deepseek':
      provider = new DeepSeekProvider({ apiKey, baseUrl: baseUrl || undefined, modelId: modelId || undefined });
      break;
    case 'kimi':
      provider = new KimiProvider({ apiKey, baseUrl: baseUrl || undefined, modelId: modelId || undefined });
      break;
    default:
      return false;
  }
  try {
    return provider.healthCheck ? await provider.healthCheck() : true;
  } catch {
    return false;
  }
}

/**
 * OpenAI 兼容渠道的通用探活：GET {baseUrl}/v1/models。
 * - 2xx → true；
 * - 401/403 → false（地址通但 Key 无效）；
 * - 其他 HTTP 状态 → true（服务可达，模型列表接口未必开放）；
 * - 网络错误/超时 → false。
 */
export async function testModelsEndpoint(baseUrl: string, apiKey: string): Promise<boolean> {
  if (!baseUrl.trim() || !apiKey.trim()) return false;
  try {
    const resp = await tauriFetch(`${baseUrl.trim().replace(/\/+$/, '')}/v1/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey.trim()}` },
      responseType: ResponseType.JSON,
      timeout: 15,
    });
    if (resp.status === 401 || resp.status === 403) return false;
    return true;
  } catch {
    return false;
  }
}

/** 方舟（Ark）渠道测试：模型列表固定在 {host}/api/v3/models。 */
export async function testArkKey(apiKey: string): Promise<boolean> {
  return testModelsEndpoint('https://ark.cn-beijing.volces.com/api/v3', apiKey);
}
