interface ReportData {
  title?: string;
  structure?: number;
  character?: number;
  dialogue?: number;
  emotion?: number;
  visual?: number;
  production?: number;
  overall?: number;
  rating?: string;
  comparables?: string[];
  summary?: string;
}

const DIMENSIONS = [
  { key: 'structure', label: '结构完整性', weight: '25%' },
  { key: 'character', label: '角色深度', weight: '20%' },
  { key: 'dialogue', label: '对话质量', weight: '20%' },
  { key: 'emotion', label: '情感冲击力', weight: '20%' },
  { key: 'visual', label: '视觉叙事', weight: '10%' },
  { key: 'production', label: '制作可行性', weight: '5%' },
] as const;

const RATING_COLORS: Record<string, string> = {
  '强烈推荐': '#10B981',
  '推荐': '#34D399',
  '考虑': '#F59E0B',
  '通过': '#FB923C',
  '退回': '#EF4444',
};

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function radarPoints(scores: number[], cx: number, cy: number, maxR: number): string {
  const step = 360 / scores.length;
  return scores
    .map((s, i) => {
      const r = (s / 10) * maxR;
      const { x, y } = polarToCartesian(cx, cy, r, i * step);
      return `${x},${y}`;
    })
    .join(' ');
}

function gridPoints(level: number, count: number, cx: number, cy: number, maxR: number): string {
  const r = (level / 10) * maxR;
  const step = 360 / count;
  return Array.from({ length: count }, (_, i) => {
    const { x, y } = polarToCartesian(cx, cy, r, i * step);
    return `${x},${y}`;
  }).join(' ');
}

interface Props {
  data: ReportData;
}

export default function ReportCard({ data }: Props) {
  const scores = DIMENSIONS.map(d => (data as any)[d.key] as number ?? 0);
  const cx = 120, cy = 120, maxR = 90;
  const ratingColor = RATING_COLORS[data.rating ?? ''] ?? 'var(--cw-text-muted)';

  return (
    <div className="rounded-xl border overflow-hidden my-3" style={{ borderColor: 'var(--cw-border)', background: 'var(--cw-bg)' }}>
      {/* Header */}
      <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--cw-border)', background: 'var(--cw-card)' }}>
        <p className="text-[14px] font-semibold" style={{ color: 'var(--cw-text)' }}>
          {data.title ?? '剧本诊断报告'}
        </p>
      </div>

      <div className="p-4 flex flex-col gap-5">
        {/* Radar chart + overall score */}
        <div className="flex items-start gap-6">
          <svg width={240} height={240} viewBox="0 0 240 240" className="shrink-0">
            <defs>
              <linearGradient id="radarGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#9CA3AF" stopOpacity="0.15" />
                <stop offset="100%" stopColor="#6B7280" stopOpacity="0.08" />
              </linearGradient>
            </defs>
            {/* Grid */}
            {[2, 4, 6, 8, 10].map(level => (
              <polygon
                key={level}
                points={gridPoints(level, 6, cx, cy, maxR)}
                fill="none"
                stroke="var(--cw-border)"
                strokeWidth={level === 10 ? 1.5 : 0.5}
              />
            ))}
            {/* Axis lines */}
            {DIMENSIONS.map((_, i) => {
              const { x, y } = polarToCartesian(cx, cy, maxR, i * 60);
              return (
                <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--cw-border)" strokeWidth={0.5} />
              );
            })}
            {/* Data polygon */}
            <polygon
              points={radarPoints(scores, cx, cy, maxR)}
              fill="url(#radarGrad)"
              stroke="var(--cw-accent)"
              strokeWidth={2}
            />
            {/* Data dots */}
            {scores.map((s, i) => {
              const r = (s / 10) * maxR;
              const { x, y } = polarToCartesian(cx, cy, r, i * 60);
              return <circle key={i} cx={x} cy={y} r={3} fill="var(--cw-accent)" />;
            })}
            {/* Labels */}
            {DIMENSIONS.map((d, i) => {
              const { x, y } = polarToCartesian(cx, cy, maxR + 18, i * 60);
              return (
                <text
                  key={i}
                  x={x}
                  y={y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="var(--cw-text-2)"
                  fontSize={10}
                >
                  {d.label}
                </text>
              );
            })}
          </svg>

          {/* Overall score */}
          <div className="flex-1 flex flex-col items-center justify-center py-4">
            {data.overall != null && (
              <>
                <span className="text-[42px] font-bold leading-none" style={{ color: 'var(--cw-accent)' }}>
                  {data.overall}
                </span>
                <span className="text-[12px] mt-1" style={{ color: 'var(--cw-text-muted)' }}>/10</span>
              </>
            )}
            {data.rating && (
              <span
                className="mt-3 px-3 py-1 rounded-full text-[12px] font-semibold"
                style={{ background: ratingColor + '20', color: ratingColor }}
              >
                {data.rating}
              </span>
            )}
          </div>
        </div>

        {/* Score bars */}
        <div className="space-y-2">
          {DIMENSIONS.map((d, i) => (
            <div key={d.key} className="flex items-center gap-2">
              <span className="text-[11px] w-20 shrink-0 text-right" style={{ color: 'var(--cw-text-2)' }}>
                {d.label}
              </span>
              <span className="text-[9px] w-8 shrink-0" style={{ color: 'var(--cw-text-muted)' }}>
                {d.weight}
              </span>
              <div className="flex-1 h-2.5 rounded-full" style={{ background: 'var(--cw-card)' }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${(scores[i] / 10) * 100}%`,
                    background: scores[i] >= 7 ? 'var(--cw-success)' : scores[i] >= 5 ? 'var(--cw-warning)' : 'var(--cw-danger)',
                  }}
                />
              </div>
              <span className="text-[12px] w-8 font-semibold" style={{ color: 'var(--cw-text)' }}>
                {scores[i]}
              </span>
            </div>
          ))}
        </div>

        {/* Summary */}
        {data.summary && (
          <div className="rounded-lg p-3" style={{ background: 'var(--cw-card)' }}>
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--cw-text-2)' }}>
              {data.summary}
            </p>
          </div>
        )}

        {/* Comparables */}
        {data.comparables && data.comparables.length > 0 && (
          <div>
            <p className="text-[11px] font-medium mb-1.5" style={{ color: 'var(--cw-text-muted)' }}>可比作品</p>
            <div className="flex flex-wrap gap-1.5">
              {data.comparables.map((c, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 rounded-full text-[11px]"
                  style={{ background: 'var(--cw-card)', color: 'var(--cw-text-2)' }}
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
