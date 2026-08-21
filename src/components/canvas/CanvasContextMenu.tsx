/**
 * CanvasContextMenu — right-click menus for node / pane / selection.
 * Dark panel (#262626) + large soft shadow + popIn entrance (TapNow style).
 */
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import {
  Copy, Trash2, ClipboardPaste, Shuffle, Download, Group, Ungroup,
  ImageIcon, Film, FileText, Maximize2, CopyPlus, Upload, Bot,
} from 'lucide-react';
import { useCanvasStore } from '@/stores/canvasStore';
import { copySelection, pasteClipboard, duplicateSelection } from '@/lib/canvas/clipboard';
import { captureSnapshot } from '@/lib/canvas/history';
import { groupSelection, ungroupSelection } from '@/lib/canvas/grouping';
import { invoke } from '@tauri-apps/api/tauri';
import { IMAGE_TOOLS, applyImageTool } from '@/lib/canvas/imageTools';
import { extendVideo, lipSyncViaAgent } from '@/lib/canvas/videoTools';
import { Wand2 } from 'lucide-react';
import { openCanvasNodesInAgent } from '@/lib/canvas/nodeAgent';

export interface ContextMenuState {
  kind: 'node' | 'pane' | 'selection';
  x: number;
  y: number;
  nodeId?: string;
}

interface Props {
  menu: ContextMenuState;
  onClose: () => void;
  onCreateNode: (type: 'text' | 'image' | 'video', screenX: number, screenY: number) => void;
  onUploadAt?: (screenX: number, screenY: number) => void;
  onFullscreenNode: (nodeId: string) => void;
  onMarkerFuse?: () => void;
  onVideoCompose?: () => void;
}

