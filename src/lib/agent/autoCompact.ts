import { getEffectiveContextWindowSize } from './contextWindow';

export {
  getEffectiveContextWindowSize,
  getRawContextWindowSize,
  MAX_OUTPUT_TOKENS_FOR_SUMMARY,
  normalizeContextModelId,
} from './contextWindow';
export function shouldAutoCompact(
  estimatedTokens: number,
  modelId: string,
): { compact: boolean; reason?: string } {
  const effective = getEffectiveContextWindowSize(modelId);
  // Million-token models should actually benefit from their larger window.
  // Tool results are micro-compacted before this check, so 90% still leaves
  // ample output/schema headroom without repeatedly summarizing healthy history.
  const triggerRatio = effective >= 900_000 ? 0.9 : 0.8;
  const trigger = effective * triggerRatio;
  if (estimatedTokens > trigger) {
    return { compact: true, reason: `${estimatedTokens} > ${Math.floor(trigger)} (${Math.round(triggerRatio * 100)}% of ${effective})` };
  }
  return { compact: false };
}
