import { invoke } from '@tauri-apps/api/tauri';
import type { Tool } from '../types';

interface VerifiedMutation {
  canonical_path: string;
  size_bytes: number;
  modified_ms: number;
  content_hash: string;
  verified: boolean;
}

export const editTool: Tool = {
  risk: 'ask',
  definition: {
    name: 'edit_file',
    description:
      '编辑文件：将 old_string 精确替换为 new_string。old_string 必须在文件中唯一匹配，除非设置 replace_all=true。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '文件的绝对路径',
        },
        old_string: {
          type: 'string',
          description: '要替换的原始文本',
        },
        new_string: {
          type: 'string',
          description: '替换后的新文本',
        },
        replace_all: {
          type: 'boolean',
          description: '是否替换所有匹配 (默认 false)',
        },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },

  async execute(params) {
    const result = await invoke<VerifiedMutation>('edit_file', {
      path: params.path as string,
      oldString: params.old_string as string,
      newString: params.new_string as string,
      replaceAll: params.replace_all as boolean | undefined,
    });

    return {
      success: true,
      output: `文件已编辑并从实时磁盘回读校验: ${result.canonical_path}\n大小: ${result.size_bytes} bytes\n修改时间: ${new Date(Number(result.modified_ms)).toISOString()}\n内容指纹: ${result.content_hash}`,
    };
  },
};
