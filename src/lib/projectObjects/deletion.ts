import type { WorkshopData, WsShot } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects } from './migrate.ts';
import { changeWorkspaceReferences } from '../workspace/drafts.ts';
import type {
  AssetVersionRecord,
  MediaFileRecord,
  ProjectObjectRecord,
  UnifiedProjectRegistry,
} from './types.ts';

export interface ProjectDeletionImpact {
  targetId: string;
  label: string;
  kind: ProjectObjectRecord['kind'];
  objectIds: string[];
  mediaIds: string[];
  versionIds: string[];
  affectedShotNos: string[];
  videoPromptCount: number;
  timelineClipCount: number;
  relationReferenceCount: number;
}

export interface ProjectDeletionResult {
  data: WorkshopData;
  impact: ProjectDeletionImpact;
  deleted: boolean;
}

export function projectDeletionTargetForCanvasNode(
  node: { data?: unknown },
): string | undefined {
  const data = (node.data ?? {}) as Record<string, unknown>;
  return [data.versionObjectId, data.mediaObjectId, data.projectObjectId]
    .find((value): value is string => typeof value === 'string' && value.length > 0);
}

export function removeCanvasNodesFromView<
  TNode extends { id: string },
  TEdge extends { source: string; target: string },
>(nodes: TNode[], edges: TEdge[], nodeIds: Iterable<string>): { nodes: TNode[]; edges: TEdge[] } {
  const removed = new Set(nodeIds);
  return {
    nodes: nodes.filter((node) => !removed.has(node.id)),
    edges: edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target)),
  };
}

function allRecords(registry: UnifiedProjectRegistry): ProjectObjectRecord[] {
  return [...registry.objects, ...registry.media, ...registry.versions];
}

function shotReferencesSource(shot: WsShot, sourceId: string, kind: ProjectObjectRecord['kind']): boolean {
  if (kind === 'character') {
    return shot.characterIds.includes(sourceId)
      || (shot.voiceCharacterIds ?? []).includes(sourceId)
      || (shot.audioPrompts ?? []).some((item) => item.characterId === sourceId)
      || (shot.generatedAudios ?? []).some((item) => item.characterId === sourceId);
  }
  if (kind === 'scene') return shot.sceneId === sourceId;
  if (kind === 'prop') return (shot.propIds ?? []).includes(sourceId);
  if (kind === 'scene-asset') return shot.colorPaletteId === sourceId;
  if (kind === 'director-constraint') return shot.directorConstraintCard?.id === sourceId;
  if (kind === 'shot') return (shot.id ?? shot.shotNo) === sourceId;
  return false;
}

function deletionIds(registry: UnifiedProjectRegistry, target: ProjectObjectRecord) {
  const objectIds = target.kind === 'media-file' || target.kind === 'asset-version' ? [] : [target.id];
  if (target.kind === 'shot' || target.kind === 'scene') {
    objectIds.push(...registry.objects.filter((item) => item.kind === 'director-constraint'
      && item.relationIds.length > 0 && item.relationIds.every((id) => id === target.id)).map((item) => item.id));
  }
  const mediaIds = new Set<string>();
  const versionIds = new Set<string>();

  if (target.kind === 'media-file') mediaIds.add(target.id);
  if (target.kind === 'asset-version') {
    versionIds.add(target.id);
    mediaIds.add((target as AssetVersionRecord).mediaObjectId);
  }
  if (objectIds.length > 0) {
    registry.media.forEach((item) => {
      if (item.ownerObjectId && objectIds.includes(item.ownerObjectId)) mediaIds.add(item.id);
    });
  }
  registry.versions.forEach((item) => {
    if (objectIds.includes(item.ownerObjectId) || mediaIds.has(item.mediaObjectId)) {
      versionIds.add(item.id);
    }
  });
  return { objectIds, mediaIds: [...mediaIds], versionIds: [...versionIds] };
}

