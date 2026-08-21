/**
 * grouping — Ctrl+G group / ungroup via reactflow's native parentNode.
 *
 * Invariant: a group node MUST precede its children in the nodes array
 * (reactflow resolves parent positions top-down). normalizeOrder() enforces
 * this and is shared with paste/undo replay.
 */
import type { Node } from 'reactflow';
import { nanoid } from 'nanoid';
import { useCanvasStore } from '@/stores/canvasStore';
import { captureSnapshot } from './history';

const GROUP_PADDING = 24;

/** Group nodes first, children after — stable otherwise. */
export function normalizeOrder(nodes: Node[]): Node[] {
  const groups = nodes.filter((n) => n.type === 'group');
  if (groups.length === 0) return nodes;
  const rest = nodes.filter((n) => n.type !== 'group');
  return [...groups, ...rest];
}

/** Group all currently selected (non-group) nodes. Returns group id or null. */
export function groupSelection(): string | null {
  const { nodes } = useCanvasStore.getState();
  const selected = nodes.filter((n) => n.selected && n.type !== 'group' && !n.parentNode);
  if (selected.length < 2) return null;
  captureSnapshot();

  // Bounding box in absolute coordinates
  const xs = selected.map((n) => n.position.x);
  const ys = selected.map((n) => n.position.y);
  const x2 = selected.map((n) => n.position.x + ((n.style?.width as number) || n.width || 280));
  const y2 = selected.map((n) => n.position.y + ((n.style?.height as number) || n.height || 200));
  const minX = Math.min(...xs) - GROUP_PADDING;
  const minY = Math.min(...ys) - GROUP_PADDING;
  const maxX = Math.max(...x2) + GROUP_PADDING;
  const maxY = Math.max(...y2) + GROUP_PADDING;

  const groupId = `group-${nanoid(8)}`;
  const groupNode: Node = {
    id: groupId,
    type: 'group',
    position: { x: minX, y: minY },
    style: { width: maxX - minX, height: maxY - minY },
    data: { label: '' },
    selected: false,
  };

  const ids = new Set(selected.map((n) => n.id));
  const updated = nodes.map((n) =>
    ids.has(n.id)
      ? {
          ...n,
          parentNode: groupId,
          position: { x: n.position.x - minX, y: n.position.y - minY },
          selected: false,
        }
      : n,
  );

  useCanvasStore.setState({ nodes: normalizeOrder([groupNode, ...updated]) });
  return groupId;
}

/** Ungroup: dissolve selected group nodes (or groups containing selected children). */
export function ungroupSelection(): number {
  const { nodes } = useCanvasStore.getState();
  const groupIds = new Set<string>();
  for (const n of nodes) {
    if (n.selected && n.type === 'group') groupIds.add(n.id);
    if (n.selected && n.parentNode) groupIds.add(n.parentNode);
  }
  if (groupIds.size === 0) return 0;
  captureSnapshot();

  const groupPos = new Map<string, { x: number; y: number }>();
  for (const id of groupIds) {
    const g = nodes.find((n) => n.id === id);
    if (g) groupPos.set(id, g.position);
  }

  const updated = nodes
    .filter((n) => !groupIds.has(n.id))
    .map((n) => {
      if (n.parentNode && groupIds.has(n.parentNode)) {
        const gp = groupPos.get(n.parentNode)!;
        return {
          ...n,
          parentNode: undefined,
          position: { x: n.position.x + gp.x, y: n.position.y + gp.y },
        };
      }
      return n;
    });

  useCanvasStore.setState({ nodes: updated });
  return groupIds.size;
}
