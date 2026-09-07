import { AlertTriangle, ArrowUpRight } from 'lucide-react';
import { useCanvasStore } from '@/stores/canvasStore';
import { PROFESSIONAL_DRAFT_REQUEST_EVENT } from '@/lib/workspace/professionalDraftProjection';

/** Only selected-node conflict changes rerender this notice, not the Agent token stream. */
export default function SharedDraftNotice() {
  const id = useCanvasStore((state) => state.selectedNodeId);
  const conflict = useCanvasStore((state) => state.nodes.find((node) => node.id === state.selectedNodeId)?.data.workspaceDraftConflict);
  if (!id || !conflict) return null;
  return <aside role="status" style={{ maxWidth: 'min(420px, calc(100% - 32px))' }} className="absolute top-16 right-4 z-20 flex items-start gap-2 rounded-lg border border-amber-400/30 bg-[var(--canvas-panel)] p-3 text-[13px] leading-5 text-[var(--canvas-text-1)] shadow-lg">
    <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-400" />
    <div className="min-w-0 flex-1"><strong className="font-medium">共享草稿已更新</strong><p className="break-words text-[var(--canvas-text-2)]">{conflict.reason}</p></div>
    <button type="button" className="flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[var(--canvas-accent)] hover:bg-white/5 focus-visible:outline focus-visible:outline-2"
      onClick={() => window.dispatchEvent(new CustomEvent(PROFESSIONAL_DRAFT_REQUEST_EVENT, { detail: { nodeId: id }, cancelable: true }))}>
      查看草稿<ArrowUpRight size={14} />
    </button>
  </aside>;
}
