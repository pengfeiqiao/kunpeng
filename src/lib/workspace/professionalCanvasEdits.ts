import type { Node } from 'reactflow';
import type { ProjectCommandState } from '../projectObjects/projectCommands.ts';
import { collectReferencesFromSnapshot } from '../canvas/collectRefsModel.ts';
import { calibrateWorkspaceDraft, initialWorkspaceDraft, saveWorkspaceDraft } from './drafts.ts';
import { workspaceEngine } from './engineCatalog.ts';
import { legacyShotDraft } from './legacyShotReferences.ts';
import type { WorkspaceDraft } from './types.ts';

const parameterFields: Record<string, string> = {
  aspectRatio: 'aspectRatio', resolution: 'resolution', duration: 'duration', hasAudio: 'hasAudio',
  midjourneyStylize: 'stylize', midjourneyChaos: 'chaos', midjourneyRaw: 'raw',
  midjourneyStyleWeight: 'sw', midjourneyImageWeight: 'iw', midjourneyWeird: 'weird',
};
const identityFields = new Set(['projectObjectId', 'mediaObjectId', 'versionObjectId', 'mediaPurpose',
  'workshopRef', 'workspaceDraftId', 'workspaceProjection', 'workshopPromptRefTarget']);
const editFields = new Set(['description', 'prompt', 'imagePrompt', 'imageModel', 'modelVersion', 'engineId', 'params',
  'videoPromptTemplate', 'legacyVideoPrompt', 'universalVideoPrompt', ...Object.keys(parameterFields),
  'midjourneyStyleId', 'isMgAnimationNode', 'mgStyleId', 'mgAccentStyleId', 'mgRecipe', 'mgGenerationEngine', 'wanRefLink', 'videoEdit']);

function bound(node: Node): boolean {
  return [...identityFields].some((key) => node.data[key] != null);
}

/** False means the original free-node/runtime-only path; errors must never fall back to it. */
export function isProfessionalCanvasEdit(node: Node, patch: Record<string, unknown>): boolean {
  const changed = Object.keys(patch).filter((key) => !Object.is(node.data[key], patch[key]));
  if (changed.some((key) => identityFields.has(key)) && (bound(node) || bound({ ...node, data: patch }))) {
    throw new Error('绑定元数据只能通过项目命令修改');
  }
  return bound(node) && changed.some((key) => editFields.has(key));
}

function canonicalEngine(id: string): string {
  return id === 'minimax-h3' ? 'minimax-hailuo-h3' : id === 'seedance-2.5' ? 'dreamina-seedance-2.5'
    : id === 'midjourney' ? 'midjourney-v8.2' : id.replace(/^midjourney-v(\d)(\d)$/, 'midjourney-v$1.$2');
}

function nativeEngine(type: string, data: Record<string, unknown>): string | undefined {
  if (typeof data.engineId === 'string') return canonicalEngine(data.engineId);
  if (type === 'video') return typeof data.modelVersion === 'string' ? canonicalEngine(data.modelVersion) : undefined;
  if (data.imageModel === 'midjourney') return canonicalEngine(`midjourney-${data.modelVersion ?? 'v8.2'}`);
  return typeof data.imageModel === 'string' ? canonicalEngine(data.imageModel) : undefined;
}

function paramKey(field: string, engineId: string): string {
  const key = parameterFields[field];
  return key === 'aspectRatio' && workspaceEngine(engineId)?.params.some((item) => item.key === 'ratio') ? 'ratio' : key;
}

function assertSameReferences(state: ProjectCommandState, node: Node, draft: WorkspaceDraft): void {
  const refs = collectReferencesFromSnapshot(node.id, state.canvas);
  const actual = [...refs.images, ...refs.videos, ...refs.audios].map((ref) => `${ref.kind}:${ref.submitUrl}`);
  const expected = ['image', 'video', 'audio'].flatMap((type) => draft.references.filter((ref) => ref.type === type).map((ref) => `${ref.type}:${ref.path}`));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('专业节点参考与共享草稿冲突，请先通过参考命令处理');
}

function assertBaseline(node: Node, draft: WorkspaceDraft): void {
  const data = node.data;
  if ((data.workspaceDraftId && data.workspaceDraftId !== draft.id)
    || (data.workspaceProjection && data.workspaceProjection.revision !== draft.revision)
    || (data.description ?? '') !== draft.prompt) throw new Error('专业节点草稿已改变，请显式同步后再编辑');
  const engine = nativeEngine(node.type!, { ...data, engineId: undefined });
  if ((engine && engine !== canonicalEngine(draft.engineId))
    || (data.engineId != null && canonicalEngine(String(data.engineId)) !== canonicalEngine(draft.engineId))) {
    throw new Error('专业节点模型与共享草稿冲突');
  }
  if (data.videoPromptTemplate && data.videoPromptTemplate !== draft.promptTemplate) throw new Error('专业节点提示词模板冲突');
  for (const field of Object.keys(parameterFields)) {
    if (data[field] != null && String(data[field]) !== String(draft.params[paramKey(field, draft.engineId)])) {
      throw new Error(`专业节点参数 ${field} 与共享草稿冲突`);
    }
  }
  if (data.params && Object.entries(data.params).some(([key, value]) => String(value) !== String(draft.params[key]))) {
    throw new Error('专业节点参数快照冲突');
  }
  if (data.midjourneyStyleId || data.isMgAnimationNode || data.wanRefLink || data.videoEdit) {
    throw new Error('此专业节点包含尚未收编的专用生成设置');
  }
}

