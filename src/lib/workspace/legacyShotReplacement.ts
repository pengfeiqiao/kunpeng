import type { WorkshopData, WsShot } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects, stableProjectObjectId } from '../projectObjects/migrate.ts';
import { deleteProjectObjectCommand, type ProjectCommandState } from '../projectObjects/projectCommands.ts';
import { appendProjectSnapshot, createProjectSnapshot } from '../projectObjects/snapshots.ts';
import { mergeWorkspaceShots } from './shotEdits.ts';
import { editLegacyShotReferences, legacyShotDraft } from './legacyShotReferences.ts';
import { saveWorkspaceDraft, workspaceDraftKey } from './drafts.ts';

export function mergeLegacyShotEdits(input: WorkshopData, incoming: WsShot[], createId: () => string, now = Date.now()): WorkshopData {
  if (!incoming.length) return input;
  const planned = incoming.map((patch) => ({ ...patch, id: patch.id ?? input.shots.find((shot) => shot.shotNo === patch.shotNo)?.id
    ?? (input.shots.some((shot) => shot.shotNo === patch.shotNo) ? patch.shotNo : createId()) }));
  if (planned.some((shot) => !shot.id.trim() || !shot.shotNo.trim())) throw new Error('镜头 ID 或镜号不能为空');
  // Validate the complete batch before computing reference edits; publication remains the caller's single action.
  mergeWorkspaceShots(input, planned, createId, now);
  let data = input;
  for (const patch of planned) {
    const existing = patch.id ? data.shots.find((shot) => (shot.id ?? shot.shotNo) === patch.id)
      : data.shots.find((shot) => shot.shotNo === patch.shotNo);
    if (existing) data = editLegacyShotReferences(data, existing.shotNo, { ...patch, shotNo: existing.shotNo }, now);
  }
  const resolved = planned.map((patch) => {
    const existing = data.shots.find((shot) => (shot.id ?? shot.shotNo) === patch.id);
    return existing ? { ...existing, id: patch.id, shotNo: patch.shotNo } : patch;
  });
  data = mergeWorkspaceShots(data, resolved, createId, now);
  for (const patch of planned.filter((item) => !input.shots.some((shot) => (shot.id ?? shot.shotNo) === item.id))) {
    const shot = data.shots.find((item) => item.id === patch.id)!;
    for (const type of ['image', 'video'] as const) {
      const key = workspaceDraftKey(stableProjectObjectId('shot', patch.id), type);
      const drafts = { ...data.workspaceDrafts }; delete drafts[key];
      const rawShot = { ...shot, workspaceReferenceProjection: undefined };
      const source = legacyShotDraft({ ...data, workspaceDrafts: drafts, shots: data.shots.map((item) => item === shot ? rawShot : item) }, rawShot, type, now);
      if (!source) continue;
      const saved = saveWorkspaceDraft(data, source, data.workspaceDrafts?.[key]?.revision ?? 0, now);
      if (!saved) throw new Error('新镜头草稿创建失败');
      data = saved;
    }
  }
  return data;
}

