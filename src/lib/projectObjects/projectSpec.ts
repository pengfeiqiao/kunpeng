import type { ProjectSpec } from './types.ts';

export function summarizeProjectSpec(spec: ProjectSpec | undefined): string {
  if (!spec) return '未设置项目规格';
  const parts = [
    spec.aspectRatio,
    spec.targetDurationSec ? `${spec.targetDurationSec}s` : undefined,
    spec.styleTone,
    spec.defaultImageModel,
    spec.defaultVideoModel,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : '补充画幅、时长与视觉方向';
}

export function buildProjectSpecAgentContext(
  projectName: string,
  spec: ProjectSpec | undefined,
): string | undefined {
  if (!spec) return undefined;
  const lines = [
    '## 当前统一项目规格',
    `- 项目：${projectName}`,
    spec.aspectRatio ? `- 画幅：${spec.aspectRatio}` : undefined,
    spec.targetDurationSec ? `- 目标时长：${spec.targetDurationSec} 秒` : undefined,
    spec.language ? `- 语言：${spec.language}` : undefined,
    spec.styleTone ? `- 视觉与语气：${spec.styleTone}` : undefined,
    spec.worldAndCharacters ? `- 世界观与人物：${spec.worldAndCharacters}` : undefined,
    spec.defaultImageModel ? `- 默认生图模型：${spec.defaultImageModel}` : undefined,
    spec.defaultVideoModel ? `- 默认视频模型：${spec.defaultVideoModel}` : undefined,
    spec.continuityFacts?.length ? `- 连续性事实：${spec.continuityFacts.join('；')}` : undefined,
    spec.forbidden?.length ? `- 禁止项：${spec.forbidden.join('；')}` : undefined,
    `- 生成确认偏好：${spec.generationConfirmation === 'always-confirm' ? '每次生成前确认' : spec.generationConfirmation === 'direct-execute' ? '允许直接执行' : '仅付费生成前确认'}`,
    '',
    '以上是工坊、画布、剪辑与普通对话共享的项目级约束。对象自身明确设置优先于项目默认；用户本轮明确要求优先于对象与项目设置。不得自行放宽禁止项。',
  ].filter((line): line is string => Boolean(line));
  return lines.join('\n');
}

export function patchProjectSpec(
  current: ProjectSpec,
  patch: Partial<Omit<ProjectSpec, 'revision' | 'updatedAt'>>,
  now = Date.now(),
): ProjectSpec {
  return {
    ...current,
    ...patch,
    continuityFacts: patch.continuityFacts
      ? [...patch.continuityFacts]
      : [...(current.continuityFacts ?? [])],
    forbidden: patch.forbidden ? [...patch.forbidden] : [...(current.forbidden ?? [])],
    revision: current.revision + 1,
    updatedAt: now,
  };
}
