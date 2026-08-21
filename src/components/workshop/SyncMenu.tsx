/**
 * SyncMenu — 工坊步骤头部的「画布」收纳下拉：同步到画布 / 从画布拉取。
 * 解决头部按钮过挤的问题（主操作保持独立，低频同步操作收进菜单）。
 */
import { useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, ChevronDown, LayoutDashboard, Loader2 } from 'lucide-react';
import { useEscapeClose } from '@/lib/ui/layers';

interface Props {
  onSyncTo: () => Promise<void>;
  onPull: () => Promise<void>;
  syncToLabel?: string;
  syncToHint?: string;
  pullHint?: string;
  disabled?: boolean;
}

export default function SyncMenu({ onSyncTo, onPull, syncToLabel = '同步到画布', syncToHint, pullHint, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Esc 全局栈：只在本菜单位于栈顶时关闭
  useEscapeClose(open, () => setOpen(false));

  const run = async (fn: () => Promise<void>) => {
    setOpen(false);
    if (busy) return;
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || busy}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-[var(--canvas-text-2)] border border-[var(--canvas-node-border)] hover:text-[var(--canvas-text-1)] transition-colors disabled:opacity-40"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <LayoutDashboard size={12} />}
        画布 <ChevronDown size={10} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute top-full right-0 mt-1 w-[230px] z-50 rounded-xl border border-[var(--canvas-node-border)] py-1 shadow-xl"
            style={{ background: 'var(--canvas-panel)' }}
          >
            <button
              onClick={() => void run(onSyncTo)}
              className="w-full text-left px-3 py-2.5 hover:bg-[var(--canvas-controls-hover)] transition-colors"
            >
              <span className="flex items-center gap-2 text-[12px] text-[var(--canvas-text-1)]">
                <ArrowUpFromLine size={12} /> {syncToLabel}
              </span>
              {syncToHint && <span className="block ml-6 mt-0.5 text-[10px] text-[var(--canvas-text-3)] leading-snug">{syncToHint}</span>}
            </button>
            <button
              onClick={() => void run(onPull)}
              className="w-full text-left px-3 py-2.5 hover:bg-[var(--canvas-controls-hover)] transition-colors"
            >
              <span className="flex items-center gap-2 text-[12px] text-[var(--canvas-text-1)]">
                <ArrowDownToLine size={12} /> 从画布拉取
              </span>
              {pullHint && <span className="block ml-6 mt-0.5 text-[10px] text-[var(--canvas-text-3)] leading-snug">{pullHint}</span>}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
