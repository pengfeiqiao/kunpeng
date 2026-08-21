import type { Tool } from '../types';

/** Callback type for registering a background task */
export type AddBackgroundTask = (task: {
  type: 'dreamina';
  submitId: string;
  description: string;
  sessionId: string;
  nodeId?: string;
  genKind?: 'image' | 'video';
}) => string;

/**
 * 后台任务注册工具
 * Agent 提交即梦等长时间任务后调用此工具，系统自动后台轮询并在完成时通知用户
 */
export function createBackgroundTaskTool(
  getSessionId: () => string,
  addTask: AddBackgroundTask,
): Tool {
  return {
    definition: {
      name: 'background_task',
      description:
        '注册后台任务。即梦等长时间生成任务提交后，调用此工具注册后台轮询，系统会自动查询进度并在完成时通知用户。不要在对话中手动轮询 query_result。'
        + '如果是从画布节点发起的生成，务必传 node_id 和 gen_kind，生成完成后系统会自动把产物写回画布节点。',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            description: '任务类型，目前支持 dreamina',
          },
          submit_id: {
            type: 'string',
            description: '即梦返回的 submit_id',
          },
          description: {
            type: 'string',
            description: '任务简要描述，如 "文生视频：竹林少女漫步"',
          },
          node_id: {
            type: 'string',
            description: '关联的画布节点 ID，生成完成后自动把产物写回该节点',
          },
          gen_kind: {
            type: 'string',
            enum: ['image', 'video'],
            description: '生成类型，默认 video',
          },
        },
        required: ['type', 'submit_id'],
      },
    },

    async execute(params) {
      const type = params.type as string;
      const submitId = params.submit_id as string;
      const description = (params.description as string) || `${type} 任务`;
      const nodeId = params.node_id as string | undefined;
      const genKind = (params.gen_kind as 'image' | 'video' | undefined) ?? 'video';

      if (!submitId) {
        return { success: false, output: '', error: '缺少 submit_id' };
      }

      if (type !== 'dreamina') {
        return { success: false, output: '', error: `不支持的任务类型: ${type}，目前仅支持 dreamina` };
      }

      const sessionId = getSessionId();
      const taskId = addTask({
        type: 'dreamina',
        submitId,
        description,
        sessionId,
        nodeId,
        genKind,
      });

      return {
        success: true,
        output: `已注册后台任务 (${taskId})，系统将每 30 秒自动查询进度，生成完成后会通知用户。你可以继续其他对话。`,
      };
    },
  };
}
