/**
 * python.ts — 跨平台 Python 解释器解析。
 *
 * macOS 自带 python3；Windows 的 python.org 安装包通常只有 python（无
 * python3.exe），直接用固定名字在 Windows 上会以 "program not found"
 * （Tauri Command 直启）或 exit 127（bash）失败。统一经这里解析一次并缓存。
 */

import { invoke } from '@tauri-apps/api/tauri';

interface CommandResult { stdout: string; stderr: string; exit_code: number }

let cached: string | null = null;

/** python3 优先，缺失时回退 python；都没有则给出可操作的安装指引。 */
export async function pythonCommand(): Promise<string> {
  if (cached) return cached;
  for (const prog of ['python3', 'python']) {
    const r = await invoke<CommandResult>('execute_command', {
      command: `${prog} --version`,
      timeoutMs: 5000,
    }).catch(() => null);
    if (r && r.exit_code === 0) {
      cached = prog;
      return prog;
    }
  }
  throw new Error('未检测到 Python（macOS 自带 python3；Windows 请安装 python.org 或 winget install Python.Python.3）');
}
