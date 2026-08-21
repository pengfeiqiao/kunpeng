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

let counter = 0;

function extFromUrl(url: string, fallback: string): string {
  const m = /\.(\w{2,4})(?:\?|$)/.exec(url);
  const ext = m?.[1]?.toLowerCase();
  if (ext && /^(png|jpg|jpeg|webp|gif|bmp|mp4|mov|webm|m4v|mkv|avi|mp3|wav|m4a|aac|flac|ogg|glb)$/.test(ext)) return ext;
  return fallback;
}

export type DownloadProgressFn = (phase: string) => void;

export async function rhtvDownloadResult(
  url: string,
  kind: 'image' | 'video' | 'audio',
  namePrefix = 'rhtv',
  onProgress?: DownloadProgressFn,
): Promise<string> {
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

  const resp = await tauriFetch(downloadUrl, {
    method: 'GET',
    responseType: ResponseType.Binary,
    timeout: downloadUrl === url ? 600 : 120,
  });
  if (!resp.ok) throw new Error(`下载失败 HTTP ${resp.status}: ${downloadUrl.slice(0, 120)}`);

  const ext = extFromUrl(url, kind === 'video' ? 'mp4' : kind === 'audio' ? 'mp3' : 'png');
  const path = `${dir}/${namePrefix}_${Date.now()}_${++counter}.${ext}`;
  await writeBinaryFile(path, new Uint8Array(resp.data as number[] | ArrayBuffer as ArrayBuffer));
  return path;
}

/** Download all result URLs concurrently (RunningHub MJ returns 4). */
export async function rhtvDownloadAll(
  urls: string[],
  kind: 'image' | 'video' | 'audio',
  namePrefix = 'rhtv',
  onProgress?: DownloadProgressFn,
): Promise<string[]> {
  return Promise.all(urls.map((u) => rhtvDownloadResult(u, kind, namePrefix, onProgress)));
}
