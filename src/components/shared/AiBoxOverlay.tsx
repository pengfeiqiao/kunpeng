/**
 * AiBoxOverlay — Alt+拖拽画框 → 输入指令的通用覆盖层。
 * 三视图（画布/工坊/剪辑）复用。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUp, X } from 'lucide-react';

export interface AiBoxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  active: boolean;
  containerRef: React.RefObject<HTMLElement>;
  onSubmit: (rect: AiBoxRect, instruction: string) => void;
  onCancel: () => void;
}

type Phase = 'idle' | 'drawing' | 'input';

export default function AiBoxOverlay({ active, containerRef, onSubmit, onCancel }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [rect, setRect] = useState<AiBoxRect | null>(null);
  const [instruction, setInstruction] = useState('');
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const reset = useCallback(() => {
    setPhase('idle');
    setRect(null);
    setInstruction('');
    startRef.current = null;
  }, []);

  useEffect(() => {
    if (!active && phase === 'idle') reset();
  }, [active, phase, reset]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        reset();
        onCancel();
      }
    };
    if (active || phase !== 'idle') {
      window.addEventListener('keydown', handleKey);
      return () => window.removeEventListener('keydown', handleKey);
    }
  }, [active, phase, reset, onCancel]);

  const toLocal = (e: React.PointerEvent): { x: number; y: number } => {
    const el = containerRef.current;
    const box = el?.getBoundingClientRect();
    if (!box || !el) return { x: e.clientX, y: e.clientY };
    return { x: e.clientX - box.left + el.scrollLeft, y: e.clientY - box.top + el.scrollTop };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (phase === 'input') return;
    e.preventDefault();
    e.stopPropagation();
    const pt = toLocal(e);
    startRef.current = pt;
    setPhase('drawing');
    setRect({ x: pt.x, y: pt.y, width: 0, height: 0 });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (phase !== 'drawing' || !startRef.current) return;
    e.preventDefault();
    const pt = toLocal(e);
    const s = startRef.current;
    setRect({
      x: Math.min(s.x, pt.x),
      y: Math.min(s.y, pt.y),
      width: Math.abs(pt.x - s.x),
      height: Math.abs(pt.y - s.y),
    });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (phase !== 'drawing') return;
    e.preventDefault();
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    if (!rect || rect.width < 10 || rect.height < 10) {
      reset();
      return;
    }
    setPhase('input');
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleSubmit = () => {
    if (!instruction.trim() || !rect) return;
    onSubmit(rect, instruction.trim());
    reset();
  };

  const writeClipboardText = async (text: string) => {
    try {
      await navigator.clipboard?.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  };

  const replaceTextareaSelection = (el: HTMLTextAreaElement, text: string) => {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const next = el.value.slice(0, start) + text + el.value.slice(end);
    el.value = next;
    setInstruction(next);
    const cursor = start + text.length;
    requestAnimationFrame(() => {
      el.focus({ preventScroll: true });
      el.setSelectionRange(cursor, cursor);
    });
  };

  const handleTextShortcut = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod || e.altKey) return;
    const k = e.key.toLowerCase();
    const el = e.currentTarget;
    if (k === 'a') {
      e.preventDefault();
      e.stopPropagation();
      el.select();
      return;
    }
    if (k === 'c') {
      e.preventDefault();
      e.stopPropagation();
      const selected = el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0);
      if (selected) void writeClipboardText(selected);
      return;
    }
    if (k === 'x') {
      e.preventDefault();
      e.stopPropagation();
      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? 0;
      const selected = el.value.slice(start, end);
      if (!selected) return;
      void writeClipboardText(selected);
      replaceTextareaSelection(el, '');
      return;
    }
    if (k === 'v') {
      e.preventDefault();
      e.stopPropagation();
      void navigator.clipboard?.readText().then((text) => {
        if (text) replaceTextareaSelection(el, text);
      }).catch(() => undefined);
      return;
    }
    if (k === 'z') e.stopPropagation();
  };

  if (!active && phase === 'idle') return null;

  const inputPos = rect ? {
    left: Math.min(rect.x + rect.width, (containerRef.current?.clientWidth ?? 800) - 280),
    top: rect.y + rect.height + 8,
  } : undefined;

  return (
    <div
      className="absolute inset-0 z-50"
      style={{ cursor: phase === 'input' ? 'default' : 'crosshair', pointerEvents: active || phase !== 'idle' ? 'auto' : 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {rect && (rect.width > 2 || rect.height > 2) && (
        <div
          className="absolute border-2 rounded-md pointer-events-none"
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            background: 'rgba(59,130,246,0.10)',
            borderColor: 'rgba(59,130,246,0.55)',
          }}
        />
      )}

      <AnimatePresence>
        {phase === 'input' && inputPos && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.15 }}
            className="absolute rounded-2xl"
            style={{
              left: inputPos.left,
              top: inputPos.top,
              width: 272,
              background: 'rgba(20,20,22,0.97)',
              border: '1px solid rgba(255,255,255,0.12)',
              boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
              pointerEvents: 'auto',
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <textarea
              ref={inputRef}
              data-kunpeng-ai-input="true"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDownCapture={handleTextShortcut}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSubmit(); }
                if (e.key === 'Escape') { reset(); onCancel(); }
              }}
              onCopy={(e) => e.stopPropagation()}
              onCut={(e) => e.stopPropagation()}
              onPaste={(e) => e.stopPropagation()}
              placeholder="告诉 AI 这些内容要怎么改..."
              rows={2}
              className="w-full bg-transparent px-3.5 pt-3 pb-1 text-[12.5px] text-[var(--canvas-text-1)] leading-relaxed resize-none focus:outline-none placeholder:text-[var(--canvas-text-3)] max-h-[100px]"
            />
            <div className="flex items-center justify-between px-2.5 pb-2 pt-0.5">
              <button
                onClick={() => { reset(); onCancel(); }}
                className="p-1.5 rounded-md text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-1)] transition-colors"
              >
                <X size={13} />
              </button>
              <button
                onClick={handleSubmit}
                disabled={!instruction.trim()}
                className="w-7 h-7 rounded-full bg-white hover:brightness-90 disabled:opacity-30 flex items-center justify-center transition-all active:scale-95"
              >
                <ArrowUp size={14} className="text-black" strokeWidth={2.5} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
