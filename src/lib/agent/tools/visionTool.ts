/**
 * image_recognition — 图片识别 / 视觉理解（DMXAPI 内置 API 模式）。
 *
 * 容灾顺序：原生 Kimi K3（已配置时）→ DMXAPI kimi-k3 → 豆包 lite
 *           → gpt-4o-mini → mimo-v2-omni → DeepSeek-OCR → qwen3-omni-flash-all
 * （Gemini 已按成本要求移除）
 * 降级纪律：原生 Kimi 的配置/鉴权错误（400/401/403/404）直接报错、不降级，
 * 避免静默烧 DMX 备用额度；只有瞬时故障（429/5xx/网络）才降级，且结果中
 * 会标注「已降级」及原因。
 *
 * image 参数接受公网 URL、data URI 或本地路径（本地自动转 base64）。
 */

import { fetch as nativeFetch, ResponseType } from '@tauri-apps/api/http';
import type { Tool } from '../types';
import { visionWithFallback, loadImageInput } from './dmxClient';

const DEFAULT_PROMPT = '详细描述这张图片的内容';

export const visionTool: Tool = {
  definition: {
    name: 'image_recognition',
    description:
      '识别/理解图片内容，回答关于图片的问题。' +
      '用于：描述画面、提取图中文字、以图问答、分析参考图。' +
      'image 支持公网 URL 或本地文件路径。',
    parameters: {
      type: 'object',
      properties: {
        image: { type: 'string', description: '图片的公网 URL 或本地文件路径' },
        prompt: { type: 'string', description: `针对图片的问题/指令，默认"${DEFAULT_PROMPT}"` },
      },
      required: ['image'],
    },
  },
  risk: 'safe',
  async execute(params, _signal, context) {
    const { image, prompt } = params as { image?: string; prompt?: string };
    if (!image || !image.trim()) {
      return { success: false, output: '', error: 'image required' };
    }
    const question = (prompt && prompt.trim()) || DEFAULT_PROMPT;

    try {
      let input = await loadImageInput(image);
      if (context?.nativeVision && /^https?:\/\//i.test(input)) {
        const response = await nativeFetch<number[]>(input, { method: 'GET', responseType: ResponseType.Binary, timeout: 30 });
        if (!response.ok) throw new Error(`图片下载失败 (${response.status})`);
        const bytes = response.data;
        if (bytes.length > 4 * 1024 * 1024) throw new Error('图片超过 4MB，请先缩小图片后查看。');
        let binary = '';
        for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.slice(index, index + 8192));
        const mime = response.headers['content-type']?.split(';')[0] || 'image/jpeg';
        if (!mime.startsWith('image/')) throw new Error('地址未返回图片内容');
        input = `data:${mime};base64,${btoa(binary)}`;
      }
      if (context?.nativeVision) {
        const source = input.startsWith('data:')
          ? { type: 'base64' as const, media_type: input.slice(5, input.indexOf(';')), data: input.slice(input.indexOf(',') + 1) }
          : { type: 'url' as const, url: input };
        return {
          success: true,
          output: `图片已加载，请使用当前模型的原生视觉回答：${question}`,
          media: [{ type: 'image' as const, source }],
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: `读取图片失败: ${msg}` };
    }

    try {
      const result = await visionWithFallback(image, question);
      return {
        success: true,
        output: `${result.text}\n\n（识图模型：${result.model}）`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: msg };
    }
  },
};
