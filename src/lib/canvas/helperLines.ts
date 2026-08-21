/**
 * helperLines — alignment guides while dragging (ported from the official
 * reactflow helper-lines example, simplified). For the dragged node we test
 * 6 alignment candidates (left/center/right, top/middle/bottom) against all
 * other nodes; within SNAP_DISTANCE we snap the position and return the line
 * coordinates for the overlay to draw.
 */
import type { Node, NodePositionChange, XYPosition } from 'reactflow';

const SNAP_DISTANCE = 5;

export interface HelperLinesResult {
  horizontal?: number; // y in flow coords
  vertical?: number;   // x in flow coords
  snapPosition: Partial<XYPosition>;
}

interface Box { left: number; right: number; top: number; bottom: number; width: number; height: number }

function boxOf(n: Node): Box {
  const w = n.width ?? 200;
  const h = n.height ?? 150;
  // positionAbsolute accounts for parentNode offsets (grouped nodes)
  const p = (n as Node & { positionAbsolute?: XYPosition }).positionAbsolute ?? n.position;
  return { left: p.x, right: p.x + w, top: p.y, bottom: p.y + h, width: w, height: h };
}

export function getHelperLines(
  change: NodePositionChange,
  nodes: Node[],
): HelperLinesResult {
  const result: HelperLinesResult = { snapPosition: { x: undefined, y: undefined } };
  const moving = nodes.find((n) => n.id === change.id);
  if (!moving || !change.position) return result;

  const w = moving.width ?? 200;
  const h = moving.height ?? 150;
  const box: Box = {
    left: change.position.x,
    right: change.position.x + w,
    top: change.position.y,
    bottom: change.position.y + h,
    width: w,
    height: h,
  };

  let bestV = SNAP_DISTANCE;
  let bestH = SNAP_DISTANCE;

  for (const other of nodes) {
    if (other.id === change.id || other.type === 'group') continue;
    const ob = boxOf(other);

    // Vertical candidates: my left/center/right vs other's left/center/right
    const vPairs: Array<[number, number]> = [
      [box.left, ob.left], [box.left, ob.right],
      [box.right, ob.left], [box.right, ob.right],
      [box.left + w / 2, ob.left + ob.width / 2],
    ];
    for (const [mine, theirs] of vPairs) {
      const d = Math.abs(mine - theirs);
      if (d < bestV) {
        bestV = d;
        result.vertical = theirs;
        result.snapPosition.x = change.position.x + (theirs - mine);
      }
    }

    // Horizontal candidates
    const hPairs: Array<[number, number]> = [
      [box.top, ob.top], [box.top, ob.bottom],
      [box.bottom, ob.top], [box.bottom, ob.bottom],
      [box.top + h / 2, ob.top + ob.height / 2],
    ];
    for (const [mine, theirs] of hPairs) {
      const d = Math.abs(mine - theirs);
      if (d < bestH) {
        bestH = d;
        result.horizontal = theirs;
        result.snapPosition.y = change.position.y + (theirs - mine);
      }
    }
  }

  return result;
}
