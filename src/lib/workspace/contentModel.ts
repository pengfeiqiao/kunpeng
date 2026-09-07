import type { WorkshopData } from '../workshop/types.ts';
import type { ProjectViewState } from '../projectObjects/types.ts';
import type { WorkspaceOutputType } from './types.ts';
import { selectWorkspaceMedia, workspaceMediaVersions } from './mediaView.ts';
import { isUnclassifiedWorkspaceGroup, workspaceTarget } from './targets.ts';
import { unclassifiedOutputType } from './inbox.ts';

export interface WorkspaceContentItem {
  id: string;
  label: string;
  kind: 'shot' | 'character' | 'scene' | 'prop' | 'scene-asset' | 'material';
  preferredOutputType?: WorkspaceOutputType;
  description: string;
  shotNo?: string;
  /** 按场序号的展示编号（同一场内 01 起），不改动 shotNo 数据 */
  displayNo?: string;
  durationSec?: number;
  thumbnailPath?: string;
  status: string;
  locked: boolean;
}
export interface WorkspaceContentGroup { id: string; label: string; items: WorkspaceContentItem[] }

/** Shot groups are contiguous runs, not a regrouping that changes narrative order. */
export function workspaceContentGroups(data: WorkshopData): WorkspaceContentGroup[] {
  const registry = data.projectObjects;
  if (!registry) return [];
  const owners = new Map(registry.objects.filter((item) => !item.archived).map((item) => [item.id, item]));
  const images = new Map<string, string>();
  const mediaOwners = new Set<string>();
  for (const media of registry.media) {
    if (media.ownerObjectId && !media.archived && media.purpose !== 'historical') mediaOwners.add(media.ownerObjectId);
    if (media.mediaType !== 'image' || !media.ownerObjectId || media.archived || media.purpose === 'historical') continue;
    if (!images.has(media.ownerObjectId) || media.purpose === 'current-version') images.set(media.ownerObjectId, media.path);
  }
  const submissionsByOwner = new Map<string, NonNullable<WorkshopData['workspaceSubmissions']>[string][]>();
  for (const submission of Object.values(data.workspaceSubmissions ?? {})) {
    const entries = submissionsByOwner.get(submission.draft.objectId) ?? [];
    entries.push(submission); submissionsByOwner.set(submission.draft.objectId, entries);
  }
  const status = (id: string, hasMedia: boolean) => {
    const submissions = submissionsByOwner.get(id) ?? [];
    if (submissions.some((entry) => entry.status === 'uncertain')) return '待核实';
    if (submissions.some((entry) => entry.status === 'awaiting-confirmation')) return '待确认';
    if (submissions.some((entry) => entry.status === 'running' || entry.status === 'submitting')) return '生成中';
    if (submissions.length && submissions[submissions.length - 1].status === 'failed') return '失败';
    return hasMedia ? '已有媒体' : '待生成';
  };
  const assets: WorkspaceContentItem[] = [];
  const descriptions = new Map<string, string>([
    ...data.characters.map((item) => [item.id, item.appearance || item.personality] as [string, string]),
    ...[...data.scenes, ...data.props].map((item) => [item.id, item.description] as [string, string]),
  ]);
  for (const owner of owners.values()) {
    if (owner.kind !== 'character' && owner.kind !== 'scene' && owner.kind !== 'prop' && owner.kind !== 'scene-asset') continue;
    assets.push({ id: owner.id, label: owner.label ?? owner.sourceId ?? owner.id, kind: owner.kind,
      description: descriptions.get(owner.sourceId ?? '') ?? '', thumbnailPath: images.get(owner.id), status: status(owner.id, images.has(owner.id)), locked: Boolean(owner.locked) });
  }
  const groups: WorkspaceContentGroup[] = assets.length ? [{ id: 'assets', label: '角色、场景与道具', items: assets }] : [];
  let lastSceneKey: string | undefined;
  let group: WorkspaceContentGroup | undefined;
  const shotOwners = new Map([...owners.values()].filter((item) => item.kind === 'shot').map((item) => [item.sourceId, item]));
  const scenesById = new Map(data.scenes.map((scene) => [scene.id, scene]));
  for (const shot of data.shots) {
    const owner = shotOwners.get(shot.id ?? shot.shotNo);
    if (!owner) continue;
    const sceneKey = `${shot.episode ?? ''}::${shot.sceneId ?? ''}`;
    if (!group || sceneKey !== lastSceneKey) {
      const scene = shot.sceneId ? scenesById.get(shot.sceneId) : undefined;
      group = { id: `scene-run:${owner.id}`, label: [shot.episode, scene?.name ?? '未指定场景'].filter(Boolean).join(' · '), items: [] };
      groups.push(group); lastSceneKey = sceneKey;
    }
    group.items.push({ id: owner.id, label: owner.label ?? `镜头 ${shot.shotNo}`, kind: 'shot', shotNo: shot.shotNo,
      displayNo: String(group.items.length + 1).padStart(2, '0'),
      durationSec: shot.durationSec, description: shot.description, thumbnailPath: shot.imagePath ?? images.get(owner.id),
      status: status(owner.id, Boolean(shot.imagePath || shot.videoPath || images.has(owner.id)
        || mediaOwners.has(owner.id))), locked: Boolean(owner.locked) });
  }
  const audio = registry.media.filter((media) => !media.archived && media.mediaType === 'audio' && media.purpose !== 'historical');
  if (audio.length) groups.push({ id: 'audio', label: '音频', items: audio.map((media) => ({ id: media.id,
    label: media.label ?? '音频素材', kind: 'material', preferredOutputType: 'audio', description: '',
    status: '已有媒体', locked: Boolean(media.locked) })) });
  const inbox: WorkspaceContentItem[] = [];
  const stagedIds = new Set<string>();
  for (const owner of owners.values()) {
    if (!isUnclassifiedWorkspaceGroup(owner)) continue;
    stagedIds.add(owner.id);
    const type = unclassifiedOutputType(data, owner.id);
    const media = workspaceMediaVersions(data, owner.id, type);
    const submissions = Object.values(data.workspaceSubmissions ?? {}).filter((entry) => entry.draft.objectId === owner.id);
    if (!media.length && submissions.length && submissions.every((entry) => entry.status === 'succeeded')) continue;
    inbox.push({ id: owner.id, label: owner.label ?? '其他素材', kind: 'material', preferredOutputType: type,
      description: '', thumbnailPath: type === 'image' ? media[media.length - 1]?.media.path : undefined,
      status: status(owner.id, Boolean(media.length)), locked: Boolean(owner.locked) });
  }
  for (const media of registry.media) {
    if (media.archived || media.purpose !== 'unclassified' || stagedIds.has(media.ownerObjectId ?? '')
      || (media.mediaType !== 'image' && media.mediaType !== 'video')) continue;
    inbox.push({ id: media.id, label: media.label ?? '其他素材', kind: 'material', preferredOutputType: media.mediaType,
      description: '', thumbnailPath: media.mediaType === 'image' ? media.path : undefined, status: '未归类', locked: Boolean(media.locked) });
  }
  if (inbox.length) groups.push({ id: 'unclassified', label: '其他素材', items: inbox });
  return groups;
}

