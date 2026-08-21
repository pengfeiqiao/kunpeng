/**
 * ParamPopover — 组合参数胶囊：胶囊只显示参数摘要（如「720p / 5s / 音频 / 16:9」），
 * 点击向上弹出带标签的成组控件面板。参考 TapNow 配置栏设计——把 N 个散落的
 * pill 收纳成 1 个，根治底部参数行横向溢出。
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

export function ParamSummaryPill({ summary, title, children, width = 300 }: {
  summary: string;
  title?: string;
  children: React.ReactNode;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0" title={title}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 bg-[rgba(255,255,255,0.05)] hover:bg-[var(--canvas-controls-hover)] border border-[var(--canvas-node-border)] rounded-lg text-[12px] text-[var(--canvas-text-1)] font-medium py-1.5 pl-3 pr-2 transition-colors whitespace-nowrap"
      >
        {summary}
        <ChevronDown size={11} className={`text-[var(--canvas-text-2)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            className="absolute bottom-full mb-2 left-0 z-50 rounded-2xl p-3.5 space-y-3"
            style={{
              width,
              background: 'rgba(24,25,28,0.96)',
              backdropFilter: 'blur(24px) saturate(1.4)',
              WebkitBackdropFilter: 'blur(24px) saturate(1.4)',
              border: '1px solid rgba(255,255,255,0.08)',
              boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** 面板内一行：左标签 + 右控件 */
export function PopRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="shrink-0 pt-1">
        <span className="text-[11px] text-[var(--canvas-text-2)]">{label}</span>
        {hint && <p className="text-[9px] text-[var(--canvas-text-3)] mt-0.5 max-w-[80px] leading-tight">{hint}</p>}
      </div>
      <div className="flex-1 flex justify-end">{children}</div>
    </div>
  );
}

/** 分段选择（可换行） */
export function PopSeg<T extends string>({ value, onChange, options }: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-2 py-1 rounded-md text-[10.5px] transition-colors whitespace-nowrap ${
            o.value === value
              ? 'bg-[rgba(255,255,255,0.14)] text-[var(--canvas-text-1)] font-medium'
              : 'bg-[rgba(255,255,255,0.04)] text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-2)] hover:bg-[rgba(255,255,255,0.07)]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 开关 */
export function PopToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="relative w-8 h-[18px] rounded-full transition-colors shrink-0"
      style={{ background: checked ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.12)' }}
    >
      <span
        className="absolute top-[2px] w-[14px] h-[14px] rounded-full transition-all"
        style={{ left: checked ? 16 : 2, background: checked ? '#141414' : 'rgba(255,255,255,0.6)' }}
      />
    </button>
  );
}

/** 数字/文本小输入 */
export function PopInput({ value, onChange, placeholder, width = 88 }: {
  value: string; onChange: (v: string) => void; placeholder?: string; width?: number;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ width }}
      className="px-2 py-1 rounded-md text-[11px] bg-[rgba(255,255,255,0.05)] border border-[var(--canvas-node-border)] text-[var(--canvas-text-1)] focus:outline-none focus:border-[rgba(255,255,255,0.4)] placeholder:text-[var(--canvas-text-3)]"
    />
  );
}

/** 连续数值滑块：用于秒数等范围较大的参数，避免渲染大量分段按钮。 */
export function PopSlider({ value, min, max, step = 1, unit = '', onChange }: {
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  const safeValue = Math.min(max, Math.max(min, value));
  const progress = max === min ? 0 : ((safeValue - min) / (max - min)) * 100;
  return (
    <div className="w-[178px] rounded-xl border border-[var(--canvas-node-border)] bg-[rgba(255,255,255,0.035)] px-3 py-2">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[9px] text-[var(--canvas-text-3)]">{min}{unit}</span>
        <span className="min-w-[46px] rounded-md bg-[rgba(255,255,255,0.1)] px-2 py-0.5 text-center text-[11px] font-semibold tabular-nums text-[var(--canvas-text-1)]">
          {safeValue}{unit}
        </span>
        <span className="text-[9px] text-[var(--canvas-text-3)]">{max}{unit}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={safeValue}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#17181b] [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_2px_8px_rgba(0,0,0,0.45)]"
        style={{
          background: `linear-gradient(90deg, rgba(255,255,255,0.88) 0%, rgba(255,255,255,0.88) ${progress}%, rgba(255,255,255,0.12) ${progress}%, rgba(255,255,255,0.12) 100%)`,
        }}
        aria-label={`时长 ${safeValue}${unit}`}
      />
    </div>
  );
}

/** 面板分隔线 */
export function PopDivider() {
  return <div className="h-px bg-[rgba(255,255,255,0.06)] -mx-1" />;
}
