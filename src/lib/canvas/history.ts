/**
 * history — lightweight undo/redo snapshot stack for the canvas.
 *
 * Lives in module scope (NOT zustand, NOT persisted): restart clears it.
 * Snapshots are taken at discrete operation points by the CALLER (shortcuts,
 * context menu, drag start) — never per-frame — so drag storms can't flood
 * the stack. Transient node-data fields are stripped so undo can't resurrect
 * a spinning isGenerating state.
 */
import type { Node, Edge } from 'reactflow';
import { useCanvasStore } from '@/stores/canvasStore';
import { useCanvasTaskStore } from '@/stores/canvasTaskStore';

interface Snapshot { nodes: Node[]; edges: Edge[] }

const MAX_DEPTH = 50;
const TRANSIENT = ['isGenerating', 'justCompletedAt'];

const undoStack: Snapshot[] = [];
const redoStack: Snapshot[] = [];

function cloneClean(nodes: Node[], edges: Edge[]): Snapshot {
  return {
    nodes: nodes.map((n) => {
      const data = { ...(n.data as Record<string, unknown>) };
      for (const f of TRANSIENT) delete data[f];
      return { ...n, data };
    }),
    edges: edges.map((e) => ({ ...e })),
  };
}

/** Push the CURRENT canvas state onto the undo stack (call BEFORE mutating). */
export function captureSnapshot(): void {
  const { nodes, edges } = useCanvasStore.getState();
  undoStack.push(cloneClean(nodes, edges));
  if (undoStack.length > MAX_DEPTH) undoStack.shift();
  redoStack.length = 0;
}

function hasActiveTasks(): boolean {
  return useCanvasTaskStore.getState().tasks.some((t) =>
    ['queued', 'uploading', 'running', 'downloading'].includes(t.status),
  );
}

export function undo(): boolean {
  // While a generation is in flight, node data is being written back
  // asynchronously — replaying an old snapshot would corrupt it.
  if (hasActiveTasks()) return false;
  const snap = undoStack.pop();
  if (!snap) return false;
  const { nodes, edges } = useCanvasStore.getState();
  redoStack.push(cloneClean(nodes, edges));
  useCanvasStore.setState({ nodes: snap.nodes, edges: snap.edges });
  return true;
}

export function redo(): boolean {
  if (hasActiveTasks()) return false;
  const snap = redoStack.pop();
  if (!snap) return false;
  const { nodes, edges } = useCanvasStore.getState();
  undoStack.push(cloneClean(nodes, edges));
  useCanvasStore.setState({ nodes: snap.nodes, edges: snap.edges });
  return true;
}

export function canUndo(): boolean { return undoStack.length > 0; }
export function canRedo(): boolean { return redoStack.length > 0; }
