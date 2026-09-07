import type { WorkshopData } from '../workshop/types.ts';
import type { WorkspaceDraft, WorkspaceOutputType, WorkspaceReference } from './types.ts';
import { stableProjectHash } from '../projectObjects/migrate.ts';
import { buildImageRefPaths, buildVideoRefPaths, getSceneReferencePaths, videoPromptForShot } from '../workshop/shotRefs.ts';
import type { RhtvCanvasEngine } from '../rhtv/types';
import { calibrateGenerationForEngine } from '../projectObjects/generationDraft.ts';
import { materializeWorkspaceDefaults } from './engineCatalog.ts';
import { workspaceTarget } from './targets.ts';
import { projectWorkspacePrompt } from './draftProjection.ts';
import { assetPromptField, readAssetPrompt, workspaceAsset } from './assetDraftModel.ts';
import { shotVideoSettings } from './shotDraftModel.ts';

export function workspaceDraftKey(objectId: string, type: WorkspaceOutputType): string { return `${objectId}::${type}`; }

export function initialWorkspaceDraft(data: WorkshopData, objectId: string, outputType: WorkspaceOutputType, now = Date.now()): WorkspaceDraft | null {
  const key = workspaceDraftKey(objectId, outputType);
  const stored = data.workspaceDrafts?.[key];
  if (stored) return materializeWorkspaceDefaults(stored);
  const owner = workspaceTarget(data, objectId);
  if (!owner || owner.archived) return null;
  if (owner.kind === 'director-constraint') {
    if (outputType !== 'image') return null;
    const parentShot = data.shots.find((item) => item.directorConstraintCard?.id === owner.sourceId);
    const parentScene = data.scenes.find((item) => item.directorConstraintCard?.id === owner.sourceId);
    const card = parentShot?.directorConstraintCard ?? parentScene?.directorConstraintCard;
    if (!card) return null;
    const paths = getSceneReferencePaths(parentShot ?? { sceneId: parentScene?.id }, data.scenes);
    return materializeWorkspaceDefaults({ id: key, projectId: data.projectId, objectId, outputType, prompt: card.prompt ?? '',
      engineId: 'gpt-image-2', params: { aspectRatio: '16:9', resolution: '2k' }, revision: 0, updatedAt: now,
      references: paths.map((path, index) => ({ id: `scene-ref:${index}:${path}`, type: 'image', path, label: `场景 ${index + 1}` })) });
  }
  const shot = owner.kind === 'shot' ? data.shots.find((item) => (item.id ?? item.shotNo) === owner.sourceId) : undefined;
  const asset = owner.kind === 'character' ? data.characters.find((item) => item.id === owner.sourceId)
    : owner.kind === 'scene' ? data.scenes.find((item) => item.id === owner.sourceId)
    : owner.kind === 'prop' ? data.props.find((item) => item.id === owner.sourceId)
    : owner.kind === 'scene-asset' ? data.colorPalettes.find((item) => item.id === owner.sourceId) : undefined;
  const ctx = { characters: data.characters, scenes: data.scenes, props: data.props, colorPalettes: data.colorPalettes, globalColorPaletteId: data.globalColorPaletteId };
  const assetEngine = asset?.assetEngine ?? data.imageModel ?? data.projectSpec?.defaultImageModel ?? 'gpt-image-2';
  const assetKind = owner.kind === 'scene-asset' ? 'colorPalette' : owner.kind;
  const prompt = shot ? outputType === 'video' ? videoPromptForShot(shot, ctx, {
    template: shot.videoPromptTemplate ?? data.videoPromptTemplate ?? 'legacy', includeStoryboardBoards: false,
  }) : shot.imagePrompt ?? '' : asset ? readAssetPrompt(asset, assetPromptField(assetKind as 'character' | 'scene' | 'prop' | 'colorPalette', assetEngine)) ?? '' : '';
  const references: WorkspaceReference[] = (shot ? (outputType === 'video' ? buildVideoRefPaths(shot, ctx) : buildImageRefPaths(shot, ctx)) : []).map((path, index) => {
    const media = data.projectObjects?.media.find((item) => item.path === path);
    const card = outputType === 'video' && shot?.directorConstraintCard?.useInVideo && shot.directorConstraintCard.imagePath === path
      ? shot.directorConstraintCard : undefined;
    if (card) return { id: `constraint:${card.id}`, type: 'image', role: 'director-constraint', path,
      label: '导演约束卡', objectId: `director-constraint:${card.id}`, versionId: media?.versionObjectId };
    return { id: media?.id ?? `ref:${stableProjectHash(path)}`, type: 'image', path,
      label: media?.label ?? `图片${index + 1}`, objectId: media?.ownerObjectId, versionId: media?.versionObjectId };
  });
  const video = shotVideoSettings(data, shot);
  const engine = outputType === 'video' ? video.engineId
    : assetEngine;
  return materializeWorkspaceDefaults({ id: key, projectId: data.projectId, objectId, outputType, prompt,
    ...(shot && outputType === 'video' ? { promptTemplate: shot.videoPromptTemplate ?? data.videoPromptTemplate ?? 'legacy' } : {}),
    engineId: engine === 'minimax-h3' ? 'minimax-hailuo-h3' : engine === 'seedance-2.5' ? 'dreamina-seedance-2.5' : engine,
    references, params: outputType === 'video'
      ? { ratio: video.ratio, duration: video.duration }
      : { aspectRatio: asset?.assetAspectRatio ?? data.projectSpec?.aspectRatio ?? '16:9',
        ...(asset?.assetResolution ? { resolution: asset.assetResolution } : {}) }, revision: 0, updatedAt: now });
}

