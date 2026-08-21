import { invoke } from '@tauri-apps/api/tauri';
import type { Tool } from '../types';

interface FileContent {
  content: string;
  total_lines: number;
  canonical_path: string;
  size_bytes: number;
  modified_ms: number;
  content_hash: string;
  offset: number;
  returned_lines: number;
  next_offset?: number | null;
  truncated: boolean;
}

export const readTool: Tool = {
  definition: {
    name: 'read_file',
    description:
      '从实时磁盘读取文件，不使用索引或历史快照。每次读取前后校验文件状态，返回规范路径、修改时间、内容指纹、带行号文本和明确续读位置；长文件用 offset/limit 继续读取，不要退回 bash cat。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '文件的绝对路径（支持 ~/）；不存在时会查找同名文件并给出候选路径',
        },
        offset: {
          type: 'number',
          description: '起始行号 (0-based, 可选)',
        },
        limit: {
          type: 'number',
          description: '读取行数 (可选，默认 2000)',
        },
      },
      required: ['path'],
    },
  },

  async execute(params) {
    const result = await invoke<FileContent>('read_file', {
      path: params.path as string,
      offset: params.offset as number | undefined,
      limit: params.limit as number | undefined,
    });

    const modified = new Date(Number(result.modified_ms)).toISOString();
    const rangeEnd = result.offset + result.returned_lines;
    const continuation = result.truncated && result.next_offset != null
      ? `\n[未读完：当前返回第 ${result.offset + 1}-${rangeEnd} 行，共 ${result.total_lines} 行。继续调用 read_file，offset=${result.next_offset}。]`
      : `\n[已读完：共 ${result.total_lines} 行。]`;

    return {
      success: true,
      output:
        `[实时磁盘读取 · 已校验当前磁盘状态]\n路径: ${result.canonical_path}\n大小: ${result.size_bytes} bytes\n修改时间: ${modified}\n内容指纹: ${result.content_hash}\n\n`
        + result.content
        + continuation,
    };
  },
};
