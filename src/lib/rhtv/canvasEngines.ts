/**
 * canvasEngines — curated engine → RunningHub endpoint mapping for the canvas.
 *
 * Default workflow: images = GPT-Image-2 + Midjourney (悠船 v8.1);
 * videos = Seedance 2.0 (multimodal preferred — reference images are
 * mandatory when available; text-to-video only when there are none).
 * Param schemas are copied from skills/rhtv/data/capabilities.json
 * (verified 2026-06).
 *
 * MJ hard rule (AGENT.md, learned the hard way): youchuan/text-to-image-v81
 * requires EVERY param present or it errors with 605 NOT_ENOUGH_BALANCE —
 * hence the exhaustive fixedParams/defaults below. It returns 4 result URLs;
 * the orchestrator downloads all of them.
 */
import type { RhtvCanvasEngine } from './types';

export const CANVAS_IMAGE_ENGINES: RhtvCanvasEngine[] = [
  {
    id: 'gpt-image-2',
    label: '全能图片 G-2.0 · 低价渠道版',
    endpoint: 'rhart-image-g-2/text-to-image',
    kind: 'image',
    mode: 'text-to-image',
    appConfig: {
      webappId: '2046794551444119554',
      nodes: [
        { nodeId: '18', fieldName: 'prompt', source: 'prompt' },
        { nodeId: '18', fieldName: 'aspectRatio', source: 'param', paramKey: 'aspectRatio' },
        { nodeId: '18', fieldName: 'resolution', source: 'param', paramKey: 'resolution' },
      ],
    },
    params: [
      {
        key: 'aspectRatio', label: '比例', type: 'list', default: '16:9',
        options: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'],
      },
      { key: 'resolution', label: '分辨率', type: 'list', default: '2k', options: ['1k', '2k', '4k'] },
    ],
  },
  {
    id: 'gpt-image-2-i2i',
    label: '全能图片 G-2.0 · 图生图 · 低价渠道版',
    endpoint: 'rhart-image-g-2/image-to-image',
    kind: 'image',
    mode: 'image-to-image',
    imageParam: { key: 'imageUrls', multiple: true },
    appConfig: {
      webappId: '2046794946094571522',
      nodes: [
        { nodeId: '2', fieldName: 'image', source: 'image' },
        { nodeId: '3', fieldName: 'image', source: 'image' },
        { nodeId: '4', fieldName: 'image', source: 'image' },
        { nodeId: '5', fieldName: 'image', source: 'image' },
        { nodeId: '1', fieldName: 'prompt', source: 'prompt' },
        { nodeId: '1', fieldName: 'aspectRatio', source: 'param', paramKey: 'aspectRatio' },
        { nodeId: '1', fieldName: 'resolution', source: 'param', paramKey: 'resolution' },
      ],
    },
    params: [
      {
        key: 'aspectRatio', label: '比例', type: 'list', default: '1:1',
        options: ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
      },
      { key: 'resolution', label: '分辨率', type: 'list', default: '4k', options: ['4k', '8k'] },
    ],
  },
  {
    id: 'gpt-image-2-official',
    label: '全能图片 G-2 · 文生图 · 官方稳定版',
    kind: 'image',
    endpoint: 'rhart-image-g-2-official/text-to-image',
    mode: 'text-to-image',
    appConfig: {
      webappId: '2047880499657445377',
      nodes: [
        { nodeId: '1', fieldName: 'prompt', source: 'prompt' },
        { nodeId: '1', fieldName: 'aspectRatio', source: 'param', paramKey: 'aspectRatio' },
        { nodeId: '1', fieldName: 'quality', source: 'param', paramKey: 'quality' },
        { nodeId: '1', fieldName: 'resolution', source: 'param', paramKey: 'resolution' },
      ],
    },
    params: [
      { key: 'aspectRatio', label: '比例', type: 'string', options: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'], default: '16:9' },
      { key: 'quality', label: '画质', type: 'string', options: ['low', 'medium', 'high'], default: 'medium' },
      { key: 'resolution', label: '分辨率', type: 'string', options: ['1k', '2k', '4k'], default: '2k' },
    ],
  },
  {
    id: 'gpt-image-2-official-i2i',
    label: '全能图片 G-2 · 图生图 · 官方稳定版',
    kind: 'image',
    endpoint: 'rhart-image-g-2-official/image-to-image',
    mode: 'image-to-image',
    imageParam: { key: 'imageUrls', multiple: true },
    appConfig: {
      webappId: '2047880068352970753',
      nodes: [
        { nodeId: '1', fieldName: 'image', source: 'image' },
        { nodeId: '2', fieldName: 'image', source: 'image' },
        { nodeId: '3', fieldName: 'image', source: 'image' },
        { nodeId: '6', fieldName: 'prompt', source: 'prompt' },
        { nodeId: '6', fieldName: 'aspectRatio', source: 'param', paramKey: 'aspectRatio' },
        { nodeId: '6', fieldName: 'quality', source: 'param', paramKey: 'quality' },
        { nodeId: '6', fieldName: 'resolution', source: 'param', paramKey: 'resolution' },
      ],
    },
    params: [
      { key: 'aspectRatio', label: '比例', type: 'string', options: ['empty', '1:1', '4:3', '3:4', '16:9', '9:16'], default: 'empty' },
      { key: 'quality', label: '画质', type: 'string', options: ['low', 'medium', 'high'], default: 'medium' },
      { key: 'resolution', label: '分辨率', type: 'string', options: ['1k', '2k', '4k'], default: '2k' },
    ],
  },
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
  {
    id: 'midjourney-v81',
    label: 'Midjourney 悠船 v8.1',
    endpoint: 'youchuan/text-to-image-v81',
    kind: 'image',
    mode: 'text-to-image',
    imageParam: { key: 'imageUrl', multiple: false },
    fixedParams: {
      chaos: 0,
      quality: '1',
      stylize: 300,
      raw: false,
      iw: 1,
      sw: 100,
      sv: 6,
      hd: false,
    },
    appConfig: {
      webappId: '2054797489890439169',
      nodes: [
        { nodeId: '2', fieldName: 'prompt', source: 'prompt' },
        { nodeId: '2', fieldName: 'aspectRatio', source: 'param', paramKey: 'aspectRatio' },
        { nodeId: '2', fieldName: 'quality', source: 'param', paramKey: 'quality' },
        { nodeId: '2', fieldName: 'chaos', source: 'param', paramKey: 'chaos' },
        { nodeId: '2', fieldName: 'hd', source: 'param', paramKey: 'hd' },
        { nodeId: '2', fieldName: 'raw', source: 'param', paramKey: 'raw' },
        { nodeId: '2', fieldName: 'stylize', source: 'param', paramKey: 'stylize' },
        { nodeId: '2', fieldName: 'iw', source: 'param', paramKey: 'iw' },
        { nodeId: '2', fieldName: 'sw', source: 'param', paramKey: 'sw' },
        { nodeId: '2', fieldName: 'sv', source: 'param', paramKey: 'sv' },
      ],
    },
    params: [
      {
        key: 'aspectRatio', label: '比例', type: 'list', default: '16:9',
        options: ['1:1', '4:3', '3:2', '16:9', '3:4', '2:3', '9:16'],
      },
    ],
  },
  {
    id: 'midjourney-v81-style-ref',
    label: 'Midjourney 悠船 v8.1 · 风格参考',
    endpoint: 'youchuan/text-to-image-v81',
    kind: 'image',
    mode: 'image-to-image',
    imageParam: { key: 'imageUrl', multiple: false },
    fixedParams: {
      chaos: 0,
      quality: '1',
      stylize: 300,
      raw: false,
      iw: 1,
      sw: 100,
      sv: 6,
      hd: false,
    },
    appConfig: {
      webappId: '2054790471045664769',
      nodes: [
        { nodeId: '2', fieldName: 'image', source: 'image' },
        { nodeId: '5', fieldName: 'prompt', source: 'prompt' },
        { nodeId: '5', fieldName: 'aspectRatio', source: 'param', paramKey: 'aspectRatio' },
        { nodeId: '5', fieldName: 'quality', source: 'param', paramKey: 'quality' },
        { nodeId: '5', fieldName: 'chaos', source: 'param', paramKey: 'chaos' },
        { nodeId: '5', fieldName: 'hd', source: 'param', paramKey: 'hd' },
        { nodeId: '5', fieldName: 'raw', source: 'param', paramKey: 'raw' },
        { nodeId: '5', fieldName: 'stylize', source: 'param', paramKey: 'stylize' },
        { nodeId: '5', fieldName: 'iw', source: 'param', paramKey: 'iw' },
        { nodeId: '5', fieldName: 'sw', source: 'param', paramKey: 'sw' },
        { nodeId: '5', fieldName: 'sv', source: 'param', paramKey: 'sv' },
      ],
    },
    params: [
      {
        key: 'aspectRatio', label: '比例', type: 'list', default: '16:9',
        options: ['1:1', '4:3', '3:2', '16:9', '3:4', '2:3', '9:16'],
      },
    ],
  },
  {
    id: 'midjourney-v81-image-style-ref',
    label: 'Midjourney 悠船 v8.1 · 垫图+风格',
    endpoint: 'youchuan/text-to-image-v81',
    kind: 'image',
    mode: 'image-to-image',
    imageParam: { key: 'imageUrls', multiple: true },
    fixedParams: {
      chaos: 0,
      quality: '1',
      stylize: 300,
      raw: false,
      iw: 1,
      sw: 100,
      sv: 6,
      hd: false,
    },
    appConfig: {
      webappId: '2054798617344528386',
      nodes: [
        { nodeId: '6', fieldName: 'image', source: 'image' },
        { nodeId: '4', fieldName: 'image', source: 'image' },
        { nodeId: '7', fieldName: 'prompt', source: 'prompt' },
        { nodeId: '7', fieldName: 'aspectRatio', source: 'param', paramKey: 'aspectRatio' },
        { nodeId: '7', fieldName: 'quality', source: 'param', paramKey: 'quality' },
        { nodeId: '7', fieldName: 'chaos', source: 'param', paramKey: 'chaos' },
        { nodeId: '7', fieldName: 'hd', source: 'param', paramKey: 'hd' },
        { nodeId: '7', fieldName: 'raw', source: 'param', paramKey: 'raw' },
        { nodeId: '7', fieldName: 'stylize', source: 'param', paramKey: 'stylize' },
        { nodeId: '7', fieldName: 'iw', source: 'param', paramKey: 'iw' },
        { nodeId: '7', fieldName: 'sw', source: 'param', paramKey: 'sw' },
        { nodeId: '7', fieldName: 'sv', source: 'param', paramKey: 'sv' },
      ],
    },
    params: [
      {
        key: 'aspectRatio', label: '比例', type: 'list', default: '16:9',
        options: ['1:1', '4:3', '3:2', '16:9', '3:4', '2:3', '9:16'],
      },
    ],
  },
];

// 图像工具：放大走 Topaz 专用端点（无 prompt）；扩图/重绘/擦除/抠图
// 用 gpt-image-2 图生图 + 指令模板（RunningHub 标准 API 无独立 mask 端点，
// 指令式编辑是官方路径，LibTV 同理）。
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
    id: 'video-upscaler',
    label: '视频高清',
    kind: 'video',
    endpoint: 'rhart-video/video-upscaler',
    mode: 'multimodal-video',
    videoParam: { key: 'videoUrl', multiple: false },
    fixedParams: { targetResolution: '1080p' },
    appConfig: {
      webappId: '2007768875705835521',
      nodes: [
        { nodeId: '6', fieldName: 'file', source: 'video' },
        { nodeId: '1', fieldName: 'target_fps', source: 'param', paramKey: 'targetFps' },
        { nodeId: '1', fieldName: 'target_resolution', source: 'param', paramKey: 'targetResolution' },
      ],
    },
    params: [
      { key: 'targetResolution', label: '分辨率', type: 'list', default: '1080p', options: ['720p', '1080p', '4k'] },
      { key: 'targetFps', label: '帧率', type: 'list', default: '30', options: ['30', '60'] },
    ],
  },
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

