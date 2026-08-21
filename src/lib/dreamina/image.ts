import { createDir, removeFile, writeBinaryFile } from '@tauri-apps/api/fs';
import { fetch, ResponseType } from '@tauri-apps/api/http';
import { homeDir } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/tauri';
import { assetUrlToLocalPath } from '@/lib/rhtv/upload';
import { dispatchSystemRepairPrompt, dreaminaLoginRepairPrompt } from '@/lib/agent/systemRepair';
import { PaidSubmissionUnknownError, PaidTaskCreatedError } from '@/lib/billingSafety';

export interface CommandResult {
  stdout: string;
  stderr: string;
  exit_code: number;
}

interface DreaminaResultImage {
  path?: string;
  url?: string;
}

export interface DreaminaResponse {
  submit_id?: string;
  gen_status?: string;
  fail_reason?: string;
  error?: string | { message?: string };
  result_json?: {
    images?: DreaminaResultImage[];
  };
}

export interface DreaminaSeedreamRequest {
  prompt: string;
  referenceUrls?: string[];
  aspectRatio?: string;
  resolution?: string;
  signal?: AbortSignal;
  onProgress?: (progress: string) => void;
  taskContext?: string;
  onSubmitted?: (submitId: string) => void;
}

export interface DreaminaSeedreamResult {
  submitId: string;
  paths: string[];
  urls: string[];
}

export class DreaminaLoginRequiredError extends Error {
  readonly code = 'DREAMINA_LOGIN_REQUIRED';

  constructor(message = '即梦尚未登录，需要先完成登录') {
    super(message);
    this.name = 'DreaminaLoginRequiredError';
  }
}

export class DreaminaTaskPendingError extends Error {
  readonly code = 'DREAMINA_TASK_PENDING';

  constructor(readonly submitId: string) {
    super('即梦任务仍在生成，鲲鹏会在后台继续查询');
    this.name = 'DreaminaTaskPendingError';
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function parseJsonOutput(stdout: string): DreaminaResponse {
  const trimmed = stdout.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed) as DreaminaResponse;
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as DreaminaResponse;
      } catch {
        // The caller will surface the original output.
      }
    }
    return {};
  }
}

export function responseError(response: DreaminaResponse, fallback: string): string {
  if (typeof response.error === 'string') return response.error;
  if (response.error?.message) return response.error.message;
  return response.fail_reason || fallback;
}

export function looksLikeLoginFailure(value: string): boolean {
  return /(?:not\s+logged|login\s+required|unauthorized|credential|oauth|token.*(?:expired|invalid)|未登录|登录失效|请.*登录|凭证.*(?:失效|过期))/i.test(value);
}

async function dreaminaBinary(): Promise<string> {
  const home = (await homeDir()).replace(/\/$/, '');
  return `${home}/.local/bin/dreamina`;
}

