/**
 * NodeToolbarPortal — 把节点工具条 portal 到 body，固定在节点上方居中。
 *
 * 解决两个老问题：
 * 1. 遮挡——节点在 .react-flow__viewport（transform 建立层叠上下文）内，
 *    任何 z-index 都翻不过外面 z-10 的 NodeInfoBar 配置卡；portal 到 body
 *    后用 z-30 稳定压住配置卡（但仍低于 z-40 的助手抽屉）。
 * 2. 恒定尺寸——portal 在屏幕坐标系渲染，天然不随画布缩放，
 *    不再需要 scale(1/zoom) 反缩放层。
 *
 * 跟随：订阅 reactflow transform（平移/缩放）+ 节点位置/尺寸，
 * 每次变化重读 getBoundingClientRect。portal 在 .canvas-dark 作用域外，
 * 容器补 canvas-dark 类保住 CSS 变量。
 */
import { useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from 'reactflow';

export function useHasMultiNodeSelection(): boolean {
  return useStore((state) => {
    let count = 0;
    for (const node of state.nodeInternals.values()) {
      if (!node.selected) continue;
      count += 1;
      if (count > 1) return true;
    }
    return false;
  });
}

export default function NodeToolbarPortal({ nodeId, children }: { nodeId: string; children: ReactNode }) {
  const transform = useStore((s) => s.transform);
  const hasMultiSelection = useHasMultiNodeSelection();
  // 节点拖动时 transform 不变——位置/尺寸单独订阅
  const posKey = useStore((s) => {
    const n = s.nodeInternals.get(nodeId);
    if (!n) return '';
    const p = n.positionAbsolute ?? n.position;
    return `${p.x},${p.y},${n.width},${n.height}`;
  });
  const [anchor, setAnchor] = useState<{ cx: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`) as HTMLElement | null;
    if (!el) { setAnchor(null); return; }
    const r = el.getBoundingClientRect();
    setAnchor({ cx: r.left + r.width / 2, top: r.top });
  }, [nodeId, transform, posKey]);

  if (!anchor || hasMultiSelection) return null;

  return createPortal(
    <div
      className="canvas-dark fixed z-30"
      style={{ left: anchor.cx, top: anchor.top - 8, transform: 'translate(-50%, -100%)' }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}
