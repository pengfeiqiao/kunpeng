import type { Tool } from './types';

const standaloneGenerators = new Set(['image_generate', 'video_generate', 'doubao_speech_generate']);

export function isWorkspaceProjectGenerator(name: string): boolean {
  return standaloneGenerators.has(name);
}

/** Keep native execution/risk/model semantics; expose an explicit binding for workspace calls. */
export function withWorkspaceProjectBinding(tool: Tool): Tool {
  if (!isWorkspaceProjectGenerator(tool.definition.name)) return tool;
  return {
    ...tool,
    definition: {
      ...tool.definition,
      parameters: {
        ...tool.definition.parameters,
        properties: {
          ...tool.definition.parameters.properties,
          project_id: {
            type: 'string',
            description: '项目工作面调用必须传当前冻结项目 ID；只生成独立产物，不自动采用到镜头或画布。普通对话可省略。',
          },
        },
      },
    },
  };
}

export function workspaceProjectGenerationError(projectId: string, params: Record<string, unknown>): string | null {
  if (params.project_id !== projectId) return '项目生成缺少当前冻结项目的 project_id，未提交；请传入本次任务的项目 ID。';
  // These tools are admitted only as standalone generation, not as an alternate writeback route.
  if (params.output_path || params.target_node_id || params.object_id || params.objectId || params.media_id || params.mediaId
    || (params.create_canvas_node !== undefined && params.create_canvas_node !== false)) {
    return '项目普通生成只返回独立产物；指定路径覆盖、节点修改和对象采用请走对应的原专业工具。';
  }
  return null;
}
