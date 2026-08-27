/**
 * curlTransport — 大请求体的 curl 传输兜底。
 *
 * Windows 实机：tauriFetch（Tauri IPC → reqwest）发 ~1MB+ 的 JSON 请求体会
 * 被网关判为 "invalid JSON request body"（HTTP 400），而同一 body 用 curl
 * 发同一端点同一模型返回 200——问题出在应用内传输层而非网关。大 body
 * （识图内联 base64）改走 curl 进程绕过。
 *
 * 请求体与含密钥的 curl 配置写入 0600 临时文件，密钥不进进程参数
 * （仓库密钥纪律），用后删除。
 */

import { invoke } from '@tauri-apps/api/tauri';
import { removeFile } from '@tauri-apps/api/fs';
import { homeDir } from '@tauri-apps/api/path';

interface CommandResult { stdout: string; stderr: string; exit_code: number }

const shq = (p: string) => `'${p.replace(/'/g, `'\\''`)}'`;

/**
 * 超过该字节数的 JSON body 走 curl 而非 tauriFetch。
 * 实测定界：~33KB body（24KB 小图）tauriFetch 正常；~300KB（压缩图）即被
 * 网关判 invalid JSON。阈值取 64KB，留足两侧余量。
 */
export const CURL_TRANSPORT_THRESHOLD = 64_000;

/** 超过该字节数的 body 落一份调试副本（无密钥，纯请求体 JSON）。 */
export const DEBUG_BODY_THRESHOLD = 200_000;

export interface RawPostResult { status: number; data: string }

/**
 * 把可疑的大请求体写到 ~/.kunpeng/debug-<fileName>（0600，纯 body、无密钥），
 * 供离线校验 JSON 合法性 / 用 curl 重放。失败静默（仅诊断用途）。
 */
export async function dumpDebugBody(fileName: string, payload: unknown): Promise<void> {
  try {
    const home = (await homeDir()).replace(/\\/g, '/');
    await invoke('write_text_file_private', {
      path: `${home}.kunpeng/debug-${fileName}.json`,
      contents: JSON.stringify(payload),
    });
  } catch { /* 仅诊断，不影响主流程 */ }
}

/** POST JSON via curl。headers 为完整头行（含密钥），curl 全平台自带。 */
export async function postJsonViaCurl(url: string, headers: string[], payload: unknown): Promise<RawPostResult> {
  // 临时文件必须落在主目录内：write_text_file_private 只允许 home 内路径，
  // 系统临时目录（macOS /var/folders、Windows %TEMP%）会被拒——曾导致
  // curl 传输在 mac 上全模型报"私密文件写入仅允许用户主目录内的路径"。
  const home = (await homeDir()).replace(/\\/g, '/');
  const tmp = `${home}.kunpeng/tmp`;
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const bodyPath = `${tmp}/kunpeng-post-${id}.json`;
  const cfgPath = `${tmp}/kunpeng-post-${id}.curlrc`;
  try {
    await invoke('write_text_file_private', { path: bodyPath, contents: JSON.stringify(payload) });
    await invoke('write_text_file_private', {
      path: cfgPath,
      contents: headers.map((h) => `header = "${h.replace(/"/g, '\\"')}"`).join('\n') + '\n',
    });
    const r = await invoke<CommandResult>('execute_command', {
      command: `curl -sS --max-time 150 -w '\\n__HTTP_CODE__%{http_code}' --config ${shq(cfgPath)} --data-binary @${shq(bodyPath)} ${shq(url)}`,
      timeoutMs: 160_000,
    });
    if (r.exit_code !== 0) {
      throw new Error(`network: ${r.stderr.slice(-200) || `curl exit ${r.exit_code}`}`);
    }
    const idx = r.stdout.lastIndexOf('\n__HTTP_CODE__');
    if (idx < 0) throw new Error('network: 无法解析 curl 输出');
    return { status: parseInt(r.stdout.slice(idx + '\n__HTTP_CODE__'.length), 10), data: r.stdout.slice(0, idx) };
  } finally {
    void removeFile(bodyPath).catch(() => {});
    void removeFile(cfgPath).catch(() => {});
  }
}
