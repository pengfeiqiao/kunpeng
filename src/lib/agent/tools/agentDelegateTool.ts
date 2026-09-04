import type { AgentDelegateRequest, Tool, ToolExecutionContext } from '../types';

export const SUBAGENT_TOOL_GROUPS = ['read', 'generate', 'web', 'files', 'project'] as const;

function compactHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function normalizeDelegateRequest(params: Record<string, unknown>): AgentDelegateRequest {
  const task = typeof params.task === 'string' ? params.task.trim() : '';
  if (!task) throw new Error('agent_delegate 需要非空 task。');
  const context = typeof params.context === 'string' ? params.context.trim() : undefined;
  const requestedGroups = Array.isArray(params.tool_groups)
    ? params.tool_groups.filter((item): item is string => typeof item === 'string')
    : undefined;
  const toolGroups = requestedGroups?.filter((group) =>
    (SUBAGENT_TOOL_GROUPS as readonly string[]).includes(group),
  );
  const rawTimeout = typeof params.timeout_sec === 'number' ? params.timeout_sec : 600;
  const timeoutSec = Math.min(1800, Math.max(1, Math.round(rawTimeout)));
  return {
    task,
    ...(context ? { context } : {}),
    ...(toolGroups?.length ? { toolGroups: [...new Set(toolGroups)] } : {}),
    timeoutSec,
  };
}

export const agentDelegateTool: Tool = {
  definition: {
    name: 'agent_delegate',
    description: '把一个边界清楚、可独立完成的子任务交给隔离子代理。适合并行分析、撰写或生成；不适合需要持续向用户追问和即时判断的任务。子代理默认只能读取资料和调用生成类工具，最大并行数为 3。',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '完整子任务：目标、限制、交付物和验收方式。' },
        context: { type: 'string', description: '必要交接上下文、已确认事实和准确产物路径。' },
        tool_groups: {
          type: 'array',
          description: '允许的工具组。默认 read + generate；可选 read、generate、web、files、project。',
          items: { type: 'string', enum: [...SUBAGENT_TOOL_GROUPS] },
        },
        timeout_sec: { type: 'number', description: '超时秒数，默认 600，最大 1800。', default: 600 },
      },
      required: ['task'],
    },
  },
  risk: 'ask',
  concurrencyKey(params) {
    return `agent-delegate:${compactHash(`${String(params.task ?? '')}\n${String(params.context ?? '')}`)}`;
  },
  async execute(params, signal, context?: ToolExecutionContext) {
    if ((context?.subagentDepth ?? 0) >= 1) {
      return { success: false, output: '', error: '子代理深度上限为 1，不能再次委派。' };
    }
    if (!context?.delegate) {
      return { success: false, output: '', error: '当前运行未启用子代理，无法委派。' };
    }
    try {
      const result = await context.delegate(normalizeDelegateRequest(params), signal);
      const output = JSON.stringify(result, null, 2);
      return {
        success: result.status === 'completed',
        output,
        ...(result.error ? { error: result.error } : {}),
      };
    } catch (error) {
      return {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
