import type { WorkshopData } from '../workshop/types.ts';
import type { WorkspaceDraft, WorkspaceSubmission, WorkspaceTaskBinding } from './types.ts';
import { cloneWorkspaceDraft, workspaceDraftErrors } from './drafts.ts';
import { registerCanvasGeneration } from '../projectObjects/selectors.ts';
import { workspaceTarget } from './targets.ts';

const UNFINISHED = new Set<WorkspaceSubmission['status']>(['awaiting-confirmation', 'submitting', 'running', 'uncertain']);

export function pendingWorkspaceSubmission(data: WorkshopData, objectId: string, outputType: WorkspaceDraft['outputType']) {
  return Object.values(data.workspaceSubmissions ?? {}).find((item) => item.draft.objectId === objectId
    && item.draft.outputType === outputType && UNFINISHED.has(item.status));
}

/** Reserve before awaiting confirmation, so a double click cannot open two paid submissions. */
export function reserveWorkspaceSubmission(data: WorkshopData, draft: WorkspaceDraft, id: string, now = Date.now()): WorkshopData | null {
  const owner = workspaceTarget(data, draft.objectId);
  if (!id || data.workspaceSubmissions?.[id] || draft.projectId !== data.projectId || !owner || owner.locked || owner.archived
    || workspaceDraftErrors(draft).length || pendingWorkspaceSubmission(data, draft.objectId, draft.outputType)) return null;
  const submission: WorkspaceSubmission = { id, draft: cloneWorkspaceDraft(draft), createdAt: now, status: 'awaiting-confirmation', taskIds: [] };
  return { ...data, workspaceSubmissions: { ...data.workspaceSubmissions, [id]: submission } };
}

const NEXT: Record<WorkspaceSubmission['status'], WorkspaceSubmission['status'][]> = {
  'awaiting-confirmation': ['submitting', 'cancelled'], submitting: ['running', 'succeeded', 'failed', 'uncertain'],
  running: ['succeeded', 'failed', 'uncertain'], uncertain: ['running', 'succeeded', 'failed'],
  succeeded: [], failed: [], cancelled: [],
};

export function transitionWorkspaceSubmission(data: WorkshopData, id: string, status: WorkspaceSubmission['status'], error?: string): WorkshopData {
  const old = data.workspaceSubmissions?.[id];
  if (!old || (old.status !== status && !NEXT[old.status].includes(status))) return data;
  return { ...data, workspaceSubmissions: { ...data.workspaceSubmissions, [id]: { ...old, status, error } } };
}

export function bindWorkspaceTask(data: WorkshopData, id: string, taskId: string): WorkshopData {
  const old = data.workspaceSubmissions?.[id];
  if (!old || !taskId || old.taskIds.includes(taskId)) return data;
  return { ...data, workspaceSubmissions: { ...data.workspaceSubmissions, [id]: { ...old, taskIds: [...old.taskIds, taskId] } } };
}

/** A late result is attached to its frozen owner, never to the current selection or current draft. */
export function receiveWorkspaceResult(data: WorkshopData, binding: WorkspaceTaskBinding, taskId: string, paths: string[], now = Date.now()): WorkshopData {
  const snapshot = binding.snapshot;
  if (data.projectId !== snapshot.projectId || !paths.length) return data;
  const submission = data.workspaceSubmissions?.[binding.submissionId];
  if (submission?.status === 'cancelled') return data;
  const existingPaths = new Set(data.projectObjects?.media.filter((item) => item.generationTaskId === taskId).map((item) => item.path));
  if (paths.every((path) => existingPaths.has(path)) && submission?.status === 'succeeded') return data;
  // Deleting an owner must not resurrect it. Keep an already-paid late output in the inbox instead.
  const owner = data.projectObjects?.objects.find((item) => item.id === snapshot.objectId && !item.archived);
  const registered = registerCanvasGeneration(data, { nodeId: '', taskId, paths,
    mediaType: snapshot.outputType, prompt: snapshot.prompt, engineId: snapshot.engineId,
    ownerObjectId: owner?.id, generationSnapshot: snapshot }, now).data;
  const restored = submission ?? { id: binding.submissionId, draft: cloneWorkspaceDraft(snapshot), createdAt: now, taskIds: [taskId], status: 'running' as const };
  return { ...registered, workspaceSubmissions: { ...registered.workspaceSubmissions,
    [binding.submissionId]: { ...restored, status: 'succeeded', error: undefined, taskIds: [...new Set([...restored.taskIds, taskId])] } } };
}
