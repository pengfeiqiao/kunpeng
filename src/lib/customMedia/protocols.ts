/**
 * 自定义媒体插件的协议类型与历史值迁移。
 *
 * 前端只被允许说标准协议；供应商私有契约一律由项目内 Python 适配服务转换：
 *   - AutoDL ComfyUI 工作流 → scripts/minimax_comfyui_proxy.py → 标准异步协议
 *   - Pixhub 的 generations/edits 拆分与 multipart → scripts/pixhub_images_proxy.py → 标准同步协议
 */
export type CustomMediaProtocol = 'openai-images' | 'apimart-async';

/** 已下线协议的历史值 → 现行标准协议（老用户的持久化配置不能因为删协议而失效）。 */
const LEGACY_PROTOCOLS: Record<string, CustomMediaProtocol> = {
  'pixhub-gpt-image': 'openai-images',
  'minimax-comfyui': 'apimart-async',
};

export function normalizeStoredProtocol(raw: unknown): CustomMediaProtocol {
  const value = typeof raw === 'string' ? raw : '';
  if (value === 'openai-images' || value === 'apimart-async') return value;
  return LEGACY_PROTOCOLS[value] ?? 'apimart-async';
}

/** 迁移持久化插件里已下线的协议值；其余字段与顺序保持不变。 */
export function migrateStoredProtocols<T extends { protocol: string }>(apis: T[]): T[] {
  return apis.map((api) => {
    const next = normalizeStoredProtocol(api.protocol);
    return next === api.protocol ? api : { ...api, protocol: next };
  });
}
