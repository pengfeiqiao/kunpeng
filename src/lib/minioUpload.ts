/** Upload local media through the self-hosted FastAPI → MinIO service. */
import { fetch as tauriFetch, Body, ResponseType } from '@tauri-apps/api/http';
import { useSettingsStore } from '@/stores/settingsStore';
import { uploadToS3 } from '@/lib/s3Upload';

export interface MinioUploadProgress {
  stage: 'preparing' | 'uploading' | 'completed';
  loadedBytes: number;
  totalBytes: number;
  percent: number;
}

function mimeFromExt(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
    mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo', webm: 'video/webm',
    mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg',
  };
  return map[ext] ?? 'application/octet-stream';
}

function cdnUrl(baseUrl: string, bucket: string, key: string): string {
  const base = baseUrl.trim().replace(/\/$/, '');
  if (!base) return '';
  return `${base}/${encodeURIComponent(bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

function logUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split('?')[0];
  }
}

export async function uploadToMinio(
  localPath: string,
  fileName: string,
  contentTypeOverride?: string,
  onProgress?: (progress: MinioUploadProgress) => void,
): Promise<string> {
  const state = useSettingsStore.getState();
  if (state.s3Endpoint.trim()) {
    return uploadToS3(localPath, fileName, contentTypeOverride, onProgress);
  }
  const endpoint = state.mediaUploadEndpoint.trim();
  const apiKey = state.mediaUploadApiKey.trim();
  if (!endpoint || !apiKey) {
    throw new Error('请先在设置中配置 MinIO 上传 API 地址和 API Key');
  }

  const contentType = contentTypeOverride || mimeFromExt(fileName);
  const startedAt = Date.now();
  console.info('[minio] upload:start', {
    endpoint: logUrl(endpoint),
    localPath,
    fileName,
    contentType,
  });
  onProgress?.({ stage: 'preparing', loadedBytes: 0, totalBytes: 0, percent: 0 });

  let response;
  try {
    response = await tauriFetch(endpoint, {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        // Tauri 的 Body.form 默认是 application/x-www-form-urlencoded；
        // 显式声明 multipart 后，file 部分才会作为 UploadFile 发送。
        'Content-Type': 'multipart/form-data',
      },
      body: Body.form({
        file: { file: localPath, mime: contentType, fileName },
        folder: 'files',
      }),
      responseType: ResponseType.JSON,
      timeout: 360,
    });
  } catch (err) {
    console.error('[minio] upload:transport-error', {
      endpoint: logUrl(endpoint),
      localPath,
      fileName,
      elapsedMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  console.info('[minio] upload:response', {
    status: response.status,
    ok: response.ok,
    elapsedMs: Date.now() - startedAt,
    response: JSON.stringify(response.data).slice(0, 1000),
  });

  if (!response.ok) {
    throw new Error(`MinIO 上传失败 (HTTP ${response.status}): ${JSON.stringify(response.data).slice(0, 300)}`);
  }

  const data = response.data as { download_url?: string; bucket?: string; key?: string };
  if (!data.download_url) {
    throw new Error(`MinIO 上传响应缺少 download_url: ${JSON.stringify(response.data).slice(0, 300)}`);
  }

  const publicUrl = data.bucket && data.key
    ? cdnUrl(state.mediaPublicBaseUrl, data.bucket, data.key) || data.download_url
    : data.download_url;
  console.info('[minio] upload:success', {
    bucket: data.bucket,
    key: data.key,
    url: logUrl(publicUrl),
    elapsedMs: Date.now() - startedAt,
  });
  onProgress?.({ stage: 'uploading', loadedBytes: 1, totalBytes: 1, percent: 100 });
  onProgress?.({ stage: 'completed', loadedBytes: 1, totalBytes: 1, percent: 100 });
  return publicUrl;
}
