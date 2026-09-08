import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronUp, ChevronDown, Download, FileText, FolderInput, Image as ImageIcon, LayoutGrid, Maximize2, MessageSquarePlus, MoreHorizontal, Pencil, RefreshCw, X } from 'lucide-react';
import type { WorkspaceMediaVersion } from '@/lib/workspace/mediaView';
import { workspaceHistoricalParameters } from '@/lib/workspace/mediaView';
import { workspaceEngine } from '@/lib/workspace/engineCatalog';
import './workspace.css';
import './promptExperience.css';

interface Props {
  title: string;
  versions: WorkspaceMediaVersion[];
  selected?: WorkspaceMediaVersion;
  composer?: ReactNode;
  mediaSrc: (path: string) => string;
  onSelect: (mediaId: string) => void;
  onAdopt: (versionId: string) => void;
  onPrompt: () => void;
  onEdit: () => void;
  onAddToChat: () => void;
  onClassify?: () => void;
  canGenerate?: boolean;
  /** 按当前草稿原样再生成（走同一草稿与确认链）。 */
  onRegenerate?: () => void;
  busy?: boolean;
  /** 同组镜头/素材前后导航。 */
  onNavigate?: (direction: -1 | 1) => void;
  navigateLabel?: string;
  /** 画布同款媒体工具（高清放大/超分/帧率/人声分离等） */
  tools?: { id: string; label: string }[];
  /** 单素材传入画布（待整理区） */
  onSendToCanvas?: () => void;
  onTool?: (toolId: string) => void;
}