/** One replacement transaction, including deleted objects, drafts, references, layout and a pre-edit snapshot. */
export function replaceLegacyShots(state: ProjectCommandState, incoming: WsShot[], createId: () => string, now = Date.now()): ProjectCommandState {
  const normalized = { ...state.workshop, shots: state.workshop.shots.map((shot) => ({ ...shot, id: shot.id ?? shot.shotNo })) };
  const data = migrateWorkshopProjectObjects(normalized, now);
  const planned = incoming.map((shot) => ({ ...shot,
    id: shot.id ?? data.shots.find((old) => old.shotNo === shot.shotNo)?.id ?? createId(),
  }));
  const ids = new Set(planned.map((shot) => shot.id));
  if (ids.size !== planned.length || new Set(planned.map((shot) => shot.shotNo)).size !== planned.length) {
    throw new Error('镜头列表包含重复 ID 或镜号，未替换');
  }
  // A deleted identity may still be referenced by a paid task. Never reuse it for a new object.
  for (const shot of planned) {
    if (!data.shots.some((old) => old.id === shot.id) && Object.values(data.workspaceSubmissions ?? {})
      .some((submission) => submission.draft.objectId === stableProjectObjectId('shot', shot.id))) {
      throw new Error('镜头 ID 属于历史生成任务，不能复用，请创建新 ID');
    }
  }
  for (const shot of data.shots) {
    const owner = data.projectObjects!.objects.find((item) => item.id === stableProjectObjectId('shot', shot.id!));
    if (owner?.locked || owner?.archived) throw new Error(`镜头 ${shot.shotNo} 已锁定或归档，未替换列表`);
  }
  let next: ProjectCommandState = { ...state, workshop: data };
  for (const shot of data.shots.filter((item) => !ids.has(item.id!))) {
    const deleted = deleteProjectObjectCommand(next, stableProjectObjectId('shot', shot.id!), now);
    if (!deleted) throw new Error('镜头删除计算失败，未替换列表');
    next = { workshop: deleted.workshop, canvas: deleted.canvas };
  }
  // Shared merge validates identity and projects prompts/settings. Reference controls use the same draft writer.
  let workshop = mergeLegacyShotEdits(next.workshop, planned, createId, now);
  workshop = { ...workshop, shots: planned.map((patch) => workshop.shots.find((shot) => shot.id === patch.id)!) };
  const snapshot = createProjectSnapshot(data, state.canvas, { now, label: '替换镜头列表前',
    changedObjectIds: [...new Set([...data.shots, ...planned].map((shot) => stableProjectObjectId('shot', shot.id!)))],
  });
  snapshot.pendingTaskIds = [...new Set([...snapshot.pendingTaskIds, ...Object.values(data.workspaceSubmissions ?? {})
    .filter((submission) => ['submitting', 'running', 'uncertain'].includes(submission.status)).flatMap((submission) => submission.taskIds)])];
  return { workshop: { ...workshop, projectSnapshots: appendProjectSnapshot(data.projectSnapshots, snapshot) }, canvas: next.canvas };
}

export function removeLegacyShot(state: ProjectCommandState, sourceId: string, now = Date.now()): ProjectCommandState {
  const data = state.workshop;
  const shot = data.shots.find((item) => (item.id ?? item.shotNo) === sourceId);
  if (!shot) throw new Error('镜头不存在，未删除');
  const owner = data.projectObjects?.objects.find((item) => item.id === stableProjectObjectId('shot', sourceId));
  if (owner?.locked || owner?.archived) throw new Error('镜头已锁定或归档，未删除');
  const next = deleteProjectObjectCommand(state, stableProjectObjectId('shot', sourceId), now);
  if (!next) throw new Error('镜头删除计算失败');
  return { ...next, workshop: { ...next.workshop, projectSnapshots: next.workshop.projectSnapshots?.map((snapshot) => snapshot.id !== next.snapshotId ? snapshot : {
    ...snapshot, pendingTaskIds: [...new Set([...snapshot.pendingTaskIds, ...Object.values(data.workspaceSubmissions ?? {})
      .filter((submission) => submission.draft.objectId === stableProjectObjectId('shot', sourceId)
        && ['submitting', 'running', 'uncertain'].includes(submission.status)).flatMap((submission) => submission.taskIds)])],
  }) } };
}

export interface LegacyProjectCommandPort {
  read: () => ProjectCommandState | null;
  publish: (before: ProjectCommandState, after: ProjectCommandState) => boolean;
}

export function applyLegacyShotCommand(port: LegacyProjectCommandPort, projectId: string,
  command: (state: ProjectCommandState) => ProjectCommandState): boolean {
  const before = port.read();
  if (!before || before.workshop.projectId !== projectId) return false;
  const after = command(before);
  return after.workshop.projectId === projectId && port.publish(before, after);
}
