import type { KuaiziVideoMode } from './seedance';

/**
 * 钳制筷子丽帧 duration：2.0 档 4-15s，seedance2.5 档 4-30s。
 * -1（智能时长）语义不在此处理——mini 的 -1 由 canvasGen 路由保留走 RHTV。
 */
export function normalizeKuaiziDuration(raw: unknown, fallback = 5, mode?: KuaiziVideoMode): number {
  const parsed = typeof raw === 'number'
    ? raw
    : typeof raw === 'string'
      ? Number(raw)
      : Number.NaN;
  const duration = Number.isFinite(parsed) && parsed >= 0
    ? Math.trunc(parsed)
    : fallback;
  const max = mode === 'seedance2.5' ? 30 : 15;
  return Math.min(max, Math.max(4, duration));
}
