import type { TouliuMetrics } from '@/stores/touliuStore';

interface Props {
  metrics: TouliuMetrics[];
}

export default function MetricsChart({ metrics }: Props) {
  if (metrics.length < 2) return null;

  const maxCost = Math.max(...metrics.map((m) => m.cost), 1);
  const barWidth = Math.max(8, Math.min(32, Math.floor(200 / metrics.length)));

  return (
    <div className="border border-[rgb(var(--c-border))]/50 rounded-lg p-3">
      <div className="text-[10px] text-[rgb(var(--c-text-muted))] mb-2 font-medium">消耗趋势</div>
      <div className="flex items-end gap-1 h-[60px]">
        {metrics.slice(-14).map((m, i) => {
          const h = Math.max(2, (m.cost / maxCost) * 56);
          return (
            <div key={i} className="flex flex-col items-center gap-0.5" style={{ width: barWidth }}>
              <div
                className="bg-indigo-500/60 rounded-sm w-full transition-all"
                style={{ height: h }}
                title={`${m.date}: ¥${m.cost.toFixed(2)}`}
              />
              <span className="text-[8px] text-[rgb(var(--c-text-muted))] truncate w-full text-center">
                {m.date.slice(5)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
