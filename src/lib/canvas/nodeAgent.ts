import type { Node } from 'reactflow';
import { useCanvasStore } from '@/stores/canvasStore';

export const CANVAS_NODE_AGENT_TRANSFER_EVENT = 'kunpeng-canvas-node-agent-transfer';

export interface CanvasNodeAgentTransferItem {
  nodeId: string;
  nodeType: string;
  typeLabel: string;
  label: string;
  previewUrl?: string;
  statusLabel: string;
}

export interface CanvasNodeAgentTransferDetail {
  items: CanvasNodeAgentTransferItem[];
}

const NODE_TYPE_LABELS: Record<string, string> = {
  text: '文本节点',
  image: '图片节点',
  video: '视频节点',
  audio: '音频节点',
  panorama: '3D 世界节点',
  group: '分组节点',
};

export function canvasNodeTypeLabel(type?: string): string {
  return NODE_TYPE_LABELS[type || ''] || '画布节点';
}

export function canvasNodeDisplayLabel(node: Node): string {
  const data = node.data as Record<string, unknown> | undefined;
  const candidates = [
    data?.title,
    data?.fileName,
    data?.name,
    data?.description,
    data?.generatedContent,
  ];
  const value = candidates.find((item) => typeof item === 'string' && item.trim()) as string | undefined;
  return value?.trim().slice(0, 28) || canvasNodeTypeLabel(node.type);
}

export function canvasNodePreviewUrl(node: Node): string | undefined {
  const data = node.data as Record<string, unknown> | undefined;
  const directCandidates = [
    data?.generatedImageUrl,
    data?.referenceImage,
    data?.imageUrl,
    data?.poster,
    data?.thumbnail,
    data?.coverUrl,
  ];
  const direct = directCandidates.find((item) => typeof item === 'string' && item.trim()) as string | undefined;
  if (direct) return direct;

  const referenceImages = data?.referenceImages;
  if (Array.isArray(referenceImages)) {
    const first = referenceImages.find((item) => {
      if (typeof item === 'string') return item.trim();
      return item && typeof item === 'object' && typeof (item as { url?: unknown }).url === 'string';
    });
    if (typeof first === 'string') return first;
    if (first && typeof first === 'object') return (first as { url?: string }).url;
  }
  return undefined;
}

export function canvasNodeStatusLabel(node: Node): string {
  const data = node.data as Record<string, unknown> | undefined;
  if (data?.isGenerating) return '生成中';
  if (node.type === 'image') {
    return data?.generatedImageUrl || data?.referenceImage ? '图片已就绪' : '等待生成';
  }
  if (node.type === 'video') {
    return data?.generatedVideoUrl || data?.localPath ? '视频已就绪' : '等待生成';
  }
  if (node.type === 'audio') {
    return data?.audioUrl || data?.localPath ? '音频已就绪' : '等待添加';
  }
  if (node.type === 'text') {
    return data?.generatedContent || data?.description ? '内容可编辑' : '空白文本';
  }
  if (node.type === 'panorama') {
    return data?.panoramaUrl || data?.generatedImageUrl ? '场景已就绪' : '等待生成';
  }
  if (node.type === 'group') return '分组可编辑';
  return '可由 Agent 操作';
}

export function openCanvasNodesInAgent(nodeIds: string[]): void {
  const store = useCanvasStore.getState();
  const uniqueIds = [...new Set(nodeIds)];
  const nodes = uniqueIds
    .map((nodeId) => store.nodes.find((item) => item.id === nodeId))
    .filter((node): node is Node => Boolean(node));
  if (nodes.length === 0) return;

  store.setSelectedNodeId(nodes[0].id);
  store.triggerAgentAction(
    nodes.length === 1 ? 'agent-focus-node' : 'agent-focus-nodes',
    nodes[0].id,
    undefined,
    nodes.map((node) => node.id),
  );

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<CanvasNodeAgentTransferDetail>(
      CANVAS_NODE_AGENT_TRANSFER_EVENT,
      {
        detail: {
          items: nodes.map((node) => ({
            nodeId: node.id,
            nodeType: node.type || 'text',
            typeLabel: canvasNodeTypeLabel(node.type),
            label: canvasNodeDisplayLabel(node),
            previewUrl: canvasNodePreviewUrl(node),
            statusLabel: canvasNodeStatusLabel(node),
          })),
        },
      },
    ));
  }
}

export function openCanvasNodeInAgent(nodeId: string): void {
  openCanvasNodesInAgent([nodeId]);
}
