import type { ProjectSpec } from '../projectObjects/types.ts';

export type ProjectIntakeMode = 'idea' | 'script' | 'materials' | 'reference-video';
export type ProjectAutomationPreference = 'stage-confirm' | 'continuous';

export interface ProjectIntakeAttachment {
  path: string;
  kind: 'image' | 'video' | 'audio' | 'document' | 'unknown';
}

export interface ProjectIntakeRecord {
  brief: string;
  mode: ProjectIntakeMode;
  automation: ProjectAutomationPreference;
  attachments: ProjectIntakeAttachment[];
  createdAt: number;
}

const SCRIPT_EXTENSIONS = new Set(['md', 'txt', 'doc', 'docx', 'pdf', 'rtf']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'heic', 'heif', 'gif']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg']);

function extension(path: string): string {
  const name = path.split(/[\\/]/).pop() || '';
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index + 1).toLowerCase() : '';
}

export function classifyProjectAttachment(path: string): ProjectIntakeAttachment['kind'] {
  const ext = extension(path);
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (SCRIPT_EXTENSIONS.has(ext)) return 'document';
  return 'unknown';
}

export function inferProjectIntakeMode(
  brief: string,
  attachments: ProjectIntakeAttachment[],
): ProjectIntakeMode {
  if (attachments.some((item) => item.kind === 'video') && /参考|复刻|拉片|模仿|拆解/.test(brief)) {
    return 'reference-video';
  }
  if (attachments.some((item) => item.kind === 'document') || /剧本|脚本|分镜|文案/.test(brief)) {
    return 'script';
  }
  if (attachments.length > 0) return 'materials';
  return 'idea';
}

export function deriveProjectName(brief: string, now = new Date()): string {
  const firstLine = brief.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
  const cleaned = firstLine
    .replace(/^(?:我想|请|帮我|做一个|制作一个|创建一个|新建一个)+/g, '')
    .replace(/[，。！？!?：:].*$/, '')
    .trim();
  if (cleaned) return cleaned.slice(0, 22);
  return `短片项目 ${now.getMonth() + 1}-${now.getDate()}`;
}

export function projectSpecPatchFromIntake(
  intake: ProjectIntakeRecord,
): Partial<Omit<ProjectSpec, 'revision' | 'updatedAt'>> {
  const duration = intake.brief.match(/(\d{1,4})\s*(?:秒|s\b)/i)?.[1];
  const ratio = intake.brief.match(/(?:画幅|比例)?\s*(21:9|16:9|4:3|3:4|1:1|9:16)/i)?.[1];
  return {
    targetDurationSec: duration ? Number(duration) : undefined,
    aspectRatio: ratio,
    generationConfirmation: 'paid-only-confirm',
  };
}

export function buildProjectIntakeAgentContext(intake: ProjectIntakeRecord | undefined): string | undefined {
  if (!intake) return undefined;
  const modeLabels: Record<ProjectIntakeMode, string> = {
    idea: '一句创意',
    script: '已有剧本或文案',
    materials: '整理已有素材',
    'reference-video': '参考片拆解与复刻',
  };
  const lines = [
    '## 项目启动意图',
    `- 任务类型：${modeLabels[intake.mode]}`,
    `- 推进方式：${intake.automation === 'continuous' ? '连续推进；仅在付费生成前确认' : '逐阶段确认'}`,
    `- 用户原始要求：${intake.brief || '未填写文字，先检查所附素材'}`,
  ];
  if (intake.attachments.length > 0) {
    lines.push('- 启动素材：');
    for (const item of intake.attachments) lines.push(`  - [${item.kind}] ${item.path}`);
  }
  if (intake.mode === 'reference-video') {
    lines.push('- 工作流：先拉片拆解叙事、镜头、节奏、声音与包装，再给出元素替换清单；确认后批量复刻。不得直接复制受版权保护的具体角色或标识。');
  }
  lines.push('先读取已有项目对象再行动；所有产出写回统一项目对象，不另建脱离项目的数据副本。');
  return lines.join('\n');
}
