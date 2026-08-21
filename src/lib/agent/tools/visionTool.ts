/**
 * image_recognition — 图片识别 / 视觉理解（DMXAPI 内置 API 模式）。
 *
 * 6 层容灾：doubao → gemini-2.5-flash → gpt-4o-mini → mimo-v2-omni
 *           → DeepSeek-OCR → qwen3-omni-flash-all
 *
 * image 参数接受公网 URL、data URI 或本地路径（本地自动转 base64）。
 */

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
  async execute(params) {
    const { image, prompt } = params as { image?: string; prompt?: string };
    if (!image || !image.trim()) {
      return { success: false, output: '', error: 'image required' };
    }
    const question = (prompt && prompt.trim()) || DEFAULT_PROMPT;

    try {
      await loadImageInput(image);
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
