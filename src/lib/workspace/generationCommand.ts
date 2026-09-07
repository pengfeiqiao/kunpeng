import type { WorkshopData } from '../workshop/types.ts';
import type { CoreGenRequest, CoreGenResult } from '../canvasGen/index';
import type { WorkspaceDraft, WorkspaceSubmission, WorkspaceTaskBinding } from './types.ts';
import type { ToolRisk } from '../agent/types';
import { cloneWorkspaceDraft, workspaceDraftErrors } from './drafts.ts';
import { shouldConfirmGeneration, isPaidGeneration } from '../projectObjects/generationDraft.ts';
import { bindWorkspaceTask, receiveWorkspaceResult, reserveWorkspaceSubmission, transitionWorkspaceSubmission } from './submissions.ts';
import { materializeWorkspaceDefaults } from './engineCatalog.ts';
import { constraintGenerationErrors } from './constraints.ts';
import { workspaceTarget } from './targets.ts';

/** The adapter must delegate to canvasGen.runGeneration, never to a second provider executor. */
export interface WorkspaceGenerationPort {
  readProject: (projectId: string) => WorkshopData | null;
  /** Compare-and-publish one project command; false means the project changed before publication. */
  publish: (before: WorkshopData, after: WorkshopData) => boolean;
  /** Persist the reservation before crossing the paid boundary. Failure must prevent submission. */
  persist: (projectId: string) => Promise<void>;
  confirm: (snapshot: WorkspaceDraft, submissionId: string, signal?: AbortSignal) => Promise<boolean>;
  runGeneration: (request: CoreGenRequest) => Promise<CoreGenResult>;
  /** Persist on the existing task record, even if the originating project is no longer open. */
  bindTask: (taskId: string, binding: WorkspaceTaskBinding) => void;
}

export interface WorkspaceGenerationOutcome {
  submissionId: string;
  status: WorkspaceSubmission['status'] | 'invalid';
  error?: string;
  result?: CoreGenResult;
}

export function workspaceGenerationRequest(snapshot: WorkspaceDraft): CoreGenRequest {
  // 显式文生视频：参考不随请求提交（t2v 语义与画布一致；t2v 引擎 id 本身也会被引擎层剥离）
  const t2v = snapshot.params.videoMode === 't2v';
  return { projectId: snapshot.projectId, engineId: snapshot.engineId, prompt: snapshot.prompt, strictPaidSafety: true,
    params: { ...snapshot.params },
    referenceUrls: t2v ? [] : snapshot.references.filter((ref) => ref.type === 'image').map((ref) => ref.path),
    videoUrls: t2v ? [] : snapshot.references.filter((ref) => ref.type === 'video').map((ref) => ref.path),
    audioUrls: t2v ? [] : snapshot.references.filter((ref) => ref.type === 'audio').map((ref) => ref.path) };
}

export function workspaceResultStatus(result: CoreGenResult): WorkspaceSubmission['status'] {
  if (result.success && result.resultPaths.length) return 'succeeded';
  if (result.submissionUncertain || result.automaticRetryBlocked || result.submissionCommitted) return 'uncertain';
  if (result.backgroundPending || (result.providerTaskId && !result.providerFailed)) return 'running';
  // A nominal success without an output is not permission to create another paid task.
  return result.success || (result.taskId && !result.providerFailed) ? 'uncertain' : 'failed';
}