// ── 音频引擎（suno 写歌 / minimax TTS / minimax 纯音乐 / 人声分离）──────────
export const CANVAS_AUDIO_ENGINES: RhtvCanvasEngine[] = [
  {
    id: 'suno-v5',
    label: 'Suno 写歌',
    kind: 'audio',
    endpoint: 'rhart-audio/suno-v5/custom',
    mode: 'text-to-image',
    appConfig: {
      webappId: '1972980988039008258',
      nodes: [
        { nodeId: '1', fieldName: 'version', source: 'param', paramKey: 'version' },
        { nodeId: '4', fieldName: 'text', source: 'param', paramKey: 'title' },
        { nodeId: '8', fieldName: 'text', source: 'prompt' },
        { nodeId: '17', fieldName: 'select', source: 'param', paramKey: 'genre' },
      ],
    },
    params: [
      { key: 'version', label: '版本', type: 'list', default: 'v5', options: ['v3.0', 'v3.5', 'v4', 'v4.5', 'v4.5+', 'v5'] },
      { key: 'title', label: '歌名', type: 'string', default: '' },
      { key: 'genre', label: '风格', type: 'list', default: '1', options: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13'] },
    ],
  },
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
 * Pick the right image engine variant: GPT-Image-2 has separate t2i / i2i
 * endpoints; MJ takes an optional imageUrl on the same endpoint.
 */
export function resolveImageEngine(id: string, refCountOrHasReference: number | boolean): RhtvCanvasEngine {
  const refCount = typeof refCountOrHasReference === 'number'
    ? refCountOrHasReference
    : refCountOrHasReference ? 1 : 0;
  const hasReference = refCount > 0;
  if (id === 'gpt-image-2' || id === 'gpt-image-2-i2i') {
    const target = hasReference ? 'gpt-image-2-i2i' : 'gpt-image-2';
    return CANVAS_IMAGE_ENGINES.find((e) => e.id === target)!;
  }
  if (id === 'gpt-image-2-official' || id === 'gpt-image-2-official-i2i') {
    const target = hasReference ? 'gpt-image-2-official-i2i' : 'gpt-image-2-official';
    return CANVAS_IMAGE_ENGINES.find((e) => e.id === target)!;
  }
  if (id === 'seedream-v5-pro' || id === 'seedream-v5-pro-i2i' || id === 'seedream-v5-pro-rhtv' || id === 'seedream-v5-pro-rhtv-i2i') {
    const target = hasReference ? 'seedream-v5-pro-i2i' : 'seedream-v5-pro';
    return CANVAS_IMAGE_ENGINES.find((e) => e.id === target)!;
  }
  if (id === 'midjourney-v81' || id === 'midjourney-v81-style-ref' || id === 'midjourney-v81-image-style-ref') {
    const target = refCount >= 2
      ? 'midjourney-v81-image-style-ref'
      : refCount === 1
        ? 'midjourney-v81-style-ref'
        : 'midjourney-v81';
    return CANVAS_IMAGE_ENGINES.find((e) => e.id === target)!;
  }
  // Tool engines (topaz-upscale) and others resolve verbatim — never reroute.
  return findCanvasEngine(id) ?? CANVAS_IMAGE_ENGINES[0];
}
