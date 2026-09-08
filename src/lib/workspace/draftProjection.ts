import type { WorkshopData, WsShot } from '../workshop/types.ts';
import type { WorkspaceDraft } from './types.ts';
import { assetPromptField, patchWorkspaceAsset, workspaceAsset } from './assetDraftModel.ts';
import { projectShotVideoSettings } from './shotDraftModel.ts';

/** Legacy prompt fields are a compatibility projection, never a second editor-owned draft. */
export function projectWorkspacePrompt(data: WorkshopData, draft: WorkspaceDraft, explicitEmptyHint?: boolean): WorkshopData {
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
  const outputKey: 'image' | 'video' = draft.outputType === 'image' ? 'image' : 'video';
  return { ...data, shots: data.shots.map((shot) => {
    if ((shot.id ?? shot.shotNo) !== owner.sourceId) return shot;
    const previousExplicitEmpty = shot.workspaceReferenceProjection?.explicitEmpty;
    // 显式清空标记：references 为空时 hint=用户主动清空（有引用→无引用），保留/打标；
    // references 非空时本层旧标记必然过期（否则出现"有投影+锁死"的自相矛盾状态），清除之。
    // 仅在最终有标记时写入 explicitEmpty 键，避免污染结构比较。
    let explicitEmpty: Partial<Record<'image' | 'video', boolean>> | undefined;
    if (draft.references.length === 0) {
      const explicitFlag = explicitEmptyHint ?? previousExplicitEmpty?.[outputKey];
      explicitEmpty = explicitFlag === true
        ? { ...previousExplicitEmpty, [outputKey]: true }
        : previousExplicitEmpty ? { ...previousExplicitEmpty } : undefined;
    } else if (previousExplicitEmpty) {
      const rest = { ...previousExplicitEmpty };
      delete rest[outputKey];
      explicitEmpty = Object.keys(rest).length > 0 ? rest : undefined;
    }
    return { ...(draft.outputType === 'video' ? projectShotVideoSettings(data, shot, draft) : shot), [field]: draft.prompt,
      workspaceReferenceProjection: (() => {
        const projection: WsShot['workspaceReferenceProjection'] = { ...shot.workspaceReferenceProjection,
          [outputKey]: draft.references.map((ref) => ({ ...ref })) };
        if (explicitEmpty) projection.explicitEmpty = explicitEmpty;
        else delete projection.explicitEmpty;
        return projection;
      })() };
  }) };
}
