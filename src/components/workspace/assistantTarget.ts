import type { MediaFileRecord, UnifiedProjectRegistry } from '../../lib/projectObjects/types.ts';
import type { AssistantTarget } from '../../lib/workspace/projectAssistantQueue.ts';

export const WORKSPACE_ASSISTANT_TARGET_EVENT = 'kunpeng-workspace-assistant-target';
export interface WorkspaceAssistantTargetDetail {
  projectId: string;
  objectId: string;
  mediaId?: string;
  accessScope?: 'media' | 'shot';
}

function isDirectMedia(media: MediaFileRecord): boolean {
  return media.mediaType === 'audio' || (media.purpose === 'unclassified' && (media.mediaType === 'image' || media.mediaType === 'video'));
}

/** A direct-media address is valid only when the registry actually supports it. */
export function isAssistantTargetAvailable(registry: UnifiedProjectRegistry | undefined,
  target: Pick<AssistantTarget, 'projectId' | 'objectId' | 'mediaId'>): boolean {
  if (!registry || registry.projectId !== target.projectId) return false;
  if (!target.objectId) return !target.mediaId;
  const object = registry.objects.find((item) => item.id === target.objectId && item.projectId === target.projectId && !item.archived);
  const media = registry.media.find((item) => item.id === target.mediaId && item.projectId === target.projectId && !item.archived
    && item.purpose !== 'historical' && ['image', 'video', 'audio'].includes(item.mediaType));
  const direct = Boolean(media && target.objectId === media.id && isDirectMedia(media));
  if (!object && !direct) return false;
  return !target.mediaId || Boolean(media && (direct || media.ownerObjectId === target.objectId));
}

export function resolveAssistantTargetRequest(registry: UnifiedProjectRegistry | undefined, detail: unknown) {
  if (!registry || !detail || typeof detail !== 'object') return null;
  const input = detail as Partial<WorkspaceAssistantTargetDetail>;
  if (input.projectId !== registry.projectId || typeof input.objectId !== 'string'
    || (input.mediaId !== undefined && typeof input.mediaId !== 'string')
    || (input.accessScope !== undefined && input.accessScope !== 'media' && input.accessScope !== 'shot')) return null;
  const direct = registry.media.find((item) => item.id === input.objectId && isDirectMedia(item));
  const target = { projectId: registry.projectId, objectId: input.objectId, mediaId: input.mediaId ?? direct?.id };
  if (!isAssistantTargetAvailable(registry, target)) return null;
  const owner = registry.objects.find((item) => item.id === target.objectId);
  if (input.accessScope === 'shot' && owner?.kind !== 'shot') return null;
  const accessScope = input.accessScope ?? (!input.mediaId && owner?.kind === 'shot' ? 'shot' : 'media');
  const media = registry.media.find((item) => item.id === target.mediaId);
  const outputType = media?.mediaType === 'image' || media?.mediaType === 'video' || media?.mediaType === 'audio' ? media.mediaType : undefined;
  return { ...target, outputType, accessScope };
}