export function cloneWorkspaceDraft(draft: WorkspaceDraft): WorkspaceDraft {
  return { ...draft, params: { ...draft.params }, references: draft.references.map((ref) => ({ ...ref })) };
}

export function saveWorkspaceDraft(data: WorkshopData, draft: WorkspaceDraft, expectedRevision?: number, now = Date.now()): WorkshopData | null {
  if (draft.projectId !== data.projectId || draft.id !== workspaceDraftKey(draft.objectId, draft.outputType)) return null;
  const owner = workspaceTarget(data, draft.objectId);
  if (!owner || owner.locked || owner.archived) return null;
  const old = data.workspaceDrafts?.[draft.id];
  if (expectedRevision !== undefined && (old?.revision ?? 0) !== expectedRevision) return null;
  const target = draft.outputType === 'image' ? workspaceAsset(data, draft.objectId) : undefined;
  const previousEngine = old?.engineId ?? target?.asset.assetEngine ?? data.imageModel ?? data.projectSpec?.defaultImageModel ?? 'gpt-image-2';
  const previousPrompt = old?.prompt ?? (target ? readAssetPrompt(target.asset, assetPromptField(target.kind, previousEngine)) ?? '' : '');
  const switchedSlot = target && draft.prompt === previousPrompt
    && assetPromptField(target.kind, previousEngine) !== assetPromptField(target.kind, draft.engineId);
  const prompt = switchedSlot ? readAssetPrompt(target.asset, assetPromptField(target.kind, draft.engineId)) ?? draft.prompt : draft.prompt;
  const saved = {
    ...draft, prompt, params: { ...draft.params }, references: draft.references.map((ref) => ({ ...ref })),
    revision: (old?.revision ?? 0) + 1, updatedAt: now,
  };
  const projected = projectWorkspacePrompt(data, saved);
  return { ...projected, workspaceDrafts: { ...data.workspaceDrafts, [draft.id]: saved },
    ...(data.projectObjects ? { projectObjects: { ...data.projectObjects, updatedAt: now,
      objects: data.projectObjects.objects.map((item) => item.id === owner.id ? { ...item, version: item.version + 1, updatedAt: now } : item),
    } } : {}) };
}

