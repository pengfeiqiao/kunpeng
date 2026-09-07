import type { WorkspaceDraft } from './types.ts';
import { prepareWorkspaceAssetGeneration } from './assetGeneration.ts';
import { changeWorkspaceReferences, saveWorkspaceDraft } from './drafts.ts';
import type { LegacyShotGenerationPort } from './legacyShotGeneration.ts';
import { pendingWorkspaceSubmission } from './submissions.ts';

const VARIANTS = [
  ['远景', '交代空间结构、入口出口、主要动线和光源方向'],
  ['中景', '保留空间关系，适合人物调度与动作发生'],
  ['近景', '聚焦关键区域、质感、陈设和可被角色触碰的细节'],
  ['细节', '特写细节图，强调材质、道具摆放、光影纹理与氛围锚点'],
] as const;

/** Scene iterations are sequential visible drafts; any unresolved submission stops the remainder. */
export async function generateLegacySceneVariants(port: LegacyShotGenerationPort, projectId: string, sceneId: string) {
  const preparedBase: { draft?: WorkspaceDraft } = {};
  if (!port.apply(projectId, (data) => {
    const prepared = prepareWorkspaceAssetGeneration(data, 'scene', sceneId);
    if ('error' in prepared) throw new Error(prepared.error);
    const scene = prepared.data.scenes.find((item) => item.id === sceneId);
    if (!scene?.assetImagePath) throw new Error('请先选择一张场景图，再进行场景迭代');
    const draft = prepared.draft;
    if (pendingWorkspaceSubmission(data, draft.objectId, 'image')) throw new Error('场景已有待处理任务，请核对原任务，勿重复提交');
    const existing = draft.references.find((ref) => ref.type === 'image' && ref.path === scene.assetImagePath);
    const media = prepared.data.projectObjects!.media.find((item) => item.path === scene.assetImagePath && item.ownerObjectId === draft.objectId);
    preparedBase.draft = changeWorkspaceReferences(draft, [existing ?? { id: `scene-base:${sceneId}:${scene.assetImagePath}`, type: 'image',
      path: scene.assetImagePath, label: '场景迭代原图', objectId: draft.objectId, versionId: media?.versionObjectId },
    ...draft.references.filter((ref) => ref !== existing)]);
    return prepared.data;
  }) || !preparedBase.draft) throw new Error('项目已经切换，未提交场景迭代');
  const original = preparedBase.draft;
  let revision = original.revision;
  for (const [label, hint] of VARIANTS) {
    const preparedVariant: { draft?: WorkspaceDraft } = {};
    if (!port.apply(projectId, (data) => {
      if (pendingWorkspaceSubmission(data, original.objectId, 'image')) throw new Error('场景已有待处理任务，未提交后续角度');
      if (data.workspaceDrafts?.[original.id]?.revision !== revision) throw new Error('场景草稿已被修改，停止后续角度，保留新稿');
      const draft = { ...original, revision, prompt: `${original.prompt}\n\n以 @图片一 为场景原图，保持同一场景、美术风格、色彩和光源方向，生成${label}迭代图。${hint}。不要加入人物、改变空间主设定或添加文字。` };
      const next = saveWorkspaceDraft(data, draft, revision);
      if (!next) throw new Error('场景已锁定或草稿改变，未提交后续角度');
      preparedVariant.draft = next.workspaceDrafts![draft.id];
      return next;
    }) || !preparedVariant.draft) throw new Error('项目已经切换，未提交后续角度');
    revision = preparedVariant.draft.revision;
    const outcome = await port.generate(preparedVariant.draft);
    if (outcome.status === 'cancelled' && !outcome.error) return;
    if (outcome.status !== 'succeeded') throw new Error(outcome.error || '场景迭代尚未完成，请核对原任务，未提交后续角度');
  }
}
