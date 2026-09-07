import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { History, MoreHorizontal, Sparkles, FileUp, X } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { useChatStore } from '@/stores';
import { useWorkshopStore } from '@/stores/workshopStore';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';
import { summarizeProjectSpec } from '@/lib/projectObjects/projectSpec';
import { selectWorkspaceObject, workspaceSelection } from '@/lib/workspace/contentModel';
import { WORKSPACE_ENGINES, workspaceEngine } from '@/lib/workspace/engineCatalog';
import { applyWorkspaceProjectCommand, generateWorkspaceDraft, updateWorkspaceDraft } from '@/lib/workspace/runtime';
import { optimizeWorkspacePrompt, restyleWorkspacePrompt } from '@/lib/workspace/optimize';
import { initialWorkspaceDraft } from '@/lib/workspace/drafts';
import { dispatchProjectAgentContext } from '@/lib/projectObjects/conversationRefs';
import { encodeReferenceTransfer, PROJECT_REFERENCE_MIME, projectTransferReferences } from '@/lib/projectObjects/referenceTransfer';
import { assessProjectObjectDeletion } from '@/lib/projectObjects/deletion';
import { SpecEditor } from '@/components/projects/ProjectTopBar';
import ProjectSnapshotPanel from '@/components/projects/ProjectSnapshotPanel';
import WorkshopChatPanel from '@/components/workshop/WorkshopChatPanel';
import WorkspaceExportDialog from './WorkspaceExportDialog';
import ProjectContentList from './ProjectContentList';
import ProjectWorkspaceLayout from './ProjectWorkspaceLayout';
import WorkspaceMediaPanel from './WorkspaceMediaPanel';
import WorkspaceConstraintSection from './WorkspaceConstraintSection';
import SettingsPanel from '@/components/Settings';
import { useWorkspaceServices } from '@/lib/workspace/useWorkspaceServices';
import { workspaceUnavailableReason } from '@/lib/workspace/services';
import WorkspaceClassifyDialog from './WorkspaceClassifyDialog';
import WorkspaceTaskStrip from './WorkspaceTaskStrip';
import { transitionWorkspaceSubmission } from '@/lib/workspace/submissions';
import { createUnclassifiedGeneration, createWorkspaceAsset, createWorkspaceShot, renameWorkspaceObject } from '@/lib/workspace/inbox';
import { assignProfessionalCanvasMedia } from '@/lib/workspace/professionalCanvasRuntime';
import type { MediaFileRecord } from '@/lib/projectObjects/types';
import WorkspaceObjectActions from './WorkspaceObjectActions';
import { setWorkspaceListVisibility } from '@/lib/workspace/visibility';
import WorkspaceDocuments from './WorkspaceDocuments';
import { useWorkspaceDocuments } from '@/lib/workspace/useWorkspaceDocuments';
import { readWorkspaceTimelineSourceContext } from '@/lib/workspace/useWorkspaceTimelineSource';
import { WORKSPACE_INSPECTOR_REQUEST_EVENT, validateTimelineInspectorRequest, type WorkspaceInspectorRequest } from '@/lib/workspace/timelineSource';
import { WORKSPACE_ASSISTANT_INSPECT_EVENT, assistantResultMedia, type WorkspaceAssistantInspectDetail } from './assistantPresentation';
import { readWorkspaceMessage } from '@/lib/agent/workspaceMessage';
import { AssistantQueueFailure } from '@/lib/workspace/projectAssistantQueue';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import { PROFESSIONAL_DRAFT_REQUEST_EVENT, professionalDraftRequest } from '@/lib/workspace/professionalDraftProjection';
import { workspaceMediaVersions } from '@/lib/workspace/mediaView';
import { projectAssistantQueue } from '@/stores/projectAssistantQueueStore';
import type { AssistantTarget } from '@/lib/workspace/projectAssistantQueue';
import { buildAutoRunPrompt, buildExportPrompt } from '@/lib/workshop/workshopPrompts';

