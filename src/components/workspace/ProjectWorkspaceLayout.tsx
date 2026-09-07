import { useEffect, useId, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import { ArrowLeft, ChevronRight, List, Maximize2, MessageSquare, Minimize2, PanelRightClose, Plus, X } from 'lucide-react';
import type { ProjectViewState, WorkspaceLayoutWidths } from '@/lib/projectObjects/types';
import { DEFAULT_WORKSPACE_LAYOUT_WIDTHS, WORKSPACE_COLUMN_GAP, WORKSPACE_COLUMN_LIMITS, fitWorkspaceLayoutWidths,
  normalizeWorkspaceLayoutWidths, resizeWorkspaceColumn, workspaceColumnKeyboardDelta, workspaceColumnMaximum } from '@/lib/workspace/layoutWidths';
import './workspace.css';
import './workspaceLayoutExperience.css';

interface Props {
  projectName: string;
  specSummary: string;
  surface: 'media' | 'editor' | 'documents';
  assistantState: NonNullable<ProjectViewState['agentDrawerState']>;
  content: ReactNode;
  inspector: ReactNode;
  assistant: ReactNode;
  onSurface: (surface: Props['surface']) => void;
  onAssistantState: (state: Props['assistantState']) => void;
  onBack: () => void;
  onExport: () => void;
  onSpec: () => void;
  projectActions?: ReactNode;
  canvas?: ReactNode;
  mediaView?: 'list' | 'canvas';
  onMediaView?: (view: 'list' | 'canvas') => void;
  onNewMaterial?: (type: 'image' | 'video') => void;
  initialAssistantOpen?: boolean;
  widths?: WorkspaceLayoutWidths;
  onWidths?: (widths: WorkspaceLayoutWidths) => void;
}

export default function ProjectWorkspaceLayout(props: Props) {
  const [viewportCompact, setCompact] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1200);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [requestedAssistant, setRequestedAssistant] = useState(Boolean(props.initialAssistantOpen));
  const [largeAssistant, setLargeAssistant] = useState(false);
  const [newMaterialOpen, setNewMaterialOpen] = useState(false);
  const columnsRef = useRef<HTMLDivElement>(null);
  const contentId = useId();
  const assistantId = useId();
  const [availableWidth, setAvailableWidth] = useState(() => typeof window === 'undefined' ? 1200 : Math.max(0, window.innerWidth - 16));
  const [localWidths, setLocalWidths] = useState<WorkspaceLayoutWidths>(() => ({ ...DEFAULT_WORKSPACE_LAYOUT_WIDTHS }));
  const [previewWidths, setPreviewWidths] = useState<WorkspaceLayoutWidths | null>(null);
  const drag = useRef<{ pointerId: number; column: keyof WorkspaceLayoutWidths; startX: number;
    start: WorkspaceLayoutWidths; latest: WorkspaceLayoutWidths; handle: HTMLDivElement;
    onWidths: Props['onWidths']; controlled: boolean } | null>(null);
  const cancelDrag = () => {
    const active = drag.current;
    drag.current = null; setPreviewWidths(null);
    if (active?.handle.hasPointerCapture(active.pointerId)) active.handle.releasePointerCapture(active.pointerId);
  };
  useEffect(() => () => {
    const active = drag.current;
    drag.current = null;
    if (active?.handle.hasPointerCapture(active.pointerId)) active.handle.releasePointerCapture(active.pointerId);
  }, []);
  useEffect(() => {
    const element = columnsRef.current;
    if (!element) return;
    const measure = () => setAvailableWidth(element.getBoundingClientRect().width);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  useEffect(() => { cancelDrag(); }, [availableWidth, viewportCompact, props.widths, props.surface, props.mediaView, props.assistantState, largeAssistant]);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1199px)');
    const change = () => { setCompact(query.matches); setDirectoryOpen(false); setRequestedAssistant(false); };
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    const open = () => { setRequestedAssistant(true); setDirectoryOpen(false); };
    window.addEventListener('kunpeng-workspace-assistant-open', open);
    return () => window.removeEventListener('kunpeng-workspace-assistant-open', open);
  }, []);
  const canvasMode = props.surface === 'media' && props.mediaView === 'canvas';
  const directoryOverlay = canvasMode || props.surface === 'editor';
  const preferred = normalizeWorkspaceLayoutWidths(props.widths ?? localWidths);
  const candidate = fitWorkspaceLayoutWidths(preferred, availableWidth, { content: !directoryOverlay,
    assistant: props.assistantState === 'expanded' && !largeAssistant, collapsed: props.assistantState === 'collapsed' });
  const compact = viewportCompact || candidate.compact;
  const assistantVisible = props.assistantState === 'expanded' && (!compact || requestedAssistant);
  const collapsed = !compact && props.assistantState === 'collapsed';
  // 画布/剪辑工作面：助手恢复旧版悬浮式设计（浮层覆盖，不挤占布局轨道）
  const docked = { content: !compact && !directoryOverlay, assistant: !compact && !directoryOverlay && assistantVisible && !largeAssistant, collapsed };
  const fitted = fitWorkspaceLayoutWidths(previewWidths ?? preferred, availableWidth, docked);
  const tracks = [docked.content ? `${fitted.content}px ${WORKSPACE_COLUMN_GAP}px` : '', 'minmax(0, 1fr)',
    docked.assistant ? `${WORKSPACE_COLUMN_GAP}px ${fitted.assistant}px` : collapsed ? `${WORKSPACE_COLUMN_GAP}px 36px` : ''].filter(Boolean).join(' ');
  const publish = (next: WorkspaceLayoutWidths) => {
    if (!props.widths) setLocalWidths(next);
    props.onWidths?.({ ...next });
  };
  const separator = (column: keyof WorkspaceLayoutWidths) => {
    const finish = (event: PointerEvent<HTMLDivElement>) => {
      const active = drag.current;
      if (!active || active.pointerId !== event.pointerId) return;
      drag.current = null; setPreviewWidths(null);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      if (active.latest.content === active.start.content && active.latest.assistant === active.start.assistant) return;
      if (!active.controlled) setLocalWidths(active.latest);
      active.onWidths?.({ ...active.latest });
    };
    return <div className="workspace-column-resizer" role="separator" tabIndex={0} aria-orientation="vertical"
      aria-label={column === 'content' ? '调整目录宽度' : '调整助手宽度'}
      aria-controls={column === 'content' ? contentId : assistantId}
      aria-valuemin={WORKSPACE_COLUMN_LIMITS[column].min} aria-valuemax={workspaceColumnMaximum(column, availableWidth, fitted, docked)} aria-valuenow={fitted[column]}
      aria-valuetext={`${fitted[column]} 像素`} title="拖动或按左右方向键调整，双击恢复默认"
      style={{ gridColumn: column === 'content' ? 2 : docked.content ? 4 : 2, gridRow: 1 }}
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current) return;
        event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
        const start = { content: fitted.content, assistant: fitted.assistant };
        drag.current = { pointerId: event.pointerId, column, startX: event.clientX, start, latest: start,
          handle: event.currentTarget, onWidths: props.onWidths, controlled: Boolean(props.widths) };
        setPreviewWidths(start);
      }}
      onPointerMove={(event) => {
        const active = drag.current;
        if (!active || active.pointerId !== event.pointerId) return;
        const width = active.start[column] + (event.clientX - active.startX) * (column === 'content' ? 1 : -1);
        active.latest = resizeWorkspaceColumn(active.start, column, width, availableWidth, docked);
        setPreviewWidths(active.latest);
      }}
      onPointerUp={finish} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}
      onDoubleClick={() => { cancelDrag(); publish({ ...preferred, [column]: DEFAULT_WORKSPACE_LAYOUT_WIDTHS[column] }); }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && drag.current) { event.preventDefault(); cancelDrag(); return; }
        if (drag.current) return;
        const delta = workspaceColumnKeyboardDelta(column, event.key, event.shiftKey);
        if (delta === null && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        const next = event.key === 'Home' ? WORKSPACE_COLUMN_LIMITS[column].min
          : event.key === 'End' ? workspaceColumnMaximum(column, availableWidth, fitted, docked) : fitted[column] + delta!;
        publish(resizeWorkspaceColumn(preferred, column, next, availableWidth, docked));
      }} />;
  };
  return <div className={`project-workspace workspace-layout-experience ${compact ? 'workspace-layout-compact' : ''} ${props.surface === 'editor' ? 'workspace-editor-mode' : ''} ${canvasMode ? 'workspace-canvas-mode' : ''} ${assistantVisible ? 'workspace-with-assistant' : ''} ${collapsed ? 'workspace-with-collapsed-assistant' : ''}`}
    data-resizing={previewWidths ? 'true' : undefined}>
    <header className="workspace-topbar">
      <button className="workspace-icon" title="返回项目" aria-label="返回项目" onClick={props.onBack}><ArrowLeft size={18} /></button>
      <h1 title={props.projectName}>{props.projectName}</h1>
      <nav aria-label="项目工作面">
        <button aria-label="列表视图" title="工坊" aria-current={props.surface === 'media' && !canvasMode ? 'page' : undefined}
          onClick={() => { props.onSurface('media'); props.onMediaView?.('list'); }}>工坊</button>
        {props.onMediaView && <button aria-label="画布视图" title="画布" aria-current={canvasMode ? 'page' : undefined}
          onClick={() => { props.onSurface('media'); props.onMediaView?.('canvas'); }}>画布</button>}
        {([['editor', '剪辑'], ['documents', '文档']] as const).map(([surface, label]) => <button
          key={surface} aria-current={props.surface === surface ? 'page' : undefined} onClick={() => props.onSurface(surface)}>{label}</button>)}
      </nav>
      <button className="workspace-spec-summary" title={props.specSummary} onClick={props.onSpec}>{props.specSummary}</button>
      {props.projectActions}
      {props.surface === 'media' && !canvasMode && props.onNewMaterial && <div className="workspace-new-material">
        <button className="workspace-icon" title="新建素材" aria-label="新建素材" aria-expanded={newMaterialOpen} onClick={() => setNewMaterialOpen(!newMaterialOpen)}><Plus size={17} /></button>
        {newMaterialOpen && <div role="menu" aria-label="新建素材类型">{(['image', 'video'] as const).map((type) => <button role="menuitem" key={type} onClick={() => {
          setNewMaterialOpen(false); props.onNewMaterial?.(type);
        }}>{type === 'image' ? '图片素材' : '视频素材'}</button>)}</div>}
      </div>}
      <button className="workspace-directory-toggle workspace-icon" title="项目目录" aria-label="项目目录" aria-expanded={directoryOpen} onClick={() => { setDirectoryOpen(!directoryOpen); setRequestedAssistant(false); }}><List size={18} /></button>
      <button className="workspace-icon" title="项目助手" aria-label="项目助手" aria-expanded={assistantVisible} onClick={() => {
        if (assistantVisible) props.onAssistantState('hidden');
        else { props.onAssistantState('expanded'); setRequestedAssistant(true); setDirectoryOpen(false); }
      }}><MessageSquare size={18} /></button>
      <button className="workspace-export" onClick={props.onExport}>导出</button>
    </header>
    <div ref={columnsRef} className="workspace-columns" style={{ gridTemplateColumns: tracks }}>
      <aside id={contentId} style={docked.content ? { gridColumn: 1, gridRow: 1 } : undefined} className={`workspace-content-column ${directoryOpen ? 'workspace-overlay-open' : ''}`} aria-label="项目内容" aria-hidden={!docked.content && !directoryOpen}>
        {!docked.content && <div className="workspace-overlay-heading"><span>项目内容</span><button className="workspace-icon" aria-label="关闭目录" onClick={() => setDirectoryOpen(false)}><X size={16} /></button></div>}
        {props.content}
      </aside>
      {docked.content && separator('content')}
      <main className="workspace-inspector-column" style={{ gridColumn: docked.content ? 3 : 1, gridRow: 1 }}>
        {canvasMode ? props.canvas : <div className="workspace-shared-inspector">
          {props.inspector}
        </div>}
      </main>
      {docked.assistant && separator('assistant')}
      {collapsed && <button className="workspace-collapsed-rail" style={{ gridColumn: docked.content ? 5 : 3, gridRow: 1 }} title="展开项目助手" aria-label="展开项目助手" onClick={() => props.onAssistantState('expanded')}><ChevronRight size={18} /></button>}
      <aside id={assistantId} style={docked.assistant ? { gridColumn: docked.content ? 5 : 3, gridRow: 1 } : undefined} className={`workspace-assistant-column ${assistantVisible ? 'workspace-assistant-visible' : ''} ${largeAssistant ? 'workspace-assistant-large' : ''}`} aria-label="项目助手列" aria-hidden={!assistantVisible}>
        <header className="workspace-assistant-heading"><h2>对话</h2>
          <button className="workspace-icon" title={largeAssistant ? '还原助手' : '放大助手'} aria-label={largeAssistant ? '还原助手' : '放大助手'} onClick={() => setLargeAssistant(!largeAssistant)}>{largeAssistant ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
          <button className="workspace-icon" title="收起助手" aria-label="收起助手" onClick={() => { props.onAssistantState('collapsed'); setRequestedAssistant(false); }}><PanelRightClose size={16} /></button>
          <button className="workspace-icon" title="隐藏助手" aria-label="隐藏助手" onClick={() => props.onAssistantState('hidden')}><X size={16} /></button>
        </header>
        <div className="workspace-assistant-body" data-agent-context-target={canvasMode ? 'canvas-node-agent' : undefined}>{props.assistant}</div>
      </aside>
    </div>
  </div>;
}
