/**
 * 筷子 万相 3.0（wan3.0-video）DashScope 兼容端点的请求体构造（纯函数，便于单测）。
 * input.prompt 与 input.media 至少其一；素材统一走 reference_* / file / link。
 */

export type KuaiziWan3MediaType =
  | 'reference_image'
  | 'reference_video'
  | 'reference_audio'
  | 'file'
  | 'link';

/** 构造 DashScope 兼容请求体；素材统一走 reference_* / file / link（不用首尾帧，避免互斥）。 */
export function buildKuaiziWan3Payload(input: {
  prompt: string;
  imageUrls?: string[];
  videoUrls?: string[];
  audioUrls?: string[];
  documentUrl?: string;
  linkUrl?: string;
  duration?: unknown;
  resolution?: unknown;
  ratio?: unknown;
  audio?: unknown;
  seed?: unknown;
}): Record<string, unknown> {
  const imageUrls = input.imageUrls ?? [];
  const videoUrls = input.videoUrls ?? [];
  const audioUrls = input.audioUrls ?? [];
  if (imageUrls.length > 10) throw new Error(`万相 3.0 最多支持 10 张参考图，当前 ${imageUrls.length} 张。`);
  if (videoUrls.length > 5) throw new Error(`万相 3.0 最多支持 5 段参考视频，当前 ${videoUrls.length} 段。`);
  if (audioUrls.length > 5) throw new Error(`万相 3.0 最多支持 5 段参考音频，当前 ${audioUrls.length} 段。`);
  if (input.documentUrl && input.linkUrl) throw new Error('万相 3.0 的文档（file）与网页链接（link）互斥，只能传一个。');

  const media: { type: KuaiziWan3MediaType; url: string }[] = [
    ...imageUrls.map((url) => ({ type: 'reference_image' as const, url })),
    ...videoUrls.map((url) => ({ type: 'reference_video' as const, url })),
    ...audioUrls.map((url) => ({ type: 'reference_audio' as const, url })),
  ];
  if (input.documentUrl) media.push({ type: 'file', url: input.documentUrl });
  if (input.linkUrl) media.push({ type: 'link', url: input.linkUrl });
  if (!input.prompt.trim() && media.length === 0) {
    throw new Error('万相 3.0 要求 prompt 与素材至少提供其一。');
  }

  const rawDuration = Math.round(Number(input.duration ?? 5));
  const duration = rawDuration === -1 ? -1 : Number.isFinite(rawDuration) ? Math.min(30, Math.max(2, rawDuration)) : 5;
  const resolutionRaw = String(input.resolution || '1080P').toUpperCase();
  const resolution = (['480P', '720P', '1080P'].includes(resolutionRaw) ? resolutionRaw : '1080P') as '480P' | '720P' | '1080P';
  const ratioRaw = String(input.ratio || 'adaptive');
  const ratio = ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16'].includes(ratioRaw) ? ratioRaw : 'adaptive';

  const inputField: Record<string, unknown> = {};
  if (input.prompt.trim()) inputField.prompt = input.prompt;
  if (media.length > 0) inputField.media = media;

  const parameters: Record<string, unknown> = {
    resolution,
    ratio,
    duration,
    audio: typeof input.audio === 'boolean' ? input.audio : true,
    watermark: false,
  };
  const seed = Number(input.seed);
  if (Number.isFinite(seed) && seed > 0) parameters.seed = Math.trunc(seed);

  return { model: 'wan3.0-video', input: inputField, parameters };
}
