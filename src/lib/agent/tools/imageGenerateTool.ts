import type { Tool } from '../types';
import { generateImage } from '@/lib/imageGen/client';
import { loadMediaInput } from '@/lib/agent/mediaInput';
import { useSettingsStore } from '@/stores/settingsStore';
import { runGeneration } from '@/lib/canvasGen';
import {
  applyMidjourneyStylePrompt,
  ensureMidjourneyStyleReference,
  getMidjourneyStyle,
  MIDJOURNEY_STYLE_PRESETS,
  resolveMidjourneyStyleParameters,
} from '@/lib/midjourney/styles';
import {
  normalizeMidjourneyVersion,
} from '@/lib/midjourney/prompt';

const IMAGE_MODELS = ['gpt-image-2', 'seedream-v5-pro', 'midjourney-v81', 'midjourney-v82'];
const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '4:5', '5:4', '21:9'];

export const imageGenerateTool: Tool = {
  definition: {
    name: 'image_generate',
    description:
      '普通对话直接生成图片并返回本地图片，不创建画布节点。使用底部当前选择的 GPT Image 2、豆包 5 Pro 或 Midjourney；用户指定模型时可覆盖。Midjourney 默认 V8.2，V8.1 优先 RunningHub 悠船并在失败后切换 APIMart，一次返回 4 张候选。'
      + 'APIMart 自动并行检测 api.apimart.ai、apib.ai、aiuxu.com、aishuch.com 并选择当前最快健康线路；遇到 TCP 超时时调用 apimart_route_status({refresh:true}) 查看真实状态，不要用 bash/curl 猜线路。'
      + '必须根据用户要求传 aspect_ratio；横图默认 16:9，竖图/小红书竖版通常 9:16，方图 1:1。不要只把比例写进 prompt，工具会把比例转换成供应商实际像素尺寸。'
      + '只有用户明确要求把结果放入画布时才改用 canvas_generate。',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '完整生图提示词' },
        model: {
          type: 'string',
          enum: IMAGE_MODELS,
          description: '可选；省略时使用普通对话底部当前选择的生图模型',
        },
        aspect_ratio: {
          type: 'string',
          enum: ASPECT_RATIOS,
          description: '目标画面比例。默认 16:9；用户明确指定时必须准确传入。GPT 不支持精确 21:9，21:9 应选择豆包 5 Pro',
          default: '16:9',
        },
        resolution: {
          type: 'string',
          enum: ['1k', '2k', '4k'],
          description: '输出分辨率，默认 2k。GPT 通道会换算为其支持的对应尺寸',
          default: '2k',
        },
        reference_urls: {
          type: 'array',
          items: { type: 'string' },
          description: '可选参考图，本地路径、asset:// 或 http(s) URL，最多 10 张',
        },
        midjourney_style_id: {
          type: 'string',
          enum: MIDJOURNEY_STYLE_PRESETS.map((item) => item.id),
          description: 'Midjourney 专属风格。选择后会应用经 API 验证的提示词、参数，必要时自动附带风格母图。',
        },
        creativity_mode: {
          type: 'string',
          enum: ['faithful', 'balanced', 'exploratory'],
          description: 'Midjourney 创造力档位。默认 balanced；只有用户要求更忠实或更意外时调整。',
        },
        stylize: { type: 'number', description: '可选 MJ 风格化 0-1000；省略时使用风格预设或生产默认 300。更真实降到 100-150，更艺术可提高但通常不超过 500。' },
        chaos: { type: 'number', description: '可选 MJ 混沌度 0-100；生产默认 0，只有用户要更多不同方向时调到 20-30。' },
        raw: { type: 'boolean', description: '可选 MJ RAW 模式。' },
        weird: { type: 'number', description: '可选 MJ 怪诞度 0-3000；默认 0，仅在用户明确要实验、怪诞或超现实时使用 100-300。' },
        style_weight: { type: 'number', description: '可选 MJ 风格参考权重 0-1000。通常由风格预设自动决定。' },
        image_weight: { type: 'number', description: '可选 MJ 主体参考图权重 0-3。主体必须保持时可提高，纯风格母图时由预设控制。' },
        output_path: { type: 'string', description: '可选的绝对输出路径' },
      },
      required: ['prompt'],
    },
  },
  risk: 'ask',
  concurrencyKey(params) {
    const outputPath = String(params.output_path || '').trim();
    const prompt = String(params.prompt || '').trim();
    return `chat-image:${outputPath || prompt.slice(0, 80)}`;
  },
  async execute(params) {
    const settings = useSettingsStore.getState();
    const requestedModel = String(params.model || settings.chatImageModel || 'gpt-image-2');
    const model = IMAGE_MODELS.includes(requestedModel) ? requestedModel : 'gpt-image-2';
    const requestedRatio = String(params.aspect_ratio || '16:9');
    const aspectRatio = ASPECT_RATIOS.includes(requestedRatio) ? requestedRatio : '16:9';
    const requestedResolution = String(params.resolution || '2k').toLowerCase();
    const resolution = requestedResolution === '1k' || requestedResolution === '4k' ? requestedResolution : '2k';
    const referenceUrls = Array.isArray(params.reference_urls)
      ? params.reference_urls.map(String).filter(Boolean).slice(0, 10)
      : [];

    if (model === 'gpt-image-2' && aspectRatio === '21:9') {
      return {
        success: false,
        output: '',
        error: 'GPT Image 2 当前通道没有原生 21:9 尺寸。为避免静默生成成 16:9，请切换普通对话生图模型为“豆包 5 Pro”后重试。',
      };
    }

    if (model.startsWith('midjourney-')) {
      const style = getMidjourneyStyle(String(params.midjourney_style_id || ''));
      const mode = (['faithful', 'balanced', 'exploratory'].includes(String(params.creativity_mode))
        ? String(params.creativity_mode)
        : style?.creativityMode ?? 'balanced') as 'faithful' | 'balanced' | 'exploratory';
      const version = normalizeMidjourneyVersion(style?.recommendedVersion ?? (model === 'midjourney-v82' ? 'v8.2' : 'v8.1'));
      const resolved = resolveMidjourneyStyleParameters(style, mode, {
        version,
        ...(Number.isFinite(Number(params.stylize)) ? { stylize: Number(params.stylize) } : {}),
        ...(Number.isFinite(Number(params.chaos)) ? { chaos: Number(params.chaos) } : {}),
        ...(typeof params.raw === 'boolean' ? { raw: params.raw } : {}),
        ...(Number.isFinite(Number(params.weird)) ? { weird: Number(params.weird) } : {}),
        ...(Number.isFinite(Number(params.style_weight)) ? { styleWeight: Number(params.style_weight) } : {}),
        ...(Number.isFinite(Number(params.image_weight)) ? { imageWeight: Number(params.image_weight) } : {}),
        aspectRatio,
      });
      const styleReference = await ensureMidjourneyStyleReference(style);
      const basePrompt = String(params.prompt || '').trim();
      const prompt = applyMidjourneyStylePrompt(basePrompt, style);
      const result = await runGeneration({
        engineId: `midjourney-${version.replace('.', '')}`,
        prompt,
        referenceUrls,
        styleReferenceUrls: styleReference ? [styleReference] : undefined,
        params: {
          version,
          aspectRatio,
          quality: '1',
          stylize: resolved.stylize,
          chaos: resolved.chaos,
          raw: resolved.raw,
          sw: resolved.styleWeight,
          iw: resolved.imageWeight,
          weird: resolved.weird,
        },
      });
      if (!result.success || result.resultPaths.length === 0) {
        return { success: false, output: '', error: result.error || 'Midjourney 图片生成失败' };
      }
      const media = await Promise.all(result.resultPaths.map(async (path) => {
        const native = await loadMediaInput(path);
        return {
          type: 'image' as const,
          source: native.dataUrl.startsWith('data:')
            ? { type: 'base64' as const, media_type: native.mediaType || 'image/png', data: native.dataUrl.slice(native.dataUrl.indexOf(',') + 1) }
            : { type: 'url' as const, url: native.dataUrl },
        };
      }));
      return {
        success: true,
        output: [
          `Midjourney 图片生成完成，共 ${result.resultPaths.length} 张候选。`,
          `画幅：${aspectRatio}`,
          `版本：${version.toUpperCase()}`,
          ...(style ? [`风格：${style.name}`] : []),
          `通道：${result.fallbackUsed ? 'APIMart 容灾' : 'RunningHub 悠船'}`,
          ...result.resultPaths.map((path, index) => `候选 ${index + 1}：${path}`),
        ].join('\n'),
        media,
      };
    }

    const result = await generateImage({
      prompt: String(params.prompt || ''),
      model,
      size: 'auto',
      aspectRatio,
      resolution,
      referenceImageUrls: referenceUrls,
      outputPath: params.output_path ? String(params.output_path) : undefined,
    });
    if (!result.success || !result.imagePath) {
      return { success: false, output: '', error: result.error || '图片生成失败' };
    }

    const native = await loadMediaInput(result.imagePath);
    return {
      success: true,
      output: [
        '图片生成完成。',
        `模型：${result.modelUsed || model}`,
        `画幅：${aspectRatio}`,
        `通道：${result.apiUsed}`,
        `文件：${result.imagePath}`,
      ].join('\n'),
      media: [{
        type: 'image',
        source: native.dataUrl.startsWith('data:')
          ? { type: 'base64', media_type: native.mediaType || 'image/png', data: native.dataUrl.slice(native.dataUrl.indexOf(',') + 1) }
          : { type: 'url', url: native.dataUrl },
      }],
    };
  },
};
