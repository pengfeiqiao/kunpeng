import { invoke } from '@tauri-apps/api/tauri';
import type { Tool } from '../types';

interface GlobMatch {
  path: string;
  size_bytes: number;
  modified_ms: number;
  is_dir: boolean;
}

interface GlobSearchResult {
  root: string;
  scanned_at_ms: number;
  matches: GlobMatch[];
}

export const globTool: Tool = {
  definition: {
    name: 'glob_search',
    description:
      '按文件名模式扫描实时磁盘。支持 glob 和花括号扩展，返回路径、类型、大小、修改时间，便于直接判断该读哪个文件。',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'glob 匹配模式，如 "**/*.ts" 或 "src/**/*.{ts,tsx}"',
        },
        path: {
          type: 'string',
          description: '搜索目录 (可选，默认当前工作目录)',
        },
      },
      required: ['pattern'],
    },
  },

  async execute(params) {
    const result = await invoke<GlobSearchResult>('glob_search', {
      pattern: params.pattern as string,
      path: params.path as string | undefined,
    });

    if (result.matches.length === 0) {
      return {
        success: true,
        output: `[实时磁盘扫描]\n根目录: ${result.root}\n未找到匹配的文件`,
      };
    }

    const rows = result.matches.map((item) => {
      const kind = item.is_dir ? '目录' : '文件';
      const modified = new Date(Number(item.modified_ms)).toISOString();
      return `${item.path}\t${kind}\t${item.size_bytes} bytes\t${modified}`;
    });
    return {
      success: true,
      output: `[实时磁盘扫描]\n根目录: ${result.root}\n扫描时间: ${new Date(Number(result.scanned_at_ms)).toISOString()}\n找到 ${result.matches.length} 项:\n${rows.join('\n')}`,
    };
  },
};
