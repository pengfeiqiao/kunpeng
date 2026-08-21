/**
 * TS 生图客户端 — 直接调 API，不走 Agent
 * 按 provider (dmxapi / aihubmix / zexapi) 分路调用，多 slot 降级
 */

import { fetch, ResponseType } from '@tauri-apps/api/http';
import { writeBinaryFile } from '@tauri-apps/api/fs';
import { invoke } from '@tauri-apps/api/tauri';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { readBinaryFile } from '@tauri-apps/api/fs';
import { useSettingsStore, type ImageApiSlot } from '@/stores/settingsStore';
import { resolveSlotApiKey } from '@/lib/credentials';
import { assetUrlToLocalPath } from '@/lib/rhtv/upload';
import { normalizeGptImage2Size, normalizeSeedreamProSize } from './size';
import {
  PaidSubmissionUnknownError,
  PaidTaskCreatedError,
  isAmbiguousPaidSubmitStatus,
  shouldStopAutomaticPaidFallback,
} from '@/lib/billingSafety';
import {
  APIMART_SEEDREAM_ENDPOINT,
  getApimartApiKey,
  pollApimartTask,
  submitApimartTask,
} from '@/lib/apimart/client';
import { APIMART_BASE_URL } from '@/lib/apimart/baseUrl';
import {
  APIMART_GPT_IMAGE2_ENDPOINT,
  APIMART_GPT_IMAGE2_SLOT_ID,
  APIMART_SEEDREAM_SLOT_ID,
  buildApimartGptImage2Payload,
  buildApimartSeedreamPayload,
} from '@/lib/apimart/contracts';

async function paidSubmit<T>(provider: string, request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new PaidSubmissionUnknownError(provider, err instanceof Error ? err.message : String(err));
  }
}

export interface ImageResult {
  success: boolean;
  imagePath?: string;
  imageUrl?: string;
  modelUsed: string;
  apiUsed: string;
  error?: string;
}

export interface GenerateImageParams {
  prompt: string;
  model?: string;
  size?: string;
  quality?: string;
  resolution?: string;
  aspectRatio?: string;
  referenceImageB64?: string;
  referenceImageUrl?: string;
  referenceImageUrls?: string[];
  outputPath?: string;
  forceSlotId?: string;
  forceTier?: 'cheap' | 'standard';
  signal?: AbortSignal;
  /** Async provider receipt used by canvas recovery. */
  onSubmitted?: (taskId: string, endpoint: string) => void;
}

interface EditReference {
  binary: Uint8Array;
  mime: string;
  ext: string;
}

// 中转渠道模型 ID 各归各：DMXAPI 用 doubao-seedream-5-0-pro-260628（见其
// 官方文档，在 seedreamProDmxapiGen 定义）；Ark 官方通道用 Ark 注册表
// （src/lib/channels/arkModels.ts 的 DEFAULT_ARK_IMAGE_MODEL）。

function getSlots(params: GenerateImageParams | undefined, model: string): ImageApiSlot[] {
  const settings = useSettingsStore.getState();
  const slots = [...(settings.imageApiSlots ?? [])];
  const apimartKey = getApimartApiKey();
  if (model === 'seedream-v5-pro' && apimartKey) {
    // Keep APIMart on the existing global key. This virtual slot participates
    // in the same fallback loop without exposing a duplicate key field.
    slots.push({
      id: APIMART_SEEDREAM_SLOT_ID,
      label: 'APIMart Seedream 5 Pro',
      provider: 'dmxapi',
      baseUrl: APIMART_BASE_URL,
      apiKey: apimartKey,
      enabled: true,
      priority: 60,
      tier: 'standard',
    });
  }
  if (model === 'gpt-image-2' && apimartKey) {
    // APIMart GPT-Image-2 走异步任务接口（docs.apimart.ai），与槽位同池容灾。
    slots.push({
      id: APIMART_GPT_IMAGE2_SLOT_ID,
      label: 'APIMart GPT-Image-2',
      provider: 'dmxapi',
      baseUrl: APIMART_BASE_URL,
      apiKey: apimartKey,
      enabled: true,
      priority: 60,
      tier: 'standard',
    });
  }
  return slots
    .filter((s) => s.enabled && s.baseUrl && resolveSlotApiKey(settings, s))
    .filter((s) => !params?.forceSlotId || s.id === params.forceSlotId)
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
}

