import type { WorkshopData } from '../workshop/types.ts';
import type { AssetVersionRecord, MediaFileRecord, ProjectObjectRecord } from '../projectObjects/types.ts';
import type { WorkspaceOutputType } from './types.ts';
import { initialWorkspaceDraft, saveWorkspaceDraft } from './drafts.ts';
import { isUnclassifiedWorkspaceGroup, UNCLASSIFIED_WORKSPACE_SOURCE } from './targets.ts';
import { mergeWorkspaceShots } from './shotEdits.ts';
import { stableProjectObjectId } from '../projectObjects/migrate.ts';

/** Explicitly append a blank shot; never clone the selected shot's story, references or paid outputs. */
export function createWorkspaceShot(data: WorkshopData, token: string, now = Date.now()): WorkshopData | null {
  if (!token || !/^[a-zA-Z0-9-]+$/.test(token)) return null;
  const id = `workspace-shot-${token}`;
  const objectId = stableProjectObjectId('shot', id);
  if (data.shots.some((shot) => shot.id === id) || data.projectObjects?.objects.some((item) => item.id === objectId)) return null;
  const used = new Set(data.shots.map((shot) => shot.shotNo));
  let ordinal = Math.max(data.shots.length, ...data.shots.map((shot) => /^\d{1,6}$/.test(shot.shotNo) ? Number(shot.shotNo) : 0)) + 1;
  while (used.has(String(ordinal).padStart(2, '0'))) ordinal++;
  const next = mergeWorkspaceShots(data, [{ id, shotNo: String(ordinal).padStart(2, '0'), description: '', characterIds: [] }], () => id, now);
  return { ...next, projectViewState: { ...next.projectViewState, workspaceSurface: 'media', workspaceMediaView: 'list',
    workspaceObjectId: objectId, workspaceMediaId: undefined, workspaceOutputType: 'video', workspaceComposerOpen: true,
    selectedObjectIds: [objectId] } };
}

/** A staging generation group is not a scene/shot and never inherits the last selected object. */
export function createUnclassifiedGeneration(data: WorkshopData, token: string, type: 'image' | 'video', now = Date.now()): WorkshopData | null {
  const registry = data.projectObjects;
  if (!registry || !token || !/^[a-zA-Z0-9-]+$/.test(token)) return null;
  const id = `generation-task:workspace:${token}`;
  if (registry.objects.some((item) => item.id === id)) return null;
  const object: ProjectObjectRecord = { id, kind: 'generation-task', source: 'canvas', sourceId: UNCLASSIFIED_WORKSPACE_SOURCE,
    projectId: data.projectId, label: `新${type === 'image' ? '图片' : '视频'}素材`, relationIds: [], version: 1, updatedAt: now };
  const next = { ...data, projectObjects: { ...registry, objects: [...registry.objects, object], updatedAt: now } };
  const draft = initialWorkspaceDraft(next, id, type, now);
  if (!draft) return null;
  const saved = saveWorkspaceDraft(next, draft, 0, now)!;
  return { ...saved, projectViewState: { ...saved.projectViewState, workspaceSurface: 'media', workspaceObjectId: id,
    workspaceOutputType: type, workspaceMediaId: undefined, workspaceComposerOpen: true, workspaceCanvasInspectorOpen: true,
    selectedObjectIds: [id] } };
}

export function inboxAssignmentTargets(data: WorkshopData, media: MediaFileRecord): ProjectObjectRecord[] {
  return data.projectObjects?.objects.filter((item) => !item.archived && !item.locked && (item.kind === 'shot'
    || (media.mediaType === 'image' && ['character', 'scene', 'prop', 'scene-asset'].includes(item.kind)))) ?? [];
}

/** Classification updates ownership only; selection, references, submitted snapshots and file bytes remain unchanged. */
export function assignUnclassifiedMedia(data: WorkshopData, input: {
  mediaId: string; ownerId: string; expectedMediaVersion: number; expectedOwnerVersion: number;
}, now = Date.now()): WorkshopData | null {
  const registry = data.projectObjects;
  const media = registry?.media.find((item) => item.id === input.mediaId);
  const owner = registry?.objects.find((item) => item.id === input.ownerId);
  const oldOwner = registry?.objects.find((item) => item.id === media?.ownerObjectId);
  if (!registry || !media || media.archived || media.locked || media.purpose !== 'unclassified'
    || oldOwner?.locked || oldOwner?.archived
    || (media.ownerObjectId && !isUnclassifiedWorkspaceGroup(oldOwner)) || media.version !== input.expectedMediaVersion
    || !owner || owner.version !== input.expectedOwnerVersion || !inboxAssignmentTargets(data, media).some((item) => item.id === owner.id)) return null;
  const oldVersion = registry.versions.find((item) => item.id === media.versionObjectId || item.mediaObjectId === media.id);
  if (oldVersion?.locked || oldVersion?.archived) return null;
  const ordinal = Math.max(0, ...registry.versions.filter((item) => item.ownerObjectId === owner.id).map((item) => item.ordinal)) + 1;
  const snapshot = oldVersion?.generationSnapshot ?? Object.values(data.workspaceSubmissions ?? {})
    .find((item) => media.generationTaskId && item.taskIds.includes(media.generationTaskId))?.draft;
  const versionId = oldVersion?.id ?? `asset-version:classified:${media.id}`;
  const withoutOldOwner = (ids: string[]) => ids.filter((id) => id !== media.ownerObjectId);
  const version: AssetVersionRecord = { id: versionId, projectId: data.projectId, kind: 'asset-version',
    source: media.source, sourceId: oldVersion?.sourceId ?? media.sourceId, label: `候选版本 ${ordinal}`,
    relationIds: [...new Set([...withoutOldOwner(oldVersion?.relationIds ?? media.relationIds), owner.id, media.id])],
    version: (oldVersion?.version ?? 0) + 1, updatedAt: now, ownerObjectId: owner.id, mediaObjectId: media.id, ordinal, selected: false,
    prompt: oldVersion?.prompt ?? snapshot?.prompt, engineId: oldVersion?.engineId ?? snapshot?.engineId, generationSnapshot: snapshot };
  return { ...data, projectObjects: { ...registry, updatedAt: now,
    media: registry.media.map((item) => item.id === media.id ? { ...item, ownerObjectId: owner.id, versionObjectId: versionId,
      purpose: 'candidate-version', relationIds: [...new Set([...withoutOldOwner(item.relationIds), owner.id])],
      version: item.version + 1, updatedAt: now } : item),
    versions: oldVersion ? registry.versions.map((item) => item.id === oldVersion.id ? version : item) : [...registry.versions, version],
  } };
}

