import { readBinaryFile } from '@tauri-apps/api/fs';
import { agentLog } from './logger';

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  m4v: 'video/x-m4v',
};

export function normalizeLocalMediaPath(input: string): string {
  const value = input.trim();
  return value.startsWith('file://')
    ? decodeURIComponent(value.replace(/^file:\/\//, ''))
    : value;
}

export function mediaTypeForPath(input: string): string {
  if (input.startsWith('data:')) return input.match(/^data:([^;,]+)/)?.[1] || '';
  const path = input.split('?')[0];
  const extension = (path.split('.').pop() || '').toLowerCase();
  return MIME_BY_EXT[extension] || 'application/octet-stream';
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * data URL 内联上限。实测：~1MB PNG（base64 后 1.3MB+ 请求体）经 dmxapi
 * 网关时会被中间层截断/改写，网关校验 `gjson.ValidBytes` 失败回 HTTP 400
 * "invalid JSON request body"；小图则一次发送完事。视觉模型不需要原图
 * 分辨率，超限就先缩放转 JPEG 再内联（也是各视觉 API 的推荐做法）。
 */
const MAX_INLINE_IMAGE_BYTES = 600 * 1024;
const MAX_INLINE_IMAGE_DIM = 1600;

async function downscaleToJpeg(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
    let w = bitmap.width;
    let h = bitmap.height;
    if (w > MAX_INLINE_IMAGE_DIM || h > MAX_INLINE_IMAGE_DIM) {
      const scale = MAX_INLINE_IMAGE_DIM / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null; // 解码失败/格式不支持：保持原样上传
  }
}

export async function loadImageInput(image: string): Promise<string> {
  const input = image.trim();
  if (/^https?:\/\//i.test(input) || input.startsWith('data:')) return input;

  const path = normalizeLocalMediaPath(input);
  const mime = mediaTypeForPath(path) || 'image/png';
  const bytes = await readBinaryFile(path);
  if (bytes.length > MAX_INLINE_IMAGE_BYTES) {
    const jpeg = await downscaleToJpeg(bytes);
    if (jpeg && jpeg.length < bytes.length) {
      agentLog.info('MediaInput', `大图已压缩内联: ${(bytes.length / 1024).toFixed(0)}KB → ${(jpeg.length / 1024).toFixed(0)}KB`);
      return `data:image/jpeg;base64,${bytesToBase64(jpeg)}`;
    }
    agentLog.warn('MediaInput', `图片 ${(bytes.length / 1024).toFixed(0)}KB 压缩失败或未变小，按原图内联`);
  }
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

export async function loadMediaInput(media: string): Promise<{ dataUrl: string; mediaType: string }> {
  const input = media.trim();
  if (/^https?:\/\//i.test(input)) {
    return { dataUrl: input, mediaType: '' };
  }
  if (input.startsWith('data:')) {
    const mediaType = input.match(/^data:([^;,]+)/)?.[1] || '';
    return { dataUrl: input, mediaType };
  }

  const path = normalizeLocalMediaPath(input);
  const mediaType = mediaTypeForPath(path);
  const bytes = await readBinaryFile(path);
  return { dataUrl: `data:${mediaType};base64,${bytesToBase64(bytes)}`, mediaType };
}
