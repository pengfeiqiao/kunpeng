/**
 * rhtv upload — local file → RunningHub media URL.
 *
 * Mirrors runninghub.py's resolve_media():
 *   - http(s) URL → passthrough
 *   - small files (≤5MB) → data URI (no upload round-trip)
 *   - large files → POST /media/upload/binary (multipart) → download_url
 */
import { fetch as tauriFetch, ResponseType, Body } from '@tauri-apps/api/http';
import { readBinaryFile } from '@tauri-apps/api/fs';
import { invoke } from '@tauri-apps/api/tauri';
import { appUploadUrl, requireRhtvApiKey } from './client';
import { RhtvBusinessError } from './types';

const DATA_URI_MAX_BYTES = 5 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4',
};

function mimeOf(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

/** Convert asset:// display URLs back to plain filesystem paths. */
export function assetUrlToLocalPath(url: string): string {
  if (url.startsWith('https://asset.localhost/')) {
    return decodeURIComponent(url.replace('https://asset.localhost/', '/').replace(/^\/+/, '/'));
  }
  if (url.startsWith('asset://localhost/')) {
    return decodeURIComponent(url.replace('asset://localhost/', '/').replace(/^\/+/, '/'));
  }
  return url;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** data: URI 落盘为临时文件，返回绝对路径（调用方负责清理） */
async function dataUriToTempFile(dataUri: string): Promise<string> {
  const m = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(dataUri);
  if (!m) throw new Error('无效的 data: URI');
  const mime = m[1] || 'application/octet-stream';
  const isBase64 = dataUri.slice(0, dataUri.indexOf(',')).includes(';base64');
  const raw = m[2];
  const bin = isBase64 ? atob(raw) : decodeURIComponent(raw);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = mime.split('/')[1]?.split('+')[0] || 'bin';
  const { createDir, writeBinaryFile } = await import('@tauri-apps/api/fs');
  const { homeDir } = await import('@tauri-apps/api/path');
  const home = await homeDir();
  const tmpDir = `${home}.kunpeng/tmp`;
  await createDir(tmpDir, { recursive: true }).catch(() => {});
  const tmpPath = `${tmpDir}/datauri-${Date.now()}.${ext}`;
  await writeBinaryFile(tmpPath, bytes);
  return tmpPath;
}

/** Upload a local file via multipart, returns the hosted download_url. */
export async function rhtvUploadFile(localPath: string): Promise<string> {
  const key = requireRhtvApiKey();
  const name = localPath.split('/').pop() || 'file';

  try {
    return await invoke<string>('runninghub_standard_upload', { apiKey: key, filePath: localPath });
  } catch (err) {
    throw new Error(
      `RunningHub 标准上传失败: ${err instanceof Error ? err.message : String(err)}; file=${name}; mime=${mimeOf(localPath)}`,
    );
  }
}

/**
 * Upload for AI-application API — returns a `fileName` (not a URL) to be
 * used as `fieldValue` in the nodeInfoList. Endpoint differs from standard.
 */
export async function rhtvUploadForApp(localPath: string): Promise<string> {
  const key = requireRhtvApiKey();
  const name = localPath.split('/').pop() || 'file';

  try {
    return await invoke<string>('runninghub_app_upload', { apiKey: key, filePath: localPath, uploadUrl: appUploadUrl() });
  } catch (err) {
    console.warn('[rhtv] native AI-app upload failed, fallback to Tauri http:', err);
  }

  const res = await tauriFetch(appUploadUrl(), {
    method: 'POST',
    body: Body.form({
      apiKey: key,
      fileType: 'input',
      file: { file: localPath, mime: mimeOf(localPath), fileName: name },
    }),
    responseType: ResponseType.Text,
    timeout: 180,
  });
  if (!res.ok) {
    throw new Error(`RunningHub AI-app 上传失败 (HTTP ${res.status}): ${String(res.data).slice(0, 200)}`);
  }
  const parsed = JSON.parse(res.data as string) as {
    code?: number;
    data?: { fileName?: string };
    msg?: string;
  };
  if (parsed.code === 0 && parsed.data?.fileName) {
    return parsed.data.fileName;
  }
  throw new RhtvBusinessError('bad_request', `RunningHub AI-app 上传被拒绝: ${parsed.msg ?? JSON.stringify(parsed).slice(0, 200)}`);
}

/**
 * Resolve a media reference to a fileName for the AI-application API.
 * Unlike rhtvResolveMedia (which returns URLs/data-URIs), this always
 * uploads and returns the server-side fileName.
 */
export async function rhtvResolveMediaForApp(ref: string): Promise<string> {
  // data: URI 不是文件路径——先落盘临时文件再上传（否则 readBinaryFile('data:...') 必然报错）
  if (ref.startsWith('data:')) {
    const tmpPath = await dataUriToTempFile(ref);
    const fileName = await rhtvUploadForApp(tmpPath);
    import('@tauri-apps/api/fs').then(fs => fs.removeFile(tmpPath).catch(() => {}));
    return fileName;
  }
  const localPath = assetUrlToLocalPath(ref);
  if (localPath !== ref || (!ref.startsWith('http://') && !ref.startsWith('https://'))) {
    return rhtvUploadForApp(localPath);
  }
  // For remote URLs: download locally first, then upload
  const resp = await tauriFetch(ref, { method: 'GET', responseType: ResponseType.Binary, timeout: 180 });
  if (!resp.ok) {
    throw new Error(`下载远程参考素材失败 (HTTP ${resp.status}): ${String(resp.data).slice(0, 200)}`);
  }
  const bytes = resp.data instanceof ArrayBuffer
    ? new Uint8Array(resp.data)
    : Array.isArray(resp.data)
      ? new Uint8Array(resp.data as number[])
      : resp.data instanceof Uint8Array
        ? resp.data
        : new Uint8Array();
  const { createDir, writeBinaryFile } = await import('@tauri-apps/api/fs');
  const { homeDir } = await import('@tauri-apps/api/path');
  const home = await homeDir();
  const tmpDir = `${home}.kunpeng/tmp`;
  await createDir(tmpDir, { recursive: true }).catch(() => {});
  const ext = ref.split('.').pop()?.split('?')[0] || 'png';
  const tmpPath = `${tmpDir}/app-upload-${Date.now()}.${ext}`;
  await writeBinaryFile(tmpPath, bytes);
  const fileName = await rhtvUploadForApp(tmpPath);
  import('@tauri-apps/api/fs').then(fs => fs.removeFile(tmpPath).catch(() => {}));
  return fileName;
}

/**
 * Resolve any media reference (remote URL / asset:// URL / local path) to
 * something the API accepts: passthrough URL, data URI, or uploaded URL.
 */
export async function rhtvResolveMedia(ref: string): Promise<string> {
  // data: URI 直接透传（引擎接受 data URI）；超大时落盘走上传
  if (ref.startsWith('data:')) {
    const approxBytes = Math.floor((ref.length - ref.indexOf(',') - 1) * 0.75);
    if (approxBytes <= DATA_URI_MAX_BYTES) return ref;
    const tmpPath = await dataUriToTempFile(ref);
    try {
      return await rhtvUploadFile(tmpPath);
    } finally {
      import('@tauri-apps/api/fs').then(fs => fs.removeFile(tmpPath).catch(() => {}));
    }
  }
  if (ref.startsWith('http://') || ref.startsWith('https://')) {
    // asset.localhost is a Tauri-internal URL — must NOT be sent to the API.
    if (!ref.startsWith('https://asset.localhost/')) return ref;
  }
  const localPath = assetUrlToLocalPath(ref);
  const bytes = await readBinaryFile(localPath);
  if (bytes.length <= DATA_URI_MAX_BYTES) {
    return `data:${mimeOf(localPath)};base64,${bytesToBase64(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))}`;
  }
  try {
    return await rhtvUploadFile(localPath);
  } catch (err) {
    const { uploadToCos } = await import('@/lib/cos');
    const fileName = localPath.split('/').pop() || `rhtv-ref-${Date.now()}`;
    console.warn('[rhtv] 标准 multipart 上传失败，切换 COS URL 兜底:', err);
    try {
      return await uploadToCos(localPath, fileName);
    } catch (cosErr) {
      // 两级都失败时保留原始 multipart 错误——只抛 COS 报错会掩盖真正病因
      throw new Error(`上传失败（multipart: ${err instanceof Error ? err.message : String(err)}；COS 兜底: ${cosErr instanceof Error ? cosErr.message : String(cosErr)}）`);
    }
  }
}
