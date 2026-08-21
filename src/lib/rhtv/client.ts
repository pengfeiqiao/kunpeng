/**
 * rhtv client — submit / query / accountStatus against the RunningHub
 * Standard Model API, via the Tauri HTTP plugin (allowlist already permits
 * https://**; no CORS in the WebView this way).
 *
 * Error model:
 *   - RhtvBusinessError  → auth / balance / task-rejected / bad request.
 *     NEVER retried (matches the official plugin's retry policy).
 *   - create-task transport/ambiguous response → RhtvSubmissionUnknownError.
 *     Create POSTs are never retried automatically because the provider may
 *     already have accepted and charged the task.
 *   - query transport errors may be retried because querying cannot create a
 *     second paid task.
 */
import { fetch as tauriFetch, ResponseType, Body } from '@tauri-apps/api/http';
import { useSettingsStore } from '@/stores/settingsStore';
import { resolveApiKey } from '@/lib/credentials';
import { withRetry } from '@/lib/agent/withRetry';
import {
  RhtvBusinessError,
  RhtvSubmissionUnknownError,
  type RhtvParams,
  type RhtvQueryResponse,
  type RhtvSubmitResponse,
} from './types';

export const RHTV_BASE = 'https://www.runninghub.cn/openapi/v2';
const ACCOUNT_STATUS_URL = 'https://www.runninghub.cn/uc/openapi/accountStatus';
const APP_SUBMIT_URL = 'https://www.runninghub.cn/task/openapi/ai-app/run';

export function getRhtvApiKey(): string {
  const s = useSettingsStore.getState();
  return resolveApiKey(s, 'runninghub', s.runninghubApiKey).trim();
}

export function requireRhtvApiKey(): string {
  const key = getRhtvApiKey();
  if (!key) {
    throw new RhtvBusinessError(
      'auth',
      '未配置 RunningHub API Key，请在「设置」中填写',
    );
  }
  return key;
}

function classifyErrorBody(status: number, bodyText: string): Error {
  let code = '';
  let msg = bodyText;
  try {
    const parsed = JSON.parse(bodyText) as { code?: string | number; msg?: string; errorMessage?: string };
    code = String(parsed.code ?? '');
    msg = parsed.msg || parsed.errorMessage || bodyText;
  } catch { /* keep raw text */ }

  const haystack = `${code} ${msg}`.toLowerCase();
  if (status === 401 || status === 403 || /auth|token|key/.test(haystack)) {
    return new RhtvBusinessError('auth', `RunningHub 认证失败: ${msg.slice(0, 200)}`);
  }
  if (/balance|insufficient|余额|credit/.test(haystack)) {
    return new RhtvBusinessError('balance', `RunningHub 余额不足: ${msg.slice(0, 200)}`);
  }
  if (status >= 400 && status < 500 && status !== 429 && status !== 408) {
    return new RhtvBusinessError('bad_request', `RunningHub 请求被拒绝 (${status}): ${msg.slice(0, 300)}`);
  }
  // Transport-level — let withRetry decide via .status
  const err = new Error(`RunningHub HTTP ${status}: ${msg.slice(0, 300)}`) as Error & { status: number };
  err.status = status;
  return err;
}

async function postJson<T>(url: string, payload: unknown, timeoutSec = 60): Promise<T> {
  const key = requireRhtvApiKey();
  const res = await tauriFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: Body.json(payload as Record<string, unknown>),
    responseType: ResponseType.Text,
    timeout: timeoutSec,
  });
  if (!res.ok) {
    throw classifyErrorBody(res.status, String(res.data ?? ''));
  }
  try {
    return JSON.parse(res.data as string) as T;
  } catch {
    throw new Error(`RunningHub 返回非 JSON: ${String(res.data).slice(0, 200)}`);
  }
}

function normalizeSubmitReceipt(resp: RhtvSubmitResponse, label: string): RhtvSubmitResponse {
  const normalized: RhtvSubmitResponse = {
    ...resp,
    taskId: resp.taskId ?? resp.data?.taskId,
    status: resp.status ?? resp.data?.taskStatus,
    results: resp.results ?? resp.data?.results,
  };
  const status = String(normalized.status ?? '').toUpperCase();
  const code = resp.code === undefined ? '' : String(resp.code);
  const detail = resp.msg || resp.errorMessage || JSON.stringify(resp).slice(0, 300);
  if (status === 'FAILED') {
    throw new RhtvBusinessError('task_failed', `${label}任务创建失败：${detail}`);
  }
  if (code && code !== '0' && code.toUpperCase() !== 'SUCCESS' && !normalized.taskId && !normalized.results?.length) {
    throw new RhtvBusinessError('bad_request', `${label}请求被拒绝：${detail}`);
  }
  if (!normalized.taskId && !normalized.results?.length) {
    throw new RhtvSubmissionUnknownError(
      `${label}返回成功响应但没有 taskId 或产物，为避免重复扣费未自动重试：${detail}`,
    );
  }
  return normalized;
}

