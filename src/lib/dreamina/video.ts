import { createDir, removeFile, writeBinaryFile } from '@tauri-apps/api/fs';
import { fetch, ResponseType } from '@tauri-apps/api/http';
import { invoke } from '@tauri-apps/api/tauri';
import { assetUrlToLocalPath } from '@/lib/rhtv/upload';
import {
  DreaminaTaskPendingError,
  ensureDreaminaLogin,
  executeDreamina,
  looksLikeLoginFailure,
  parseJsonOutput,
  requestAgentLogin,
  responseError,
  type DreaminaResponse,
} from '@/lib/dreamina/image';
import { PaidSubmissionUnknownError, PaidTaskCreatedError } from '@/lib/billingSafety';
import type { DreaminaSeedanceVersion } from './videoContract';
export {
  DREAMINA_SEEDANCE_20_DIRECT_ENDPOINT,
  DREAMINA_SEEDANCE_20_DIRECT_ENGINE_ID,
  DREAMINA_SEEDANCE_25_DIRECT_ENDPOINT,
  DREAMINA_SEEDANCE_25_DIRECT_ENGINE_ID,
  DREAMINA_SEEDANCE_25_ENDPOINT,
  DREAMINA_SEEDANCE_25_ENGINE_ID,
} from './videoContract';

interface DreaminaVideoItem {
  path?: string;
  url?: string;
  video_url?: string;
}

interface DreaminaVideoResponse extends DreaminaResponse {
  result_json?: {
    images?: { path?: string; url?: string }[];
    videos?: DreaminaVideoItem[];
  };
}

export interface DreaminaSeedance25Request {
  prompt: string;
  /** Explicit canvas selection. Defaults to 2.5 for compatibility with existing callers. */
  modelVersion?: DreaminaSeedanceVersion;
  imageUrls?: string[];
  videoUrls?: string[];
  audioUrls?: string[];
  duration?: number;
  ratio?: string;
  resolution?: string;
  /** 生成模式：全能参考（默认）/ 首帧 / 首尾帧（兼容 first-frame / first-last-frame / image2video / frames2video 写法）。 */
  genMode?: string;
  signal?: AbortSignal;
  onProgress?: (progress: string) => void;
  onSubmitted?: (submitId: string) => void;
  taskContext?: string;
}

/** 生成模式归一化：全能参考=multimodal2video，首帧=image2video，首尾帧=frames2video。 */
export function normalizedGenMode(value?: string): 'multimodal' | 'first-frame' | 'first-last-frame' {
  const v = String(value ?? '').trim();
  if (['首帧', 'first-frame', 'image2video'].includes(v)) return 'first-frame';
  if (['首尾帧', 'first-last-frame', 'frames2video'].includes(v)) return 'first-last-frame';
  return 'multimodal';
}

export interface DreaminaSeedance25Result {
  submitId: string;
  paths: string[];
  urls: string[];
}