async function gptImage2ApimartGen(
  params: GenerateImageParams,
  refs: EditReference[],
): Promise<{ b64?: string; url?: string }> {
  const imageUrls = refs.map((ref) => bytesToDataUrl(ref.binary, ref.mime || 'image/png'));
  const taskId = await submitApimartTask({
    path: '/v1/images/generations',
    label: 'APIMart GPT-Image-2',
    payload: buildApimartGptImage2Payload({
      prompt: params.prompt,
      imageUrls,
      size: params.size,
      aspectRatio: params.aspectRatio,
      resolution: params.resolution,
    }),
    signal: params.signal,
  });
  try { params.onSubmitted?.(taskId, APIMART_GPT_IMAGE2_ENDPOINT); } catch { /* callback must not break a paid task */ }
  const state = await pollApimartTask({
    taskId,
    kind: 'image',
    label: 'APIMart GPT-Image-2',
    signal: params.signal,
  });
  return { url: state.urls[0] };
}

async function seedreamProApimartGen(
  params: GenerateImageParams,
  refs: EditReference[],
): Promise<{ b64?: string; url?: string }> {
  const imageUrls = refs.map((ref) => bytesToDataUrl(ref.binary, ref.mime || 'image/png'));
  const taskId = await submitApimartTask({
    path: '/v1/images/generations',
    label: 'APIMart Seedream 5 Pro',
    payload: buildApimartSeedreamPayload({
      prompt: params.prompt,
      imageUrls,
      size: params.size,
      aspectRatio: params.aspectRatio,
      resolution: params.resolution,
      outputFormat: 'jpeg',
    }),
    signal: params.signal,
  });
  try { params.onSubmitted?.(taskId, APIMART_SEEDREAM_ENDPOINT); } catch { /* callback must not break a paid task */ }
  const state = await pollApimartTask({
    taskId,
    kind: 'image',
    label: 'APIMart Seedream 5 Pro',
    signal: params.signal,
  });
  return { url: state.urls[0] };
}

async function getOutputPath(): Promise<string> {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    const workspace = await invoke<string>('ensure_workspace');
    return `${workspace}/images/${unique}.png`;
  } catch {
    return `/tmp/kunpeng-${unique}.png`;
  }
}

