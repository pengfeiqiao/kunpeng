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

/**
 * 「视频编辑」模式约束：用户显式选择视频编辑模式且带参考视频时，Seedance 要求
 * ratio=adaptive、duration=-1（输出跟随输入视频），否则任务被拒。
 * 注意：带参考视频 ≠ 必然编辑——参考视频也可以只作多模态参考（多参），
 * 只有 videoEdit 明确开启时才应用这组约束（见画布「视频编辑」选项与
 * video_generate/canvas_generate 的 video_edit 参数）。
 */
export function applyKuaiziEditingConstraints(
  videoEdit: boolean,
  hasRefVideos: boolean,
  ratio: ('16:9' | '4:3' | '1:1' | '3:4' | '9:16' | '21:9' | 'adaptive') | undefined,
  duration: number,
): { ratio: typeof ratio; duration: number } {
  return videoEdit && hasRefVideos ? { ratio: 'adaptive', duration: -1 } : { ratio, duration };
}
