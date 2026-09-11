/**
 * rhtv download — fetch result URLs to the workspace and return local paths.
 * Reuses assetPersist's directory convention (workspace/<date>/images|videos).
 *
 * COS transit: when configured, downloads are routed through an SCF cloud
 * function (HK region) → COS → client, bypassing slow cross-border CDN.
 */
import { fetch as tauriFetch, ResponseType } from '@tauri-apps/api/http';
import { writeBinaryFile, createDir } from '@tauri-apps/api/fs';
import { invoke } from '@tauri-apps/api/tauri';
import { cosTransitDownload } from '@/lib/cos';
import { uploadToMinio } from '@/lib/minioUpload';
import { downloadCompletedLabel, downloadProgressLabel, type DownloadMediaKind } from './downloadLabels.ts';

let counter = 0;
const hostedUrlByLocalPath = new Map<string, string>();

function extFromUrl(url: string, fallback: string): string {
  const m = /\.(\w{2,4})(?:\?|$)/.exec(url);
  const ext = m?.[1]?.toLowerCase();
  if (ext && /^(png|jpg|jpeg|webp|gif|bmp|mp4|mov|webm|m4v|mkv|avi|mp3|wav|m4a|aac|flac|ogg|glb)$/.test(ext)) return ext;
  return fallback;
}

export type DownloadProgressFn = (phase: string) => void;

export async function rhtvDownloadResult(
  url: string,
  kind: DownloadMediaKind,
  namePrefix = 'rhtv',
  onProgress?: DownloadProgressFn,
): Promise<string> {
  console.info('[media] result-download:start', {
    kind,
    sourceUrl: url.split('?')[0],
    namePrefix,
  });
  const workspace = await invoke<string>('ensure_workspace');
  const sub = kind === 'video' ? 'videos' : kind === 'audio' ? 'audio' : 'images';
  const dir = `${workspace}/${sub}`;
  await createDir(dir, { recursive: true }).catch(() => {});

  let downloadUrl = url;

  // COS transit: route through SCF → COS for faster cross-border download
  if (kind === 'video') {
    try {
      onProgress?.('云端中转中…');
      const fileName = `${namePrefix}_${Date.now()}_${++counter}.${extFromUrl(url, 'mp4')}`;
      const cosUrl = await cosTransitDownload(url, fileName);
      downloadUrl = cosUrl;
      onProgress?.('从 COS 下载中…');
    } catch (err) {
      console.warn('[rhtv] COS 中转失败，回退直连:', err instanceof Error ? err.message : err);
      onProgress?.('直连下载中…');
    }
  }

  onProgress?.(downloadProgressLabel(kind));
  const resp = await tauriFetch(downloadUrl, {
    method: 'GET',
    responseType: ResponseType.Binary,
    // 同步图片没有可恢复的远端 task_id；限制直连下载时间，避免画布永久停在 downloading。
    timeout: kind === 'image' && downloadUrl === url ? 300 : downloadUrl === url ? 600 : 120,
  });
  if (!resp.ok) throw new Error(`下载失败 HTTP ${resp.status}: ${downloadUrl.slice(0, 120)}`);

  const ext = extFromUrl(url, kind === 'video' ? 'mp4' : kind === 'audio' ? 'mp3' : 'png');
  const path = `${dir}/${namePrefix}_${Date.now()}_${++counter}.${ext}`;
  await writeBinaryFile(path, new Uint8Array(resp.data as number[] | ArrayBuffer as ArrayBuffer));
  console.info('[media] result-download:local-saved', { kind, path });
  onProgress?.('上传到 MinIO/CDN 中…');
  try {
    const hostedUrl = await uploadToMinio(path, `${namePrefix}_${Date.now()}.${ext}`);
    hostedUrlByLocalPath.set(path, hostedUrl);
  } catch (err) {
    // The generated media is already safely stored locally. Do not turn a
    // secondary CDN archival failure into a paid-generation failure, which
    // would cause the recovery poller to retry the same task forever.
    console.error('[media] minio-archive:failed-local-kept', {
      kind,
      path,
      error: err instanceof Error ? err.message : String(err),
    });
    onProgress?.('MinIO 上传失败，已保留本地结果');
  }
  onProgress?.(downloadCompletedLabel(kind));
  return path;
}

/** Return the durable CDN URL produced while downloading a result. */
export function rhtvHostedUrlForPath(path: string): string | undefined {
  return hostedUrlByLocalPath.get(path);
}

/** Download all result URLs concurrently (RunningHub MJ returns 4). */
export async function rhtvDownloadAll(
  urls: string[],
  kind: 'image' | 'video' | 'audio',
  namePrefix = 'rhtv',
  onProgress?: DownloadProgressFn,
): Promise<string[]> {
  const paths = await Promise.all(urls.map(async (u, index) => {
    const path = await rhtvDownloadResult(u, kind, namePrefix, onProgress);
    const hostedUrl = rhtvHostedUrlForPath(path);
    // Keep the caller's result URL array in sync with the durable CDN copy.
    // This lets existing generation/recovery code automatically persist the
    // CDN URL while continuing to use the local path for preview and editing.
    if (hostedUrl) urls[index] = hostedUrl;
    return path;
  }));
  return paths;
}
