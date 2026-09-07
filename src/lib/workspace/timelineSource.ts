import type { WorkshopData } from '../workshop/types.ts';
import type { MediaFileRecord } from '../projectObjects/types.ts';

export type TimelineSourceClipKind = 'main' | 'overlay' | 'audio';
export interface TimelineSourceClip {
  id: string;
  path: string;
  sourceNodeId?: string;
  /** Optional explicit bindings supplied by callers that actually persisted them. */
  versionId?: string;
  mediaId?: string;
}

export interface ResolvedTimelineSource {
  status: 'resolved';
  projectId: string;
  objectId: string;
  shotId: string;
  label: string;
  mediaId: string;
  versionId?: string;
  ordinal?: number;
  path: string;
  outputType: 'image' | 'video' | 'audio';
  adopted: boolean;
  locked: boolean;
}
export type TimelineSourceResult = ResolvedTimelineSource | {
  status: 'unavailable' | 'ambiguous' | 'mismatch';
  reason: string;
};

/** Exact original path only: no basename, URL decoding, proxy, label or current-selection guesses. */
export function resolveTimelineSource(data: WorkshopData, editorProjectId: string | null, clip: TimelineSourceClip): TimelineSourceResult {
  const registry = data.projectObjects;
  if (!editorProjectId || data.projectId !== editorProjectId || registry?.projectId !== editorProjectId) {
    return { status: 'mismatch', reason: '剪辑与工作台项目尚未一致' };
  }
  if (!clip.id || !clip.path) return { status: 'unavailable', reason: '片段缺少原始素材路径' };
  let media = registry.media.filter((item) => item.projectId === editorProjectId && item.path === clip.path
    && !item.archived && item.purpose !== 'generation-reference');
  if (clip.mediaId) media = media.filter((item) => item.id === clip.mediaId);
  if (clip.versionId) {
    const version = registry.versions.find((item) => item.id === clip.versionId && item.projectId === editorProjectId && !item.archived);
    media = media.filter((item) => item.id === version?.mediaObjectId && item.ownerObjectId === version?.ownerObjectId);
  }
  if (!media.length) return { status: clip.versionId || clip.mediaId ? 'mismatch' : 'unavailable', reason: '所用路径或版本未找到，未改用当前采用版' };
  if (media.length > 1 && clip.sourceNodeId) {
    const byNode = media.filter((item) => item.canvasNodeId === clip.sourceNodeId);
    if (byNode.length) media = byNode;
  }
  if (media.length !== 1) return { status: 'ambiguous', reason: '同一路径对应多个来源，不能自动推断原镜头' };
  const item: MediaFileRecord = media[0];
  const object = registry.objects.find((object) => object.id === item.ownerObjectId && object.projectId === editorProjectId && object.kind === 'shot' && !object.archived);
  const shot = object && data.shots.find((shot) => (shot.id ?? shot.shotNo) === object.sourceId);
  if (!object || !shot) return { status: 'unavailable', reason: '原镜头已删除或素材尚未归属镜头' };
  if (!['image', 'video', 'audio'].includes(item.mediaType)) return { status: 'unavailable', reason: '此素材没有可用媒体预览' };
  const versions = registry.versions.filter((version) => version.projectId === editorProjectId && !version.archived
    && version.mediaObjectId === item.id && version.ownerObjectId === object.id && (!clip.versionId || version.id === clip.versionId));
  if (versions.length > 1) return { status: 'ambiguous', reason: '所用文件关联多个历史版本，需明确版本身份' };
  if (clip.versionId && !versions.length) return { status: 'mismatch', reason: '版本与原镜头归属不一致' };
  const version = versions[0];
  return { status: 'resolved', projectId: editorProjectId, objectId: object.id, shotId: shot.id ?? shot.shotNo,
    label: `镜头 ${shot.shotNo}`, mediaId: item.id, versionId: version?.id, ordinal: version?.ordinal,
    path: clip.path, outputType: item.mediaType as ResolvedTimelineSource['outputType'],
    adopted: Boolean(version?.selected), locked: Boolean(object.locked || item.locked || version?.locked) };
}

export const WORKSPACE_INSPECTOR_REQUEST_EVENT = 'kunpeng:workspace-inspector-request';
export interface WorkspaceInspectorRequest {
  schemaVersion: 1;
  projectId: string;
  origin: 'timeline';
  clipKind: TimelineSourceClipKind;
  clipId: string;
  path: string;
  objectId: string;
  mediaId: string;
  versionId?: string;
  outputType: ResolvedTimelineSource['outputType'];
  intent: 'inspect' | 'edit-prompt';
}

export function timelineInspectorRequest(source: ResolvedTimelineSource, clip: TimelineSourceClip, clipKind: TimelineSourceClipKind,
  intent: WorkspaceInspectorRequest['intent'] = 'edit-prompt'): WorkspaceInspectorRequest {
  if (source.path !== clip.path) throw new Error('片段素材已改变');
  return { schemaVersion: 1, origin: 'timeline', projectId: source.projectId, clipKind, clipId: clip.id,
    path: source.path, objectId: source.objectId, mediaId: source.mediaId, versionId: source.versionId,
    outputType: source.outputType, intent: source.locked ? 'inspect' : intent };
}

/** Receiver revalidates against live registry AND the actual clip, never trusts event labels. */
export function validateTimelineInspectorRequest(data: WorkshopData, editorProjectId: string | null,
  clip: TimelineSourceClip | undefined, value: unknown): WorkspaceInspectorRequest | null {
  if (!value || typeof value !== 'object' || !clip) return null;
  const request = value as WorkspaceInspectorRequest;
  if (request.schemaVersion !== 1 || request.origin !== 'timeline' || request.projectId !== data.projectId
    || request.clipId !== clip.id || request.path !== clip.path
    || !['main', 'overlay', 'audio'].includes(request.clipKind) || !['inspect', 'edit-prompt'].includes(request.intent)) return null;
  const source = resolveTimelineSource(data, editorProjectId, clip);
  if (source.status !== 'resolved' || source.objectId !== request.objectId || source.mediaId !== request.mediaId
    || source.versionId !== request.versionId || source.outputType !== request.outputType) return null;
  return timelineInspectorRequest(source, clip, request.clipKind, request.intent);
}

export function dispatchTimelineInspectorRequest(request: WorkspaceInspectorRequest, target: EventTarget = window): void {
  target.dispatchEvent(new CustomEvent(WORKSPACE_INSPECTOR_REQUEST_EVENT, { detail: request }));
}
