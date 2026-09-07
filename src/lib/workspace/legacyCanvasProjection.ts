import type { Node } from 'reactflow';
import type { ProjectCommandState } from '../projectObjects/projectCommands.ts';
import { migrateWorkshopProjectObjects, stableProjectHash, stableProjectObjectId } from '../projectObjects/migrate.ts';
import { computePendingCanvasPositions, pruneManagedShotReferences } from '../workshop/canvasSyncModel.ts';
import { isNonReferenceEdgeData } from '../canvas/referencePolicy.ts';
import { collectReferencesFromSnapshot } from '../canvas/collectRefsModel.ts';
import { initialWorkspaceDraft, saveWorkspaceDraft } from './drafts.ts';
import { legacyShotDraft } from './legacyShotReferences.ts';
import type { WorkspaceDraft } from './types.ts';

/** Compatibility projection only. Professional edits/edges and in-flight nodes are conflicts, never overwritten. */
export function projectLegacyCanvas(state: ProjectCommandState, scope: 'assets' | 'shots',
  displayPath: (path: string) => string = (path) => path, now = Date.now()) {
  let workshop = state.workshop.projectObjects ? state.workshop : migrateWorkshopProjectObjects(state.workshop, now);
  let canvas = state.canvas;
  let created = 0; let updated = 0; let conflicts = 0;
  const targets = scope === 'shots' ? workshop.shots.map((shot) => ({ objectId: stableProjectObjectId('shot', shot.id ?? shot.shotNo),
    sourceId: shot.id ?? shot.shotNo, label: shot.shotNo, kind: 'shot', role: 'shot-video', type: 'video' as const,
    draft: legacyShotDraft(workshop, shot, 'video', now), shot }))
    : workshop.projectObjects!.objects.filter((item) => ['character', 'scene', 'prop', 'scene-asset'].includes(item.kind)).map((owner) => ({
      objectId: owner.id, sourceId: owner.sourceId!, label: owner.label ?? '', kind: owner.kind === 'scene-asset' ? 'colorPalette' : owner.kind,
      role: 'asset', type: 'image' as const, draft: initialWorkspaceDraft(workshop, owner.id, 'image', now), shot: undefined,
    }));
  for (const target of targets) {
    const previousCanvas = canvas;
    const previousWorkshop = workshop;
    const owner = workshop.projectObjects!.objects.find((item) => item.id === target.objectId);
    if (!owner || owner.archived || owner.locked || !target.draft || (scope === 'shots' && !target.draft.prompt.trim())) { conflicts++; continue; }
    const matches = canvas.nodes.filter((node) => {
      const ref = node.data.workshopRef;
      if (node.type !== target.type || node.data.workshopPromptRefTarget || ref?.role === 'prompt-reference') return false;
      if (ref?.projectId && ref.projectId !== workshop.projectId) return false;
      const stable = node.data.projectObjectId ?? ref?.objectId;
      if (stable) return stable === target.objectId;
      if (!ref || ref.projectId !== workshop.projectId || ref.kind !== target.kind || ref.role !== target.role) return false;
      return ref.shotId ? ref.shotId === target.sourceId : ref.id === (target.shot?.shotNo ?? target.sourceId);
    });
    const existing = matches.find((node) => !node.data.mediaObjectId || node.data.mediaPurpose === 'current-version');
    if (matches.length > 1 || (matches.length && !existing)) { conflicts++; continue; }
    const draft = target.draft;
    const manualEdges = existing && canvas.edges.some((edge) => edge.target === existing.id && !isNonReferenceEdgeData(edge.data)
      && edge.data?.relation !== 'workshop-reference' && !canvas.nodes.some((node) => node.id === edge.source && node.data.workshopPromptRefTarget === existing.id));
    const sharedSynthetic = existing && canvas.nodes.some((node) => node.data.workshopPromptRefTarget === existing.id
      && canvas.edges.some((edge) => edge.source === node.id && edge.target !== existing.id));
    const prior = existing?.data.workspaceProjection;
    const directImages = draft.references.filter((ref) => ref.type === 'image').map((ref) => ({ url: ref.path, name: ref.label }));
    const dirty = existing && ((existing.data.description ?? '') !== (prior?.prompt ?? draft.prompt)
      || JSON.stringify(existing.data.referenceImages ?? []) !== JSON.stringify(prior?.referenceImages ?? directImages));
    if (existing && (existing.data.isGenerating || manualEdges || sharedSynthetic || dirty)) { conflicts++; continue; }
    const nodeId = existing?.id ?? `node-workspace-${stableProjectHash(`${workshop.projectId}:${target.objectId}:${target.type}`)}`;
    if (!existing && canvas.nodes.some((node) => node.id === nodeId)) { conflicts++; continue; }
    if (!workshop.workspaceDrafts?.[draft.id]) {
      const saved = saveWorkspaceDraft(workshop, draft, 0, now);
      if (!saved) { conflicts++; continue; }
      workshop = saved;
    }
    const saved: WorkspaceDraft = workshop.workspaceDrafts![draft.id];
    const version = workshop.projectObjects!.versions.find((item) => item.ownerObjectId === target.objectId && item.selected
      && workshop.projectObjects!.media.some((media) => media.id === item.mediaObjectId && media.mediaType === target.type));
    const media = workshop.projectObjects!.media.find((item) => item.id === version?.mediaObjectId);
    // An unindexed professional output must be imported explicitly before replacing its display slot.
    const output = existing?.data.localPath || (target.type === 'image' ? existing?.data.generatedImageUrl : existing?.data.generatedVideoUrl);
    if (output && output !== media?.path && output !== (media && displayPath(media.path))) { conflicts++; continue; }
    canvas = pruneManagedShotReferences(canvas.nodes, canvas.edges, nodeId);
    const referenceImages = directImages;
    const node: Node = { ...(existing ?? { id: nodeId, type: target.type,
      position: computePendingCanvasPositions(canvas.nodes, 1)[0], style: { width: 280, height: 220 } }), data: {
      ...existing?.data, description: saved.prompt, projectObjectId: target.objectId,
      mediaObjectId: media?.id, versionObjectId: version?.id, mediaPurpose: media ? 'current-version' : undefined,
      localPath: media?.path, ...(target.type === 'image' ? { generatedImageUrl: media && displayPath(media.path), referenceImage: undefined }
        : { generatedVideoUrl: media && displayPath(media.path) }),
      referenceImages, workspaceDraftId: saved.id, workspaceProjection: { prompt: saved.prompt, referenceImages, revision: saved.revision },
      ...(!existing ? { pendingOrganization: true } : {}),
      workshopRef: { projectId: workshop.projectId, kind: target.kind, id: target.shot?.shotNo ?? target.sourceId,
        role: target.role, objectId: target.objectId, ...(target.shot ? { shotId: target.sourceId, shotNoSnapshot: target.label } : {}) },
    } };
    canvas = { ...canvas, nodes: existing ? canvas.nodes.map((item) => item.id === nodeId ? node : item) : [...canvas.nodes, node] };
    // The collector reads video/audio from edges; image refs are already ordered direct fields.
    for (const ref of saved.references.filter((item) => item.type !== 'image')) {
      const id = `node-workspace-ref-${stableProjectHash(`${nodeId}:${ref.id}`)}`;
      const reference: Node = { id, type: ref.type, position: previousCanvas.nodes.find((item) => item.id === id)?.position ?? computePendingCanvasPositions(canvas.nodes, 1)[0],
        style: { width: 240, height: 160 }, data: { description: ref.label, localPath: ref.path,
          ...(ref.type === 'audio' ? { audioUrl: displayPath(ref.path) } : { generatedVideoUrl: displayPath(ref.path) }),
          workshopPromptRefTarget: nodeId, pendingOrganization: true } };
      canvas = { nodes: [...canvas.nodes, reference], edges: [...canvas.edges,
        { id: `edge-${id}`, source: id, target: nodeId, data: { relation: 'workshop-reference' } }] };
    }
    const collected = collectReferencesFromSnapshot(nodeId, canvas);
    const actual = [...collected.images, ...collected.videos, ...collected.audios].map((ref) => `${ref.kind}:${ref.submitUrl}`);
    const expected = ['image', 'video', 'audio'].flatMap((type) => saved.references.filter((ref) => ref.type === type).map((ref) => `${ref.type}:${ref.path}`));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      canvas = previousCanvas; workshop = previousWorkshop; conflicts++; continue;
    }
    if (existing) updated++; else created++;
  }
  return { workshop, canvas, created, updated, conflicts };
}
