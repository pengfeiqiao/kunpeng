import { memo, useEffect, useMemo, useState } from 'react';
import ReactFlow, { Background, Controls, type Node, type NodeProps, type ReactFlowInstance, applyNodeChanges } from 'reactflow';
import { Image as ImageIcon, LocateFixed, MessageSquarePlus, Video, Music, MoreHorizontal, Eye } from 'lucide-react';
import { setWorkspaceCanvasVisibility } from '@/lib/workspace/visibility';
import type { WorkshopData } from '@/lib/workshop/types';
import type { WorkspaceContentItem } from '@/lib/workspace/contentModel';
import { workspaceContentGroups } from '@/lib/workspace/contentModel';
import { workspaceMediaVersions, type WorkspaceMediaVersion } from '@/lib/workspace/mediaView';
import { moveWorkspaceObject, reconcileWorkspaceCanvasLayout, type WorkspaceCanvasLayout } from '@/lib/workspace/canvasLayout';
import type { WorkspaceOutputType } from '@/lib/workspace/types';
import 'reactflow/dist/style.css';

interface CardData {
  item: WorkspaceContentItem;
  media: WorkspaceMediaVersion[];
  pending: boolean;
  selectedMediaId?: string;
  mediaSrc: (path: string) => string;
  onMedia: (objectId: string, mediaId: string, type: WorkspaceOutputType) => void;
  onAddToChat: (objectId: string) => void;
  onObjectMenu?: (objectId: string) => void;
}

const ObjectCard = memo(function ObjectCard({ data, selected }: NodeProps<CardData>) {
  return <article className={`workspace-object-card ${selected ? 'workspace-object-selected' : ''}`} aria-label={`画布对象 ${data.item.label}`}>
    <header><strong>{data.item.shotNo ? `${data.item.shotNo} · ` : ''}{data.item.label}</strong>
      <button className="nodrag workspace-icon" title="添加对象到对话" aria-label={`添加${data.item.label}到对话`} onClick={() => data.onAddToChat(data.item.id)}><MessageSquarePlus size={14} /></button>
      {data.onObjectMenu && <button className="nodrag workspace-icon" title="对象操作" aria-label={`${data.item.label}操作`} onClick={() => data.onObjectMenu?.(data.item.id)}><MoreHorizontal size={14} /></button>}
    </header>
    <div className="workspace-object-summary"><span>{data.item.durationSec ? `${data.item.durationSec}秒 · ` : ''}{data.item.status}</span>{data.pending && <span>待整理</span>}</div>
    <p title={data.item.description}>{data.item.description || data.item.label}</p>
    <div className="nodrag nowheel workspace-object-media" aria-label={`${data.item.label}媒体组`}>
      {data.media.map((item) => <button key={item.media.id} title={`${item.media.mediaType} v${item.ordinal}${item.adopted ? ' 已采用' : ' 待选'}`}
        aria-label={`预览${data.item.label}${item.media.mediaType === 'image' ? '图片' : item.media.mediaType === 'video' ? '视频' : '音频'}v${item.ordinal}`}
        aria-pressed={selected && data.selectedMediaId === item.media.id}
        onClick={(event) => { event.stopPropagation(); const type = item.media.mediaType;
          if (type === 'image' || type === 'video' || type === 'audio') data.onMedia(data.item.id, item.media.id, type); }}>
        {item.media.mediaType === 'image' ? <img src={data.mediaSrc(item.media.path)} alt="" loading="lazy" draggable={false} />
          : <span className="workspace-object-media-placeholder">{item.media.mediaType === 'video' ? <Video size={24} /> : <Music size={24} />}{item.media.mediaType === 'video' ? '视频' : '音频'}</span>}
        <span>v{item.ordinal}{item.adopted ? ' · 已采用' : ' · 待选'}</span>
      </button>)}
      {!data.media.length && <div className="workspace-object-no-media"><ImageIcon size={24} /><span>暂无媒体</span></div>}
    </div>
  </article>;
});
const nodeTypes = { 'workspace-object': ObjectCard };