export function assessProjectObjectDeletion(
  input: WorkshopData,
  targetId: string,
  now = Date.now(),
): ProjectDeletionImpact | null {
  const data = migrateWorkshopProjectObjects(input, now);
  const registry = data.projectObjects!;
  const target = allRecords(registry).find((item) => item.id === targetId);
  if (!target) return null;
  const ids = deletionIds(registry, target);
  const ownerId = target.kind === 'asset-version'
    ? (target as AssetVersionRecord).ownerObjectId
    : target.kind === 'media-file'
      ? (target as MediaFileRecord).ownerObjectId
      : target.id;
  const owner = ownerId ? registry.objects.find((item) => item.id === ownerId) : undefined;
  const affectedShots = owner?.sourceId
    ? data.shots.filter((shot) => shotReferencesSource(shot, owner.sourceId!, owner.kind))
    : [];
  const deletedIds = new Set([...ids.objectIds, ...ids.mediaIds, ...ids.versionIds]);
  const relationReferenceCount = allRecords(registry).reduce(
    (count, item) => count + item.relationIds.filter((id) => deletedIds.has(id)).length,
    0,
  );
  const timelineClipCount = registry.objects.filter((item) => (
    item.kind === 'timeline-clip' && item.relationIds.some((id) => deletedIds.has(id))
  )).length;
  return {
    targetId,
    label: target.label ?? target.id,
    kind: target.kind,
    ...ids,
    affectedShotNos: affectedShots.map((shot) => shot.shotNo),
    videoPromptCount: affectedShots.filter((shot) => Boolean(
      shot.videoPrompt?.trim() || shot.universalVideoPrompt?.trim(),
    )).length,
    timelineClipCount,
    relationReferenceCount,
  };
}

function stripSourceFromShots(
  shots: WsShot[],
  sourceId: string,
  kind: ProjectObjectRecord['kind'],
): WsShot[] {
  return shots.map((shot) => {
    if (!shotReferencesSource(shot, sourceId, kind)) return shot;
    if (kind === 'character') return {
      ...shot,
      characterIds: shot.characterIds.filter((id) => id !== sourceId),
      voiceCharacterIds: (shot.voiceCharacterIds ?? []).filter((id) => id !== sourceId),
      audioPrompts: shot.audioPrompts?.filter((item) => item.characterId !== sourceId),
      generatedAudios: shot.generatedAudios?.filter((item) => item.characterId !== sourceId),
      promptNeedsRefresh: true,
    };
    if (kind === 'scene') return { ...shot, sceneId: undefined, promptNeedsRefresh: true };
    if (kind === 'prop') return {
      ...shot,
      propIds: (shot.propIds ?? []).filter((id) => id !== sourceId),
      promptNeedsRefresh: true,
    };
    if (kind === 'scene-asset') return { ...shot, colorPaletteId: undefined, promptNeedsRefresh: true };
    if (kind === 'director-constraint') return { ...shot, directorConstraintCard: undefined, promptNeedsRefresh: true };
    return shot;
  });
}

