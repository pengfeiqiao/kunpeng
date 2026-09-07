import type { Node, Edge } from 'reactflow';
import type { WorkshopData } from '../workshop/types.ts';
import { selectAssetVersion } from './selectors.ts';
import { applySelectedProjectVersion } from '../workshop/canvasSyncModel.ts';
import { assessProjectObjectDeletion, deleteProjectObject, removeCanvasNodesFromView } from './deletion.ts';
import { appendProjectSnapshot, createProjectSnapshot } from './snapshots.ts';
import { isNonReferenceEdgeData } from '../canvas/referencePolicy.ts';
import { readWorkspaceCanvasLayout, writeWorkspaceCanvasLayout, isWorkspaceLayoutNode, workspaceLayoutNodeId } from '../workspace/canvasLayout.ts';

export interface ProjectCommandState {
  workshop: WorkshopData;
  canvas: { nodes: Node[]; edges: Edge[] };
}

/** Compute business data and compatibility projections before publishing either store. */
export function selectProjectVersionCommand(
  state: ProjectCommandState,
  ownerObjectId: string,
  versionObjectId: string,
  now = Date.now(),
): ProjectCommandState | null {
  const workshop = selectAssetVersion(state.workshop, ownerObjectId, versionObjectId, now);
  if (workshop === state.workshop) return null;
  const version = workshop.projectObjects?.versions.find((item) => item.id === versionObjectId);
  const media = workshop.projectObjects?.media.find((item) => item.id === version?.mediaObjectId);
  if (!version || !media) return null;
  const projectedNodes = applySelectedProjectVersion(state.canvas.nodes, {
    ownerObjectId, versionObjectId, mediaObjectId: media.id, path: media.path, mediaType: media.mediaType,
  });
  // Old onConnect cached an edge's image in referenceImages too. Drop that
  // duplicate when the edge source changes version; otherwise both versions submit.
  const changedSources = new Map(state.canvas.nodes.flatMap((node, index) => {
    if (node === projectedNodes[index] || node.type !== 'image') return [];
    const path = node.data.generatedImageUrl || node.data.referenceImage;
    return typeof path === 'string' ? [[node.id, path] as const] : [];
  }));
  const nodes = projectedNodes.map((node) => {
    const oldPaths = new Set(state.canvas.edges.filter((edge) => edge.target === node.id && !isNonReferenceEdgeData(edge.data))
      .map((edge) => changedSources.get(edge.source)).filter(Boolean));
    if (!oldPaths.size || !Array.isArray(node.data.referenceImages)) return node;
    return { ...node, data: { ...node.data, referenceImages: node.data.referenceImages.filter((ref: { url: string }) => !oldPaths.has(ref.url)) } };
  });
  return {
    workshop,
    canvas: {
      nodes,
      edges: state.canvas.edges,
    },
  };
}

export function deleteProjectObjectCommand(state: ProjectCommandState, targetId: string, now = Date.now()) {
  const impact = assessProjectObjectDeletion(state.workshop, targetId, now);
  if (!impact) return null;
  const snapshot = createProjectSnapshot(state.workshop, state.canvas, {
    now, label: `删除前 · ${impact.label}`,
    changedObjectIds: [...impact.objectIds, ...impact.mediaIds, ...impact.versionIds],
  });
  const deleted = deleteProjectObject({
    ...state.workshop,
    projectSnapshots: appendProjectSnapshot(state.workshop.projectSnapshots, snapshot),
  }, targetId, now);
  if (!deleted.deleted) return null;
  const ids = new Set([...deleted.impact.objectIds, ...deleted.impact.mediaIds, ...deleted.impact.versionIds]);
  const paths = new Set(state.workshop.projectObjects?.media.filter((item) => ids.has(item.id)).map((item) => item.path));
  const removedOwners = state.workshop.projectObjects?.objects.filter((item) => ids.has(item.id)) ?? [];
  const removedNodeIds = state.canvas.nodes.filter((node) => {
    if (typeof node.data.projectObjectId === 'string' && ids.has(node.data.projectObjectId)) return true;
    if (node.data.mediaPurpose !== 'current-version' && [node.data.mediaObjectId, node.data.versionObjectId]
      .some((id) => typeof id === 'string' && ids.has(id))) return true;
    const ref = node.data.workshopRef;
    if (!ref || ref.projectId !== state.workshop.projectId) return false;
    const kind = ref.kind === 'colorPalette' ? 'scene-asset' : ref.kind;
    return removedOwners.some((owner) => owner.kind === kind && (owner.sourceId === ref.id
      || (owner.kind === 'shot' && state.workshop.shots.some((shot) => (shot.id ?? shot.shotNo) === owner.sourceId && shot.shotNo === ref.id))));
  }).map((node) => node.id);
  const removed = new Set(removedNodeIds);
  // Synthetic reference nodes have ownership independent of project IDs.
  for (const node of state.canvas.nodes) {
    if (removed.has(node.data.workshopPromptRefTarget)) removed.add(node.id);
  }
  const view = removeCanvasNodesFromView(state.canvas.nodes, state.canvas.edges, removed);
  const nodes = view.nodes.map((node) => {
    if (isWorkspaceLayoutNode(node) && node.id === workspaceLayoutNodeId(state.workshop.projectId)) {
      const layout = readWorkspaceCanvasLayout([node], state.workshop.projectId);
      const positions = Object.fromEntries(Object.entries(layout.positions).filter(([id]) => !ids.has(id)));
      return writeWorkspaceCanvasLayout([node], { ...layout, positions })[0];
    }
    const data = { ...node.data };
    const outputPath = node.type === 'image' ? data.generatedImageUrl || data.referenceImage
      : node.type === 'video' ? data.localPath || data.generatedVideoUrl : data.localPath || data.audioUrl;
    if (paths.has(outputPath)) {
      const remaining = deleted.data.projectObjects!;
      const previousMedia = state.workshop.projectObjects?.media.find((item) => item.path === outputPath);
      const ownerId = data.projectObjectId ?? previousMedia?.ownerObjectId;
      const version = remaining.versions.find((item) => item.ownerObjectId === ownerId && item.selected
        && remaining.media.some((media) => media.id === item.mediaObjectId && media.mediaType === node.type));
      const media = remaining.media.find((item) => item.id === version?.mediaObjectId);
      const fields = node.type === 'image' ? ['generatedImageUrl', 'referenceImage', 'localPath']
        : node.type === 'video' ? ['generatedVideoUrl', 'localPath'] : ['audioUrl', 'audioPath', 'localPath'];
      for (const field of fields) data[field] = media?.path;
      data.mediaObjectId = media?.id;
      data.versionObjectId = version?.id;
      data.mediaPurpose = media ? 'current-version' : undefined;
    }
    for (const field of ['referenceImages', 'referenceVideos', 'referenceAudios']) {
      if (Array.isArray(data[field])) data[field] = data[field].filter((ref: { url?: string }) => !ref.url || !paths.has(ref.url));
    }
    let position = node.position;
    let parentId = node.parentNode;
    const visited = new Set<string>();
    while (parentId && removed.has(parentId) && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = state.canvas.nodes.find((item) => item.id === parentId);
      if (!parent) { parentId = undefined; break; }
      position = { x: position.x + parent.position.x, y: position.y + parent.position.y };
      parentId = parent.parentNode;
    }
    return { ...node, data, position, parentNode: parentId, ...(parentId !== node.parentNode ? { extent: undefined } : {}) };
  });
  return { workshop: deleted.data, canvas: { nodes, edges: view.edges }, impact: deleted.impact, snapshotId: snapshot.id };
}
