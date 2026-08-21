export type CanvasGenerationKind = 'image' | 'video' | 'audio';

function usableValue(value: unknown): value is string | number | boolean {
  return value !== undefined && value !== null && value !== '';
}

/**
 * Agent and retry calls may omit UI parameters. Preserve the target node's
 * visible settings so a 15s node cannot silently submit the engine default.
 * Explicit call parameters always win.
 */
export function mergeCanvasNodeGenerationParams(
  kind: CanvasGenerationKind,
  nodeData: Record<string, unknown>,
  overrides: Record<string, string | number | boolean> = {},
): Record<string, string | number | boolean> {
  if (kind !== 'video') return { ...overrides };

  const inherited: Record<string, string | number | boolean> = {};
  if (usableValue(nodeData.duration)) inherited.duration = nodeData.duration;
  if (usableValue(nodeData.resolution)) inherited.resolution = nodeData.resolution;
  if (usableValue(nodeData.aspectRatio)) {
    inherited.aspectRatio = nodeData.aspectRatio;
    inherited.ratio = nodeData.aspectRatio;
  }
  if (usableValue(nodeData.generateAudio)) inherited.generateAudio = nodeData.generateAudio;
  if (usableValue(nodeData.realPersonMode)) inherited.realPersonMode = nodeData.realPersonMode;

  return { ...inherited, ...overrides };
}
