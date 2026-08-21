/**
 * ToolbarDropdown — compact dropdown group for node toolbars.
 * One labeled trigger button → vertical dark menu, each item with icon +
 * Chinese label + one-line hint (zero learning cost).
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface DropdownItem {
  id: string;
  icon: LucideIcon;
  label: string;
  hint?: string;
  danger?: boolean;
  onClick: () => void;
}

export default function ToolbarDropdown({ icon: Icon, label, items }: {
  icon: LucideIcon;
  label: string;
  items: DropdownItem[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex flex-col items-center justify-center gap-1.5 px-3.5 py-2.5 min-w-[58px] rounded-xl transition-all duration-100 ${
          open ? 'bg-[var(--canvas-controls-active)] text-[var(--canvas-text-1)]' : 'text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)]'
        }`}
      >
        <span className="flex items-center gap-0.5">
          <Icon size={18} strokeWidth={2} />
          <ChevronDown size={9} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
        <span className="text-[12px] leading-none whitespace-nowrap">{label}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: -4 }}
            transition={{ duration: 0.13, ease: [0.25, 0.1, 0.25, 1] }}
            className="absolute top-full mt-1.5 left-1/2 -translate-x-1/2 min-w-[200px] py-1.5 rounded-xl z-[60]"
            style={{
              background: 'var(--canvas-panel)',
              border: '1px solid var(--canvas-node-border)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.2)',
            }}
          >
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => { setOpen(false); item.onClick(); }}
                className={`w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors ${
                  item.danger
                    ? 'text-[var(--canvas-danger)] hover:bg-[rgba(255,97,99,0.12)]'
                    : 'text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)]'
                }`}
              >
                <item.icon size={16} className={`mt-0.5 shrink-0 ${item.danger ? '' : 'text-[var(--canvas-text-2)]'}`} />
                <span className="min-w-0">
                  <span className="block text-[12px] leading-tight">{item.label}</span>
                  {item.hint && <span className="block text-[11px] text-[var(--canvas-text-3)] leading-tight mt-0.5">{item.hint}</span>}
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
