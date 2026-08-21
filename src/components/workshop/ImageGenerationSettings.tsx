import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';

export interface ImageEngineOption {
  value: string;
  label: string;
  title: string;
}

interface Props {
  engine: string;
  engineOptions: readonly ImageEngineOption[];
  onEngineChange: (value: string) => void;
  ratio: string;
  ratioOptions: readonly string[];
  onRatioChange: (value: string) => void;
  resolution?: string;
  resolutionOptions?: readonly string[];
  onResolutionChange?: (value: string) => void;
  compact?: boolean;
}

function engineLabel(options: readonly ImageEngineOption[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

export default function ImageGenerationSettings({
  engine,
  engineOptions,
  onEngineChange,
  ratio,
  ratioOptions,
  onRatioChange,
  resolution,
  resolutionOptions = [],
  onResolutionChange,
  compact = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const showResolution = Boolean(resolution && resolutionOptions.length > 0 && onResolutionChange);
  const summary = [
    engineLabel(engineOptions, engine),
    ratio,
    showResolution ? resolution?.toUpperCase() : undefined,
  ].filter(Boolean).join(' · ');

  const controls = (
    <div className={compact ? 'space-y-3 px-3 pb-3 pt-2' : 'flex flex-wrap items-end gap-4'}>
      <div className={compact ? '' : 'min-w-[210px]'}>
        <div className="mb-1.5 text-[10px] font-medium text-[var(--canvas-text-3)]">生成模型</div>
        <div
          className="grid gap-1 rounded-lg bg-black/20 p-1"
          style={{ gridTemplateColumns: `repeat(${engineOptions.length}, minmax(0, 1fr))` }}
        >
          {engineOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onEngineChange(option.value)}
              className="h-8 rounded-md px-2 text-[11px] font-medium transition-colors"
              style={{
                background: engine === option.value ? 'rgba(255,255,255,0.10)' : 'transparent',
                color: engine === option.value ? 'var(--canvas-text-1)' : 'var(--canvas-text-3)',
                boxShadow: engine === option.value ? 'inset 0 0 0 1px rgba(255,255,255,0.08)' : 'none',
              }}
              title={option.title}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <label className={compact ? 'block' : 'block min-w-[120px]'}>
        <span className="mb-1.5 block text-[10px] font-medium text-[var(--canvas-text-3)]">画面比例</span>
        <select
          value={ratio}
          onChange={(event) => onRatioChange(event.target.value)}
          className="h-9 w-full cursor-pointer rounded-lg border border-[var(--canvas-node-border)] bg-[var(--canvas-panel)] px-3 text-[11px] text-[var(--canvas-text-1)] outline-none transition-colors hover:border-[var(--canvas-node-border-selected)] focus:border-[var(--canvas-node-border-selected)]"
          aria-label="画面比例"
        >
          {ratioOptions.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>

      {showResolution && (
        <label className={compact ? 'block' : 'block min-w-[110px]'}>
          <span className="mb-1.5 block text-[10px] font-medium text-[var(--canvas-text-3)]">分辨率</span>
          <select
            value={resolution}
            onChange={(event) => onResolutionChange?.(event.target.value)}
            className="h-9 w-full cursor-pointer rounded-lg border border-[var(--canvas-node-border)] bg-[var(--canvas-panel)] px-3 text-[11px] text-[var(--canvas-text-1)] outline-none transition-colors hover:border-[var(--canvas-node-border-selected)] focus:border-[var(--canvas-node-border-selected)]"
            aria-label="分辨率"
          >
            {resolutionOptions.map((option) => <option key={option} value={option}>{option.toUpperCase()}</option>)}
          </select>
        </label>
      )}
    </div>
  );

  if (!compact) {
    return (
      <div className="rounded-xl border border-[var(--canvas-node-border)] bg-black/15 px-3 py-3">
        <div className="mb-3 flex items-center gap-2">
          <SlidersHorizontal size={13} className="text-[var(--canvas-text-2)]" />
          <span className="text-[11px] font-medium text-[var(--canvas-text-1)]">出图设置</span>
          <span className="text-[10px] text-[var(--canvas-text-3)]">{summary}</span>
        </div>
        {controls}
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-[var(--canvas-node-border)] bg-black/10">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-9 w-full items-center gap-2 px-3 text-left transition-colors hover:bg-[rgba(255,255,255,0.035)]"
        aria-expanded={open}
      >
        <SlidersHorizontal size={12} className="shrink-0 text-[var(--canvas-text-3)]" />
        <span className="text-[10px] font-medium text-[var(--canvas-text-2)]">生成设置</span>
        <span className="ml-auto truncate text-[10px] text-[var(--canvas-text-3)]">{summary}</span>
        <ChevronDown size={12} className={`shrink-0 text-[var(--canvas-text-3)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="border-t border-[var(--canvas-node-border)]">{controls}</div>}
    </div>
  );
}
