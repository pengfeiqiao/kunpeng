import type { ProjectViewState } from './types.ts';
import { normalizeWorkspaceLayoutWidths } from '../workspace/layoutWidths.ts';

export function patchProjectViewState(
  current: ProjectViewState | undefined,
  patch: Partial<ProjectViewState>,
): ProjectViewState {
  return {
    ...(current ?? {}),
    ...patch,
    workspaceLayoutWidths: patch.workspaceLayoutWidths !== undefined
      ? normalizeWorkspaceLayoutWidths(patch.workspaceLayoutWidths)
      : current?.workspaceLayoutWidths ? normalizeWorkspaceLayoutWidths(current.workspaceLayoutWidths) : undefined,
    selectedObjectIds: patch.selectedObjectIds
      ? [...patch.selectedObjectIds]
      : current?.selectedObjectIds,
    conversationReferences: patch.conversationReferences
      ? patch.conversationReferences.map((item) => ({ ...item }))
      : current?.conversationReferences?.map((item) => ({ ...item })),
  };
}

export function selectedShotNoFromViewState(
  state: ProjectViewState | undefined,
  shots: Array<{ id?: string; shotNo: string }>,
): string | undefined {
  const selected = state?.selectedShotId;
  if (!selected) return undefined;
  return shots.find((shot) => shot.id === selected || shot.shotNo === selected)?.shotNo;
}
