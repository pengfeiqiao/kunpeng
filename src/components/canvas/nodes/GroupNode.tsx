/**
 * GroupNode — visual container for grouped nodes, and a connectable
 * multi-image source: dragging from the group's right handle feeds ALL
 * member images into the target (图生图/图生视频 batch reference).
 */
import { memo } from 'react';
import type { NodeProps } from 'reactflow';
import { Handle, Position, NodeResizer } from 'reactflow';
import { Bot, Layers, Trash2 } from 'lucide-react';
import { useCanvasStore } from '@/stores/canvasStore';
import NodeToolbarPortal from '../NodeToolbarPortal';
import { openCanvasNodeInAgent } from '@/lib/canvas/nodeAgent';

/** Collect image urls of all member nodes of a group (used by NodeInfoBar too). */
export function getGroupImages(groupId: string): string[] {
  const nodes = useCanvasStore.getState().nodes;
  return nodes
    .filter((n) => n.parentNode === groupId && n.type === 'image')
    .map((n) => {
      const d = n.data as Record<string, unknown>;
      return (d.generatedImageUrl || d.referenceImage) as string | undefined;
    })
    .filter((u): u is string => Boolean(u));
}

function GroupNodeComponent({ id, selected }: NodeProps) {
  const deleteNode = useCanvasStore((state) => state.deleteNode);
  const memberImageCount = useCanvasStore(
    (s) => s.nodes.filter((n) => n.parentNode === id && n.type === 'image' && Boolean((n.data as Record<string, unknown>).generatedImageUrl || (n.data as Record<string, unknown>).referenceImage)).length,
  );

  return (
    <div
      className="w-full h-full transition-colors duration-150"
      style={{
        background: selected ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)',
        border: `1px ${selected ? 'solid' : 'dashed'} ${selected ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.16)'}`,
        borderRadius: 20,
        boxShadow: selected ? '0 0 0 1px rgba(255,255,255,0.15)' : 'none',
      }}
    >
      {/* Member-count tag: makes "the group is a multi-image source" visible */}
      {memberImageCount > 0 && (
        <div className="absolute -top-2.5 left-3 flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px]"
          style={{ background: 'var(--canvas-panel)', border: '1px solid var(--canvas-node-border)', color: 'var(--canvas-text-2)' }}
        >
          <Layers size={9} />
          组 · {memberImageCount} 图可整组引用
        </div>
      )}

      {/* Source handle: drag out to feed all member images into the target */}
      <Handle
        type="source"
        position={Position.Right}
        title="拖出连线：整组图片作为参考"
      />

      {selected && (
        <NodeToolbarPortal nodeId={id}>
          <div
            className="flex items-center gap-1 rounded-2xl px-2 py-1.5"
            style={{ background: 'rgba(38,38,38,0.92)', backdropFilter: 'blur(12px)', boxShadow: '0 2px 12px rgba(0,0,0,0.2), 0 0 0 1px rgba(255,255,255,0.08)' }}
          >
            <button onClick={() => openCanvasNodeInAgent(id)} className="flex flex-col items-center gap-1 px-3 py-2 min-w-[52px] rounded-xl text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] transition-all" title="把当前分组交给 Agent 操作">
              <Bot size={16} /><span className="text-[11px] leading-none">Agent</span>
            </button>
            <button onClick={() => deleteNode(id)} className="flex flex-col items-center gap-1 px-3 py-2 min-w-[52px] rounded-xl text-[var(--canvas-text-2)] hover:text-red-500 hover:bg-[rgba(255,97,99,0.15)] transition-all" title="删除分组，保留组内节点">
              <Trash2 size={16} /><span className="text-[11px] leading-none">删除</span>
            </button>
          </div>
        </NodeToolbarPortal>
      )}

      {selected && (
        <NodeResizer
          color="#a8a8a8"
          isVisible={selected}
          minWidth={120}
          minHeight={100}
          handleStyle={{ backgroundColor: '#a8a8a8', border: '1px solid #141414', borderRadius: '50%', width: 6, height: 6 }}
          lineStyle={{ borderColor: 'rgba(168,168,168,0.5)', borderWidth: 1, borderStyle: 'dashed' }}
        />
      )}
    </div>
  );
}

export default memo(GroupNodeComponent);