export function workspaceSelection(data: WorkshopData) {
  const groups = workspaceContentGroups(data);
  const items = groups.flatMap((group) => group.items);
  const state = data.projectViewState ?? {};
  const selected = items.find((item) => item.id === state.workspaceObjectId)
    ?? items.find((item) => item.kind === 'shot' && data.projectObjects?.objects.find((owner) => owner.id === item.id)?.sourceId === state.selectedShotId)
    ?? items.find((item) => item.kind === 'shot') ?? items[0];
  const outputType: WorkspaceOutputType = selected?.kind === 'shot' ? (state.workspaceOutputType === 'image' ? 'image' : 'video')
    : selected?.preferredOutputType ?? 'image';
  const versions = selected ? workspaceMediaVersions(data, selected.id, outputType) : [];
  return { groups, selected, outputType, versions, media: selectWorkspaceMedia(versions, state.workspaceMediaId) };
}

export function selectWorkspaceObject(data: WorkshopData, objectId: string, outputType?: WorkspaceOutputType): ProjectViewState | null {
  const owner = workspaceTarget(data, objectId);
  const material = isUnclassifiedWorkspaceGroup(owner) || owner?.kind === 'media-file';
  if (!owner || owner.archived || (!material && !['shot', 'character', 'scene', 'prop', 'scene-asset'].includes(owner.kind))) return null;
  const audio = data.projectObjects?.media.some((media) => media.id === objectId && media.mediaType === 'audio');
  const type = audio ? 'audio' : owner.kind === 'shot' ? (outputType === 'image' ? 'image' : outputType === 'video' ? 'video'
    : data.projectViewState?.workspaceOutputType === 'image' ? 'image' : 'video') : material ? unclassifiedOutputType(data, objectId) : 'image';
  const media = selectWorkspaceMedia(workspaceMediaVersions(data, objectId, type));
  return { ...data.projectViewState, workspaceObjectId: objectId, workspaceOutputType: type,
    workspaceMediaId: media?.media.id, selectedObjectIds: [objectId],
    selectedShotId: owner.kind === 'shot' ? owner.sourceId : data.projectViewState?.selectedShotId };
}
