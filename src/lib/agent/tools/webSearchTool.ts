/**
 * web_search — 联网搜索（DMXAPI 内置 API 模式）。
 *
 * 主：perplexity-sonar-pro-ssvip（带 URL 引用）
 * 备：Tencent-Search（主失败/空时自动回退）
 *
 * 本工具受输入框「联网」开关门控：关闭时 ToolRegistry 不会把它暴露给模型
 * （见 toolGating.ts）。execute 里再兜底一次，防止意外调用。
 */

import type { Tool } from '../types';
import { dmxResponses } from './dmxClient';
import { isToolEnabled } from '../toolGating';
import { prepareTemporalSearchQuery } from '../temporalContext';

interface Citation {
  url?: string;
  title?: string;
}

/** 解析 perplexity 返回：content + 引用 URL 列表 */
function parsePerplexity(j: Record<string, unknown>): { content: string; citations: Citation[] } {
  const choices = j.choices as
    | Array<{ message?: { content?: string; annotations?: Array<{ url_citation?: Citation }> } }>
    | undefined;
  const msg = choices?.[0]?.message;
  const content = msg?.content || '';
  const citations: Citation[] = (msg?.annotations || [])
    .map((a) => a.url_citation)
    .filter((c): c is Citation => !!c && !!c.url);
  return { content, citations };
}

/** 解析 Tencent-Search 返回：Pages[]（每条可能是 JSON 字符串） */
function parseTencent(j: Record<string, unknown>): Array<{ title: string; url: string; passage: string }> {
  const resp = j.Response as { Pages?: unknown[] } | undefined;
  const pages = resp?.Pages || [];
  const out: Array<{ title: string; url: string; passage: string }> = [];
  for (const p of pages) {
    let obj: Record<string, unknown> | null = null;
    if (typeof p === 'string') {
      try { obj = JSON.parse(p); } catch { obj = null; }
    } else if (p && typeof p === 'object') {
      obj = p as Record<string, unknown>;
    }
    if (!obj) continue;
    out.push({
      title: String(obj.title || ''),
      url: String(obj.url || ''),
      passage: String(obj.passage || ''),
    });
  }
  return out;
}

export const webSearchTool: Tool = {
  definition: {
    name: 'web_search',
    description:
      '联网搜索实时信息，返回答案摘要 + 来源 URL 引用。' +
      '用于：找最新资讯、核实事实、查找资料。' +
      '查询涉及今天、最新、目前、近期或今年时，必须以系统环境中的当前日期为准；不要凭模型记忆添加年份。工具会自动附加实时日期锚点，并纠正“今天”与错误日期直接冲突的查询。' +
      '主引擎 perplexity，失败自动回退腾讯搜索。已知具体 URL 先用 web_fetch；动态页或登录页再用 browser_control。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词/问题' },
        limit: { type: 'number', description: '备用引擎返回条数，默认 8（上限 20）' },
      },
      required: ['query'],
    },
  },
  risk: 'safe',
  async execute(params) {
    // 门控兜底：开关关闭时即使被调用也明确拒绝
    if (!isToolEnabled('web_search')) {
      return {
        success: false,
        output: '',
        error: '联网搜索未开启，请在输入框点击「联网」按钮开启后重试。',
      };
    }

    const { query, limit } = params as { query?: string; limit?: number };
    if (!query || !query.trim()) {
      return { success: false, output: '', error: 'query required' };
    }
    const temporal = prepareTemporalSearchQuery(query);
    const cap = Math.max(1, Math.min(limit ?? 8, 20));

    // 主：perplexity
    let primaryErr = '';
    try {
      const j = await dmxResponses('perplexity-sonar-pro-ssvip', [
        { role: 'user', content: [{ type: 'input_text', text: temporal.prompt }] },
      ]);
      const { content, citations } = parsePerplexity(j);
      if (content.trim()) {
        const lines = [content.trim()];
        if (temporal.isTimeSensitive) {
          lines.unshift(`[搜索时间锚点：${temporal.context.isoDate} ${temporal.context.timeZone}]`);
        }
        if (temporal.correctedFrom) {
          lines.unshift(`[已纠正矛盾日期：${temporal.correctedFrom} → ${temporal.query}]`);
        }
        if (citations.length > 0) {
          lines.push('\n来源：');
          citations.forEach((c, i) => {
            lines.push(`[${i + 1}] ${c.title ? c.title + ' — ' : ''}${c.url}`);
          });
        }
        lines.push('\n（搜索引擎：perplexity-sonar-pro-ssvip）');
        return { success: true, output: lines.join('\n') };
      }
      primaryErr = '主引擎返回空内容';
    } catch (err) {
      primaryErr = err instanceof Error ? err.message : String(err);
    }

    // 备：Tencent-Search
    try {
      const j = await dmxResponses('Tencent-Search', temporal.query, { Mode: 0 });
      const results = parseTencent(j).slice(0, cap);
      if (results.length > 0) {
        const lines = results.map(
          (r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.passage}`,
        );
        if (temporal.isTimeSensitive) {
          lines.unshift(`[搜索时间锚点：${temporal.context.isoDate} ${temporal.context.timeZone}]`);
        }
        if (temporal.correctedFrom) {
          lines.unshift(`[已纠正矛盾日期：${temporal.correctedFrom} → ${temporal.query}]`);
        }
        lines.push(`\n（主引擎失败[${primaryErr}]，已回退：Tencent-Search）`);
        return { success: true, output: lines.join('\n\n') };
      }
      return { success: false, output: '', error: `主备引擎均无结果（主: ${primaryErr}）` };
    } catch (err) {
      const backupErr = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: `搜索失败 — 主: ${primaryErr}；备: ${backupErr}` };
    }
  },
};
