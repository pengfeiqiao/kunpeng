/**
 * Bash 命令安全检查
 * 参考 Claude Code 的 bashSecurity.ts，检测高危命令模式
 */

export type SecurityVerdict = 'safe' | 'ask' | 'deny';

export interface SecurityCheckResult {
  verdict: SecurityVerdict;
  reason?: string;
}

// ── 高危模式（直接拒绝）──────────────────────────────────────────────────────

const DENY_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // 递归删除根目录或 home
  { pattern: /rm\s+(-[^\s]*)?r[^\s]*f[^\s]*\s+\/\s*$/, reason: 'rm -rf /' },
  { pattern: /rm\s+(-[^\s]*)?r[^\s]*f[^\s]*\s+~\s*$/, reason: 'rm -rf ~' },
  { pattern: /rm\s+(-[^\s]*)?r[^\s]*f[^\s]*\s+\/\*/, reason: 'rm -rf /*' },
  // Fork 炸弹
  { pattern: /:\(\)\s*\{\s*:\|:&\s*\}\s*;?\s*:/, reason: 'Fork bomb' },
  // 覆盖磁盘设备
  { pattern: />\s*\/dev\/sd[a-z]/, reason: '覆盖磁盘设备' },
  { pattern: /dd\s+.*if=\/dev\/zero\s+.*of=\/dev\/sd/, reason: 'dd 覆盖磁盘' },
  // 格式化
  { pattern: /mkfs\s/, reason: 'mkfs 格式化磁盘' },
  // 删除系统关键目录
  { pattern: /rm\s+(-[^\s]*)?r[^\s]*f[^\s]*\s+\/(etc|usr|bin|sbin|boot|var|lib)\b/, reason: '删除系统目录' },
];

// ── 中危模式（需要确认）──────────────────────────────────────────────────────

const ASK_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // 递归删除（非根/home）
  { pattern: /rm\s+(-[^\s]*)?r/, reason: '递归删除文件' },
  // 权限相关
  { pattern: /chmod\s+(-R\s+)?777/, reason: '设置 777 权限' },
  { pattern: /chmod\s+-R/, reason: '递归修改权限' },
  { pattern: /chown\s+-R/, reason: '递归修改所有者' },
  // 网络下载并执行
  { pattern: /curl\s.*\|\s*(sh|bash|zsh)/, reason: 'curl pipe to shell' },
  { pattern: /wget\s.*\|\s*(sh|bash|zsh)/, reason: 'wget pipe to shell' },
  // 修改环境配置
  { pattern: />\s*~?\/?\.?(bash_profile|bashrc|zshrc|profile|zprofile)/, reason: '覆盖 shell 配置' },
  // kill 信号
  { pattern: /kill\s+-9\s/, reason: '强制杀进程' },
  { pattern: /killall\s/, reason: '批量杀进程' },
  // git 危险操作
  { pattern: /git\s+push\s+.*--force/, reason: 'git force push' },
  { pattern: /git\s+reset\s+--hard/, reason: 'git reset --hard' },
  { pattern: /git\s+clean\s+-f/, reason: 'git clean -f' },
  // 系统管理
  { pattern: /shutdown/, reason: '关机命令' },
  { pattern: /reboot/, reason: '重启命令' },
  // 环境变量中的敏感操作
  { pattern: /export\s+(PATH|HOME|USER)=/, reason: '修改关键环境变量' },
  // npm/pip 全局安装
  { pattern: /npm\s+install\s+-g/, reason: 'npm 全局安装' },
  { pattern: /pip\s+install\s+(?!.*--user)(?!.*-e\s)/, reason: 'pip 安装' },
];

