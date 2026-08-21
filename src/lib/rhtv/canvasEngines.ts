/**
 * canvasEngines — curated engine → RunningHub endpoint mapping for the canvas.
 *
 * 2026-08: RunningHub 海外节点 API（appConfig/AI 应用通道，含 GPT-Image-2、
 * Midjourney 悠船、Topaz、Suno、video-upscaler）已全部下线不可用，本表只
 * 保留国内节点引擎（标准模型端点）。GPT-Image-2 与 Midjourney 逻辑模型仍
 * 可通过生图 API 槽位（DMX/AiHubMix/ZexAPI）与 APIMart 使用。
 *
 * Default workflow: images = Seedream 5.0 Pro + API 槽位;
 * videos = Seedance 2.0 (multimodal preferred — reference images are
 * mandatory when available; text-to-video only when there are none).
 * Param schemas are copied from skills/rhtv/data/capabilities.json
 * (verified 2026-06).
 */
import type { RhtvCanvasEngine } from './types';

export const CANVAS_IMAGE_ENGINES: RhtvCanvasEngine[] = [
  {
    id: 'seedream-v5-pro',
    label: 'Seedream 5.0 Pro · 文生图',
    endpoint: 'seedream-v5-pro/text-to-image',
    kind: 'image',
    mode: 'text-to-image',
    fixedParams: { outputFormat: 'jpeg' },
    params: [
      {
        key: 'aspectRatio', label: '比例', type: 'list', default: '16:9',
        options: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'],
      },
      { key: 'resolution', label: '分辨率', type: 'list', default: '2k', options: ['1k', '2k'] },
      { key: 'outputFormat', label: '格式', type: 'list', default: 'jpeg', options: ['jpeg', 'png'] },
    ],
  },
  {
    id: 'seedream-v5-pro-i2i',
    label: 'Seedream 5.0 Pro · 图生图',
    endpoint: 'seedream-v5-pro/image-to-image',
    kind: 'image',
    mode: 'image-to-image',
    imageParam: { key: 'imageUrls', multiple: true },
    fixedParams: { outputFormat: 'jpeg' },
    params: [
      {
        key: 'aspectRatio', label: '比例', type: 'list', default: '16:9',
        options: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'],
      },
      { key: 'resolution', label: '分辨率', type: 'list', default: '2k', options: ['1k', '2k'] },
      { key: 'outputFormat', label: '格式', type: 'list', default: 'jpeg', options: ['jpeg', 'png'] },
    ],
  },
];