export default function MediaInspector(props: Props) {
  const { selected, versions } = props;
  const media = selected?.media;
  const engineId = selected?.version?.engineId ?? selected?.snapshot?.engineId;
  const engineLabel = (engineId && (workspaceEngine(engineId)?.label ?? engineId)) || '';
  const specLabel = workspaceHistoricalParameters(selected?.version, selected?.snapshot);
  const [fullscreen, setFullscreen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  useEffect(() => {
    if (!fullscreen) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setFullscreen(false); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [fullscreen]);
  return <section className={`workspace-inspector workspace-prompt-inspector ${props.composer ? 'workspace-inspector-editing' : ''}`} aria-label="媒体预览器">
    <header className="workspace-inspector-topbar">
      <span className="workspace-inspector-crumb">预览<span className="workspace-inspector-crumb-name" title={props.title}>{props.title}</span></span>
      {selected?.adopted && <span className="workspace-adopted"><Check size={13} />已采用</span>}
    </header>
    <div className="workspace-inspector-chips">
      {engineLabel ? <span className="workspace-chip">{engineLabel}</span> : <span className="workspace-chip workspace-chip-muted">{media ? '历史素材' : '尚无媒体'}</span>}
      {specLabel && <span className="workspace-chip">{specLabel}</span>}
      {selected && <span className="workspace-chip workspace-chip-muted">v{selected.ordinal}</span>}
    </div>
    <div className="workspace-media-stage">
      {(media || props.onNavigate) && <div className="workspace-stage-tools">
        {media && media.mediaType !== 'audio' && <button title="放大预览" aria-label="放大预览" onClick={() => setFullscreen(true)}><Maximize2 size={14} /></button>}
        {media && <><button title="添加到对话" aria-label="添加到对话" onClick={props.onAddToChat}><MessageSquarePlus size={14} /></button>
          {props.onSendToCanvas && <button title="传入画布" aria-label="传入画布" onClick={props.onSendToCanvas}><LayoutGrid size={14} /></button>}
          <a title="下载原文件" aria-label="下载原文件" href={props.mediaSrc(media.path)} download><Download size={14} /></a></>}
        {media?.purpose === 'unclassified' && props.onClassify && <button title="归类素材" aria-label="归类素材" onClick={props.onClassify}><FolderInput size={14} /></button>}
        {media && props.tools && props.tools.length > 0 && <button title="更多工具" aria-label="更多工具" aria-expanded={toolsOpen} onClick={() => setToolsOpen(!toolsOpen)}><MoreHorizontal size={14} /></button>}
        {toolsOpen && props.tools && <div className="workspace-stage-tools-menu" role="menu" aria-label="媒体工具">
          {props.tools.map((tool) => <button key={tool.id} role="menuitem" onClick={() => { setToolsOpen(false); props.onTool?.(tool.id); }}>{tool.label}</button>)}
        </div>}
      </div>}
      {props.onNavigate && <>
        <button className="workspace-stage-nav workspace-stage-nav-prev" title={`上一个${props.navigateLabel ?? '对象'}`} aria-label={`上一个${props.navigateLabel ?? '对象'}`} onClick={() => props.onNavigate!(-1)}><ChevronUp size={18} /></button>
        <button className="workspace-stage-nav workspace-stage-nav-next" title={`下一个${props.navigateLabel ?? '对象'}`} aria-label={`下一个${props.navigateLabel ?? '对象'}`} onClick={() => props.onNavigate!(1)}><ChevronDown size={18} /></button>
      </>}
      {media?.mediaType === 'video' ? <video key={media.id} src={props.mediaSrc(media.path)} controls preload="metadata" playsInline onDoubleClick={() => setFullscreen(true)} />
        : media?.mediaType === 'image' ? <img key={media.id} src={props.mediaSrc(media.path)} alt={props.title} onDoubleClick={() => setFullscreen(true)} />
          : media?.mediaType === 'audio' ? <audio key={media.id} src={props.mediaSrc(media.path)} controls preload="metadata" />
            : <div className="workspace-media-empty"><ImageIcon size={28} /><span>尚未生成</span></div>}
    </div>
    {fullscreen && media && media.mediaType !== 'audio' && createPortal(<div className="workspace-media-fullscreen" role="dialog" aria-label="全屏预览" onClick={() => setFullscreen(false)}>
      <button type="button" className="workspace-media-fullscreen-close" aria-label="关闭全屏预览" title="关闭（Esc）"
        onClick={(event) => { event.stopPropagation(); setFullscreen(false); }}><X size={18} /></button>
      {media.mediaType === 'video'
        ? <video src={props.mediaSrc(media.path)} controls autoPlay playsInline onClick={(event) => event.stopPropagation()} />
        : <img src={props.mediaSrc(media.path)} alt={props.title} />}
    </div>, document.body)}
    {versions.length > 0 && <div className="workspace-version-toolbar">
      <div className="workspace-version-strip" aria-label="媒体版本">
        {versions.map((item) => <button key={item.media.id} onClick={() => props.onSelect(item.media.id)}
          aria-label={`查看v${item.ordinal}${item.adopted ? '已采用' : '候选'}`} aria-pressed={item.media.id === media?.id}>
          {item.media.mediaType === 'image' ? <img src={props.mediaSrc(item.media.path)} alt="" loading="lazy" /> : <span className="workspace-version-type">{item.media.mediaType === 'video' ? '视频' : '音频'}</span>}
          <span>v{item.ordinal}{item.adopted ? ' · 已采用' : ' · 待选'}</span>
        </button>)}
      </div>
      {selected?.version && media?.purpose !== 'unclassified' && !selected.adopted && <button className="workspace-adopt-button" onClick={() => props.onAdopt(selected.version!.id)}>采用此版</button>}
    </div>}
    {!props.composer && props.canGenerate !== false && <div className="workspace-inspector-actionbar">
      <button className="workspace-pill" onClick={props.onEdit} aria-label="让助手修改"><Pencil size={13} /><span>让助手修改</span></button>
      {props.onSendToCanvas && <button className="workspace-pill" onClick={props.onSendToCanvas} aria-label="传入画布"><LayoutGrid size={13} /><span>传入画布</span></button>}
      <button className="workspace-pill workspace-pill-accent" onClick={props.onPrompt}><FileText size={13} />提示词</button>
      {props.onRegenerate && <button className="workspace-pill" onClick={props.onRegenerate} disabled={props.busy}><RefreshCw size={13} />{media ? '重新生成' : '生成'}</button>}
    </div>}
    {!props.composer && props.canGenerate === false && <div className="workspace-inspector-actions">
      <button onClick={props.onPrompt}><FileText size={15} />提示词</button>
    </div>}
    {props.composer && <div className="workspace-inspector-composer">{props.composer}</div>}
  </section>;
}
