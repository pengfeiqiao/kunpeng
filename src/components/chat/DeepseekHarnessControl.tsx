import { Activity, Cpu } from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useDeepseekHarnessStore } from '@/stores/deepseekHarnessStore';

interface Props {
  providerId: string;
  variant?: 'dark' | 'light';
  disabled?: boolean;
  compact?: boolean;
}

export default function DeepseekHarnessControl({ providerId, variant = 'light', disabled, compact = false }: Props) {
  const engine = useSettingsStore((state) => state.deepseekEngine);
  const setEngine = useSettingsStore((state) => state.setDeepseekEngine);
  const runs = useDeepseekHarnessStore((state) => state.runs);

  if (providerId !== 'deepseek') return null;

  const phases = Object.values(runs);
  const isFallingBack = phases.includes('fallback');
  const isHarnessRunning = phases.includes('running');
  const isBusy = isFallingBack || isHarnessRunning;
  const isDark = variant === 'dark';
  const label = engine === 'builtin'
    ? '普通模式'
    : isFallingBack
      ? '普通模式接管中'
      : isHarnessRunning
        ? 'Harness 工作中'
        : 'Harness';
  const title = isBusy
    ? `${label}，当前任务结束后可切换执行模式`
    : engine === 'harness'
      ? '当前使用 DeepSeek Harness。点击切换为普通模式'
      : '当前使用 DeepSeek 普通模式。点击切换为 Harness';

  return (
    <button
      type="button"
      disabled={disabled || isBusy}
      onClick={() => setEngine(engine === 'harness' ? 'builtin' : 'harness')}
      title={title}
      aria-label={title}
      aria-pressed={engine === 'harness'}
      className={`flex h-7 shrink-0 items-center justify-center rounded-full border text-[10.5px] font-medium transition-colors disabled:cursor-default disabled:opacity-70 ${compact ? 'w-7 px-0' : 'max-w-[150px] gap-1.5 px-2'}`}
      style={{
        color: isDark ? 'var(--canvas-text-2)' : 'rgb(var(--c-text-muted))',
        borderColor: isDark ? 'rgba(255,255,255,0.10)' : 'rgb(var(--c-border))',
        background: isDark ? 'rgba(255,255,255,0.04)' : 'rgb(var(--c-card))',
      }}
    >
      {engine === 'harness' ? (
        <Activity size={11} className={isHarnessRunning ? 'animate-pulse' : ''} />
      ) : (
        <Cpu size={11} />
      )}
      {!compact && <span className="truncate">{label}</span>}
    </button>
  );
}