export async function executeDreamina(
  args: string[],
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<CommandResult> {
  const requestId = `dreamina-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const binary = await dreaminaBinary();
  const command = [shellQuote(binary), ...args.map(shellQuote)].join(' ');
  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const onAbort = () => {
    void invoke('kill_command', { requestId }).catch(() => {});
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await invoke<CommandResult>('execute_command', {
      command,
      timeoutMs: options.timeoutMs ?? 30_000,
      requestId,
    });
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
  }
}

export function requestAgentLogin(reason: string, taskContext?: string): never {
  dispatchSystemRepairPrompt(dreaminaLoginRepairPrompt(reason, taskContext));
  throw new DreaminaLoginRequiredError('即梦登录已交给 Agent 处理，完成后可重试原任务');
}

export async function ensureDreaminaLogin(taskContext?: string): Promise<void> {
  let result: CommandResult;
  try {
    result = await executeDreamina(['user_credit'], { timeoutMs: 20_000 });
  } catch (error) {
    requestAgentLogin(error instanceof Error ? error.message : String(error), taskContext);
  }
  const combined = `${result.stdout}\n${result.stderr}`.trim();
  const parsed = parseJsonOutput(result.stdout);
  const rawCredit = (parsed as Record<string, unknown>).total_credit;
  const credit = typeof rawCredit === 'number' ? rawCredit : Number(rawCredit);
  if (result.exit_code !== 0 || looksLikeLoginFailure(combined) || !Number.isFinite(credit)) {
    requestAgentLogin(combined || '无法读取即梦登录状态', taskContext);
  }
  if (credit <= 0) {
    throw new Error('即梦当前积分不足，继续尝试备用 Seedream API');
  }
}

function extensionForReference(url: string): string {
  const clean = url.split(/[?#]/, 1)[0];
  const match = clean.match(/\.([a-z0-9]{2,5})$/i);
  if (match && /^(png|jpe?g|webp|gif|bmp|heic)$/i.test(match[1])) return match[1].toLowerCase();
  if (url.startsWith('data:image/jpeg')) return 'jpg';
  if (url.startsWith('data:image/webp')) return 'webp';
  return 'png';
}

async function materializeReference(url: string, index: number, tempDir: string): Promise<{ path: string; temporary: boolean }> {
  const local = assetUrlToLocalPath(url);
  if (local !== url || (!/^https?:\/\//i.test(url) && !url.startsWith('data:'))) {
    return { path: local.replace(/^file:\/\//, ''), temporary: false };
  }
  const path = `${tempDir}/ref-${Date.now()}-${index}.${extensionForReference(url)}`;
  let bytes: Uint8Array;
  if (url.startsWith('data:')) {
    const encoded = url.slice(url.indexOf(',') + 1);
    bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  } else {
    const response = await fetch(url, { method: 'GET', responseType: ResponseType.Binary, timeout: 90 });
    if (!response.ok) throw new Error(`下载即梦参考图失败: HTTP ${response.status}`);
    bytes = new Uint8Array(response.data as ArrayBuffer);
  }
  await writeBinaryFile(path, bytes);
  return { path, temporary: true };
}

function normalizedRatio(value?: string): string {
  const ratio = String(value || '16:9');
  return ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16'].includes(ratio) ? ratio : '16:9';
}

function normalizedResolution(value?: string): string {
  const resolution = String(value || '2k').toLowerCase();
  return ['1k', '2k', '4k'].includes(resolution) ? resolution : '2k';
}

function resultPaths(response: DreaminaResponse): string[] {
  return (response.result_json?.images ?? []).map((image) => image.path).filter((path): path is string => Boolean(path));
}

function resultUrls(response: DreaminaResponse): string[] {
  return (response.result_json?.images ?? []).map((image) => image.url).filter((url): url is string => Boolean(url));
}

async function queryUntilComplete(
  submitId: string,
  downloadDir: string,
  signal?: AbortSignal,
  onProgress?: (progress: string) => void,
  taskContext?: string,
): Promise<DreaminaResponse> {
  const started = Date.now();
  const maxMs = 5 * 60_000;
  while (Date.now() - started < maxMs) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const result = await executeDreamina(
      ['query_result', `--submit_id=${submitId}`, `--download_dir=${downloadDir}`],
      { timeoutMs: 90_000, signal },
    );
    const combined = `${result.stdout}\n${result.stderr}`.trim();
    if (looksLikeLoginFailure(combined)) requestAgentLogin(combined, taskContext);
    const response = parseJsonOutput(result.stdout);
    const status = String(response.gen_status || '').toLowerCase();
    if (status === 'success') return response;
    if (status === 'fail' || result.exit_code !== 0) {
      throw new Error(responseError(response, combined || `即梦查询失败（${result.exit_code}）`));
    }
    onProgress?.(`即梦生成中 · ${Math.round((Date.now() - started) / 1000)}s`);
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  throw new DreaminaTaskPendingError(submitId);
}

export async function queryDreaminaSeedreamTask(
  submitId: string,
  options: { signal?: AbortSignal; taskContext?: string } = {},
): Promise<{ status: 'running' | 'succeeded' | 'failed'; paths: string[]; urls: string[]; error?: string }> {
  await ensureDreaminaLogin(options.taskContext);
  const workspace = await invoke<string>('ensure_workspace');
  const outputDir = `${workspace}/images`;
  await createDir(outputDir, { recursive: true });
  const result = await executeDreamina(
    ['query_result', `--submit_id=${submitId}`, `--download_dir=${outputDir}`],
    { timeoutMs: 90_000, signal: options.signal },
  );
  const combined = `${result.stdout}\n${result.stderr}`.trim();
  if (looksLikeLoginFailure(combined)) requestAgentLogin(combined, options.taskContext);
  const response = parseJsonOutput(result.stdout);
  const status = String(response.gen_status || '').toLowerCase();
  if (status === 'success') {
    const paths = resultPaths(response);
    return paths.length > 0
      ? { status: 'succeeded', paths, urls: resultUrls(response) }
      : { status: 'failed', paths: [], urls: [], error: '即梦任务成功，但没有下载到本地图片' };
  }
  if (status === 'fail' || result.exit_code !== 0) {
    return { status: 'failed', paths: [], urls: [], error: responseError(response, combined || '即梦任务失败') };
  }
  return { status: 'running', paths: [], urls: [] };
}

export async function generateSeedreamWithDreamina(request: DreaminaSeedreamRequest): Promise<DreaminaSeedreamResult> {
  await ensureDreaminaLogin(request.taskContext);
  const workspace = await invoke<string>('ensure_workspace');
  const outputDir = `${workspace}/images`;
  const tempDir = `${workspace}/tmp/dreamina`;
  await createDir(outputDir, { recursive: true });
  await createDir(tempDir, { recursive: true });

  const refs = request.referenceUrls ?? [];
  if (refs.length > 10) {
    throw new Error(`即梦 Seedream 5.0 Pro 最多支持 10 张参考图，当前传入 ${refs.length} 张`);
  }
  const materialized = await Promise.all(refs.map((url, index) => materializeReference(url, index, tempDir)));
  const command = refs.length > 0 ? 'image2image' : 'text2image';
  const args = [
    command,
    `--prompt=${request.prompt}`,
    '--model_version=5.0Pro',
    `--ratio=${normalizedRatio(request.aspectRatio)}`,
    `--resolution_type=${normalizedResolution(request.resolution)}`,
    '--generate_num=1',
    '--poll=2',
  ];
  if (materialized.length > 0) {
    for (const item of materialized) args.push(`--images=${item.path}`);
  }

  try {
    request.onProgress?.('提交即梦 Seedream 5.0 Pro…');
    let submitted: CommandResult;
    try {
      submitted = await executeDreamina(args, { timeoutMs: 45_000, signal: request.signal });
    } catch (err) {
      if (request.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      throw new PaidSubmissionUnknownError('即梦 Seedream 5.0 Pro', err instanceof Error ? err.message : String(err));
    }
    const combined = `${submitted.stdout}\n${submitted.stderr}`.trim();
    if (looksLikeLoginFailure(combined)) requestAgentLogin(combined, request.taskContext);
    const response = parseJsonOutput(submitted.stdout);
    if (/AigcComplianceConfirmationRequired/i.test(combined)) {
      throw new Error('即梦需要先在网页完成一次 AI 创作合规确认，然后重试');
    }
    if (submitted.exit_code !== 0 || String(response.gen_status).toLowerCase() === 'fail') {
      throw new Error(responseError(response, combined || `即梦提交失败（${submitted.exit_code}）`));
    }
    const submitId = response.submit_id;
    if (!submitId) throw new PaidSubmissionUnknownError('即梦 Seedream 5.0 Pro', `成功响应未返回 submit_id：${combined.slice(0, 300)}`);
    request.onSubmitted?.(submitId);
    try {
      const completed = resultPaths(response).length > 0
        ? response
        : await queryUntilComplete(submitId, outputDir, request.signal, request.onProgress, request.taskContext);
      const paths = resultPaths(completed);
      if (paths.length === 0) throw new Error('生成成功，但没有下载到本地图片');
      return { submitId, paths, urls: resultUrls(completed) };
    } catch (err) {
      if (err instanceof DreaminaTaskPendingError) throw err;
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      throw new PaidTaskCreatedError('即梦 Seedream 5.0 Pro', submitId, err instanceof Error ? err.message : String(err));
    }
  } finally {
    for (const item of materialized) {
      if (item.temporary) void removeFile(item.path).catch(() => {});
    }
  }
}
