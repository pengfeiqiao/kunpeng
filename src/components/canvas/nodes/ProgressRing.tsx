/**
 * ProgressRing — SVG progress indicator for generating nodes.
 * Determinate (history-based estimate) or indeterminate (rotating arc).
 */
import { useEffect, useState } from 'react';
import { estimateProgress } from '@/lib/canvas/progressEstimate';

export default function ProgressRing({ engineId, startedAt, size = 36 }: {
  engineId: string;
  startedAt: number;
  size?: number;
}) {
  const [ratio, setRatio] = useState<number | null>(() => estimateProgress(engineId, startedAt));

  useEffect(() => {
    const iv = setInterval(() => setRatio(estimateProgress(engineId, startedAt)), 1000);
    return () => clearInterval(iv);
  }, [engineId, startedAt]);

  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const stroke = 'var(--canvas-accent, #1fa2dc)';

  if (ratio === null) {
    // Indeterminate: 25% arc rotating
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="animate-spin" style={{ animationDuration: '1.2s' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={3} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={stroke} strokeWidth={3} strokeLinecap="round"
          strokeDasharray={`${c * 0.25} ${c * 0.75}`}
        />
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={3} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={stroke} strokeWidth={3} strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - ratio)}
        style={{ transition: 'stroke-dashoffset 1s linear' }}
      />
    </svg>
  );
}
