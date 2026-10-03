import type { Tool, ToolResult } from '../types';
import { imageGenerateTool } from './imageGenerateTool';
import { GenerationSlots } from '../../canvasGen/slotQueue';

const slots = new GenerationSlots(6);
let sequence = 0;
export const imageGenerateBatchTool: Tool = {
  definition: {
    name: 'image_generate_batch',
    description: '普通对话并行生图，不创建画布节点。两个及以上独立提示词一次放入 jobs；内部最多同时执行 6 项，单批最多 24 项。DSH 中 Promise.all 单张工具仍会串行，必须使用本批量工具。依赖前一张结果的任务应分批。每项字段与 image_generate 相同。',
    parameters: {
      type: 'object',
      properties: { jobs: { type: 'array', items: imageGenerateTool.definition.parameters } },
      required: ['jobs'],
    },
  },
  risk: 'ask',
  async execute(params, signal, context) {
    const jobs = params.jobs;
    if (!Array.isArray(jobs) || jobs.length < 1 || jobs.length > 24
      || jobs.some(job => !job || typeof job !== 'object' || Array.isArray(job) || typeof job.prompt !== 'string' || !job.prompt.trim())) {
      return { success: false, output: '', error: 'jobs 须包含 1–24 个有效生图任务，每项必须有非空 prompt。' };
    }
    const paths = jobs.map(job => String(job.output_path || '').trim()).filter(Boolean);
    if (new Set(paths).size !== paths.length) return { success: false, output: '', error: '同一批不能写入重复 output_path。' };
    const results = await Promise.all(jobs.map(async (job): Promise<ToolResult> => {
      const id = `image-batch-${++sequence}`;
      await slots.acquire(id);
      try {
        if (signal?.aborted) return { success: false, output: '', error: '已中止，未提交。', paidSubmissionState: 'not_submitted' };
        return await imageGenerateTool.execute(job, signal, context);
      } catch (error) {
        return { success: false, output: '', error: `生成异常，禁止自动重提：${error instanceof Error ? error.message : String(error)}` };
      } finally { slots.release(id); }
    }));
    const output = results.map((r, i) => `任务 ${i + 1}：${r.success ? r.output : r.error || '失败'}\n${JSON.stringify({ job_index: i + 1, output_path: jobs[i].output_path ?? null, state: r.paidSubmissionState ?? (r.success ? 'completed' : 'unknown'), receipt: r.output, reference_order: jobs[i].reference_urls ?? [], automatic_retry: false })}`).join('\n');
    const success = results.every(r => r.success);
    return {
      success, output, media: results.flatMap(r => r.media ?? []),
      ...(!success ? { paidSubmissionState: 'unknown' as const, error: '部分任务未完成或状态不明；请核对逐项结果，禁止重放整批以免重复扣费。', terminal: true, terminalMessage: output } : {}),
    };
  },
};
