import type { WorkshopData } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects, stableProjectObjectId } from '../projectObjects/migrate.ts';
import { saveWorkspaceDraft, workspaceDraftErrors } from './drafts.ts';
import { pendingWorkspaceSubmission } from './submissions.ts';
import { legacyShotDraft } from './legacyShotReferences.ts';
import type { WorkspaceDraft } from './types.ts';
import type { WorkspaceGenerationOutcome } from './generationCommand.ts';

export function prepareLegacyShotGeneration(input: WorkshopData, sourceIds: string[], type: 'image' | 'video', now = Date.now()) {
  let data = input.projectObjects ? input : migrateWorkshopProjectObjects(input, now);
  const drafts: WorkspaceDraft[] = [];
  if (new Set(sourceIds).size !== sourceIds.length) throw new Error('生成批次包含重复镜头');
  for (const sourceId of sourceIds) {
    const shot = data.shots.find((item) => (item.id ?? item.shotNo) === sourceId);
    const objectId = stableProjectObjectId('shot', sourceId);
    const owner = data.projectObjects!.objects.find((item) => item.id === objectId);
    if (!shot || !owner || owner.archived || owner.locked) throw new Error('镜头不存在、已归档或锁定，未提交生成');
    if (pendingWorkspaceSubmission(data, objectId, type) || shot.genTaskId || ['queued', 'generating'].includes(shot.genStatus ?? '')) {
      throw new Error(`镜头 ${shot.shotNo} 已有待处理任务，请核对原任务，勿重复提交`);
    }
    const draft = legacyShotDraft(data, shot, type, now);
    if (!draft) throw new Error('无法读取镜头草稿');
    const errors = workspaceDraftErrors(draft);
    if (errors.length) throw new Error(`镜头 ${shot.shotNo}：${errors.join('；')}`);
    if (!data.workspaceDrafts?.[draft.id]) {
      const saved = saveWorkspaceDraft(data, draft, 0, now);
      if (!saved) throw new Error('草稿已改变，未提交生成');
      data = saved;
    }
    drafts.push(data.workspaceDrafts![draft.id]);
  }
  return { data, drafts };
}

export interface LegacyShotGenerationPort {
  apply: (projectId: string, command: (data: WorkshopData) => WorkshopData | null) => boolean;
  generate: (draft: WorkspaceDraft) => Promise<WorkspaceGenerationOutcome>;
}

/** Capture all stable targets and publish visible drafts before entering the shared FIFO. */
export async function generateLegacyShots(port: LegacyShotGenerationPort, projectId: string, sourceIds: string[], type: 'image' | 'video') {
  let drafts: WorkspaceDraft[] = [];
  const published = port.apply(projectId, (data) => {
    const prepared = prepareLegacyShotGeneration(data, sourceIds, type);
    drafts = prepared.drafts;
    return prepared.data;
  });
  if (!published) throw new Error('项目已经切换，未提交生成');
  // All requests use the same runtime queue. No retry, task polling or output writes here.
  const outcomes = await Promise.allSettled(drafts.map((draft) => port.generate(draft)));
  const errors = outcomes.flatMap((outcome) => outcome.status === 'rejected'
    ? ['生成状态需核对，请查询原任务，勿重放本批次']
    : ['invalid', 'failed', 'uncertain'].includes(outcome.value.status) || outcome.value.error
      ? [outcome.value.error || '生成未完成，请查询原任务，勿重放本批次'] : []);
  if (errors.length) throw new Error([...new Set(errors)].join('；'));
}
