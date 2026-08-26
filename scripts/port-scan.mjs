#!/usr/bin/env node
// port-scan — 移植哨兵：扫描一段 git diff 中的平台敏感模式，输出需要人工
// 复核的移植风险点。模式清单对应 docs/PORTING.md 的"已踩过的坑"。
//
// 用法：
//   node scripts/port-scan.mjs                 # 扫描未提交的工作区改动
//   node scripts/port-scan.mjs A..B            # 扫描指定 range（如 upstream/main...HEAD）
//   node scripts/port-scan.mjs --stat A..B     # 只列出改动文件
//
// 退出码：有命中=1，无命中=0（可用于 CI 门禁）。

import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const statOnly = args[0] === '--stat';
const range = args.filter((a) => a !== '--stat')[0];

const diffArgs = range ? ['diff', '--unified=0', range] : ['diff', '--unified=0'];
let diff;
try {
  diff = execSync(`git ${diffArgs.join(' ')}`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
} catch (e) {
  console.error(`无法读取 diff（${range || '工作区'}）：${e.message}`);
  process.exit(2);
}

// [正则, 类别, 说明/建议]；只匹配新增行（+ 开头），排除 docs/ 与测试 fixture。
const RULES = [
  [/\/tmp\//, '路径', '硬编码 /tmp：Tauri fs 与 Git Bash 解析错位，用 get_temp_dir'],
  [/process\.env\.(USERPROFILE|LOCALAPPDATA|ProgramFiles|APPDATA|HOME)/, '路径', 'WebView 里没有 process，用 Tauri path API（homeDir 等）'],
  [/\.zshrc/, 'shell', 'source ~/.zshrc 仅 macOS 有意义，注意平台分支'],
  [/killpg|pkill |kill -[A-Z]/, 'shell', 'Unix 信号/进程组在 Windows 无效，需 taskkill /T /F 等价物'],
  [/osascript|ditto |videotoolbox|open -R/, 'shell', 'macOS 专属命令，必须 cfg 门控并给 Windows 等价实现'],
  [/\.to_string_lossy\(\)/, 'ESM', '若该路径会作为 ESM/loader 的模块 specifier，必须转 file:// URL（module_specifier）'],
  [/Command::new\((?!"sh"|"bash"|"powershell")/, 'process', '新增 spawn：Windows 控制台程序需 CREATE_NO_WINDOW，env_clear 需补白名单'],
  [/glob.*join\(|join\(.*\*\*/, '路径', 'glob 模式中的 Windows 反斜杠是转义符，需 replace(\'\\\\\', "/")'],
  [/Body\.json\(|tauriFetch\(/, '网络', 'body 可能 >64KB 的 POST 必须走 curlTransport.postJsonViaCurl（tauriFetch 大 body 在 Windows 会被网关判 400）'],
  [/readBinaryFile|writeBinaryFile/, 'IPC', '大二进制经 IPC 开销大；确认不会进入 >64KB 的 HTTP body 链路'],
  [/mkdir -p|nohup |2>\/dev\/null|<<PY|<<EOF|&& echo \$!/, 'shell', 'POSIX-only 命令串：PowerShell 回退环境下不可运行'],
];

const SKIP_FILE = /^(\+\+\+ )?[ab]\/(docs\/|dsh-runtime\/|scripts\/|scf\/|.*\.md$|.*\.test\.|pr2\.diff)/;
const hits = [];
let file = '';
const seen = new Set();

for (const line of diff.split('\n')) {
  if (line.startsWith('+++ b/')) { file = line.slice(6); continue; }
  if (line.startsWith('+++ ')) { file = line.slice(4); continue; }
  if (!line.startsWith('+') || line.startsWith('+++')) continue;
  if (SKIP_FILE.test(file)) continue;
  const text = line.slice(1);
  for (const [re, cat, advice] of RULES) {
    if (re.test(text)) {
      const key = `${file}|${cat}|${text.trim().slice(0, 80)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ file, cat, line: text.trim().slice(0, 100), advice });
    }
  }
}

if (statOnly) {
  const files = [...new Set(diff.split('\n').filter((l) => l.startsWith('+++ b/')).map((l) => l.slice(6)))];
  console.log(files.join('\n'));
  process.exit(0);
}

if (!hits.length) {
  console.log(`port-scan: ${range || '工作区'} 未发现平台敏感模式。`);
  console.log('仍请人工复核 docs/PORTING.md 末尾的 4 项脚本扫不出类别。');
  process.exit(0);
}

console.log(`port-scan: ${range || '工作区'} 命中 ${hits.length} 处平台敏感模式：\n`);
for (const h of hits) {
  console.log(`[${h.cat}] ${h.file}`);
  console.log(`  ${h.line}`);
  console.log(`  → ${h.advice}\n`);
}
process.exit(1);