function removeMediaPathFromOwner(
  input: WorkshopData,
  owner: ProjectObjectRecord | undefined,
  path: string,
  replacementPath?: string,
): WorkshopData {
  if (!owner?.sourceId) return input;
  const sourceId = owner.sourceId;
  const patchCandidates = <T extends { candidates?: Array<{ path: string }>; assetImagePath?: string }>(item: T): T => ({
    ...item,
    candidates: item.candidates?.filter((candidate) => candidate.path !== path),
    ...(item.assetImagePath === path ? { assetImagePath: replacementPath } : {}),
  });
  if (owner.kind === 'character') return {
    ...input,
    characters: input.characters.map((item) => item.id === sourceId ? patchCandidates(item) : item),
  };
  if (owner.kind === 'scene') return {
    ...input,
    scenes: input.scenes.map((item) => item.id === sourceId ? {
      ...patchCandidates(item), selectedImagePaths: item.selectedImagePaths?.filter((item) => item !== path),
    } : item),
    shots: input.shots.map((shot) => ({
      ...shot,
      sceneImagePaths: shot.sceneImagePaths?.flatMap((item) => (
        item === path ? (replacementPath ? [replacementPath] : []) : [item]
      )),
    })),
  };
  if (owner.kind === 'prop') return {
    ...input,
    props: input.props.map((item) => item.id === sourceId ? patchCandidates(item) : item),
  };
  if (owner.kind === 'scene-asset') return {
    ...input,
    colorPalettes: input.colorPalettes.map((item) => item.id === sourceId ? patchCandidates(item) : item),
  };
  if (owner.kind === 'director-constraint') return {
    ...input,
    scenes: input.scenes.map((scene) => {
      const card = scene.directorConstraintCard;
      if (!card || card.id !== sourceId) return scene;
      return { ...scene, directorConstraintCard: card.imagePath === path && !replacementPath ? undefined : {
        ...card, imagePath: card.imagePath === path ? replacementPath! : card.imagePath,
        candidates: card.candidates?.filter((candidate) => candidate.path !== path),
      } };
    }),
    shots: input.shots.map((shot) => {
      const card = shot.directorConstraintCard;
      if (!card || card.id !== sourceId) return shot;
      if (card.imagePath === path && !replacementPath) {
        return { ...shot, directorConstraintCard: undefined, promptNeedsRefresh: true };
      }
      return {
        ...shot,
        directorConstraintCard: {
          ...card,
          imagePath: card.imagePath === path ? replacementPath! : card.imagePath,
          candidates: card.candidates?.filter((candidate) => candidate.path !== path),
        },
      };
    }),
  };
  if (owner.kind === 'shot') return {
    ...input,
    shots: input.shots.map((shot) => (shot.id ?? shot.shotNo) === sourceId ? {
      ...shot,
      imagePath: shot.imagePath === path ? undefined : shot.imagePath,
      videoPath: shot.videoPath === path ? undefined : shot.videoPath,
      extraRefImages: shot.extraRefImages?.filter((item) => item !== path),
      directorPrevisVideoPaths: shot.directorPrevisVideoPaths?.filter((item) => item !== path),
      generatedAudios: shot.generatedAudios?.filter((item) => item.path !== path),
      storyboardBoards: shot.storyboardBoards?.filter((item) => item.imagePath !== path),
      storyboardFrames: shot.storyboardFrames?.map((item) => ({
        ...item,
        imagePath: item.imagePath === path ? undefined : item.imagePath,
        candidates: item.candidates?.filter((candidate) => candidate.path !== path),
      })),
    } : shot),
  };
  return input;
}

function stripOwnerFromWorkshop(input: WorkshopData, owner: ProjectObjectRecord): WorkshopData {
  if (!owner.sourceId) return input;
  const sourceId = owner.sourceId;
  const shots = stripSourceFromShots(input.shots, sourceId, owner.kind);
  if (owner.kind === 'character') return { ...input, characters: input.characters.filter((item) => item.id !== sourceId), shots };
  if (owner.kind === 'scene') return { ...input, scenes: input.scenes.filter((item) => item.id !== sourceId), shots };
  if (owner.kind === 'prop') return { ...input, props: input.props.filter((item) => item.id !== sourceId), shots };
  if (owner.kind === 'scene-asset') return {
    ...input,
    colorPalettes: input.colorPalettes.filter((item) => item.id !== sourceId),
    globalColorPaletteId: input.globalColorPaletteId === sourceId ? undefined : input.globalColorPaletteId,
    shots,
  };
  if (owner.kind === 'director-constraint') return { ...input, shots,
    scenes: input.scenes.map((scene) => scene.directorConstraintCard?.id === sourceId
      ? { ...scene, directorConstraintCard: undefined } : scene),
  };
  if (owner.kind === 'shot') return {
    ...input,
    shots: input.shots.filter((shot) => (shot.id ?? shot.shotNo) !== sourceId),
  };
  return input;
}