/** 压缩图片到指定最大边长，返回 JPEG Uint8Array。参考图不能压得太小，否则 GPT-Image-2 会明显丢身份/结构信息。 */
async function compressImage(raw: Uint8Array, maxDim = 1536, quality = 0.85): Promise<Uint8Array> {
  try {
    const blob = new Blob([raw as BlobPart]);
    const bitmap = await createImageBitmap(blob);
    let w = bitmap.width, h = bitmap.height;
    if (w > maxDim || h > maxDim) {
      const scale = maxDim / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const resizedBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    const buf = await resizedBlob.arrayBuffer();
    console.log(`📐 参考图压缩: ${bitmap.width}x${bitmap.height} → ${w}x${h}, ${(buf.byteLength / 1024).toFixed(1)}KB`);
    return new Uint8Array(buf);
  } catch (err) {
    console.warn('参考图压缩失败，使用原图:', err);
    return raw;
  }
}

/** 下载参考图为 binary；compress=true 时压缩到 1536px/85quality */
async function getRefBinary(opts: { referenceUrl?: string; referenceB64?: string }, compress = false): Promise<Uint8Array> {
  let raw: Uint8Array;
  if (opts.referenceUrl) {
    const resolved = assetUrlToLocalPath(opts.referenceUrl);
    if (resolved !== opts.referenceUrl || (!opts.referenceUrl.startsWith('http://') && !opts.referenceUrl.startsWith('https://') && !opts.referenceUrl.startsWith('data:'))) {
      raw = new Uint8Array(await readBinaryFile(resolved));
    } else if (opts.referenceUrl.startsWith('data:')) {
      const b64 = opts.referenceUrl.split(',')[1] ?? '';
      raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    } else {
      const dlResp = await fetch(opts.referenceUrl, { method: 'GET', responseType: ResponseType.Binary, timeout: 60 });
      if (!dlResp.ok) throw new Error(`下载参考图失败: ${dlResp.status}`);
      raw = new Uint8Array(dlResp.data as ArrayBuffer);
    }
  } else if (opts.referenceB64) {
    const b64 = opts.referenceB64.includes(',') ? opts.referenceB64.split(',')[1] : opts.referenceB64;
    raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  } else {
    throw new Error('图生图需要参考图');
  }
  return compress ? compressImage(raw, 1536, 0.85) : raw;
}

function guessExt(url?: string): string {
  if (url?.startsWith('data:')) {
    const mime = url.slice(5, url.indexOf(';') > 0 ? url.indexOf(';') : url.indexOf(','));
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
    if (mime.includes('webp')) return 'webp';
    return 'png';
  }
  return url?.split('.').pop()?.split('?')[0]?.toLowerCase() || 'png';
}

function extToMime(ext: string): string {
  return ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
}

async function getEditReferences(params: GenerateImageParams, compress = false): Promise<EditReference[]> {
  const urls = params.referenceImageUrls?.length
    ? params.referenceImageUrls
    : params.referenceImageUrl
      ? [params.referenceImageUrl]
      : [];
  const refs: EditReference[] = [];

  for (const url of urls) {
    const ext = guessExt(url);
    refs.push({
      binary: await getRefBinary({ referenceUrl: url }, compress),
      mime: extToMime(ext),
      ext,
    });
  }

  if (params.referenceImageB64) {
    refs.push({
      binary: await getRefBinary({ referenceB64: params.referenceImageB64 }, compress),
      mime: 'image/png',
      ext: 'png',
    });
  }

  console.log(`🖼️ GPT-Image-2 edit 参考图准备完成: ${refs.length} 张，${compress ? '已压缩，' : '原图，'}总大小 ${(refs.reduce((sum, r) => sum + r.binary.byteLength, 0) / 1024 / 1024).toFixed(2)}MB`);
  return refs;
}

// ── GPT Image 2: 文生图（两家格式一样）────────────────────────────────────

async function gptImage2Gen(
  baseUrl: string, apiKey: string,
  prompt: string, size: string, quality: string,
  model = 'gpt-image-2',
): Promise<{ b64?: string; url?: string }> {
  const resp = await paidSubmit('GPT Image 2', () => fetch(`${baseUrl}/v1/images/generations`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: { type: 'Json', payload: { model, prompt, n: 1, size, quality } },
    responseType: ResponseType.JSON,
    timeout: 300,
  }));
  if (!resp.ok) {
    if (isAmbiguousPaidSubmitStatus(resp.status)) throw new PaidSubmissionUnknownError('GPT Image 2', `HTTP ${resp.status}`);
    throw new Error(`GPT Image 2: ${resp.status} ${JSON.stringify(resp.data)}`);
  }
  const item = (resp.data as any)?.data?.[0];
  if (!item?.b64_json && !item?.url) throw new PaidSubmissionUnknownError('GPT Image 2', '成功响应没有可用图片');
  return { b64: item.b64_json, url: item.url };
}

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${mime};base64,${btoa(bin)}`;
}

function unwrapImage2Response(data: any): { b64?: string; url?: string } {
  const item = data?.data?.[0] ?? data?.data ?? data;
  const url = item?.url ?? item?.image_url ?? item?.output_url ?? data?.url ?? data?.image_url;
  const b64 = item?.b64_json ?? item?.base64 ?? data?.b64_json;
  if (url || b64) return { url, b64 };
  throw new Error(`image2: 无有效返回: ${JSON.stringify(data).slice(0, 300)}`);
}

async function gptImage2ZexapiAsync(
  baseUrl: string,
  apiKey: string,
  prompt: string,
  size: string,
  aspectRatio: string | undefined,
  refs: EditReference[],
): Promise<{ b64?: string; url?: string }> {
  const payload: Record<string, unknown> = {
    model: 'gpt-image-2',
    prompt,
  };
  if (size && size !== 'auto') payload.size = size;
  else payload.aspect_ratio = aspectRatio || 'auto';
  if (refs.length === 1) {
    payload.images = [bytesToDataUrl(refs[0].binary, refs[0].mime || 'image/png')];
  } else if (refs.length > 1) {
    payload.images = refs.slice(0, 5).map((ref) => bytesToDataUrl(ref.binary, ref.mime || 'image/png'));
  }
  const submitResp = await paidSubmit('ZexAPI gpt-image-2', () => fetch(`${baseUrl}/v1/videos`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: { type: 'Json', payload },
    responseType: ResponseType.JSON,
    timeout: 180,
  }));
  if (!submitResp.ok) {
    if (isAmbiguousPaidSubmitStatus(submitResp.status)) throw new PaidSubmissionUnknownError('ZexAPI gpt-image-2', `HTTP ${submitResp.status}`);
    throw new Error(`ZexAPI gpt-image-2: ${submitResp.status} ${JSON.stringify(submitResp.data)}`);
  }
  const submitted = submitResp.data as any;
  if (submitted?.error) throw new Error(`ZexAPI gpt-image-2: ${submitted.error.message || JSON.stringify(submitted.error)}`);
  const taskId = submitted?.id || submitted?.task_id;
  if (!taskId) throw new PaidSubmissionUnknownError('ZexAPI gpt-image-2', `成功响应未返回 task_id：${JSON.stringify(submitted).slice(0, 300)}`);

  try {
    const started = Date.now();
    while (Date.now() - started < 20 * 60_000) {
      const pollResp = await fetch(`${baseUrl}/v1/videos/${encodeURIComponent(taskId)}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        responseType: ResponseType.JSON,
        timeout: 60,
      });
      if (!pollResp.ok) throw new Error(`查询失败: ${pollResp.status} ${JSON.stringify(pollResp.data)}`);
      const status = pollResp.data as any;
      if (status?.error) throw new Error(status.error.message || JSON.stringify(status.error));
      if (status?.status === 'completed' || status?.status === 'succeeded') return unwrapImage2Response(status);
      if (status?.status === 'failed' || status?.status === 'cancelled' || status?.status === 'canceled') {
        throw new Error(`任务失败: ${status.error?.message || status.message || status.status}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    throw new Error('查询超时');
  } catch (err) {
    throw new PaidTaskCreatedError('ZexAPI gpt-image-2', taskId, err instanceof Error ? err.message : String(err));
  }
}

// DMXAPI 的 Seedream 5 Pro 走 /v1/responses，模型 ID 与 Ark 目录不同
// （官方文档 doc.dmxapi.cn/doubao-seedream-5-0-pro-260628-text-to-image）。
// 注意：DMXAPI 像素上限 4,194,304，超出直接报错；1K/2K 档位可免像素计算。
const DMX_SEEDREAM_PRO_MODEL_ID = 'doubao-seedream-5-0-pro-260628';
const DMX_SEEDREAM_PRO_MAX_PIXELS = 4194304;

/** 像素尺寸压到 DMXAPI 允许的总像素上限内（按比例缩放，取偶数）。 */
function clampSeedreamProSize(size: string): string {
  const match = size.toLowerCase().match(/^(\d+)x(\d+)$/);
  if (!match) return '2K';
  let w = Number(match[1]);
  let h = Number(match[2]);
  if (w * h <= DMX_SEEDREAM_PRO_MAX_PIXELS) return `${w}x${h}`;
  const scale = Math.sqrt(DMX_SEEDREAM_PRO_MAX_PIXELS / (w * h));
  w = Math.max(2, Math.floor((w * scale) / 2) * 2);
  h = Math.max(2, Math.floor((h * scale) / 2) * 2);
  return `${w}x${h}`;
}

async function seedreamProDmxapiGen(
  baseUrl: string,
  apiKey: string,
  prompt: string,
  size: string,
  refs: EditReference[],
): Promise<{ b64?: string; url?: string }> {
  const payload: Record<string, unknown> = {
    model: DMX_SEEDREAM_PRO_MODEL_ID,
    input: prompt,
    size: clampSeedreamProSize(size),
    response_format: 'url',
    output_format: 'jpeg',
    watermark: false,
  };
  if (refs.length > 0) {
    payload.image = refs.slice(0, 10).map((ref) => bytesToDataUrl(ref.binary, ref.mime || 'image/png'));
  }
  const resp = await paidSubmit('DMX Seedream 5 Pro', () => fetch(`${baseUrl}/v1/responses`, {
    method: 'POST',
    // /v1/responses 的认证头是裸 key（无 Bearer），与 dmxClient.ts 实测一致。
    headers: { 'Authorization': apiKey, 'Content-Type': 'application/json' },
    body: { type: 'Json', payload },
    responseType: ResponseType.JSON,
    timeout: 300,
  }));
  if (!resp.ok) {
    if (isAmbiguousPaidSubmitStatus(resp.status)) throw new PaidSubmissionUnknownError('DMX Seedream 5 Pro', `HTTP ${resp.status}`);
    throw new Error(`DMX Seedream 5 Pro: ${resp.status} ${JSON.stringify(resp.data)}`);
  }
  const data = resp.data as any;
  if (data?.error) throw new Error(`DMX Seedream 5 Pro: ${data.error.message || JSON.stringify(data.error)}`);
  const item = data?.data?.[0] ?? data?.data ?? data;
  const url = item?.url ?? item?.image_url ?? data?.url;
  const b64 = item?.b64_json ?? item?.base64 ?? data?.b64_json;
  if (url || b64) return { url, b64 };
  throw new PaidSubmissionUnknownError('DMX Seedream 5 Pro', `成功响应没有可用图片：${JSON.stringify(data).slice(0, 300)}`);
}

// ── GPT Image 2 Edit: dmxapi ─────────────────────────────────────────────
// curl multipart form-data（-F 参数），按 dmxapi 文档

/**
 * Run curl with the API key delivered via a 0600 config file (`-K`) instead of
 * an argv header — argv is world-visible in `ps`, which would leak the key.
 * The config file is always removed afterwards.
 */
async function runCurlWithAuthKey(
  args: string[],
  apiKey: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const { Command } = await import('@tauri-apps/api/shell');
  const { removeFile } = await import('@tauri-apps/api/fs');
  const cfgName = `curl-${Date.now()}-${Math.random().toString(36).slice(2)}.conf`;
  const cfgRelPath = `.kunpeng/tmp/${cfgName}`;
  const escaped = apiKey.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  await invoke('write_text_file_private', {
    path: cfgRelPath,
    contents: `header = "Authorization: Bearer ${escaped}"\n`,
  });
  try {
    const { homeDir } = await import('@tauri-apps/api/path');
    const cfgAbs = `${await homeDir()}${cfgRelPath}`;
    return await new Command('curl', ['-K', cfgAbs, ...args]).execute();
  } finally {
    const { homeDir } = await import('@tauri-apps/api/path');
    const cfgAbs = `${await homeDir()}${cfgRelPath}`;
    void removeFile(cfgAbs).catch(() => {});
  }
}

async function gptImage2EditDmxapi(
  baseUrl: string, apiKey: string,
  prompt: string, size: string, quality: string,
  refs: EditReference[],
  model = 'gpt-image-2',
): Promise<{ b64?: string; url?: string }> {
  const { writeBinaryFile, createDir } = await import('@tauri-apps/api/fs');
  const { homeDir } = await import('@tauri-apps/api/path');
  const home = await homeDir();
  const tmpDir = `${home}.kunpeng/tmp`;
  await createDir(tmpDir, { recursive: true }).catch(() => {});
  const tmpPaths: string[] = [];
  for (const [i, ref] of refs.entries()) {
    const tmpPath = `${tmpDir}/ref-${Date.now()}-${i}.${ref.ext || 'png'}`;
    await writeBinaryFile(tmpPath, ref.binary);
    tmpPaths.push(tmpPath);
  }

  const args = [
    '-s', '--max-time', '300',
    '-X', 'POST', `${baseUrl}/v1/images/edits`,
    '-F', `model=${model}`,
    '-F', `prompt=${prompt}`,
    '-F', 'n=1',
    '-F', `size=${size}`,
    '-F', `quality=${quality}`,
  ];
  for (const [i, ref] of refs.entries()) {
    args.push('-F', `image=@${tmpPaths[i]};type=${ref.mime || 'image/png'}`);
  }
  console.log(`🖼️ [dmxapi] multipart image 字段: ${refs.length} 张`);
  const result = await runCurlWithAuthKey(args, apiKey);

  import('@tauri-apps/api/fs').then(fs => tmpPaths.forEach(p => fs.removeFile(p).catch(() => {})));

  if (result.code !== 0 || !result.stdout.trim()) {
    const errMsg = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`;
    throw new PaidSubmissionUnknownError('DMXAPI GPT Image 2 编辑', errMsg.slice(0, 300));
  }

  let data: any;
  try { data = JSON.parse(result.stdout); } catch { throw new PaidSubmissionUnknownError('DMXAPI GPT Image 2 编辑', `非 JSON 响应：${result.stdout.slice(0, 200)}`); }
  if (data.error) throw new Error(`dmxapi edit: ${data.error.message || JSON.stringify(data.error)}`);
  const item = data?.data?.[0];
  if (!item?.b64_json && !item?.url) throw new PaidSubmissionUnknownError('DMXAPI GPT Image 2 编辑', '成功响应没有可用图片');
  return { b64: item.b64_json, url: item.url };
}

