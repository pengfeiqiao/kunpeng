import { readBinaryFile } from '@tauri-apps/api/fs';

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

export async function loadImageInput(image: string): Promise<string> {
  const input = image.trim();
  if (/^https?:\/\//i.test(input) || input.startsWith('data:')) return input;

  const path = normalizeLocalMediaPath(input);
  const mime = mediaTypeForPath(path) || 'image/png';
  const bytes = await readBinaryFile(path);
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
