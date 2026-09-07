import type { Tool } from '../types';
import { useWorkshopStore } from '@/stores/workshopStore';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';
import { initialWorkspaceDraft, workspaceDraftErrors } from '@/lib/workspace/drafts';
import { updateWorkspaceDraft } from '@/lib/workspace/runtime';

const targetProperties = {
  project_id: { type: 'string', description: '当前项目 ID，必须与请求中的目标一致。' },
  object_id: { type: 'string', description: '稳定对象 ID，如 shot:内部镜头ID，不是镜号；导演约束卡使用 director-constraint:卡ID，output_type 为 image。' },
  output_type: { type: 'string', enum: ['image', 'video'], description: '需要读取或修改的生成类型。' },
};

function readTarget(params: Record<string, unknown>) {
  const data = useWorkshopStore.getState().data;
  if (!data || data.projectId !== params.project_id || useUnifiedProjectStore.getState().activeId !== params.project_id
    || typeof params.object_id !== 'string' || (params.output_type !== 'image' && params.output_type !== 'video')) return null;
  return initialWorkspaceDraft(data, params.object_id, params.output_type);
}

export const getWorkspaceDraftTool: Tool = {
  definition: { name: 'project_get_generation_draft', description: '读取新媒体工作台的生成草稿、修订号、原图参考顺序及参数。修改工作台提示词前必须读取此接口，不用旧工坊提示词替代。',
    parameters: { type: 'object', properties: targetProperties, required: ['project_id', 'object_id', 'output_type'] } },
  risk: 'safe',
  async execute(params) {
    const draft = readTarget(params);
    return draft ? { success: true, output: JSON.stringify(draft) } : { success: false, output: '', error: '目标项目或对象不存在，或项目已经切换。' };
  },
};

export const updateWorkspaceDraftTool: Tool = {
  definition: { name: 'project_update_generation_prompt', description: '按刚读取的修订号，只修改新媒体工作台目标图片/视频草稿的完整提示词。不修改画面描述、剧情对白、人物关系、参考顺序、历史版本或其他镜头。冲突时拒绝覆盖。不会发起生成。',
    parameters: { type: 'object', properties: { ...targetProperties,
      expected_revision: { type: 'integer', description: 'project_get_generation_draft 返回的 revision。' },
      prompt: { type: 'string', description: '修改后的完整提示词，必须保留已有 @ 引用语义。' },
    }, required: ['project_id', 'object_id', 'output_type', 'expected_revision', 'prompt'] } },
  risk: 'ask',
  async execute(params, signal) {
    const draft = readTarget(params);
    if (!draft || signal?.aborted) return { success: false, output: '', error: '目标不可用或操作已取消，未修改。' };
    if (!Number.isInteger(params.expected_revision) || params.expected_revision !== draft.revision) {
      return { success: false, output: '', error: '草稿修订号已变化，请重新读取并核对用户改动，未覆盖。' };
    }
    if (typeof params.prompt !== 'string' || !params.prompt.trim()) return { success: false, output: '', error: '完整提示词不能为空。' };
    const next = { ...draft, prompt: params.prompt };
    const errors = workspaceDraftErrors(next);
    if (errors.length) return { success: false, output: '', error: errors.join('；') };
    const saved = updateWorkspaceDraft(next);
    return saved ? { success: true, output: JSON.stringify({ projectId: saved.projectId, objectId: saved.objectId, outputType: saved.outputType,
      revision: saved.revision, changed: ['prompt'], generated: false }) } : { success: false, output: '', error: '对象锁定、项目切换或发生写入冲突，未覆盖。' };
  },
};

export const workspaceDraftTools = [getWorkspaceDraftTool, updateWorkspaceDraftTool];
