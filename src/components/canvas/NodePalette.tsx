/**
 * NodePalette — 左侧悬浮工具栏（黑色长胶囊 + 顶部白 "+" 圆钮）。
 * + 号弹出三区面板：添加节点 / 功能节点 / 添加资源。
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  FileText, ImageIcon, Film, Upload, FolderOpen, UserRound, Video, Plus, X,
  Globe2, Music, Sparkles,
} from 'lucide-react';
import { useReactFlow } from 'reactflow';
import { useCanvasStore } from '@/stores/canvasStore';
import { nanoid } from 'nanoid';
import { open } from '@tauri-apps/api/dialog';
import { CANVAS_MEDIA_EXTENSIONS, createMediaNodesFromPaths } from '@/lib/canvas/mediaImport';
import { defaultNodeStyle } from '@/lib/canvas/layout';

function getViewportCenter(screenToFlowPosition: (pos: { x: number; y: number }) => { x: number; y: number }) {
  const w = window.innerWidth, h = window.innerHeight;
  const center = screenToFlowPosition({ x: w / 2, y: h / 2 });
  return { x: center.x + (Math.random() - 0.5) * 60, y: center.y + (Math.random() - 0.5) * 60 };
}

type NodeType = 'text' | 'image' | 'video' | 'panorama' | 'audio';

export default function NodePalette({ onOpenArtifacts, onOpenAssets, onOpenDirector }: { onOpenArtifacts?: () => void;
  onOpenDirector?: () => void; onOpenAssets?: () => void }) {
  const addNode = useCanvasStore((s) => s.addNode);
  const setSelectedNodeId = useCanvasStore((s) => s.setSelectedNodeId);
  const { screenToFlowPosition } = useReactFlow();
  const [plusOpen, setPlusOpen] = useState(false);
  const [toast] = useState('');
  const plusButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelLayout, setPanelLayout] = useState({ left: 88, top: 104, maxHeight: 520 });

  const createNode = (type: NodeType) => {
    const pos = getViewportCenter(screenToFlowPosition);
    const id = `node-${nanoid(8)}`;
    const style = defaultNodeStyle(type);
    addNode({ id, type, position: pos, data: { description: '' }, ...(style ? { style } : {}) });
    setSelectedNodeId(id);
    setPlusOpen(false);
  };

  const createMgNode = () => {
    const pos = getViewportCenter(screenToFlowPosition);
    const id = `node-${nanoid(8)}`;
    const style = defaultNodeStyle('video');
    addNode({
      id,
      type: 'video',
      position: pos,
      data: {
        description: '',
        isMgAnimationNode: true,
        modelVersion: 'minimax-hailuo-h3',
        mgGenerationEngine: 'minimax-h3',
        resolution: '2K',
        aspectRatio: '16:9',
        duration: 10,
      },
      ...(style ? { style } : {}),
    });
    setSelectedNodeId(id);
    setPlusOpen(false);
  };

  const handleUpload = async () => {
    setPlusOpen(false);
    try {
      const selected = await open({
        filters: [{ name: '媒体（图/视频/音频）', extensions: CANVAS_MEDIA_EXTENSIONS }],
        multiple: true,
      });
      if (!selected) return;
      const files = Array.isArray(selected) ? selected : [selected];
      const base = getViewportCenter(screenToFlowPosition);
      createMediaNodesFromPaths(files, base);
    } catch (err) {
      console.error('上传失败:', err);
    }
  };

  const mainItems: { icon: typeof FileText; label: string; title: string; action: () => void }[] = [
    { icon: UserRound, label: '资产', title: '资产库（主体/音色/风格）', action: () => onOpenAssets?.() },
    { icon: FolderOpen, label: '产物', title: '从产物库选取', action: () => onOpenArtifacts?.() },
    { icon: Video, label: '导演台', title: '3D 导演台（摆机位出参考图）', action: () => onOpenDirector?.() },
  ];

  const nodeItems: { icon: typeof FileText; label: string; desc?: string; action: () => void }[] = [
    { icon: FileText, label: '文本', desc: '剧本与文案', action: () => createNode('text') },
    { icon: ImageIcon, label: '图片', action: () => createNode('image') },
    { icon: Film, label: '视频', action: () => createNode('video') },
    { icon: Sparkles, label: 'MG动画', desc: '默认 H3，可切换引擎', action: createMgNode },
    { icon: Globe2, label: '3D 世界', desc: '360° 场景', action: () => createNode('panorama') },
    { icon: Music, label: '音频', desc: '配音与配乐', action: () => createNode('audio') },
  ];

  useLayoutEffect(() => {
    if (!plusOpen) return;

    const positionPanel = () => {
      const anchor = plusButtonRef.current?.getBoundingClientRect();
      const panel = panelRef.current;
      if (!anchor || !panel) return;

      const safeTop = 96;
      const safeBottom = 72;
      const sideGap = 12;
      const horizontalPadding = 16;
      const maxHeight = Math.max(120, window.innerHeight - safeTop - safeBottom);
      const panelHeight = Math.min(panel.scrollHeight, maxHeight);
      const idealTop = anchor.top + anchor.height / 2 - panelHeight / 2;
      const maxTop = Math.max(safeTop, window.innerHeight - safeBottom - panelHeight);
      const top = Math.min(Math.max(idealTop, safeTop), maxTop);
      const panelWidth = panel.offsetWidth || 304;
      const preferredLeft = anchor.right + sideGap;
      const left = Math.min(preferredLeft, window.innerWidth - panelWidth - horizontalPadding);

      setPanelLayout({
        left: Math.max(horizontalPadding, left),
        top,
        maxHeight,
      });
    };

    const frame = requestAnimationFrame(positionPanel);
    window.addEventListener('resize', positionPanel);
    window.addEventListener('scroll', positionPanel, true);
    const observer = new ResizeObserver(positionPanel);
    if (panelRef.current) observer.observe(panelRef.current);

    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || plusButtonRef.current?.contains(target)) return;
      setPlusOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPlusOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', positionPanel);
      window.removeEventListener('scroll', positionPanel, true);
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [plusOpen]);

  return (
    <>
    <div className="absolute left-4 top-1/2 -translate-y-1/2 z-10">
      <div
        className="flex flex-col items-center gap-1 py-3.5 px-2"
        style={{
          background: 'linear-gradient(180deg, rgba(20,20,24,0.95), rgba(12,12,15,0.95))',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRadius: 28,
          border: '1px solid rgba(255,255,255,0.05)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
          width: 60,
        }}
      >
        {/* 顶部白色 "+" 圆钮 */}
        <div className="relative mb-2.5">
          <button
            ref={plusButtonRef}
            onClick={() => setPlusOpen((v) => !v)}
            className="w-11 h-11 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95"
            style={{
              background: '#ffffff',
              boxShadow: plusOpen ? '0 0 0 2px rgba(255,255,255,0.25), 0 2px 12px rgba(255,255,255,0.15)' : '0 2px 12px rgba(255,255,255,0.10)',
            }}
            title="添加节点 / 资源"
          >
            {plusOpen
              ? <X size={20} className="text-black" strokeWidth={2.5} />
              : <Plus size={20} className="text-black" strokeWidth={2.5} />}
          </button>
        </div>

        {/* 主栏图标项 */}
        {mainItems.map(({ icon: Icon, label, title, action }, i) => (
          <button
            key={i}
            onClick={action}
            className="flex flex-col items-center gap-1.5 w-[52px] py-2.5 rounded-2xl text-[var(--canvas-text-2)] hover:text-white hover:bg-[rgba(255,255,255,0.06)] transition-all duration-150"
            title={title}
          >
            <Icon size={20} strokeWidth={1.8} />
            <span className="text-[11px] leading-none">{label}</span>
          </button>
        ))}
      </div>

      {/* toast */}
      {toast && (
        <div
          className="absolute left-full top-1/2 -translate-y-1/2 ml-4 px-3.5 py-2 rounded-xl text-[12px] text-white whitespace-nowrap"
          style={{ background: 'rgba(20,21,24,0.95)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          {toast}
        </div>
      )}
    </div>
    {plusOpen && createPortal(
      <div
        ref={panelRef}
        className="fixed flex w-[304px] max-w-[calc(100vw-32px)] flex-col overflow-y-auto rounded-xl p-3 whitespace-nowrap"
        style={{
          left: panelLayout.left,
          top: panelLayout.top,
          maxHeight: panelLayout.maxHeight,
          background: 'rgba(20,21,24,0.97)',
          backdropFilter: 'blur(28px)',
          WebkitBackdropFilter: 'blur(28px)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 18px 48px rgba(0,0,0,0.48)',
          zIndex: 100,
        }}
        role="menu"
        aria-label="添加到画布"
      >
        <div className="mb-2 flex items-center justify-between px-1">
          <p className="text-[12px] font-medium text-white">添加到画布</p>
          <p className="text-[9px] text-white/35">Esc 关闭</p>
        </div>

        <p className="mb-1 px-1 text-[10px] text-white/40">资源</p>
        <PanelItem icon={Upload} label="上传本地素材" desc="图片、视频或音频" onClick={() => void handleUpload()} />

        <p className="mb-1 mt-3 px-1 text-[10px] text-white/40">节点</p>
        <div className="grid grid-cols-2 gap-1">
          {nodeItems.map((item) => (
            <PanelItem
              key={item.label}
              icon={item.icon}
              label={item.label}
              desc={item.desc}
              onClick={item.action}
              compact
            />
          ))}
        </div>
      </div>,
      document.body,
    )}
    </>
  );
}

function PanelItem({ icon: Icon, label, desc, onClick, compact = false }: {
  icon: typeof FileText; label: string; desc?: string; onClick: () => void; compact?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center rounded-lg text-left transition-colors duration-150 hover:bg-white/[0.07] ${
        compact ? 'min-h-[54px] gap-2 px-2 py-2' : 'gap-3 px-2.5 py-2.5'
      }`}
      role="menuitem"
    >
      <div
        className={`flex shrink-0 items-center justify-center rounded-lg ${compact ? 'h-8 w-8' : 'h-10 w-10'}`}
        style={{ background: 'rgba(255,255,255,0.08)' }}
      >
        <Icon size={compact ? 15 : 18} className="text-white" strokeWidth={1.8} />
      </div>
      <div className="min-w-0">
        <p className={`${compact ? 'text-[12px]' : 'text-[13px]'} truncate font-medium leading-tight text-white`}>{label}</p>
        {desc && <p className={`${compact ? 'text-[9px]' : 'text-[10px]'} mt-0.5 truncate text-white/40`}>{desc}</p>}
      </div>
    </button>
  );
}
