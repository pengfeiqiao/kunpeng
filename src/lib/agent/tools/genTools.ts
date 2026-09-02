import type { Tool, ToolResult } from '../types';
import { buildDirectorContext } from '../directorInjector';
import { getEngineFormula } from '../../aigc/promptTemplate';
import { appendGenerationLog } from '../../aigc/genLogger';

export const aigcOptimizePromptTool: Tool = {
  definition: {
    name: 'aigc_optimize_prompt',
    description: '根据当前导演风格和引擎公式优化生成提示词。'
      + '在调用 image_generate / image_client / runninghub / dreamina / canvas_generate 前先调用此工具。',
    parameters: {
      type: 'object',
      properties: {
        basePrompt: {
          type: 'string',
          description: '原始用户提示词',
        },
        taskType: {
          type: 'string',
          enum: ['text-to-image', 'image-to-video', 'text-to-video'],
          description: '生成任务类型',
        },
        engine: {
          type: 'string',
          enum: ['gpt-image-2', 'seedream-v5-pro', 'seedance', 'kling', 'midjourney'],
          description: '目标生成引擎',
        },
        director: {
          type: 'string',
          description: '导演/电影风格（可选，不传则用活跃导演）',
        },
      },
      required: ['basePrompt', 'taskType', 'engine'],
    },
  },
  risk: 'safe',

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    try {
      const basePrompt = params.basePrompt as string;
      const taskType = params.taskType as 'text-to-image' | 'image-to-video' | 'text-to-video';
      const engine = params.engine as 'gpt-image-2' | 'seedream-v5-pro' | 'seedance' | 'kling' | 'midjourney';
      const directorInput = params.director as string | undefined;

      // Build director context
      let directorContext = '';
      if (directorInput) {
        const ctx = await buildDirectorContext(directorInput);
        if (ctx) directorContext = ctx;
      } else {
        // Try to find active director from loaded state
        try {
          const { getActiveDirector } = await import('../../aigc/genLogger');
          const active = getActiveDirector();
          if (active) {
            const ctx = await buildDirectorContext(active);
            if (ctx) directorContext = ctx;
          }
        } catch { /* no active director */ }
      }

      // Get engine formula guidance
      const formula = getEngineFormula(engine);

      // Build optimized prompt
      const parts: string[] = [];
      if (directorContext) parts.push(directorContext);
      parts.push(`## 引擎提示词公式\n${formula}`);
      parts.push(`## 原始提示词\n${basePrompt}`);
      parts.push(`## 优化要求\n请按上述导演风格和引擎公式，优化这段提示词。返回优化后的完整提示词，不要加解释。`);

      const optimizedPrompt = parts.join('\n\n');

      // Log the optimization
      await appendGenerationLog({
        timestamp: new Date().toISOString(),
        director: directorInput || 'unknown',
        taskType,
        engine: engine === 'midjourney' || engine === 'seedream-v5-pro' ? 'other' : engine,
        prompt: optimizedPrompt,
        outputPath: '',
        model: engine,
      });

      return {
        success: true,
        output: optimizedPrompt,
      };
    } catch (err) {
      return {
        success: false,
        output: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
