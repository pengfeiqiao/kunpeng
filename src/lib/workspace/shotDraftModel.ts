import type { WorkshopData, WsShot } from '../workshop/types.ts';
import type { WorkspaceDraft } from './types.ts';

export function canonicalShotVideoModel(model: string): string {
  return model === 'minimax-h3' ? 'minimax-hailuo-h3' : model === 'seedance-2.5' ? 'dreamina-seedance-2.5' : model;
}

export function shotVideoSettings(data: WorkshopData, shot?: WsShot) {
  return {
    engineId: canonicalShotVideoModel(shot?.videoModel ?? data.videoModel ?? data.projectSpec?.defaultVideoModel ?? 'minimax-h3'),
    ratio: shot?.videoRatio ?? data.videoRatio ?? data.projectSpec?.aspectRatio ?? '16:9',
    duration: shot?.durationSec ?? 5,
  };
}

/** Preserve inheritance when the saved value still matches it; changed values become shot overrides. */
export function projectShotVideoSettings(data: WorkshopData, shot: WsShot, draft: WorkspaceDraft): WsShot {
  const current = shotVideoSettings(data, shot);
  const canonical = canonicalShotVideoModel(draft.engineId);
  const model = canonical === 'minimax-hailuo-h3' ? 'minimax-h3'
    : canonical === 'dreamina-seedance-2.5' ? 'seedance-2.5' : draft.engineId;
  const ratio = draft.params.ratio ?? draft.params.aspectRatio;
  const duration = Number(draft.params.duration);
  return { ...shot,
    ...(canonical !== current.engineId ? { videoModel: model } : {}),
    ...(typeof ratio === 'string' && ratio !== current.ratio ? { videoRatio: ratio } : {}),
    ...(Number.isFinite(duration) && duration > 0 && duration !== current.duration ? { durationSec: duration } : {}),
  };
}
