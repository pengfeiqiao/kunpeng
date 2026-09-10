import type { DirectorConstraintCard, WorkshopData } from '../workshop/types.ts';
import type { WorkspaceDraft, WorkspaceReference } from './types.ts';
import { migrateWorkshopProjectObjects, stableProjectObjectId } from '../projectObjects/migrate.ts';
import { getSceneReferencePaths, stripDirectorConstraintVideoPrefix } from '../workshop/shotRefs.ts';
import { changeWorkspaceReferences, referenceMention, saveWorkspaceDraft, workspaceDraftKey } from './drafts.ts';

export type ConstraintScope = 'shot' | 'scene';
export function workspaceConstraints(data: WorkshopData, objectId: string) {
  const owner = data.projectObjects?.objects.find((item) => item.id === objectId && item.kind === 'shot' && !item.archived);
  const shot = owner && data.shots.find((item) => (item.id ?? item.shotNo) === owner.sourceId);
  const scene = data.scenes.find((item) => item.id === shot?.sceneId);
  return { owner, shot, scene, shotCard: shot?.directorConstraintCard, sceneCard: scene?.directorConstraintCard };
}

export function findWorkspaceConstraint(data: WorkshopData, cardId: string) {
  const shot = data.shots.find((item) => item.directorConstraintCard?.id === cardId);
  const scene = data.scenes.find((item) => item.directorConstraintCard?.id === cardId);
  return { card: shot?.directorConstraintCard ?? scene?.directorConstraintCard, shot, scene };
}

export function constraintReference(data: WorkshopData, card: DirectorConstraintCard): WorkspaceReference {
  const objectId = stableProjectObjectId('director-constraint', card.id);
  const media = data.projectObjects?.media.find((item) => item.ownerObjectId === objectId && item.path === card.imagePath && item.versionObjectId);
  return { id: `constraint:${card.id}`, type: 'image', role: 'director-constraint', path: card.imagePath,
    label: '导演约束卡', objectId, versionId: media?.versionObjectId };
}

/** Applies only to this draft. Other drafts and already-paid submissions keep their frozen versions. */
export function setDraftConstraint(data: WorkshopData, draft: WorkspaceDraft, card?: DirectorConstraintCard): WorkspaceDraft {
  const normalized = { ...draft, references: draft.references.map((ref) => {
    const owner = data.projectObjects?.objects.find((item) => item.id === ref.objectId && item.kind === 'director-constraint');
    return owner?.sourceId ? { ...ref, id: `constraint:${owner.sourceId}`, role: 'director-constraint' as const } : ref;
  }) };
  const ordinary = normalized.references.filter((ref) => ref.role !== 'director-constraint'
    && !data.projectObjects?.objects.some((item) => item.id === ref.objectId && item.kind === 'director-constraint'));
  const next = card?.imagePath ? [...ordinary, constraintReference(data, card)] : ordinary;
  const changed = changeWorkspaceReferences({ ...normalized, prompt: stripDirectorConstraintVideoPrefix(draft.prompt) }, next);
  const ref = next.find((item) => item.role === 'director-constraint');
  const prefix = ref ? `以 @导演约束卡（对应 ${referenceMention(ref, next)}）锁定本镜人物站位、视线、机位和动作关系；只继承调度约束，不复制白模材质。` : '';
  return { ...changed, prompt: [prefix, changed.prompt].filter(Boolean).join('\n') };
}

export function staleConstraintDrafts(data: WorkshopData, card: DirectorConstraintCard): WorkspaceDraft[] {
  const id = stableProjectObjectId('director-constraint', card.id);
  return Object.values(data.workspaceDrafts ?? {}).filter((draft) => draft.references.some((ref) => ref.objectId === id && ref.path !== card.imagePath));
}

