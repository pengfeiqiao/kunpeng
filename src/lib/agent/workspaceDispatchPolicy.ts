import type { AssistantTarget } from '../workspace/projectAssistantQueue.ts';
import type { WorkshopData } from '../workshop/types.ts';
import { classifyWorkshopEditScope, findUnsupportedPromptDialogue, findUnsupportedRelationshipClaims } from '../workshop/narrativeGuard.ts';
import { isWorkspaceProjectGenerator, workspaceProjectGenerationError } from './workspaceProjectGeneration.ts';

export interface WorkspaceDispatchAuthority {
  level: 'media' | 'shot' | 'project' | 'professional';
  projectId: string;
  objectId?: string;
  mediaId?: string;
  versionId?: string;
  outputType?: string;
  ownerKind?: string;
  sourceId?: string;
  shotId?: string;
  shotNo?: string;
  facts?: string;
  request: string;
}

const denied = '工作台范围保护：本次工具调用超出冻结目标；请从对应对象或项目入口明确发起新任务。';
const reads = new Set(['read_file', 'glob_search', 'grep_search', 'list_directory', 'bash_read_output',
  'project_get_paths', 'project_get_objects', 'project_get_generation_draft', 'workshop_get_state', 'workshop_get_shot_refs',
  'workshop_read_source', 'view_capabilities', 'canvas_get_state', 'canvas_capture_node', 'timeline_get_state',
  'timeline_get_fx_detail', 'image_recognition', 'ask_user_question', 'task_status', 'skill_invoke', 'aigc_optimize_prompt',
  'web_search', 'web_fetch', 'apimart_route_status']);
const unsafeExecution = new Set(['bash', 'write_file', 'edit_file', 'agent_delegate', 'schedule_cron', 'memory_write',
  'browser_control', 'browser_install', 'capability_api_config', 'media_api_plugin', 'switch_view']);
const promptKeys = new Set(['imagePrompt', 'image_prompt', 'videoPrompt', 'video_prompt', 'audioPrompts', 'audio_prompts',
  'expectedRefSignature', 'expected_ref_signature', 'replaceAudioPrompts', 'replace_audio_prompts']);
const expressionKeys = new Set([...promptKeys, 'shotType', 'camera', 'mood', 'durationSec', 'videoRatio']);
const shotKeys = new Set(['shotNo', 'shot_no', 'shot', 'id']);

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function shotFacts(shot: WorkshopData['shots'][number]): string {
  return JSON.stringify([shot.sourceExcerpt, shot.description, shot.dialogue, shot.characterIds, shot.sceneId, shot.propIds]);
}

export function captureWorkspaceAuthority(target: AssistantTarget, data: WorkshopData, request: string): WorkspaceDispatchAuthority {
  if (target.projectId !== data.projectId) throw new Error(denied);
  const professional = (target as AssistantTarget & { canvasTarget?: unknown }).canvasTarget
    || target.surface === 'editor';
  const authority: WorkspaceDispatchAuthority = { level: professional ? 'professional' : 'project', projectId: data.projectId, request };
  if (professional) return authority;
  const registry = data.projectObjects;
  if (registry && registry.projectId !== data.projectId) throw new Error(denied);
  if (!target.objectId) {
    if (target.mediaId || target.versionId || target.outputType
      || target.accessScope === 'media' || target.accessScope === 'shot') throw new Error(denied);
    // A new project's first script request can precede object-registry initialization.
    return authority;
  }
  if (!registry) throw new Error(denied);
  const owner = registry.objects.find((item) => item.id === target.objectId)
    ?? registry.media.find((item) => item.id === target.objectId);
  const media = target.mediaId ? registry.media.find((item) => item.id === target.mediaId) : undefined;
  if (!owner || owner.projectId !== data.projectId || owner.archived || owner.locked
    || (target.mediaId && (!media || media.archived || media.projectId !== data.projectId
      || (media.id !== owner.id && media.ownerObjectId !== owner.id)))) throw new Error(denied);
  const level = target.accessScope === 'shot' || (!target.mediaId && !target.outputType && owner.kind === 'shot') ? 'shot' : 'media';
  if (level === 'shot' && owner.kind !== 'shot') throw new Error(denied);
  Object.assign(authority, { level, objectId: owner.id, ownerKind: owner.kind, sourceId: owner.sourceId,
    mediaId: target.mediaId, versionId: target.versionId, outputType: target.outputType ?? media?.mediaType });
  if (owner.kind === 'shot') {
    const matches = data.shots.filter((shot) => (shot.id ?? shot.shotNo) === owner.sourceId);
    const shot = matches[0];
    if (matches.length !== 1 || !shot || data.shots.filter((item) => item.shotNo === shot.shotNo).length !== 1) throw new Error(denied);
    Object.assign(authority, { shotId: shot.id, shotNo: shot.shotNo, facts: shotFacts(shot) });
  }
  if (target.versionId && !registry.versions.some((item) => item.id === target.versionId && !item.archived
    && item.projectId === data.projectId && item.mediaObjectId === target.mediaId
    && (owner.id === media?.id || item.ownerObjectId === owner.id))) throw new Error(denied);
  return authority;
}

