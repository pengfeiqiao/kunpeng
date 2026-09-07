import { useCallback, useEffect, useState } from 'react';
import { Check, List } from 'lucide-react';
import CanvasView from '@/components/canvas/CanvasView';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import { useWorkshopStore } from '@/stores/workshopStore';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';
import { useChatStore } from '@/stores';
import { useDirectorStore } from '@/stores/directorStore';
import { projectAssistantQueue as queue } from '@/stores/projectAssistantQueueStore';
import { buildWorkspaceAgentContext } from '@/lib/workspace/agentContext';
import { selectWorkspaceObject, workspaceSelection } from '@/lib/workspace/contentModel';
import { workspaceMediaVersions } from '@/lib/workspace/mediaView';
import { PROJECT_AGENT_CONTEXT_EVENT, type ProjectAgentContextEventDetail } from '@/lib/projectObjects/conversationRefs';
import { captureCanvasAssistantTarget, canvasTargetOf, workspaceBindingForNode, selectCanvasNodes, readCanvasRegionRequest, validateCanvasAssistantTarget } from '@/lib/workspace/workspaceCanvasAgent';
import { readDirectorAssistantRequest } from '@/lib/workspace/workspaceAssistantMessage';
import { buildCanvasActionPrompt } from '@/lib/canvas/canvasAgentPrompt';
import { resolveCanvasAgentMediaUrl } from '@/lib/canvas/canvasAgentMedia';
export { workspaceBindingForNode } from '@/lib/workspace/workspaceCanvasAgent';

function ownsCanvas(projectId: string, canvasProjectId: string) {
  const project = useProjectStore.getState();
  const workshop = useWorkshopStore.getState();
  return !project.switching && project.activeProjectId === canvasProjectId
    && useUnifiedProjectStore.getState().activeId === projectId
    && workshop.project?.id === projectId && workshop.data?.projectId === projectId;
}

