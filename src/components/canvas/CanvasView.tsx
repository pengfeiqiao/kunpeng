import { useCallback, useState, useRef, useEffect } from 'react';
import ReactFlow, { MiniMap, Background, BackgroundVariant, ReactFlowProvider, useReactFlow, SelectionMode } from 'reactflow';
import type { Connection, Node, NodeChange, NodePositionChange } from 'reactflow';
import 'reactflow/dist/style.css';
import '@reactflow/node-resizer/dist/style.css';
import { useCanvasStore } from '@/stores/canvasStore';
import { nanoid } from 'nanoid';
import TextNode from './nodes/TextNode';
import ImageNode from './nodes/ImageNode';
import VideoNode from './nodes/VideoNode';
import AudioNode from './nodes/AudioNode';
import GroupNode from './nodes/GroupNode';
import PanoramaNode from './nodes/PanoramaNode';
import CustomEdge from './edges/CustomEdge';
import CanvasChatBubble from './CanvasChatBubble';
import FloatingMenu from './FloatingMenu';
import NodePalette from './NodePalette';
import CanvasToolbar from './CanvasToolbar';
import NodeInfoBar from './NodeInfoBar';
import TaskQueuePanel from './TaskQueuePanel';
import { useDirectorStore } from '@/stores/directorStore';
import type { DirectorOrigin } from '@/lib/director/types';
import ArtifactPickerPanel from './ArtifactPickerPanel';
import CanvasContextMenu, { type ContextMenuState } from './CanvasContextMenu';
import type { FloatingMenuTarget } from './FloatingMenu';
import MaskPaintEditor, { type MaskToolMode } from './MaskPaintEditor';
import { lazy, Suspense } from 'react';

const DirectorStage = lazy(() => import('../director/DirectorStage'));
import SelectionToolbar from './SelectionToolbar';
import NodeAgentTransferEffect from './NodeAgentTransferEffect';
import MultiImageMarker from './MultiImageMarker';
import TimelinePanel, { type TimelineClip } from './TimelinePanel';
import VideoFrameCapture from './VideoFrameCapture';
import { breakdownVideo } from '@/lib/canvas/videoBreakdown';
import { AnimatePresence } from 'framer-motion';
import AssetLibraryPanel from './AssetLibraryPanel';
import { toggleAsset, useSelectedAssets } from '@/lib/canvas/selectedAssets';
import HelperLines from './HelperLines';
import ImageFullscreenViewer from './ImageFullscreenViewer';
import ProjectSwitcher from '../projects/ProjectSwitcher';
import { CANVAS_THEME } from '@/lib/canvas/theme';
import { getHelperLines } from '@/lib/canvas/helperLines';
import { captureSnapshot } from '@/lib/canvas/history';
import { defaultNodeStyle, estimateNodeSize } from '@/lib/canvas/layout';
import { useCanvasShortcuts } from '@/hooks/useCanvasShortcuts';
import AiBoxOverlay, { type AiBoxRect } from '@/components/shared/AiBoxOverlay';
import { appWindow } from '@tauri-apps/api/window';
import { CANVAS_MEDIA_EXTENSIONS, createMediaNodesFromPaths } from '@/lib/canvas/mediaImport';

const nodeTypes = { text: TextNode, image: ImageNode, video: VideoNode, audio: AudioNode, group: GroupNode, panorama: PanoramaNode };
const edgeTypes = { custom: CustomEdge };
const defaultEdgeOptions = { type: 'custom', style: { strokeWidth: 1.5, stroke: CANVAS_THEME.edge, opacity: 0.7 } };
const proOptions = { hideAttribution: true };
const BG = CANVAS_THEME.bg;

interface CanvasViewProps {
  onSendMessage: (content: string, filePaths?: string[]) => void;
  onAbort: () => void;
}

