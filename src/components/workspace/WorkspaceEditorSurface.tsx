import EditorView from '@/components/editor/EditorView';
import { getEditorHydrationState } from '@/lib/editor/editorPersist';
import { useWorkspaceTimelineSource } from '@/lib/workspace/useWorkspaceTimelineSource';
import WorkspaceTimelineSource from './WorkspaceTimelineSource';

export default function WorkspaceEditorSurface({ projectId, onSendMessage, onAbort }: {
  projectId: string;
  onSendMessage: (content: string, filePaths?: string[]) => Promise<void> | void;
  onAbort: () => void;
}) {
  const source = useWorkspaceTimelineSource(projectId);
  const hydration = getEditorHydrationState();
  if (hydration.status !== 'ready' || hydration.projectId !== projectId || hydration.activeProjectId !== projectId) {
    return <p className="workspace-content-empty" role="status">剪辑项目尚未就绪，请重新打开项目后继续。</p>;
  }
  return <div className="workspace-editor-surface">
    {source && <details className="workspace-editor-source"><summary>所选片段 · 素材来源</summary><WorkspaceTimelineSource {...source} /></details>}
    <EditorView embedded onSendMessage={onSendMessage} onAbort={onAbort} />
  </div>;
}