export function unclassifiedOutputType(data: WorkshopData, objectId: string): WorkspaceOutputType {
  const loose = data.projectObjects?.media.find((item) => item.id === objectId);
  if (loose?.mediaType === 'video') return 'video';
  const draft = Object.values(data.workspaceDrafts ?? {}).find((item) => item.objectId === objectId);
  return draft?.outputType === 'video' ? 'video' : 'image';
}

/** Explicitly create a blank character/scene/prop: workshop entity + registry object, no media, no generation. */
export function createWorkspaceAsset(data: WorkshopData, kind: 'character' | 'scene' | 'prop', token: string, now = Date.now()): WorkshopData | null {
  const registry = data.projectObjects;
  if (!registry || !token || !/^[a-zA-Z0-9-]+$/.test(token)) return null;
  const id = `workspace-${kind}-${token}`;
  const objectId = stableProjectObjectId(kind, id);
  const list = kind === 'character' ? data.characters : kind === 'scene' ? data.scenes : data.props;
  if (list.some((item) => item.id === id) || registry.objects.some((item) => item.id === objectId)) return null;
  const label = kind === 'character' ? '新角色' : kind === 'scene' ? '新场景' : '新道具';
  const object: ProjectObjectRecord = { id: objectId, kind, source: 'workshop', sourceId: id, projectId: data.projectId,
    label, relationIds: [], version: 1, updatedAt: now };
  const nextRegistry = { ...registry, objects: [...registry.objects, object], updatedAt: now };
  const view = { ...data.projectViewState, workspaceSurface: 'media' as const, workspaceMediaView: 'list' as const,
    workspaceObjectId: objectId, workspaceMediaId: undefined, selectedObjectIds: [objectId], workspaceComposerOpen: false };
  if (kind === 'character') return { ...data, characters: [...data.characters, { id, name: label, appearance: '', personality: '' }], projectObjects: nextRegistry, projectViewState: view };
  if (kind === 'scene') return { ...data, scenes: [...data.scenes, { id, name: label, description: '' }], projectObjects: nextRegistry, projectViewState: view };
  return { ...data, props: [...data.props, { id, name: label, description: '' }], projectObjects: nextRegistry, projectViewState: view };
}

/** Rename/re-describe an object: registry label + underlying workshop entity. Locked/archived objects refuse. */
export function renameWorkspaceObject(data: WorkshopData, objectId: string, input: { label?: string; description?: string }, now = Date.now()): WorkshopData | null {
  const registry = data.projectObjects;
  if (!registry) return null;
  const object = registry.objects.find((item) => item.id === objectId && !item.archived);
  if (!object || object.locked) return null;
  const label = input.label?.trim();
  const description = input.description !== undefined ? input.description.trim() : undefined;
  if (!label && description === undefined) return null;
  const nextRegistry = { ...registry, updatedAt: now, objects: registry.objects.map((item) => item.id === objectId
    ? { ...item, label: label || item.label, version: item.version + 1, updatedAt: now } : item) };
  const next = { ...data, projectObjects: nextRegistry };
  if (object.kind === 'character') return { ...next, characters: next.characters.map((item) => item.id === object.sourceId
    ? { ...item, name: label || item.name, personality: description ?? item.personality } : item) };
  if (object.kind === 'scene') return { ...next, scenes: next.scenes.map((item) => item.id === object.sourceId
    ? { ...item, name: label || item.name, description: description ?? item.description } : item) };
  if (object.kind === 'prop') return { ...next, props: next.props.map((item) => item.id === object.sourceId
    ? { ...item, name: label || item.name, description: description ?? item.description } : item) };
  if (object.kind === 'shot' && description !== undefined) return { ...next, shots: next.shots.map((item) => (item.id ?? item.shotNo) === object.sourceId
    ? { ...item, description } : item) };
  return next;
}
