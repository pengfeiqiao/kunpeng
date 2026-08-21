import type { Tool } from '../types';
import { useBackgroundTaskStore } from '@/stores/backgroundTaskStore';
import { useCanvasTaskStore } from '@/stores/canvasTaskStore';

function canvasTaskView(task: ReturnType<typeof useCanvasTaskStore.getState>['tasks'][number]) {
  return {
    source: 'canvas',
    id: task.id,
    remote_id: task.rhTaskId ?? null,
    kind: task.kind,
    status: task.status,
    progress: task.progress ?? null,
    engine: task.engineLabel,
    node_id: task.nodeId,
    result_paths: task.resultPaths,
    result_urls: task.resultUrls,
    error: task.error ?? null,
    created_at: task.createdAt,
    updated_at: task.updatedAt ?? null,
    finished_at: task.finishedAt ?? null,
  };
}

function backgroundTaskView(task: ReturnType<typeof useBackgroundTaskStore.getState>['tasks'][number]) {
  return {
    source: 'background',
    id: task.id,
    remote_id: task.submitId,
    kind: task.genKind ?? 'video',
    status: task.status,
    progress: task.description,
    node_id: task.nodeId ?? null,
    result_paths: task.resultPath ? [task.resultPath] : [],
    result_urls: task.resultUrl ? [task.resultUrl] : [],
    error: task.error ?? null,
    created_at: task.createdAt,
    finished_at: task.completedAt ?? null,
  };
}

export const taskStatusTool: Tool = {
  definition: {
    name: 'task_status',
    description: '统一查询鲲鹏异步任务状态。支持画布、工坊、Omni、RunningHub 和已注册即梦后台任务的本地或远端 task id；不再猜各自的查询工具。',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: '本地任务 id（ct-/b-）或远端 task id；不填返回最近任务' },
        limit: { type: 'number', description: '未传 task_id 时返回最近几条，默认 10，最多 30' },
      },
      required: [],
    },
  },
  risk: 'safe',
  async execute(params) {
    const query = String(params.task_id ?? '').trim();
    const canvas = useCanvasTaskStore.getState().tasks;
    const background = useBackgroundTaskStore.getState().tasks;
    if (query) {
      const canvasHit = canvas.find((task) => task.id === query || task.rhTaskId === query);
      if (canvasHit) return { success: true, output: JSON.stringify(canvasTaskView(canvasHit), null, 2) };
      const backgroundHit = background.find((task) => task.id === query || task.submitId === query);
      if (backgroundHit) return { success: true, output: JSON.stringify(backgroundTaskView(backgroundHit), null, 2) };
      return {
        success: false,
        output: '',
        error: `未找到任务 ${query}。可调用 task_status() 查看最近任务；远端任务尚未注册时，先用对应生成工具的恢复入口。`,
      };
    }
    const limit = Math.max(1, Math.min(30, Number(params.limit ?? 10) || 10));
    const recent = [
      ...canvas.map(canvasTaskView),
      ...background.map(backgroundTaskView),
    ].sort((a, b) => b.created_at - a.created_at).slice(0, limit);
    return { success: true, output: JSON.stringify({ tasks: recent }, null, 2) };
  },
};