// ── GPT Image 2 Edit: aihubmix ──────────────────────────────────────────
// curl multipart form-data，不带 quality

async function gptImage2EditAihubmix(
  baseUrl: string, apiKey: string,
  prompt: string, size: string,
  refs: EditReference[],
  model = 'gpt-image-2',
): Promise<{ b64?: string; url?: string }> {
  const { writeBinaryFile, createDir } = await import('@tauri-apps/api/fs');
  const { homeDir } = await import('@tauri-apps/api/path');
  const home = await homeDir();
  const tmpDir = `${home}.kunpeng/tmp`;
  await createDir(tmpDir, { recursive: true }).catch(() => {});
  const tmpPaths: string[] = [];
  for (const [i, ref] of refs.entries()) {
    const tmpPath = `${tmpDir}/ref-${Date.now()}-${i}.${ref.ext || 'png'}`;
    await writeBinaryFile(tmpPath, ref.binary);
    tmpPaths.push(tmpPath);
  }

  const args = [
    '-s', '--max-time', '300',
    '-X', 'POST', `${baseUrl}/v1/images/edits`,
    '-F', `model=${model}`,
    '-F', `prompt=${prompt}`,
    '-F', 'n=1',
    '-F', `size=${size}`,
  ];
  for (const [i, ref] of refs.entries()) {
    const field = refs.length > 1 ? 'image[]' : 'image';
    args.push('-F', `${field}=@${tmpPaths[i]};type=${ref.mime || 'image/png'}`);
  }
  console.log(`🖼️ [aihubmix] multipart ${refs.length > 1 ? 'image[]' : 'image'} 字段: ${refs.length} 张`);
  const result = await runCurlWithAuthKey(args, apiKey);

  import('@tauri-apps/api/fs').then(fs => tmpPaths.forEach(p => fs.removeFile(p).catch(() => {})));

  if (result.code !== 0 || !result.stdout.trim()) {
    const errMsg = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`;
    throw new PaidSubmissionUnknownError('AiHubMix GPT Image 2 编辑', errMsg.slice(0, 300));
  }

  let data: any;
  try { data = JSON.parse(result.stdout); } catch { throw new PaidSubmissionUnknownError('AiHubMix GPT Image 2 编辑', `非 JSON 响应：${result.stdout.slice(0, 200)}`); }
  if (data.error) throw new Error(`aihubmix edit: ${data.error.message || JSON.stringify(data.error)}`);
  const item = data?.data?.[0];
  if (!item?.b64_json && !item?.url) throw new PaidSubmissionUnknownError('AiHubMix GPT Image 2 编辑', '成功响应没有可用图片');
  return { b64: item.b64_json, url: item.url };
}

// ── Gemini ────────────────────────────────────────────────────────────────

async function geminiGen(
  baseUrl: string, apiKey: string, model: string,
  prompt: string, aspectRatio: string, referenceB64?: string,
): Promise<{ b64: string }> {
  const parts: any[] = [{ text: prompt }];
  if (referenceB64) {
    const raw = referenceB64.includes(',') ? referenceB64.split(',')[1] : referenceB64;
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: raw } });
  }

  const resp = await paidSubmit(model, () => fetch(`${baseUrl}/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: {
      type: 'Json',
      payload: {
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ['Text', 'Image'],
          imageConfig: { aspectRatio },
        },
      },
    },
    responseType: ResponseType.JSON,
    timeout: 300,
  }));
  if (!resp.ok) {
    if (isAmbiguousPaidSubmitStatus(resp.status)) throw new PaidSubmissionUnknownError(model, `HTTP ${resp.status}`);
    throw new Error(`${model}: ${resp.status} ${JSON.stringify(resp.data)}`);
  }
  const candidate = (resp.data as any)?.candidates?.[0];
  for (const part of candidate?.content?.parts || []) {
    if (part.inlineData?.data) return { b64: part.inlineData.data };
  }
  throw new PaidSubmissionUnknownError(model, '成功响应没有可用图片');
}

