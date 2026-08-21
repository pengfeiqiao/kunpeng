/**
 * clipboard — copy/paste for canvas selections.
 * Copies selected nodes plus edges whose BOTH endpoints are in the selection;
 * paste regenerates ids, offsets position, relinks internal edges, strips
 * transient fields and remaps parentNode for grouped nodes.
 */
import type { Node, Edge } from 'reactflow';
import { nanoid } from 'nanoid';
import { useCanvasStore } from '@/stores/canvasStore';
import { captureSnapshot } from './history';
import { normalizeOrder } from './grouping';
import { estimateNodeSize, findNonOverlappingOffset } from './layout';

interface ClipboardPayload { nodes: Node[]; edges: Edge[]; incomingEdges: Edge[] }

let clipboard: ClipboardPayload | null = null;
const TRANSIENT = ['isGenerating', 'justCompletedAt'];

export function copySelection(): number {
  const { nodes, edges } = useCanvasStore.getState();
  const selected = nodes.filter((n) => n.selected);
  if (selected.length === 0) return 0;
  const ids = new Set(selected.map((n) => n.id));
  const internalEdges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  const incomingEdges = edges.filter((e) => !ids.has(e.source) && ids.has(e.target));
  clipboard = {
    nodes: selected.map((n) => ({ ...n, data: { ...(n.data as Record<string, unknown>) } })),
    edges: internalEdges.map((e) => ({ ...e })),
    incomingEdges: incomingEdges.map((e) => ({ ...e })),
  };
  return selected.length;
}

export function cutSelection(): number {
  const count = copySelection();
  if (count === 0) return 0;
  captureSnapshot();
  const store = useCanvasStore.getState();
  const ids = new Set(store.nodes.filter((n) => n.selected).map((n) => n.id));
  useCanvasStore.setState({
    nodes: store.nodes.filter((n) => !ids.has(n.id)),
    edges: store.edges.filter((e) => !ids.has(e.source) && !ids.has(e.target)),
  });
  return count;
}

export function pasteClipboard(offset = 40): number {
  if (!clipboard || clipboard.nodes.length === 0) return 0;
  captureSnapshot();
  const store = useCanvasStore.getState();
  const pasteOffset = findNonOverlappingOffset(clipboard.nodes, store.nodes, offset);

  const idMap = new Map<string, string>();
  for (const n of clipboard.nodes) idMap.set(n.id, `node-${nanoid(8)}`);

  const newNodes: Node[] = clipboard.nodes.map((n) => {
    const data = { ...(n.data as Record<string, unknown>) };
    for (const f of TRANSIENT) delete data[f];
    const size = estimateNodeSize({ ...n, data });
    const nextStyle = { ...(n.style ?? {}) as Record<string, unknown>, width: size.width, height: size.height };
    return {
      ...n,
      id: idMap.get(n.id)!,
      position: { x: n.position.x + pasteOffset.x, y: n.position.y + pasteOffset.y },
      style: nextStyle,
      selected: true,
      // remap group membership when the parent was copied too; otherwise detach
      parentNode: n.parentNode && idMap.has(n.parentNode) ? idMap.get(n.parentNode) : undefined,
      data,
    };
  });
  const newEdges: Edge[] = clipboard.edges.map((e) => ({
    ...e,
    id: `e-${nanoid(8)}`,
    source: idMap.get(e.source)!,
    target: idMap.get(e.target)!,
    selected: false,
  }));

  useCanvasStore.setState({
    nodes: normalizeOrder([...store.nodes.map((n) => ({ ...n, selected: false })), ...newNodes]),
    edges: [...store.edges, ...newEdges],
  });

  for (const e of (clipboard.incomingEdges ?? [])) {
    if (store.nodes.some((n) => n.id === e.source) && idMap.has(e.target)) {
      useCanvasStore.getState().onConnect({
        source: e.source,
        target: idMap.get(e.target)!,
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
      });
    }
  }

  return newNodes.length;
}

export function duplicateSelection(): number {
  const count = copySelection();
  if (count === 0) return 0;
  return pasteClipboard(32);
}
