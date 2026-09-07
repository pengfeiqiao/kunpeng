import type { Node } from 'reactflow';

export interface WorkspaceObjectPosition { x: number; y: number; pending: boolean; hidden?: boolean }
export interface WorkspaceCanvasLayout {
  schemaVersion: 1;
  projectId: string;
  positions: Record<string, WorkspaceObjectPosition>;
  nextSlot: number;
  viewport?: { x: number; y: number; zoom: number };
}

const LAYOUT_TYPE = 'workspace-layout';
export const workspaceLayoutNodeId = (projectId: string) => `workspace-layout:${encodeURIComponent(projectId)}`;
export const isWorkspaceLayoutNode = (node: Pick<Node, 'type'>) => node.type === LAYOUT_TYPE;

export function canWriteWorkspaceCanvasLayout(projectId: string, identity: {
  workshopProjectId?: string; workshopCanvasProjectId?: string; activeCanvasId: string | null;
  linkedProjectId?: string; activeUnifiedId: string | null; switching: boolean;
}): boolean {
  return Boolean(projectId && identity.activeCanvasId && !identity.switching
    && identity.workshopProjectId === projectId && identity.activeUnifiedId === projectId
    && (identity.workshopCanvasProjectId === identity.activeCanvasId || identity.linkedProjectId === projectId));
}

/** A hidden layout-only record keeps canvas.json and existing snapshots backward readable. */
export function readWorkspaceCanvasLayout(nodes: Node[], projectId: string): WorkspaceCanvasLayout {
  const raw = nodes.find((node) => node.id === workspaceLayoutNodeId(projectId) && isWorkspaceLayoutNode(node))?.data?.workspaceLayout as WorkspaceCanvasLayout | undefined;
  const empty: WorkspaceCanvasLayout = { schemaVersion: 1, projectId, positions: {}, nextSlot: 0 };
  if (!raw || raw.schemaVersion !== 1 || raw.projectId !== projectId) return empty;
  const positions = Object.fromEntries(Object.entries(raw.positions ?? {}).filter(([, value]) => value
    && Number.isFinite(value.x) && Number.isFinite(value.y)).map(([id, value]) => [id,
    { x: value.x, y: value.y, pending: value.pending !== false, ...(value.hidden ? { hidden: true } : {}) }]));
  const viewport = raw.viewport && Number.isFinite(raw.viewport.x) && Number.isFinite(raw.viewport.y)
    && Number.isFinite(raw.viewport.zoom) && raw.viewport.zoom >= 0.15 && raw.viewport.zoom <= 2 ? raw.viewport : undefined;
  return { ...empty, positions, nextSlot: Math.max(Object.keys(positions).length, Number.isSafeInteger(raw.nextSlot) ? raw.nextSlot : 0), ...(viewport ? { viewport } : {}) };
}

export function reconcileWorkspaceCanvasLayout(layout: WorkspaceCanvasLayout, objectIds: string[]): WorkspaceCanvasLayout {
  const missing = objectIds.filter((id, index) => !layout.positions[id] && objectIds.indexOf(id) === index);
  if (!missing.length) return layout;
  const positions = { ...layout.positions };
  let slot = layout.nextSlot;
  for (const id of missing) {
    positions[id] = { x: (slot % 3) * 300, y: Math.floor(slot / 3) * 280 + 56, pending: true };
    slot++;
  }
  return { ...layout, positions, nextSlot: slot };
}

export function moveWorkspaceObject(layout: WorkspaceCanvasLayout, objectId: string, position: { x: number; y: number }): WorkspaceCanvasLayout {
  if (!layout.positions[objectId] || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return layout;
  return { ...layout, positions: { ...layout.positions, [objectId]: { ...position, pending: false } } };
}

export function writeWorkspaceCanvasLayout(nodes: Node[], layout: WorkspaceCanvasLayout): Node[] {
  const id = workspaceLayoutNodeId(layout.projectId);
  const existing = nodes.find((node) => node.id === id);
  if (existing && !isWorkspaceLayoutNode(existing)) return nodes;
  if (existing && JSON.stringify(existing.data.workspaceLayout) === JSON.stringify(layout)) return nodes;
  const record: Node = { id, type: LAYOUT_TYPE, position: { x: 0, y: 0 }, hidden: true,
    draggable: false, selectable: false, connectable: false, deletable: false, data: { workspaceLayout: layout } };
  return existing ? nodes.map((node) => node.id === id ? record : node) : [...nodes, record];
}
