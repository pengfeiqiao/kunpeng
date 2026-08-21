import { Sparkles } from 'lucide-react';
import type { VideoPromptTemplate } from '@/lib/videoPrompt/prompt';

const OPTIONS: Array<{
  value: VideoPromptTemplate;
  label: string;
  description: string;
}> = [
  { value: 'legacy', label: '经典版', description: '沿用原来的分镜视频提示词写法' },
  { value: 'universal', label: '新版', description: '强化时间轴、站位与动作连续性' },
];

export default function VideoPromptVersionSwitch({
  value,
  onChange,
  prominent = false,
  title = '视频提示词版本',
}: {
  value: VideoPromptTemplate;
  onChange: (value: VideoPromptTemplate) => void;
  prominent?: boolean;
  title?: string;
}) {
  if (!prominent) {
    return (
      <div className="flex h-9 rounded-lg border border-[var(--canvas-node-border)] bg-[var(--canvas-panel)] p-0.5">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className="flex-1 rounded-md px-3 text-[11px] font-medium transition-colors"
            style={{
              background: value === option.value ? 'var(--canvas-controls-hover)' : 'transparent',
              color: value === option.value ? 'var(--canvas-text-1)' : 'var(--canvas-text-3)',
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <section className="mt-5 rounded-xl border border-[var(--canvas-node-border-selected)] bg-[var(--canvas-node-bg)] p-4">
      <div className="mb-3 flex items-start gap-2">
        <Sparkles size={15} className="mt-0.5 shrink-0 text-[var(--canvas-accent)]" />
        <div>
          <div className="text-[13px] font-semibold text-[var(--canvas-text-1)]">{title}</div>
          <div className="mt-0.5 text-[11px] text-[var(--canvas-text-3)]">现在选择，后续写提示词和生成视频会自动沿用。</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {OPTIONS.map((option) => {
          const active = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className="min-h-[62px] rounded-lg border px-3 py-2 text-left transition-colors"
              style={{
                borderColor: active ? 'var(--canvas-accent)' : 'var(--canvas-node-border)',
                background: active ? 'var(--canvas-controls-hover)' : 'rgba(255,255,255,0.02)',
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-semibold text-[var(--canvas-text-1)]">{option.label}</span>
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: active ? 'var(--canvas-accent)' : 'var(--canvas-text-3)' }}
                />
              </div>
              <div className="mt-1 text-[10px] leading-4 text-[var(--canvas-text-3)]">{option.description}</div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
