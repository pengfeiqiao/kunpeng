import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Clapperboard, X } from 'lucide-react';
import {
  DEFAULT_MG_MOTION_RECIPE,
  type MgMotionRecipe,
} from '@/lib/omni/styles';

interface OmniNarrativePanelProps {
  open: boolean;
  duration: number;
  recipe: Partial<MgMotionRecipe>;
  onApply: (recipe: MgMotionRecipe) => void;
  onClose: () => void;
}

const OPTIONS = {
  density: [
    { value: 'balanced', label: '均衡' },
    { value: 'rich', label: '丰富' },
    { value: 'maximal', label: '极丰富' },
  ],
  spatial: [
    { value: '2d', label: '2D' },
    { value: '2.5d', label: '2.5D' },
    { value: '3d', label: '3D' },
  ],
  rhythm: [
    { value: 'steady', label: '舒展' },
    { value: 'narrative', label: '叙事' },
    { value: 'punchy', label: '高能' },
  ],
  relationship: [
    { value: 'around-subject', label: '围绕主体' },
    { value: 'full-stage', label: '全画面舞台' },
    { value: 'replace-background', label: '重构环境' },
  ],
  material: [
    { value: 'follow-style', label: '跟随风格' },
    { value: 'glass', label: '玻璃' },
    { value: 'paper', label: '纸艺' },
    { value: 'soft-3d', label: '柔光 3D' },
    { value: 'graphic', label: '平面印刷' },
  ],
} as const;

export default function OmniNarrativePanel({
  open,
  duration,
  recipe,
  onApply,
  onClose,
}: OmniNarrativePanelProps) {
  const [draft, setDraft] = useState<MgMotionRecipe>({
    ...DEFAULT_MG_MOTION_RECIPE,
    ...recipe,
  });

  useEffect(() => {
    if (!open) return;
    setDraft({ ...DEFAULT_MG_MOTION_RECIPE, ...recipe });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open, recipe]);

  const patch = <K extends keyof MgMotionRecipe>(key: K, value: MgMotionRecipe[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const hookEnd = Math.round(duration * 0.2 * 10) / 10;
  const developmentEnd = Math.round(duration * 0.7 * 10) / 10;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="canvas-dark fixed inset-0 z-[99998]">
          <motion.button
            type="button"
            aria-label="关闭效果叙事"
            className="absolute inset-0 bg-black/35"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="absolute inset-y-0 right-0 flex w-[min(620px,calc(100vw-48px))] flex-col border-l border-[var(--canvas-node-border)] bg-[var(--canvas-panel)] shadow-2xl"
          >
            <header className="flex h-16 shrink-0 items-center gap-3 border-b border-[var(--canvas-node-border)] px-5">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[rgba(255,255,255,0.08)] text-[var(--canvas-text-1)]">
                <Clapperboard size={16} />
              </span>
              <div>
                <div className="text-[14px] font-semibold text-[var(--canvas-text-1)]">效果叙事</div>
                <div className="text-[10px] text-[var(--canvas-text-3)]">{duration} 秒动效结构</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  onApply(draft);
                  onClose();
                }}
                className="ml-auto h-9 rounded-md bg-[var(--canvas-text-1)] px-4 text-[11px] font-semibold text-[#111214] hover:opacity-90"
              >
                应用设置
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-md text-[var(--canvas-text-2)] hover:bg-[var(--canvas-controls-hover)] hover:text-[var(--canvas-text-1)]"
                title="关闭"
              >
                <X size={18} />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto p-5">
              <div className="mb-5 grid grid-cols-3 overflow-hidden rounded-lg border border-[rgba(255,255,255,0.1)]">
                <Beat label="钩子" time={`0–${hookEnd}s`} />
                <Beat label="展开" time={`${hookEnd}–${developmentEnd}s`} />
                <Beat label="收束" time={`${developmentEnd}–${duration}s`} />
              </div>

              <div className="space-y-3">
                <Setting label="元素密度" hint="同屏内容数量">
                  <Segment value={draft.density} options={OPTIONS.density} onChange={(value) => patch('density', value)} />
                </Setting>
                <Setting label="空间层次" hint="画面纵深">
                  <Segment value={draft.spatial} options={OPTIONS.spatial} onChange={(value) => patch('spatial', value)} />
                </Setting>
                <Setting label="运动节奏" hint="出现与转场速度">
                  <Segment value={draft.rhythm} options={OPTIONS.rhythm} onChange={(value) => patch('rhythm', value)} />
                </Setting>
                <Setting label="主体关系" hint="动效与人物、产品的关系">
                  <Segment value={draft.relationship} options={OPTIONS.relationship} onChange={(value) => patch('relationship', value)} />
                </Setting>
                <Setting label="材质语言" hint="统一视觉质感">
                  <Segment value={draft.material} options={OPTIONS.material} onChange={(value) => patch('material', value)} />
                </Setting>
              </div>
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function Beat({ label, time }: { label: string; time: string }) {
  return (
    <div className="border-r border-[rgba(255,255,255,0.08)] px-3 py-3 last:border-r-0">
      <div className="text-[11px] font-semibold text-[var(--canvas-text-1)]">{label}</div>
      <div className="mt-0.5 text-[9px] text-[var(--canvas-text-3)]">{time}</div>
    </div>
  );
}

function Setting({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[var(--canvas-node-border)] bg-[rgba(255,255,255,0.025)] p-3">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-[11px] font-semibold text-[var(--canvas-text-1)]">{label}</span>
        <span className="text-[9px] text-[var(--canvas-text-3)]">{hint}</span>
      </div>
      {children}
    </div>
  );
}

function Segment<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-md bg-[rgba(0,0,0,0.16)] p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className="min-w-[76px] flex-1 rounded-[5px] px-2 py-1.5 text-[10px] font-medium transition-colors"
          style={{
            color: option.value === value ? '#111214' : 'var(--canvas-text-3)',
            background: option.value === value ? 'var(--canvas-text-1)' : 'transparent',
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