// ── 保存图片 ──────────────────────────────────────────────────────────────

async function saveImage(b64OrUrl: { b64?: string; url?: string }, outputPath: string): Promise<string> {
  let bytes: Uint8Array;
  if (b64OrUrl.b64) {
    bytes = Uint8Array.from(atob(b64OrUrl.b64), c => c.charCodeAt(0));
  } else if (b64OrUrl.url) {
    const resp = await fetch(b64OrUrl.url, { method: 'GET', responseType: ResponseType.Binary, timeout: 120 });
    bytes = new Uint8Array(resp.data as ArrayBuffer);
  } else {
    throw new Error('无图片数据');
  }
  await writeBinaryFile(outputPath, bytes);
  return outputPath;
}

// ── 主入口 ───────────────────────────────────────────────────────────────

async function tryGenerate(
  params: GenerateImageParams,
  slots: ImageApiSlot[],
  outputPath: string,
  model: string,
  requestSize: string,
  compress: boolean,
  errors: string[],
): Promise<ImageResult | null> {
  const hasRef = !!(params.referenceImageUrls?.length || params.referenceImageUrl || params.referenceImageB64);
  const t0 = Date.now();
  let lastError = '';

  for (const slot of slots) {
    let baseUrl = slot.baseUrl.replace(/\/+$/, '');
    // aihubmix.com 大陆不可达，自动替换为备用域名
    if (baseUrl.includes('aihubmix.com')) {
      baseUrl = baseUrl.replace('aihubmix.com', 'api.inferera.com');
    }
    const apiKey = resolveSlotApiKey(useSettingsStore.getState(), slot);
    const provider = slot.provider || 'dmxapi';
    let paidResultReceived = false;

    try {
      const t1 = Date.now();
      let result: { b64?: string; url?: string } = undefined!;

      if (model === 'gpt-image-2') {
        if (slot.id === APIMART_GPT_IMAGE2_SLOT_ID) {
          const editRefs = hasRef ? await getEditReferences(params, compress) : [];
          console.log(`🎨 [${slot.label}] 尝试 gpt-image-2 async (apimart)${compress ? ' [压缩重试]' : ''}...`);
          result = await gptImage2ApimartGen(params, editRefs);
        } else {
        const tier = params.forceTier ?? slot.tier ?? 'standard';
        if (provider === 'zexapi') {
          const editRefs = hasRef ? await getEditReferences(params, compress) : [];
          console.log(`🎨 [${slot.label}] 尝试 gpt-image-2 async (zexapi)${compress ? ' [压缩重试]' : ''}...`);
          result = await gptImage2ZexapiAsync(baseUrl, apiKey, params.prompt, requestSize, params.aspectRatio, editRefs);
        } else {
          const modelsToTry = provider === 'dmxapi'
            ? (tier === 'cheap' ? ['gpt-image-2-03'] as const : ['gpt-image-2'] as const)
            : ['gpt-image-2'] as const;

          let editRefs: EditReference[] = [];
          if (hasRef) {
            editRefs = await getEditReferences(params, compress);
          }

          let subErr = '';
          let tried = false;
          for (const m of modelsToTry) {
            tried = true;
            try {
              console.log(`🎨 [${slot.label}] 尝试 ${m} (${provider})${compress ? ' [压缩重试]' : ''}...`);
              if (hasRef && editRefs.length > 0) {
                if (provider === 'aihubmix') {
                  result = await gptImage2EditAihubmix(baseUrl, apiKey, params.prompt, requestSize, editRefs, m);
                } else {
                  result = await gptImage2EditDmxapi(baseUrl, apiKey, params.prompt, requestSize, params.quality || 'high', editRefs, m);
                }
              } else {
                result = await gptImage2Gen(baseUrl, apiKey, params.prompt, requestSize, params.quality || 'high', m);
              }
              break;
            } catch (e) {
              if (shouldStopAutomaticPaidFallback(e, 'image')) throw e;
              subErr = `${m}: ${e instanceof Error ? e.message : String(e)}`;
              console.warn(`⚠️ [${slot.label}] ${subErr}`);
              result = undefined!;
            }
          }
          if (!tried || !result) {
            throw new Error(subErr || 'no model tried');
          }
        }
        }
      } else if (model === 'seedream-v5-pro') {
        const isApimart = slot.id === APIMART_SEEDREAM_SLOT_ID;
        if (provider !== 'dmxapi' && !isApimart) {
          throw new Error(`Seedream 5 Pro 兼容 API 当前仅支持 DMXAPI，当前通道为 ${provider}`);
        }
        const editRefs = hasRef ? await getEditReferences(params, compress) : [];
        if (editRefs.length > 10) {
          throw new Error(`Seedream 5 Pro 最多支持 10 张参考图，当前 ${editRefs.length} 张`);
        }
        const seedreamSize = normalizeSeedreamProSize(params.size, params.aspectRatio, params.resolution);
        console.log(`🎨 [${slot.label}] 尝试 Seedream 5 Pro (${provider}) ${seedreamSize}${compress ? ' [压缩重试]' : ''}...`);
        result = isApimart
          ? await seedreamProApimartGen(params, editRefs)
          : await seedreamProDmxapiGen(baseUrl, apiKey, params.prompt, seedreamSize, editRefs);
      } else if (model.startsWith('gemini')) {
        let geminiRef = params.referenceImageB64;
        if (!geminiRef && params.referenceImageUrl) {
          try {
            const resolved = assetUrlToLocalPath(params.referenceImageUrl);
            let bytes: Uint8Array;
            if (resolved !== params.referenceImageUrl || (!params.referenceImageUrl.startsWith('http://') && !params.referenceImageUrl.startsWith('https://'))) {
              bytes = new Uint8Array(await readBinaryFile(resolved));
            } else {
              const resp = await fetch(params.referenceImageUrl, { method: 'GET', responseType: ResponseType.Binary, timeout: 60 });
              bytes = new Uint8Array(resp.data as ArrayBuffer);
            }
            if (compress) bytes = await compressImage(bytes, 1536, 0.85);
            let bin = '';
            const CHUNK = 8192;
            for (let i = 0; i < bytes.length; i += CHUNK) {
              bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
            }
            geminiRef = btoa(bin);
          } catch (err) {
            console.warn('[Gemini] 参考图处理失败:', err);
          }
        }
        result = await geminiGen(baseUrl, apiKey, model, params.prompt, params.aspectRatio || '16:9', geminiRef);
      } else {
        continue;
      }

      paidResultReceived = true;
      const savedPath = await saveImage(result, outputPath);
      const displayUrl = convertFileSrc(savedPath);
      console.log(`✅ [${slot.label}] ${model} 生成成功，耗时 ${((Date.now() - t1) / 1000).toFixed(1)}s`);
      return { success: true, imagePath: savedPath, imageUrl: displayUrl, modelUsed: model, apiUsed: slot.label };
    } catch (err) {
      if (shouldStopAutomaticPaidFallback(err, 'image')) throw err;
      if (paidResultReceived) {
        lastError = `[${slot.label}] ${model}: 生成结果已返回但本地保存失败：${err instanceof Error ? err.message : String(err)}`;
        errors.push(lastError);
        console.warn(`⚠️ ${lastError}；按图片容灾策略继续尝试备用通道`);
        continue;
      }
      lastError = `[${slot.label}] ${model}: ${err instanceof Error ? err.message : String(err)}`;
      errors.push(lastError);
      console.warn(`⚠️ ${lastError}（耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s）`);
    }
  }

  return null;
}

