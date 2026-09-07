import { buildProjectIntakeAgentContext, type ProjectIntakeRecord } from './projectIntake.ts';
import type { AssistantTarget, ProjectAssistantQueue } from '../workspace/projectAssistantQueue.ts';

/** Called only from explicit project creation, never from project hydration/mount. */
function intakeTarget(projectId: string, sessionId: string | null, intake: ProjectIntakeRecord): AssistantTarget {
  const contextBase = `[媒体工作台上下文：${JSON.stringify({ project_id: projectId, intake_created_at: intake.createdAt })}]\n`
    + `${buildProjectIntakeAgentContext(intake)}\n`
    + '这是用户创建项目时提交的第一条请求，请直接回应并开始相应的创意或剧本工作。保留原意、事件、人物与对白；不得虚构已完成的工作。遵守原有工具权限、事实锁和付费生成确认。';
  return { projectId, sessionId, surface: 'media', accessScope: 'project',
    label: '项目对话', contextBase, context: contextBase + '\n\n', references: [] };
}

export function findProjectIntakeHandoff(queue: ProjectAssistantQueue, projectId: string, intake: ProjectIntakeRecord) {
  const context = intakeTarget(projectId, null, intake).context;
  return queue.getSnapshot().items.find((item) => item.target.projectId === projectId && item.target.context === context);
}

export function enqueueProjectIntake(queue: ProjectAssistantQueue, projectId: string, sessionId: string | null, intake: ProjectIntakeRecord): string | undefined {
  if (!intake.brief.trim() && !intake.attachments.length) return;
  const target = intakeTarget(projectId, sessionId, intake);
  // A completed/uncertain handoff is still consumed; do not replay on a UI retry.
  const existing = findProjectIntakeHandoff(queue, projectId, intake);
  if (existing) { queue.select(existing.target); return existing.id; }
  queue.select(target);
  return queue.enqueue(target, intake.brief.trim() || '请先分析我上传的素材，和我一起开始这个项目。',
    [...new Set(intake.attachments.map((item) => item.path))]);
}
