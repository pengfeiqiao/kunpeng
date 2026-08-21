import type { Tool } from '../types';
import { runGeneration } from '@/lib/canvasGen';
import { useSettingsStore } from '@/stores/settingsStore';
import { DREAMINA_SEEDANCE_25_ENGINE_ID } from '@/lib/dreamina/video';

type ChatVideoEngine =
  | 'minimax-h3'
  | 'seedance-2.0'
  | 'seedance-2.0-fast'
  | 'seedance-2.0-mini'
  | 'seedance-2.5'
  | 'omni-mg-animation';

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function normalizeEngine(
  requested: string,
  hasReferences: boolean,
): { engineId?: string; label?: string; error?: string } {
  switch (requested) {
    case 'minimax-h3':
    case 'minimax-hailuo-h3':
      return { engineId: 'minimax-hailuo-h3', label: 'MiniMax H3' };
    case 'seedance-2.0':
      return {
        engineId: hasReferences ? 'seedance-2.0' : 'seedance-2.0-t2v',
        label: 'Seedance 2.0',
      };
    case 'seedance-2.0-mini':
      return {
        engineId: hasReferences ? 'seedance-2.0-mini-i2v' : 'seedance-2.0-mini-t2v',
        label: 'Seedance 2.0 Mini',
      };
    case 'seedance-2.0-fast':
      if (!hasReferences) {
        return { error: 'Seedance 2.0 Fast 是多模态视频模型，需要至少一张参考图。纯文生视频请改用 MiniMax H3 或 Seedance 2.0。' };
      }
      return { engineId: 'seedance-2.0-fast', label: 'Seedance 2.0 Fast' };
    case 'seedance-2.5':
    case DREAMINA_SEEDANCE_25_ENGINE_ID:
      return { engineId: DREAMINA_SEEDANCE_25_ENGINE_ID, label: '即梦 Seedance 2.5' };
    case 'omni-mg-animation':
      return { error: 'Omni MG 需要母版和关键帧工作流，请改用 mg_generate_with_reference_boards；普通视频不需要进入画布。' };
    default:
      return { error: `不支持的普通对话视频模型：${requested}` };
  }
}

export const videoGenerateTool: Tool = {
  definition: {
    name: 'video_generate',
    description:
      '普通对话直接生成视频并返回本地文件，不创建画布节点，也不切换视图。'
      + '支持 MiniMax H3、Seedance 2.0、Seedance 2.0 Fast、Seedance 2.0 Mini 和即梦 Seedance 2.5。'
      + 'APIMart 通道自动并行检测 api.apimart.ai、apib.ai、aiuxu.com、aishuch.com 并选择当前最快健康线路；遇到 TCP 超时时先调用 apimart_route_status({refresh:true})，不要用 bash/curl 猜线路。'
      + '用户指定 MiniMax/H3/海螺 H3 时直接使用 minimax-h3；没有指定模型时使用普通对话工具栏当前选择。'
      + '只有用户明确要求把结果放入画布时，才改用 canvas_generate。多个普通对话视频可以在同一轮发出多个 video_generate 调用。',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '视频提示词。只能引用本次实际传入的素材，图片/视频/音频编号按数组顺序排列' },
        engine: {
          type: 'string',
          enum: ['minimax-h3', 'seedance-2.0', 'seedance-2.0-fast', 'seedance-2.0-mini', 'seedance-2.5'],
          description: '可选。省略时沿用普通对话底部选择的生视频模型',
        },
        image_urls: { type: 'array', items: { type: 'string' }, description: '参考图片路径或 URL；MiniMax H3 最多 9 张' },
        video_urls: { type: 'array', items: { type: 'string' }, description: '参考视频路径或 URL；MiniMax H3 最多 3 个' },
        audio_urls: { type: 'array', items: { type: 'string' }, description: '参考音频路径或 URL；MiniMax H3 最多 3 个' },
        duration: { type: 'number', description: '时长。MiniMax H3 为 5-15 秒；Seedance 通常为 4-15 秒' },
        ratio: {
          type: 'string',
          enum: ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
          description: '画幅，默认 adaptive',
        },
        resolution: { type: 'string', description: '输出分辨率；MiniMax H3 固定 2K' },
        generate_audio: { type: 'boolean', description: 'Seedance 是否生成音频，默认 true' },
      },
      required: ['prompt'],
    },
  },
  risk: 'ask',
  async execute(params) {
    const prompt = String(params.prompt ?? '').trim();
    if (!prompt) return { success: false, output: '', error: '视频提示词不能为空' };

    const imageUrls = stringList(params.image_urls);
    const videoUrls = stringList(params.video_urls);
    const audioUrls = stringList(params.audio_urls);
    const hasReferences = imageUrls.length + videoUrls.length + audioUrls.length > 0;
    const selected = String(
      params.engine
      ?? useSettingsStore.getState().chatVideoModel
      ?? 'seedance-2.0',
    ) as ChatVideoEngine;
    const normalized = normalizeEngine(selected, hasReferences);
    if (!normalized.engineId) {
      return { success: false, output: '', error: normalized.error || '无法确定视频模型' };
    }

    if (normalized.engineId === 'minimax-hailuo-h3') {
      if (imageUrls.length > 9) return { success: false, output: '', error: `MiniMax H3 最多 9 张参考图，当前 ${imageUrls.length} 张` };
      if (videoUrls.length > 3) return { success: false, output: '', error: `MiniMax H3 最多 3 个参考视频，当前 ${videoUrls.length} 个` };
      if (audioUrls.length > 3) return { success: false, output: '', error: `MiniMax H3 最多 3 个参考音频，当前 ${audioUrls.length} 个` };
    }

    const rawDuration = Number(params.duration ?? 5);
    const duration = normalized.engineId === 'minimax-hailuo-h3'
      ? Math.min(15, Math.max(5, Math.round(rawDuration || 5)))
      : Math.min(30, Math.max(4, Math.round(rawDuration || 5)));
    const ratio = String(params.ratio ?? 'adaptive');
    const generationParams: Record<string, string | number | boolean> = normalized.engineId === 'minimax-hailuo-h3'
      ? { resolution: '2K', duration: String(duration), ratio }
      : {
          resolution: String(params.resolution ?? '720p'),
          duration: String(duration),
          ratio,
          generateAudio: params.generate_audio !== false,
        };

    const result = await runGeneration({
      engineId: normalized.engineId,
      prompt,
      referenceUrls: imageUrls,
      videoUrls,
      audioUrls,
      params: generationParams,
    });
    if (!result.success) {
      const error = result.error || `${normalized.label} 视频生成失败`;
      return {
        success: false,
        output: '',
        error,
        ...(result.automaticRetryBlocked
          ? { terminal: true, terminalMessage: error }
          : {}),
      };
    }

    const paths = result.resultPaths;
    return {
      success: true,
      terminal: true,
      terminalMessage: `${normalized.label} 视频已生成。\n${paths.map((path) => `![生成视频](${path})`).join('\n')}`,
      output: [
        `${normalized.label} 视频生成完成。`,
        ...paths.map((path, index) => `${paths.length > 1 ? `视频 ${index + 1}` : '视频'}：${path}`),
        '结果已保存到本地并进入产物栏；本次没有创建或修改画布节点。',
      ].join('\n'),
    };
  },
};
