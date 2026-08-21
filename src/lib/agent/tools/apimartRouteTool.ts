import type { Tool } from '../types';
import { useSettingsStore } from '@/stores/settingsStore';
import { resolveApiKey } from '@/lib/credentials';
import { probeApimartRoutes } from '@/lib/apimart/baseUrl';

export const apimartRouteStatusTool: Tool = {
  definition: {
    name: 'apimart_route_status',
    description:
      '只读并行检测 APIMart 四条生成线路（api.apimart.ai、apib.ai、aiuxu.com、aishuch.com），返回每条线路的 HTTP 状态、延迟和当前选中线路。'
      + '当画布、工坊或普通对话出现 APIMart/Midjourney/Seedream/Omni 网络超时，先调用此工具；refresh=true 会清除旧缓存并重新选最快健康线路。不会提交生成任务，也不会扣费。',
    parameters: {
      type: 'object',
      properties: {
        refresh: { type: 'boolean', description: '是否清除当前线路缓存并重新检测，排障时传 true' },
      },
      required: [],
    },
  },
  risk: 'safe',
  async execute(params) {
    const s = useSettingsStore.getState();
    const apiKey = resolveApiKey(s, 'omniApimart', s.omniApimartApiKey).trim();
    if (!apiKey) {
      return {
        success: false,
        output: '',
        error: '未配置 APIMart API Key，请先在设置 > 模型与服务 > APIMart 填写。',
      };
    }
    const result = await probeApimartRoutes(apiKey, { refreshSelection: params.refresh === true });
    const available = result.routes.filter((route) => route.reachable);
    return {
      success: available.length > 0,
      output: JSON.stringify({
        selected: result.selectedBaseUrl ?? null,
        policy: '四条线路并行预检，选择当前最快健康线路；连接阶段失败会临时熔断，恢复后自动重新加入。',
        routes: result.routes.map((route) => ({
          host: route.host,
          reachable: route.reachable,
          http_status: route.status ?? null,
          latency_ms: route.latencyMs,
          error: route.error ?? null,
        })),
      }, null, 2),
      ...(available.length === 0 ? { error: 'APIMart 四条线路当前都不可达。' } : {}),
    };
  },
};
