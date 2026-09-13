import { uploadToMinio } from '@/lib/minioUpload';
import { assetUrlToLocalPath } from '@/lib/rhtv/upload';

function isPublicHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1';
  } catch {
    return false;
  }
}

function fileNameFromPath(path: string, fallback: string): string {
  const name = path.split(/[\\/]/).pop()?.split('?')[0]?.split('#')[0];
  return name || fallback;
}

/** Return a usable public URL, archiving local-only canvas media to MinIO first. */
export async function resolveCopyableMediaUrl(
  url: string,
  localPath: string | undefined,
  fallbackName: string,
): Promise<string> {
  if (isPublicHttpUrl(url)) return url;

  const path = localPath || assetUrlToLocalPath(url);
  if (!path || isPublicHttpUrl(path) || path.startsWith('data:')) {
    throw new Error('当前素材没有可上传的本地文件');
  }

  return uploadToMinio(path, fileNameFromPath(path, fallbackName));
}

/** Clipboard helper with a WebView fallback for macOS/Tauri environments. */
export async function copyTextToClipboard(value: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // Fall through to the legacy WebView-compatible path.
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('系统剪贴板不可用');
}