function CanvasSurface({ projectId, canvasProjectId, onAbort }: {
  projectId: string;
  canvasProjectId: string;
  onAbort: () => void;
}) {
  const sessionId = useChatStore((state) => state.currentSessionId);
  const selectedNode = useCanvasStore((state) => state.nodes.find((node) => node.id === state.selectedNodeId));
  const data = useWorkshopStore((state) => state.data)!;
  const [notice, setNotice] = useState('');
  const binding = selectedNode ? workspaceBindingForNode(selectedNode, data) : null;
  const versions = binding ? workspaceMediaVersions(data, binding.objectId, binding.outputType) : [];
  const selectedVersion = versions.find((item) => item.media.id === binding?.media?.id);
  const captureTarget = useCallback((nodeIds: string[] = []) => {
    const current = useWorkshopStore.getState().data;
    if (!current || !ownsCanvas(projectId, canvasProjectId)) throw new Error('画布项目已切换。');
    return captureCanvasAssistantTarget(current, canvasProjectId, useChatStore.getState().currentSessionId,
      useCanvasStore.getState(), nodeIds);
  }, [projectId, canvasProjectId]);
  const openAssistant = useCallback(() => {
    useWorkshopStore.getState().updateProjectViewState({ agentDrawerState: 'expanded' });
    window.dispatchEvent(new CustomEvent('kunpeng-workspace-assistant-open'));
  }, []);
  const selectNode = useCallback((nodeId: string | null) => {
    if (!ownsCanvas(projectId, canvasProjectId)) return;
    const current = useWorkshopStore.getState().data!;
    const node = useCanvasStore.getState().nodes.find((item) => item.id === nodeId);
    const target = node && workspaceBindingForNode(node, current);
    const patch = target && selectWorkspaceObject(current, target.objectId, target.outputType);
    if (patch && target) useWorkshopStore.getState().updateProjectViewState({ ...patch,
      ...(target.media ? { workspaceMediaId: target.media.id } : {}) });
    try { queue.select(captureTarget(nodeId ? [nodeId] : [])); setNotice(''); }
    catch (error) { setNotice(error instanceof Error ? error.message : '节点绑定已改变。'); }
  }, [projectId, canvasProjectId, captureTarget]);
  useEffect(() => {
    if (!ownsCanvas(projectId, canvasProjectId) || !data.projectViewState?.workspaceObjectId) return;
    const canvas = useCanvasStore.getState();
    const matches = canvas.nodes.filter((node) => {
      const target = workspaceBindingForNode(node, data);
      return target?.objectId === data.projectViewState?.workspaceObjectId
        && (!data.projectViewState?.workspaceMediaId || target?.media?.id === data.projectViewState.workspaceMediaId);
    });
    const node = matches.find((item) => item.id === canvas.selectedNodeId) ?? (matches.length === 1 ? matches[0] : undefined);
    if (node && canvas.selectedNodeId !== node.id) {
      useCanvasStore.setState(selectCanvasNodes(canvas.nodes, [node.id]));
      try { queue.select(captureTarget([node.id])); } catch { setNotice('节点绑定已改变。'); }
    } else if (!node) {
      useCanvasStore.setState(selectCanvasNodes(canvas.nodes, []));
      queue.select(captureTarget());
      setNotice('所选项目版本没有唯一对应的画布节点。');
    }
  }, [data.projectViewState?.workspaceObjectId, data.projectViewState?.workspaceMediaId, projectId, canvasProjectId, captureTarget]);
  const sendToAssistant = useCallback((prompt: string, files?: string[]) => {
    if (!ownsCanvas(projectId, canvasProjectId)) return;
    try {
      const region = readCanvasRegionRequest(prompt);
      const director = readDirectorAssistantRequest(prompt);
      const canvas = useCanvasStore.getState();
      const ids = region?.nodeIds ?? (director ? [] : canvas.nodes.filter((node) => node.selected).map((node) => node.id));
      const target = captureTarget(ids);
      if (director) {
        const state = useDirectorStore.getState();
        target.canvasTarget.director = { projectId: state.projectId, planId: state.activePlanId };
        target.contextBase = director.context;
        target.context = director.context;
        target.label = '导演对话';
      }
      queue.select(target);
      queue.enqueue(target, region?.request ?? director?.request ?? prompt, files);
      openAssistant();
    } catch (error) { setNotice(error instanceof Error ? error.message : '目标已改变，未发送。'); }
  }, [projectId, canvasProjectId, captureTarget, openAssistant]);

  useEffect(() => {
    if (!ownsCanvas(projectId, canvasProjectId)) return;
    const previous = queue.draft(projectId, sessionId, 'media');
    const selectedId = useCanvasStore.getState().selectedNodeId;
    try { queue.select(captureTarget(selectedId ? [selectedId] : [])); }
    catch { setNotice('原节点绑定已改变，请重新选择。'); }
    return () => {
      const current = queue.draft(projectId, sessionId, 'media');
      // Restore the workshop draft without clearing any queued canvas work.
      if (!current || !canvasTargetOf(current.target)) return;
      const data = useWorkshopStore.getState().data;
      if (data?.projectId !== projectId) return;
      const selection = workspaceSelection(data);
      if (previous && previous.target.objectId === selection.selected?.id && previous.target.mediaId === selection.media?.media.id) queue.select(previous.target);
      else queue.select({ projectId, sessionId, surface: 'media', objectId: selection.selected?.id,
        mediaId: selection.media?.media.id, versionId: selection.media?.version?.id, outputType: selection.outputType,
        label: selection.selected?.label ?? '工坊对话', context: buildWorkspaceAgentContext(data) });
    };
  }, [projectId, canvasProjectId, sessionId, captureTarget]);

  useEffect(() => useChatStore.subscribe((next, previous) => {
    if (next.activeView !== 'editor' || previous.activeView !== 'workshop' || !ownsCanvas(projectId, canvasProjectId)) return;
    useWorkshopStore.getState().updateProjectViewState({ workspaceSurface: 'editor' });
    useChatStore.getState().setActiveView('workshop');
  }), [projectId, canvasProjectId]);

  useEffect(() => {
    let mounted = true;
    // A pre-mount action has no verifiable origin. Never rebind it to the newly opened project.
    if (useCanvasStore.getState().pendingAgentAction) {
      useCanvasStore.getState().clearPendingAction();
      setNotice('旧画布动作未执行，请在当前项目重新操作。');
    }
    const unsubscribe = useCanvasStore.subscribe((next, previous) => {
      const action = next.pendingAgentAction;
      if (!action || action === previous.pendingAgentAction || !ownsCanvas(projectId, canvasProjectId)) return;
      useCanvasStore.getState().clearPendingAction();
      try {
        const ids = action.nodeIds?.length ? action.nodeIds : [action.nodeId];
        const target = captureTarget(ids);
        if (action.action === 'agent-focus-node' || action.action === 'agent-focus-nodes') {
          queue.select(target); openAssistant(); return;
        }
        const node = structuredClone(next.nodes.find((item) => item.id === action.nodeId)!);
        void buildCanvasActionPrompt(node, action, resolveCanvasAgentMediaUrl).then((prompt) => {
          if (!mounted || !prompt) return;
          const reason = validateCanvasAssistantTarget(target, useWorkshopStore.getState().data,
            useProjectStore.getState(), useUnifiedProjectStore.getState().activeId, useCanvasStore.getState().nodes);
          if (reason) { setNotice(reason); return; }
          // The full legacy instruction is context; quoted source text is not story-edit authorization.
          target.contextBase += '\n原画布节点操作指令：\n' + prompt;
          target.context += '\n原画布节点操作指令：\n' + prompt;
          queue.select(target);
          queue.enqueue(target, `执行画布节点操作 ${action.action}，目标节点 ${action.nodeId}。`);
          openAssistant();
        }).catch((error) => { if (mounted) setNotice(error instanceof Error ? error.message : '画布动作准备失败。'); });
      } catch (error) { setNotice(error instanceof Error ? error.message : '节点绑定已改变。'); }
    });
    return () => { mounted = false; unsubscribe(); };
  }, [projectId, canvasProjectId, captureTarget, openAssistant]);

  useEffect(() => {
    const handler = (event: Event) => {
      if (!ownsCanvas(projectId, canvasProjectId)) return;
      const detail = (event as CustomEvent<ProjectAgentContextEventDetail>).detail;
      if (!Array.isArray(detail?.references)) return;
      const ids = detail.references.filter((reference) => reference.sourceView === 'canvas' && reference.kind === 'canvas-node')
        .flatMap((reference) => reference.sourceId ? [reference.sourceId] : []);
      if (!ids.length) return;
      try {
        const target = captureTarget(ids);
        if (!target.references?.length) return;
        queue.select(target);
        if (detail.open !== false) openAssistant();
      } catch (error) { setNotice(error instanceof Error ? error.message : '节点引用已失效。'); }
    };
    window.addEventListener(PROJECT_AGENT_CONTEXT_EVENT, handler);
    return () => window.removeEventListener(PROJECT_AGENT_CONTEXT_EVENT, handler);
  }, [projectId, canvasProjectId, captureTarget, openAssistant]);

  return <div className="workspace-canvas-surface w-full h-full min-w-0 min-h-0 relative flex flex-col">
    {notice && <p role="alert">{notice}</p>}
    {binding && <div className="workspace-canvas-selection flex items-center gap-2 px-3 py-2 shrink-0">
      <span className="truncate">{binding.owner?.label ?? binding.media?.label ?? '所选素材'}</span>
      {versions.length > 0 && <select aria-label="画布对象版本" value={selectedVersion?.media.id ?? ''} onChange={(event) => {
        if (!ownsCanvas(projectId, canvasProjectId)) return;
        const mediaId = event.target.value;
        const match = useCanvasStore.getState().nodes.find((node) => {
          const target = workspaceBindingForNode(node, useWorkshopStore.getState().data!);
          return target?.objectId === binding.objectId && target.media?.id === mediaId;
        });
        if (match) { useCanvasStore.setState(selectCanvasNodes(useCanvasStore.getState().nodes, [match.id])); selectNode(match.id); }
        else useWorkshopStore.getState().updateProjectViewState({ workspaceObjectId: binding.objectId,
          workspaceMediaId: mediaId, workspaceOutputType: binding.outputType, workspaceMediaView: 'list' });
      }}>
        {!selectedVersion && <option value="" disabled>当前节点</option>}
        {versions.map((item) => <option key={item.media.id} value={item.media.id}>v{item.ordinal}{item.adopted ? ' · 已采用' : ' · 待选'}</option>)}
      </select>}
      {selectedVersion && binding.owner && <button className="workspace-icon" aria-label="采用当前版本" title="采用当前版本"
        disabled={!selectedVersion.version || selectedVersion.adopted || binding.owner.locked} onClick={() => {
          if (!ownsCanvas(projectId, canvasProjectId) || !selectedVersion.version) return;
          const success = useUnifiedProjectStore.getState().selectProjectAssetVersion(binding.owner!.id, selectedVersion.version.id);
          setNotice(success ? '' : '版本未切换：对象已锁定或项目已改变。');
        }}><Check size={16} /></button>}
      <button className="workspace-icon" title="在工坊中查看" aria-label="在工坊中查看" onClick={() => {
        if (!ownsCanvas(projectId, canvasProjectId)) return;
        selectNode(selectedNode!.id);
        useWorkshopStore.getState().updateProjectViewState({ workspaceMediaView: 'list' });
      }}><List size={16} /></button>
    </div>}
    <div className="flex-1 min-h-0 relative">
      <CanvasView embedded onSelectNode={selectNode} onSendMessage={sendToAssistant} onAbort={onAbort} />
    </div>
  </div>;
}

export default function WorkspaceCanvasSurface({ projectId, onAbort }: { projectId: string; onAbort: () => void }) {
  const activeId = useUnifiedProjectStore((state) => state.activeId);
  const activeCanvasId = useProjectStore((state) => state.activeProjectId);
  const switching = useProjectStore((state) => state.switching);
  const canvasProject = useProjectStore((state) => state.projects.find((project) => project.id === state.activeProjectId));
  const data = useWorkshopStore((state) => state.data);
  const workshopProjectId = useWorkshopStore((state) => state.project?.id);
  const linked = activeCanvasId && (!data?.canvasProjectId || data.canvasProjectId === activeCanvasId)
    && (!canvasProject?.aigcProjectId || canvasProject.aigcProjectId === projectId)
    && (data?.canvasProjectId === activeCanvasId || canvasProject?.aigcProjectId === projectId);
  if (!activeCanvasId || switching || activeId !== projectId || data?.projectId !== projectId || workshopProjectId !== projectId || !linked) {
    return <p className="workspace-content-empty" role="status">画布项目尚未就绪，请重新打开项目后继续。</p>;
  }
  return <CanvasSurface key={activeCanvasId} projectId={projectId} canvasProjectId={activeCanvasId} onAbort={onAbort} />;
}
