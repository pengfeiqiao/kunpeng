import type { Node } from 'reactflow';
import { publishLegacyProjectCommand } from './legacyProjectCommandRuntime';
import { assetUrlToLocalPath } from '../canvas/imageSource';
import { editProfessionalCanvasCommand, isProfessionalCanvasEdit } from './professionalCanvasEdits';
import { assignProfessionalCanvasMediaCommand, type ProfessionalCanvasAssignment } from './professionalCanvasOwnership';

/** Synchronous store ingress. A rejection throws; it never authorizes the legacy fallback. */
export function updateProfessionalCanvasNode(node: Node, patch: Record<string, unknown>): boolean {
  if (!isProfessionalCanvasEdit(node, patch)) return false;
  publishLegacyProjectCommand((state) => {
    if (state.canvas.nodes.find((item) => item.id === node.id) !== node) throw new Error('专业节点已改变，未修改');
    return editProfessionalCanvasCommand(state, node.id, patch);
  });
  return true;
}

/** UI replacement for applyWorkspaceProjectCommand(...assignUnclassifiedMedia). Does not retry on errors. */
export function assignProfessionalCanvasMedia(projectId: string, input: ProfessionalCanvasAssignment): void {
  publishLegacyProjectCommand((state) => {
    if (state.workshop.projectId !== projectId) throw new Error('项目已切换，归类未写入');
    return assignProfessionalCanvasMediaCommand(state, input, Date.now(), (path) => assetUrlToLocalPath(path) ?? path);
  });
}
