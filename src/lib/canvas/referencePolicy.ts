export interface VideoReferenceData {
  sourceVideoPath?: unknown;
  mediaRole?: unknown;
  [key: string]: unknown;
}

const REFERENCE_EDGE_RELATIONS = new Set(['reference', 'workshop-reference']);

/** Untyped legacy edges were explicit references. New typed relations must opt in. */
export function isNonReferenceEdgeData(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const relation = (data as { relation?: unknown }).relation;
  return relation != null && relation !== '' && !REFERENCE_EDGE_RELATIONS.has(String(relation));
}

/**
 * Only an explicit user-placed image may be used as a node's implicit
 * image-edit input. generatedImageUrl/localPath 在生成完成后指向产物——
 * 产物隐式回灌会让反复生图逐轮退化（重 roll 自吞），故只认 isUploadedImage。
 * 要拿产物继续编辑：显式连线到目标节点，或用裁剪/涂抹等显式工具。
 */
export function explicitSelfImageSource(data: Record<string, unknown>): string {
  if (data.isUploadedImage !== true) return '';
  const value = data.referenceImage || data.generatedImageUrl || data.localPath;
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Only an explicit user-selected source may be used as a node's implicit
 * video-edit input. generatedVideoUrl/localPath are intentionally ignored:
 * after generation they point at an output, not an asset.
 */
export function explicitSelfVideoSource(data: VideoReferenceData): string {
  return typeof data.sourceVideoPath === 'string'
    ? data.sourceVideoPath.trim()
    : '';
}

function hasGeneratedVideoProvenance(data: VideoReferenceData): boolean {
  return Boolean(
    data.modelVersion
    || data.justCompletedAt
    || data.generationHistory
    || data.mgGenerationEngine
    || data.isMgAnimationNode
    || data.mgReferenceMasterPath
    || data.textFallbackImagePath
    || data.directorReferenceIsolated
    || data.workshopRef,
  );
}

/**
 * Older builds stored uploaded videos and generated outputs in the same
 * localPath/generatedVideoUrl fields. Migrate conservatively:
 * - generation provenance => output
 * - otherwise a user-placed video with a media path => explicit reference
 *
 * This prevents an old uploaded video from silently becoming text-to-video
 * while still keeping known generated products out of implicit references.
 */
export function migrateLegacyVideoNodeReferences<
  T extends { type?: string; data?: Record<string, unknown> },
>(nodes: T[]): { nodes: T[]; changed: boolean } {
  let changed = false;
  const migrated = nodes.map((node) => {
    if (node.type !== 'video' || !node.data) return node;
    const data = node.data as VideoReferenceData;
    if (data.mediaRole === 'reference' || data.mediaRole === 'output') return node;

    const localPath = typeof data.localPath === 'string' ? data.localPath.trim() : '';
    const generatedUrl = typeof data.generatedVideoUrl === 'string'
      ? data.generatedVideoUrl.trim()
      : '';
    const source = localPath || generatedUrl;
    if (!source) return node;

    changed = true;
    return {
      ...node,
      data: hasGeneratedVideoProvenance(data)
        ? { ...node.data, mediaRole: 'output' }
        : { ...node.data, sourceVideoPath: source, mediaRole: 'reference' },
    };
  });
  return { nodes: changed ? migrated : nodes, changed };
}
