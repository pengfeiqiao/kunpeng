import { useEffect, useId, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, FileText, Image as ImageIcon, LockKeyhole, MessageSquarePlus, Search, X } from 'lucide-react';
import type { WorkspaceContentGroup, WorkspaceContentItem } from '@/lib/workspace/contentModel';
import { workspaceContentTree } from '@/lib/workspace/contentTree';
import WorkspaceVisibleItem from './WorkspaceVisibleItem';
import './workspace.css';
import './contentTree.css';

interface Props {
  groups: WorkspaceContentGroup[];
  selectedId?: string;
  mediaSrc: (path: string) => string;
  onSelect: (objectId: string) => void;
  onAddToChat: (objectIds: string[]) => void;
  mediaGroup?: ReactNode;
  renderMediaGroup?: (item: WorkspaceContentItem) => ReactNode;
  onObjectMenu?: (objectId: string, position: { x: number; y: number }) => void;
  onBackgroundMenu?: (position: { x: number; y: number }) => void;
  onGroupMenu?: (groupId: string, position: { x: number; y: number }) => void;
  onDragObject?: (objectId: string, transfer: DataTransfer) => void;
  onScriptTools?: () => void;
  scriptActive?: boolean;
  scriptExcerpt?: string;
  /** 头部下方的醒目操作区（如"传入画布"） */
  headerAction?: ReactNode;
}

