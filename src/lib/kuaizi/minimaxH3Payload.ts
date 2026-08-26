/**
 * 筷子 MiniMax H3 兼容端点的请求体构造（纯函数，便于 node --test 单测）。
 * MiniMax Video Generation V2 协议：content 数组（text + image_url/video_url/audio_url）。
 */

export type KuaiziH3ContentItem =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string }; role: 'reference_image' }
  | { type: 'video_url'; video_url: { url: string }; role: 'reference_video' }
  | { type: 'audio_url'; audio_url: { url: string }; role: 'reference_audio' };

/** 构造 MiniMax V2 content 数组；参考素材统一走 reference_* 角色（不用首尾帧角色，避免互斥）。 */
export function buildKuaiziH3Payload(input: {
  prompt: string;
  imageUrls?: string[];
  videoUrls?: string[];
  audioUrls?: string[];
  duration?: unknown;
  resolution?: unknown;
  ratio?: unknown;
}): Record<string, unknown> {
  const imageUrls = input.imageUrls ?? [];
  const videoUrls = input.videoUrls ?? [];
  const audioUrls = input.audioUrls ?? [];
  if (imageUrls.length > 9) throw new Error(`MiniMax H3 最多支持 9 张参考图，当前 ${imageUrls.length} 张。`);
  if (videoUrls.length > 3) throw new Error(`MiniMax H3 最多支持 3 段参考视频，当前 ${videoUrls.length} 段。`);
  if (audioUrls.length > 3) throw new Error(`MiniMax H3 最多支持 3 段参考音频，当前 ${audioUrls.length} 段。`);

  const content: KuaiziH3ContentItem[] = [{ type: 'text', text: input.prompt }];
  for (const url of imageUrls) content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' });
  for (const url of videoUrls) content.push({ type: 'video_url', video_url: { url }, role: 'reference_video' });
  for (const url of audioUrls) content.push({ type: 'audio_url', audio_url: { url }, role: 'reference_audio' });

  // H3 时长 5-15 秒（与 UI/工具说明一致；虽然筷子文档允许 4s，统一按 5 起步避免渠道差异）
  const rawDuration = Math.round(Number(input.duration ?? 5));
  const duration = Number.isFinite(rawDuration) ? Math.min(15, Math.max(5, rawDuration)) : 5;
  const resolution = String(input.resolution || '2K').toUpperCase() === '768P' ? '768P' : '2K';
  const hasMedia = content.length > 1;
  const requestedRatio = String(input.ratio || 'adaptive');
  const ratioOptions = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
  // 文生视频 ratio 必填且不能 adaptive；图/多模态时由输入素材决定，adaptive 即可
  const ratio = ratioOptions.includes(requestedRatio)
    ? requestedRatio
    : hasMedia ? 'adaptive' : '16:9';

  return {
    model: 'MiniMax-H3',
    content,
    resolution,
    duration,
    ratio,
    aigc_watermark: false,
  };
}