/** Confirmation and bookkeeping only. No retries, fallback, uploads, polling or provider requests here. */
export async function submitWorkspaceGeneration(
  port: WorkspaceGenerationPort,
  draft: WorkspaceDraft,
  submissionId: string,
  risk: ToolRisk,
  signal?: AbortSignal,
): Promise<WorkspaceGenerationOutcome> {
  const snapshot = materializeWorkspaceDefaults(draft);
  const errors = workspaceDraftErrors(snapshot);
  const initial = port.readProject(snapshot.projectId);
  if (initial) errors.push(...constraintGenerationErrors(initial, snapshot));
  if (!initial || errors.length || risk === 'deny' || signal?.aborted) {
    return { submissionId, status: 'invalid', error: errors.join('；') || '当前项目不可生成' };
  }
  const reservation = reserveWorkspaceSubmission(initial, snapshot, submissionId);
  if (!reservation || !port.publish(initial, reservation)) return { submissionId, status: 'invalid', error: '对象已锁定、项目已切换或已有待处理的生成任务' };

  const update = (transform: (data: WorkshopData) => WorkshopData) => {
    const data = port.readProject(snapshot.projectId);
    return Boolean(data && port.publish(data, transform(data)));
  };
  let enteredExecutor = false;
  try {
    await port.persist(snapshot.projectId);
    const preference = initial.projectSpec?.generationConfirmation ?? 'paid-only-confirm';
    // 图片在默认偏好下直接生成；视频仍弹一次确认。always-confirm 偏好对两者都确认。
    const paid = isPaidGeneration(risk) && snapshot.outputType !== 'image';
    const approved = !signal?.aborted && (!shouldConfirmGeneration(preference, paid)
      || await port.confirm(cloneWorkspaceDraft(snapshot), submissionId, signal));
    if (!approved || signal?.aborted) {
      update((data) => transitionWorkspaceSubmission(data, submissionId, 'cancelled'));
      return { submissionId, status: 'cancelled' };
    }
    const current = port.readProject(snapshot.projectId);
    const owner = current && workspaceTarget(current, snapshot.objectId);
    if (!current || !owner || owner.locked || owner.archived || constraintGenerationErrors(current, snapshot).length || current.workspaceSubmissions?.[submissionId]?.status !== 'awaiting-confirmation'
      || !update((data) => transitionWorkspaceSubmission(data, submissionId, 'submitting'))) {
      update((data) => transitionWorkspaceSubmission(data, submissionId, 'cancelled'));
      return { submissionId, status: 'cancelled', error: '确认期间项目或对象已改变，未提交生成' };
    }
    await port.persist(snapshot.projectId);
    const ready = port.readProject(snapshot.projectId);
    const readyOwner = ready && workspaceTarget(ready, snapshot.objectId);
    if (signal?.aborted || !readyOwner || readyOwner.locked || readyOwner.archived || (ready && constraintGenerationErrors(ready, snapshot).length)
      || ready?.workspaceSubmissions?.[submissionId]?.status !== 'submitting') {
      // Nothing has reached the executor. Release only this reservation.
      update((data) => ({ ...data, workspaceSubmissions: { ...data.workspaceSubmissions,
        [submissionId]: { ...data.workspaceSubmissions![submissionId], status: 'cancelled' } } }));
      return { submissionId, status: 'cancelled' };
    }
    enteredExecutor = true;
    const result = await port.runGeneration({ ...workspaceGenerationRequest(snapshot),
      workspaceBinding: { submissionId, snapshot: cloneWorkspaceDraft(snapshot) }, onTaskCreated: (taskId) => {
      port.bindTask(taskId, { submissionId, snapshot: cloneWorkspaceDraft(snapshot) });
      update((data) => bindWorkspaceTask(data, submissionId, taskId));
    } });
    const status = workspaceResultStatus(result);
    update((data) => status === 'succeeded'
      ? receiveWorkspaceResult(data, { submissionId, snapshot }, result.taskId, result.resultPaths)
      : transitionWorkspaceSubmission(data, submissionId, status, result.error));
    return { submissionId, status, result, error: result.error };
  } catch {
    // Do not leak raw provider/transport diagnostics through the project record.
    const status = enteredExecutor ? 'uncertain' : 'cancelled';
    const error = enteredExecutor ? '暂时无法确认提交结果，请查询原任务，勿重复生成。' : '草稿保存或确认未完成，未提交生成。';
    update((data) => ({ ...data, workspaceSubmissions: { ...data.workspaceSubmissions,
      [submissionId]: { ...data.workspaceSubmissions![submissionId], status, error } } }));
    return { submissionId, status, error };
  }
}
