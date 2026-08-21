import { invoke } from '@tauri-apps/api/tauri';
import type { Tool } from '../types';
import { checkBashSecurity } from './bashSecurity';

interface CommandResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  output_id?: string | null;
  stdout_total_chars: number;
  stderr_total_chars: number;
  stdout_truncated: boolean;
  stderr_truncated: boolean;
}

interface CommandOutputPage {
  output_id: string;
  stream: 'stdout' | 'stderr';
  content: string;
  offset: number;
  returned_chars: number;
  total_chars: number;
  next_offset?: number | null;
  truncated: boolean;
}

export const bashTool: Tool = {
  risk: 'ask',
  definition: {
    name: 'bash',
    description:
      '执行一次独立的 zsh 命令。返回可续读的 output_id 和精确字符范围；完整输出保留 1 小时、最多最近 24 次，可用 bash_read_output 分页读取而不重跑命令。',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: '要执行的 shell 命令',
        },
        cwd: {
          type: 'string',
          description: '工作目录 (可选，默认当前工作目录)',
        },
        timeout_ms: {
          type: 'number',
          description: '超时毫秒数 (可选，默认 120000)',
        },
        max_output_chars: {
          type: 'number',
          description: '本次先返回的最大字符数（可选，默认 8000；完整输出仍可分页续读）',
        },
      },
      required: ['command'],
    },
  },

  checkRisk(params) {
    const command = params.command as string;
    if (!command) return { risk: 'ask' };
    const result = checkBashSecurity(command);
    return { risk: result.verdict, reason: result.reason };
  },

  async execute(params, signal) {
    // 给本次命令分配一个 id，用于 abort 时通过 kill_command 杀掉整个进程组
    const requestId =
      (globalThis.crypto?.randomUUID?.() as string | undefined) ??
      `bash-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // 已经 abort 了就别启动
    if (signal?.aborted) {
      return { success: false, output: '', error: '已取消' };
    }

    const onAbort = () => {
      // 真杀：Rust 侧对整个进程组发 SIGTERM→(1.5s)→SIGKILL
      void invoke('kill_command', { requestId }).catch(() => {});
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const result = await invoke<CommandResult>('execute_command', {
        command: params.command as string,
        cwd: params.cwd as string | undefined,
        timeoutMs: params.timeout_ms as number | undefined,
        requestId,
        maxOutputChars: Math.max(1000, Math.min(Number(params.max_output_chars) || 8000, 12000)),
      });

      const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
      const paging: string[] = [];
      const stdoutReturnedChars = Array.from(result.stdout).length;
      const stderrReturnedChars = Array.from(result.stderr).length;
      if (result.output_id && result.stdout_truncated) {
        paging.push(`stdout 已截断于字符 ${stdoutReturnedChars}/${result.stdout_total_chars}；调用 bash_read_output(output_id="${result.output_id}", stream="stdout", offset=${stdoutReturnedChars}) 继续。`);
      }
      if (result.output_id && result.stderr_truncated) {
        paging.push(`stderr 已截断于字符 ${stderrReturnedChars}/${result.stderr_total_chars}；调用 bash_read_output(output_id="${result.output_id}", stream="stderr", offset=${stderrReturnedChars}) 继续。`);
      }
      const pageNotice = paging.length > 0 ? `\n\n[输出分页]\n${paging.join('\n')}` : '';
      const credential = result.output_id
        ? `\n\n[命令输出凭证]\noutput_id: ${result.output_id}\nstdout: ${stdoutReturnedChars}/${result.stdout_total_chars} 字符\nstderr: ${stderrReturnedChars}/${result.stderr_total_chars} 字符\n有效期: 1 小时，最多保留最近 24 次命令`
        : '';

      return {
        success: result.exit_code === 0,
        output: `${output || '(no output)'}${pageNotice}${credential}`,
        error:
          result.exit_code !== 0
            ? `Exit code: ${result.exit_code}`
            : undefined,
      };
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  },
};

export const bashReadOutputTool: Tool = {
  definition: {
    name: 'bash_read_output',
    description: '分页读取之前 bash 命令保存的完整 stdout 或 stderr，不会重新执行命令。',
    parameters: {
      type: 'object',
      properties: {
        output_id: { type: 'string', description: 'bash 截断提示返回的 output_id' },
        stream: { type: 'string', enum: ['stdout', 'stderr'], description: '读取 stdout 或 stderr，默认 stdout' },
        offset: { type: 'number', description: '起始字符偏移（0-based）' },
        limit: { type: 'number', description: '读取字符数（默认 8000，最大 20000）' },
      },
      required: ['output_id'],
    },
  },
  async execute(params) {
    const result = await invoke<CommandOutputPage>('read_command_output', {
      outputId: params.output_id as string,
      stream: params.stream as string | undefined,
      offset: params.offset as number | undefined,
      limit: params.limit as number | undefined,
    });
    const end = result.offset + result.returned_chars;
    const notice = result.truncated && result.next_offset != null
      ? `\n\n[未读完：${result.stream} 字符 ${result.offset}-${end}/${result.total_chars}。继续调用 bash_read_output，offset=${result.next_offset}。]`
      : `\n\n[已读完：${result.stream} 共 ${result.total_chars} 字符。]`;
    const credential = `\n\n[命令输出凭证]\noutput_id: ${result.output_id}\n${result.stream}: ${result.offset}-${end}/${result.total_chars} 字符\n有效期: 1 小时，最多保留最近 24 次命令`;
    return { success: true, output: result.content + notice + credential };
  },
};
