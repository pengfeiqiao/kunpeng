interface CanvasTaskIdentity { id: string; nodeId: string; canvasProjectId?: string }
/** Old tasks lack a project identity; a newer task for the same node still supersedes them. */
export function isLatestCanvasTask(task: CanvasTaskIdentity, tasks: readonly CanvasTaskIdentity[], activeProjectId: string | null): boolean {
  if (task.canvasProjectId && task.canvasProjectId !== activeProjectId) return false;
  for (let i = tasks.length - 1; i >= 0; i--) {
    const next = tasks[i];
    if (next.nodeId === task.nodeId && (!next.canvasProjectId || !task.canvasProjectId || next.canvasProjectId === task.canvasProjectId)) return next.id === task.id;
  }
  return false;
}
