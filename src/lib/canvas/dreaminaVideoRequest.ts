import {
  DREAMINA_SEEDANCE_20_DIRECT_ENGINE_ID,
  DREAMINA_SEEDANCE_25_DIRECT_ENGINE_ID,
} from '../dreamina/videoContract.ts';

export type CanvasDreaminaVersion = 'seedance-2.0' | 'seedance-2.5';

/**
 * Pure contract for the canvas Dreamina lane.
 * `prompt` is intentionally returned byte-for-byte; do not trim, annotate,
 * optimize, or send it through an Agent before calling canvasGen.
 */
export function buildCanvasDreaminaVideoRequest(input: {
  version: CanvasDreaminaVersion;
  prompt: string;
  resolution: string;
  ratio: string;
  duration: number;
}) {
  return {
    engineId: input.version === 'seedance-2.5'
      ? DREAMINA_SEEDANCE_25_DIRECT_ENGINE_ID
      : DREAMINA_SEEDANCE_20_DIRECT_ENGINE_ID,
    prompt: input.prompt,
    params: {
      resolution: input.resolution,
      ratio: input.ratio,
      duration: String(input.duration),
      genMode: 'multimodal',
      verbatimPrompt: true,
    },
  } as const;
}
