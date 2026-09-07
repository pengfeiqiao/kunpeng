import { useEffect, useState } from 'react';
import { Undo2 } from 'lucide-react';
import { confirm as tauriConfirm } from '@tauri-apps/api/dialog';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';

const AUTO_DISMISS_MS = 8_000;

interface UndoState {
  snapshotId: string;
  label: string;
}

export default function ProjectDeleteUndoToast() {
  const [undoState, setUndoState] = useState<UndoState | null>(null);

  useEffect(() => {
    const onDelete = (event: Event) => {
      const detail = (event as CustomEvent<UndoState>).detail;
      if (detail?.snapshotId) setUndoState(detail);
    };
    window.addEventListener('kunpeng-project-delete-undo', onDelete);
    return () => window.removeEventListener('kunpeng-project-delete-undo', onDelete);
  }, []);

  useEffect(() => {
    if (!undoState) return;
    const timer = window.setTimeout(() => setUndoState(null), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [undoState]);

  const handleUndo = async () => {
    if (!undoState) return;
    const unified = useUnifiedProjectStore.getState();
    let result = await unified.restoreProjectSnapshot(undoState.snapshotId);
    if (result.status === 'confirmation-required') {
      const confirmed = await tauriConfirm(
        '仍有生成任务进行中。回退只恢复项目数据，不会取消已提交的供应商任务。确认回到删除前？',
        { title: '撤销项目删除', type: 'warning' },
      ).catch(() => false);
      if (!confirmed) return;
      result = await unified.restoreProjectSnapshot(undoState.snapshotId, true);
    }
    if (result.status === 'restored') setUndoState(null);
  };

  if (!undoState) return null;
  return (
    <div
      className="canvas-dark fixed bottom-6 left-1/2 z-[130] flex -translate-x-1/2 items-center gap-3 rounded-lg border border-[var(--canvas-node-border)] px-4 py-2.5 shadow-xl"
      style={{ background: 'var(--canvas-panel)' }}
    >
      <span className="text-[12px] text-[var(--canvas-text-1)]">已从项目删除「{undoState.label}」</span>
      <button
        onClick={() => { void handleUndo(); }}
        className="flex items-center gap-1 text-[12px] font-medium text-[var(--canvas-accent)] transition-opacity hover:opacity-80"
      >
        <Undo2 size={12} />撤销
      </button>
    </div>
  );
}
