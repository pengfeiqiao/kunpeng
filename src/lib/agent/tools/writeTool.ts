import { invoke } from '@tauri-apps/api/tauri';
import type { Tool } from '../types';

interface VerifiedMutation {
  canonical_path: string;
  size_bytes: number;
  modified_ms: number;
  content_hash: string;
  verified: boolean;
}

export const writeTool: Tool = {
  risk: 'ask',
  definition: {
    name: 'write_file',
    description:
      '写入文件。会覆盖已有内容。自动创建父目录。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '文件的绝对路径',
        },
        content: {
          type: 'string',
          description: '要写入的内容',
        },
      },
      required: ['path', 'content'],
    },
  },

  async execute(params) {
    const result = await invoke<VerifiedMutation>('write_file', {
      path: params.path as string,
      content: params.content as string,
    });

    return {
      success: true,
      output: `文件已写入并从实时磁盘回读校验: ${result.canonical_path}\n大小: ${result.size_bytes} bytes\n修改时间: ${new Date(Number(result.modified_ms)).toISOString()}\n内容指纹: ${result.content_hash}`,
    };
  },
};
