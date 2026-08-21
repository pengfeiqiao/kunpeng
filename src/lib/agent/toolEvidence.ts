const FIELD_PREFIXES: Record<string, string[]> = {
  read_file: ['路径:', '大小:', '修改时间:', '内容指纹:', '[未读完:', '[已读完:'],
  write_file: ['文件已写入并从实时磁盘回读校验:', '大小:', '修改时间:', '内容指纹:'],
  edit_file: ['文件已编辑并从实时磁盘回读校验:', '大小:', '修改时间:', '内容指纹:'],
  grep_search: ['扫描目录:', '正则引擎:', '搜索表达式:', '扫描时间:', '找到 ', '未找到匹配内容', '[结果超过 '],
  glob_search: ['根目录:', '扫描时间:', '找到 ', '未找到匹配的文件', '[未读完:', '[已读完:'],
  list_directory: ['根目录:', '扫描时间:', '深度:', '忽略规则:', '找到 ', '[未读完:', '[已读完:'],
};

function matchingLines(content: string, prefixes: string[]): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && prefixes.some((prefix) => line.startsWith(prefix)));
}

function bashEvidence(content: string): string[] {
  const lines = content.split('\n').map((line) => line.trim());
  const marker = lines.findIndex((line) => line === '[命令输出凭证]');
  if (marker < 0) {
    return lines.filter((line) => /output_id=|bash_read_output\(/.test(line)).slice(-4);
  }
  return lines.slice(marker + 1).filter(Boolean).slice(0, 6);
}

function compactConclusion(toolName: string, content: string): string {
  if (!content.trim() || toolName === 'read_file' || toolName === 'bash' || toolName === 'bash_command' || toolName === 'bash_read_output') return '';
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const picked = Object.fromEntries(
      ['success', 'status', 'path', 'outputPath', 'task_id', 'taskId', 'count', 'last_render_error', 'referenceCount', 'effectiveReferenceCount']
        .filter((key) => parsed[key] !== undefined)
        .map((key) => [key, parsed[key]]),
    );
    if (Object.keys(picked).length > 0) return JSON.stringify(picked).slice(0, 260);
  } catch {
    // Plain-text tool results are handled below.
  }
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
  const explicit = lines.find((line) => /^(?:结论|结果|状态|成功|失败|错误|已完成|已生成|已加入|已导出|验证|识别结果|任务状态)[：:]/.test(line));
  const fallbackAllowed = /(?:recognition|render_frame|capture|generate|task|export|timeline_|canvas_)/i.test(toolName);
  const chosen = explicit || (fallbackAllowed ? lines.find((line) => !/^\[.*\]$/.test(line)) : '');
  return chosen ? chosen.slice(0, 260) : '';
}

/** Keep provenance and continuation handles without retaining bulky tool content. */
export function buildToolEvidenceSummary(toolName: string | undefined, content: string): string {
  const name = toolName || 'tool';
  let evidence: string[] = [];
  if (name === 'bash' || name === 'bash_read_output' || name === 'bash_command') {
    evidence = bashEvidence(content);
  } else {
    const prefixes = FIELD_PREFIXES[name];
    if (prefixes) evidence = matchingLines(content, prefixes);
  }

  const unique = [...new Set(evidence)].slice(0, 8);
  const conclusion = compactConclusion(name, content);
  const rows = [...(conclusion ? [`关键结论: ${conclusion}`] : []), ...unique];
  const detail = rows.length > 0 ? `\n${rows.map((line) => `- ${line}`).join('\n')}` : '';
  return `[历史工具证据摘要 · ${name}] 原始正文 ${content.length} 字符已移出当前模型上下文；以下元信息可用于复核，不能替代实时状态。${detail}`;
}