/** One computation saves the shared draft and its native-node projection, never media or task snapshots. */
export function editProfessionalCanvasCommand(state: ProjectCommandState, nodeId: string,
  patch: Record<string, unknown>, now = Date.now()): ProjectCommandState {
  const node = state.canvas.nodes.find((item) => item.id === nodeId);
  if (!node) throw new Error('专业节点不存在');
  if (!isProfessionalCanvasEdit(node, patch)) return state;
  const ref = node.data.workshopRef;
  const objectId = node.data.projectObjectId ?? ref?.objectId;
  const registry = state.workshop.projectObjects;
  const owner = registry?.objects.find((item) => item.id === objectId);
  if (!owner || owner.projectId !== state.workshop.projectId || owner.locked || owner.archived
    || (ref?.projectId && ref.projectId !== state.workshop.projectId)
    || (ref?.objectId && ref.objectId !== objectId) || node.data.isGenerating || node.data.locked || node.data.archived
    || (ref?.shotId && (owner.kind !== 'shot' || ref.shotId !== owner.sourceId))) {
    throw new Error('专业节点绑定失效、锁定或生成中，未修改');
  }
  if (!['image', 'video'].includes(node.type ?? '') || node.data.workshopPromptRefTarget
    || ['prompt-reference', 'storyboard-frame', 'storyboard-board'].includes(ref?.role)
    || (node.type === 'video' && !['shot', 'generation-task'].includes(owner.kind))) {
    throw new Error('此绑定节点不支持共享生成草稿编辑');
  }
  const media = registry!.media.find((item) => item.id === node.data.mediaObjectId);
  const version = registry!.versions.find((item) => item.id === node.data.versionObjectId);
  if ((node.data.mediaPurpose && node.data.mediaPurpose !== 'current-version')
    || (ref?.mediaObjectId && ref.mediaObjectId !== node.data.mediaObjectId)
    || (ref?.versionObjectId && ref.versionObjectId !== node.data.versionObjectId)
    || (node.data.mediaObjectId && (!media || media.projectId !== state.workshop.projectId || media.ownerObjectId !== objectId || media.locked || media.archived || media.purpose !== 'current-version'))
    || (node.data.versionObjectId && (!version || !media || version.projectId !== state.workshop.projectId || version.ownerObjectId !== objectId || version.locked || version.archived || !version.selected))
    || (media && (media.mediaType !== node.type || !version || media.versionObjectId !== version.id || version.mediaObjectId !== media.id))) {
    throw new Error('候选、历史或冲突的媒体绑定不能修改共享草稿');
  }
  const type = node.type as 'image' | 'video';
  const shot = owner.kind === 'shot' ? state.workshop.shots.find((item) => (item.id ?? item.shotNo) === owner.sourceId) : undefined;
  const draft = shot ? legacyShotDraft(state.workshop, shot, type, now) : initialWorkspaceDraft(state.workshop, objectId, type, now);
  if (!draft) throw new Error('共享草稿不存在');
  assertBaseline(node, draft);
  assertSameReferences(state, node, draft);
  const changed = Object.keys(patch).filter((key) => !Object.is(node.data[key], patch[key]));
  if (changed.some((key) => !editFields.has(key))) throw new Error('草稿编辑不能混入产物、参考或运行时写入');
  const supported = new Set(['description', 'prompt', 'imagePrompt', 'imageModel', 'modelVersion', 'engineId', 'params',
    'videoPromptTemplate', 'legacyVideoPrompt', 'universalVideoPrompt', ...Object.keys(parameterFields)]);
  if (changed.some((key) => !supported.has(key))) throw new Error('此专用参数尚未收编，未修改共享草稿');
  const merged = { ...node.data, ...patch };
  // Canonical engine updates must not be masked by an older native/canonical field.
  const nativePatch = { ...merged, engineId: 'engineId' in patch ? patch.engineId : undefined };
  const engineId = nativeEngine(type, nativePatch) ?? draft.engineId;
  const engine = workspaceEngine(engineId);
  if (!engine || engine.kind !== type) throw new Error('此模型没有共享参数定义，未修改');
  if ((type === 'image' && 'modelVersion' in patch && nativePatch.imageModel !== 'midjourney')
    || (type === 'video' && ('imageModel' in patch || 'imagePrompt' in patch))) throw new Error('模型字段不属于当前节点类型');
  if ('engineId' in patch && (('imageModel' in patch && nativeEngine(type, { ...merged, engineId: undefined }) !== canonicalEngine(String(patch.engineId)))
    || (type === 'video' && 'modelVersion' in patch && canonicalEngine(String(patch.modelVersion)) !== canonicalEngine(String(patch.engineId))))) {
    throw new Error('模型字段相互冲突');
  }
  let next = { ...draft, params: { ...draft.params } };
  if (canonicalEngine(engineId) !== canonicalEngine(draft.engineId)) {
    const calibrated = calibrateWorkspaceDraft(draft, engine).draft;
    if (JSON.stringify(calibrated.references) !== JSON.stringify(draft.references)) throw new Error('切换模型会移除参考，须先显式编辑参考');
    next = calibrated;
  }
  const template = 'videoPromptTemplate' in patch ? patch.videoPromptTemplate : draft.promptTemplate;
  if (template !== undefined && template !== 'legacy' && template !== 'universal') throw new Error('提示词模板无效');
  const promptFields = ['description', 'prompt', ...(type === 'image' ? ['imagePrompt'] : [template === 'universal' ? 'universalVideoPrompt' : 'legacyVideoPrompt'])];
  const prompts = promptFields.filter((key) => key in patch).map((key) => patch[key]);
  if (prompts.some((value) => typeof value !== 'string') || new Set(prompts).size > 1) throw new Error('提示词字段相互冲突');
  if ((type === 'video' && ['legacyVideoPrompt', 'universalVideoPrompt'].some((key) => key in patch && !promptFields.includes(key)))
    || (type === 'image' && ['videoPromptTemplate', 'legacyVideoPrompt', 'universalVideoPrompt'].some((key) => key in patch))) throw new Error('不能隐式修改非当前提示词槽位');
  if (template !== draft.promptTemplate && !prompts.length) throw new Error('切换提示词模板须同时提交可见正文');
  const values: Record<string, unknown> = {};
  if ('params' in patch) {
    if (!patch.params || typeof patch.params !== 'object' || Array.isArray(patch.params)) throw new Error('参数必须是对象');
    Object.assign(values, patch.params);
  }
  for (const field of Object.keys(parameterFields)) if (field in patch) {
    const key = paramKey(field, engine.id);
    if (key in values && String(values[key]) !== String(patch[field])) throw new Error('参数字段相互冲突');
    values[key] = patch[field];
  }
  for (const [key, value] of Object.entries(values)) {
    const definition = engine.params.find((item) => item.key === key);
    if (!definition || !['string', 'number', 'boolean'].includes(typeof value)
      || (typeof value === 'number' && !Number.isFinite(value))
      || (definition.type === 'list' && !definition.options?.includes(String(value)))
      || (definition.type === 'boolean' && typeof value !== 'boolean')
      || (definition.type === 'int' && (typeof value !== 'number' || !Number.isInteger(value)))) throw new Error(`参数 ${key} 不受共享模型定义支持`);
    next.params[key] = value as string | number | boolean;
  }
  next = { ...next, engineId, prompt: prompts.length ? prompts[0] as string : next.prompt, promptTemplate: template };
  const workshop = saveWorkspaceDraft(state.workshop, next, draft.revision, now);
  if (!workshop) throw new Error('共享草稿修订已改变或对象锁定，未修改');
  const saved = workshop.workspaceDrafts![draft.id];
  const projected: Record<string, unknown> = { description: saved.prompt, engineId: saved.engineId, params: { ...saved.params },
    workspaceDraftId: saved.id, workspaceProjection: { prompt: saved.prompt, referenceImages: node.data.referenceImages ?? [], revision: saved.revision } };
  if ('prompt' in node.data || 'prompt' in patch) projected.prompt = saved.prompt;
  if (type === 'image') {
    projected.imagePrompt = saved.prompt;
    projected.imageModel = saved.engineId.startsWith('midjourney-') ? 'midjourney' : saved.engineId;
    projected.modelVersion = saved.engineId.startsWith('midjourney-') ? saved.engineId.slice('midjourney-'.length) : undefined;
  } else {
    projected.modelVersion = saved.engineId;
    projected.videoPromptTemplate = saved.promptTemplate;
    projected[saved.promptTemplate === 'universal' ? 'universalVideoPrompt' : 'legacyVideoPrompt'] = saved.prompt;
  }
  for (const field of Object.keys(parameterFields)) projected[field] = saved.params[paramKey(field, saved.engineId)];
  return { workshop, canvas: { ...state.canvas, nodes: state.canvas.nodes.map((item) => item.id === nodeId
    ? { ...item, data: { ...item.data, ...projected } } : item) } };
}
