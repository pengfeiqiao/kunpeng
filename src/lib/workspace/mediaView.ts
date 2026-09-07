import type { WorkshopData } from '../workshop/types.ts';
import type { MediaFileRecord, AssetVersionRecord } from '../projectObjects/types.ts';
import type { WorkspaceDraft, WorkspaceOutputType } from './types.ts';

export interface WorkspaceMediaVersion {
  media: MediaFileRecord;
  version?: AssetVersionRecord;
  ordinal: number;
  adopted: boolean;
  snapshot?: WorkspaceDraft;
}

export function workspaceMediaVersions(data: Pick<WorkshopData, 'projectObjects' | 'shots' | 'workspaceSubmissions'>, objectId: string, outputType: WorkspaceOutputType): WorkspaceMediaVersion[] {
  const registry = data.projectObjects;
  if (!registry) return [];
  const owner = registry.objects.find((item) => item.id === objectId);
  const shot = owner?.kind === 'shot' ? data.shots.find((item) => (item.id ?? item.shotNo) === owner.sourceId) : undefined;
  const currentPath = outputType === 'video' ? shot?.videoPath : outputType === 'image' ? shot?.imagePath : undefined;
  return registry.media.filter((media) => (media.ownerObjectId === objectId || (media.id === objectId && (media.purpose === 'unclassified' || media.mediaType === 'audio'))) && media.mediaType === outputType
    && !media.archived && media.purpose !== 'historical' && media.source !== 'legacy-storyboard'
    && (media.versionObjectId || media.purpose === 'current-version' || media.purpose === 'candidate-version' || media.purpose === 'unclassified'))
    .map((media, index) => {
      const version = registry.versions.find((item) => item.id === media.versionObjectId || item.mediaObjectId === media.id);
      const snapshot = version?.generationSnapshot ?? Object.values(data.workspaceSubmissions ?? {})
        .find((entry) => media.generationTaskId && entry.taskIds.includes(media.generationTaskId))?.draft;
      return { media, version, snapshot, ordinal: version?.ordinal ?? index + 1,
        adopted: version ? version.selected : media.purpose === 'current-version' || currentPath === media.path };
    }).sort((a, b) => a.ordinal - b.ordinal || a.media.updatedAt - b.media.updatedAt);
}

export function selectWorkspaceMedia(versions: WorkspaceMediaVersion[], mediaId?: string) {
  return versions.find((item) => item.media.id === mediaId) ?? versions.find((item) => item.adopted) ?? versions[versions.length - 1];
}

export function workspaceHistoricalParameters(version?: AssetVersionRecord, snapshot = version?.generationSnapshot): string {
  if (!snapshot) return '历史参数未记录';
  const parts = [snapshot.params.ratio ?? snapshot.params.aspectRatio, snapshot.params.duration !== undefined ? `${snapshot.params.duration}秒` : undefined,
    snapshot.params.resolution ?? snapshot.params.size];
  return parts.filter((value) => value !== undefined && value !== '').join(' · ') || '未指定规格';
}
