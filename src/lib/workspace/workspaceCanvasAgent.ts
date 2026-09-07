import type { Node, Edge } from 'reactflow';
import type { WorkshopData } from '../workshop/types.ts';
import type { AssistantTarget } from './projectAssistantQueue.ts';
import { buildCanvasContext } from '../canvas/canvasAgentPrompt.ts';
import { createProjectConversationReference, buildProjectConversationReferenceContext } from '../projectObjects/conversationRefs.ts';

/** Resolve explicit identities only; a matching file path never establishes ownership. */
export function workspaceBindingForNode(node: Node, data: WorkshopData) {
  const registry = data.projectObjects;
  const ref = node.data.workshopRef;
  if (!registry || (registry.projectId && registry.projectId !== data.projectId)
    || node.data.workshopPromptRefTarget || ref?.role === 'prompt-reference'
    || (ref?.projectId && ref.projectId !== data.projectId)) return null;
  const consistentId = (a?: string, b?: string) => a && b && a !== b ? null : a ?? b;
  const ownerId = consistentId(node.data.projectObjectId, ref?.objectId);
  const mediaId = consistentId(node.data.mediaObjectId, ref?.mediaObjectId);
  const versionId = consistentId(node.data.versionObjectId, ref?.versionObjectId);
  if (ownerId === null || mediaId === null || versionId === null) return null;
  const version = versionId ? registry.versions.find((item) => item.id === versionId && !item.archived) : undefined;
  const media = registry.media.find((item) => item.id === (mediaId ?? version?.mediaObjectId) && !item.archived);
  if ((versionId && !version) || (mediaId && !media) || (version && media?.id !== version.mediaObjectId)) return null;
  if (version && (version.projectId !== data.projectId || (media?.versionObjectId && media.versionObjectId !== version.id))) return null;
  if (media?.versionObjectId && !registry.versions.some((item) => item.id === media.versionObjectId && !item.archived
    && item.projectId === data.projectId && item.mediaObjectId === media.id && item.ownerObjectId === media.ownerObjectId)) return null;
  if (media && (media.projectId !== data.projectId || media.mediaType !== node.type)) return null;
  const legacyKind = ref?.kind === 'colorPalette' ? 'scene-asset' : ref?.kind;
  const legacySourceId = ref?.kind === 'shot'
    ? ref.shotId ?? data.shots.find((shot) => shot.shotNo === ref.id)?.id ?? ref.id : ref?.id;
  const legacyOwners = ref?.projectId === data.projectId ? registry.objects.filter((item) => !item.archived
    && item.kind === legacyKind && item.sourceId === legacySourceId) : [];
  const resolvedOwnerId = ownerId ?? version?.ownerObjectId ?? media?.ownerObjectId
    ?? (legacyOwners.length === 1 ? legacyOwners[0].id : undefined);
  if ((version && version.ownerObjectId !== resolvedOwnerId) || (media?.ownerObjectId && media.ownerObjectId !== resolvedOwnerId)) return null;
  const owner = registry.objects.find((item) => item.id === resolvedOwnerId && !item.archived);
  if (resolvedOwnerId && (!owner || owner.projectId !== data.projectId)) return null;
  const objectId = media?.mediaType === 'audio' ? media.id : owner?.id ?? media?.id;
  if (!objectId || !['image', 'video', 'audio'].includes(node.type ?? '')) return null;
  return { objectId, owner, media, outputType: node.type as 'image' | 'video' | 'audio' };
}

export interface CanvasTargetBinding {
  projectId: string;
  canvasProjectId: string;
  invalidReason?: string;
  director?: { projectId: string | null; planId: string | null };
  nodes: Array<{ id: string; fingerprint: string }>;
}
export type CanvasAssistantTarget = AssistantTarget & { canvasTarget: CanvasTargetBinding };

function fingerprint(node: Node, data: WorkshopData): string {
  const registry = data.projectObjects;
  const binding = workspaceBindingForNode(node, data);
  const hasIdentity = node.data.projectObjectId || node.data.mediaObjectId || node.data.versionObjectId || node.data.workshopRef;
  if (hasIdentity && !binding) throw new Error('画布节点绑定冲突，请重新选择对象。');
  const owner = binding?.owner;
  const media = binding?.media;
  const versionId = node.data.versionObjectId ?? node.data.workshopRef?.versionObjectId ?? media?.versionObjectId;
  const version = registry?.versions.find((item) => item.id === versionId);
  return JSON.stringify({ type: node.type, data: node.data,
    owner: owner && { id: owner.id, version: owner.version, locked: owner.locked, archived: owner.archived },
    media: media && { id: media.id, version: media.version, ownerObjectId: media.ownerObjectId, versionObjectId: media.versionObjectId, archived: media.archived },
    version: version && { id: version.id, version: version.version, mediaObjectId: version.mediaObjectId, ownerObjectId: version.ownerObjectId, archived: version.archived },
  });
}

