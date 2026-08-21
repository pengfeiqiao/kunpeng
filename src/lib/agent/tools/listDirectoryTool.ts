import { invoke } from '@tauri-apps/api/tauri';
import type { Tool } from '../types';

interface DirectoryEntry {
  path: string;
  name: string;
  depth: number;
  size_bytes: number;
  modified_ms: number;
  is_dir: boolean;
  is_symlink: boolean;
  line_count?: number | null;
}

interface DirectoryListResult {
  root: string;
  scanned_at_ms: number;
  depth: number;
  ignored: string[];
  entries: DirectoryEntry[];
  total_entries: number;
  offset: number;
  returned_entries: number;
  next_offset?: number | null;
  truncated: boolean;
  scan_capped: boolean;
}

export const listDirectoryTool: Tool = {
  definition: {
    name: 'list_directory',
    description:
      '浏览实时磁盘目录结构，返回有界深度的树形列表、类型、大小、修改时间和可选行数。默认忽略 .git、node_modules、target、dist 等重目录，支持分页。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录路径（可选，默认当前工作目录）' },
        depth: { type: 'number', description: '递归深度 1-4（默认 2）' },
        offset: { type: 'number', description: '分页起始项（0-based）' },
        limit: { type: 'number', description: '返回项数（默认 200，最大 500）' },
        include_hidden: { type: 'boolean', description: '是否包含点号开头的隐藏项（默认 false）' },
        include_ignored: { type: 'boolean', description: '是否包含默认忽略的重目录（默认 false）' },
        include_line_counts: { type: 'boolean', description: '是否统计 2MB 以下文本文件行数（默认 false）' },
      },
    },
  },

  async execute(params) {
    const result = await invoke<DirectoryListResult>('list_directory', {
      path: params.path as string | undefined,
      depth: params.depth as number | undefined,
      offset: params.offset as number | undefined,
      limit: params.limit as number | undefined,
      includeHidden: params.include_hidden as boolean | undefined,
      includeIgnored: params.include_ignored as boolean | undefined,
      includeLineCounts: params.include_line_counts as boolean | undefined,
    });
    const rows = result.entries.map((entry) => {
      const indent = '  '.repeat(Math.max(0, entry.depth - 1));
      const marker = entry.is_dir ? '▸' : entry.is_symlink ? '↗' : '·';
      const size = entry.is_dir ? '目录' : `${entry.size_bytes} bytes`;
      const lines = entry.line_count == null ? '' : ` · ${entry.line_count} 行`;
      const modified = new Date(Number(entry.modified_ms)).toISOString();
      return `${indent}${marker} ${entry.name} · ${size}${lines} · ${modified}`;
    });
    const end = result.offset + result.returned_entries;
    const continuation = result.truncated && result.next_offset != null
      ? `[未读完: 当前返回 ${result.offset}-${end}/${result.total_entries} 项；继续调用 list_directory，offset=${result.next_offset}。]`
      : `[已读完: 共 ${result.total_entries} 项。]`;
    const cap = result.scan_capped ? '\n[目录扫描达到 10000 项安全上限，请缩小路径或深度。]' : '';
    return {
      success: true,
      output: `[实时目录浏览]\n根目录: ${result.root}\n扫描时间: ${new Date(Number(result.scanned_at_ms)).toISOString()}\n深度: ${result.depth}\n忽略规则: ${result.ignored.join(', ') || '无'}\n找到 ${result.total_entries} 项:\n${rows.join('\n')}\n${continuation}${cap}`,
    };
  },
};
