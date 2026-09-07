import { useEffect, useRef, useSyncExternalStore } from 'react';
import { ArrowLeft, Crosshair, X } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { useChatStore } from '@/stores';
import { useWorkshopStore } from '@/stores/workshopStore';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import { useDirectorStore } from '@/stores/directorStore';
import { useCanvasMention } from '@/hooks/useCanvasMention';
import { appendCanvasMentionUrls } from '@/lib/canvas/canvasAgentPrompt';
import { canvasTargetOf, captureCanvasAssistantTarget, validateCanvasAssistantTarget, type CanvasAssistantTarget } from '@/lib/workspace/workspaceCanvasAgent';
import { assistantTargetScope, serializeWorkspaceAssistantMessage, workspaceExecutionTarget } from '@/lib/workspace/workspaceAssistantMessage';
import { readWorkspaceMessage, workspaceScopeForView } from '@/lib/agent/workspaceMessage';
import { registerWorkspaceToolScope } from '@/lib/agent/workspaceToolScope';
import { validateProductionAssistantTarget } from '@/lib/workspace/productionSafety';
import { useRunStepStore } from '@/stores/runStepStore';
import { useAskUserStore } from '@/stores/askUserStore';
import { useToolConfirmStore } from '@/stores/toolConfirmStore';
import { projectAssistantQueue as queue } from '@/stores/projectAssistantQueueStore';
import { AssistantQueueFailure, assistantThreadKey, type AssistantTarget, type AssistantQueueItem } from '@/lib/workspace/projectAssistantQueue';
import { buildWorkspaceAgentContext } from '@/lib/workspace/agentContext';
import { workspaceSelection } from '@/lib/workspace/contentModel';
import { ensureProjectSession } from '@/lib/projectSessions';
import { SYSTEM_REPAIR_PROMPT_EVENT } from '@/lib/agent/systemRepair';
import type { WorkshopData } from '@/lib/workshop/types';
import type { ProjectConversationReference } from '@/lib/projectObjects/types';
import { buildProjectConversationReferenceContext, mergeProjectConversationReferences, PROJECT_AGENT_CONTEXT_EVENT, type ProjectAgentContextEventDetail } from '@/lib/projectObjects/conversationRefs';
import AgentDrawer from '../chat/AgentDrawer';
import { isAssistantTargetAvailable, resolveAssistantTargetRequest, WORKSPACE_ASSISTANT_TARGET_EVENT } from './assistantTarget';
import './workspace-assistant.css';

function isPendingQueueItem(item: AssistantQueueItem): item is AssistantQueueItem & {
  status: Exclude<AssistantQueueItem['status'], 'done'>;
} {
  return item.status !== 'done';
}

function captureTarget(data: WorkshopData, sessionId: string | null, project = false): AssistantTarget {
  const surface = data.projectViewState?.workspaceSurface ?? 'media';
  if (workspaceScopeForView(data.projectViewState) === 'canvas') {
    const canvas = useCanvasStore.getState();
    const canvasProjectId = useProjectStore.getState().activeProjectId ?? '';
    const ids = project ? [] : canvas.nodes.filter((node) => node.selected).map((node) => node.id);
    try { return captureCanvasAssistantTarget(data, canvasProjectId, sessionId, canvas,
      ids.length || project ? ids : canvas.selectedNodeId ? [canvas.selectedNodeId] : []); }
    catch { return { projectId: data.projectId, sessionId, surface: 'media', label: '画布目标已失效', context: '',
      canvasTarget: { projectId: data.projectId, canvasProjectId, nodes: [], invalidReason: '节点绑定已失效，请重新选择。' } } as CanvasAssistantTarget; }
  }
  const references = structuredClone(data.projectViewState?.conversationReferences ?? []);
  if (surface !== 'media' && !project) {
    const label = surface === 'editor' ? '剪辑对话' : '文档 / 规格对话';
    const contextBase = `[媒体工作台上下文：${JSON.stringify({ project_id: data.projectId, surface })}]\n`
      + (surface === 'editor' ? '当前范围为本项目剪辑。先调用 timeline_get_state 读取真实时间线、轨道与片段，再按用户明确指令执行；不因浏览切换改动工坊镜头、生成草稿、剧情或对白。未获得工具回执不得宣称媒体或时间线已同步。'
        : '当前范围为本项目文档与规格。先读取真实项目文档/规格，明确用户要改的字段；改剧本正文、剧情或对白必须有明确指令并给出差异审阅，不改媒体生成草稿、时间线或其他对象。')
      + '遵守对象锁定、修订冲突与付费确认，不因后续工作面切换改变本条消息范围。';
    return { projectId: data.projectId, sessionId, surface, label, contextBase, references,
      context: contextBase + buildProjectConversationReferenceContext(references) + '\n\n' };
  }
  const contextBase = project ? `[媒体工作台上下文：${JSON.stringify({ project_id: data.projectId })}]\n当前为项目对话。仅操作明确指令涉及的对象；不因浏览选择扩大修改范围，遵守对象锁定、修订冲突及付费确认。改剧情或对白前先澄清。`
    : buildWorkspaceAgentContext({ ...data, projectViewState: { ...data.projectViewState, conversationReferences: [] } }).trimEnd();
  const context = contextBase + buildProjectConversationReferenceContext(references) + '\n\n';
  if (project) return { projectId: data.projectId, sessionId, surface, label: '项目对话', context, contextBase, references };
  const selection = workspaceSelection(data);
  return { projectId: data.projectId, sessionId, surface, objectId: selection.selected?.id,
    mediaId: selection.media?.media.id, versionId: selection.media?.version?.id, outputType: selection.outputType,
    label: selection.selected ? `${selection.selected.label} · ${selection.outputType === 'video' ? '视频' : selection.outputType === 'audio' ? '音频' : '图片'}${selection.media?.version ? ` v${selection.media.version.ordinal}` : '草稿'}` : '项目对话',
    context, contextBase, references };
}

