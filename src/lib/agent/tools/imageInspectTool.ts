import type { Tool } from '../types';
import { loadImageInput } from './dmxClient';
import { validateRegion, type ImageRegion } from '../../imageInspection/diff';

function compareInWorker(before: Uint8ClampedArray, after: Uint8ClampedArray, width: number, height: number, region: ImageRegion | undefined, threshold: number, signal?: AbortSignal): Promise<ReturnType<typeof import('../../imageInspection/diff').comparePixels>> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../../imageInspection/diff.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => { worker.terminate(); signal?.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(new Error('已取消')); };
    worker.onmessage = ({ data }) => { cleanup(); data.error ? reject(new Error(data.error)) : resolve(data.result); };
    worker.onerror = () => { cleanup(); reject(new Error('像素差分计算失败')); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    worker.postMessage({ before, after, width, height, region, threshold }, [before.buffer, after.buffer]);
  });
}
async function readPixels(path: string) {
  const image = new Image(); image.crossOrigin = 'anonymous';
  const source = await loadImageInput(path);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { image.src = ''; reject(new Error('图片读取超时')); }, 30000);
    image.onload = () => { clearTimeout(timer); resolve(); };
    image.onerror = () => { clearTimeout(timer); reject(new Error('无法解码图片')); }; image.src = source;
  });
  if (image.naturalWidth * image.naturalHeight > 16_000_000) throw new Error('图片超过1600万像素，请先提供明确的局部裁切；不静默缩图做差分');
  const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }); if (!ctx) throw new Error('图像读取不可用');
  ctx.drawImage(image, 0, 0);
  return { canvas, ctx, width: canvas.width, height: canvas.height };
}
function evidence(canvas: HTMLCanvasElement) {
  const preview = document.createElement('canvas'); const scale = Math.min(1, 1600 / Math.max(canvas.width, canvas.height));
  preview.width = Math.max(1, Math.round(canvas.width * scale)); preview.height = Math.max(1, Math.round(canvas.height * scale));
  preview.getContext('2d')!.drawImage(canvas, 0, 0, preview.width, preview.height);
  return { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png', data: preview.toDataURL('image/png').split(',')[1] } };
}
export const imageInspectTool: Tool = {
  definition: { name: 'image_inspect', description: '本地客观图像核验，不调用付费识图API。查看/裁切图片，或与 compare_to 做原尺寸RGBA像素差分，返回变化范围、目标区外变化像素数与热图。region 使用原图像素坐标；不改原文件。',
    parameters: { type: 'object', properties: {
      image: { type: 'string', description: '原图本地路径或URL' }, compare_to: { type: 'string', description: '修改后的图片路径；两图尺寸必须一致' },
      region: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' }, width: { type: 'integer' }, height: { type: 'integer' } }, required: ['x', 'y', 'width', 'height'], description: '裁切区域；差分模式为允许修改的目标区域，统计其外变化' },
      threshold: { type: 'integer', description: '差分通道容差0–255，默认0；非零不代表完全未变' },
    }, required: ['image'] } },
  risk: 'safe',
  async execute(params, signal) {
    try {
      if (typeof params.image !== 'string' || !params.image.trim()) throw new Error('image 必填');
      const before = await readPixels(params.image); if (signal?.aborted) throw new Error('已取消');
      const region = params.region as ImageRegion | undefined;
      if (region) validateRegion(region, before.width, before.height);
      if (params.compare_to) {
        const after = await readPixels(String(params.compare_to)); if (signal?.aborted) throw new Error('已取消');
        if (before.width !== after.width || before.height !== after.height) throw new Error('两张图片尺寸不同，拒绝自动缩放差分');
        const result = await compareInWorker(before.ctx.getImageData(0, 0, before.width, before.height).data, after.ctx.getImageData(0, 0, after.width, after.height).data, before.width, before.height, region, params.threshold === undefined ? 0 : Number(params.threshold), signal);
        before.ctx.putImageData(new ImageData(result.heatmap, before.width, before.height), 0, 0);
        return { success: true, output: JSON.stringify({ before: params.image, after: params.compare_to, region, ...result.metrics, evidence: '红色热图表示差异；预览最长边1600，指标基于原尺寸' }), media: [evidence(before.canvas)] };
      }
      const crop = region ?? { x: 0, y: 0, width: before.width, height: before.height };
      const canvas = document.createElement('canvas'); canvas.width = crop.width; canvas.height = crop.height;
      canvas.getContext('2d')!.drawImage(before.canvas, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
      return { success: true, output: JSON.stringify({ image: params.image, original_width: before.width, original_height: before.height, region: crop, note: '已读取实际像素。预览不增加原图细节；请报告可见证据与不确定项，不能把看不清判为通过。' }), media: [evidence(canvas)] };
    } catch (error) { return { success: false, output: '', error: error instanceof Error ? error.message : String(error) }; }
  },
};
