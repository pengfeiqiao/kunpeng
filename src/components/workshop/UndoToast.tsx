/**
 * UndoToast — 资产级联删除后的底部悬浮撤销条。
 * 监听 workshopStore.lastDelete：删除后出现，8 秒自动消失；点「撤销」恢复快照。
 */
import { useEffect, useState } from 'react';
import { Undo2 } from 'lucide-react';
import { useWorkshopStore } from '@/stores/workshopStore';

const AUTO_DISMISS_MS = 8000;

export default function UndoToast() {
  const lastDelete = useWorkshopStore((s) => s.lastDelete);
  const undoLastDelete = useWorkshopStore((s) => s.undoLastDelete);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!lastDelete) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [lastDelete]);

  if (!visible || !lastDelete) return null;

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl border border-[var(--canvas-node-border)] px-4 py-2.5 shadow-xl"
      style={{ background: 'var(--canvas-panel)' }}
    >
      <span className="text-[12px] text-[var(--canvas-text-1)]">
        已删除「{lastDelete.name}」，影响 {lastDelete.affectedShots} 个分镜
      </span>
      <button
        onClick={() => { undoLastDelete(); setVisible(false); }}
        className="flex items-center gap-1 text-[12px] font-medium transition-opacity hover:opacity-80"
        style={{ color: 'var(--canvas-accent)' }}
      >
        <Undo2 size={12} /> 撤销
      </button>
    </div>
  );
}
