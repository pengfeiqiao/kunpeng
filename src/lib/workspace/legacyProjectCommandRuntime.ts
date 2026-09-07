import { useWorkshopStore } from '@/stores/workshopStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import { applyWorkspaceProjectCommand } from '@/lib/workspace/runtime';
import type { ProjectCommandState } from '../projectObjects/projectCommands';
import { projectChangedProfessionalDrafts } from './professionalDraftProjection';

/** Synchronous compare-and-publish, following unifiedProjectStore's existing command publication contract. */
export function publishLegacyProjectCommand(command: (state: ProjectCommandState) => ProjectCommandState): void {
  const ws = useWorkshopStore.getState();
  const canvas = useCanvasStore.getState();
  const project = useProjectStore.getState();
  const data = ws.data;
  if (!data || ws.loading || project.switching || ws.project?.id !== data.projectId || !project.activeProjectId
    || !(data.canvasProjectId === project.activeProjectId
      || project.projects.some((item) => item.id === project.activeProjectId && item.aigcProjectId === data.projectId))) {
    throw new Error('当前画布不属于此项目，未写入修改');
  }
  const before = { workshop: data, canvas: { nodes: canvas.nodes, edges: canvas.edges } };
  const computed = command(before);
  const after = { ...computed, canvas: { ...computed.canvas,
    nodes: projectChangedProfessionalDrafts(before.workshop, computed.workshop, computed.canvas.nodes),
  } };
  if (after.workshop.projectId !== data.projectId || useProjectStore.getState().activeProjectId !== project.activeProjectId
    || useCanvasStore.getState().nodes !== canvas.nodes || useCanvasStore.getState().edges !== canvas.edges
    || !applyWorkspaceProjectCommand(data.projectId, (current) => current === data ? after.workshop : null)) {
    throw new Error('项目或画布已改变，未写入修改');
  }
  if (useProjectStore.getState().activeProjectId !== project.activeProjectId || useWorkshopStore.getState().data !== after.workshop) {
    throw new Error('业务修改发布后项目已切换，未覆盖新项目画布，请重新打开原项目核对');
  }
  useCanvasStore.setState({ nodes: after.canvas.nodes, edges: after.canvas.edges,
    selectedNodeId: after.canvas.nodes.some((node) => node.id === canvas.selectedNodeId) ? canvas.selectedNodeId : null });
}
