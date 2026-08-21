/**
 * NodeParamBadge — always-visible one-liner of generation params at the
 * bottom of a node card, e.g. "GPT · 16:9 · 2K". Fields degrade gracefully.
 */
const ENGINE_SHORT: Record<string, string> = {
  'gpt-image-2': 'GPT',
  'midjourney': 'MJ',
  'midjourney-v81': 'MJ',
  'dreamina': '即梦',
  'gemini': 'Gemini',
  'seedance-2.0': 'Seedance',
  'seedance-2.0-fast': 'Seedance Fast',
  'seedance-2.0-t2v': 'Seedance',
  'seedance-2.5': 'Seedance 2.5',
  'dreamina-seedance-2.5': 'Seedance 2.5',
  'startend-v3.1-pro': 'Seedance 首尾帧',
  'minimax-hailuo-h3': 'MiniMax H3',
  'minimax-h3': 'MiniMax H3',
};

export default function NodeParamBadge({ data }: { data: Record<string, unknown> }) {
  const parts: string[] = [];
  const engine = (data.imageModel || data.modelVersion) as string | undefined;
  if (engine) parts.push(ENGINE_SHORT[engine] ?? engine);
  const ratio = data.aspectRatio as string | undefined;
  if (ratio && ratio !== 'adaptive') parts.push(ratio);
  else if (ratio === 'adaptive') parts.push('自适应');
  const res = data.resolution as string | undefined;
  if (res) parts.push(res.toUpperCase());
  const dur = data.duration as number | undefined;
  if (dur) parts.push(`${dur}s`);

  if (parts.length === 0) return null;
  return (
    <div className="mt-1.5 text-[9px] text-[var(--canvas-text-3)] truncate select-none">
      {parts.join(' · ')}
    </div>
  );
}
