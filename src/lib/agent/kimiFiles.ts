import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import { randomUUID } from '@/lib/uuid';
import { getKimiK3Config } from './kimiClient';

interface KimiUploadEvent {
  uploadId: string;
  loadedBytes: number;
  totalBytes: number;
  percent: number;
}

interface KimiUploadResult {
  fileId: string;
  url: string;
}

export interface KimiVideoUploadProgress {
  loadedBytes: number;
  totalBytes: number;
  percent: number;
}

export async function uploadVideoToKimi(
  filePath: string,
  onProgress?: (progress: KimiVideoUploadProgress) => void,
): Promise<KimiUploadResult> {
  const config = getKimiK3Config();
  if (!config) throw new Error('未配置 Kimi API Key');

  const uploadId = `kimi-video-${randomUUID()}`;
  let unlisten: UnlistenFn | undefined;
  try {
    unlisten = await listen<KimiUploadEvent>('kimi-video-upload-progress', ({ payload }) => {
      if (payload.uploadId !== uploadId) return;
      onProgress?.({
        loadedBytes: payload.loadedBytes,
        totalBytes: payload.totalBytes,
        percent: payload.percent,
      });
    });
    return await invoke<KimiUploadResult>('kimi_upload_video', {
      apiKey: config.apiKey,
      baseUrl: config.anthropicBaseUrl,
      filePath,
      uploadId,
    });
  } finally {
    unlisten?.();
  }
}
