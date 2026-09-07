import type { Tool } from '../types';
import { homeDir } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/tauri';
import { useProjectStore } from '@/stores/projectStore';
import { useWorkshopStore } from '@/stores/workshopStore';
import { getActiveEditorProjectId } from '@/lib/editor/editorPersist';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';
import { findProjectObject } from '@/lib/projectObjects/selectors';
import type { MediaPurpose, ProjectObjectRecord } from '@/lib/projectObjects/types';
import { workspaceDraftTools } from './workspaceDraftTools';

function joinPath(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/');
}

export const projectGetPathsTool: Tool = {
  definition: {
    name: 'project_get_paths',
    description: '读取当前鲲鹏项目的真实本地路径：工坊目录、画布 json、剪辑 json、资产目录、配音目录、工作区目录。agent 需要用 bash/read/write 调试项目前应先调用。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  risk: 'safe',
  async execute() {
    const home = (await homeDir()).replace(/\/$/, '');
    const canvasState = useProjectStore.getState();
    const workshopState = useWorkshopStore.getState();
    const canvasProjectId = canvasState.activeProjectId;
    const canvasProject = canvasProjectId ? canvasState.projects.find((p) => p.id === canvasProjectId) : null;
    const aigcProjectId = workshopState.project?.id ?? canvasProject?.aigcProjectId ?? null;
    const editorProjectId = getActiveEditorProjectId();
    const workspaceDir = await invoke<string>('ensure_workspace').catch(() => null);
    const aigcRoot = aigcProjectId ? joinPath(home, '.kunpeng/aigc-memory/projects', aigcProjectId) : null;
    const canvasRoot = canvasProjectId ? joinPath(home, '.kunpeng/projects', canvasProjectId) : null;
    const editorRoot = editorProjectId ? joinPath(home, '.kunpeng/aigc-memory/projects', editorProjectId) : null;
    return {
      success: true,
      output: JSON.stringify({
        current: {
          canvas_project_id: canvasProjectId,
          canvas_project_name: canvasProject?.name ?? null,
          aigc_project_id: aigcProjectId,
          aigc_project_name: workshopState.project?.name ?? null,
          editor_project_id: editorProjectId,
        },
        paths: {
          home,
          workspace_dir: workspaceDir,
          canvas_root: canvasRoot,
          canvas_json: canvasRoot ? joinPath(canvasRoot, 'canvas.json') : null,
          workshop_root: aigcRoot,
          workshop_json: aigcRoot ? joinPath(aigcRoot, 'workshop.json') : null,
          workshop_assets_dir: aigcRoot ? joinPath(aigcRoot, 'assets') : null,
          workshop_shots_dir: aigcRoot ? joinPath(aigcRoot, 'shots') : null,
          workshop_dubbing_dir: aigcRoot ? joinPath(aigcRoot, 'dubbing') : null,
          editor_root: editorRoot,
          editor_json: editorRoot ? joinPath(editorRoot, 'editor.json') : null,
          global_assets_dir: joinPath(home, '.kunpeng/assets'),
          imported_assets_dir: joinPath(home, '.kunpeng/imported-assets'),
        },
        verify: '读写项目前，先用这些路径确认真实文件；修改后用对应 get_state 或 UI refresh 工具验证。',
      }, null, 2),
    };
  },
};

export const projectGetObjectsTool: Tool = {
  definition: {
    name: 'project_get_objects',
    description: '读取当前统一项目的对象、稳定 ID、版本、锁定状态、来源和关联关系。Agent 修改项目前必须先读取目标对象版本，禁止凭旧上下文覆盖。',
    parameters: {
      type: 'object',
      properties: {
        object_id: { type: 'string', description: '可选；只读取一个稳定对象 ID。' },
        kind: { type: 'string', description: '可选；按对象类型过滤。' },
      },
      required: [],
    },
  },
  risk: 'safe',
  async execute(params) {
    const data = useWorkshopStore.getState().data;
    if (!data?.projectObjects) return { success: false, output: '', error: '当前没有已打开的统一项目对象。' };
    const objectId = typeof params.object_id === 'string' ? params.object_id : undefined;
    if (objectId) {
      const object = findProjectObject(data, objectId);
      return object
        ? { success: true, output: JSON.stringify(object, null, 2) }
        : { success: false, output: '', error: `对象 ${objectId} 不存在。` };
    }
    const kind = typeof params.kind === 'string' ? params.kind : undefined;
    const records = [
      ...data.projectObjects.objects,
      ...data.projectObjects.media,
      ...data.projectObjects.versions,
    ].filter((item) => !kind || item.kind === kind);
    return {
      success: true,
      output: JSON.stringify(records.map((item) => ({
        id: item.id,
        kind: item.kind,
        label: item.label,
        source: item.source,
        version: item.version,
        locked: item.locked === true,
        archived: item.archived === true,
        relationIds: item.relationIds,
        ...('purpose' in item ? {
          purpose: item.purpose,
        } : {}),
        ...('selected' in item ? {
          selected: item.selected,
          ownerObjectId: (item as ProjectObjectRecord & { ownerObjectId?: string }).ownerObjectId,
        } : {}),
      })), null, 2),
    };
  },
};

export const projectUpdateObjectTool: Tool = {
  definition: {
    name: 'project_update_object',
    description: '按稳定 ID 和期望版本修改统一项目对象的元数据。若用户刚改过、对象被锁定或版本落后，工具不会覆盖，而会创建可见冲突供用户选择。修改分镜正文仍使用 workshop_* 工具。',
    parameters: {
      type: 'object',
      properties: {
        object_id: { type: 'string', description: 'project_get_objects 返回的稳定对象 ID。' },
        expected_version: { type: 'number', description: 'project_get_objects 刚读取到的版本号。' },
        patch: { type: 'object', description: '允许 label、relationIds、archived；媒体还允许 purpose。不能改 ID、类型、来源或版本号。' },
      },
      required: ['object_id', 'expected_version', 'patch'],
    },
  },
  risk: 'ask',
  async execute(params) {
    const objectId = String(params.object_id ?? '');
    const expectedVersion = Number(params.expected_version);
    const raw = params.patch && typeof params.patch === 'object' && !Array.isArray(params.patch)
      ? params.patch as Record<string, unknown>
      : {};
    if (!objectId || !Number.isFinite(expectedVersion)) {
      return { success: false, output: '', error: 'object_id 与 expected_version 必填。' };
    }
    const allowed: Partial<ProjectObjectRecord> = {};
    if (typeof raw.label === 'string') allowed.label = raw.label;
    if (typeof raw.archived === 'boolean') allowed.archived = raw.archived;
    if (Array.isArray(raw.relationIds)) {
      allowed.relationIds = raw.relationIds.filter((item): item is string => typeof item === 'string');
    }
    const data = useWorkshopStore.getState().data;
    const current = data ? findProjectObject(data, objectId) : undefined;
    if (!current) return { success: false, output: '', error: `对象 ${objectId} 不存在。` };
    if ('purpose' in current && typeof raw.purpose === 'string') {
      if (raw.purpose === 'generation-reference') {
        return { success: false, output: '', error: '参考必须指定目标生成节点：请使用参考连线或编辑该目标的本次参考集合。修改素材用途、归属或采用版本不会加入生成参考。' };
      }
      const purposes: MediaPurpose[] = ['current-version', 'candidate-version', 'ordinary-material', 'final-output', 'unclassified', 'historical'];
      if (!purposes.includes(raw.purpose as MediaPurpose)) {
        return { success: false, output: '', error: `不支持的媒体用途：${raw.purpose}` };
      }
      if (current.version !== expectedVersion) {
        useUnifiedProjectStore.getState().applyAgentObjectPatch({ objectId, expectedVersion, patch: allowed });
        return { success: false, output: '', error: `对象版本已从 ${expectedVersion} 变为 ${current.version}，已创建冲突，未覆盖用户修改。` };
      }
      if (current.locked) return { success: false, output: '', error: `对象 ${current.label ?? objectId} 已锁定，Agent 不能修改。` };
      const status = useUnifiedProjectStore.getState().applyAgentObjectPatch({
        objectId,
        expectedVersion,
        patch: {
          purpose: raw.purpose,
        } as unknown as Partial<ProjectObjectRecord>,
      });
      return status === 'applied'
        ? { success: true, output: `已将 ${current.label ?? objectId} 的用途改为 ${raw.purpose}；改动可撤销。` }
        : { success: false, output: '', error: `媒体用途修改失败：${status}` };
    }
    const status = useUnifiedProjectStore.getState().applyAgentObjectPatch({
      objectId,
      expectedVersion,
      patch: allowed,
    });
    if (status === 'locked') return { success: false, output: '', error: `对象 ${current.label ?? objectId} 已锁定，Agent 不能修改。` };
    if (status === 'conflict') return { success: false, output: '', error: `对象版本已变化，已创建冲突，未覆盖用户修改。` };
    if (status !== 'applied') return { success: false, output: '', error: `对象 ${objectId} 修改失败。` };
    return { success: true, output: `已更新 ${current.label ?? objectId}；改动已进入审阅记录，可撤销本轮。` };
  },
};

export const projectLockObjectTool: Tool = {
  definition: {
    name: 'project_lock_object',
    description: '锁定或解锁统一项目对象。锁定后 Agent 的后续写入会被拒绝，用户手动操作仍保留。',
    parameters: {
      type: 'object',
      properties: {
        object_id: { type: 'string' },
        locked: { type: 'boolean' },
      },
      required: ['object_id', 'locked'],
    },
  },
  risk: 'ask',
  async execute(params) {
    const objectId = String(params.object_id ?? '');
    const locked = params.locked === true;
    const ok = useUnifiedProjectStore.getState().setProjectObjectLocked(objectId, locked);
    return ok
      ? { success: true, output: `${locked ? '已锁定' : '已解锁'}对象 ${objectId}。` }
      : { success: false, output: '', error: `对象 ${objectId} 不存在或状态未变化。` };
  },
};


export const projectUpdateSpecTool: Tool = {
  definition: {
    name: 'project_update_spec',
    description: '填写或更新项目规格（AI 主动填充，用户可随时修改并以用户为准）。允许字段：aspect_ratio、target_duration_sec、language、style_tone、world_and_characters、continuity_facts、forbidden、default_image_model、default_video_model、generation_confirmation(always-confirm/paid-only-confirm/direct-execute)。生成偏好默认保持 paid-only-confirm，除非用户明确要求。',
    parameters: {
      type: 'object',
      properties: {
        aspect_ratio: { type: 'string', description: '如 16:9、9:16' },
        target_duration_sec: { type: 'number' },
        language: { type: 'string' },
        style_tone: { type: 'string', description: '整体视觉风格与色调' },
        world_and_characters: { type: 'string' },
        continuity_facts: { type: 'array', items: { type: 'string' } },
        forbidden: { type: 'array', items: { type: 'string' }, description: '禁止修改的内容' },
        default_image_model: { type: 'string', description: '必须是可用生图引擎 id' },
        default_video_model: { type: 'string', description: '必须是可用视频引擎 id' },
        generation_confirmation: { type: 'string', enum: ['always-confirm', 'paid-only-confirm', 'direct-execute'] },
      },
    },
  },
  risk: 'safe',
  async execute(params) {
    const state = useWorkshopStore.getState();
    if (!state.data || !state.project || useUnifiedProjectStore.getState().activeId !== state.project.id) {
      return { success: false, output: '', error: '没有打开的项目' };
    }
    const patch: Record<string, unknown> = {};
    if (params.aspect_ratio !== undefined) patch.aspectRatio = String(params.aspect_ratio);
    if (params.target_duration_sec !== undefined) patch.targetDurationSec = Number(params.target_duration_sec);
    if (params.language !== undefined) patch.language = String(params.language);
    if (params.style_tone !== undefined) patch.styleTone = String(params.style_tone);
    if (params.world_and_characters !== undefined) patch.worldAndCharacters = String(params.world_and_characters);
    if (Array.isArray(params.continuity_facts)) patch.continuityFacts = params.continuity_facts.map(String);
    if (Array.isArray(params.forbidden)) patch.forbidden = params.forbidden.map(String);
    if (params.default_image_model !== undefined) patch.defaultImageModel = String(params.default_image_model);
    if (params.default_video_model !== undefined) patch.defaultVideoModel = String(params.default_video_model);
    if (params.generation_confirmation !== undefined) patch.generationConfirmation = String(params.generation_confirmation);
    if (!Object.keys(patch).length) return { success: false, output: '', error: '没有要更新的字段' };
    state.updateProjectSpec(patch);
    return { success: true, output: JSON.stringify({ updated: Object.keys(patch) }) };
  },
};

export const allProjectTools: Tool[] = [
  ...workspaceDraftTools,
  projectGetPathsTool,
  projectGetObjectsTool,
  projectUpdateObjectTool,
  projectLockObjectTool,
  projectUpdateSpecTool,
];