const WorkspaceEditor = lazy(() => import('@/components/workspace/WorkspaceEditorSurface'));
const WorkspaceCanvas = lazy(() => import('./WorkspaceCanvasSurface'));
const WorkspaceScriptTools = lazy(() => import('./WorkspaceScriptTools'));
const WorkspaceProductionTools = lazy(() => import('./WorkspaceProductionTools'));

function DocumentsSurface({ projectId }: { projectId: string }) {
  const documents = useWorkspaceDocuments(projectId);
  return documents ? <WorkspaceDocuments {...documents} /> : <p role="status">正在读取项目文档</p>;
}

interface Props {
  onSendMessage: (content: string, filePaths?: string[]) => Promise<void> | void;
  onAbort: () => void;
  onLegacy: () => void;
}

function mediaSrc(path: string) {
  return /^(https?:|data:|blob:|asset:)/i.test(path) ? path : convertFileSrc(path);
}

/** Real project container. All media writes go through the existing project commands/runtime. */
export default function ProjectWorkspace(props: Props) {
  const data = useWorkshopStore((state) => state.data);
  const project = useWorkshopStore((state) => state.project);
  const activeId = useUnifiedProjectStore((state) => state.activeId);
  const sessionId = useChatStore((state) => state.currentSessionId);
  const updateView = useWorkshopStore((state) => state.updateProjectViewState);
  const [specOpen, setSpecOpen] = useState(false);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [classification, setClassification] = useState<MediaFileRecord | null>(null);
  const [objectMenu, setObjectMenu] = useState<{ projectId: string; objectId?: string; groupId?: string; position: { x: number; y: number } } | null>(null);
  const [editInfo, setEditInfo] = useState<{ objectId: string; label: string; description: string } | null>(null);
  const [scriptProjectId, setScriptProjectId] = useState<string | null>(null);
  const [productionTarget, setProductionTarget] = useState<{ projectId: string; objectId: string } | null>(null);
  const services = useWorkspaceServices();
  const selection = useMemo(() => data ? workspaceSelection(data) : null, [data]);
  const engines = useMemo(() => {
    const all = [...WORKSPACE_ENGINES];
    const stored = Object.values(data?.workspaceDrafts ?? {}).map((draft) => draft.engineId);
    if (data?.imageModel) stored.push(data.imageModel);
    if (data?.videoModel) stored.push(data.videoModel);
    if (data && selection?.selected) {
      const draft = initialWorkspaceDraft(data, selection.selected.id, selection.outputType);
      if (draft) stored.push(draft.engineId);
    }
    for (const id of stored) {
      const engine = workspaceEngine(id);
      if (engine && !all.some((item) => item.id === id)) all.push(engine);
    }
    return all.map((engine) => ({ engine, unavailableReason: workspaceUnavailableReason(engine.id, services.capabilities) }));
  }, [data, selection, JSON.stringify(services.capabilities)]);
  const ownsProject = () => {
    const current = useWorkshopStore.getState();
    return current.data?.projectId === activeId && current.project?.id === activeId
      && useUnifiedProjectStore.getState().activeId === activeId;
  };
  const sendWorkspaceMessage = (content: string, filePaths?: string[]) => {
    if (!ownsProject() || readWorkspaceMessage(content).status !== 'valid') {
      throw new AssistantQueueFailure('项目或消息上下文已变化，消息尚未发送。', true);
    }
    return props.onSendMessage(content, filePaths);
  };
  useEffect(() => {
    if (activeId && data?.projectId === activeId && project?.id === activeId) {
      updateView({ activeConversationId: sessionId ?? undefined });
    }
  }, [activeId, data?.projectId, project?.id, sessionId, updateView]);
  // 新建项目的一次性标记：首次进入工作台时默认打开"创作与拆解剧本"，消费后立即清除
  useEffect(() => {
    if (!activeId || data?.projectId !== activeId || project?.id !== activeId) return;
    if (!data.projectViewState?.workspaceScriptToolsOpen) return;
    setProductionTarget(null);
    setScriptProjectId(activeId);
    updateView({ workspaceScriptToolsOpen: undefined, workspaceSurface: 'media', workspaceMediaView: 'list' });
  }, [activeId, data?.projectId, project?.id, data?.projectViewState?.workspaceScriptToolsOpen, updateView]);
  useEffect(() => {
    const open = (projectId: string, objectId: string, mediaId: string, outputType: 'image' | 'video' | 'audio', edit: boolean) => {
      const current = useWorkshopStore.getState().data;
      if (!current || current.projectId !== projectId || useUnifiedProjectStore.getState().activeId !== projectId) return false;
      const patch = selectWorkspaceObject(current, outputType === 'audio' ? mediaId : objectId, outputType);
      if (!patch) return false;
      setScriptProjectId(null);
      setProductionTarget(null);
      updateView({ ...patch, workspaceSurface: 'media', workspaceMediaView: 'list', workspaceMediaId: mediaId,
        workspaceComposerOpen: edit && outputType !== 'audio' });
      return true;
    };
    const timeline = (event: Event) => {
      const value = (event as CustomEvent<WorkspaceInspectorRequest>).detail;
      if (!value || value.projectId !== activeId) return;
      const context = readWorkspaceTimelineSourceContext(value.projectId, value.clipKind, value.clipId);
      const request = context && validateTimelineInspectorRequest(context.data, context.editorProjectId, context.clip, value);
      if (request && open(request.projectId, request.objectId, request.mediaId, request.outputType, request.intent === 'edit-prompt')) event.preventDefault();
    };
    const assistant = (event: Event) => {
      const request = (event as CustomEvent<WorkspaceAssistantInspectDetail>).detail;
      const current = useWorkshopStore.getState().data;
      const message = useChatStore.getState().messages.find((item) => item.id === request?.messageId);
      if (!current || !message || request?.version !== 1 || request.source !== 'assistant' || request.projectId !== activeId) return;
      const media = assistantResultMedia(message, current.projectObjects).find((item) => item.id === request.mediaId);
      if (!media || media.mediaType !== request.outputType || (media.ownerObjectId ?? media.id) !== request.objectId) return;
      const version = current.projectObjects?.versions.find((item) => item.mediaObjectId === media.id && !item.archived);
      if (version?.id !== request.versionId) return;
      if (open(request.projectId, request.objectId, request.mediaId, request.outputType, false)) event.preventDefault();
    };
    const professional = (event: Event) => {
      const current = useWorkshopStore.getState().data;
      const canvasProject = useProjectStore.getState();
      if (!current || current.projectId !== activeId || canvasProject.switching || !canvasProject.activeProjectId
        || !(current.canvasProjectId === canvasProject.activeProjectId || canvasProject.projects.some((item) =>
          item.id === canvasProject.activeProjectId && item.aigcProjectId === current.projectId))) return;
      const request = professionalDraftRequest(current, useCanvasStore.getState().nodes, (event as CustomEvent)?.detail?.nodeId);
      if (request && open(current.projectId, request.objectId, '', request.outputType, request.edit)) event.preventDefault();
    };
    window.addEventListener(PROFESSIONAL_DRAFT_REQUEST_EVENT, professional);
    window.addEventListener(WORKSPACE_INSPECTOR_REQUEST_EVENT, timeline);
    window.addEventListener(WORKSPACE_ASSISTANT_INSPECT_EVENT, assistant);
    return () => { window.removeEventListener(PROFESSIONAL_DRAFT_REQUEST_EVENT, professional); window.removeEventListener(WORKSPACE_INSPECTOR_REQUEST_EVENT, timeline); window.removeEventListener(WORKSPACE_ASSISTANT_INSPECT_EVENT, assistant); };
  }, [activeId, updateView]);
  if (!data || !project || data.projectId !== activeId || project.id !== activeId || !selection) return null;
  const view = data.projectViewState ?? {};
  const hiddenListIds = new Set(view.workspaceHiddenObjectIds ?? []);
  const visibleGroups = selection.groups.map((group) => ({ ...group, items: group.items.filter((item) => !hiddenListIds.has(item.id)) })).filter((group) => group.items.length);
  const menuItem = objectMenu?.projectId === data.projectId ? selection.groups.flatMap((group) => group.items).find((item) => item.id === objectMenu.objectId) : undefined;
  const surface = view.workspaceSurface ?? 'media';
  const patchView: typeof updateView = (patch) => { if (ownsProject()) updateView(patch); };
  const enqueueProjectAction = (label: string, contextBase: string, prompt: string) => {
    if (!ownsProject()) return;
    const target: AssistantTarget = { projectId: data.projectId, sessionId: sessionId ?? null, surface: 'media', label,
      contextBase, context: `${contextBase}\n\n`, references: [] };
    projectAssistantQueue.enqueue(target, prompt);
    projectAssistantQueue.select(target);
    updateView({ agentDrawerState: 'expanded' });
  };
  const addToChat = (ids: string[], mediaId?: string) => {
    if (!ownsProject()) return;
    const refs = projectTransferReferences(useWorkshopStore.getState().data!);
    const selected = (mediaId ? [mediaId] : ids).flatMap((id) => {
      const ref = refs.find((item) => item.objectId === id); return ref ? [ref] : [];
    });
    if (selected.length) dispatchProjectAgentContext(selected);
  };
  return <>
    <ProjectWorkspaceLayout key={data.projectId} projectName={project.name} specSummary={summarizeProjectSpec(data.projectSpec)} surface={surface}
      widths={view.workspaceLayoutWidths} onWidths={(workspaceLayoutWidths) => patchView({ workspaceLayoutWidths })}
      mediaView={view.workspaceMediaView ?? 'list'} onMediaView={(workspaceMediaView) => patchView({ workspaceMediaView })}
      onNewMaterial={(type) => { if (ownsProject()) applyWorkspaceProjectCommand(data.projectId, (current) => createUnclassifiedGeneration(current, crypto.randomUUID(), type)); }}
      canvas={<Suspense fallback={<p role="status">正在打开画布</p>}>
        <WorkspaceCanvas key={data.projectId} projectId={data.projectId} onAbort={props.onAbort} />
      </Suspense>}
      assistantState={view.agentDrawerState ?? 'expanded'} onAssistantState={(agentDrawerState) => patchView({ agentDrawerState })}
      initialAssistantOpen={Boolean(data.projectIntake && projectAssistantQueue.getSnapshot().items.some((item) =>
        item.target.projectId === data.projectId && item.target.context.includes('"intake_created_at":')
        && (item.status === 'queued' || item.status === 'running')))}
      onSurface={(next) => patchView({ workspaceSurface: next })}
      onBack={() => { if (ownsProject()) void useUnifiedProjectStore.getState().closeUnified().then(() => useChatStore.getState().setActiveView('projects')); }}
      onSpec={() => setSpecOpen(true)} onExport={() => setExportOpen(true)}
      projectActions={<div className="workspace-project-menu">
        <button className="workspace-icon" aria-label="项目菜单" title="项目菜单" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><MoreHorizontal size={18} /></button>
        {menuOpen && <div role="menu"><button role="menuitem" onClick={() => { setMenuOpen(false); enqueueProjectAction('一键全流程',
          `[媒体工作台上下文：${JSON.stringify({ project_id: data.projectId, operation: 'auto-run' })}]\n当前为用户明确发起的一键全流程（拆解→资产→提示词→生成），不是局部改词。只读本项目已登记剧本；已有媒体、采用版本及时间线不自动替换；付费生成仍须单独确认。`,
          buildAutoRunPrompt()); }}><Sparkles size={14} />一键全流程</button>
          <button role="menuitem" onClick={() => { setMenuOpen(false); enqueueProjectAction('导出飞书',
            `[媒体工作台上下文：${JSON.stringify({ project_id: data.projectId, operation: 'export-feishu' })}]\n当前为用户明确发起的导出请求。`,
            buildExportPrompt('prompts')); }}><FileUp size={14} />导出飞书</button>
          <button role="menuitem" onClick={() => { setSnapshotsOpen(true); setMenuOpen(false); }}><History size={14} />项目快照</button>
          {hiddenListIds.size > 0 && <button role="menuitem" onClick={() => { patchView({ workspaceHiddenObjectIds: [] }); setMenuOpen(false); }}>显示已移除的工坊对象（{hiddenListIds.size}）</button>}
          <button role="menuitem" onClick={() => { setMenuOpen(false); props.onLegacy(); }}>切回旧版</button></div>}
      </div>}
      content={<><ProjectContentList key={data.projectId} groups={visibleGroups} selectedId={selection.selected?.id} mediaSrc={mediaSrc}
        scriptActive={scriptProjectId === data.projectId} scriptExcerpt={project.sources.map((source) => source.name).join(' · ') || data.projectIntake?.brief}
        onScriptTools={() => { setProductionTarget(null); setScriptProjectId(data.projectId); patchView({ workspaceSurface: 'media', workspaceMediaView: 'list' }); }}
        onObjectMenu={(objectId, position) => setObjectMenu({ projectId: data.projectId, objectId, position })}
        onBackgroundMenu={(position) => setObjectMenu({ projectId: data.projectId, position })}
        onGroupMenu={(groupId, position) => setObjectMenu({ projectId: data.projectId, groupId, position })}
        onDragObject={(id, transfer) => { const ref = projectTransferReferences(data).find((item) => item.objectId === id);
          if (ref) { transfer.setData(PROJECT_REFERENCE_MIME, encodeReferenceTransfer(data.projectId, ref)); transfer.effectAllowed = 'copy'; } }}
        onSelect={(id) => { setScriptProjectId(null); setProductionTarget(null); const patch = selectWorkspaceObject(data, id); if (patch) patchView({ ...patch, workspaceSurface: 'media' }); }}
        onAddToChat={(ids) => addToChat(ids)} renderMediaGroup={(object) => {
          const types = object.kind === 'shot' ? ['image', 'video', 'audio'] as const : ['image', 'audio'] as const;
          const versions = types.flatMap((type) => workspaceMediaVersions(data, object.id, type));
          return <div className="workspace-version-strip workspace-content-versions" aria-label={`${object.label}媒体组`}>
          {versions.map((item) => <button key={item.media.id} aria-label={`预览${object.label}${item.media.mediaType === 'image' ? '图片' : item.media.mediaType === 'video' ? '视频' : '音频'}版本${item.ordinal}`} aria-pressed={selection.media?.media.id === item.media.id}
            onClick={() => {
              const patch = selectWorkspaceObject(data, item.media.mediaType === 'audio' ? item.media.id : object.id, item.media.mediaType === 'video' ? 'video' : item.media.mediaType === 'audio' ? 'audio' : 'image');
              if (patch) { setScriptProjectId(null); setProductionTarget(null); patchView({ ...patch, workspaceMediaId: item.media.id, workspaceSurface: 'media' }); }
            }}>
            {item.media.mediaType === 'image' ? <img src={mediaSrc(item.media.path)} alt="" loading="lazy" /> : <span className="workspace-version-type">{item.media.mediaType === 'video' ? '视频' : '音频'}</span>}
            v{item.ordinal}{item.adopted ? ' · 已采用' : ' · 待选'}
          </button>)}
          {!versions.length && <span className="workspace-tree-empty">暂无生成素材</span>}
        </div>;
        }} />
        <WorkspaceTaskStrip projectId={data.projectId} /></>}
      inspector={surface === 'media' && scriptProjectId === data.projectId ? <Suspense fallback={<p role="status">正在打开剧本工具</p>}>
        <WorkspaceScriptTools projectId={data.projectId} onClose={() => setScriptProjectId(null)} />
      </Suspense> : surface === 'media' && productionTarget?.projectId === data.projectId ? <Suspense fallback={<p role="status">正在打开资产工具</p>}>
        <WorkspaceProductionTools projectId={data.projectId} objectId={productionTarget.objectId} onClose={() => setProductionTarget(null)} />
      </Suspense> : surface === 'media' ? <div className="workspace-production-media">
        {notice && <p className="workspace-error" role="alert">{notice}</p>}
        <WorkspaceMediaPanel key={data.projectId} data={data} engines={engines} mediaSrc={mediaSrc}
          onProductionTools={(objectId) => { if (ownsProject()) { setScriptProjectId(null); setProductionTarget({ projectId: data.projectId, objectId }); } }}
          onClassify={(media) => setClassification({ ...media })}
          onEstimate={services.estimate} onConfigure={() => setSettingsOpen(true)}
          onResolveSubmission={(submissionId) => ownsProject() && applyWorkspaceProjectCommand(data.projectId, (current) => {
            const next = transitionWorkspaceSubmission(current, submissionId, 'failed', '用户已核对原任务状态，标记失败，可重新生成。');
            return next === current ? null : next;
          })}
          renderConstraint={(draft) => <WorkspaceConstraintSection key={draft.id} data={data} draft={draft} mediaSrc={mediaSrc}
            onCommand={(command) => applyWorkspaceProjectCommand(data.projectId, command)} onSave={updateWorkspaceDraft}
            onGenerate={generateWorkspaceDraft} onAddToChat={(id) => addToChat([id])}
            onAdopt={(id, versionId) => ownsProject() && useUnifiedProjectStore.getState().selectProjectAssetVersion(id, versionId)} />}
          onSaveDraft={updateWorkspaceDraft} onGenerate={generateWorkspaceDraft} onOptimize={optimizeWorkspacePrompt}
          onApplyStyle={restyleWorkspacePrompt}
          onViewState={patchView} onAddToChat={(id, mediaId) => addToChat([id], mediaId)}
          onEditToChat={(objectId, mediaId) => {
            if (!ownsProject()) return;
            window.dispatchEvent(new CustomEvent('kunpeng-workspace-assistant-target', { detail: { projectId: data.projectId, objectId, mediaId }, cancelable: true }));
            addToChat([objectId], mediaId);
          }}
          onAdopt={(versionId) => {
            const selected = selection.selected;
            if (!selected || !ownsProject()) return;
            const live = useWorkshopStore.getState().data;
            const version = live?.projectObjects?.versions.find((item) => item.id === versionId);
            const directMedia = live?.projectObjects?.media.find((item) => item.id === selected.id && item.id === version?.mediaObjectId);
            if (!version || (version.ownerObjectId !== selected.id && !directMedia)) return;
            const success = useUnifiedProjectStore.getState().selectProjectAssetVersion(version.ownerObjectId, versionId);
            setNotice(success ? '' : '版本未切换：对象已锁定或项目已改变。');
          }} />
      </div> : surface === 'editor' ? <Suspense fallback={<p role="status">正在打开剪辑</p>}>
        <WorkspaceEditor projectId={data.projectId} onSendMessage={props.onSendMessage} onAbort={props.onAbort} />
      </Suspense> : <DocumentsSurface projectId={data.projectId} />}
      assistant={<WorkshopChatPanel embedded onSendMessage={sendWorkspaceMessage} onAbort={props.onAbort} />} />
    {specOpen && data.projectSpec && <SpecEditor spec={data.projectSpec} onClose={() => setSpecOpen(false)} onSave={(patch) => {
      if (ownsProject()) useWorkshopStore.getState().updateProjectSpec(patch);
    }} />}
    {snapshotsOpen && <ProjectSnapshotPanel key={activeId} onClose={() => setSnapshotsOpen(false)} />}
    {exportOpen && <WorkspaceExportDialog projectId={data.projectId} onClose={() => setExportOpen(false)} />}
    {settingsOpen && <SettingsPanel isOpen onClose={() => setSettingsOpen(false)} />}
    {objectMenu?.projectId === data.projectId && (!objectMenu.objectId || menuItem || objectMenu.groupId) && <WorkspaceObjectActions
      key={`${data.projectId}:${objectMenu.objectId ?? objectMenu.groupId ?? 'background'}:${objectMenu.position.x}:${objectMenu.position.y}`}
      label={menuItem?.label ?? (objectMenu.groupId === 'assets' ? '角色、场景与道具' : '项目内容')} position={objectMenu.position}
      impact={menuItem ? assessProjectObjectDeletion(data, menuItem.id) : null} onClose={() => setObjectMenu(null)}
      onNewMaterial={(type) => {
        if (ownsProject()) applyWorkspaceProjectCommand(data.projectId, (current) => createUnclassifiedGeneration(current, crypto.randomUUID(), type));
        setScriptProjectId(null); setProductionTarget(null); setObjectMenu(null);
      }}
      onNewShot={() => {
        if (ownsProject()) applyWorkspaceProjectCommand(data.projectId, (current) => createWorkspaceShot(current, crypto.randomUUID()));
        setScriptProjectId(null); setProductionTarget(null); setObjectMenu(null);
      }}
      onNewAsset={(!objectMenu.objectId && (!objectMenu.groupId || objectMenu.groupId === 'assets')) || menuItem?.kind === 'character' || menuItem?.kind === 'scene' || menuItem?.kind === 'prop'
        ? (kind) => {
          if (ownsProject()) applyWorkspaceProjectCommand(data.projectId, (current) => createWorkspaceAsset(current, kind, crypto.randomUUID()));
          setScriptProjectId(null); setProductionTarget(null); setObjectMenu(null);
        } : undefined}
      onEditInfo={menuItem && ['shot', 'character', 'scene', 'prop', 'scene-asset'].includes(menuItem.kind) ? () => {
        const object = data.projectObjects?.objects.find((item) => item.id === menuItem.id);
        if (!object) { setObjectMenu(null); return; }
        setEditInfo({ objectId: menuItem.id, label: object.label ?? menuItem.label, description: menuItem.description ?? '' });
        setObjectMenu(null);
      } : undefined}
      onAddToChat={menuItem ? () => { addToChat([menuItem.id]); setObjectMenu(null); } : undefined}
      onHide={menuItem ? () => {
        if (!ownsProject()) return;
        applyWorkspaceProjectCommand(data.projectId, (current) => setWorkspaceListVisibility(current, menuItem.id, false));
        setObjectMenu(null);
      } : undefined}
      onDelete={menuItem ? () => ownsProject() ? useUnifiedProjectStore.getState().deleteProjectObject(menuItem.id)
        : Promise.resolve({ status: 'invalid', reason: '项目已切换，未执行删除。' }) : undefined} />}
    {editInfo && <div className="workspace-dialog-backdrop" onClick={() => setEditInfo(null)}>
      <section className="workspace-classify-dialog" role="dialog" aria-modal="true" aria-label="编辑信息" onClick={(event) => event.stopPropagation()}>
        <header><h2>编辑信息</h2><button className="workspace-icon" aria-label="关闭编辑信息" onClick={() => setEditInfo(null)}><X size={16} /></button></header>
        <label className="workspace-editinfo-field">标题<input value={editInfo.label} onChange={(event) => setEditInfo({ ...editInfo, label: event.target.value })} /></label>
        <label className="workspace-editinfo-field">描述<textarea rows={4} value={editInfo.description} onChange={(event) => setEditInfo({ ...editInfo, description: event.target.value })} /></label>
        <footer><button onClick={() => setEditInfo(null)}>取消</button>
          <button className="workspace-primary" onClick={() => {
            if (ownsProject()) applyWorkspaceProjectCommand(data.projectId, (current) => renameWorkspaceObject(current, editInfo.objectId, { label: editInfo.label, description: editInfo.description }));
            setEditInfo(null);
          }}>保存</button></footer>
      </section>
    </div>}
    {classification?.projectId === data.projectId && <WorkspaceClassifyDialog key={classification.id} data={data} media={classification}
      onClose={() => setClassification(null)} onAssign={(ownerId, expectedOwnerVersion) => {
        if (!ownsProject()) return false;
        assignProfessionalCanvasMedia(data.projectId, {
          mediaId: classification.id, expectedMediaVersion: classification.version, ownerId, expectedOwnerVersion,
        });
        {
          const current = useWorkshopStore.getState().data!;
          const patch = selectWorkspaceObject(current, ownerId, classification.mediaType === 'video' ? 'video' : classification.mediaType === 'audio' ? 'audio' : 'image');
          if (patch) patchView({ ...patch, workspaceMediaId: classification.id, workspaceCanvasInspectorOpen: true });
          setClassification(null);
        }
        return true;
      }} />}
  </>;
}
