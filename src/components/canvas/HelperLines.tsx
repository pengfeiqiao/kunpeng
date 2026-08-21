/**
 * HelperLines — SVG overlay drawing 1px accent alignment guides in flow
 * coordinates (rendered inside ReactFlow's viewport so they pan/zoom along).
 */
import { useStore, type ReactFlowState } from 'reactflow';

const canvasWidthSelector = (s: ReactFlowState) => s.width;
const canvasHeightSelector = (s: ReactFlowState) => s.height;
const transformSelector = (s: ReactFlowState) => s.transform;

export default function HelperLines({ horizontal, vertical }: { horizontal?: number; vertical?: number }) {
  const width = useStore(canvasWidthSelector);
  const height = useStore(canvasHeightSelector);
  const [tx, ty, zoom] = useStore(transformSelector);

  if (horizontal === undefined && vertical === undefined) return null;

  // flow coord → screen coord
  const screenX = vertical !== undefined ? vertical * zoom + tx : undefined;
  const screenY = horizontal !== undefined ? horizontal * zoom + ty : undefined;

  return (
    <svg
      className="absolute inset-0 pointer-events-none z-10"
      width={width}
      height={height}
    >
      {screenX !== undefined && (
        <line x1={screenX} y1={0} x2={screenX} y2={height} stroke="var(--canvas-accent, #1fa2dc)" strokeWidth={1} />
      )}
      {screenY !== undefined && (
        <line x1={0} y1={screenY} x2={width} y2={screenY} stroke="var(--canvas-accent, #1fa2dc)" strokeWidth={1} />
      )}
    </svg>
  );
}
