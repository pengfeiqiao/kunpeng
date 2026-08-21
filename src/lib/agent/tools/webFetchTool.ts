/**
 * web_fetch — fetch a URL and return its text (HTML → rough markdown).
 *
 * Uses Tauri's HTTP client (not browser fetch) so we can hit any origin
 * without CORS. Timeout from `src/lib/timeouts.ts` (default 30s). Size is
 * capped at 2MB — anything larger is truncated with a note.
 *
 * HTML → markdown is intentionally crude: strip <script>/<style>, unwrap
 * common block tags, collapse whitespace. Enough to let the model read a
 * page; not trying to preserve layout.
 */

import { fetch as tauriFetch, ResponseType } from '@tauri-apps/api/http';
import { invoke } from '@tauri-apps/api/tauri';
import type { Tool } from '../types';
import { getWebFetchTimeoutMs } from '@/lib/timeouts';
import { createCombinedAbortSignal } from '../combinedAbortSignal';
import { formatBrowserSnapshot, type BrowserSnapshot } from './browserTool';

const MAX_BYTES = 2 * 1024 * 1024;

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function header(headers: Record<string, unknown>, name: string): string {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return String(entry?.[1] ?? '');
}

function looksBlocked(status: number, body: string, text: string): boolean {
  if ([401, 403, 429, 503].includes(status)) return true;
  const sample = `${body.slice(0, 6_000)} ${text.slice(0, 2_000)}`.toLowerCase();
  return /captcha|cloudflare|verify you are human|checking your browser|enable javascript|access denied|sign in to continue|log in to continue|访问验证|安全验证|人机验证|滑动验证|请求过于频繁|请开启javascript|请登录后|登录后查看/.test(sample);
}

async function browserFallback(url: string, cap: number, reason: string) {
  try {
    const snapshot = await invoke<BrowserSnapshot>('browser_open', {
      url,
      visible: false,
      maxChars: cap,
    });
    const prefix = `[HTTP 直读未获得可靠正文：${reason}。已自动改用 Chromium 动态读取。]\n`;
    if (snapshot.challenge) {
      return {
        success: true,
        output: `${prefix}${formatBrowserSnapshot(snapshot)}`,
      };
    }
    if (!snapshot.text.trim()) {
      return { success: false, output: '', error: `${reason}；Chromium 页面也没有可读正文` };
    }
    return { success: true, output: `${prefix}${formatBrowserSnapshot(snapshot)}` };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: `${reason}；Chromium 降级失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export const webFetchTool: Tool = {
  definition: {
    name: 'web_fetch',
    description:
      '读取一个 URL 的正文。先用快速 HTTP 直读；遇到动态渲染、反爬空壳或常见拦截会自动降级到 Chromium。' +
      '需要登录、验证码或页面交互时，继续使用 browser_control。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '完整 URL（http/https）' },
        maxChars: {
          type: 'number',
          description: '输出最多字符数，默认 20000',
        },
      },
      required: ['url'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const { url, maxChars } = params as { url?: string; maxChars?: number };
    if (!url || !/^https?:\/\//.test(url)) {
      return { success: false, output: '', error: 'url must be http(s)' };
    }

    const cap = Math.max(1000, Math.min(maxChars ?? 20_000, 200_000));
    const combined = createCombinedAbortSignal(undefined, {
      timeoutMs: getWebFetchTimeoutMs(),
    });

    try {
      const res = await tauriFetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
          'Cache-Control': 'no-cache',
        },
        responseType: ResponseType.Text,
        timeout: Math.ceil(getWebFetchTimeoutMs() / 1000),
      });
      if (!res.ok) {
        return browserFallback(url, cap, `HTTP ${res.status}`);
      }
      let body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      if (body.length > MAX_BYTES) {
        body = body.slice(0, MAX_BYTES) + '\n\n[...truncated at 2MB]';
      }
      const contentType = header(res.headers as Record<string, unknown>, 'content-type').toLowerCase();
      const isHtml = contentType.includes('html') || /^\s*(?:<!doctype\s+html|<html|<head|<body)/i.test(body);
      let text = isHtml ? htmlToText(body) : body;
      if (looksBlocked(res.status, body, text) || (isHtml && text.trim().length < 120)) {
        return browserFallback(url, cap, looksBlocked(res.status, body, text) ? '页面返回验证或脚本拦截' : 'HTML 仅包含脚本空壳');
      }
      if (text.length > cap) {
        text = text.slice(0, cap) + `\n\n[...truncated at ${cap} chars]`;
      }
      return { success: true, output: text };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return browserFallback(url, cap, `HTTP 读取失败：${msg}`);
    } finally {
      combined.cleanup();
    }
  },
};
