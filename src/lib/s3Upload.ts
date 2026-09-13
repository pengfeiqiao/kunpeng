/** Upload local media directly to an S3-compatible object store. */
import { Command } from '@tauri-apps/api/shell';
import { useSettingsStore } from '@/stores/settingsStore';

export interface S3UploadProgress {
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

function logUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split('?')[0];
  }
}

export async function uploadToS3(
  localPath: string,
  fileName: string,
  contentTypeOverride?: string,
  onProgress?: (progress: S3UploadProgress) => void,
): Promise<string> {
  const state = useSettingsStore.getState();
  const endpoint = state.s3Endpoint.trim();
  const region = state.s3Region.trim() || 'us-east-1';
  const bucket = state.s3Bucket.trim();
  const accessKeyId = state.s3AccessKeyId.trim();
  const secretAccessKey = state.s3SecretAccessKey.trim();
  const prefix = state.s3Prefix.trim().replace(/^\/+|\/+$/g, '');
  const publicBaseUrl = state.s3PublicBaseUrl.trim().replace(/\/$/, '');

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('请先完整配置 S3 Endpoint、Bucket、Access Key 和 Secret Key');
  }

  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `${prefix ? `${prefix}/` : ''}${Date.now()}_${safeName}`;
  const contentType = contentTypeOverride || mimeFromExt(fileName);
  const startedAt = Date.now();
  console.info('[s3] upload:start', { endpoint: logUrl(endpoint), bucket, key, contentType });
  onProgress?.({ stage: 'preparing', loadedBytes: 0, totalBytes: 0, percent: 0 });

  const pyScript = `
import os, sys, subprocess
try:
    import boto3
    from botocore.config import Config
except ImportError:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', '--user', '-q', 'boto3'])
    import boto3
    from botocore.config import Config

client = boto3.client(
    's3', endpoint_url=os.environ['S3_ENDPOINT'], region_name=os.environ['S3_REGION'],
    aws_access_key_id=os.environ['S3_ACCESS_KEY_ID'], aws_secret_access_key=os.environ['S3_SECRET_ACCESS_KEY'],
    config=Config(signature_version='s3v4', s3={'addressing_style': 'path' if os.environ.get('S3_FORCE_PATH_STYLE') == '1' else 'auto'}),
)
with open(sys.argv[1], 'rb') as file_obj:
    client.upload_fileobj(file_obj, os.environ['S3_BUCKET'], os.environ['S3_KEY'], ExtraArgs={'ContentType': os.environ['S3_CONTENT_TYPE']})
print('OK', flush=True)
`.trim();

  const buildCommand = (program: string) => new Command(program, ['-X', 'utf8', '-c', pyScript, localPath], {
    env: {
      S3_ENDPOINT: endpoint,
      S3_REGION: region,
      S3_BUCKET: bucket,
      S3_KEY: key,
      S3_ACCESS_KEY_ID: accessKeyId,
      S3_SECRET_ACCESS_KEY: secretAccessKey,
      S3_CONTENT_TYPE: contentType,
      S3_FORCE_PATH_STYLE: state.s3ForcePathStyle ? '1' : '0',
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
    },
  });
  const runWithPython = (program: string) => new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const command = buildCommand(program);
    let stdout = '';
    let stderr = '';
    command.stdout.on('data', (chunk: string) => { stdout += chunk; });
    command.stderr.on('data', (chunk: string) => { stderr += chunk; });
    command.on('error', reject);
    command.on('close', (result) => resolve({ ...result, stdout, stderr }));
    command.spawn().catch(reject);
  });

  try {
    let result;
    try {
      result = await runWithPython('python3');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/program not found|not found|ENOENT|无法找到/i.test(message)) throw err;
      result = await runWithPython('python');
    }
    if (result.code !== 0 || !result.stdout.includes('OK')) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || 'S3 上传进程失败');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[s3] upload:failed', { endpoint: logUrl(endpoint), bucket, elapsedMs: Date.now() - startedAt, error: message });
    throw new Error(`S3 上传失败: ${message.slice(0, 300)}`);
  }

  const baseUrl = publicBaseUrl || endpoint;
  const publicUrl = `${baseUrl}/${encodeURIComponent(bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;
  console.info('[s3] upload:success', { bucket, key, url: logUrl(publicUrl), elapsedMs: Date.now() - startedAt });
  onProgress?.({ stage: 'uploading', loadedBytes: 1, totalBytes: 1, percent: 100 });
  onProgress?.({ stage: 'completed', loadedBytes: 1, totalBytes: 1, percent: 100 });
  return publicUrl;
}
