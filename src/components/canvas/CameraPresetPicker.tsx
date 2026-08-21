/**
 * CameraPresetPicker — Lens Combo style picker: camera/lens combos + 20
 * camera moves. Click to append the preset text to the prompt (multi-select
 * accumulates; selected entries highlighted).
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check } from 'lucide-react';
import { CAMERA_COMBOS, CAMERA_MOVES } from '@/lib/canvas/cameraPresets';

export default function CameraPresetPicker({ open, kind, onClose, onAppend }: {
  open: boolean;
  kind: 'image' | 'video';
  onClose: () => void;
  /** Called with the preset body to append. */
  onAppend: (body: string) => void;
}) {
  const [tab, setTab] = useState<'combo' | 'move'>('combo');
  const [used, setUsed] = useState<Set<string>>(new Set());

  const moves = CAMERA_MOVES.filter((m) => m.kinds.includes(kind));

  const pick = (id: string, body: string) => {
    if (used.has(id)) return;
    setUsed((s) => new Set(s).add(id));
    onAppend(body);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.97 }}
          transition={{ duration: 0.15 }}
          className="absolute bottom-full mb-2 left-0 right-0 z-50 rounded-xl overflow-hidden"
          style={{ background: 'var(--canvas-panel)', border: '1px solid var(--canvas-node-border)', boxShadow: '0 8px 32px rgba(0,0,0,0.35)' }}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-[rgba(255,255,255,0.06)]">
            <div className="flex gap-1">
              {([['combo', '镜头组合'], ['move', '运镜']] as const).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] transition-colors ${
                    tab === k ? 'bg-[rgba(255,255,255,0.1)] text-[var(--canvas-text-1)] font-medium' : 'text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-2)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="text-[9px] text-[var(--canvas-text-3)]">点选注入提示词，可多选叠加</span>
            <button onClick={onClose} className="p-1 rounded hover:bg-[var(--canvas-controls-hover)] text-[var(--canvas-text-2)]"><X size={13} /></button>
          </div>

          <div className="max-h-[220px] overflow-y-auto p-2">
            {tab === 'combo' ? (
              <div className="grid grid-cols-3 gap-1.5">
                {CAMERA_COMBOS.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => pick(c.id, c.body)}
                    title={c.body}
                    className={`text-left px-2.5 py-2 rounded-lg border transition-colors ${
                      used.has(c.id)
                        ? 'border-[rgba(31,162,220,0.5)] bg-[rgba(31,162,220,0.1)]'
                        : 'border-[var(--canvas-node-border)] hover:border-[var(--canvas-node-border-selected)] hover:bg-[var(--canvas-controls-hover)]'
                    }`}
                  >
                    <span className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-[var(--canvas-text-1)]">{c.label}</span>
                      {used.has(c.id) && <Check size={10} className="text-[var(--canvas-accent)]" />}
                    </span>
                    <span className="block text-[9px] text-[var(--canvas-text-3)] mt-0.5">{c.scene}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-1.5">
                {moves.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => pick(m.id, m.body)}
                    title={m.body}
                    className={`px-2 py-1.5 rounded-lg border text-[11px] transition-colors ${
                      used.has(m.id)
                        ? 'border-[rgba(31,162,220,0.5)] bg-[rgba(31,162,220,0.1)] text-[var(--canvas-text-1)]'
                        : 'border-[var(--canvas-node-border)] text-[var(--canvas-text-2)] hover:border-[var(--canvas-node-border-selected)] hover:text-[var(--canvas-text-1)]'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