interface Props {
  data: WorkshopData;
  layout: WorkspaceCanvasLayout;
  onLayout: (layout: WorkspaceCanvasLayout) => boolean;
  selectedId?: string;
  selectedMediaId?: string;
  onSelect: (id: string) => void;
  onMedia: CardData['onMedia'];
  onAddToChat: CardData['onAddToChat'];
  onObjectMenu?: CardData['onObjectMenu'];
  mediaSrc: CardData['mediaSrc'];
}

/** ReactFlow is a projection of project owners; persisted records contain only layout. */
export default function ProjectObjectCanvas(props: Props) {
  const items = useMemo(() => workspaceContentGroups(props.data).flatMap((group) => group.items), [props.data]);
  const layout = useMemo(() => reconcileWorkspaceCanvasLayout(props.layout, items.map((item) => item.id)), [props.layout, items]);
  const [flow, setFlow] = useState<ReactFlowInstance | null>(null);
  const projected = useMemo(() => items.filter((item) => !layout.positions[item.id].hidden).map((item): Node<CardData> => ({
    id: item.id, type: 'workspace-object', position: { x: layout.positions[item.id].x, y: layout.positions[item.id].y },
    selected: item.id === props.selectedId, width: 264, height: 252, dragHandle: '.workspace-object-card header',
    style: { width: 264, height: 252 }, data: { item, pending: layout.positions[item.id].pending,
      media: (item.kind === 'shot' ? ['image', 'video'] as const : [item.preferredOutputType ?? 'image']).flatMap((type) => workspaceMediaVersions(props.data, item.id, type)),
      selectedMediaId: props.selectedMediaId, mediaSrc: props.mediaSrc, onMedia: props.onMedia, onAddToChat: props.onAddToChat, onObjectMenu: props.onObjectMenu },
  })), [items, layout, props.data, props.selectedId, props.selectedMediaId, props.mediaSrc, props.onMedia, props.onAddToChat, props.onObjectMenu]);
  const [nodes, setNodes] = useState(projected);
  useEffect(() => { setNodes(projected); }, [projected]);
  useEffect(() => { if (layout !== props.layout) props.onLayout(layout); }, [layout, props.layout, props.onLayout]);
  const locate = () => {
    const position = props.selectedId && layout.positions[props.selectedId];
    if (position && position.hidden && props.selectedId) props.onLayout(setWorkspaceCanvasVisibility(layout, props.selectedId, true));
    if (position && flow) void flow.setCenter(position.x + 132, position.y + 126, { zoom: 1, duration: 150 });
  };
  return <section className="workspace-object-canvas" aria-label="项目对象画布">
    <div className="workspace-canvas-tools"><span>待整理 {items.filter((item) => layout.positions[item.id].pending && !layout.positions[item.id].hidden).length}</span>
      <button className="workspace-icon" aria-label="定位当前对象" title="定位当前对象" onClick={locate}><LocateFixed size={17} /></button>
      {items.some((item) => layout.positions[item.id].hidden) && <button className="workspace-icon" aria-label="显示已移除的画布对象" title="显示已移除的画布对象" onClick={() => props.onLayout(items.reduce((current, item) => setWorkspaceCanvasVisibility(current, item.id, true), layout))}><Eye size={17} /></button>}
    </div>
    <ReactFlow nodes={nodes} edges={[]} nodeTypes={nodeTypes} onlyRenderVisibleElements minZoom={0.15} maxZoom={2}
      defaultViewport={layout.viewport ?? { x: 32, y: 24, zoom: 0.85 }} deleteKeyCode={null} nodesConnectable={false} selectionOnDrag
      onInit={(instance) => { setFlow(instance); const position = props.selectedId && layout.positions[props.selectedId];
        if (position) void instance.setCenter(position.x + 132, position.y + 126, { zoom: layout.viewport?.zoom ?? 0.85 }); }}
      onNodesChange={(changes) => setNodes((current) => applyNodeChanges(changes.filter((change) => change.type !== 'remove'), current))}
      onNodeClick={(_event, node) => props.onSelect(node.id)}
      onNodeDragStop={(_event, node, dragged) => props.onLayout((dragged.length ? dragged : [node])
        .reduce((current, item) => moveWorkspaceObject(current, item.id, item.position), layout))}
      onMoveEnd={(_event, viewport) => props.onLayout({ ...layout, viewport })}>
      <Background gap={24} size={1} color="#3b3e41" /><Controls showInteractive={false} />
    </ReactFlow>
  </section>;
}
