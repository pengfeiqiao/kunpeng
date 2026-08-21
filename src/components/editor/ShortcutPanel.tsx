/**
 * ShortcutPanel — 快捷键速查面板。按 ? 或工具栏键盘图标打开，
 * 数据来自 useEditorShortcuts.SHORTCUT_GROUPS（单一来源）。
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Keyboard, X } from 'lucide-react';
import { SHORTCUT_GROUPS, SHORTCUT_PANEL_EVENT } from '@/hooks/useEditorShortcuts';

export default function ShortcutPanel() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const toggle = () => setOpen((v) => !v);
    window.addEventListener(SHORTCUT_PANEL_EVENT, toggle);
    return () => window.removeEventListener(SHORTCUT_PANEL_EVENT, toggle);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="canvas-dark fixed inset-0 z-[99999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={() => setOpen(false)}
    >
      <div
        className="w-[640px] max-h-[76vh] overflow-y-auto rounded-2xl p-6"
        style={{
          background: 'rgba(24,24,28,0.97)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Keyboard size={16} className="text-[var(--canvas-text-2)]" />
            <span className="text-[14px] font-medium text-[var(--canvas-text-1)]">快捷键</span>
          </div>
          <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[rgba(255,255,255,0.07)] transition-colors">
            <X size={15} />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-6">
          {SHORTCUT_GROUPS.map((g) => (
            <div key={g.title}>
              <p className="text-[11px] text-[var(--canvas-text-3)] mb-2.5 tracking-wide">{g.title}</p>
              <div className="space-y-2">
                {g.items.map(([key, desc]) => (
                  <div key={key} className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-[var(--canvas-text-2)]">{desc}</span>
                    <kbd
                      className="px-1.5 py-0.5 rounded text-[10px] font-mono text-[var(--canvas-text-1)] whitespace-nowrap shrink-0"
                      style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.10)' }}
                    >
                      {key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