/**
 * Submit a generation task. Returns the raw response — caller checks for an
 * immediate SUCCESS (some fast endpoints return results inline) or polls
 * with the taskId.
 *
 * This create call is deliberately single-attempt. Only later status queries
 * use retry/backoff.
 */
export async function rhtvSubmit(
  endpoint: string,
  params: RhtvParams,
  signal?: AbortSignal,
): Promise<RhtvSubmitResponse> {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  try {
    const resp = await postJson<RhtvSubmitResponse>(`${RHTV_BASE}/${endpoint}`, params, 120);
    return normalizeSubmitReceipt(resp, 'RunningHub');
  } catch (err) {
    if (err instanceof RhtvBusinessError) throw err;
    throw new RhtvSubmissionUnknownError(
      `RunningHub 提交结果未知，为避免重复扣费未自动重试：${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export interface RhtvAppNodeInfo {
  nodeId: string;
  fieldName: string;
  fieldValue: string;
}

/**
 * Submit via the AI-application wrapper API (compliance path for overseas
 * engines). Body format differs: apiKey in body, webappId + nodeInfoList.
 * Query/poll uses the same rhtvQuery endpoint.
 */
export async function rhtvSubmitApp(
  webappId: string,
  nodeInfoList: RhtvAppNodeInfo[],
  signal?: AbortSignal,
): Promise<RhtvSubmitResponse> {
  const key = requireRhtvApiKey();
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  try {
      const resp = await postJson<RhtvSubmitResponse>(APP_SUBMIT_URL, {
        apiKey: key,
        // RunningHub webappId is a 19-digit integer. Sending it as a JS Number
        // rounds the value past MAX_SAFE_INTEGER and makes valid apps look
        // nonexistent ("webapp not exists"). Keep the exact string in JSON.
        webappId,
        nodeInfoList,
      }, 120);
      const code = resp.code === undefined ? '' : String(resp.code);
      const msg = resp.msg || resp.errorMessage || '';
      const rejected = code && code !== '0' && code.toUpperCase() !== 'SUCCESS';
      if (rejected && !resp.taskId && !resp.results?.length) {
        const detail = msg || JSON.stringify(resp).slice(0, 200);
        if (/webapp not exists/i.test(detail)) {
          throw new RhtvBusinessError(
            'bad_request',
            `RunningHub AI 应用不可访问：webappId=${webappId}。请确认该应用已发布、当前 API Key 所属账号有权限，且提交时没有把 19 位 webappId 转成 Number。`,
          );
        }
        throw new RhtvBusinessError('bad_request', `RunningHub AI 应用请求被拒绝：${detail.slice(0, 300)}`);
      }
      return normalizeSubmitReceipt({
        ...resp,
        taskId: resp.taskId ?? resp.data?.taskId,
        status: resp.status ?? resp.data?.taskStatus,
        results: resp.results ?? resp.data?.results,
      }, 'RunningHub AI 应用');
  } catch (err) {
    if (err instanceof RhtvBusinessError) throw err;
    throw new RhtvSubmissionUnknownError(
      `RunningHub AI 应用提交结果未知，为避免重复扣费未自动重试：${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Single status query for a task. */
export async function rhtvQuery(
  taskId: string,
  signal?: AbortSignal,
): Promise<RhtvQueryResponse> {
  return withRetry(
    async () => {
      const resp = await postJson<RhtvQueryResponse>(`${RHTV_BASE}/query`, { taskId }, 30);
      return {
        ...resp,
        taskId: resp.taskId ?? resp.data?.taskId ?? taskId,
        status: resp.status ?? resp.data?.taskStatus ?? resp.data?.status,
        results: resp.results ?? resp.data?.results,
        errorMessage: resp.errorMessage ?? resp.data?.errorMessage,
        errorCode: resp.errorCode ?? resp.data?.errorCode,
        failedReason: resp.failedReason ?? resp.data?.failedReason,
      };
    },
    { source: 'background', signal, maxRetries: 3 },
  );
}

export interface RhtvAccountStatus {
  remainCoins?: string | number;
  currentTaskCounts?: string | number;
  [k: string]: unknown;
}

/** Account health: balance + concurrent task count (for local queueing). */
export async function rhtvAccountStatus(): Promise<RhtvAccountStatus> {
  const key = requireRhtvApiKey();
  const res = await tauriFetch(ACCOUNT_STATUS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: Body.json({ apikey: key }),
    responseType: ResponseType.Text,
    timeout: 15,
  });
  if (!res.ok) throw classifyErrorBody(res.status, String(res.data ?? ''));
  const parsed = JSON.parse(res.data as string) as { code?: number; data?: RhtvAccountStatus };
  return parsed.data ?? {};
}