const SHELL_CONTROL_SPLIT = /(?:&&|\|\||;|\n)/;
const REDIRECT_TO_SENSITIVE = />+\s*(?:~\/|~)?\.(?:bash_profile|bashrc|zshrc|profile|zprofile|ssh\/authorized_keys|gitconfig)\b/;
const DOWNLOAD_EXEC = /\b(?:curl|wget)\b[\s\S]*(?:\|\s*(?:sh|bash|zsh|python|python3|node|perl|ruby)\b|`|\$\()/;
const INTERPRETER_INLINE = /\b(?:python3?|node|perl|ruby)\s+(?:-[ce]|--eval)\b[\s\S]*(?:rm\s+-|shutil\.rmtree|fs\.rmSync|child_process|unlinkSync|rmdirSync)/;

function splitCommand(command: string): string[] {
  return command
    .split(SHELL_CONTROL_SPLIT)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function normalizeForScan(command: string): string {
  return command
    .replace(/\\\s*\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasSuspiciousObfuscation(command: string): boolean {
  // Shell variables and command substitution can hide the real executable or
  // target path from regex-level checks. Treat them as ask-level whenever they
  // appear near destructive verbs.
  return (
    /\b(?:rm|mv|chmod|chown|dd|mkfs|git|kill|sudo)\b[\s\S]*(?:\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|`[^`]+`|\$\([^)]*\))/.test(command) ||
    /(?:\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|`[^`]+`|\$\([^)]*\))[\s\S]*\b(?:rm|mv|chmod|chown|dd|mkfs|git|kill|sudo)\b/.test(command)
  );
}

function checkSegment(segment: string): SecurityCheckResult | null {
  const normalized = normalizeForScan(segment);

  for (const { pattern, reason } of DENY_PATTERNS) {
    if (pattern.test(normalized)) {
      return { verdict: 'deny', reason: `危险命令被阻止: ${reason}` };
    }
  }

  if (/\bsudo\s+rm\s+-[^\s]*r[^\s]*f[^\s]*(?:\s+--)?\s+(?:\/|~|\/\*)\s*$/.test(normalized)) {
    return { verdict: 'deny', reason: '危险命令被阻止: sudo rm -rf 系统路径' };
  }
  if (/\bfind\b[\s\S]*(?:\s-delete\b|\s-exec\s+rm\b)/.test(normalized)) {
    return { verdict: 'ask', reason: 'find 删除文件' };
  }
  if (REDIRECT_TO_SENSITIVE.test(normalized)) {
    return { verdict: 'ask', reason: '修改敏感配置文件' };
  }
  if (DOWNLOAD_EXEC.test(normalized)) {
    return { verdict: 'ask', reason: '下载内容并执行' };
  }
  if (INTERPRETER_INLINE.test(normalized)) {
    return { verdict: 'ask', reason: '解释器内联执行高风险文件操作' };
  }
  if (hasSuspiciousObfuscation(normalized)) {
    return { verdict: 'ask', reason: '命令包含变量或命令替换，需人工确认实际影响' };
  }

  for (const { pattern, reason } of ASK_PATTERNS) {
    if (pattern.test(normalized)) {
      return { verdict: 'ask', reason };
    }
  }

  return null;
}

/**
 * 检查 bash 命令的安全性
 */
export function checkBashSecurity(command: string): SecurityCheckResult {
  const trimmed = normalizeForScan(command);
  const segments = splitCommand(command);
  let askReason: string | undefined;

  for (const segment of segments.length > 0 ? segments : [trimmed]) {
    const result = checkSegment(segment);
    if (!result) continue;
    if (result.verdict === 'deny') return result;
    if (!askReason) askReason = result.reason;
  }

  // Pipelines are especially hard to audit with regexes because the dangerous
  // part can be hidden upstream/downstream. Escalate only when a risky verb is
  // present so normal `rg foo | head` still stays smooth.
  if (!askReason && /\|/.test(command) && /\b(?:sh|bash|zsh|python3?|node|perl|ruby|rm|dd|mkfs|chmod|chown)\b/.test(trimmed)) {
    askReason = '管道中包含可执行或高风险命令';
  }

  if (askReason) {
    return {
      verdict: 'ask',
      reason: askReason,
    };
  }

  return { verdict: 'safe' };
}

export const __bashSecurityInternals = {
  splitCommand,
  normalizeForScan,
  checkSegment,
};
