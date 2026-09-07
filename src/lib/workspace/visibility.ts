import type { WorkshopData } from '../workshop/types.ts';
import type { WorkspaceCanvasLayout } from './canvasLayout.ts';

/** View visibility never changes ownership, reference order, versions or media files. */
export function setWorkspaceListVisibility(data: WorkshopData, objectId: string, visible: boolean): WorkshopData {
  const hidden = data.projectViewState?.workspaceHiddenObjectIds ?? [];
  const next = visible ? hidden.filter((id) => id !== objectId) : [...new Set([...hidden, objectId])];
  if (next.length === hidden.length && next.every((id, i) => id === hidden[i])) return data;
  return { ...data, projectViewState: { ...data.projectViewState, workspaceHiddenObjectIds: next } };
}

export function setWorkspaceCanvasVisibility(layout: WorkspaceCanvasLayout, objectId: string, visible: boolean): WorkspaceCanvasLayout {
  const position = layout.positions[objectId];
  if (!position || Boolean(position.hidden) === !visible) return layout;
  return { ...layout, positions: { ...layout.positions, [objectId]: { ...position, hidden: !visible } } };
}