export const CANVAS_VIDEO_ENGINES: RhtvCanvasEngine[] = [
  {
    id: 'seedance-2.0',
    label: 'Seedance 2.0 多模态',
    endpoint: 'bytedance/seedance-2.0-global/multimodal-video',
    kind: 'video',
    mode: 'multimodal-video',
    imageParam: { key: 'imageUrls', multiple: true },
    audioParam: { key: 'audioUrls', multiple: true },
    videoParam: { key: 'videoUrls', multiple: true },
    fixedParams: {
      generateAudio: true,
      returnLastFrame: false,
      realPersonMode: true, // AGENT.md: 有真人/角色必须开；无人物时无副作用
    },
    params: [
      {
        key: 'resolution', label: '分辨率', type: 'list', default: '720p',
        options: ['480p', '720p', 'native1080p', '1080p', '2k', '4k'],
      },
      {
        key: 'duration', label: '时长', type: 'list', default: '5',
        options: ['4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'],
      },
      {
        key: 'ratio', label: '比例', type: 'list', default: 'adaptive',
        options: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
      },
    ],
  },
  {
    // MiniMax H3（hailuo-h3）：单端点多模态视频，t2v/i2v 同端点，
    // prompt 必填、图(≤9)/视频(≤3)/音频(≤3) 参考均可选；分辨率只有 2K。
    id: 'minimax-hailuo-h3',
    label: 'MiniMax H3',
    endpoint: 'minimax/hailuo-h3/multimodal-to-video',
    kind: 'video',
    mode: 'multimodal-video',
    imageParam: { key: 'imageUrls', multiple: true },
    audioParam: { key: 'audioUrls', multiple: true },
    videoParam: { key: 'videoUrls', multiple: true },
    params: [
      { key: 'resolution', label: '分辨率', type: 'list', default: '2K', options: ['2K'] },
      {
        key: 'duration', label: '时长', type: 'list', default: '5',
        options: ['5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'],
      },
      {
        key: 'ratio', label: '比例', type: 'list', default: 'adaptive',
        options: ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
      },
    ],
  },
  {
    id: 'seedance-2.0-t2v',
    label: 'Seedance 2.0 文生视频',
    endpoint: 'bytedance/seedance-2.0-global/text-to-video',
    kind: 'video',
    mode: 'text-to-video',
    fixedParams: { generateAudio: true, returnLastFrame: false },
    params: [
      {
        key: 'resolution', label: '分辨率', type: 'list', default: '720p',
        options: ['480p', '720p', '1080p', '2k', '4k'],
      },
      {
        key: 'duration', label: '时长', type: 'list', default: '5',
        options: ['4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'],
      },
      {
        key: 'ratio', label: '比例', type: 'list', default: '16:9',
        options: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
      },
    ],
  },
  {
    id: 'seedance-2.0-fast',
    label: 'Seedance 2.0 Fast',
    endpoint: 'bytedance/seedance-2.0-global-fast/multimodal-video',
    kind: 'video',
    mode: 'multimodal-video',
    imageParam: { key: 'imageUrls', multiple: true },
    fixedParams: { generateAudio: true, returnLastFrame: false, realPersonMode: true },
    params: [
      {
        key: 'resolution', label: '分辨率', type: 'list', default: '720p',
        options: ['480p', '720p'],
      },
      {
        key: 'duration', label: '时长', type: 'list', default: '5',
        options: ['4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'],
      },
      {
        key: 'ratio', label: '比例', type: 'list', default: 'adaptive',
        options: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
      },
    ],
  },
  {
    id: 'startend-v3.1-pro',
    label: 'Seedance 2.0 首尾帧',
    // sparkvideo-2.0 = Seedance 2.0 渠道版；image-to-video 即图生视频，
    // firstFrameUrl 必填 + lastFrameUrl 可选 = 原生首尾帧能力。
    // （id 保留 startend-v3.1-pro 兼容历史任务记录的重试。）
    endpoint: 'rhart-video/sparkvideo-2.0/image-to-video',
    kind: 'video',
    mode: 'start-end-video',
    // firstFrameUrl/lastFrameUrl are filled from referenceUrls[0]/[1] by the
    // orchestrator (special-cased: two distinct single-image params).
    fixedParams: { generateAudio: true, returnLastFrame: false },
    params: [
      {
        key: 'resolution', label: '分辨率', type: 'list', default: '720p',
        options: ['480p', '720p', '1080p', '2k', '4k'],
      },
      {
        key: 'duration', label: '时长', type: 'list', default: '5',
        options: ['4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'],
      },
      {
        key: 'ratio', label: '比例', type: 'list', default: 'adaptive',
        options: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
      },
    ],
  },
  // ── Seedance 2.0 Mini（sparkvideo-2.0-mini 渠道，0.3毛/秒）───────────────
  {
    id: 'seedance-2.0-mini-t2v',
    label: 'Seedance 2.0 Mini 文生视频',
    endpoint: 'rhart-video/sparkvideo-2.0-mini/text-to-video',
    kind: 'video',
    mode: 'text-to-video',
    fixedParams: { generateAudio: true, returnLastFrame: false },
    params: [
      {
        key: 'resolution', label: '分辨率', type: 'list', default: '720p',
        options: ['480p', '720p', '1080p', '2k', '4k'],
      },
      {
        key: 'duration', label: '时长', type: 'list', default: '5',
        options: ['-1', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'],
      },
      {
        key: 'ratio', label: '比例', type: 'list', default: 'adaptive',
        options: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
      },
    ],
  },
  {
    id: 'seedance-2.0-mini-i2v',
    label: 'Seedance 2.0 Mini 图生视频',
    endpoint: 'rhart-video/sparkvideo-2.0-mini/image-to-video',
    kind: 'video',
    mode: 'start-end-video',
    fixedParams: { generateAudio: true, returnLastFrame: false },
    params: [
      {
        key: 'resolution', label: '分辨率', type: 'list', default: '720p',
        options: ['480p', '720p', '1080p', '2k', '4k'],
      },
      {
        key: 'duration', label: '时长', type: 'list', default: '5',
        options: ['-1', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'],
      },
      {
        key: 'ratio', label: '比例', type: 'list', default: 'adaptive',
        options: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
      },
    ],
  },
];

// ── 视频工具引擎（用户指定端点，2026-06-11）─────────────────────────────────
export const VIDEO_TOOL_ENGINES: RhtvCanvasEngine[] = [
  {
    id: 'video-fps-increaser',
    label: '帧率增强',
    kind: 'video',
    endpoint: 'rhart-video/video-fps-increaser',
    mode: 'multimodal-video',
    videoParam: { key: 'videoUrl', multiple: false },
    params: [],
  },
];

// ── 音频引擎（minimax TTS / minimax 纯音乐 / 人声分离）─────────────────────
export const CANVAS_AUDIO_ENGINES: RhtvCanvasEngine[] = [
  {
    id: 'minimax-speech',
    label: '配音 TTS',
    kind: 'audio',
    endpoint: 'rhart-audio/text-to-audio/speech-2.8-hd',
    mode: 'text-to-image',
    params: [],
  },
  {
    id: 'minimax-music',
    label: '纯音乐',
    kind: 'audio',
    endpoint: 'rhart-audio/text-to-audio/music-2.5',
    mode: 'text-to-image',
    params: [],
  },
  {
    id: 'extract-vocal',
    label: '人声分离',
    kind: 'audio',
    endpoint: 'rhart-audio/extract-vocal',
    mode: 'multimodal-video',
    videoParam: { key: 'audioUrl', multiple: false },
    params: [],
  },
];

export const ALL_CANVAS_ENGINES = [
  ...CANVAS_IMAGE_ENGINES,
  ...CANVAS_VIDEO_ENGINES, ...VIDEO_TOOL_ENGINES, ...CANVAS_AUDIO_ENGINES,
];

export function findCanvasEngine(id: string): RhtvCanvasEngine | undefined {
  return ALL_CANVAS_ENGINES.find((e) => e.id === id);
}

/**
 * Pick the right image engine variant. Since the RunningHub overseas nodes
 * were retired (2026-08), only the Seedream pair has t2i/i2i variants left;
 * everything else resolves verbatim with a Seedream default.
 */
export function resolveImageEngine(id: string, refCountOrHasReference: number | boolean): RhtvCanvasEngine {
  const refCount = typeof refCountOrHasReference === 'number'
    ? refCountOrHasReference
    : refCountOrHasReference ? 1 : 0;
  const hasReference = refCount > 0;
  if (id === 'seedream-v5-pro' || id === 'seedream-v5-pro-i2i' || id === 'seedream-v5-pro-rhtv' || id === 'seedream-v5-pro-rhtv-i2i') {
    const target = hasReference ? 'seedream-v5-pro-i2i' : 'seedream-v5-pro';
    return CANVAS_IMAGE_ENGINES.find((e) => e.id === target)!;
  }
  // Retired overseas ids (gpt-image-2*, midjourney-v81*, topaz-upscale) fall
  // through to the default rather than crashing on a removed entry.
  return findCanvasEngine(id) ?? CANVAS_IMAGE_ENGINES[0];
}