export function deleteProjectObject(
  input: WorkshopData,
  targetId: string,
  now = Date.now(),
): ProjectDeletionResult {
  const data = migrateWorkshopProjectObjects(input, now);
  const registry = data.projectObjects!;
  const target = allRecords(registry).find((item) => item.id === targetId);
  const impact = assessProjectObjectDeletion(data, targetId, now);
  if (!target || !impact) {
    return {
      data,
      deleted: false,
      impact: {
        targetId,
        label: targetId,
        kind: 'media-file',
        objectIds: [],
        mediaIds: [],
        versionIds: [],
        affectedShotNos: [],
        videoPromptCount: 0,
        timelineClipCount: 0,
        relationReferenceCount: 0,
      },
    };
  }

  const deletedIds = new Set([
    ...impact.objectIds,
    ...impact.mediaIds,
    ...impact.versionIds,
  ]);
  const ownerId = target.kind === 'asset-version'
    ? (target as AssetVersionRecord).ownerObjectId
    : target.kind === 'media-file'
      ? (target as MediaFileRecord).ownerObjectId
      : target.id;
  const owner = ownerId ? registry.objects.find((item) => item.id === ownerId) : undefined;
  const deletedMedia = registry.media.filter((item) => impact.mediaIds.includes(item.id));
  const deletedMediaPaths = new Set(deletedMedia.map((item) => item.path));
  const remainingVersions = registry.versions.filter((item) => (
    item.ownerObjectId === ownerId && !deletedIds.has(item.id) && !deletedIds.has(item.mediaObjectId)
    && registry.media.some((media) => media.id === item.mediaObjectId && deletedMedia.some((deleted) => deleted.mediaType === media.mediaType))
  ));
  const replacementVersion = [...remainingVersions].sort((a, b) => b.ordinal - a.ordinal)[0];
  const replacementPath = replacementVersion
    ? registry.media.find((item) => item.id === replacementVersion.mediaObjectId)?.path
    : undefined;

  let next = target.kind === 'media-file' || target.kind === 'asset-version'
    ? data
    : stripOwnerFromWorkshop(data, target);
  for (const path of deletedMediaPaths) {
    next = removeMediaPathFromOwner(next, owner, path, replacementPath);
  }
  const removedPaths = new Set([...deletedMediaPaths].filter((path) => !registry.media.some((item) => !deletedIds.has(item.id) && item.path === path)));
  next = { ...next, shots: next.shots.map((shot) => ({
    ...shot,
    extraRefImages: shot.extraRefImages?.filter((path) => !removedPaths.has(path)),
    sceneImagePaths: shot.sceneImagePaths?.filter((path) => !removedPaths.has(path)),
    storyboardFrames: shot.storyboardFrames?.map((frame) => ({ ...frame, refImagePaths: frame.refImagePaths?.filter((path) => !removedPaths.has(path)) })),
  })) };

  const cleanedRegistry: UnifiedProjectRegistry = {
    ...registry,
    updatedAt: now,
    objects: registry.objects
      .filter((item) => !deletedIds.has(item.id))
      .map((item) => ({ ...item, relationIds: item.relationIds.filter((id) => !deletedIds.has(id)) })),
    media: registry.media
      .filter((item) => !deletedIds.has(item.id))
      .map((item) => ({
        ...item,
        relationIds: item.relationIds.filter((id) => !deletedIds.has(id)),
        versionObjectId: item.versionObjectId && deletedIds.has(item.versionObjectId)
          ? undefined
          : item.versionObjectId,
      })),
    versions: registry.versions
      .filter((item) => !deletedIds.has(item.id) && !deletedIds.has(item.mediaObjectId) && !deletedIds.has(item.ownerObjectId))
      .map((item) => ({ ...item, relationIds: item.relationIds.filter((id) => !deletedIds.has(id)) })),
  };
  next = {
    ...next,
    workspaceDrafts: next.workspaceDrafts ? Object.fromEntries(Object.entries(next.workspaceDrafts)
      .filter(([, draft]) => !deletedIds.has(draft.objectId))
      .map(([key, draft]) => {
        const refs = draft.references.filter((ref) => !deletedIds.has(ref.id) && !deletedIds.has(ref.objectId ?? '')
          && !deletedIds.has(ref.versionId ?? '') && !removedPaths.has(ref.path));
        return [key, refs.length === draft.references.length ? draft : {
          ...changeWorkspaceReferences(draft, refs), revision: draft.revision + 1, updatedAt: now,
        }];
      })) : next.workspaceDrafts,
    projectObjects: cleanedRegistry,
    projectViewState: next.projectViewState ? {
      ...next.projectViewState,
      selectedObjectIds: next.projectViewState.selectedObjectIds?.filter((id) => !deletedIds.has(id)),
      conversationReferences: next.projectViewState.conversationReferences?.filter((ref) => !deletedIds.has(ref.objectId)),
    } : next.projectViewState,
  };
  return { data: migrateWorkshopProjectObjects(next, now), impact, deleted: true };
}
