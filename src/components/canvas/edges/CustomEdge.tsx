import { memo, useState, useCallback } from 'react';
import { BaseEdge, getBezierPath } from 'reactflow';
import type { EdgeProps } from 'reactflow';
import { X } from 'lucide-react';
import { useCanvasStore } from '@/stores/canvasStore';
import { CANVAS_THEME } from '@/lib/canvas/theme';
import { captureSnapshot } from '@/lib/canvas/history';

function CustomEdgeComponent({
  id, target, sourceX, sourceY, targetX, targetY,
  sourcePosition, targetPosition, style = {}, markerEnd, selected,
}: EdgeProps) {
  const [isHovered, setIsHovered] = useState(false);
  // dashdraw flow while the TARGET node is generating — reads "素材正流入
  // 生成中的节点". Selector is per-edge and cheap.
  const targetGenerating = useCanvasStore((s) => {
    const n = s.nodes.find((x) => x.id === target);
    return Boolean((n?.data as Record<string, unknown> | undefined)?.isGenerating);
  });

  const [edgePath] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  const isActive = isHovered || selected;

  const edgeStyle = {
    ...style,
    stroke: selected ? CANVAS_THEME.edgeSelected : isHovered ? CANVAS_THEME.edgeHover : CANVAS_THEME.edge,
    strokeWidth: isActive ? 2 : 1.5,
    opacity: isActive ? 1 : 0.6,
    transition: 'stroke 0.15s, stroke-width 0.15s, opacity 0.15s',
  };

  const handleMouseEnter = useCallback(() => setIsHovered(true), []);
  const handleMouseLeave = useCallback(() => setIsHovered(false), []);

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    captureSnapshot();
    useCanvasStore.getState().deleteEdge(id);
  }, [id]);

  // Midpoint for delete button
  const midX = (sourceX + targetX) / 2;
  const midY = (sourceY + targetY) / 2;

  return (
    <g onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={edgeStyle}
        // .edge-generating applies accent color + dasharray + dashdraw keyframes
        // (defined in index.css under .canvas-dark)
        {...(targetGenerating ? { className: 'edge-generating' } : {})}
      />
      {/* Wider invisible hit area */}
      <path d={edgePath} fill="none" stroke="transparent" strokeWidth={24} style={{ pointerEvents: 'stroke' }} />
      {isActive && (
        <foreignObject x={midX - 10} y={midY - 10} width={20} height={20} style={{ overflow: 'visible' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20 }}>
            <button
              onClick={handleDelete}
              style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                border: 'none',
                background: 'rgba(38,38,38,0.88)',
                backdropFilter: 'blur(8px)',
                boxShadow: '0 1px 4px rgba(0,0,0,0.12), 0 0 0 1px rgba(255,255,255,0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                color: '#94a3b8',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#ef4444';
                e.currentTarget.style.color = '#fff';
                e.currentTarget.style.transform = 'scale(1.15)';
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(239,68,68,0.35)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(38,38,38,0.88)';
                e.currentTarget.style.color = '#94a3b8';
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.12), 0 0 0 1px rgba(255,255,255,0.08)';
              }}
              title="删除连线"
            >
              <X size={10} strokeWidth={2.5} />
            </button>
          </div>
        </foreignObject>
      )}
    </g>
  );
}

export default memo(CustomEdgeComponent);
