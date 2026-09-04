/**
 * canvasEngines — curated engine → RunningHub endpoint mapping for the canvas.
 *
 * This table contains only the currently supported RunningHub standard-model
 * endpoints. Other image engines are maintained by their own provider routers.
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

// 图像工具：放大走 Topaz 专用端点（无 prompt，2026-08 实测仍可用，保留）；
// 扩图/重绘/擦除/抠图用 gpt-image-2 图生图 + 指令模板（走生图 API 槽位）。
export const IMAGE_TOOL_ENGINE: RhtvCanvasEngine = {
  id: 'topaz-upscale',
  label: 'Topaz 放大',
  endpoint: 'topazlabs/image-upscale-standard-v2',
  kind: 'image',
  mode: 'image-to-image',
  imageParam: { key: 'imageUrl', multiple: false },
  fixedParams: { subjectDetection: 'All', faceEnhancement: true },
  appConfig: {
    webappId: '2007765513115537410',
    nodes: [
      { nodeId: '1', fieldName: 'image', source: 'image' },
      { nodeId: '2', fieldName: 'model', source: 'param', paramKey: 'model' },
      { nodeId: '2', fieldName: 'scale', source: 'param', paramKey: 'scale' },
      { nodeId: '2', fieldName: 'subject_detection', source: 'param', paramKey: 'subjectDetection' },
    ],
  },
  params: [
    { key: 'scale', label: '倍率', type: 'list', default: '2', options: ['2', '4', '6'] },
    { key: 'model', label: '模型', type: 'list', default: 'Standard V2', options: ['Standard V2', 'Low Resolution V2', 'CGI', 'High Fidelity V2', 'Text Refine'] },
    { key: 'subjectDetection', label: '主体检测', type: 'list', default: 'All', options: ['None', 'All', 'Foreground', 'Background'] },
  ],
};

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
    // 万相 3.0（wan3.0-video）：阿里全能参考视频。渠道由 runWan3Generation
    // 编排：筷子丽帧（主）→ RunningHub（本 endpoint）→ APIMart。
    // 支持图(≤10)/视频(≤5)/音频(≤5)/文档/网页链接参考；文档与链接互斥。
    id: 'wan-3.0',
    label: '万相 3.0',
    endpoint: 'alibaba/wan-3.0/reference-to-video',
    kind: 'video',
    mode: 'multimodal-video',
    imageParam: { key: 'imageUrls', multiple: true },
    audioParam: { key: 'audioUrls', multiple: true },
    videoParam: { key: 'videoUrls', multiple: true },
    params: [
      {
        key: 'resolution', label: '分辨率', type: 'list', default: '720P',
        options: ['480P', '720P', '1080P'],
      },
      {
        key: 'duration', label: '时长', type: 'list', default: '5',
        options: ['-1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '12', '15', '20', '25', '30'],
      },
      {
        key: 'ratio', label: '比例', type: 'list', default: 'adaptive',
        options: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16'],
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
  {
    // 标准模型通道（2026-09 实测：360p→1080p 约 5.5 分钟 ¥3.15/15s）。
    // 旧 appConfig 版本随海外节点退役，国内站标准端点仍在线。
    id: 'video-upscaler',
    label: '提升分辨率',
    kind: 'video',
    endpoint: 'rhart-video/video-upscaler',
    mode: 'multimodal-video',
    videoParam: { key: 'videoUrl', multiple: false },
    fixedParams: { targetResolution: '720p' },
    params: [
      { key: 'targetResolution', label: '分辨率', type: 'list', default: '720p', options: ['720p', '1080p', '2K', '4K'] },
    ],
  },
  {
    // AI 应用通道（2026-09 实测：360p→1080p 约 75 秒 ¥10.5/15s，快但贵），
    // 作为标准模型失败时的容灾。超分+插帧一体（targetFps）。
    id: 'video-upscaler-app',
    label: '提升分辨率（快速通道）',
    kind: 'video',
    endpoint: 'rhart-video/video-upscaler',
    mode: 'multimodal-video',
    videoParam: { key: 'videoUrl', multiple: false },
    appConfig: {
      webappId: '2061298406567538690',
      nodes: [
        { nodeId: '6', fieldName: 'file', source: 'video' },
        { nodeId: '15', fieldName: 'targetResolution', source: 'param', paramKey: 'targetResolution' },
        { nodeId: '15', fieldName: 'targetFps', source: 'param', paramKey: 'targetFps' },
      ],
    },
    params: [
      { key: 'targetResolution', label: '分辨率', type: 'list', default: '720p', options: ['720p', '1080p', '4k'] },
      { key: 'targetFps', label: '帧率', type: 'list', default: '30', options: ['30', '60'] },
    ],
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
  ...CANVAS_IMAGE_ENGINES, IMAGE_TOOL_ENGINE,
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
  // Retired overseas ids (gpt-image-2*, midjourney-v81*) fall through to the
  // default rather than crashing on a removed entry. Topaz upscale is back in
  // the table (2026-08 verified working) and resolves via findCanvasEngine.
  return findCanvasEngine(id) ?? CANVAS_IMAGE_ENGINES[0];
}
