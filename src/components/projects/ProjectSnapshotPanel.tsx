import { useState } from 'react';
import { History, RotateCcw, X } from 'lucide-react';
import { confirm } from '@tauri-apps/api/dialog';
import { useWorkshopStore } from '@/stores/workshopStore';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';
import { projectSnapshotList } from '@/lib/projectObjects/snapshots';

export default function ProjectSnapshotPanel({ onClose }: { onClose: () => void }) {
  const data = useWorkshopStore((state) => state.data);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const entries = projectSnapshotList({ projectSnapshots: data?.projectSnapshots });
  const restore = async (snapshotId: string) => {
    if (busy || !data) return;
    const projectId = data.projectId;
    setBusy(snapshotId);
    setError('');
    try {
      const store = useUnifiedProjectStore.getState();
      let result = await store.restoreProjectSnapshot(snapshotId);
      if (result.status === 'confirmation-required') {
        const allowed = await confirm('仍有生成任务。回退只恢复项目数据，不取消已提交的供应商任务，也不会退还已发生费用。继续回退？', { title: '回到快照', type: 'warning' });
        if (!allowed) return;
        if (useUnifiedProjectStore.getState().activeId !== projectId) {
          setError('项目已切换，未执行回退。');
          return;
        }
        result = await store.restoreProjectSnapshot(snapshotId, true);
      }
      if (result.status === 'restored') onClose();
      else setError(result.reason || '无法回退此快照。');
    } catch {
      setError('快照恢复或保存失败。请检查项目状态后重试。');
    } finally { setBusy(null); }
  };
  return (
    <div className="fixed inset-0 z-[145] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="项目快照">
      <section className="flex max-h-[80vh] w-full max-w-xl flex-col rounded-lg border border-white/10 bg-[#19191b] text-gray-100 shadow-2xl">
        <header className="flex shrink-0 items-center gap-2 border-b border-white/10 p-4">
          <History size={18} /><h2 className="flex-1 text-[15px] font-semibold">项目快照</h2>
          <button aria-label="关闭快照" title="关闭" disabled={Boolean(busy)} onClick={onClose} className="p-1 disabled:opacity-40"><X size={18} /></button>
        </header>
        <div className="min-h-0 overflow-y-auto p-3">
          {!entries.length && <p className="p-4 text-[13px] text-gray-400">暂无项目快照</p>}
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-center gap-3 border-b border-white/5 px-2 py-3 last:border-0">
              <div className="min-w-0 flex-1">
                <div className="break-words text-[13px]">{entry.label}</div>
                <div className="mt-1 text-[12px] text-gray-400">{new Date(entry.createdAt).toLocaleString()} · {entry.messageId ? '对话快照' : '项目快照'}</div>
              </div>
              <button onClick={() => void restore(entry.id)} disabled={Boolean(busy)} title="回到此刻" className="flex shrink-0 items-center gap-1 rounded-md px-2 py-2 text-[13px] text-teal-300 hover:bg-white/5 disabled:opacity-40">
                <RotateCcw size={14} />{busy === entry.id ? '恢复中' : '回到此刻'}
              </button>
            </div>
          ))}
        </div>
        {error && <p role="alert" className="border-t border-white/10 p-4 text-[13px] text-red-300">{error}</p>}
      </section>
    </div>
  );
}