function Item({ icon: Icon, label, danger, onClick }: {
  icon: typeof Copy; label: string; danger?: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-[13px] transition-colors ${
        danger
          ? 'text-[var(--canvas-danger)] hover:bg-[rgba(255,97,99,0.12)]'
          : 'text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)]'
      }`}
    >
      <Icon size={15} className={danger ? '' : 'text-[var(--canvas-text-2)]'} />
      {label}
    </button>
  );
}

function Sep() {
  return <div className="h-px bg-[rgba(255,255,255,0.06)] my-1 mx-2" />;
}

export default function CanvasContextMenu({ menu, onClose, onCreateNode, onUploadAt, onFullscreenNode, onMarkerFuse, onVideoCompose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [onClose]);

  const close = (fn?: () => void) => () => { fn?.(); onClose(); };
  const store = () => useCanvasStore.getState();

  const node = menu.nodeId ? store().nodes.find((n) => n.id === menu.nodeId) : undefined;
  const nodeData = node?.data as Record<string, unknown> | undefined;
  const nodeMediaPath = node?.type === 'video'
    ? ((nodeData?.localPath as string) || (nodeData?.generatedVideoUrl as string))
    : node?.type === 'audio'
      ? ((nodeData?.localPath as string) || (nodeData?.audioUrl as string))
      : ((nodeData?.localPath as string) || (nodeData?.generatedImageUrl as string) || (nodeData?.referenceImage as string));

  const handleDeleteNode = close(() => {
    if (!menu.nodeId) return;
    captureSnapshot();
    store().deleteNode(menu.nodeId);
    store().setSelectedNodeId(null);
  });

  const handleDeleteSelection = close(() => {
    captureSnapshot();
    const s = store();
    for (const n of s.nodes.filter((x) => x.selected)) s.deleteNode(n.id);
    s.setSelectedNodeId(null);
  });

  const handleDownload = close(() => {
    if (!nodeMediaPath) return;
    void invoke('save_file_dialog', {
      sourcePath: nodeMediaPath,
      defaultName: nodeMediaPath.split('/').pop() || `node-${Date.now()}`,
    }).catch(() => {});
  });

  const handleVariant = close(() => {
    if (menu.nodeId) store().triggerAgentAction('ai-image-to-image', menu.nodeId);
  });

  // Keep menu inside the viewport
  const style: React.CSSProperties = {
    left: Math.min(menu.x, window.innerWidth - 200),
    top: Math.min(menu.y, window.innerHeight - 280),
  };

  return createPortal(
    <div className="canvas-dark fixed inset-0 z-[9999]" style={{ pointerEvents: 'none' }}>
      <motion.div
        ref={ref}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
        className="absolute min-w-[210px] py-2 rounded-xl"
        style={{
          ...style,
          pointerEvents: 'auto',
          background: 'var(--canvas-panel)',
          border: '1px solid var(--canvas-node-border)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3), 0 2px 8px rgba(0,0,0,0.2)',
        }}
      >
        {menu.kind === 'node' && (
          <>
            <Item icon={Copy} label="复制" onClick={close(() => { store().setSelectedNodeId(menu.nodeId!); useCanvasStore.setState({ nodes: store().nodes.map((n) => ({ ...n, selected: n.id === menu.nodeId })) }); copySelection(); })} />
            <Item icon={CopyPlus} label="创建副本" onClick={close(() => { useCanvasStore.setState({ nodes: store().nodes.map((n) => ({ ...n, selected: n.id === menu.nodeId })) }); duplicateSelection(); })} />
            {node?.type === 'image' && nodeMediaPath && (
              <>
                <Sep />
                <div className="px-3 py-1 text-[9px] text-[var(--canvas-text-3)] flex items-center gap-1"><Wand2 size={9} />AI 工具（衍生新节点）</div>
                {IMAGE_TOOLS.map((t) => (
                  <Item
                    key={t.id}
                    icon={Wand2}
                    label={t.label}
                    onClick={close(() => {
                      if (t.id === 'inpaint' || t.id === 'erase') {
                        // 菜单关闭即整组件卸载——编辑器须由 CanvasView 托管
                        window.dispatchEvent(new CustomEvent('kunpeng-mask-edit', {
                          detail: { nodeId: menu.nodeId, mode: t.id },
                        }));
                        return;
                      }
                      void applyImageTool(menu.nodeId!, t);
                    })}
                  />
                ))}
                <Sep />
                <Item icon={Shuffle} label="生成变体" onClick={handleVariant} />
                <Item icon={Maximize2} label="全屏查看" onClick={close(() => onFullscreenNode(menu.nodeId!))} />
              </>
            )}
            {node?.type === 'video' && nodeMediaPath && (
              <>
                <Sep />
                <div className="px-3 py-1 text-[9px] text-[var(--canvas-text-3)] flex items-center gap-1"><Wand2 size={9} />视频工具</div>
                <Item icon={Wand2} label="延长视频 +5 秒" onClick={close(() => { void extendVideo(menu.nodeId!, 5); })} />
                <Item icon={Wand2} label="延长视频 +10 秒" onClick={close(() => { void extendVideo(menu.nodeId!, 10); })} />
                <Item icon={Wand2} label="对口型（Agent）" onClick={close(() => lipSyncViaAgent(menu.nodeId!))} />
              </>
            )}
            {nodeMediaPath && <Item icon={Download} label="另存为…" onClick={handleDownload} />}
            <Sep />
            <Item icon={Trash2} label="删除节点" danger onClick={handleDeleteNode} />
          </>
        )}

        {menu.kind === 'selection' && (
          <>
            <Item
              icon={Bot}
              label="把所选节点交给 Agent"
              onClick={close(() => {
                const ids = store().nodes.filter((node) => node.selected && node.type !== 'group').map((node) => node.id);
                openCanvasNodesInAgent(ids);
              })}
            />
            <Sep />
            <Item icon={Copy} label="复制所选" onClick={close(() => copySelection())} />
            <Item icon={CopyPlus} label="创建副本" onClick={close(() => duplicateSelection())} />
            <Item icon={Wand2} label="标记融合（多图取元素）" onClick={close(() => onMarkerFuse?.())} />
            <Item icon={Film} label="视频合成（时间轴）" onClick={close(() => onVideoCompose?.())} />
            <Sep />
            <Item icon={Group} label="打组 (⌘G)" onClick={close(() => groupSelection())} />
            <Item icon={Ungroup} label="解组 (⌘⇧G)" onClick={close(() => ungroupSelection())} />
            <Sep />
            <Item icon={Trash2} label="删除所选" danger onClick={handleDeleteSelection} />
          </>
        )}

        {menu.kind === 'pane' && (
          <>
            <Item icon={Upload} label="上传媒体（图/视频/音频）" onClick={close(() => onUploadAt?.(menu.x, menu.y))} />
            <Sep />
            <Item icon={FileText} label="新建文本节点" onClick={close(() => onCreateNode('text', menu.x, menu.y))} />
            <Item icon={ImageIcon} label="新建图片节点" onClick={close(() => onCreateNode('image', menu.x, menu.y))} />
            <Item icon={Film} label="新建视频节点" onClick={close(() => onCreateNode('video', menu.x, menu.y))} />
            <Sep />
            <Item icon={ClipboardPaste} label="粘贴 (⌘V)" onClick={close(() => pasteClipboard())} />
          </>
        )}
      </motion.div>
    </div>,
    document.body,
  );
}
