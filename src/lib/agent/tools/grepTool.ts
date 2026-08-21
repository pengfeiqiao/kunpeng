import { invoke } from '@tauri-apps/api/tauri';
import type { Tool } from '../types';

interface GrepMatch {
  file: string;
  line: number;
  content: string;
}

interface GrepSearchResult {
  root: string;
  pattern: string;
  engine: string;
  scanned_at_ms: number;
  matches: GrepMatch[];
  truncated: boolean;
  max_results: number;
}

export const grepTool: Tool = {
  definition: {
    name: 'grep_search',
    description:
      '直接扫描实时磁盘内容，不使用文件索引或历史快照。使用正则表达式搜索并返回本次扫描根目录和时间。',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: '正则表达式搜索模式',
        },
        path: {
          type: 'string',
          description: '搜索目录 (可选，默认当前工作目录)',
        },
        file_glob: {
          type: 'string',
          description: '文件过滤模式，如 "*.ts" (可选)',
        },
        context_lines: {
          type: 'number',
          description: '显示匹配行前后的上下文行数 (可选)',
        },
        max_results: {
          type: 'number',
          description: '最大结果数 (可选，默认 250)',
        },
      },
      required: ['pattern'],
    },
  },

  async execute(params) {
    const result = await invoke<GrepSearchResult>('grep_search', {
      pattern: params.pattern as string,
      path: params.path as string | undefined,
      fileGlob: params.file_glob as string | undefined,
      contextLines: params.context_lines as number | undefined,
      maxResults: params.max_results as number | undefined,
    });

    if (result.matches.length === 0) {
      return {
        success: true,
        output: `[实时磁盘搜索]\n扫描目录: ${result.root}\n正则引擎: ${result.engine}\n搜索表达式: ${result.pattern}\n扫描时间: ${new Date(Number(result.scanned_at_ms)).toISOString()}\n未找到匹配内容`,
      };
    }

    const output = result.matches
      .map((m) => `${m.file}:${m.line}: ${m.content}`)
      .join('\n');

    const continuation = result.truncated
      ? `\n[结果超过 ${result.max_results} 条，当前结果已明确截断。请缩小 path/file_glob/pattern 后继续搜索。]`
      : '';

    return {
      success: true,
      output: `[实时磁盘搜索]\n扫描目录: ${result.root}\n正则引擎: ${result.engine}\n搜索表达式: ${result.pattern}\n扫描时间: ${new Date(Number(result.scanned_at_ms)).toISOString()}\n找到 ${result.matches.length} 个匹配:\n${output}${continuation}`,
    };
  },
};
