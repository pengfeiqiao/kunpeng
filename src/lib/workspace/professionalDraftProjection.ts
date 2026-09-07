import type { Node } from 'reactflow';
import type { WorkshopData } from '../workshop/types.ts';
import type { WorkspaceDraft } from './types.ts';

const fields: Record<string, string> = {
  resolution: 'resolution', duration: 'duration', hasAudio: 'hasAudio',
  midjourneyStylize: 'stylize', midjourneyChaos: 'chaos', midjourneyRaw: 'raw',
  midjourneyStyleWeight: 'sw', midjourneyImageWeight: 'iw', midjourneyWeird: 'weird',
};

function canonical(id: unknown): unknown {
  if (id === 'minimax-h3') return 'minimax-hailuo-h3';
  if (id === 'seedance-2.5') return 'dreamina-seedance-2.5';
  return typeof id === 'string' ? id.replace(/^midjourney-v(\d)(\d)$/, 'midjourney-v$1.$2') : id;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Only editor-owned fields; output URLs, layout, provenance and task state are never projected here. */
export function professionalDraftFields(draft: WorkspaceDraft): Record<string, unknown> {
  const mj = draft.engineId.startsWith('midjourney-');
  const patch: Record<string, unknown> = {
    description: draft.prompt, engineId: draft.engineId, params: { ...draft.params },
    aspectRatio: draft.params.ratio ?? draft.params.aspectRatio,
  };
  if (draft.outputType === 'image') {
    patch.imagePrompt = draft.prompt;
    patch.imageModel = mj ? 'midjourney' : draft.engineId;
    patch.modelVersion = mj ? String(canonical(draft.engineId)).slice('midjourney-'.length) : undefined;
  } else {
    patch.modelVersion = draft.engineId;
    patch.videoPromptTemplate = draft.promptTemplate;
    patch[draft.promptTemplate === 'universal' ? 'universalVideoPrompt' : 'legacyVideoPrompt'] = draft.prompt;
  }
  for (const [field, param] of Object.entries(fields)) patch[field] = draft.params[param];
  return patch;
}

function matchesBaseline(node: Node, draft: WorkspaceDraft): boolean {
  if (node.data.workspaceProjection?.revision !== draft.revision || node.data.description !== draft.prompt) return false;
  const expected = professionalDraftFields(draft);
  // Older projections did not materialize every native control. Missing controls are not edits.
  return Object.entries(expected).every(([key, value]) => {
    if (node.data[key] == null || key === 'params') return key !== 'params' || node.data.params == null
      || Object.entries(node.data.params).every(([param, current]) => same(current, draft.params[param]));
    if (key === 'engineId' || (key === 'modelVersion' && node.type === 'video')) return canonical(node.data[key]) === canonical(value);
    return same(node.data[key], value) || (value != null && String(node.data[key]) === String(value));
  });
}

/** Synchronous projection in the business publication, not a token-driven synchronization observer. */
export function projectChangedProfessionalDrafts(before: WorkshopData, after: WorkshopData, nodes: Node[]): Node[] {
  if (before.projectId !== after.projectId || before.workspaceDrafts === after.workspaceDrafts) return nodes;
  let changed = false;
  const result = nodes.map((node) => {
    const id = node.data.workspaceDraftId;
    const prior = before.workspaceDrafts?.[id];
    const next = after.workspaceDrafts?.[id];
    if (!prior || !next || prior === next || same(prior, next) || !['image', 'video'].includes(node.type ?? '')) return node;
    const ownerId = node.data.projectObjectId ?? node.data.workshopRef?.objectId;
    const owner = after.projectObjects?.objects.find((item) => item.id === ownerId);
    if (ownerId !== next.objectId || node.type !== next.outputType || !owner || owner.archived || owner.locked || node.data.locked
      || (node.data.workshopRef?.projectId && node.data.workshopRef.projectId !== after.projectId)
      || (node.data.mediaPurpose && node.data.mediaPurpose !== 'current-version') || node.data.workshopPromptRefTarget) return node;
    // The originating canvas command may have already produced this exact projection.
    if (matchesBaseline(node, next)) return node;
    const reason = node.data.isGenerating ? '此节点的任务尚未结束，保留提交时参数'
      : node.data.isMgAnimationNode || node.data.wanRefLink || node.data.videoEdit ? '此节点有独立的专业生成设置，保留原设置'
      : !matchesBaseline(node, prior) ? '画布参数已单独修改，保留本地编辑'
      : !same(prior.references, next.references) ? '本次参考已更新，请先核对参考连线'
      : undefined;
    changed = true;
    if (reason) return { ...node, data: { ...node.data, workspaceDraftConflict: { draftId: id, revision: next.revision, reason } } };
    return { ...node, data: { ...node.data, ...professionalDraftFields(next),
      ...('prompt' in node.data ? { prompt: next.prompt } : {}),
      workspaceDraftConflict: undefined,
      workspaceProjection: { ...node.data.workspaceProjection, prompt: next.prompt, revision: next.revision },
    } };
  });
  return changed ? result : nodes;
}

export const PROFESSIONAL_DRAFT_REQUEST_EVENT = 'kunpeng:professional-draft-request';

/** Resolve again on the receiving side; a stale node or cross-project event never changes selection. */
export function professionalDraftRequest(data: WorkshopData, nodes: Node[], nodeId: unknown) {
  if (typeof nodeId !== 'string') return null;
  const node = nodes.find((item) => item.id === nodeId);
  const draft = node && data.workspaceDrafts?.[node.data.workspaceDraftId];
  const owner = draft && data.projectObjects?.objects.find((item) => item.id === draft.objectId && !item.archived);
  if (!node || !draft || !owner || draft.projectId !== data.projectId || owner.projectId !== data.projectId
    || (node.data.projectObjectId ?? node.data.workshopRef?.objectId) !== draft.objectId || node.type !== draft.outputType
    || (node.data.workshopRef?.projectId && node.data.workshopRef.projectId !== data.projectId)) return null;
  return { objectId: draft.objectId, outputType: draft.outputType, edit: !owner.locked && !node.data.locked };
}