export default function WorkspaceAssistant({ onSendMessage, onAbort }: {
  onSendMessage: (content: string, files?: string[]) => Promise<void> | void;
  onAbort: () => void;
}) {
  const data = useWorkshopStore((state) => state.data);
  const sessionId = useChatStore((state) => state.currentSessionId);
  const messages = useChatStore((state) => state.messages);
  const sessions = useChatStore((state) => state.sessions);
  const mention = useCanvasMention();
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot);
  const sendRef = useRef(onSendMessage); sendRef.current = onSendMessage;
  const projectId = data?.projectId;
  const surface = data?.projectViewState?.workspaceSurface ?? 'media';
  const candidate = projectId ? queue.draft(projectId, sessionId, surface) : undefined;
  const saved = candidate && assistantTargetScope(candidate.target) === workspaceScopeForView(data?.projectViewState) ? candidate : undefined;
  const proposed = data ? captureTarget(data, sessionId) : undefined;
  const target = saved?.target ?? proposed;
  const targetRef = useRef(target); targetRef.current = target;
  const updateReferences = (references: ProjectConversationReference[]) => {
    const frozen = targetRef.current;
    if (!frozen || useWorkshopStore.getState().data?.projectId !== frozen.projectId) return;
    const draft = queue.draft(frozen.projectId, frozen.sessionId, frozen.surface);
    let base = frozen;
    const binding = canvasTargetOf(frozen);
    const current = useWorkshopStore.getState().data;
    if (binding && !binding.director && current) {
      try { base = captureCanvasAssistantTarget(current, binding.canvasProjectId, frozen.sessionId, useCanvasStore.getState(),
        references.filter((ref) => ref.kind === 'canvas-node' && ref.sourceView === 'canvas').flatMap((ref) => ref.sourceId ? [ref.sourceId] : [])); }
      catch { return; }
    }
    const next = { ...base, references: structuredClone(references),
      context: (base.contextBase ?? base.context.trimEnd()) + buildProjectConversationReferenceContext(references) + '\n\n' };
    targetRef.current = next;
    queue.writeDraft(next, draft?.text ?? '', draft?.files ?? []);
  };
  const referencesRef = useRef(updateReferences); referencesRef.current = updateReferences;

  useEffect(() => registerWorkspaceToolScope(() => {
    const items = queue.getSnapshot().items;
    const runningTarget = workspaceExecutionTarget(items);
    if (runningTarget) return assistantTargetScope(runningTarget);
    const current = useWorkshopStore.getState();
    return projectId && current.project?.id === projectId && current.data?.projectId === projectId
      && useUnifiedProjectStore.getState().activeId === projectId && targetRef.current?.projectId === projectId
      ? assistantTargetScope(targetRef.current) : null;
  }), [projectId]);

  useEffect(() => {
    if (!projectId) return;
    const idle = () => useChatStore.getState().streamingPhase === 'idle' && !useChatStore.getState().isStreaming
      && !Object.values(useRunStepStore.getState().runsById).some((run) => run.status === 'running')
      && useToolConfirmStore.getState().pending.length === 0 && !useAskUserStore.getState().pending
      && useAskUserStore.getState().queue.length === 0;
    const matching = (target: AssistantTarget) => {
      const chat = useChatStore.getState();
      const session = chat.sessions.find((entry) => entry.id === chat.currentSessionId);
      return useUnifiedProjectStore.getState().activeId === target.projectId
        && useWorkshopStore.getState().data?.projectId === target.projectId
        && (target.sessionId === null ? chat.currentSessionId === null : chat.currentSessionId === target.sessionId)
        && (!session?.projectId || session.projectId === target.projectId);
    };
    const detach = queue.attach({ projectId, safe: (item) => idle() && matching(item.target),
      send: async (item, attached) => {
        if (!attached() || !idle() || !matching(item.target)) throw new AssistantQueueFailure('尚未发送，等待原项目与会话空闲后重试。', true);
        const ws = useWorkshopStore.getState();
        const beforeMessages = new Set(useChatStore.getState().messages.map((message) => message.id));
        const beforeRuns = new Set(Object.keys(useRunStepStore.getState().runsById));
        try { await ensureProjectSession(projectId, ws.project?.name ?? '项目'); }
        catch { throw new AssistantQueueFailure('会话准备失败，消息尚未发送。', true); }
        const chat = useChatStore.getState();
        const actualSession = chat.sessions.find((entry) => entry.id === chat.currentSessionId);
        if (!attached() || !idle() || useUnifiedProjectStore.getState().activeId !== projectId
          || useWorkshopStore.getState().data?.projectId !== projectId || actualSession?.projectId !== projectId
          || (item.target.sessionId !== null && chat.currentSessionId !== item.target.sessionId)) {
          throw new AssistantQueueFailure('目标会话已变化，消息尚未发送。', true);
        }
        if (item.target.sessionId === null && chat.currentSessionId) queue.bindPreparedSession(projectId, chat.currentSessionId);
        const currentData = useWorkshopStore.getState().data;
        const productionError = validateProductionAssistantTarget(item.target, currentData);
        if (productionError) throw new AssistantQueueFailure(productionError, true);
        if (assistantTargetScope(item.target) === 'canvas') {
          const reason = validateCanvasAssistantTarget(item.target, currentData, useProjectStore.getState(),
            useUnifiedProjectStore.getState().activeId, useCanvasStore.getState().nodes);
          if (reason) throw new AssistantQueueFailure(reason, true);
          const director = canvasTargetOf(item.target)?.director;
          const live = useDirectorStore.getState();
          if (director && (!live.isOpen || live.projectId !== director.projectId || live.activePlanId !== director.planId)) {
            throw new AssistantQueueFailure('原导演方案已关闭或切换，消息尚未发送。', true);
          }
        }
        if ((item.target.objectId || item.target.mediaId) && !isAssistantTargetAvailable(currentData?.projectObjects, item.target)) throw new AssistantQueueFailure('原目标已删除、归档或改归属，请重新选择对象。', true);
        if (readWorkspaceMessage(item.target.context).status === 'invalid') {
          throw new AssistantQueueFailure('工作面上下文格式不完整，消息尚未发送。', true);
        }
        const content = serializeWorkspaceAssistantMessage(item.target, item.prompt);
        const result = sendRef.current(content, [...item.files]);
        if (!result || typeof result.then !== 'function') throw new AssistantQueueFailure('发送接口未提供完成回执，状态待核实；不会重放整轮。');
        await result;
        const runs = Object.values(useRunStepStore.getState().runsById).filter((run) => !beforeRuns.has(run.id) && run.sessionId === actualSession.id);
        if (useChatStore.getState().error || runs.some((run) => run.status !== 'done')) {
          throw new AssistantQueueFailure('本次执行未完成。请先核对已执行工具与产物，勿重复提交整轮。');
        }
        return { messageIds: useChatStore.getState().currentSessionId === actualSession.id
          ? useChatStore.getState().messages.filter((message) => !beforeMessages.has(message.id)).map((message) => message.id) : [], runIds: runs.map((run) => run.id) };
      } });
    const subscriptions = [useChatStore.subscribe(queue.kick), useRunStepStore.subscribe(queue.kick),
      useToolConfirmStore.subscribe(queue.kick), useAskUserStore.subscribe(queue.kick),
      useWorkshopStore.subscribe(queue.kick), useUnifiedProjectStore.subscribe(queue.kick)];
    return () => { detach(); subscriptions.forEach((unsubscribe) => unsubscribe()); };
  }, [projectId]);

  useEffect(() => {
    const inject = (event: Event) => {
      const detail = (event as CustomEvent<{ prompt?: string; projectId?: string }>).detail;
      const frozen = targetRef.current;
      if (!detail?.prompt || !frozen || (detail.projectId && detail.projectId !== frozen.projectId)) return;
      queue.enqueue(frozen, detail.prompt);
    };
    window.addEventListener('kunpeng-workshop-prompt', inject);
    window.addEventListener(SYSTEM_REPAIR_PROMPT_EVENT, inject);
    const editorPrompt = (event: Event) => {
      const prompt = (event as CustomEvent<{ prompt?: string }>).detail?.prompt;
      const current = useWorkshopStore.getState().data;
      if (!prompt || !current || current.projectViewState?.workspaceSurface !== 'editor') return;
      queue.enqueue(captureTarget(current, useChatStore.getState().currentSessionId), prompt);
      useWorkshopStore.getState().updateProjectViewState({ agentDrawerState: 'expanded' });
    };
    const openEditor = () => {
      if (useWorkshopStore.getState().data?.projectViewState?.workspaceSurface === 'editor') {
        useWorkshopStore.getState().updateProjectViewState({ agentDrawerState: 'expanded' });
      }
    };
    window.addEventListener('kunpeng-editor-prompt', editorPrompt);
    window.addEventListener('kunpeng-editor-drawer-open', openEditor);
    const selectTarget = (event: Event) => {
      const current = useWorkshopStore.getState().data;
      if (!current || useUnifiedProjectStore.getState().activeId !== current.projectId) return;
      const request = resolveAssistantTargetRequest(current.projectObjects, (event as CustomEvent<unknown>).detail);
      if (!request || request.projectId !== current.projectId) return;
      const next = captureTarget({ ...current, projectViewState: { ...current.projectViewState,
        workspaceSurface: 'media', workspaceObjectId: request.objectId, workspaceMediaId: request.mediaId,
        workspaceOutputType: request.outputType ?? current.projectViewState?.workspaceOutputType, selectedShotId: undefined,
      } }, useChatStore.getState().currentSessionId);
      // Selection helpers may fall back for unsupported objects; never acknowledge a different target.
      if (next.objectId !== request.objectId || (request.mediaId && next.mediaId !== request.mediaId)) return;
      next.accessScope = request.accessScope;
      targetRef.current = next;
      queue.select(next);
      useWorkshopStore.getState().updateProjectViewState({ agentDrawerState: 'expanded' });
      event.preventDefault();
    };
    window.addEventListener(WORKSPACE_ASSISTANT_TARGET_EVENT, selectTarget);
    const addReferences = (event: Event) => {
      const detail = (event as CustomEvent<ProjectAgentContextEventDetail>).detail;
      const current = useWorkshopStore.getState().data;
      if (!current || current.projectId !== targetRef.current?.projectId || !Array.isArray(detail?.references)) return;
      const valid = detail.references.filter((reference) => current.projectObjects && [...current.projectObjects.objects, ...current.projectObjects.media, ...current.projectObjects.versions]
        .some((entry) => entry.id === reference.objectId && !entry.archived));
      if (valid.length) referencesRef.current(mergeProjectConversationReferences(targetRef.current?.references, valid));
      if (valid.length && detail.open !== false) useWorkshopStore.getState().updateProjectViewState({ agentDrawerState: 'expanded' });
    };
    window.addEventListener(PROJECT_AGENT_CONTEXT_EVENT, addReferences);
    return () => { window.removeEventListener('kunpeng-workshop-prompt', inject); window.removeEventListener(SYSTEM_REPAIR_PROMPT_EVENT, inject); window.removeEventListener(PROJECT_AGENT_CONTEXT_EVENT, addReferences);
      window.removeEventListener(WORKSPACE_ASSISTANT_TARGET_EVENT, selectTarget);
      window.removeEventListener('kunpeng-editor-prompt', editorPrompt); window.removeEventListener('kunpeng-editor-drawer-open', openEditor); };
  }, []);

  if (!data || !target) return null;
  const key = assistantThreadKey(target);
  const items = snapshot.items.filter((item) => item.target.projectId === projectId);
  const session = sessions.find((entry) => entry.id === sessionId);
  const currentItems = items.filter((item) => item.target.sessionId === sessionId);
  let messageThread: string | undefined;
  const visibleMessageIds = new Set<string>();
  for (const message of messages) {
    if (message.role === 'user') messageThread = currentItems.find((item) => item.messageIds?.includes(message.id)
      || message.content === serializeWorkspaceAssistantMessage(item.target, item.prompt)
      || message.content === item.target.context + item.prompt || (message.content.endsWith(item.prompt) && message.content.includes(item.target.context.trim())))?.threadKey;
    const owner = currentItems.find((item) => item.messageIds?.includes(message.id));
    if (session?.projectId === projectId && ((owner?.threadKey ?? messageThread) === key
      || (!target.objectId && !owner && !messageThread))) visibleMessageIds.add(message.id);
  }
  const running = items.find((item) => item.status === 'running');
  const scopeChanged = target.objectId && (proposed?.objectId !== target.objectId || proposed?.mediaId !== target.mediaId);
  const modelScope = assistantTargetScope(workspaceExecutionTarget(snapshot.items, target)!);
  const targetScope = assistantTargetScope(target);
  return <AgentDrawer embedded open onOpenChange={() => {}} stripPrefixRe={/^\[媒体工作台上下文[\s\S]*?\n\n/}
    greeting={{ hello: '项目助手', title: '继续这个项目' }} suggestions={[]} modelScope={modelScope}
    mention={targetScope === 'canvas' ? mention : undefined}
    placeholder="描述本次调整" onAbort={onAbort}
    onSend={(text, files) => {
      const urls = targetScope === 'canvas' ? appendCanvasMentionUrls('', mention.extractMentionedUrls(text)) : '';
      const next = urls ? { ...target, context: target.context + urls } : target;
      if (urls) queue.select(next);
      queue.enqueue(next, text, files);
    }}
    workspaceComposer={{ key, text: saved?.text ?? '', files: saved?.files ?? [], onChange: (text, files) => queue.writeDraft(target, text, files) }}
    workspaceMessageIds={visibleMessageIds} workspaceStreamingVisible={running?.threadKey === key}
    onWorkspaceReference={(reference) => updateReferences(mergeProjectConversationReferences(target.references, [reference]))}
    queueItems={items.filter(isPendingQueueItem).map((item) => ({ id: item.id, prompt: item.prompt,
      label: item.prompt.split('\n')[0], targetLabel: item.target.label, status: item.status, error: item.error }))}
    onDeleteQueueItem={(id) => queue.update(id, 'delete')} onEditQueueItem={(id, prompt) => queue.update(id, 'edit', prompt)}
    onRetryQueueItem={(id) => queue.update(id, 'retry')} onSendQueueItemNow={(id) => queue.update(id, 'prioritize')}
    contextBannerKey={key} contextBanner={<><div className="workspace-assistant-scope">
      <div><strong title={target.label}>{target.objectId ? `当前对象 · ${target.label}` : target.label}</strong>
        {scopeChanged && <span role="status">浏览已切换，输入仍属于原对象</span>}</div>
      <button type="button" className="workspace-scope-btn" title="返回项目对话（保留本线程草稿）" aria-label="返回项目对话" onClick={() => queue.select(captureTarget(data, sessionId, true))}><ArrowLeft size={13} /><span>主对话</span></button>
      <button type="button" className="workspace-scope-btn" title="调整当前工作面对象（保留原线程草稿）" aria-label="调整当前浏览对象" onClick={() => queue.select(captureTarget(useWorkshopStore.getState().data ?? data, useChatStore.getState().currentSessionId))}><Crosshair size={13} /><span>跟随当前对象</span></button>
    </div>{Boolean(target.references?.length) && <div className="workspace-assistant-references">{target.references?.map((reference) => <span key={reference.id}>
      {reference.thumbnailPath && /\.(png|jpe?g|webp|gif)(?:[?#].*)?$/i.test(reference.thumbnailPath) && <img alt="" src={/^(https?:|data:|blob:|asset:)/i.test(reference.thumbnailPath) ? reference.thumbnailPath : convertFileSrc(reference.thumbnailPath)} />}
      <span>{reference.label} · {reference.operationScope === 'read' ? '只读引用' : reference.operationScope === 'generate' ? '生成范围' : '编辑范围'}</span>
      <button type="button" title="移除此对话引用" onClick={() => updateReferences(target.references?.filter((entry) => entry.id !== reference.id) ?? [])}><X size={12} /></button>
    </span>)}</div>}</>} />;
}