/** Create metadata only; no media bytes and no generation. Existing candidates are retained. */
export function putWorkspaceConstraint(data: WorkshopData, objectId: string, scope: ConstraintScope, card: DirectorConstraintCard): WorkshopData | null {
  const { owner, shot, scene } = workspaceConstraints(data, objectId);
  if (!shot || owner?.locked || (scope === 'scene' && !scene)) return null;
  const parentId = scope === 'scene' ? stableProjectObjectId('scene', scene!.id) : objectId;
  if (data.projectObjects?.objects.find((item) => item.id === parentId)?.locked) return null;
  const current = scope === 'scene' ? scene!.directorConstraintCard : shot.directorConstraintCard;
  if (current && current.id !== card.id) return null;
  if (data.projectObjects?.objects.find((item) => item.id === stableProjectObjectId('director-constraint', card.id))?.locked) return null;
  const next = scope === 'scene' ? { ...data, scenes: data.scenes.map((item) => item.id === scene!.id ? { ...item, directorConstraintCard: card } : item) }
    : { ...data, shots: data.shots.map((item) => item === shot ? { ...item, directorConstraintCard: card } : item) };
  return migrateWorkshopProjectObjects(next);
}

/** Only scene pixels enter the card generator; names/actions remain text. */
export function constraintGenerationDraft(data: WorkshopData, objectId: string, card: DirectorConstraintCard): WorkspaceDraft | null {
  const { shot, scene } = workspaceConstraints(data, objectId);
  if (!shot) return null;
  const cardObjectId = stableProjectObjectId('director-constraint', card.id);
  const id = workspaceDraftKey(cardObjectId, 'image');
  const previous = data.workspaceDrafts?.[id];
  const scenePaths = getSceneReferencePaths(shot, data.scenes);
  const names = shot.characterIds.map((id) => data.characters.find((item) => item.id === id)?.name).filter(Boolean).join('、');
  const props = (shot.propIds ?? []).map((id) => data.props.find((item) => item.id === id)?.name).filter(Boolean).join('、');
  return { id, objectId: cardObjectId, projectId: data.projectId, outputType: 'image', engineId: 'gpt-image-2.5',
    prompt: previous?.prompt ?? card.prompt ?? `为镜头 ${shot.shotNo} 生成专业导演约束卡。剧情：${shot.description}。场景：${scene?.name ?? '当前场景'}。人物：${names || '无明确人物'}；道具：${props || '无关键道具'}。参考图片仅用于理解建筑、家具、通道与空间轴线，忽略其中人物外观。左侧为灰白素模透视空间走位图，姓名、道具名、视线箭头和2-4个摄影机图标；右侧为简洁动作关系卡。人物用无五官、无服装细节的中性占位，不锁死肢体姿势，保留剧情里的手持物与动作。不要正交俯视图，不要渲染真人或服装，不要长段文字。`,
    references: scenePaths.map((path, index) => ({ id: `scene-ref:${index}:${path}`, type: 'image', path, label: `场景 ${index + 1}` })),
    params: { aspectRatio: '16:9', resolution: '2k' }, revision: previous?.revision ?? 0, updatedAt: previous?.updatedAt ?? Date.now() };
}

export function saveConstraintVideoDraft(data: WorkshopData, draft: WorkspaceDraft, card?: DirectorConstraintCard): WorkshopData | null {
  if (draft.outputType !== 'video') return null;
  return saveWorkspaceDraft(data, setDraftConstraint(data, draft, card), draft.revision);
}

export function createWorkspaceConstraint(data: WorkshopData, objectId: string, scope: ConstraintScope, id: string): WorkshopData | null {
  const context = workspaceConstraints(data, objectId);
  if (!context.shot || (scope === 'shot' ? context.shotCard : context.sceneCard)) return null;
  const card: DirectorConstraintCard = { id, imagePath: '', createdAt: Date.now(), source: 'generate', useInVideo: false };
  const next = putWorkspaceConstraint(data, objectId, scope, card);
  const draft = next && constraintGenerationDraft(next, objectId, card);
  return next && draft ? saveWorkspaceDraft(next, draft, 0) : null;
}

export function constraintGenerationErrors(data: WorkshopData, draft: WorkspaceDraft): string[] {
  const owner = data.projectObjects?.objects.find((item) => item.id === draft.objectId);
  if (owner?.kind !== 'director-constraint') return [];
  const { shot, scene, card } = findWorkspaceConstraint(data, owner.sourceId ?? '');
  if (!card) return ['导演约束卡已删除'];
  const paths = getSceneReferencePaths(shot ?? { sceneId: scene?.id }, data.scenes);
  if (draft.outputType !== 'image' || !draft.references.length || draft.references.some((ref) => ref.type !== 'image' || !paths.includes(ref.path))) {
    return ['导演约束卡仅可使用当前场景参考图，请核对场景素材'];
  }
  return [];
}
