/**
 * SelectionToolbar — floating action bar that appears when one or more nodes are
 * box-selected, surfacing group/duplicate/delete without memorizing
 * shortcuts (discoverability fix).
 */
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Group, CopyPlus, Grid2X2, Trash2 } from 'lucide-react';
import { useLayoutEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from 'reactflow';
import { useCanvasStore } from '@/stores/canvasStore';
import { groupSelection } from '@/lib/canvas/grouping';
import { duplicateSelection } from '@/lib/canvas/clipboard';
import { captureSnapshot } from '@/lib/canvas/history';
import StoryboardCanvasActions, { type StoryboardCanvasActionMode } from './StoryboardCanvasActions';
import { openCanvasNodesInAgent } from '@/lib/canvas/nodeAgent';

export default function SelectionToolbar() {
  const nodes = useCanvasStore((state) => state.nodes);
  const selectedNodes = useMemo(
    () => nodes.filter((node) => node.selected && node.type !== 'group'),
    [nodes],
  );
  const selectedCount = selectedNodes.length;
  const selectedImageIds = selectedNodes.filter((node) => node.type === 'image').map((node) => node.id);
  const [storyboardMode, setStoryboardMode] = useState<StoryboardCanvasActionMode | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const transform = useStore((state) => state.transform);
  const selectedGeometryKey = useStore((state) => {
    const selected = [...state.nodeInternals.values()].filter((node) => node.selected && node.type !== 'group');
    return selected
      .map((node) => {
        const position = node.positionAbsolute ?? node.position;
        return `${node.id}:${position.x},${position.y},${node.width},${node.height}`;
      })
      .sort()
      .join('|');
  });

  useLayoutEffect(() => {
    if (selectedCount < 2) {
      setAnchor(null);
      return;
    }

    const updateAnchor = () => {
      const rects = selectedNodes
        .map((node) => {
          const escaped = typeof CSS !== 'undefined' && CSS.escape
            ? CSS.escape(node.id)
            : node.id.replace(/["\\]/g, '\\$&');
          const element = document.querySelector(
            `.react-flow__node[data-id="${escaped}"]`,
          ) as HTMLElement | null;
          return element?.getBoundingClientRect();
        })
        .filter((rect): rect is DOMRect => Boolean(rect));
      if (rects.length === 0) {
        setAnchor(null);
        return;
      }

      const left = Math.min(...rects.map((rect) => rect.left));
      const right = Math.max(...rects.map((rect) => rect.right));
      const top = Math.min(...rects.map((rect) => rect.top));
      const bottom = Math.max(...rects.map((rect) => rect.bottom));
      const below = top < 92;
      setAnchor({
        x: Math.max(190, Math.min(window.innerWidth - 190, left + (right - left) / 2)),
        y: below ? bottom + 8 : top - 8,
        below,
      });
    };

    updateAnchor();
    window.addEventListener('resize', updateAnchor);
    return () => window.removeEventListener('resize', updateAnchor);
  }, [selectedCount, selectedGeometryKey, selectedNodes, transform]);

  const handleDelete = () => {
    captureSnapshot();
    const store = useCanvasStore.getState();
    for (const n of store.nodes.filter((x) => x.selected)) store.deleteNode(n.id);
    store.setSelectedNodeId(null);
  };

  const toolbar = typeof document !== 'undefined' ? createPortal(
    <AnimatePresence>
      {selectedCount >= 2 && anchor && (
        <motion.div
          initial={{ opacity: 0, y: anchor.below ? -6 : 6, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: anchor.below ? -6 : 6, scale: 0.95 }}
          transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
          className="canvas-dark fixed z-30 flex max-w-[calc(100vw-24px)] items-center gap-0.5 overflow-x-auto px-1.5 py-1 rounded-xl"
          style={{
            left: anchor.x,
            top: anchor.y,
            transform: anchor.below ? 'translateX(-50%)' : 'translate(-50%, -100%)',
            background: 'var(--canvas-panel)',
            border: '1px solid var(--canvas-node-border)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3), 0 2px 8px rgba(0,0,0,0.2)',
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <span className="px-2 text-[11px] text-[var(--canvas-text-2)]">已选 {selectedCount} 个</span>
          <div className="w-px h-4 bg-[rgba(255,255,255,0.08)]" />
          <button
            onClick={() => openCanvasNodesInAgent(selectedNodes.map((node) => node.id))}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] transition-colors"
            title="把所选节点作为一个工作集交给 Agent"
          >
            <Bot size={13} className="text-[var(--canvas-text-2)]" />交给 Agent
          </button>
          {selectedCount >= 2 && (
            <button
              onClick={() => groupSelection()}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] transition-colors"
              title="打组 (⌘G)"
            >
              <Group size={13} className="text-[var(--canvas-text-2)]" />打组
            </button>
          )}
          <button
            onClick={() => duplicateSelection()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] transition-colors"
            title="创建副本 (⌘D)"
          >
            <CopyPlus size={13} className="text-[var(--canvas-text-2)]" />副本
          </button>
          {selectedImageIds.length >= 2 && selectedImageIds.length === selectedCount && (
            <button
              onClick={() => setStoryboardMode('compose')}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] transition-colors"
              title="按当前选择顺序拼成完整故事板并回传到视频提示词"
            >
              <Grid2X2 size={13} className="text-[var(--canvas-text-2)]" />拼成分镜板
            </button>
          )}
          <button
            onClick={handleDelete}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-[var(--canvas-danger)] hover:bg-[rgba(255,97,99,0.12)] transition-colors"
            title="删除所选 (Delete)"
          >
            <Trash2 size={13} />删除
          </button>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  ) : null;

  return (
    <>
      {toolbar}
      {storyboardMode && (
        <StoryboardCanvasActions
          mode={storyboardMode}
          nodeIds={selectedImageIds}
          onClose={() => setStoryboardMode(null)}
        />
      )}
    </>
  );
}
