import type { ProjectConversationReference } from './types.ts';
import { createProjectConversationReference } from './conversationRefs.ts';
import type { WorkshopData } from '../workshop/types.ts';

export function projectTransferReferences(data: WorkshopData): ProjectConversationReference[] {
  const registry = data.projectObjects;
  if (!registry) return [];
  return [...registry.objects, ...registry.media, ...registry.versions].map((item) => {
    const media = item.kind === 'media-file' ? registry.media.find((entry) => entry.id === item.id)
      : registry.media.find((entry) => entry.ownerObjectId === item.id && entry.purpose === 'current-version');
    const shot = item.kind === 'shot' ? data.shots.find((entry) => (entry.id ?? entry.shotNo) === item.sourceId) : undefined;
    return createProjectConversationReference({
      objectId: item.id, kind: item.kind, sourceView: 'workshop',
      sourceId: shot?.shotNo ?? item.sourceId, label: item.label ?? item.id,
      version: item.version, thumbnailPath: media?.path, operationScope: 'edit',
    });
  });
}

export const PROJECT_REFERENCE_MIME = 'application/x-kunpeng-project-reference';

// Transfer identity only. Resolve labels, paths and permissions from current data
// on drop instead of trusting a stale card or externally supplied JSON.
export function encodeReferenceTransfer(projectId: string, reference: ProjectConversationReference): string {
  return JSON.stringify({ projectId, objectId: reference.objectId, sourceId: reference.sourceId });
}

export function resolveReferenceTransfer(
  value: string,
  projectId: string,
  available: ProjectConversationReference[],
): ProjectConversationReference | null {
  if (!projectId || value.length > 8192) return null;
  try {
    const input = JSON.parse(value);
    if (!input || input.projectId !== projectId || typeof input.objectId !== 'string') return null;
    return available.find((ref) => ref.objectId === input.objectId && ref.sourceId === input.sourceId) ?? null;
  } catch { return null; }
}

export function quoteProjectReference(reference: ProjectConversationReference, text: string): ProjectConversationReference | null {
  if (!text.trim()) return null;
  return createProjectConversationReference({
    ...reference, kind: 'text-selection', quotedText: text, operationScope: 'read',
  });
}