function extensionForMedia(url: string, kind: 'image' | 'video' | 'audio'): string {
  const clean = url.split(/[?#]/, 1)[0];
  const match = clean.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
  const allowed = kind === 'image'
    ? /^(png|jpe?g|webp|gif|bmp|heic)$/i
    : kind === 'video'
      ? /^(mp4|mov|webm|m4v)$/i
      : /^(mp3|wav|m4a|aac|flac)$/i;
  if (match && allowed.test(match)) return match;
  if (kind === 'video') return 'mp4';
  if (kind === 'audio') return 'mp3';
  return 'png';
}

async function materializeMedia(
  url: string,
  kind: 'image' | 'video' | 'audio',
  index: number,
  tempDir: string,
): Promise<{ path: string; temporary: boolean }> {
  const local = assetUrlToLocalPath(url);
  if (local !== url || (!/^https?:\/\//i.test(url) && !url.startsWith('data:'))) {
    return { path: local.replace(/^file:\/\//, ''), temporary: false };
  }
  const path = `${tempDir}/${kind}-${Date.now()}-${index}.${extensionForMedia(url, kind)}`;
  let bytes: Uint8Array;
  if (url.startsWith('data:')) {
    const encoded = url.slice(url.indexOf(',') + 1);
    bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  } else {
    const response = await fetch(url, { method: 'GET', responseType: ResponseType.Binary, timeout: 180 });
    if (!response.ok) throw new Error(`下载即梦${kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'}参考失败: HTTP ${response.status}`);
    bytes = new Uint8Array(response.data as ArrayBuffer);
  }
  await writeBinaryFile(path, bytes);
  return { path, temporary: true };
}

function parseVideoResponse(stdout: string): DreaminaVideoResponse {
  return parseJsonOutput(stdout) as DreaminaVideoResponse;
}

function videoPaths(response: DreaminaVideoResponse): string[] {
  return (response.result_json?.videos ?? []).map((video) => video.path).filter((path): path is string => Boolean(path));
}

function videoUrls(response: DreaminaVideoResponse): string[] {
  return (response.result_json?.videos ?? [])
    .map((video) => video.video_url || video.url)
    .filter((url): url is string => Boolean(url));
}

function normalizedRatio(value?: string): string {
  const ratio = String(value || '16:9');
  return ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'].includes(ratio) ? ratio : '16:9';
}

async function queryUntilComplete(
  submitId: string,
  outputDir: string,
  request: Pick<DreaminaSeedance25Request, 'signal' | 'onProgress' | 'taskContext'>,
  modelLabel: string,
): Promise<DreaminaVideoResponse> {
  const started = Date.now();
  const maxMs = 12 * 60_000;
  while (Date.now() - started < maxMs) {
    if (request.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const result = await executeDreamina(
      ['query_result', `--submit_id=${submitId}`, `--download_dir=${outputDir}`],
      { timeoutMs: 120_000, signal: request.signal },
    );
    const combined = `${result.stdout}\n${result.stderr}`.trim();
    if (looksLikeLoginFailure(combined)) requestAgentLogin(combined, request.taskContext);
    const response = parseVideoResponse(result.stdout);
    const status = String(response.gen_status || '').toLowerCase();
    if (status === 'success') return response;
    if (status === 'fail' || result.exit_code !== 0) {
      throw new Error(responseError(response, combined || `即梦 ${modelLabel} 查询失败（${result.exit_code}）`));
    }
    request.onProgress?.(`${modelLabel} 生成中 · ${Math.round((Date.now() - started) / 1000)}s`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new DreaminaTaskPendingError(submitId);
}

export async function queryDreaminaSeedance25Task(
  submitId: string,
  options: { signal?: AbortSignal; taskContext?: string } = {},
): Promise<{ status: 'running' | 'succeeded' | 'failed'; paths: string[]; urls: string[]; error?: string }> {
  await ensureDreaminaLogin(options.taskContext);
  const workspace = await invoke<string>('ensure_workspace');
  const outputDir = `${workspace}/videos`;
  await createDir(outputDir, { recursive: true });
  const result = await executeDreamina(
    ['query_result', `--submit_id=${submitId}`, `--download_dir=${outputDir}`],
    { timeoutMs: 120_000, signal: options.signal },
  );
  const combined = `${result.stdout}\n${result.stderr}`.trim();
  if (looksLikeLoginFailure(combined)) requestAgentLogin(combined, options.taskContext);
  const response = parseVideoResponse(result.stdout);
  const status = String(response.gen_status || '').toLowerCase();
  if (status === 'success') {
    const paths = videoPaths(response);
    return paths.length > 0
      ? { status: 'succeeded', paths, urls: videoUrls(response) }
      : { status: 'failed', paths: [], urls: [], error: '即梦任务成功，但没有下载到本地视频' };
  }
  if (status === 'fail' || result.exit_code !== 0) {
    return { status: 'failed', paths: [], urls: [], error: responseError(response, combined || '即梦 Seedance 2.5 任务失败') };
  }
  return { status: 'running', paths: [], urls: [] };
}

export async function generateSeedance25WithDreamina(
  request: DreaminaSeedance25Request,
): Promise<DreaminaSeedance25Result> {
  await ensureDreaminaLogin(request.taskContext);
  const workspace = await invoke<string>('ensure_workspace');
  const outputDir = `${workspace}/videos`;
  const tempDir = `${workspace}/tmp/dreamina-video`;
  await createDir(outputDir, { recursive: true });
  await createDir(tempDir, { recursive: true });

  const images = request.imageUrls ?? [];
  const videos = request.videoUrls ?? [];
  const audios = request.audioUrls ?? [];
  const modelVersion = request.modelVersion ?? 'seedance2.5';
  const modelLabel = modelVersion === 'seedance2.5' ? 'Seedance 2.5' : 'Seedance 2.0';
  const genMode = normalizedGenMode(request.genMode);
  if (genMode === 'first-frame' && images.length < 1) {
    throw new Error(`${modelLabel} 首帧模式需要 1 张首帧参考图，请在参考中加入图片`);
  }
  if (genMode === 'first-last-frame' && images.length < 2) {
    throw new Error(`${modelLabel} 首尾帧模式需要 2 张参考图（首帧 + 尾帧），当前只有 ${images.length} 张`);
  }
  if (genMode === 'multimodal') {
    const limits = modelVersion === 'seedance2.5'
      ? { images: 30, videos: 10, audios: 10, total: 50 }
      : { images: 9, videos: 3, audios: 3, total: 12 };
    if (images.length > limits.images) throw new Error(`${modelLabel} 最多支持 ${limits.images} 张参考图，当前 ${images.length} 张`);
    if (videos.length > limits.videos) throw new Error(`${modelLabel} 最多支持 ${limits.videos} 个参考视频，当前 ${videos.length} 个`);
    if (audios.length > limits.audios) throw new Error(`${modelLabel} 最多支持 ${limits.audios} 个参考音频，当前 ${audios.length} 个`);
    if (images.length + videos.length + audios.length > limits.total) throw new Error(`${modelLabel} 参考素材总数不能超过 ${limits.total} 个`);
  }

  const materializedImages = await Promise.all(images.map((url, index) => materializeMedia(url, 'image', index, tempDir)));
  const materializedVideos = genMode === 'multimodal'
    ? await Promise.all(videos.map((url, index) => materializeMedia(url, 'video', index, tempDir)))
    : [];
  const materializedAudios = genMode === 'multimodal'
    ? await Promise.all(audios.map((url, index) => materializeMedia(url, 'audio', index, tempDir)))
    : [];
  const allMaterialized = [...materializedImages, ...materializedVideos, ...materializedAudios];
  const duration = Math.min(modelVersion === 'seedance2.5' ? 30 : 15, Math.max(4, Math.round(request.duration || 5)));
  const resolution = modelVersion === 'seedance2.5'
    ? (['480p', '720p', '1080p'].includes(String(request.resolution).toLowerCase()) ? String(request.resolution).toLowerCase() : '720p')
    : (['720p', '1080p', '4k'].includes(String(request.resolution).toLowerCase()) ? String(request.resolution).toLowerCase() : '720p');
  const hasMultimodalInputs = materializedImages.length + materializedVideos.length + materializedAudios.length > 0;
  // seedance2.5 的 image2video/frames2video 输出跟随首帧，CLI 拒绝显式
  // --ratio（官方 1.4.18 起）。全能参考模式才传比例。
  const args = genMode === 'multimodal' && !hasMultimodalInputs
    ? [
      'text2video',
      `--prompt=${request.prompt}`,
      `--model_version=${modelVersion}`,
      `--duration=${duration}`,
      `--ratio=${normalizedRatio(request.ratio)}`,
      `--video_resolution=${resolution}`,
      '--poll=2',
    ]
    : genMode === 'first-frame'
    ? [
      'image2video',
      `--prompt=${request.prompt}`,
      `--model_version=${modelVersion}`,
      `--duration=${duration}`,
      `--video_resolution=${resolution}`,
      '--poll=2',
    ]
    : genMode === 'first-last-frame'
      ? [
        'frames2video',
        `--prompt=${request.prompt}`,
        `--model_version=${modelVersion}`,
        `--duration=${duration}`,
        `--video_resolution=${resolution}`,
        '--poll=2',
      ]
      : [
        'multimodal2video',
        `--prompt=${request.prompt}`,
        `--model_version=${modelVersion}`,
        `--duration=${duration}`,
        `--ratio=${normalizedRatio(request.ratio)}`,
        `--video_resolution=${resolution}`,
        '--poll=2',
      ];
  if (genMode === 'first-frame') {
    args.push(`--image=${materializedImages[0].path}`);
  } else if (genMode === 'first-last-frame') {
    args.push(`--first=${materializedImages[0].path}`, `--last=${materializedImages[1].path}`);
  } else {
    materializedImages.forEach((item) => args.push(`--image=${item.path}`));
    materializedVideos.forEach((item) => args.push(`--video=${item.path}`));
    materializedAudios.forEach((item) => args.push(`--audio=${item.path}`));
  }

  try {
    request.onProgress?.(`提交即梦 ${modelLabel}…`);
    let submitted;
    try {
      submitted = await executeDreamina(args, { timeoutMs: 60_000, signal: request.signal });
    } catch (err) {
      if (request.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      throw new PaidSubmissionUnknownError(`即梦 ${modelLabel}`, err instanceof Error ? err.message : String(err));
    }
    const combined = `${submitted.stdout}\n${submitted.stderr}`.trim();
    if (looksLikeLoginFailure(combined)) requestAgentLogin(combined, request.taskContext);
    if (/AigcComplianceConfirmationRequired/i.test(combined)) {
      throw new Error(`${modelLabel} 首次使用需要先在即梦网页完成一次生成与合规确认`);
    }
    const response = parseVideoResponse(submitted.stdout);
    if (submitted.exit_code !== 0 || String(response.gen_status).toLowerCase() === 'fail') {
      throw new Error(responseError(response, combined || `即梦 ${modelLabel} 提交失败（${submitted.exit_code}）`));
    }
    const submitId = response.submit_id;
    if (!submitId) throw new PaidSubmissionUnknownError(`即梦 ${modelLabel}`, `成功响应未返回 submit_id：${combined.slice(0, 300)}`);
    request.onSubmitted?.(submitId);
    try {
      const completed = videoPaths(response).length > 0
        ? response
        : await queryUntilComplete(submitId, outputDir, request, modelLabel);
      const paths = videoPaths(completed);
      if (paths.length === 0) throw new Error('生成成功，但没有下载到本地视频');
      return { submitId, paths, urls: videoUrls(completed) };
    } catch (err) {
      if (err instanceof DreaminaTaskPendingError) throw err;
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      throw new PaidTaskCreatedError(`即梦 ${modelLabel}`, submitId, err instanceof Error ? err.message : String(err));
    }
  } finally {
    allMaterialized.forEach((item) => {
      if (item.temporary) void removeFile(item.path).catch(() => {});
    });
  }
}
