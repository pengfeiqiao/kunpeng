export const MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000;

const MODEL_WINDOWS: Record<string, number> = {
  'glm-5.1': 128_000,
  'glm-4.6': 128_000,
  'deepseek-v4-pro': 1_000_000,
  'deepseek-v4-flash': 1_000_000,
  'deepseek-v4': 1_000_000,
  'deepseek-chat': 1_000_000,
  'deepseek-reasoner': 64_000,
  k3: 262_144,
  'k3[1m]': 1_048_576,
};

/** Remove provider/migration qualifiers before looking up model capability. */
export function normalizeContextModelId(modelId: string): string {
  const value = (modelId || '').trim().toLowerCase();
  if (!value) return '';
  return MODEL_WINDOWS[value] ? value : value.slice(value.lastIndexOf(':') + 1);
}

export function getRawContextWindowSize(
  modelId: string,
  declaredContextWindow?: number,
): number {
  if (Number.isFinite(declaredContextWindow) && (declaredContextWindow ?? 0) > 0) {
    return Math.floor(declaredContextWindow as number);
  }
  const normalized = normalizeContextModelId(modelId);
  if (MODEL_WINDOWS[normalized]) return MODEL_WINDOWS[normalized];
  if (/\b1m\b|\[1m\]/i.test(modelId)) return 1_048_576;
  return 128_000;
}

function envWindowOverride(): number | undefined {
  const value = typeof process !== 'undefined'
    ? process.env?.KUNPENG_AUTO_COMPACT_WINDOW
    : undefined;
  if (value) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
  const stored = typeof localStorage !== 'undefined'
    ? localStorage.getItem('KUNPENG_AUTO_COMPACT_WINDOW')
    : null;
  const parsed = stored ? parseInt(stored, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function getEffectiveContextWindowSize(
  modelId: string,
  declaredContextWindow?: number,
): number {
  const override = envWindowOverride();
  if (override) return override;
  return getRawContextWindowSize(modelId, declaredContextWindow)
    - MAX_OUTPUT_TOKENS_FOR_SUMMARY;
}
