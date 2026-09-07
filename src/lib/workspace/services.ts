import type { WorkspaceDraft } from './types.ts';
import { workspaceEngine } from './engineCatalog.ts';

export interface WorkspaceCapabilities {
  gpt: boolean;
  apimart: boolean;
  runninghub: boolean;
  kuaizi: boolean;
  ark: boolean;
  seedanceChannel: 'kuaizi' | 'runninghub' | 'ark';
}

/** Configuration presence, not a claim about balances, network health or CLI login. */
export function workspaceUnavailableReason(engineId: string, caps: WorkspaceCapabilities): string | undefined {
  const engine = workspaceEngine(engineId);
  if (!engine) return '当前模型不在可用能力表中';
  if (engineId.startsWith('gpt-image')) return caps.gpt ? undefined : '未配置 GPT 生图渠道';
  if (engineId.startsWith('midjourney')) return caps.apimart ? undefined : '未配置 APIMart 渠道';
  if (engineId.startsWith('seedream') || engineId === 'dreamina-seedance-2.5' || engineId === 'seedance-2.5') return undefined;
  if (engineId === 'minimax-hailuo-h3' || engineId === 'minimax-h3' || engineId === 'wan-3.0' || engineId === 'wan-3.0-prime') {
    return caps.kuaizi || caps.runninghub || caps.apimart ? undefined : '未配置筷子、RunningHub 或 APIMart 渠道';
  }
  if (engineId.startsWith('seedance-2.0') || engineId === 'startend-v3.1-pro') {
    const names = { kuaizi: '筷子', runninghub: 'RunningHub', ark: '火山方舟' };
    return caps[caps.seedanceChannel] ? undefined : `当前视频渠道 ${names[caps.seedanceChannel]} 未配置`;
  }
  return caps.runninghub ? undefined : '未配置 RunningHub 渠道';
}

export interface WorkspacePrice { label: string; detail: string }
export function workspacePriceKey(draft: WorkspaceDraft): string {
  return JSON.stringify([draft.projectId, draft.objectId, draft.outputType, draft.engineId,
    Object.entries(draft.params).sort(([a], [b]) => a.localeCompare(b)), draft.references.map((ref) => [ref.type, ref.id, ref.path])]);
}

/** Quotes describe one provider only, never the smart router's eventual invoice. */
export async function estimateWorkspacePrice(draft: WorkspaceDraft, runninghub: boolean,
  preview: (endpoint: string, params: WorkspaceDraft['params']) => Promise<{ estimatedPrice: number; currency: string; isFreeThisCall: boolean } | null>,
): Promise<WorkspacePrice> {
  const engine = workspaceEngine(draft.engineId);
  if (!runninghub || !engine?.endpoint || engine.appConfig) return { label: '费用以渠道结算为准', detail: '当前模型没有可用的实时估价接口；不代表免费。' };
  try {
    const price = await preview(engine.endpoint, { prompt: 'estimate', ...engine.fixedParams, ...draft.params });
    if (!price || !Number.isFinite(price.estimatedPrice) || price.estimatedPrice < 0 || !price.currency) {
      return { label: '暂时无法估价', detail: '未取得有效报价；不代表免费，可稍后重新查询。' };
    }
    return { label: price.isFreeThisCall ? 'RunningHub 报价：本次免费' : `RunningHub 预估 ${price.currency} ${price.estimatedPrice}`,
      detail: '仅为 RunningHub 该参数的估价；实际路由与计费可能不同，确认纪律不变。' };
  } catch { return { label: '暂时无法估价', detail: '费用查询未完成，不影响草稿；不代表免费。' }; }
}
