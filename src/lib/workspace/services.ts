import type { WorkspaceDraft } from './types.ts';
import { workspaceEngine } from './engineCatalog.ts';
import { estimateEngineCost, type PricingCaps } from '../pricing/estimate.ts';

export interface WorkspaceCapabilities {
  gpt: boolean;
  apimart: boolean;
  runninghub: boolean;
  kuaizi: boolean;
  ark: boolean;
  seedanceChannel: 'kuaizi' | 'runninghub' | 'ark';
}

/** Configuration presence, not a claim about balances, network health or CLI login. */
export function workspaceUnavailableReason(engineId: string, caps: WorkspaceCapabilities): string | undefined {  const engine = workspaceEngine(engineId);
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
  pricingCaps?: PricingCaps,
): Promise<WorkspacePrice> {
  const engine = workspaceEngine(draft.engineId);
  // Seedance 2.0 系渠道是用户显式选择（seedanceChannel）：选筷子/方舟时
  // RunningHub 估价不代表真实路由，跳过 preview 直接走对应渠道的单价表预估。
  const seedance20Family = draft.engineId.startsWith('seedance-2.0') || draft.engineId === 'startend-v3.1-pro';
  const preferChannelEstimate = Boolean(pricingCaps && seedance20Family
    && pricingCaps.seedanceChannel && pricingCaps.seedanceChannel !== 'runninghub');
  if (!preferChannelEstimate && runninghub && engine?.endpoint && !engine.appConfig) {
    try {
      const price = await preview(engine.endpoint, { prompt: 'estimate', ...engine.fixedParams, ...draft.params });
      if (!price || !Number.isFinite(price.estimatedPrice) || price.estimatedPrice < 0 || !price.currency) {
        return { label: '暂时无法估价', detail: '' };
      }
      return { label: price.isFreeThisCall ? 'RunningHub 报价：本次免费' : `约 ${price.currency} ${price.estimatedPrice}`,
        detail: '' };
    } catch { return { label: '暂时无法估价', detail: '' }; }
  }
  // 其余渠道（筷子/DMXAPI/APIMart/即梦）按单价表预估；预估本身也失败才降级。
  if (pricingCaps) {
    try {
      const estimate = await estimateEngineCost(draft.engineId, draft.params, {
        images: draft.references.filter((ref) => ref.type === 'image').length,
        videos: draft.references.filter((ref) => ref.type === 'video').length,
        audios: draft.references.filter((ref) => ref.type === 'audio').length,
      }, pricingCaps);
      if (estimate) return { label: estimate.label, detail: estimate.detail };
    } catch { /* 预估异常静默降级，不影响草稿 */ }
  }
  return { label: '费用以渠道结算为准', detail: '' };
}
