import type { ImageRouteDefinition } from './metrics';

/**
 * gpt-image-2* 已不在画布引擎注册表（RunningHub 海外节点 2026-08 退役），
 * 真实渠道由 chooseGptImageChannel 路由到生图槽位（api:/dreamina:）。
 * generateForNode 的预校验用这个纯函数判断「当前配置下是否存在可路由的
 * gpt-image 渠道」：存在 → 放行给 runGeneration 做渠道路由；不存在 → 交给
 * resolveGenEngine 报出准确的「未配置 GPT 槽位」错误，而不是误报。
 */
export function gptImageRouteExists(
  routes: readonly ImageRouteDefinition[],
  engineId: string,
  hasReference: boolean,
): boolean {
  if (!engineId.startsWith('gpt-image')) return false;
  const mode = hasReference ? 'image-to-image' : 'text-to-image';
  return routes.some((r) => r.model === 'gpt-image-2' && r.mode === mode);
}