export function workspaceAuthorityCurrent(authority: WorkspaceDispatchAuthority, data: WorkshopData | null | undefined): boolean {
  if (!data || data.projectId !== authority.projectId) return false;
  if (!authority.objectId) return true;
  try {
    const current = captureWorkspaceAuthority({ projectId: authority.projectId, sessionId: null, label: '', context: '',
      objectId: authority.objectId, mediaId: authority.mediaId, versionId: authority.versionId,
      outputType: authority.outputType as AssistantTarget['outputType'], accessScope: authority.level === 'shot' ? 'shot' : 'media',
    }, data, authority.request);
    return current.ownerKind === authority.ownerKind && current.sourceId === authority.sourceId
      && current.shotId === authority.shotId && current.shotNo === authority.shotNo && current.facts === authority.facts;
  } catch { return false; }
}

function exactShot(params: Record<string, unknown>, shotNo: string | undefined): boolean {
  const ids = [...shotKeys].filter((key) => params[key] !== undefined).map((key) => params[key]);
  return Boolean(shotNo && ids.length && ids.every((id) => id === shotNo));
}

function expressionError(params: Record<string, unknown>, authority: WorkspaceDispatchAuthority, data: WorkshopData): string | null {
  const shot = data.shots.find((item) => item.shotNo === authority.shotNo);
  if (!shot) return denied;
  const image = params.imagePrompt ?? params.image_prompt;
  const video = params.videoPrompt ?? params.video_prompt;
  const rawAudio = params.audioPrompts ?? params.audio_prompts;
  if (rawAudio !== undefined && (!Array.isArray(rawAudio) || rawAudio.some((item) => !record(item) || typeof item.prompt !== 'string'))) return denied;
  if ((image !== undefined && typeof image !== 'string') || (video !== undefined && typeof video !== 'string')) return denied;
  const audio = rawAudio as Array<{ prompt: string }> | undefined;
  if (findUnsupportedPromptDialogue({ videoPrompt: [image, video].filter(Boolean).join('\n'), audioPrompts: audio, canonicalDialogue: shot.dialogue }).length
    || findUnsupportedRelationshipClaims({ prompts: [image as string | undefined, video as string | undefined, ...(audio ?? []).map((item) => item.prompt)],
      canonicalFacts: [shot.sourceExcerpt, shot.description, shot.dialogue].filter(Boolean).join('\n') }).length) {
    return '工作台事实锁：本镜头表达不得新增原对白或事实中不存在的台词、人物关系。';
  }
  return null;
}

/** Runs before the actual Tool.execute, not just when exposing definitions to a model. */
export function authorizeWorkspaceDispatch(authority: WorkspaceDispatchAuthority, name: string, params: Record<string, unknown>, data: WorkshopData): string | null {
  if (!workspaceAuthorityCurrent(authority, data)) return '工作台冻结目标已删除、锁定、改归属或事实已变化，工具未执行。';
  if (authority.level === 'professional') return null;
  if (!record(params)) return denied;
  if (params.project_id !== undefined && params.project_id !== authority.projectId) return denied;
  if (params.projectId !== undefined && params.projectId !== authority.projectId) return denied;
  if (reads.has(name)) return null;
  if (name === 'media_api_plugin' && params.op === 'list') return null;
  if (name === 'capability_api_config' && params.op === 'get') return null;
  if (name === 'todo_write' || name === 'sleep') return null;
  if (authority.level === 'project' && isWorkspaceProjectGenerator(name)) {
    return workspaceProjectGenerationError(authority.projectId, params);
  }
  if (authority.level === 'project') {
    if (name === 'project_update_object' && record(params.patch) && params.patch.relationIds !== undefined
      && classifyWorkshopEditScope(authority.request) !== 'story' && classifyWorkshopEditScope(authority.request) !== 'shots') return denied;
    // Project runs retain legacy tool availability and native risk/approval checks.
    // Shell execution is not an object-scoped sandbox; only local scopes deny it here.
    return null;
  }
  if (unsafeExecution.has(name)) return denied;
  if (name === 'project_update_generation_prompt') {
    if (params.project_id !== authority.projectId || params.object_id !== authority.objectId
      || !['image', 'video'].includes(String(params.output_type))
      || (authority.level === 'media' && params.output_type !== authority.outputType)) return denied;
    return authority.shotNo ? expressionError(params.output_type === 'video' ? { videoPrompt: params.prompt } : { imagePrompt: params.prompt }, authority, data) : null;
  }
  if (name === 'workshop_add_candidate') {
    return authority.level === 'media' && authority.outputType === 'image' && params.select === false
      && params.kind === authority.ownerKind && params.id === authority.sourceId
      && ['character', 'scene', 'prop'].includes(String(params.kind)) ? null : denied;
  }
  if (authority.level !== 'shot') return denied;
  if (name === 'workshop_update_shot') {
    if (!exactShot(params, authority.shotNo) || !record(params.patch)
      || Object.keys(params.patch).some((key) => !expressionKeys.has(key))) return denied;
    return expressionError(params.patch, authority, data);
  }
  if (name === 'workshop_set_prompts') {
    let items = params.items;
    if (typeof items === 'string') { try { items = JSON.parse(items); } catch { return denied; } }
    if (!Array.isArray(items) || !items.length) return denied;
    for (const item of items) {
      if (!record(item) || !exactShot(item, authority.shotNo) || Object.keys(item).some((key) => !shotKeys.has(key) && !promptKeys.has(key))) return denied;
      const error = expressionError(item, authority, data);
      if (error) return error;
    }
    return null;
  }
  return denied;
}
