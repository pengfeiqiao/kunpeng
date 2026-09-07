import { AlertTriangle, RotateCcw } from 'lucide-react';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';
import { useWorkshopStore } from '@/stores/workshopStore';
import { findProjectObject } from '@/lib/projectObjects/selectors';

export default function ProjectChangeReview({ variant }: { variant: 'light' | 'dark' }) {
  const changes = useUnifiedProjectStore((state) => state.recentChangeSets);
  const conflicts = useUnifiedProjectStore((state) => state.pendingConflicts);
  const undo = useUnifiedProjectStore((state) => state.undoProjectChange);
  const resolve = useUnifiedProjectStore((state) => state.resolveProjectObjectConflict);
  const data = useWorkshopStore((state) => state.data);
  if (changes.length === 0 && conflicts.length === 0) return null;

  const border = variant === 'light' ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.07)';
  const foreground = variant === 'light' ? '#202124' : 'var(--canvas-text-1)';
  const secondary = variant === 'light' ? '#6B7280' : 'var(--canvas-text-3)';
  const button = variant === 'light' ? '#F3F4F6' : 'rgba(255,255,255,0.07)';
  const labelFor = (objectId: string) => data ? findProjectObject(data, objectId)?.label ?? objectId : objectId;

  return (
    <section className="shrink-0 px-4 py-2.5 space-y-2" style={{ borderBottom: `1px solid ${border}` }}>
      {conflicts.slice(0, 2).map((conflict) => (
        <div key={conflict.objectId} className="rounded-md border px-3 py-2" style={{ borderColor: 'rgba(245,158,11,0.35)', background: 'rgba(245,158,11,0.07)' }}>
          <div className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: foreground }}>
            <AlertTriangle size={12} className="text-amber-500" />
            用户刚修改了“{labelFor(conflict.objectId)}”
          </div>
          <p className="mt-1 text-[10px] leading-4" style={{ color: secondary }}>
            Agent 读取的是版本 {conflict.expectedVersion}，当前已是版本 {conflict.currentVersion}，未自动覆盖。
          </p>
          <div className="mt-2 flex gap-1.5">
            <button onClick={() => resolve(conflict.objectId, 'keep-user')} className="rounded px-2 py-1 text-[10px]" style={{ background: button, color: foreground }}>保留我的</button>
            <button onClick={() => resolve(conflict.objectId, 'apply-agent')} className="rounded px-2 py-1 text-[10px]" style={{ background: button, color: foreground }}>使用 Agent</button>
            {conflict.choices.includes('keep-both') && (
              <button onClick={() => resolve(conflict.objectId, 'keep-both')} className="rounded px-2 py-1 text-[10px]" style={{ background: button, color: foreground }}>两个都保留</button>
            )}
          </div>
        </div>
      ))}
      {changes.slice(0, 3).map((change) => (
        <div key={change.id} className="flex items-center gap-2 min-w-0 text-[11px]">
          <span className="truncate" style={{ color: foreground }}>
            {change.actor === 'agent' ? 'Agent' : '你'}修改了 {labelFor(change.objectId)} · {change.changes.map((item) => item.field).join('、') || '状态'}
          </span>
          <button onClick={() => undo(change.id)} className="ml-auto flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[10px]" style={{ color: secondary }} title="只撤销本次仍未被后续编辑覆盖的字段">
            <RotateCcw size={10} /> 撤销本轮
          </button>
        </div>
      ))}
    </section>
  );
}
