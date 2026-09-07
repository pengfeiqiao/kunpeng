import { useAssetLibraryStore } from '@/stores/assetLibraryStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { findCanvasEngine } from '@/lib/rhtv/canvasEngines';
import { DREAMINA_SEEDANCE_25_ENGINE_ID } from '@/lib/dreamina/video';
import { collectNodeReferences, selfImageFallback, selfVideoFallback } from './collectRefs';
import { buildGenerationDraft, type GenerationDraft } from '@/lib/projectObjects/generationDraft';
import type { ToolRisk } from '@/lib/agent/types';

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  }
  return typeof value === 'string' && value.length > 0 ? [value] : [];
}

function canvasEngineId(value: unknown): string {
  if (value === 'minimax-h3') return 'minimax-hailuo-h3';
  if (value === 'seedance-2.5') return DREAMINA_SEEDANCE_25_ENGINE_ID;
  return typeof value === 'string' ? value : '';
}

/**
 * Build the confirmation card from the same edge-ordered references that the
 * canvas generator will resolve. This is read-only and must stay side-effect
 * free: approval still happens before upload or paid submission.
 */
export function buildCanvasGenerationDraft(
  toolName: string,
  rawParams: Record<string, unknown>,
  risk?: ToolRisk,
): GenerationDraft | null {
  const base = buildGenerationDraft(toolName, rawParams, risk);
  if (!base || toolName !== 'canvas_generate') return base;

  const nodeId = typeof rawParams.node_id === 'string' ? rawParams.node_id : '';
  const node = useCanvasStore.getState().nodes.find((item) => item.id === nodeId);
  if (!node) return base;

  const engineId = canvasEngineId(rawParams.engine);
  const engineKind = findCanvasEngine(engineId)?.kind
    ?? (engineId.includes('seedance')
      || engineId.includes('omni')
      || engineId.includes('hailuo')
      || engineId.includes('minimax-h3')
      || engineId.includes('wan-3')
      || engineId.includes('video') ? 'video' : 'image');

  let images = stringList(rawParams.reference_urls ?? rawParams.image_urls ?? rawParams.images);
  let videos = stringList(rawParams.video_urls ?? rawParams.videos);
  let audios = stringList(rawParams.audio_urls ?? rawParams.audios);

  const assetIds = stringList(rawParams.asset_ids);
  if (assetIds.length > 0) {
    const library = useAssetLibraryStore.getState().assets;
    const selected = assetIds
      .map((id) => library.find((asset) => asset.id === id))
      .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset));
    images = [...selected.flatMap((asset) => asset.images), ...images];
    audios = [
      ...selected.map((asset) => asset.audioPath).filter((path): path is string => Boolean(path)),
      ...audios,
    ];
  }

  const collected = collectNodeReferences(nodeId);
  if (images.length === 0) {
    images = engineKind === 'image'
      ? selfImageFallback(nodeId, collected)
      : collected.images.map((reference) => reference.submitUrl);
  }
  if (engineKind === 'video' && videos.length === 0) {
    videos = selfVideoFallback(nodeId, collected);
  }
  if (engineKind === 'video' && audios.length === 0) {
    audios = collected.audios.map((reference) => reference.submitUrl);
  }

  return buildGenerationDraft(toolName, {
    ...rawParams,
    reference_urls: images,
    video_urls: videos,
    audio_urls: audios,
  }, risk);
}
