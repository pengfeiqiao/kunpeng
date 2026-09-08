/**
 * APIMart 等价网关域名清单（零依赖叶子模块）。
 *
 * 独立成文件的原因：baseUrl.ts 顶层 import 了 @tauri-apps/api/http 与 @/ 别名，
 * 只想要这份常量清单的调用方（如 lib/pricing/estimate.ts）会被拖进 Tauri 依赖，
 * 导致 node --test 无法直接加载。这里保持零 import，单一事实源不变。
 */

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
