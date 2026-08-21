/**
 * useCanvasShortcuts — unified keyboard layer for the canvas view.
 *
 * Delete/Backspace  delete selection (multi-aware, keeps referenceImages cleanup)
 * Cmd/Ctrl+C/X/V/D  copy / cut / paste / duplicate
 * Cmd/Ctrl+Z        undo;  +Shift redo
 * Cmd/Ctrl+G        group; +Shift ungroup
 * Cmd/Ctrl+A        select all
 * Cmd/Ctrl+0        fit view
 * Esc               clear selection
 */
import { useEffect } from 'react';
import { useReactFlow } from 'reactflow';
import { useCanvasStore } from '@/stores/canvasStore';
import { copySelection, cutSelection, pasteClipboard, duplicateSelection } from '@/lib/canvas/clipboard';
import { undo, redo, captureSnapshot } from '@/lib/canvas/history';
import { groupSelection, ungroupSelection } from '@/lib/canvas/grouping';

function isEditableTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement;
  return Boolean(t.closest?.('input, textarea, [contenteditable="true"], [data-kunpeng-ai-input="true"]'))
    || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
}

export function useCanvasShortcuts() {
  const { fitView } = useReactFlow();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isEditableTarget(e)) return;
      const store = useCanvasStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'c' && document.getSelection()?.toString()) return;

      // ── Delete / Backspace ────────────────────────────────────────────
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const selectedNodes = store.nodes.filter((n) => n.selected);
        const singleId = store.selectedNodeId;
        const selectedEdges = store.edges.filter((edge) => edge.selected);
        if (selectedNodes.length === 0 && !singleId && selectedEdges.length === 0) return;
        e.preventDefault();
        captureSnapshot();
        if (selectedNodes.length > 0) {
          // deleteNode keeps the referenceImages-cleanup semantics per node
          for (const n of selectedNodes) store.deleteNode(n.id);
        } else if (singleId) {
          store.deleteNode(singleId);
        }
        for (const edge of selectedEdges) store.deleteEdge(edge.id);
        store.setSelectedNodeId(null);
        return;
      }

      if (e.key === 'Escape') {
        store.setSelectedNodeId(null);
        useCanvasStore.setState({
          nodes: store.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
        });
        return;
      }

      if (!mod) return;

      switch (k) {
        case 'c':
          if (copySelection() > 0) e.preventDefault();
          break;
        case 'x':
          if (cutSelection() > 0) e.preventDefault();
          break;
        case 'v':
          if (pasteClipboard() > 0) e.preventDefault();
          break;
        case 'd':
          e.preventDefault();
          duplicateSelection();
          break;
        case 'z':
          e.preventDefault();
          if (e.shiftKey) redo(); else undo();
          break;
        case 'g':
          e.preventDefault();
          if (e.shiftKey) ungroupSelection(); else groupSelection();
          break;
        case 'a':
          e.preventDefault();
          useCanvasStore.setState({
            nodes: store.nodes.map((n) => ({ ...n, selected: true })),
          });
          break;
        case '0':
          e.preventDefault();
          fitView({ padding: 0.2, duration: 300 });
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [fitView]);
}
