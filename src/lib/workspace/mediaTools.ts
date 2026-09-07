import type { WorkshopData } from '../workshop/types.ts';
import type { MediaFileRecord } from '../projectObjects/types.ts';
import type { WorkspaceDraft, WorkspaceOutputType } from './types.ts';

export interface WorkspaceMediaTool {
  id: string;
  label: string;
  /** canvasGen 引擎 id（与画布工具栏同一套执行通道） */
  engineId: string;
  outputType: WorkspaceOutputType;
  /** true=直接生成（走草稿+确认链）；false=打开编辑器让用户改指令再生成 */
  autoRun: boolean;
  instruction?: string;
  params?: Record<string, string | number | boolean>;
}

export const WORKSPACE_IMAGE_TOOLS: WorkspaceMediaTool[] = [
  { id: 'upscale', label: '高清放大', engineId: 'topaz-upscale', outputType: 'image', autoRun: true, instruction: 'upscale' },
  { id: 'matting', label: '抠图去底', engineId: 'gpt-image-2', outputType: 'image', autoRun: true,
    instruction: '精确抠出画面主体，背景替换为纯白色，主体边缘干净自然，保留毛发等细节。' },
  { id: 'expand', label: '智能扩图', engineId: 'gpt-image-2', outputType: 'image', autoRun: false,
    instruction: '将画面向四周智能扩展约 50%，新区域与原图风格、光线、纹理无缝衔接，原图内容保持完全不变。' },
  { id: 'inpaint', label: '局部重绘', engineId: 'gpt-image-2', outputType: 'image', autoRun: false,
    instruction: '将画面中的【描述要改的部分】替换为【描述新内容】，其余区域保持与原图完全一致。' },
  { id: 'erase', label: '擦除物体', engineId: 'gpt-image-2', outputType: 'image', autoRun: false,
    instruction: '移除画面中的【描述要移除的物体】，用与周围环境一致的背景自然填补，其余内容保持完全不变。' },
];

export const WORKSPACE_VIDEO_TOOLS: WorkspaceMediaTool[] = [
  { id: 'upscale', label: '高清超分', engineId: 'video-upscaler', outputType: 'video', autoRun: true,
    instruction: 'upscale', params: { targetResolution: '720p' } },
  { id: 'fps', label: '帧率增强', engineId: 'video-fps-increaser', outputType: 'video', autoRun: true, instruction: 'increase fps' },
  { id: 'vocal', label: '人声分离', engineId: 'extract-vocal', outputType: 'audio', autoRun: true, instruction: 'extract vocal' },
];

export function workspaceMediaTools(mediaType: string): WorkspaceMediaTool[] {
  return mediaType === 'image' ? WORKSPACE_IMAGE_TOOLS : mediaType === 'video' ? WORKSPACE_VIDEO_TOOLS : [];
}

/** Build a tool draft bound to the current media as its only reference. Never mutates the source media. */
export function workspaceMediaToolDraft(data: WorkshopData, media: MediaFileRecord,
  tool: WorkspaceMediaTool, now = Date.now()): WorkspaceDraft | null {
  if (!data.projectObjects || media.archived || !media.path) return null;
  const owner = data.projectObjects.objects.find((item) => item.id === (media.ownerObjectId ?? media.id) && !item.archived);
  if (!owner || owner.locked) return null;
  return {
    id: `tool:${tool.id}:${media.id}`,
    projectId: data.projectId,
    objectId: owner.id,
    outputType: tool.outputType,
    prompt: tool.instruction ?? '',
    engineId: tool.engineId,
    params: { ...(tool.params ?? {}) },
    references: [{ id: media.id, type: media.mediaType as WorkspaceDraft['references'][number]['type'], path: media.path,
      label: media.label ?? `${owner.label ?? '媒体'} v`, objectId: owner.id, versionId: media.versionObjectId }],
    revision: 0,
    updatedAt: now,
  };
}
