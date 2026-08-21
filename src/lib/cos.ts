/**
 * Tencent Cloud COS upload via qcloud_cos Python SDK.
 */
import { Command } from '@tauri-apps/api/shell';
import { fetch as tauriFetch, ResponseType } from '@tauri-apps/api/http';
import { useSettingsStore } from '@/stores/settingsStore';
import { resolveCosSecrets } from '@/lib/credentials';

export interface CosUploadProgress {
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

/**
 * Upload a local file to COS and return its public URL.
 */
export async function uploadToCos(
  localPath: string,
  fileName: string,
  contentTypeOverride?: string,
  onProgress?: (progress: CosUploadProgress) => void,
): Promise<string> {
  const state = useSettingsStore.getState();
  const cosBucket = state.cosBucket;
  const cosRegion = state.cosRegion;
  const resolved = resolveCosSecrets(state, state.cosSecretId, state.cosSecretKey);
  const sid = resolved.secretId.trim();
  const skey = resolved.secretKey.trim();
  console.log('[COS] config:', { cosBucket, cosRegion, sidLen: sid.length, skeyLen: skey.length });
  if (!cosBucket || !sid || !skey) {
    throw new Error('请先在设置中配置腾讯云 COS 信息');
  }

  const key = `kunpeng/${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const host = `${cosBucket}.cos.${cosRegion}.myqcloud.com`;
  const publicUrl = `https://${host}/${key}`;
  const contentType = contentTypeOverride || mimeFromExt(fileName);

  console.log('[COS] 上传:', localPath, '→', publicUrl);

  onProgress?.({ stage: 'preparing', loadedBytes: 0, totalBytes: 0, percent: 0 });

  const pyScript = `
import sys, os, subprocess, glob, warnings
warnings.filterwarnings('ignore')
home = os.path.expanduser('~')
for p in glob.glob(os.path.join(home, 'Library/Python/*/lib/python/site-packages')):
    if p not in sys.path:
        sys.path.insert(0, p)
try:
    import site
    sp = site.getusersitepackages()
    if sp and sp not in sys.path:
        sys.path.insert(0, sp)
except Exception:
    pass
try:
    from qcloud_cos import CosConfig, CosS3Client
except ImportError:
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', '--user', '-q', 'cos-python-sdk-v5'])
    for p in glob.glob(os.path.join(home, 'Library/Python/*/lib/python/site-packages')):
        if p not in sys.path:
            sys.path.insert(0, p)
    from qcloud_cos import CosConfig, CosS3Client

config = CosConfig(
    Region=sys.argv[1],
    SecretId=os.environ.get('COS_SECRET_ID', ''),
    SecretKey=os.environ.get('COS_SECRET_KEY', ''),
)
client = CosS3Client(config)

class ProgressReader:
    def __init__(self, file_obj, total):
        self._file = file_obj
        self._total = total
        self._max_seen = 0
        self._last_percent = -1

    def __len__(self):
        return self._total

    def read(self, size=-1):
        chunk = self._file.read(size)
        self._max_seen = max(self._max_seen, self._file.tell())
        percent = 100 if self._total <= 0 else min(100, int(self._max_seen * 100 / self._total))
        if percent != self._last_percent:
            self._last_percent = percent
            print(f"PROGRESS:{self._max_seen}:{self._total}:{percent}", flush=True)
        return chunk

    def seek(self, *args):
        return self._file.seek(*args)

    def tell(self):
        return self._file.tell()

    def __getattr__(self, name):
        return getattr(self._file, name)

total = os.path.getsize(sys.argv[2])
with open(sys.argv[2], 'rb') as f:
    resp = client.put_object(
        Bucket=sys.argv[3],
        Body=ProgressReader(f, total),
        Key=sys.argv[4],
        ContentType=sys.argv[5],
    )
print(f"OK:{resp.get('ETag','')}")
`.trim();

  // Secrets go via env (argv is world-visible in `ps`); only non-secret
  // positional args remain.
  const command = new Command('python3', [
    '-c', pyScript,
    cosRegion, localPath, cosBucket, key, contentType,
  ], {
    env: {
      COS_SECRET_ID: sid,
      COS_SECRET_KEY: skey,
    },
  });
  let stdout = '';
  let stderr = '';
  let lineBuffer = '';
  let lastPercent = -1;

  const processStdoutLine = (line: string): boolean => {
    const match = line.trim().match(/^PROGRESS:(\d+):(\d+):(\d+)$/);
    if (!match) return false;
    const loadedBytes = Number(match[1]);
    const totalBytes = Number(match[2]);
    const percent = Number(match[3]);
    if (percent === lastPercent) return true;
    if (percent < 100 && lastPercent >= 0 && percent - lastPercent < 2) return true;
    lastPercent = percent;
    onProgress?.({ stage: 'uploading', loadedBytes, totalBytes, percent });
    return true;
  };

  const parseStdout = (chunk: string) => {
    stdout += `${chunk}\n`;
    // Tauri shell normally emits stdout one line at a time without the newline.
    // Handle that path directly, while retaining a buffer for chunked runtimes.
    if (!chunk.includes('\n') && processStdoutLine(chunk)) return;
    lineBuffer += chunk;
    const lines = lineBuffer.split(/\r?\n/);
    lineBuffer = lines.pop() || '';
    for (const line of lines) {
      processStdoutLine(line);
    }
  };

  const result = await new Promise<{ code: number | null; signal: number | null }>((resolve, reject) => {
    let settled = false;
    command.stdout.on('data', (chunk: string) => parseStdout(chunk));
    command.stderr.on('data', (chunk: string) => { stderr += chunk; });
    command.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(new Error(String(error)));
    });
    command.on('close', (event) => {
      if (settled) return;
      settled = true;
      if (lineBuffer) parseStdout('\n');
      resolve(event);
    });
    command.spawn().catch((error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });

  if (result.code !== 0 || !stdout.includes('OK:')) {
    const errMsg = stderr.trim() || stdout.trim();
    console.error('[COS] 上传失败:', errMsg);
    throw new Error(`COS 上传失败: ${errMsg.slice(0, 300)}`);
  }

  onProgress?.({ stage: 'completed', loadedBytes: 1, totalBytes: 1, percent: 100 });
  console.log('[COS] 上传成功:', stdout.trim());
  return publicUrl;
}

/**
 * Download a remote file via SCF cloud function → COS transit.
 * Returns a COS public URL that can be fetched quickly from mainland China.
 */
export async function cosTransitDownload(remoteUrl: string, fileName: string): Promise<string> {
  const endpoint = useSettingsStore.getState().cosTransitEndpoint?.trim();
  if (!endpoint) throw new Error('COS 中转 endpoint 未配置');

  const resp = await tauriFetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { type: 'Json', payload: { url: remoteUrl, fileName, contentType: 'video/mp4' } },
    timeout: 360,
    responseType: ResponseType.JSON,
  });
  if (!resp.ok) throw new Error(`SCF 中转失败 HTTP ${resp.status}`);
  const data = resp.data as { cosUrl?: string; error?: string };
  if (!data.cosUrl) throw new Error(data.error || 'SCF 未返回 cosUrl');
  return data.cosUrl;
}
