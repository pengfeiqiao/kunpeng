import type { Node } from 'reactflow';
import type { WorkshopData } from '../workshop/types.ts';
import type { ProjectObjectRecord } from '../projectObjects/types.ts';
import { migrateWorkshopProjectObjects, stableProjectHash } from '../projectObjects/migrate.ts';
import { registerCanvasGeneration } from '../projectObjects/selectors.ts';
import { initialWorkspaceDraft, saveWorkspaceDraft, workspaceDraftErrors } from './drafts.ts';
import type { WorkspaceReference } from './types.ts';

function canvasOwner(data: WorkshopData, node: Node): ProjectObjectRecord | undefined {
  const ref = node.data.workshopRef;
  if (ref?.projectId && ref.projectId !== data.projectId) return undefined;
  const objects = data.projectObjects?.objects ?? [];
  const explicitId = node.data.projectObjectId ?? ref?.objectId;
  // A missing stable ID must not fall back to a reused shot number after deletion.
  if (explicitId) return objects.find((item) => item.id === explicitId && !item.archived);
  if (!ref || ref.projectId !== data.projectId) return undefined;
  if (ref.kind === 'shot') {
    const shot = ref.shotId ? data.shots.find((item) => item.id === ref.shotId) : data.shots.find((item) => item.shotNo === ref.id);
    return shot && objects.find((item) => item.kind === 'shot' && item.sourceId === (shot.id ?? shot.shotNo) && !item.archived);
  }
  const kind = ref.kind === 'colorPalette' ? 'scene-asset' : ref.kind;
  return objects.find((item) => item.kind === kind && item.sourceId === ref.id && !item.archived);
}

/** Explicit compatibility import: immutable candidates and conflict-safe drafts, never automatic adoption. */
export function importLegacyCanvasObjects(input: WorkshopData, nodes: Node[], references: Record<string, WorkspaceReference[]>, now = Date.now()) {
  let data = migrateWorkshopProjectObjects(input, now);
  const result = { candidates: 0, prompts: 0, conflicts: 0, skipped: 0 };
  for (const node of nodes) {
    if (!['image', 'video', 'audio'].includes(node.type ?? '') || node.data.workshopPromptRefTarget) continue;
    const ref = node.data.workshopRef;
    if (ref?.role === 'prompt-reference' || ref?.role === 'storyboard-frame' || ref?.role === 'storyboard-board') continue;
    if (ref?.projectId && ref.projectId !== data.projectId) continue;
    const owner = canvasOwner(data, node);
    if (!owner || owner.locked || !['shot', 'character', 'scene', 'prop', 'scene-asset', 'director-constraint'].includes(owner.kind)
      || (node.type === 'video' && owner.kind !== 'shot') || (node.type === 'audio' && owner.kind !== 'character' && owner.kind !== 'shot')) {
      if (ref || node.data.projectObjectId) result.skipped++;
      continue;
    }
    const type = node.type as 'image' | 'video' | 'audio';
    const path = typeof node.data.localPath === 'string' ? node.data.localPath.trim() : '';
    if (path && !data.projectObjects!.media.some((item) => item.ownerObjectId === owner.id && item.path === path && item.mediaType === type)) {
      // This is an import identity, not a new provider task or permission to submit.
      const taskId = `canvas-import:${stableProjectHash(`${node.id}\u0000${path}`)}`;
      const imported = registerCanvasGeneration(data, { nodeId: node.id, taskId, paths: [path], mediaType: type, ownerObjectId: owner.id }, now);
      data = imported.data; result.candidates++;
    }
    if (type === 'audio') continue;
    const prompt = typeof node.data.description === 'string' ? node.data.description.trim() : '';
    if (!prompt) continue;
    const draft = initialWorkspaceDraft(data, owner.id, type, now);
    if (!draft) continue;
    const refs = references[node.id] ?? [];
    if (refs.some((reference) => data.projectObjects!.media.some((media) => media.path === reference.path
      && (media.purpose === 'historical' || media.source === 'legacy-storyboard')))) { result.conflicts++; continue; }
    const stored = data.workspaceDrafts?.[draft.id];
    if (stored) {
      if (stored.prompt !== prompt || JSON.stringify(stored.references.map((item) => [item.type, item.path])) !== JSON.stringify(refs.map((item) => [item.type, item.path]))) result.conflicts++;
      continue;
    }
    const next = { ...draft, prompt, references: refs };
    if (workspaceDraftErrors(next).length) { result.conflicts++; continue; }
    const saved = saveWorkspaceDraft(data, next, 0, now);
    if (saved) { data = saved; result.prompts++; }
  }
  return { data, ...result };
}