function ContentExcerpt({ text, label }: { text: string; label: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(() => text.length > 96 || text.split('\n').length > 3);
  const paragraph = useRef<HTMLParagraphElement>(null);
  const id = useId();
  useEffect(() => {
    const element = paragraph.current;
    if (!element || expanded) return;
    const measure = () => {
      if (element.clientHeight > 0) setOverflow(element.scrollHeight > element.clientHeight + 1);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [text, expanded]);
  return <div className="workspace-tree-excerpt">
    <p ref={paragraph} id={id} className="workspace-tree-excerpt-text" data-expanded={expanded}>{text}</p>
    {(overflow || expanded) && <button type="button" className="workspace-tree-text-action workspace-tree-excerpt-toggle"
      aria-label={(expanded ? '收起' : '展开') + label} aria-expanded={expanded} aria-controls={id}
      onClick={() => setExpanded(!expanded)}>{expanded ? '收起' : '展开'}<ChevronDown size={12} /></button>}
  </div>;
}

export default function ProjectContentList(props: Props) {
  const [query, setQuery] = useState('');
  // 分区默认全部收起，由用户显式展开；新出现的分区同样默认收起
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(
    workspaceContentTree(props.groups).flatMap((section) => [section.id, ...section.groups.map((group) => group.id)])));
  const [expandedObjects, setExpandedObjects] = useState<Set<string>>(() => new Set());
  const [checked, setChecked] = useState<string[]>([]);
  const selectionAnchor = useRef<string | null>(null);
  const validIds = useMemo(() => new Set(props.groups.flatMap((group) => group.items.map((item) => item.id))), [props.groups]);
  const selection = checked.filter((id) => validIds.has(id));
  const search = query.trim().toLocaleLowerCase();
  const tree = useMemo(() => workspaceContentTree(props.groups), [props.groups]);
  // 只在打开项目（组件按项目 key 重挂载）时默认全关；会话进行中出现的分区不再触碰布局，避免抖动
  const sections = tree.map((section) => ({ ...section, groups: section.groups.map((group) => ({ ...group,
    items: group.items.filter((item) => (section.label + ' ' + group.label + ' ' + item.label + ' ' + item.description + ' ' + (item.shotNo ?? '')).toLocaleLowerCase().includes(search)),
  })).filter((group) => group.items.length) })).filter((section) => !search || section.groups.length);
  const visibleIds = [...new Set(sections.flatMap((section) => search || !collapsed.has(section.id)
    ? section.groups.flatMap((group) => !section.nested || search || !collapsed.has(group.id) ? group.items.map((item) => item.id) : []) : []))];
  const toggle = (id: string) => setCollapsed((old) => { const next = new Set(old); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const renderItem = (item: WorkspaceContentItem) => {
    const selected = props.selectedId === item.id;
    const expanded = expandedObjects.has(item.id) || (selected && !collapsed.has('object:' + item.id));
    const select = (event?: MouseEvent<HTMLButtonElement>) => {
      if (event?.metaKey || event?.ctrlKey || event?.shiftKey) {
        event.preventDefault();
        const base = selection.length ? selection : props.selectedId && visibleIds.includes(props.selectedId) ? [props.selectedId] : [];
        if (event.shiftKey) {
          const anchor = selectionAnchor.current && visibleIds.includes(selectionAnchor.current) ? selectionAnchor.current
            : props.selectedId && visibleIds.includes(props.selectedId) ? props.selectedId : item.id;
          const start = visibleIds.indexOf(anchor); const end = visibleIds.indexOf(item.id);
          const range = visibleIds.slice(Math.min(start, end), Math.max(start, end) + 1);
          setChecked([...new Set([...(event.metaKey || event.ctrlKey ? base : []), ...range])]);
          selectionAnchor.current = anchor;
        } else {
          setChecked(base.includes(item.id) ? base.filter((id) => id !== item.id) : [...base, item.id]);
          selectionAnchor.current = item.id;
        }
        return;
      }
      setChecked([]); selectionAnchor.current = item.id;
      props.onSelect(item.id);
      setCollapsed((old) => { const next = new Set(old); next.delete('object:' + item.id); return next; });
      setExpandedObjects((old) => new Set([...old, item.id]));
    };
    return <WorkspaceVisibleItem key={item.id} selected={selected || selection.includes(item.id)}><article className={'workspace-content-item ' + (item.kind === 'shot' ? 'workspace-content-shot ' : '') + (selected ? 'workspace-content-selected' : '')}
      data-batch-selected={selection.includes(item.id) || undefined}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); props.onObjectMenu?.(item.id, { x: event.clientX, y: event.clientY }); }}
      draggable={Boolean(props.onDragObject)} onDragStart={(event) => props.onDragObject?.(item.id, event.dataTransfer)}>
      <div className="workspace-content-item-line">
        <button className="workspace-tree-toggle" aria-label={(expanded ? '收起' : '展开') + item.label + '素材'} aria-expanded={expanded} onClick={() => {
          setExpandedObjects((old) => { const next = new Set(old); expanded ? next.delete(item.id) : next.add(item.id); return next; });
          setCollapsed((old) => { const next = new Set(old); expanded ? next.add('object:' + item.id) : next.delete('object:' + item.id); return next; });
        }}><ChevronRight size={13} /></button>
        <button className="workspace-content-open" aria-label={'打开' + item.label} aria-current={selected ? 'true' : undefined}
          aria-pressed={selection.includes(item.id)} title="单击打开；Cmd/Ctrl 点击多选，Shift 点击连续选择" onClick={select}>
          {item.thumbnailPath ? <img src={props.mediaSrc(item.thumbnailPath)} alt="" loading="lazy" /> : <span className="workspace-content-placeholder"><ImageIcon size={16} /></span>}
          <span className="workspace-content-copy"><span title={item.kind === 'shot' ? item.description || item.label : item.label}>{(item.displayNo ?? item.shotNo) && <span className="workspace-shot-number">{item.displayNo ?? item.shotNo}</span>}{item.kind === 'shot' ? item.description || item.label : item.label}</span><small>{item.kind === 'shot' ? (item.durationSec === undefined ? '时长未定' : item.durationSec + '秒') + ' · ' : ''}{item.status}</small></span>
          {item.locked && <LockKeyhole size={12} aria-label="已锁定" />}
        </button>
      </div>
      {expanded && <div className="workspace-content-details workspace-tree-reveal">{item.description && <ContentExcerpt key={item.description} text={item.description} label={item.label + '描述'} />}
        {props.renderMediaGroup ? props.renderMediaGroup(item) : selected ? props.mediaGroup : <button className="workspace-tree-text-action" onClick={select}>查看素材</button>}
      </div>}
    </article></WorkspaceVisibleItem>;
  };
  return <section className="workspace-content-list workspace-content-tree" aria-label="项目内容列表" onContextMenu={(event) => {
    const target = event.target as HTMLElement;
    if (!target.matches('.workspace-content-list, .workspace-content-scroll, .workspace-tree-section, .workspace-content-group, .workspace-group-items, .workspace-tree-reveal')
      || target.closest('article, button, input, textarea, select, a')) return;
    if (props.onBackgroundMenu) { event.preventDefault(); event.stopPropagation(); props.onBackgroundMenu({ x: event.clientX, y: event.clientY }); }
  }}>
    <header><h2>项目内容</h2><label className="workspace-content-search"><Search size={14} /><input aria-label="搜索项目内容" placeholder="搜索" value={query} onChange={(event) => setQuery(event.target.value)} /></label></header>
    {props.headerAction}
    {selection.length > 0 && <div className="workspace-batch-bar" aria-label="多选工具"><span>已选 {selection.length} 项</span>
      <button className="workspace-icon" title="批量添加到对话" aria-label="批量添加到对话" onClick={() => props.onAddToChat(selection)}><MessageSquarePlus size={16} /></button>
      <button className="workspace-icon" title="取消多选" aria-label="取消多选" onClick={() => { setChecked([]); selectionAnchor.current = null; }}><X size={16} /></button></div>}
    <div className="workspace-content-scroll">
      {props.onScriptTools && <section className="workspace-tree-section">
        <button className="workspace-group-heading workspace-tree-heading" aria-expanded={!collapsed.has('script')} onClick={() => toggle('script')}><ChevronRight size={14} /><span>剧本</span><FileText size={14} /></button>
        {!collapsed.has('script') && <div className="workspace-tree-reveal workspace-tree-script">
          {props.scriptExcerpt && <ContentExcerpt key={props.scriptExcerpt} text={props.scriptExcerpt} label="剧本摘录" />}
          <button className="workspace-tree-script-open" aria-current={props.scriptActive ? 'page' : undefined} onClick={props.onScriptTools}><FileText size={15} /><span>{props.scriptExcerpt ? '原剧本与拆解' : '创作与拆解剧本'}</span><ChevronRight size={14} /></button>
        </div>}
      </section>}
      {sections.map((section) => {
        const expanded = Boolean(search) || !collapsed.has(section.id);
        return <section className="workspace-tree-section" key={section.id}>
          <button className="workspace-group-heading workspace-tree-heading" title={section.label} aria-expanded={expanded} onClick={() => toggle(section.id)}
            onContextMenu={(event) => { if (props.onGroupMenu) { event.preventDefault(); event.stopPropagation(); props.onGroupMenu(section.id, { x: event.clientX, y: event.clientY }); } }}><ChevronRight size={14} /><span>{section.label}</span><small>{section.groups.reduce((count, group) => count + group.items.length, 0)}</small></button>
          {expanded && <div className="workspace-tree-reveal">{section.groups.map((group) => <section className={'workspace-content-group ' + (section.nested ? 'workspace-tree-subgroup' : '')} key={group.id}>
            {section.nested && <button className="workspace-group-heading" title={group.label} aria-expanded={Boolean(search) || !collapsed.has(group.id)} onClick={() => toggle(group.id)}
              onContextMenu={(event) => { if (props.onGroupMenu) { event.preventDefault(); event.stopPropagation(); props.onGroupMenu(group.id, { x: event.clientX, y: event.clientY }); } }}>{collapsed.has(group.id) && !search ? <ChevronRight size={13} /> : <ChevronDown size={13} />}<span>{group.label}</span><small>{group.items.length}</small></button>}
            {(!section.nested || search || !collapsed.has(group.id)) && <div className="workspace-group-items">{group.items.map(renderItem)}</div>}
          </section>)}{!section.groups.length && <p className="workspace-tree-empty">暂无分镜</p>}</div>}
        </section>;
      })}
      {search && !sections.length && <p className="workspace-content-empty">没有匹配的内容</p>}
    </div>
  </section>;
}
