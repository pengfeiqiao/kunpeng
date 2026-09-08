import type { AssistantTarget } from '../workspace/projectAssistantQueue.ts';
import type { WorkshopData } from '../workshop/types.ts';
import { classifyWorkshopEditScope } from '../workshop/narrativeGuard.ts';
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

const denied = '工作台范围保护：本次工具调用超出当前项目；请从对应项目入口明确发起新任务。';
const reads = new Set(['read_file', 'glob_search', 'grep_search', 'list_directory', 'bash_read_output',
  'project_get_paths', 'project_get_objects', 'project_get_generation_draft', 'workshop_get_state', 'workshop_get_shot_refs',
  'workshop_read_source', 'view_capabilities', 'canvas_get_state', 'canvas_capture_node', 'timeline_get_state',
  'timeline_get_fx_detail', 'image_recognition', 'ask_user_question', 'task_status', 'skill_invoke', 'aigc_optimize_prompt',
  'web_search', 'web_fetch', 'apimart_route_status']);

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/**
 * 捕获运行授权。对象/镜头选择只是"用户正在看"的提示，不是权限围栏：
 * 目标对象在捕获后失效（删除/归档/改归属/锁定）时降级为项目级授权，只保留项目围栏。
 * 唯一硬性拒绝：跨项目目标与外来注册表。
 */
export function captureWorkspaceAuthority(target: AssistantTarget, data: WorkshopData, request: string): WorkspaceDispatchAuthority {
  if (target.projectId !== data.projectId) throw new Error(denied);
  const professional = (target as AssistantTarget & { canvasTarget?: unknown }).canvasTarget
    || target.surface === 'editor';
  const authority: WorkspaceDispatchAuthority = { level: professional ? 'professional' : 'project', projectId: data.projectId, request };
  if (professional) return authority;
  const registry = data.projectObjects;
  if (registry && registry.projectId !== data.projectId) throw new Error(denied);
  if (!target.objectId) {
    // 空项目/未选中对象时 captureTarget 会带默认 outputType（无媒体维度含义），是合法的项目级目标；
    // 但悬空的 mediaId/versionId 或局部 accessScope 仍是非法目标，必须拒绝。
    if (target.mediaId || target.versionId
      || target.accessScope === 'media' || target.accessScope === 'shot') throw new Error(denied);
    // A new project's first script request can precede object-registry initialization.
    return authority;
  }
  if (!registry) return authority;
  const owner = registry.objects.find((item) => item.id === target.objectId)
    ?? registry.media.find((item) => item.id === target.objectId);
  const media = target.mediaId ? registry.media.find((item) => item.id === target.mediaId) : undefined;
  if (!owner || owner.projectId !== data.projectId || owner.archived || owner.locked
    || (target.mediaId && (!media || media.archived || media.projectId !== data.projectId
      || (media.id !== owner.id && media.ownerObjectId !== owner.id)))) return authority;
  const level = target.accessScope === 'shot' || (!target.mediaId && !target.outputType && owner.kind === 'shot') ? 'shot' : 'media';
  Object.assign(authority, { level: level === 'shot' && owner.kind !== 'shot' ? 'project' : level,
    objectId: owner.id, ownerKind: owner.kind, sourceId: owner.sourceId,
    mediaId: target.mediaId, versionId: target.versionId, outputType: target.outputType ?? media?.mediaType });
  return authority;
}

/**
 * 项目切换立即失效；对象事实变化不再打断运行——对象写入由工具自身的锁定/修订校验把关，
 * 选择只是"正在看"的提示。
 */
export function workspaceAuthorityCurrent(authority: WorkspaceDispatchAuthority, data: WorkshopData | null | undefined): boolean {
  return Boolean(data && data.projectId === authority.projectId);
}

/** Runs before the actual Tool.execute, not just when exposing definitions to a model. */
export function authorizeWorkspaceDispatch(authority: WorkspaceDispatchAuthority, name: string, params: Record<string, unknown>, data: WorkshopData): string | null {
  if (!workspaceAuthorityCurrent(authority, data)) return '工作台项目已变化，工具未执行；请重新发起任务。';
  if (authority.level === 'professional') return null;
  if (!record(params)) return denied;
  if (params.project_id !== undefined && params.project_id !== authority.projectId) return denied;
  if (params.projectId !== undefined && params.projectId !== authority.projectId) return denied;
  if (reads.has(name)) return null;
  if (name === 'media_api_plugin' && params.op === 'list') return null;
  if (name === 'capability_api_config' && params.op === 'get') return null;
  if (name === 'todo_write' || name === 'sleep') return null;
  // 生成类工具：所有级别都要求 project_id 绑定且只产出独立产物（不覆盖路径、不改节点、不采用）；
  // 付费确认由确认链与幂等闸独立把关，与对象范围无关。
  if (isWorkspaceProjectGenerator(name)) return workspaceProjectGenerationError(authority.projectId, params);
  if (name === 'project_update_object' && record(params.patch) && params.patch.relationIds !== undefined
    && classifyWorkshopEditScope(authority.request) !== 'story' && classifyWorkshopEditScope(authority.request) !== 'shots') return denied;
  // 同项目内的其余操作一律放行（含对象/镜头级运行）：冻结对象只作提示，不作围栏。
  return null;
}
