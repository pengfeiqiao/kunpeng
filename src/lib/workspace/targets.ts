import type { WorkshopData } from '../workshop/types.ts';
import type { ProjectObjectRecord } from '../projectObjects/types.ts';

export const UNCLASSIFIED_WORKSPACE_SOURCE = 'workspace-unclassified';
export function isUnclassifiedWorkspaceGroup(target?: ProjectObjectRecord): boolean {
  return target?.kind === 'generation-task' && target.sourceId === UNCLASSIFIED_WORKSPACE_SOURCE;
}

/** Loose media is addressable without inventing a story owner or making it a reference. */
export function workspaceTarget(data: WorkshopData, id: string): ProjectObjectRecord | undefined {
  return data.projectObjects?.objects.find((item) => item.id === id)
    ?? data.projectObjects?.media.find((item) => item.id === id && !item.archived
      && ((item.purpose === 'unclassified' && (item.mediaType === 'image' || item.mediaType === 'video'))
        || (item.mediaType === 'audio' && item.purpose !== 'historical')));
}
