import type { ProjectCommandState } from '../projectObjects/projectCommands.ts';
import { assignUnclassifiedMedia } from './inbox.ts';

export type ProfessionalCanvasAssignment = Parameters<typeof assignUnclassifiedMedia>[1];

/** Classify the existing media and project metadata in the same command; no URL/path-based ownership inference. */
export function assignProfessionalCanvasMediaCommand(state: ProjectCommandState, input: ProfessionalCanvasAssignment,
  now = Date.now(), pathKey: (path: string) => string = (path) => path): ProjectCommandState {
  const before = state.workshop.projectObjects;
  const media = before?.media.find((item) => item.id === input.mediaId);
  const workshop = assignUnclassifiedMedia(state.workshop, input, now);
  if (!workshop || !media || !before) throw new Error('归类对象已改变、锁定或不支持此归属，未修改');
  const moved = workshop.projectObjects!.media.find((item) => item.id === media.id)!;
  const owner = workshop.projectObjects!.objects.find((item) => item.id === input.ownerId)!;
  const shot = owner.kind === 'shot' ? workshop.shots.find((item) => (item.id ?? item.shotNo) === owner.sourceId) : undefined;
  const nodes = state.canvas.nodes.map((node) => {
    const data = node.data;
    const ref = data.workshopRef;
    const mediaIds = [data.mediaObjectId, ref?.mediaObjectId].filter((id) => id != null);
    const versionIds = [data.versionObjectId, ref?.versionObjectId].filter((id) => id != null);
    const explicit = mediaIds.includes(media.id) || (media.versionObjectId && versionIds.includes(media.versionObjectId));
    const provenance = media.canvasNodeId === node.id;
    if (!explicit && !provenance) return node;
    const output = node.type === 'image' ? data.generatedImageUrl : node.type === 'video' ? data.generatedVideoUrl : data.audioUrl;
    const displayed = data.localPath || output;
    const matchesPath = typeof displayed === 'string' && pathKey(displayed) === pathKey(media.path);
    // A reused generation node may now display a later result. Never rebind it to an older result.
    if (!explicit && !matchesPath) return node;
    if (mediaIds.some((id) => id !== media.id) || versionIds.some((id) => id !== media.versionObjectId)
      || (data.projectObjectId != null && data.projectObjectId !== media.ownerObjectId)
      || (ref?.objectId != null && ref.objectId !== media.ownerObjectId)
      || (ref?.projectId && ref.projectId !== workshop.projectId)
      || (!ref?.objectId && ref) || !matchesPath || node.type !== media.mediaType || data.isGenerating
      || data.locked || data.archived || data.workshopPromptRefTarget) throw new Error('专业节点归属或显示产物冲突，归类未写入');
    if (!explicit && before.media.filter((item) => !item.archived && item.canvasNodeId === node.id
      && pathKey(item.path) === pathKey(media.path)).length !== 1) throw new Error('专业节点产物身份不唯一，归类未写入');
    return { ...node, data: { ...data, projectObjectId: owner.id, mediaObjectId: moved.id, versionObjectId: moved.versionObjectId,
      mediaPurpose: 'candidate-version', workspaceDraftId: undefined, workspaceProjection: undefined,
      workshopRef: { projectId: workshop.projectId, kind: owner.kind === 'scene-asset' ? 'colorPalette' : owner.kind,
        id: shot?.shotNo ?? owner.sourceId, role: shot ? node.type === 'video' ? 'shot-video' : 'shot-image' : 'asset',
        objectId: owner.id, mediaObjectId: moved.id, versionObjectId: moved.versionObjectId,
        ...(shot ? { shotId: shot.id ?? shot.shotNo, shotNoSnapshot: shot.shotNo } : {}) } } };
  });
  return { workshop, canvas: { ...state.canvas, nodes } };
}
