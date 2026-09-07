import { useWorkshopStore } from '@/stores/workshopStore';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';
import { useCanvasTaskStore } from '@/stores/canvasTaskStore';
import { useToolConfirmStore } from '@/stores/toolConfirmStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import { runGeneration } from '@/lib/canvasGen';
import { canvasGenerateTool } from '@/lib/agent/tools/canvasGenerateTool';
import type { WorkspaceDraft } from './types';
import { saveWorkspaceDraft } from './drafts';
import { submitWorkspaceGeneration, type WorkspaceGenerationPort } from './generationCommand';
import { projectWorkspaceTasks } from './taskProjection';
import type { WorkshopAssetKind, WorkshopData } from '../workshop/types';
import { prepareWorkspaceAssetGeneration } from './assetGeneration';
import { projectChangedProfessionalDrafts } from './professionalDraftProjection';

const live = new Map<string, { projectId: string; controller: AbortController }>();

const port: WorkspaceGenerationPort = {
  readProject: (projectId) => {
    const ws = useWorkshopStore.getState();
    return ws.project?.id === projectId && ws.data?.projectId === projectId
      && useUnifiedProjectStore.getState().activeId === projectId ? ws.data : null;
  },
  publish: (before, after) => {
    if (port.readProject(before.projectId) !== before || after.projectId !== before.projectId) return false;
    if (before !== after) {
      const canvas = useCanvasStore.getState();
      const project = useProjectStore.getState();
      const linked = !project.switching && project.activeProjectId && (before.canvasProjectId === project.activeProjectId
        || project.projects.some((item) => item.id === project.activeProjectId && item.aigcProjectId === before.projectId));
      const nodes = linked ? projectChangedProfessionalDrafts(before, after, canvas.nodes) : canvas.nodes;
      useWorkshopStore.setState({ data: after });
      if (nodes !== canvas.nodes && useCanvasStore.getState().nodes === canvas.nodes
        && useProjectStore.getState().activeProjectId === project.activeProjectId && port.readProject(before.projectId) === after) {
        useCanvasStore.setState({ nodes });
      }
      useWorkshopStore.getState().scheduleSave();
    }
    return true;
  },
  persist: async (projectId) => {
    if (!port.readProject(projectId)) throw new Error('项目已经切换');
    await useWorkshopStore.getState().commitNow({ requireSuccess: true });
    if (!port.readProject(projectId)) throw new Error('项目已经切换');
  },
  confirm: (snapshot, _id, signal) => useToolConfirmStore.getState().requestConfirm('workspace_generate', {
    prompt: snapshot.prompt, engine: snapshot.engineId, params: snapshot.params,
    reference_urls: snapshot.references.filter((ref) => ref.type === 'image').map((ref) => ref.path),
    video_urls: snapshot.references.filter((ref) => ref.type === 'video').map((ref) => ref.path),
    audio_urls: snapshot.references.filter((ref) => ref.type === 'audio').map((ref) => ref.path),
    fallback_notice: '仅明确未提交或明确失败时允许使用备用渠道；提交状态不明时停止。',
  }, undefined, { scope: `workspace:${snapshot.projectId}`, signal, risk: canvasGenerateTool.risk }),
  runGeneration,
  bindTask: (taskId, workspaceBinding) => useCanvasTaskStore.getState().updateTask(taskId, { workspaceBinding }),
};

export function updateWorkspaceDraft(draft: WorkspaceDraft): WorkspaceDraft | null {
  const before = port.readProject(draft.projectId);
  if (!before) return null;
  const after = saveWorkspaceDraft(before, draft, draft.revision);
  return after && port.publish(before, after) ? after.workspaceDrafts![draft.id] : null;
}

export function applyWorkspaceProjectCommand(projectId: string, command: (data: WorkshopData) => WorkshopData | null): boolean {
  const before = port.readProject(projectId);
  if (!before) return false;
  const after = command(before);
  return Boolean(after && port.publish(before, after));
}

export async function generateWorkspaceDraft(draft: WorkspaceDraft) {
  const id = `workspace-${crypto.randomUUID()}`;
  const controller = new AbortController();
  live.set(id, { projectId: draft.projectId, controller });
  try {
    return await submitWorkspaceGeneration(port, draft, id, canvasGenerateTool.risk ?? 'ask', controller.signal);
  } finally {
    live.delete(id);
    reconcileWorkspaceRuntime();
  }
}

export async function generateWorkspaceAsset(projectId: string, kind: WorkshopAssetKind, assetId: string, engineId?: string) {
  const before = port.readProject(projectId);
  if (!before) return { submissionId: '', status: 'invalid' as const, error: '项目已经切换，未提交生成' };
  const prepared = prepareWorkspaceAssetGeneration(before, kind, assetId, engineId);
  if ('error' in prepared) return { submissionId: '', status: 'invalid' as const, error: prepared.error };
  if (!port.publish(before, prepared.data)) return { submissionId: '', status: 'invalid' as const, error: '项目内容已经更新，请重新确认' };
  return generateWorkspaceDraft(prepared.draft);
}

function reconcileWorkspaceRuntime() {
  const projectId = useUnifiedProjectStore.getState().activeId;
  for (const run of live.values()) if (run.projectId !== projectId) run.controller.abort();
  if (!projectId) return;
  const data = port.readProject(projectId);
  if (!data) return;
  const next = projectWorkspaceTasks(data, useCanvasTaskStore.getState().tasks, new Set(live.keys()));
  if (next !== data) port.publish(data, next);
}

/** Store subscriptions keep task progress out of the root React render loop. */
export function watchWorkspaceRuntime(): () => void {
  let disposed = false;
  let queued = false;
  const schedule = () => {
    if (queued || disposed) return;
    queued = true;
    queueMicrotask(() => { queued = false; if (!disposed) reconcileWorkspaceRuntime(); });
  };
  const unsubTask = useCanvasTaskStore.subscribe(schedule);
  const unsubProject = useUnifiedProjectStore.subscribe((state, previous) => { if (state.activeId !== previous.activeId) schedule(); });
  const unsubWorkshop = useWorkshopStore.subscribe((state, previous) => { if (state.data?.projectId !== previous.data?.projectId) schedule(); });
  schedule();
  return () => { disposed = true; unsubTask(); unsubProject(); unsubWorkshop(); };
}
