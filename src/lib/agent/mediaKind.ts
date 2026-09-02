const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'heic',
  'heif',
]);

const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'm4v']);

function extensionOf(input: string): string {
  const path = input.trim().split(/[?#]/)[0];
  return (path.split('.').pop() || '').toLowerCase();
}

export function isImageMediaPath(input: string): boolean {
  const value = input.trim();
  if (/^data:image\//i.test(value)) return true;
  return IMAGE_EXTENSIONS.has(extensionOf(value));
}

export function isVideoMediaPath(input: string): boolean {
  const value = input.trim();
  if (/^data:video\//i.test(value)) return true;
  return VIDEO_EXTENSIONS.has(extensionOf(value));
}

export function requiresNativeImageConversion(input: string): boolean {
  const extension = extensionOf(input);
  return extension === 'heic' || extension === 'heif';
}
