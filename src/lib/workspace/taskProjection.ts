import type { CanvasTask } from '../../stores/canvasTaskStore';
import type { WorkshopData } from '../workshop/types.ts';
import { cloneWorkspaceDraft } from './drafts.ts';
import { bindWorkspaceTask, receiveWorkspaceResult, transitionWorkspaceSubmission } from './submissions.ts';

/** Project task records into candidates without submitting, polling, adopting or touching references. */
export function projectWorkspaceTasks(data: WorkshopData, tasks: readonly CanvasTask[], liveSubmissionIds: ReadonlySet<string>): WorkshopData {
  const related = tasks.filter((task) => task.workspaceBinding?.snapshot.projectId === data.projectId);
  let next = data;
  for (const task of related) {
    const binding = task.workspaceBinding!;
    if (task.status === 'succeeded' && task.resultPaths.length) {
      next = receiveWorkspaceResult(next, binding, task.id, task.resultPaths);
      continue;
    }
    if (!next.workspaceSubmissions?.[binding.submissionId]) {
      next = { ...next, workspaceSubmissions: { ...next.workspaceSubmissions, [binding.submissionId]: {
        id: binding.submissionId, draft: cloneWorkspaceDraft(binding.snapshot), taskIds: [], createdAt: task.createdAt,
        status: 'submitting',
      } } };
    }
    next = bindWorkspaceTask(next, binding.submissionId, task.id);
    if (next.workspaceSubmissions![binding.submissionId].status === 'awaiting-confirmation') {
      next = transitionWorkspaceSubmission(next, binding.submissionId, 'submitting');
    }
    // Foreground orchestration knows whether a channel is about to fail over; do not race its status.
    if (!liveSubmissionIds.has(binding.submissionId)) {
      const status = task.status === 'failed' ? 'uncertain' : 'running';
      const old = next.workspaceSubmissions![binding.submissionId];
      if (old.status !== status && old.status !== 'succeeded' && old.status !== 'cancelled' && old.status !== 'failed') {
        next = transitionWorkspaceSubmission(next, binding.submissionId, status,
          status === 'uncertain' ? '任务结果需核对，请先查询原任务。' : undefined);
      }
    }
  }
  for (const submission of Object.values(next.workspaceSubmissions ?? {})) {
    if (liveSubmissionIds.has(submission.id) || related.some((task) => task.workspaceBinding!.submissionId === submission.id)) continue;
    if (submission.status === 'awaiting-confirmation') next = transitionWorkspaceSubmission(next, submission.id, 'cancelled');
    if (submission.status === 'submitting' || submission.status === 'running') {
      next = transitionWorkspaceSubmission(next, submission.id, 'uncertain', '原任务记录暂不可用，请先核对提交状态。');
    }
  }
  return next;
}
