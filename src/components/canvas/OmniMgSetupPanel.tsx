import { ChevronRight, Clapperboard, Layers3, Sparkles } from 'lucide-react';
import type { MgMotionRecipe } from '@/lib/omni/styles';

export type MgGenerationEngine = 'omni' | 'minimax-h3' | 'seedance-mini';

interface OmniMgSetupPanelProps {
  engine: MgGenerationEngine;
  duration: number;
  styleName: string;
  stylePreview: string;
  recipe: MgMotionRecipe;
  hasPrompt: boolean;
  polishing: boolean;
  onEngineChange: (engine: MgGenerationEngine) => void;
  onOpenStyles: () => void;
  onOpenNarrative: () => void;
  onPolish: () => void;
}

const densityLabels: Record<MgMotionRecipe['density'], string> = {
  balanced: '均衡',
  rich: '丰富',
  maximal: '极丰富',
};

const spatialLabels: Record<MgMotionRecipe['spatial'], string> = {
  '2d': '2D',
  '2.5d': '2.5D',
  '3d': '3D',
};

const rhythmLabels: Record<MgMotionRecipe['rhythm'], string> = {
  steady: '舒展',
  narrative: '叙事',
  punchy: '高能',
};

export default function OmniMgSetupPanel({
  engine,
  duration,
  styleName,
  stylePreview,
  recipe,
  hasPrompt,
  polishing,
  onEngineChange,
  onOpenStyles,
  onOpenNarrative,
  onPolish,
}: OmniMgSetupPanelProps) {
  const disabledTitle = hasPrompt ? undefined : '请先在下方填写动画内容';

  return (
    <section className="mx-3 mt-2.5 rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.02)] p-2">
      <div className="mb-2 flex items-center gap-2 px-0.5">
        <Sparkles size={12} className="text-[var(--canvas-text-2)]" />
        <span className="text-[11px] font-semibold text-[var(--canvas-text-1)]">Omni MG</span>
        {!hasPrompt && (
          <span className="ml-auto text-[9px] text-[var(--canvas-text-3)]">填写内容后可设置</span>
        )}
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        <div className="min-w-0 rounded-md border border-[var(--canvas-node-border)] bg-[rgba(0,0,0,0.12)] p-2">
          <div className="mb-1.5 flex items-center gap-1.5">
            <StepNumber value="1" />
            <span className="text-[9px] font-semibold text-[var(--canvas-text-2)]">引擎</span>
          </div>
          <div className="flex rounded-md border border-[rgba(255,255,255,0.08)] bg-[rgba(0,0,0,0.16)] p-0.5">
            {([
              ['minimax-h3', 'H3'],
              ['omni', 'Omni'],
              ['seedance-mini', 'Mini'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => onEngineChange(value)}
                className="flex-1 rounded-[5px] px-1.5 py-1 text-[9px] font-semibold transition-colors"
                style={{
                  color: engine === value ? '#111214' : 'var(--canvas-text-3)',
                  background: engine === value ? 'var(--canvas-text-1)' : 'transparent',
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1 truncate text-[8px] text-[var(--canvas-text-3)]">
            {engine === 'omni' ? '固定 10 秒' : engine === 'minimax-h3' ? `${duration} 秒 · 2K` : `${duration} 秒`}
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenStyles}
          disabled={!hasPrompt || polishing}
          title={disabledTitle}
          className="group min-w-0 rounded-md border border-[var(--canvas-node-border)] bg-[rgba(0,0,0,0.12)] p-2 text-left transition-colors enabled:hover:border-[rgba(255,255,255,0.22)] enabled:hover:bg-[rgba(255,255,255,0.045)] disabled:cursor-not-allowed disabled:opacity-30"
        >
          <div className="mb-1.5 flex items-center gap-1.5">
            <StepNumber value="2" />
            <span className="text-[9px] font-semibold text-[var(--canvas-text-2)]">风格</span>
            <ChevronRight size={11} className="ml-auto text-[var(--canvas-text-3)]" />
          </div>
          <div className="flex items-center gap-2">
            <img src={stylePreview} alt="" className="h-7 w-9 shrink-0 rounded object-cover" />
            <div className="min-w-0">
              <div className="truncate text-[9px] font-semibold text-[var(--canvas-text-1)]">{styleName}</div>
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={onOpenNarrative}
          disabled={!hasPrompt || polishing}
          title={disabledTitle}
          className="group min-w-0 rounded-md border border-[var(--canvas-node-border)] bg-[rgba(0,0,0,0.12)] p-2 text-left transition-colors enabled:hover:border-[rgba(255,255,255,0.22)] enabled:hover:bg-[rgba(255,255,255,0.045)] disabled:cursor-not-allowed disabled:opacity-30"
        >
          <div className="mb-1.5 flex items-center gap-1.5">
            <StepNumber value="3" />
            <span className="text-[9px] font-semibold text-[var(--canvas-text-2)]">效果叙事</span>
            <ChevronRight size={11} className="ml-auto text-[var(--canvas-text-3)]" />
          </div>
          <div className="flex items-center gap-1 text-[8px] font-medium text-[var(--canvas-text-2)]">
            <Clapperboard size={10} />
            <span>钩子</span>
            <span className="text-[var(--canvas-text-3)]">→</span>
            <span>展开</span>
            <span className="text-[var(--canvas-text-3)]">→</span>
            <span>收束</span>
          </div>
          <div className="mt-1 flex items-center gap-1 truncate text-[8px] text-[var(--canvas-text-3)]">
            <Layers3 size={10} className="shrink-0" />
            {densityLabels[recipe.density]} · {spatialLabels[recipe.spatial]} · {rhythmLabels[recipe.rhythm]}
          </div>
        </button>

        <button
          type="button"
          onClick={onPolish}
          disabled={!hasPrompt || polishing}
          title={disabledTitle}
          className="group min-w-0 rounded-md border border-[rgba(255,255,255,0.18)] bg-[rgba(255,255,255,0.055)] p-2 text-left transition-colors enabled:hover:border-[rgba(255,255,255,0.32)] enabled:hover:bg-[rgba(255,255,255,0.09)] disabled:cursor-not-allowed disabled:opacity-30"
        >
          <div className="mb-1.5 flex items-center gap-1.5">
            <StepNumber value="4" />
            <span className="text-[9px] font-semibold text-[var(--canvas-text-1)]">优化提示词</span>
            <ChevronRight size={11} className="ml-auto text-[var(--canvas-text-2)]" />
          </div>
          <div className="text-[9px] font-medium text-[var(--canvas-text-1)]">
            {polishing ? '正在优化…' : '按当前设置优化'}
          </div>
        </button>
      </div>
    </section>
  );
}

function StepNumber({ value }: { value: string }) {
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[rgba(255,255,255,0.16)] text-[8px] font-semibold text-[var(--canvas-text-2)]">
      {value}
    </span>
  );
}
