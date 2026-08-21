import type { RenderGraph } from './renderGraph';

export type RenderBackendId = 'ffmpeg-classic' | 'chromium-alpha-ffmpeg' | 'chromium-opaque-fx' | 'native-compositor-experimental';

export interface RenderBackendDecision {
  backend: RenderBackendId;
  stable: boolean;
  reason: string;
  blockers: string[];
  nextBackend?: RenderBackendId;
}

export function chooseRenderBackend(graph: RenderGraph): RenderBackendDecision {
  const blockers: string[] = [];
  const opaqueFxBase = graph.features.hasGraphics
    && graph.features.hasVirtualBase
    && !graph.features.hasMainVideo
    && !graph.features.hasOverlays
    && !graph.features.hasAudioMix
    && !graph.features.hasSubtitles
    && graph.output.format === 'mp4'
    && graph.output.background === 'black';
  if (graph.features.hasGraphics && !opaqueFxBase) blockers.push('HTML/花字层仍需要 Chromium 预渲染透明轨');
  if (opaqueFxBase) blockers.push('HTML/花字层会直接渲染为黑底视频层');
  if (graph.features.hasTransitions) blockers.push('转场暂由 FFmpeg xfade/acrossfade 处理');
  if (graph.features.hasSpeedChanges) blockers.push('变速/倒放暂由 FFmpeg setpts/atempo 处理');
  if (graph.features.hasAudioMix || graph.features.hasSubtitles) blockers.push('音频混音/字幕烧录暂由 FFmpeg filter graph 处理');

  if (opaqueFxBase) {
    return {
      backend: 'chromium-opaque-fx',
      stable: true,
      reason: '只有花字/特效且导出 MP4 黑底：Chromium 直接生成黑底视频层，跳过透明 MOV 和最终叠加。',
      blockers,
      nextBackend: 'native-compositor-experimental',
    };
  }

  if (graph.features.hasGraphics) {
    return {
      backend: 'chromium-alpha-ffmpeg',
      stable: true,
      reason: '包含 HTML/花字/特效层：先用 Chromium 生成透明总轨，再交给 FFmpeg/VideoToolbox 合成。',
      blockers,
      nextBackend: blockers.length === 1 ? 'native-compositor-experimental' : undefined,
    };
  }

  if (blockers.length === 0 && graph.features.hasMainVideo && !graph.features.hasOverlays) {
    return {
      backend: 'ffmpeg-classic',
      stable: true,
      reason: '纯主视频轨：可走 stream copy / concat / 跳过最终合成等智能快路径。',
      blockers,
      nextBackend: 'native-compositor-experimental',
    };
  }

  return {
    backend: 'ffmpeg-classic',
    stable: true,
    reason: '当前时间线包含需要 FFmpeg filter graph 处理的能力，继续走稳定合成路径。',
    blockers,
    nextBackend: blockers.length <= 1 ? 'native-compositor-experimental' : undefined,
  };
}

export function summarizeRenderGraph(graph: RenderGraph): string {
  const decision = chooseRenderBackend(graph);
  const counts = graph.nodes.reduce<Record<string, number>>((acc, n) => {
    acc[n.kind] = (acc[n.kind] ?? 0) + 1;
    return acc;
  }, {});
  return JSON.stringify({
    output: graph.output,
    node_counts: counts,
    features: graph.features,
    backend: decision,
    diagnostics: graph.diagnostics,
  }, null, 2);
}

export function describeRenderBackendForUser(graph: RenderGraph): {
  title: string;
  detail: string;
  badge: string;
  tips: string[];
} {
  const decision = chooseRenderBackend(graph);
  const tips: string[] = [];

  if (decision.backend === 'chromium-opaque-fx') {
    tips.push('黑底 MP4 会直接生成普通视频。');
  } else if (decision.backend === 'chromium-alpha-ffmpeg') {
    tips.push('先把花字/特效做成一条透明视频。');
  }
  if (graph.features.hasMainVideo && !graph.features.hasOverlays && !graph.features.hasGraphics && !graph.features.hasAudioMix && !graph.features.hasSubtitles) {
    tips.push('只有视频时，会尽量走快速导出。');
  }
  if (graph.features.hasVirtualBase) {
    tips.push('没有主视频时，会自动补一条底片。');
  }
  if (decision.blockers.length > 0) {
    tips.push('复杂特效会比普通视频更久。');
  }

  return {
    title: decision.backend === 'chromium-opaque-fx'
      ? '特效直出'
      : decision.backend === 'chromium-alpha-ffmpeg'
      ? '特效导出'
      : graph.features.hasMainVideo && !graph.features.hasOverlays && !graph.features.hasGraphics
        ? '快速导出'
        : '普通导出',
    detail: decision.backend === 'chromium-opaque-fx'
      ? '黑底 MP4 直接生成成片。'
      : decision.backend === 'chromium-alpha-ffmpeg'
      ? '花字和特效会一起处理。'
      : graph.features.hasMainVideo && !graph.features.hasOverlays && !graph.features.hasGraphics
        ? '会尽量减少重复处理。'
        : '按时间轴完整合成。',
    badge: decision.stable ? '稳定' : '实验',
    tips: tips.slice(0, 3),
  };
}
