import type {
  ProjectConversationReference,
  ProjectConversationReferenceScope,
} from './types.ts';

export const MAX_PROJECT_CONVERSATION_REFERENCES = 24;
export const PROJECT_AGENT_CONTEXT_EVENT = 'kunpeng-project-agent-context';

export interface ProjectAgentContextEventDetail {
  references: ProjectConversationReference[];
  open?: boolean;
}

function referenceIdentity(reference: Pick<ProjectConversationReference, 'objectId' | 'sourceId'>): string {
  return `${reference.objectId}\u0000${reference.sourceId ?? ''}`;
}

export function mergeProjectConversationReferences(
  current: ProjectConversationReference[] | undefined,
  incoming: ProjectConversationReference[],
): ProjectConversationReference[] {
  const byIdentity = new Map<string, ProjectConversationReference>();
  for (const item of current ?? []) byIdentity.set(referenceIdentity(item), { ...item });
  for (const item of incoming) {
    const key = referenceIdentity(item);
    const previous = byIdentity.get(key);
    byIdentity.set(key, {
      ...previous,
      ...item,
      id: previous?.id ?? item.id,
      addedAt: item.addedAt,
    });
  }
  return [...byIdentity.values()]
    .sort((a, b) => b.addedAt - a.addedAt)
    .slice(0, MAX_PROJECT_CONVERSATION_REFERENCES);
}

export function removeProjectConversationReference(
  current: ProjectConversationReference[] | undefined,
  id: string,
): ProjectConversationReference[] {
  return (current ?? []).filter((item) => item.id !== id).map((item) => ({ ...item }));
}

export function buildProjectConversationReferenceContext(
  references: ProjectConversationReference[] | undefined,
): string {
  if (!references?.length) return '';
  const lines = references.map((item, index) => {
    const version = item.version ? `，版本 v${item.version}` : '';
    const owner = item.ownerLabel ? `，所属 ${item.ownerLabel}` : '';
    const source = item.sourceId ? `，来源 ID=${item.sourceId}` : '';
    const quote = item.quotedText ? `，选中文字=${JSON.stringify(item.quotedText)}` : '';
    return `${index + 1}. ${item.label}（类型 ${item.kind}，对象 ID=${item.objectId}${source}${owner}${version}，操作范围 ${item.operationScope}${quote}）`;
  });
  return `\n当前用户已添加到对话的项目对象如下。必须按稳定对象 ID 读取最新内容，不能把缩略图、标签或旧版本快照当作主数据；“这个/这些素材”默认指这些对象：\n${lines.join('\n')}`;
}

export function createProjectConversationReference(input: {
  objectId: string;
  kind: ProjectConversationReference['kind'];
  sourceView: ProjectConversationReference['sourceView'];
  sourceId?: string;
  label: string;
  ownerLabel?: string;
  version?: number;
  operationScope?: ProjectConversationReferenceScope;
  thumbnailPath?: string;
  quotedText?: string;
  now?: number;
}): ProjectConversationReference {
  const now = input.now ?? Date.now();
  return {
    id: `conversation-ref:${input.sourceView}:${input.objectId}:${input.sourceId ?? 'root'}`,
    objectId: input.objectId,
    kind: input.kind,
    sourceView: input.sourceView,
    sourceId: input.sourceId,
    label: input.label,
    ownerLabel: input.ownerLabel,
    version: input.version,
    operationScope: input.operationScope ?? 'edit',
    thumbnailPath: input.thumbnailPath,
    quotedText: input.quotedText,
    addedAt: now,
  };
}

export function dispatchProjectAgentContext(
  references: ProjectConversationReference | ProjectConversationReference[],
  open = true,
): void {
  window.dispatchEvent(new CustomEvent<ProjectAgentContextEventDetail>(PROJECT_AGENT_CONTEXT_EVENT, {
    detail: { references: Array.isArray(references) ? references : [references], open },
  }));
}
