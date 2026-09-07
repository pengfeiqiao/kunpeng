import type { Edge, Node } from 'reactflow';

function nodeImageUrl(node: Node | undefined): string {
  const data = node?.data as Record<string, unknown> | undefined;
  return String(data?.generatedImageUrl ?? data?.referenceImage ?? '');
}

function numericNodeWidth(node: Node): number {
  const value = node.width ?? node.style?.width ?? 240;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : 240;
}

export function computePendingCanvasPositions(
  nodes: Node[],
  count: number,
): { x: number; y: number }[] {
  const rootNodes = nodes.filter((node) => !node.parentNode);
  const maxRight = rootNodes.reduce((max, node) => (
    Math.max(max, node.position.x + numericNodeWidth(node))
  ), 0);
  const startX = rootNodes.length > 0 ? maxRight + 96 : 80;
  const startY = rootNodes.length > 0
    ? Math.min(...rootNodes.map((node) => node.position.y))
    : 80;
  return Array.from({ length: count }, (_, index) => ({
    x: startX + (index % 3) * 280,
    y: startY + Math.floor(index / 3) * 220,
  }));
}

export function applySelectedProjectVersion(
  nodes: Node[],
  input: {
    ownerObjectId: string;
    mediaObjectId: string;
    versionObjectId: string;
    path: string;
    mediaType: 'image' | 'video' | 'audio' | 'document' | 'unknown';
  },
): Node[] {
  return nodes.map((node) => {
    const data = node.data as Record<string, unknown> | undefined;
    if (data?.projectObjectId !== input.ownerObjectId) return node;
    if (node.type !== input.mediaType) return node;
    // Candidate/history nodes are immutable media views, not an owner's current-version slot.
    if (data.mediaObjectId && data.mediaPurpose !== 'current-version') return node;
    const mediaPatch = input.mediaType === 'video'
      ? { generatedVideoUrl: input.path, localPath: input.path }
      : input.mediaType === 'image'
        ? { generatedImageUrl: input.path, localPath: input.path }
        : input.mediaType === 'audio'
          ? { audioUrl: input.path, localPath: input.path }
          : {};
    return {
      ...node,
      data: {
        ...data,
        ...mediaPatch,
        mediaObjectId: input.mediaObjectId,
        versionObjectId: input.versionObjectId,
        mediaPurpose: 'current-version',
      },
    };
  });
}

/** Remove only references owned by workshop sync; preserve user edges/output. */
export function pruneManagedShotReferences(
  nodes: Node[],
  edges: Edge[],
  videoNodeId: string,
): { nodes: Node[]; edges: Edge[] } {
  const syntheticIds = new Set(nodes.filter((node) => {
    const data = node.data as Record<string, unknown> | undefined;
    return data?.workshopPromptRefTarget === videoNodeId;
  }).map((node) => node.id));
  const managedSourceIds = new Set(edges.filter((edge) => (
    edge.target === videoNodeId
    && (edge.data as { relation?: unknown } | undefined)?.relation === 'workshop-reference'
  )).map((edge) => edge.source));
  syntheticIds.forEach((id) => managedSourceIds.add(id));
  const managedUrls = new Set([...managedSourceIds].map((id) => (
    nodeImageUrl(nodes.find((node) => node.id === id))
  )).filter(Boolean));

  const nextNodes = nodes.filter((node) => !syntheticIds.has(node.id));
  const nextEdges = edges.filter((edge) => (
    !syntheticIds.has(edge.source)
    && !syntheticIds.has(edge.target)
    && !(edge.target === videoNodeId
      && (edge.data as { relation?: unknown } | undefined)?.relation === 'workshop-reference')
  ));
  const retainedIncomingUrls = new Set(nextEdges
    .filter((edge) => edge.target === videoNodeId)
    .map((edge) => nodeImageUrl(nextNodes.find((node) => node.id === edge.source)))
    .filter(Boolean));

  return {
    edges: nextEdges,
    nodes: nextNodes.map((node) => {
      if (node.id !== videoNodeId || managedUrls.size === 0) return node;
      const data = node.data as Record<string, unknown>;
      const refs = (data.referenceImages as { url: string; name?: string }[] | undefined) ?? [];
      return {
        ...node,
        data: {
          ...data,
          referenceImages: refs.filter((ref) => (
            !managedUrls.has(ref.url) || retainedIncomingUrls.has(ref.url)
          )),
        },
      };
    }),
  };
}
