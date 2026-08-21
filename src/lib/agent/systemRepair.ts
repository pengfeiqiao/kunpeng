export const SYSTEM_REPAIR_PROMPT_EVENT = 'kunpeng-system-repair-prompt';

export interface SystemRepairPromptDetail {
  id: string;
  prompt: string;
}

/**
 * Ask the configured Kunpeng Agent to diagnose and repair a missing runtime.
 * The Agent still uses the normal tool-risk confirmation flow; the feature
 * only removes the need for users to manually explain the problem again.
 */
export function dispatchSystemRepairPrompt(prompt: string): void {
  window.dispatchEvent(new CustomEvent<SystemRepairPromptDetail>(SYSTEM_REPAIR_PROMPT_EVENT, {
    detail: { id: `repair-${Date.now()}`, prompt },
  }));
}

export const FFMPEG_REPAIR_PROMPT = `导演台导出前检测不到 FFmpeg。请作为系统维护 Agent 自动完成以下工作：
1. 先读取当前 macOS、CPU 架构、PATH、可用包管理器和已有 FFmpeg 状态，不要假定使用 brew，也不要写死安装方式。
2. 选择当前电脑最稳妥且影响最小的安装或修复方案；需要执行命令时使用 bash 工具并遵循正常确认流程。
3. 安装后验证 ffmpeg 和 ffprobe 均可调用，并确认支持 H.264 编码（优先 h264_videotoolbox，至少支持 libx264）。
4. 不修改用户项目文件，不卸载现有软件。完成后明确告诉用户可以回到导演台重新导出。`;

export function dreaminaLoginRepairPrompt(reason: string, taskContext?: string): string {
  return `即梦 Seedream 5.0 Pro 路由在提交前检测到 CLI 未安装、未登录或登录态失效。请作为系统维护 Agent 完成恢复：
1. 先运行 \`~/.local/bin/dreamina user_credit\` 检查安装和登录状态，不要提交任何付费生成任务。
2. 如果 CLI 不存在，使用官方安装入口 \`curl -fsSL https://jimeng.jianying.com/cli | bash\` 安装最新版；执行前遵循正常命令确认流程。
3. 如果未登录或凭证失效，运行 \`~/.local/bin/dreamina login\`。把命令输出的验证网址和用户代码清楚告诉用户，并保持命令运行直到授权完成；不要只发代码后就停止。
4. 登录命令完成后再次运行 \`~/.local/bin/dreamina user_credit\` 验证。成功时明确告诉用户“即梦已登录，可以重试刚才的生成”，失败则说明具体原因和下一步。
5. 登录恢复本身不调用生图，不消耗积分；不要修改项目文件或清理用户已有的即梦任务。

检测原因：${reason.slice(0, 600)}${taskContext ? `\n原任务：${taskContext.slice(0, 800)}` : ''}`;
}
