import type { WorkshopData } from '../workshop/types.ts';
import type { WorkspaceDraft } from './types.ts';
import { assetPromptField, patchWorkspaceAsset, workspaceAsset } from './assetDraftModel.ts';
import { projectShotVideoSettings } from './shotDraftModel.ts';

/** Legacy prompt fields are a compatibility projection, never a second editor-owned draft. */
export function projectWorkspacePrompt(data: WorkshopData, draft: WorkspaceDraft): WorkshopData {
  const owner = data.projectObjects?.objects.find((item) => item.id === draft.objectId);
  const target = draft.outputType === 'image' ? workspaceAsset(data, draft.objectId) : undefined;
  if (target) return patchWorkspaceAsset(data, target.kind, target.asset.id, {
    [assetPromptField(target.kind, draft.engineId)]: draft.prompt, assetEngine: draft.engineId,
    ...(typeof draft.params.aspectRatio === 'string' ? { assetAspectRatio: draft.params.aspectRatio } : {}),
    ...(typeof draft.params.resolution === 'string' ? { assetResolution: draft.params.resolution } : {}),
  });
  if (!owner || owner.kind !== 'shot' || draft.outputType === 'audio') return data;
  const template = draft.promptTemplate ?? data.shots.find((item) => (item.id ?? item.shotNo) === owner.sourceId)?.videoPromptTemplate
    ?? data.videoPromptTemplate ?? 'legacy';
  const field = draft.outputType === 'image' ? 'imagePrompt' : template === 'universal' ? 'universalVideoPrompt' : 'videoPrompt';
  return { ...data, shots: data.shots.map((shot) => (shot.id ?? shot.shotNo) === owner.sourceId
    ? { ...(draft.outputType === 'video' ? projectShotVideoSettings(data, shot, draft) : shot), [field]: draft.prompt, workspaceReferenceProjection: { ...shot.workspaceReferenceProjection,
      [draft.outputType]: draft.references.map((ref) => ({ ...ref })),
    } } : shot) };
}