function CanvasViewInner({ onSendMessage, onAbort }: CanvasViewProps) {
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const onNodesChange = useCanvasStore((s) => s.onNodesChange);
  const onEdgesChange = useCanvasStore((s) => s.onEdgesChange);
  const onConnect = useCanvasStore((s) => s.onConnect);
  const setSelectedNodeId = useCanvasStore((s) => s.setSelectedNodeId);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();
  const nativeDropPointRef = useRef<{ x: number; y: number } | null>(null);
  const browserDragDepth = useRef(0);
  const [showArtifactPicker, setShowArtifactPicker] = useState(false);
  const [showAssetLibrary, setShowAssetLibrary] = useState(false);
  const [externalDragging, setExternalDragging] = useState(false);
  const selectedAssets = useSelectedAssets();

  const [altHeld, setAltHeld] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Alt') setAltHeld(true); };
    const up = (e: KeyboardEvent) => { if (e.key === 'Alt') setAltHeld(false); };
    const blur = () => setAltHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const handleAiBox = useCallback((rect: AiBoxRect, instruction: string) => {
    const container = reactFlowWrapper.current;
    if (!container) return;
    const box = container.getBoundingClientRect();
    const topLeft = screenToFlowPosition({ x: box.left + rect.x, y: box.top + rect.y });
    const bottomRight = screenToFlowPosition({ x: box.left + rect.x + rect.width, y: box.top + rect.y + rect.height });

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const absPos = (n: typeof nodes[number]) => {
      let x = n.position.x;
      let y = n.position.y;
      let cur = n.parentNode ? nodeMap.get(n.parentNode) : undefined;
      while (cur) {
        x += cur.position.x;
        y += cur.position.y;
        cur = cur.parentNode ? nodeMap.get(cur.parentNode) : undefined;
      }
      return { x, y };
    };

    const selected = nodes.filter((n) => {
      if (n.type === 'group') return false;
      const pos = absPos(n);
      const w = (n.width ?? 200);
      const h = (n.height ?? 150);
      return pos.x + w > topLeft.x && pos.x < bottomRight.x
          && pos.y + h > topLeft.y && pos.y < bottomRight.y;
    });
    const desc = selected.length > 0
      ? `用户在画布上框选了 ${selected.length} 个节点：${selected.map((n) => `${n.id}(${n.type})`).join(', ')}。\n指令：${instruction}`
      : `用户在画布空白区域画了一个框。\n指令：${instruction}`;
    onSendMessage(`[画布 AI 区域操作]\n${desc}`);
  }, [nodes, screenToFlowPosition, onSendMessage]);

  // FloatingMenu state
  const [floatingMenu, setFloatingMenu] = useState<{
    x: number; y: number; sourceX: number; sourceY: number;
    sourceNodeId: string; sourceNodeType: 'text' | 'image' | 'video' | 'group';
  } | null>(null);
  const connectingNodeRef = useRef<{ nodeId: string; handleType: string } | null>(null);
  const connectionMadeRef = useRef(false);

  const onConnectStart = useCallback((_: unknown, params: { nodeId: string | null; handleType: string | null }) => {
    if (params.nodeId) connectingNodeRef.current = { nodeId: params.nodeId, handleType: params.handleType || 'source' };
  }, []);

  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent) => {
    if (!connectingNodeRef.current) return;
    // If onConnect already fired, connection was made — skip menu
    if (connectionMadeRef.current) {
      connectionMadeRef.current = false;
      connectingNodeRef.current = null;
      return;
    }
    const target = (event as MouseEvent).target as HTMLElement;
    // If dropped on a handle (connection made), don't show menu
    if (target?.classList?.contains('react-flow__handle')) {
      connectingNodeRef.current = null;
      return;
    }
    const sourceNode = useCanvasStore.getState().nodes.find((n) => n.id === connectingNodeRef.current!.nodeId);
    if (!sourceNode || (sourceNode.type !== 'text' && sourceNode.type !== 'image' && sourceNode.type !== 'video' && sourceNode.type !== 'group')) {
      connectingNodeRef.current = null;
      return;
    }
    const clientX = 'clientX' in event ? event.clientX : event.changedTouches[0].clientX;
    const clientY = 'clientY' in event ? event.clientY : event.changedTouches[0].clientY;
    // Calculate source handle position
    const nodeEl = document.querySelector(`[data-id="${sourceNode.id}"]`);
    const handleEl = nodeEl?.querySelector('.react-flow__handle-right') as HTMLElement | null;
    const sourceRect = handleEl?.getBoundingClientRect();
    setFloatingMenu({
      x: clientX,
      y: clientY,
      sourceX: sourceRect ? sourceRect.left + sourceRect.width / 2 : clientX - 100,
      sourceY: sourceRect ? sourceRect.top + sourceRect.height / 2 : clientY,
      sourceNodeId: sourceNode.id,
      sourceNodeType: sourceNode.type as 'text' | 'image' | 'video' | 'group',
    });
    connectingNodeRef.current = null;
  }, []);

  const handleFloatingMenuSelect = useCallback((type: FloatingMenuTarget) => {
    if (!floatingMenu) return;
    const flowPos = screenToFlowPosition({ x: floatingMenu.x, y: floatingMenu.y });
    const newId = `node-${nanoid(8)}`;
    const store = useCanvasStore.getState();
    const sourceNode = store.nodes.find((n) => n.id === floatingMenu.sourceNodeId);
    const sourceData = sourceNode?.data as Record<string, unknown> | undefined;

    let data: Record<string, unknown> = { description: '' };
    if (type === 'image' && floatingMenu.sourceNodeType === 'text') {
      data = { description: sourceData?.description || sourceData?.generatedContent || '', generationMode: 'text-to-image' };
    } else if (type === 'image' && floatingMenu.sourceNodeType === 'image') {
      const imgUrl = (sourceData?.generatedImageUrl || sourceData?.referenceImage) as string | undefined;
      data = { description: '', referenceImage: '', generatedImageUrl: '', generationMode: 'image-to-image', referenceImages: imgUrl ? [{ url: imgUrl, name: '参考图' }] : [] };
    } else if (type === 'image' && floatingMenu.sourceNodeType === 'video') {
      // 视频→图片：不能把 mp4 URL 塞进 referenceImages（会被当图上传报错）。
      // 建空图片节点，靠连线让用户在视频节点上用「抽帧」功能取参考帧。
      data = { description: sourceData?.description || '', referenceImage: '', referenceImages: [] };
    } else if (type === 'video' && floatingMenu.sourceNodeType === 'image') {
      const imgUrl = (sourceData?.generatedImageUrl || sourceData?.referenceImage) as string | undefined;
      data = { imageUrl: imgUrl, description: '' };
    } else if (type === 'video' && floatingMenu.sourceNodeType === 'text') {
      data = { description: sourceData?.description || sourceData?.generatedContent || '' };
    } else if (type === 'video' && floatingMenu.sourceNodeType === 'video') {
      const videoUrl = sourceData?.generatedVideoUrl as string | undefined;
      data = { description: sourceData?.description || '', imageUrl: videoUrl };
    } else if (floatingMenu.sourceNodeType === 'group') {
      // 组 → 图/视频：成员图在生成时经连线整组并入参考，节点本体保持空
      data = type === 'image' ? { description: '', generationMode: 'image-to-image' } : { description: '' };
    }

    // 新目标类型的 data 组装
    if (type === 'text') {
      const srcUrl = (sourceData?.generatedImageUrl || sourceData?.referenceImage || sourceData?.generatedVideoUrl) as string | undefined;
      data = { description: `基于「${(sourceData?.description as string)?.slice(0, 20) || '素材'}」的文案`, generatedContent: '', sourceMediaUrl: srcUrl };
    } else if (type === 'panorama') {
      data = { description: (sourceData?.description as string) || '' };
    } else if (type === 'audio') {
      data = { description: '', audioMode: floatingMenu.sourceNodeType === 'video' ? 'separate' : 'music', sourceVideoNodeId: floatingMenu.sourceNodeType === 'video' ? floatingMenu.sourceNodeId : undefined };
    }

    const style = defaultNodeStyle(type);
    store.addNode({ id: newId, type, position: flowPos, data, ...(style ? { style } : {}) });
    store.onConnect({ source: floatingMenu.sourceNodeId, target: newId, sourceHandle: null, targetHandle: null });
    setFloatingMenu(null);
  }, [floatingMenu, screenToFlowPosition]);

  // Unified keyboard layer: delete/copy/paste/undo/group/select-all/fit.
  useCanvasShortcuts();

  // Right-click context menus + double-click interactions + helper lines
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [maskEdit, setMaskEdit] = useState<{ nodeId: string; imageUrl: string; mode: MaskToolMode } | null>(null);
  const [showDirector, setShowDirector] = useState(false);
  const [fullscreenMedia, setFullscreenMedia] = useState<{ url: string; type: 'image' | 'video' } | null>(null);
  const [markerImages, setMarkerImages] = useState<{ nodeId: string; url: string }[] | null>(null);
  const [timelineClips, setTimelineClips] = useState<TimelineClip[] | null>(null);
  const [frameCapture, setFrameCapture] = useState<{ nodeId: string; url: string } | null>(null);

  // Video toolbar dropdowns dispatch custom events (toolbar lives inside the
  // node component; modals live here at view level).
  useEffect(() => {
    const onFrame = (e: Event) => {
      const nodeId = (e as CustomEvent).detail?.nodeId as string;
      const n = useCanvasStore.getState().nodes.find((x) => x.id === nodeId);
      const d = n?.data as Record<string, unknown> | undefined;
      const url = d?.generatedVideoUrl as string | undefined;
      if (nodeId && url) setFrameCapture({ nodeId, url });
    };
    const onBreakdown = (e: Event) => {
      const nodeId = (e as CustomEvent).detail?.nodeId as string;
      if (nodeId) void breakdownVideo(nodeId, (msg) => console.log('[拉片]', msg));
    };
    const onVideoFullscreen = (e: Event) => {
      const url = (e as CustomEvent).detail?.url as string | undefined;
      if (url) setFullscreenMedia({ url, type: 'video' });
    };
    window.addEventListener('kunpeng-frame-capture', onFrame);
    window.addEventListener('kunpeng-video-breakdown', onBreakdown);
    window.addEventListener('kunpeng-open-video-fullscreen', onVideoFullscreen);
    return () => {
      window.removeEventListener('kunpeng-frame-capture', onFrame);
      window.removeEventListener('kunpeng-video-breakdown', onBreakdown);
      window.removeEventListener('kunpeng-open-video-fullscreen', onVideoFullscreen);
    };
  }, []);
  const [helperLines, setHelperLines] = useState<{ horizontal?: number; vertical?: number }>({});
  const snapEnabled = true;

  const onNodeContextMenu = useCallback((e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    const selectedCount = useCanvasStore.getState().nodes.filter((n) => n.selected).length;
    setContextMenu({
      kind: selectedCount > 1 && node.selected ? 'selection' : 'node',
      x: e.clientX,
      y: e.clientY,
      nodeId: node.id,
    });
  }, []);

  const onPaneContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ kind: 'pane', x: e.clientX, y: e.clientY });
  }, []);

  const onSelectionContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ kind: 'selection', x: e.clientX, y: e.clientY });
  }, []);

  const handleCreateNodeAt = useCallback((type: 'text' | 'image' | 'video', screenX: number, screenY: number) => {
    captureSnapshot();
    const pos = screenToFlowPosition({ x: screenX, y: screenY });
    const id = `node-${nanoid(8)}`;
    const data = { description: '' };
    const size = estimateNodeSize({ type, data });
    useCanvasStore.getState().addNode({ id, type, position: pos, data, style: { width: size.width, height: size.height } });
    setSelectedNodeId(id);
  }, [screenToFlowPosition, setSelectedNodeId]);

  const isInsideCanvas = useCallback((point: { x: number; y: number }) => {
    const el = reactFlowWrapper.current;
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
  }, []);

  const getFallbackDropPoint = useCallback(() => {
    const rect = reactFlowWrapper.current?.getBoundingClientRect();
    return rect
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  }, []);

  const createNodesFromDroppedPaths = useCallback((paths: string[], point?: { x: number; y: number } | null) => {
    if (paths.length === 0) return;
    const screenPoint = point && isInsideCanvas(point) ? point : getFallbackDropPoint();
    const base = screenToFlowPosition(screenPoint);
    const { unsupportedPaths } = createMediaNodesFromPaths(paths, base);
    // 不支持的文件曾被静默丢弃，用户拖了没反应也不知道为什么
    if (unsupportedPaths.length > 0) {
      const names = unsupportedPaths.map((p) => p.split('/').pop()).slice(0, 3).join('、');
      void import('@tauri-apps/api/dialog').then(({ message }) =>
        message(`${unsupportedPaths.length} 个文件类型不支持，已跳过：${names}${unsupportedPaths.length > 3 ? ' 等' : ''}\n支持：图片(png/jpg/webp…)、视频(mp4/mov/webm…)、音频(mp3/wav/m4a…)`, { title: '部分文件未导入' }),
      ).catch(() => {});
    }
  }, [getFallbackDropPoint, isInsideCanvas, screenToFlowPosition]);

  // 右键「上传」：文件选择 → 按类型建节点在右键位置（多选支持，纵向排开）
  const handleUploadAt = useCallback(async (screenX: number, screenY: number) => {
    const { open: openDialog } = await import('@tauri-apps/api/dialog');
    const selected = await openDialog({
      filters: [{ name: '媒体（图/视频/音频）', extensions: CANVAS_MEDIA_EXTENSIONS }],
      multiple: true,
    });
    if (!selected) return;
    const files = Array.isArray(selected) ? selected : [selected];
    const base = screenToFlowPosition({ x: screenX, y: screenY });
    createMediaNodesFromPaths(files, base);
  }, [screenToFlowPosition]);

  const normalizeNativeDropPoint = useCallback((payload: unknown): { x: number; y: number } | null => {
    const raw = payload as { position?: { x?: number; y?: number }; x?: number; y?: number } | undefined;
    const pos = raw?.position ?? raw;
    let x = Number(pos?.x);
    let y = Number(pos?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const dpr = window.devicePixelRatio || 1;
    if (dpr > 1 && (x > window.innerWidth + 24 || y > window.innerHeight + 24)) {
      x /= dpr;
      y /= dpr;
    }
    return { x, y };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unHover: (() => void) | undefined;
    let unDrop: (() => void) | undefined;
    let unCancel: (() => void) | undefined;
    const keep = (assign: (fn: () => void) => void) => (fn: () => void) => {
      if (disposed) { fn(); return; }
      assign(fn);
    };

    appWindow.listen('tauri://file-drop-hover', (event) => {
      const point = normalizeNativeDropPoint(event.payload);
      nativeDropPointRef.current = point;
      setExternalDragging(!point || isInsideCanvas(point));
    }).then(keep((fn) => { unHover = fn; }));

    appWindow.listen<string[]>('tauri://file-drop', (event) => {
      setExternalDragging(false);
      const paths = event.payload ?? [];
      if (paths.length === 0) return;
      createNodesFromDroppedPaths(paths, nativeDropPointRef.current);
      nativeDropPointRef.current = null;
    }).then(keep((fn) => { unDrop = fn; }));

    appWindow.listen('tauri://file-drop-cancelled', () => {
      nativeDropPointRef.current = null;
      setExternalDragging(false);
    }).then(keep((fn) => { unCancel = fn; }));

    return () => {
      disposed = true;
      unHover?.();
      unDrop?.();
      unCancel?.();
    };
  }, [createNodesFromDroppedPaths, isInsideCanvas, normalizeNativeDropPoint]);

  const hasFileDrag = (event: React.DragEvent) =>
    Array.from(event.dataTransfer.types ?? []).includes('Files');

  const handleBrowserDragEnter = useCallback((event: React.DragEvent) => {
    if (!hasFileDrag(event)) return;
    event.preventDefault();
    browserDragDepth.current += 1;
    setExternalDragging(true);
  }, []);

  const handleBrowserDragOver = useCallback((event: React.DragEvent) => {
    if (!hasFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setExternalDragging(true);
  }, []);

  const handleBrowserDragLeave = useCallback((event: React.DragEvent) => {
    if (!hasFileDrag(event)) return;
    browserDragDepth.current = Math.max(0, browserDragDepth.current - 1);
    if (browserDragDepth.current === 0) setExternalDragging(false);
  }, []);

  const handleBrowserDrop = useCallback((event: React.DragEvent) => {
    if (!hasFileDrag(event)) return;
    event.preventDefault();
    browserDragDepth.current = 0;
    setExternalDragging(false);
    const paths = Array.from(event.dataTransfer.files)
      .map((file) => (file as File & { path?: string }).path || '')
      .filter(Boolean);
    createNodesFromDroppedPaths(paths, { x: event.clientX, y: event.clientY });
  }, [createNodesFromDroppedPaths]);

  // Double-click: node with media → fullscreen; empty pane → create-node menu
  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
    const d = node.data as Record<string, unknown>;
    if (node.type === 'image') {
      const url = (d.generatedImageUrl || d.referenceImage) as string | undefined;
      if (url) setFullscreenMedia({ url, type: 'image' });
    }
    if (node.type === 'video') {
      const url = d.generatedVideoUrl as string | undefined;
      if (url) setFullscreenMedia({ url, type: 'video' });
    }
  }, []);

  const onPaneDoubleClick = useCallback((e: React.MouseEvent) => {
    // Reuse the pane context menu as the create-node menu (TapNow double-click pattern)
    setContextMenu({ kind: 'pane', x: e.clientX, y: e.clientY });
  }, []);

  // Helper lines: intercept position changes, snap within 5px, draw guides.
  const onNodesChangeWithHelpers = useCallback((changes: NodeChange[]) => {
    const posChange = changes.find(
      (c): c is NodePositionChange => c.type === 'position' && c.dragging === true && Boolean(c.position),
    );
    if (posChange && changes.length === 1) {
      const lines = getHelperLines(posChange, useCanvasStore.getState().nodes);
      if (lines.snapPosition.x !== undefined && posChange.position) posChange.position.x = lines.snapPosition.x;
      if (lines.snapPosition.y !== undefined && posChange.position) posChange.position.y = lines.snapPosition.y;
      setHelperLines({ horizontal: lines.horizontal, vertical: lines.vertical });
    } else {
      setHelperLines({});
    }
    onNodesChange(changes);
  }, [onNodesChange]);

  const onNodeDragStart = useCallback(() => {
    captureSnapshot();
  }, []);

  const onNodeDragStop = useCallback(() => {
    setHelperLines({});
  }, []);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
  }, [setSelectedNodeId]);

  const onPaneClick = useCallback((e: React.MouseEvent) => {
    if (e.detail === 2) { onPaneDoubleClick(e); return; }
    setSelectedNodeId(null);
  }, [setSelectedNodeId, onPaneDoubleClick]);

  const handleConnect = useCallback((connection: Connection) => {
    connectionMadeRef.current = true;
    captureSnapshot();
    onConnect(connection);
  }, [onConnect]);


  // 「引用该节点生成 → 3D 世界」打开导演台
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ origin?: DirectorOrigin }>).detail;
      const origin = detail?.origin ?? { kind: 'free' as const, title: '自由预演' };
      const director = useDirectorStore.getState();
      const samePreparedOrigin = director.launchSeed
        && director.origin.kind === origin.kind
        && director.origin.projectId === origin.projectId
        && director.origin.shotNo === origin.shotNo
        && director.origin.nodeId === origin.nodeId;
      if (!samePreparedOrigin) director.prepareLaunch(origin);
      setShowDirector(true);
    };
    window.addEventListener('kunpeng-open-director', handler);
    return () => window.removeEventListener('kunpeng-open-director', handler);
  }, []);

  // 局部重绘/擦除：右键菜单经 CustomEvent 托管到此（菜单关闭即卸载，编辑器须挂在视图层）
  useEffect(() => {
    const handler = (e: Event) => {
      const { nodeId, mode } = (e as CustomEvent<{ nodeId: string; mode: MaskToolMode }>).detail ?? {};
      if (!nodeId) return;
      const n = useCanvasStore.getState().nodes.find((x) => x.id === nodeId);
      const d = n?.data as Record<string, unknown> | undefined;
      const url = (d?.generatedImageUrl || d?.referenceImage) as string | undefined;
      if (url) setMaskEdit({ nodeId, imageUrl: url, mode });
    };
    window.addEventListener('kunpeng-mask-edit', handler);
    return () => window.removeEventListener('kunpeng-mask-edit', handler);
  }, []);

  return (
    <div
      ref={reactFlowWrapper}
      className="w-full h-full relative canvas-dark"
      style={{ background: BG }}
      onDragEnter={handleBrowserDragEnter}
      onDragOver={handleBrowserDragOver}
      onDragLeave={handleBrowserDragLeave}
      onDrop={handleBrowserDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChangeWithHelpers}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onPaneClick={onPaneClick}
        onNodeContextMenu={onNodeContextMenu}
        onPaneContextMenu={onPaneContextMenu}
        onSelectionContextMenu={onSelectionContextMenu}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        defaultViewport={{ x: 0, y: 0, zoom: 0.86 }}
        fitView={nodes.length > 0}
        fitViewOptions={{ maxZoom: 0.86 }}
        deleteKeyCode={null}
        // TapNow gestures: left-drag = box select; Space+drag / middle / right = pan
        selectionOnDrag={!altHeld}
        selectionMode={SelectionMode.Partial}
        panOnScroll
        panOnDrag={[1, 2]}
        panActivationKeyCode="Space"
        multiSelectionKeyCode={['Meta', 'Shift']}
        zoomOnDoubleClick={false}
        snapToGrid={snapEnabled}
        snapGrid={[12, 12]}
        proOptions={proOptions}
        minZoom={0.1}
        maxZoom={3}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color={CANVAS_THEME.bgDot} />
        <MiniMap
          position="bottom-left"
          pannable
          zoomable
          nodeColor={(node) => {
            switch (node.type) {
              case 'text': return '#3b82f6';
              case 'image': return '#10b981';
              case 'video': return '#a855f7';
              default: return CANVAS_THEME.minimapNode;
            }
          }}
          nodeClassName={(node) => ((node.data as Record<string, unknown> | undefined)?.isGenerating ? 'mm-pulse' : '')}
          maskColor={CANVAS_THEME.minimapMask}
          maskStrokeColor={CANVAS_THEME.minimapMaskStroke}
          style={{ background: CANVAS_THEME.minimapBg, borderRadius: 8, border: `1px solid ${CANVAS_THEME.nodeBorder}`, marginBottom: 56 }}
        />
      </ReactFlow>

      <HelperLines horizontal={helperLines.horizontal} vertical={helperLines.vertical} />
      {showDirector && (
        <Suspense fallback={null}>
          <DirectorStage onClose={() => setShowDirector(false)} onSendMessage={onSendMessage} onAbort={onAbort} />
        </Suspense>
      )}
      {maskEdit && (
        <MaskPaintEditor
          sourceNodeId={maskEdit.nodeId}
          imageUrl={maskEdit.imageUrl}
          mode={maskEdit.mode}
          onClose={() => setMaskEdit(null)}
        />
      )}
      {contextMenu && (
        <CanvasContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onCreateNode={handleCreateNodeAt}
          onUploadAt={(x, y) => void handleUploadAt(x, y)}
          onVideoCompose={() => {
            const clips = useCanvasStore.getState().nodes
              .filter((n) => n.selected && n.type === 'video')
              .map((n) => {
                const d = n.data as Record<string, unknown>;
                const path = (d.localPath as string) || '';
                return { nodeId: n.id, path, label: (d.description as string)?.slice(0, 24) || n.id };
              })
              .filter((c) => Boolean(c.path));
            if (clips.length >= 2) setTimelineClips(clips);
          }}
          onMarkerFuse={() => {
            const imgs = useCanvasStore.getState().nodes
              .filter((n) => n.selected && n.type === 'image')
              .map((n) => {
                const d = n.data as Record<string, unknown>;
                return { nodeId: n.id, url: (d.generatedImageUrl || d.referenceImage) as string };
              })
              .filter((x) => Boolean(x.url))
              .slice(0, 3);
            if (imgs.length >= 2) setMarkerImages(imgs);
          }}
          onFullscreenNode={(nodeId) => {
            const n = useCanvasStore.getState().nodes.find((x) => x.id === nodeId);
            const d = n?.data as Record<string, unknown> | undefined;
            const url = (d?.generatedImageUrl || d?.referenceImage) as string | undefined;
            if (url) setFullscreenMedia({ url, type: 'image' });
          }}
        />
      )}
      {fullscreenMedia && <ImageFullscreenViewer imageUrl={fullscreenMedia.url} mediaType={fullscreenMedia.type} onClose={() => setFullscreenMedia(null)} />}
      {markerImages && <MultiImageMarker images={markerImages} onClose={() => setMarkerImages(null)} />}
      {frameCapture && <VideoFrameCapture nodeId={frameCapture.nodeId} videoUrl={frameCapture.url} onClose={() => setFrameCapture(null)} />}
      <AnimatePresence>
        {timelineClips && <TimelinePanel clips={timelineClips} onClose={() => setTimelineClips(null)} />}
      </AnimatePresence>

      <NodePalette
        onOpenArtifacts={() => setShowArtifactPicker((v) => !v)}
        onOpenAssets={() => setShowAssetLibrary((v) => !v)}
        onOpenDirector={() => {
          useDirectorStore.getState().prepareLaunch({ kind: 'free', title: '空白导演台' }, { elements: [], forceNew: true });
          setShowDirector(true);
        }}
      />
      <ArtifactPickerPanel open={showArtifactPicker} onClose={() => setShowArtifactPicker(false)} />
      <AssetLibraryPanel
        open={showAssetLibrary}
        onClose={() => setShowAssetLibrary(false)}
        selected={new Set(selectedAssets.map((a) => a.id))}
        onToggleAsset={(a) => toggleAsset({
          id: a.id,
          name: a.name,
          type: a.type,
          images: 'images' in a ? a.images : undefined,
          audioPath: 'audioPath' in a ? a.audioPath : undefined,
          stylePrompt: 'stylePrompt' in a ? a.stylePrompt : undefined,
        })}
      />
      <CanvasToolbar />
      <NodeInfoBar />
      <TaskQueuePanel />
      <ProjectSwitcher />
      <SelectionToolbar />
      <NodeAgentTransferEffect />
      <AiBoxOverlay active={altHeld} containerRef={reactFlowWrapper} onSubmit={handleAiBox} onCancel={() => setAltHeld(false)} />

      {externalDragging && (
        <div className="absolute inset-0 z-40 pointer-events-none flex items-center justify-center bg-black/20">
          <div className="rounded-2xl border border-cyan-300/50 bg-neutral-950/85 px-5 py-3 text-sm text-white shadow-2xl">
            松开后添加图片、视频或音频节点
          </div>
        </div>
      )}

      {floatingMenu && (
        <FloatingMenu
          x={floatingMenu.x}
          y={floatingMenu.y}
          sourceX={floatingMenu.sourceX}
          sourceY={floatingMenu.sourceY}
          sourceNodeType={floatingMenu.sourceNodeType}
          onSelect={handleFloatingMenuSelect}
          onClose={() => setFloatingMenu(null)}
        />
      )}

      {nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <div className="text-[var(--canvas-text-2)] text-sm mb-1">画布为空</div>
            <div className="text-[var(--canvas-text-3)] text-xs">从左侧面板添加节点，或使用右下角气泡让鲲鹏帮你创建流水线</div>
          </div>
        </div>
      )}

      <CanvasChatBubble onSendMessage={onSendMessage} onAbort={onAbort} />
    </div>
  );
}

export default function CanvasView(props: CanvasViewProps) {
  return (
    <ReactFlowProvider>
      <CanvasViewInner {...props} />
    </ReactFlowProvider>
  );
}