const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
export function referenceOrdinal(n: number): string {
  if (n < 10) return CN[n];
  if (n < 100) return `${n < 20 ? '' : CN[Math.floor(n / 10)]}十${n % 10 ? CN[n % 10] : ''}`;
  return String(n);
}
function parseOrdinal(raw: string): number {
  if (/^\d+$/.test(raw)) return Number(raw);
  if (raw.includes('十')) { const [a, b] = raw.split('十'); return (a ? CN.indexOf(a) : 1) * 10 + (b ? CN.indexOf(b) : 0); }
  return CN.indexOf(raw);
}
const LABELS = { image: '图片', video: '视频', audio: '音频' } as const;
export function referenceMention(ref: WorkspaceReference, refs: WorkspaceReference[]): string {
  return `@${LABELS[ref.type]}${referenceOrdinal(refs.filter((item) => item.type === ref.type).findIndex((item) => item.id === ref.id) + 1)}`;
}
export function changeWorkspaceReferences(draft: WorkspaceDraft, next: WorkspaceReference[]): WorkspaceDraft {
  const references = next.filter((ref, index) => next.findIndex((item) => item.id === ref.id) === index);
  const prompt = draft.prompt.replace(/@(图片|视频|音频)([零一二三四五六七八九十]+|\d+)/g, (token, label: string, ordinal: string) => {
    const type = (Object.keys(LABELS) as WorkspaceOutputType[]).find((key) => LABELS[key] === label)!;
    const old = draft.references.filter((ref) => ref.type === type)[parseOrdinal(ordinal) - 1];
    if (!old) return token;
    const current = references.find((ref) => ref.id === old.id);
    return current ? referenceMention(current, references) : `【参考已移除：${old.label}】`;
  });
  return { ...draft, prompt, references };
}
export function workspaceDraftErrors(draft: WorkspaceDraft): string[] {
  const errors: string[] = [];
  if (!draft.prompt.trim()) errors.push('请填写提示词');
  if (!draft.engineId) errors.push('请选择模型');
  if (draft.references.some((ref) => !ref.path.trim())) errors.push('参考素材路径为空');
  if (new Set(draft.references.map((ref) => ref.id)).size !== draft.references.length) errors.push('参考素材重复');
  if (/【参考已移除：/.test(draft.prompt)) errors.push('提示词包含已移除的参考，请确认并修改正文');
  for (const match of draft.prompt.matchAll(/@(图片|视频|音频)([零一二三四五六七八九十]+|\d+)/g)) {
    const type = (Object.keys(LABELS) as WorkspaceOutputType[]).find((key) => LABELS[key] === match[1])!;
    const n = parseOrdinal(match[2]);
    if (n < 1 || n > draft.references.filter((ref) => ref.type === type).length) errors.push(`${match[0]} 没有对应参考素材`);
  }
  return [...new Set(errors)];
}

export function calibrateWorkspaceDraft(draft: WorkspaceDraft, engine: RhtvCanvasEngine) {
  const values = { ...draft.params };
  if (engine.params.some((param) => param.key === 'ratio') && values.ratio === undefined) values.ratio = values.aspectRatio;
  if (engine.params.some((param) => param.key === 'aspectRatio') && values.aspectRatio === undefined) values.aspectRatio = values.ratio;
  const calibrated = calibrateGenerationForEngine(engine, values, {
    images: draft.references.filter((ref) => ref.type === 'image').map((ref) => ref.path),
    videos: draft.references.filter((ref) => ref.type === 'video').map((ref) => ref.path),
    audios: draft.references.filter((ref) => ref.type === 'audio').map((ref) => ref.path),
  });
  const allowed = { image: [...calibrated.references.images], video: [...calibrated.references.videos], audio: [...calibrated.references.audios] };
  const references = draft.references.filter((ref) => {
    const index = allowed[ref.type].indexOf(ref.path);
    if (index < 0) return false;
    allowed[ref.type].splice(index, 1);
    return true;
  });
  const keys = new Set(engine.params.map((param) => param.key));
  const params = Object.fromEntries(Object.entries(calibrated.params).filter(([key]) => keys.has(key))) as WorkspaceDraft['params'];
  return { draft: { ...changeWorkspaceReferences(draft, references), engineId: engine.id, params }, adjustments: calibrated.adjustments };
}