export function canvasTargetOf(target: AssistantTarget): CanvasTargetBinding | undefined {
  return (target as Partial<CanvasAssistantTarget>).canvasTarget;
}

export function captureCanvasAssistantTarget(data: WorkshopData, canvasProjectId: string, sessionId: string | null,
  snapshot: { nodes: Node[]; edges: Edge[] }, nodeIds: string[]): CanvasAssistantTarget {
  const ids = [...new Set(nodeIds)];
  const nodes = ids.map((id) => {
    const node = snapshot.nodes.find((item) => item.id === id);
    if (!node) throw new Error('目标画布节点已不存在。');
    return node;
  });
  const references = nodes.map((node) => createProjectConversationReference({
    objectId: `canvas-node:${node.id}`, kind: 'canvas-node', sourceView: 'canvas', sourceId: node.id,
    label: String(node.data.title || node.data.description || node.id).slice(0, 28), operationScope: 'edit',
    thumbnailPath: node.data.generatedImageUrl || node.data.referenceImage,
  }));
  const contextBase = buildCanvasContext(snapshot, ids);
  return { projectId: data.projectId, sessionId, surface: 'media',
    label: nodes.length === 1 ? references[0].label : nodes.length ? `画布 · ${nodes.length} 个节点` : '画布对话',
    contextBase, context: contextBase + buildProjectConversationReferenceContext(references) + '\n\n', references,
    canvasTarget: { projectId: data.projectId, canvasProjectId, nodes: nodes.map((node) => ({ id: node.id, fingerprint: fingerprint(node, data) })) },
  };
}

export function validateCanvasAssistantTarget(target: AssistantTarget, data: WorkshopData | null | undefined,
  project: { activeProjectId: string | null; switching: boolean; projects: Array<{ id: string; aigcProjectId?: string }> },
  activeProjectId: string | null, nodes: Node[]): string | null {
  const frozen = canvasTargetOf(target);
  if (!frozen) return '旧画布消息缺少目标快照，请重新提交。';
  if (frozen.invalidReason) return frozen.invalidReason;
  if (!data || frozen.projectId !== target.projectId || activeProjectId !== target.projectId || data.projectId !== target.projectId
    || project.switching || project.activeProjectId !== frozen.canvasProjectId
    || (data.canvasProjectId && data.canvasProjectId !== frozen.canvasProjectId)) return '原画布项目已切换，消息尚未发送。';
  const record = project.projects.find((item) => item.id === frozen.canvasProjectId);
  if (record?.aigcProjectId && record.aigcProjectId !== target.projectId) return '原画布项目绑定已变化，消息尚未发送。';
  if (data.canvasProjectId !== frozen.canvasProjectId && record?.aigcProjectId !== target.projectId) {
    return '原画布项目关联已失效，消息尚未发送。';
  }
  try {
    for (const entry of frozen.nodes) {
      const node = nodes.find((item) => item.id === entry.id);
      if (!node || fingerprint(node, data) !== entry.fingerprint) return '原节点内容、版本或归属已改变，请重新选择后提交。';
    }
  } catch { return '原节点绑定已失效，消息尚未发送。'; }
  return null;
}

export function selectCanvasNodes(nodes: Node[], nodeIds: string[]) {
  const ids = new Set(nodeIds);
  return { nodes: nodes.map((node) => node.selected === ids.has(node.id) ? node : { ...node, selected: ids.has(node.id) }),
    selectedNodeId: nodeIds[0] ?? null };
}

/** Recover the exact region chosen by the existing CanvasView, never substitute the ordinary selection. */
export function readCanvasRegionRequest(prompt: string): { nodeIds: string[]; request: string } | null {
  const prefix = '[画布 AI 区域操作]\n';
  if (!prompt.startsWith(prefix)) return null;
  const body = prompt.slice(prefix.length);
  const empty = '用户在画布空白区域画了一个框。\n指令：';
  if (body.startsWith(empty)) return { nodeIds: [], request: body.slice(empty.length) };
  const match = /^用户在画布上框选了 (\d+) 个节点：([^\n]*)。\n指令：([\s\S]*)$/.exec(body);
  if (!match) throw new Error('画布框选目标格式不完整，未发送。');
  const entries = match[2].split(', ');
  const nodeIds = entries.map((entry) => {
    const item = /^(.*)\((text|image|video|audio|panorama)\)$/.exec(entry);
    if (!item) throw new Error('画布框选节点格式不完整，未发送。');
    return item[1];
  });
  if (nodeIds.length !== Number(match[1])) throw new Error('画布框选数量不一致，未发送。');
  return { nodeIds, request: match[3] };
}
