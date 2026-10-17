import { Body, fetch as tauriFetch, ResponseType } from '@tauri-apps/api/http';
import { getWebFetchTimeoutMs } from '@/lib/timeouts';

export const DEEPSEEK_WEB_API_BASE = 'https://api.deepseek.com/v1/tools';

export interface DeepSeekSearchSource {
  url: string;
  title?: string;
  snippet?: string;
  publishedAt?: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonBody(data: unknown): unknown {
  if (typeof data !== 'string') return data;
  try { return JSON.parse(data); } catch { throw new Error('DeepSeek Web API 返回了无效 JSON'); }
}

function errorDetail(data: unknown): string {
  const payload = (() => { try { return parseJsonBody(data); } catch { return undefined; } })();
  if (!record(payload)) return '';
  if (typeof payload.message === 'string') return payload.message;
  if (typeof payload.error === 'string') return payload.error;
  if (record(payload.error) && typeof payload.error.message === 'string') return payload.error.message;
  return '';
}

export function parseDeepSeekSearchResponse(payload: unknown): DeepSeekSearchSource[] {
  if (!record(payload) || !Array.isArray(payload.results)) throw new Error('DeepSeek Search API 返回结构无效');
  return payload.results.map((item) => {
    if (!record(item) || typeof item.url !== 'string' || !item.url
      || typeof item.title !== 'string' || typeof item.snippet !== 'string'
      || (item.date !== null && item.date !== undefined && typeof item.date !== 'string')) {
      throw new Error('DeepSeek Search API 返回结构无效');
    }
    return {
      url: item.url,
      ...(item.title ? { title: item.title } : {}),
      ...(item.snippet ? { snippet: item.snippet } : {}),
      ...(typeof item.date === 'string' && item.date ? { publishedAt: item.date } : {}),
    };
  });
}

async function post(path: 'search' | 'fetch', apiKey: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await tauriFetch(`${DEEPSEEK_WEB_API_BASE}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: Body.json(body),
    responseType: ResponseType.Text,
    timeout: Math.ceil(getWebFetchTimeoutMs() / 1000),
  });
  if (!response.ok) {
    const detail = errorDetail(response.data);
    throw new Error(`DeepSeek ${path} HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  return parseJsonBody(response.data);
}

export async function deepSeekWebSearch(input: {
  apiKey: string;
  query: string;
  count?: number;
  originalQuestion?: string;
}): Promise<DeepSeekSearchSource[]> {
  const originalQuestion = Array.from((input.originalQuestion ?? '').replace(/\s+/g, ' ').trim()).slice(0, 128).join('');
  const payload = await post('search', input.apiKey, {
    query: input.query,
    count: Math.max(1, Math.min(Math.floor(input.count ?? 8), 50)),
    need_content: false,
    ...(originalQuestion ? { ori_question: originalQuestion } : {}),
  });
  return parseDeepSeekSearchResponse(payload);
}

export async function deepSeekWebFetch(apiKey: string, url: string): Promise<string> {
  const payload = await post('fetch', apiKey, { url });
  if (!record(payload) || typeof payload.content !== 'string') throw new Error('DeepSeek Fetch API 返回结构无效');
  return payload.content;
}
