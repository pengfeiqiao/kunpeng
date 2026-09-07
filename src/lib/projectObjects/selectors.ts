import type { WorkshopData } from '../workshop/types.ts';
import type {
  AssetVersionRecord,
  MediaFileRecord,
  MediaPurpose,
  ProjectObjectRecord,
} from './types.ts';
import { migrateWorkshopProjectObjects, stableProjectHash, stableProjectObjectId } from './migrate.ts';
import { isUnclassifiedWorkspaceGroup } from '../workspace/targets.ts';

export interface CanvasGenerationRegistration {
  nodeId: string;
  nodeIds?: string[];
  taskId: string;
  paths: string[];
  mediaType: 'image' | 'video' | 'audio';
  prompt?: string;
  engineId?: string;
  ownerObjectId?: string;
  generationSnapshot?: import('../workspace/types.ts').WorkspaceDraft;
}

export interface CanvasGenerationRegistrationResult {
  data: WorkshopData;
  mediaIds: string[];
  versionIds: Array<string | undefined>;
}

function labelFromPath(path: string): string {
  const clean = path.split(/[?#]/)[0];
  return clean.split('/').pop() || '生成素材';
}

/**
 * Register immutable canvas outputs in the project registry. A generation on
 * a known project object becomes a candidate version; a blank-canvas result
 * enters the unclassified inbox. Neither path opts into generation references.
 */
export function registerCanvasGeneration(
  inputData: WorkshopData,
  input: CanvasGenerationRegistration,
  now = Date.now(),
): CanvasGenerationRegistrationResult {
  const data = migrateWorkshopProjectObjects(inputData, now);
  const registry = data.projectObjects!;
  const unclassified = !input.ownerObjectId || isUnclassifiedWorkspaceGroup(registry.objects.find((item) => item.id === input.ownerObjectId));
  const taskObjectId = stableProjectObjectId('generation-task', input.taskId);
  const objects = registry.objects.some((item) => item.id === taskObjectId)
    ? registry.objects
    : [...registry.objects, {
        id: taskObjectId,
        projectId: data.projectId,
        kind: 'generation-task' as const,
        source: 'generated' as const,
        sourceId: input.taskId,
        label: `${input.mediaType === 'image' ? '图片' : input.mediaType === 'video' ? '视频' : '音频'}生成任务`,
        relationIds: input.ownerObjectId ? [input.ownerObjectId] : [],
        version: 1,
        updatedAt: now,
      }];

  const media = [...registry.media];
  const versions = [...registry.versions];
  const mediaIds: string[] = [];
  const versionIds: Array<string | undefined> = [];
  let ordinal = input.ownerObjectId
    ? Math.max(0, ...versions.filter((item) => item.ownerObjectId === input.ownerObjectId).map((item) => item.ordinal))
    : 0;

  input.paths.filter(Boolean).forEach((path, index) => {
    const mediaId = `media-file:${stableProjectHash(`canvas\u0000${input.taskId}\u0000${path}`)}`;
    const canvasNodeId = input.nodeIds?.[index] ?? input.nodeId;
    const existing = media.find((item) => item.id === mediaId || (
      canvasNodeId && item.path === path && item.canvasNodeId === canvasNodeId
      && item.ownerObjectId === input.ownerObjectId && item.generationTaskId === input.taskId
    ));
    if (existing) {
      mediaIds.push(existing.id);
      versionIds.push(existing.versionObjectId);
      return;
    }
    mediaIds.push(mediaId);

    const versionId = input.ownerObjectId
      ? `asset-version:${stableProjectHash(`${input.ownerObjectId}\u0000${input.taskId}\u0000${index}`)}`
      : undefined;
    const mediaRecord: MediaFileRecord = {
      id: mediaId,
      projectId: data.projectId,
      kind: 'media-file',
      source: 'generated',
      sourceId: path,
      label: labelFromPath(path),
      relationIds: [taskObjectId, input.ownerObjectId].filter(Boolean) as string[],
      version: 1,
      updatedAt: now,
      path,
      mediaType: input.mediaType,
      purpose: unclassified ? 'unclassified' : 'candidate-version',
      ownerObjectId: input.ownerObjectId,
      versionObjectId: versionId,
      canvasNodeId,
      generationTaskId: input.taskId,
    };
    media.push(mediaRecord);

    if (input.ownerObjectId && versionId) {
      ordinal += 1;
      const versionRecord: AssetVersionRecord = {
        id: versionId,
        projectId: data.projectId,
        kind: 'asset-version',
        source: 'generated',
        sourceId: `${input.taskId}:${index}`,
        label: `候选版本 ${ordinal}`,
        relationIds: [input.ownerObjectId, mediaId, taskObjectId],
        version: 1,
        updatedAt: now,
        ownerObjectId: input.ownerObjectId,
        mediaObjectId: mediaId,
        ordinal,
        selected: false,
        prompt: input.prompt,
        engineId: input.engineId,
        generationSnapshot: input.generationSnapshot ? {
          ...input.generationSnapshot, params: { ...input.generationSnapshot.params },
          references: input.generationSnapshot.references.map((ref) => ({ ...ref })),
        } : undefined,
      };
      versions.push(versionRecord);
    }
    versionIds.push(versionId);
  });

  return {
    data: {
      ...data,
      projectObjects: {
        ...registry,
        objects,
        media,
        versions,
        updatedAt: now,
      },
    },
    mediaIds,
    versionIds,
  };
}

export function findProjectObject(data: WorkshopData, id: string): ProjectObjectRecord | undefined {
  return [
    ...(data.projectObjects?.objects ?? []),
    ...(data.projectObjects?.media ?? []),
    ...(data.projectObjects?.versions ?? []),
  ].find((item) => item.id === id);
}

export function projectMediaByPurpose(
  data: WorkshopData,
  purpose: MediaPurpose,
): MediaFileRecord[] {
  return (data.projectObjects?.media ?? []).filter((item) => item.purpose === purpose);
}

export function setMediaPurpose(
  data: WorkshopData,
  mediaId: string,
  purpose: MediaPurpose,
  now = Date.now(),
): WorkshopData {
  // A project-wide tag has no target or ordering; only draft references/edges can opt in.
  if (purpose === 'generation-reference') return data;
  if (!data.projectObjects) return data;
  return {
    ...data,
    projectObjects: {
      ...data.projectObjects,
      updatedAt: now,
      media: data.projectObjects.media.map((item) => item.id === mediaId ? {
        ...item,
        purpose,
        version: item.version + 1,
        updatedAt: now,
      } : item),
    },
  };
}

export function selectAssetVersion(
  data: WorkshopData,
  ownerObjectId: string,
  versionId: string,
  now = Date.now(),
): WorkshopData {
  if (!data.projectObjects) return data;
  const target = data.projectObjects.versions.find((item) => item.id === versionId && item.ownerObjectId === ownerObjectId);
  if (!target) return data;
  const selectedMedia = data.projectObjects.media.find((item) => item.id === target.mediaObjectId);
  if (!selectedMedia) return data;
  const sameTypeMediaIds = new Set(data.projectObjects.media
    .filter((item) => item.ownerObjectId === ownerObjectId && item.mediaType === selectedMedia.mediaType)
    .map((item) => item.id));
  const current = data.projectObjects.versions.find((item) => item.ownerObjectId === ownerObjectId && item.selected && sameTypeMediaIds.has(item.mediaObjectId));
  if (current?.locked && current.id !== versionId) return data;
  const selectedMediaId = target.mediaObjectId;
  const owner = data.projectObjects.objects.find((item) => item.id === ownerObjectId);
  let projected: WorkshopData = data;
  if (selectedMedia && owner?.sourceId) {
    const path = selectedMedia.path;
    if (owner.kind === 'character') {
      projected = { ...projected, characters: projected.characters.map((item) => item.id === owner.sourceId ? { ...item, assetImagePath: path } : item) };
    } else if (owner.kind === 'scene') {
      projected = { ...projected, scenes: projected.scenes.map((item) => item.id === owner.sourceId ? { ...item, assetImagePath: path } : item) };
    } else if (owner.kind === 'prop') {
      projected = { ...projected, props: projected.props.map((item) => item.id === owner.sourceId ? { ...item, assetImagePath: path } : item) };
    } else if (owner.kind === 'scene-asset') {
      projected = { ...projected, colorPalettes: projected.colorPalettes.map((item) => item.id === owner.sourceId ? { ...item, assetImagePath: path } : item) };
    } else if (owner.kind === 'director-constraint') {
      projected = {
        ...projected,
        scenes: projected.scenes.map((scene) => {
          const card = scene.directorConstraintCard;
          if (!card || card.id !== owner.sourceId) return scene;
          return { ...scene, directorConstraintCard: { ...card, imagePath: path } };
        }),
        shots: projected.shots.map((shot) => {
          const card = shot.directorConstraintCard;
          if (!card || card.id !== owner.sourceId) return shot;
          return { ...shot, directorConstraintCard: { ...card, imagePath: path } };
        }),
      };
    } else if (owner.kind === 'shot') {
      projected = {
        ...projected,
        shots: projected.shots.map((shot) => (shot.id ?? shot.shotNo) === owner.sourceId ? {
          ...shot,
          ...(selectedMedia.mediaType === 'video' ? { videoPath: path } : selectedMedia.mediaType === 'image' ? { imagePath: path } : {}),
        } : shot),
      };
    }
  }
  return {
    ...projected,
    projectObjects: {
      ...data.projectObjects,
      updatedAt: now,
      versions: data.projectObjects.versions.map((item) => item.ownerObjectId === ownerObjectId && sameTypeMediaIds.has(item.mediaObjectId) ? {
        ...item,
        selected: item.id === versionId,
        version: item.version + 1,
        updatedAt: now,
      } : item),
      media: data.projectObjects.media.map((item) => item.ownerObjectId === ownerObjectId && sameTypeMediaIds.has(item.id) ? {
        ...item,
        purpose: item.id === selectedMediaId ? 'current-version' : 'candidate-version',
        version: item.version + 1,
        updatedAt: now,
      } : item),
    },
  };
}
