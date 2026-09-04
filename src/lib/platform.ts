// 平台与 shell 探测（跨平台支持的核心开关）。
//
// 命令方言由 Rust 侧 shell_info 决定：Windows 优先复用 Git Bash（保持
// POSIX 语法兼容），找不到时回退 PowerShell；macOS/Linux 固定 zsh。
// 前端提示词、候选路径与命令构造都以此为准。
import { invoke } from '@tauri-apps/api/tauri';

export interface ShellInfo {
  platform: 'macos' | 'windows' | 'linux';
  shell: 'zsh' | 'bash' | 'powershell';
  shellPath: string;
}

let cached: Promise<ShellInfo> | null = null;

/** 查询 execute_command 实际使用的 shell（结果缓存，一次 IPC）。 */
export function getShellInfo(): Promise<ShellInfo> {
  cached ??= invoke<ShellInfo>('shell_info').catch(() => ({
    platform: userAgentPlatform(),
    shell: userAgentPlatform() === 'windows' ? 'powershell' : 'zsh',
    shellPath: '',
  }));
  return cached;
}

/** 同步的粗粒度平台判断（不涉及 shell 方言时使用）。 */
export function userAgentPlatform(): 'macos' | 'windows' | 'linux' {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macos';
  return 'linux';
}

export function isWindowsSync(): boolean {
  return userAgentPlatform() === 'windows';
}

/**
 * Windows 盘符路径修正：asset URL（asset.localhost/file://）反解出来的
 * '/C:\Users\...' 或 '/c:/...' 去掉前导斜杠。macOS 的绝对路径以 / 开头天然
 * 正确；Windows 上传给 python/原生 API 时前导斜杠会让路径非法（WinError 123）。
 */
export function stripDriveLeadingSlash(p: string): string {
  return /^\/[A-Za-z]:[\\/]/.test(p) ? p.slice(1) : p;
}

/** 提示词用的展示名（macOS / Windows / Linux）。 */
export function osDisplayName(platform: ShellInfo['platform']): string {
  if (platform === 'windows') return 'Windows';
  if (platform === 'macos') return 'macOS';
  return 'Linux';
}

/**
 * Windows 上若未找到 Git Bash，execute_command 会回退 PowerShell；POSIX
 * 语法的命令（管道、heredoc、`2>/dev/null`）在该环境下不可用。这个标志
 * 让调用方在生成命令前知道该用哪种方言。
 */
export async function isPosixShell(): Promise<boolean> {
  const info = await getShellInfo();
  return info.shell !== 'powershell';
}

/**
 * 生成"终止后台 shell 进程树"的跨平台命令（配合 execute_command 使用）。
 * pid 必须是启动命令（nohup … & echo $!）回读的那个 pid。
 *
 * - Unix：pkill 杀子进程 + kill 杀父进程。
 * - Windows（Git Bash）：先经 /proc/<pid>/winpid 换算出 Windows PID（必须
 *   在 kill 之前读，进程死后 /proc 条目消失、`&&` 短路会让 taskkill 永远
 *   轮不到），再 kill MSYS pid，最后 taskkill /T 连根终止原生进程树；
 *   MSYS2_ARG_CONV_EXCL 阻止 MSYS 把 /PID 参数误转换成路径。Windows 无
 *   进程组信号，force 与否同为强杀。
 */
export function stopBackgroundProcessCommand(pid: string, force: boolean): string {
  const sig = force ? 'KILL' : 'TERM';
  if (isWindowsSync()) {
    return `W=$(cat /proc/${pid}/winpid 2>/dev/null); kill -${sig} ${pid} 2>/dev/null || true; [ -n "$W" ] && MSYS2_ARG_CONV_EXCL='*' taskkill /PID "$W" /T /F >/dev/null 2>&1 || true`;
  }
  return `pkill -${sig} -P ${pid} 2>/dev/null || true; kill -${sig} ${pid} 2>/dev/null || true`;
}
