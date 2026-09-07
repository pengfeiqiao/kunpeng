import type { Message } from '../../types/index.ts';
import type { UnifiedProjectRegistry } from '../../lib/projectObjects/types.ts';

export const WORKSPACE_ASSISTANT_INSPECT_EVENT = 'kunpeng-workspace-assistant-inspect';
export interface WorkspaceAssistantInspectDetail {
  version: 1;
  source: 'assistant';
  projectId: string;
  messageId: string;
  objectId: string;
  mediaId: string;
  versionId?: string;
  outputType: 'image' | 'video' | 'audio';
}

/** Only structured successful tool receipts count. Prose and file-name guesses do not. */
export function assistantResultMedia(message: Message, registry?: UnifiedProjectRegistry) {
  if (!registry || !Array.isArray(message.metadata?.toolExecutions)) return [];
  const identities = new Set<string>();
  const visit = (value: unknown, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 12) return;
    if (Array.isArray(value)) { value.forEach((item) => visit(item, depth + 1)); return; }
    for (const [key, field] of Object.entries(value)) {
      if (['id', 'mediaId', 'media_id', 'mediaObjectId', 'path', 'imagePath', 'videoPath', 'audioPath', 'output_path'].includes(key) && typeof field === 'string') identities.add(field);
      if (['mediaIds', 'media_ids', 'paths'].includes(key) && Array.isArray(field)) field.forEach((entry) => { if (typeof entry === 'string') identities.add(entry); });
      visit(field, depth + 1);
    }
  };
  for (const execution of message.metadata.toolExecutions) {
    if (execution?.status !== 'completed' || execution?.result?.success !== true || typeof execution.result.output !== 'string') continue;
    try { visit(JSON.parse(execution.result.output)); } catch { /* Unstructured output stays in message details. */ }
  }
  return registry.media.filter((media) => media.projectId === registry.projectId && !media.archived && media.purpose !== 'historical'
    && ['image', 'video', 'audio'].includes(media.mediaType) && (identities.has(media.id) || identities.has(media.path)));
}

export function assistantFieldLabel(field: string) {
  const labels: Record<string, string> = { prompt: '提示词', videoPrompt: '视频提示词', imagePrompt: '图片提示词',
    description: '镜头描述', dialogue: '对白', label: '名称', purpose: '用途', selected: '采用版本',
    ownerObjectId: '归属', imagePath: '采用图片', videoPath: '采用视频' };
  return labels[field] ?? '字段';
}

export function assistantPromptChanges(message: Message, projectId?: string) {
  const changes = new Map<string, { objectId: string; outputType: string; revision: number }>();
  if (!projectId || !Array.isArray(message.metadata?.toolExecutions)) return [];
  for (const execution of message.metadata.toolExecutions) {
    if (execution?.toolName !== 'project_update_generation_prompt' || execution.status !== 'completed' || execution.result?.success !== true) continue;
    try {
      const receipt = JSON.parse(execution.result.output);
      if (receipt.projectId !== projectId || typeof receipt.objectId !== 'string' || !Number.isInteger(receipt.revision)
        || !['image', 'video'].includes(receipt.outputType) || !Array.isArray(receipt.changed) || !receipt.changed.includes('prompt')) continue;
      changes.set(`${receipt.objectId}:${receipt.outputType}`, receipt);
    } catch { /* No structured receipt, no field-change claim. */ }
  }
  return [...changes.values()];
}
