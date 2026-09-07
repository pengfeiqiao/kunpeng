import { useCallback, useMemo } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import { useWorkshopStore } from '@/stores/workshopStore';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';
import { canWriteWorkspaceCanvasLayout, readWorkspaceCanvasLayout, writeWorkspaceCanvasLayout, workspaceLayoutNodeId, type WorkspaceCanvasLayout } from './canvasLayout';

export function useWorkspaceCanvasLayout(projectId: string) {
  const record = useCanvasStore((state) => state.nodes.find((node) => node.id === workspaceLayoutNodeId(projectId)));
  const save = useCallback((layout: WorkspaceCanvasLayout) => {
    const workshop = useWorkshopStore.getState().data;
    const canvas = useProjectStore.getState();
    const linked = canvas.projects.find((item) => item.id === canvas.activeProjectId);
    if (layout.projectId !== projectId || !canWriteWorkspaceCanvasLayout(projectId, {
      workshopProjectId: workshop?.projectId, workshopCanvasProjectId: workshop?.canvasProjectId,
      activeCanvasId: canvas.activeProjectId, linkedProjectId: linked?.aigcProjectId,
      activeUnifiedId: useUnifiedProjectStore.getState().activeId, switching: canvas.switching,
    })) return false;
    const state = useCanvasStore.getState();
    const nodes = writeWorkspaceCanvasLayout(state.nodes, layout);
    if (nodes !== state.nodes) state.setNodes(nodes);
    return true;
  }, [projectId]);
  const layout = useMemo(() => readWorkspaceCanvasLayout(record ? [record] : [], projectId), [record, projectId]);
  return { layout, save };
}
