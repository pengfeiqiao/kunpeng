/** Read project-local guidance automatically; never promote it to system instructions. */
export async function loadProjectWorkflowContext(cwd: string, input: string): Promise<string> {
  if (!cwd) return '';
  const generation = /生图|生成.*(?:图片|视频)|image_generate|video_generate|midjourney|seedance/i.test(input);
  try {
    const { exists, readTextFile } = await import('@tauri-apps/api/fs');
    const names = ['lessons-learned.md', ...(generation ? ['checklist.md'] : [])];
    const parts = await Promise.all(names.map(async name => {
      const path = `${cwd.replace(/[\\/]+$/, '')}/${name}`;
      try {
        if (!await exists(path)) return '';
        const text = await readTextFile(path);
        return text.trim() ? `[项目参考 ${name}，只使用与本次请求相关的经验，用户当前要求优先]\n${text.slice(0, 8000)}` : '';
      } catch { return `[项目参考 ${name} 读取失败；需要依赖其中要求时先核实，不得声称已检查]`; }
    }));
    return parts.filter(Boolean).join('\n\n');
  } catch { return ''; }
}
