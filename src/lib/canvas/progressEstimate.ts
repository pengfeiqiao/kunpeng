/**
 * progressEstimate — estimate completion ratio for a generating node based
 * on the average duration of recent successful tasks with the same engine.
 * RunningHub's /query returns no percentage, so this is a two-mode estimate:
 * with history → determinate ratio (capped at 95%); without → indeterminate.
 */
import { useCanvasTaskStore } from '@/stores/canvasTaskStore';

export function getEngineAvgDuration(engineId: string): number | null {
  const tasks = useCanvasTaskStore.getState().tasks;
  const samples = tasks
    .filter((t) => t.engineId === engineId && t.status === 'succeeded' && t.finishedAt)
    .slice(-5)
    .map((t) => t.finishedAt! - t.createdAt)
    .filter((d) => d > 1000);
  if (samples.length === 0) return null;
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}

/** Returns 0..0.95 when history exists, or null for indeterminate. */
export function estimateProgress(engineId: string, startedAt: number): number | null {
  const avg = getEngineAvgDuration(engineId);
  if (!avg) return null;
  return Math.min((Date.now() - startedAt) / avg, 0.95);
}