export async function generateImage(params: GenerateImageParams): Promise<ImageResult> {
  const hasRef = !!(params.referenceImageUrls?.length || params.referenceImageUrl || params.referenceImageB64);
  const model = params.model || 'gpt-image-2';
  const slots = getSlots(params, model);
  if (slots.length === 0) {
    return { success: false, modelUsed: '', apiUsed: '', error: '未配置生图 API 端点，请在设置 → API 密钥 → 生图 API 中添加' };
  }

  const outputPath = params.outputPath || await getOutputPath();
  const requestSize = model === 'gpt-image-2'
    ? normalizeGptImage2Size(params.size, params.aspectRatio)
    : model === 'seedream-v5-pro'
      ? normalizeSeedreamProSize(params.size, params.aspectRatio, params.resolution)
      : (params.size || 'auto');
  const errors: string[] = [];

  const result = await tryGenerate(params, slots, outputPath, model, requestSize, false, errors);
  if (result) return result;

  if (hasRef) {
    console.log('📐 所有端点原图均失败，压缩参考图后重试...');
    const retryResult = await tryGenerate(params, slots, outputPath, model, requestSize, true, errors);
    if (retryResult) return retryResult;
  }

  const uniqueErrors = Array.from(new Set(errors));
  return {
    success: false,
    modelUsed: '',
    apiUsed: '',
    error: uniqueErrors.length > 0
      ? uniqueErrors.join('；')
      : '所有端点均失败（含压缩重试）',
  };
}
