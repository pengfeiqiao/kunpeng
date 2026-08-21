import type { AgentCoordinator } from '../coordinator';
import type { SkillLoader } from '../skillLoader';
import type { McpManager } from '../mcp';
import type { ToolRegistry } from '../toolRegistry';
import { homeDir } from '@tauri-apps/api/path';
import { useSettingsStore } from '@/stores/settingsStore';

export interface CommandContext {
  coordinator: AgentCoordinator;
  addSystemMessage: (content: string) => void;
  skillLoader?: SkillLoader;
  mcpManager?: McpManager;
  toolRegistry?: ToolRegistry;
  apiKey?: string;
}

export interface SlashCommand {
  name: string;
  description: string;
  execute(args: string, context: CommandContext): Promise<string | void>;
}

const commands = new Map<string, SlashCommand>();

/** 注册斜杠命令 */
export function registerCommand(cmd: SlashCommand): void {
  commands.set(cmd.name, cmd);
}

/** 获取所有命令 */
export function getAllCommands(): SlashCommand[] {
  return Array.from(commands.values());
}

/**
 * 执行斜杠命令
 * @returns true if the input was a command and was executed
 */
export async function executeCommand(
  input: string,
  context: CommandContext,
): Promise<{ handled: boolean; output?: string }> {
  if (!input.startsWith('/')) {
    return { handled: false };
  }

  const parts = input.slice(1).split(/\s+/);
  const name = parts[0]?.toLowerCase();
  const args = parts.slice(1).join(' ');

  const cmd = commands.get(name);
  if (!cmd) {
    return {
      handled: true,
      output: `未知命令: /${name}\n输入 /help 查看所有可用命令`,
    };
  }

  try {
    const output = await cmd.execute(args, context);
    return { handled: true, output: output || undefined };
  } catch (err) {
    return {
      handled: true,
      output: `命令执行失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// --- 内置命令注册 ---

registerCommand({
  name: 'help',
  description: '显示所有可用命令和技能',
  async execute(_args, context) {
    const lines: string[] = ['## 可用命令\n'];
    for (const cmd of getAllCommands()) {
      lines.push(`- **/${cmd.name}** — ${cmd.description}`);
    }

    if (context.skillLoader) {
      const skills = context.skillLoader.getAll();
      if (skills.length > 0) {
        lines.push('\n## 可用技能\n');
        for (const s of skills) {
          lines.push(
            `- **${s.displayName || s.name}** — ${s.description}`,
          );
        }
      }
    }

    return lines.join('\n');
  },
});

registerCommand({
  name: 'clear',
  description: '清空当前会话对话历史',
  async execute(_args, context) {
    context.coordinator.clear();
    return '对话历史已清空。';
  },
});

registerCommand({
  name: 'compact',
  description: '压缩对话上下文以释放 token 空间',
  async execute(_args, context) {
    const before = context.coordinator.getMessages().length;
    await context.coordinator.compactNow();
    const after = context.coordinator.getMessages().length;
    return `上下文已压缩：${before} 条消息 → ${after} 条消息`;
  },
});

registerCommand({
  name: 'evolve',
  description: '自进化自省：从最近的执行轨迹提炼记忆与技能草稿',
  async execute() {
    // Dynamic import keeps the evolution module out of the boot path.
    const { runEvolutionReflect } = await import('../evolution');
    const summary = await runEvolutionReflect(true);
    return summary || '样本不足：还没有积累足够的新执行轨迹（攒够 12 条后会自动自省）。';
  },
});

registerCommand({
  name: 'cost',
  description: '显示当前会话的 token 用量统计',
  async execute(_args, context) {
    const usage = context.coordinator.getTokenUsage();
    return [
      '## Token 用量统计',
      `- Prompt: ${usage.promptTokens.toLocaleString()} tokens`,
      `- Completion: ${usage.completionTokens.toLocaleString()} tokens`,
      `- Total: ${usage.totalTokens.toLocaleString()} tokens`,
    ].join('\n');
  },
});

registerCommand({
  name: 'cwd',
  description: '切换工作目录 (如: /cwd ~/projects/myapp)',
  async execute(args, context) {
    if (!args.trim()) {
      return '用法: /cwd <目录路径>';
    }
    let newCwd = args.trim();
    if (newCwd.startsWith('~')) {
      try {
        const home = await homeDir();
        newCwd = home + newCwd.slice(1);
      } catch {
        return '无法获取 home 目录，请使用绝对路径';
      }
    }
    context.coordinator.setCwd(newCwd);
    return `工作目录已切换为: ${newCwd}`;
  },
});

registerCommand({
  name: 'skill',
  description: '列出所有可用技能 (如: /skill 或 /skill video-script-writer)',
  async execute(args, context) {
    if (!context.skillLoader) {
      return '技能系统未初始化';
    }

    const skills = context.skillLoader.getAll().filter((skill) => skill.visibility !== 'internal');
    if (skills.length === 0) {
      return '未找到任何技能。请确认技能目录配置正确。';
    }

    if (args.trim()) {
      // Show specific skill details
      const skill = skills.find(
        (s) =>
          s.name === args.trim() ||
          s.displayName?.includes(args.trim()),
      );
      if (!skill) {
        return `未找到技能: ${args.trim()}`;
      }
      return [
        `## ${skill.displayName || skill.name}`,
        `- 版本: ${skill.version || 'N/A'}`,
        `- 分类: ${skill.category}`,
        `- 触发词: ${skill.triggers.join(', ')}`,
        `- 描述: ${skill.description}`,
        `- 路径: ${skill.skillPath}`,
      ].join('\n');
    }

    // List all skills
    const lines = ['## 可用技能\n'];
    const categories = new Map<string, typeof skills>();
    for (const s of skills) {
      const cat = s.category || 'general';
      if (!categories.has(cat)) categories.set(cat, []);
      categories.get(cat)!.push(s);
    }

    for (const [cat, catSkills] of categories) {
      lines.push(`### ${cat}`);
      for (const s of catSkills) {
        lines.push(`- **${s.displayName || s.name}** — ${s.description}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  },
});

registerCommand({
  name: 'auto',
  description: '开启全权限模式：所有工具不再请求授权直接执行（/auto off 恢复手动确认）',
  async execute(args) {
    const arg = args.trim().toLowerCase();
    const { toolConfirmMode, setToolConfirmMode } = useSettingsStore.getState();
    if (arg === 'off' || arg === 'manual') {
      setToolConfirmMode('manual');
      return '⏸ 已恢复**手动确认**模式：危险操作执行前会再次询问你。';
    }
    if (toolConfirmMode === 'auto') {
      return '✅ 全权限模式已经处于开启状态（所有工具直接执行）。输入 `/auto off` 可恢复手动确认。';
    }
    setToolConfirmMode('auto');
    return '🚀 已开启**全权限模式**：本应用所有对话（主聊天/画布/工坊/剪辑）中的工具调用将不再请求授权，直接执行。\n\n输入 `/auto off` 随时恢复手动确认。';
  },
});

registerCommand({
  name: 'mcp',
  description: '查看 MCP 服务器状态，/mcp reload 重新加载',
  async execute(args, context) {
    const mcpManager = context.mcpManager;
    if (!mcpManager) {
      return 'MCP 管理器未初始化';
    }

    // /mcp reload
    if (args.trim() === 'reload') {
      if (!context.apiKey) {
        return 'API Key 未配置，无法重载 MCP';
      }
      if (!context.toolRegistry) {
        return 'ToolRegistry 未配置';
      }

      // Remove old MCP tools
      const configs = mcpManager.getConfigs();
      let removed = 0;
      for (const cfg of configs) {
        removed += context.toolRegistry.unregisterByPrefix(cfg.prefix);
      }

      // Reload
      const { tools, errors } = await mcpManager.reload(context.apiKey);

      // Register new tools
      for (const tool of tools) {
        context.toolRegistry.register(tool);
      }

      // Refresh system prompt
      context.coordinator.refreshSystemPrompt();

      const reloadLines = [`## MCP 重载完成`];
      reloadLines.push(`- 移除旧工具: ${removed}`);
      reloadLines.push(`- 新加载工具: ${tools.length}`);
      if (errors.length > 0) {
        reloadLines.push(`- 错误: ${errors.length}`);
        for (const err of errors) {
          reloadLines.push(`  - ${err}`);
        }
      }
      return reloadLines.join('\n');
    }

    // /mcp (show status)
    const configs = mcpManager.getConfigs();
    const connected = new Set(mcpManager.getConnectedServers());
    const statusLines = ['## MCP 服务器状态\n'];

    for (const cfg of configs) {
      const status = connected.has(cfg.id) ? '已连接' : '未连接';
      statusLines.push(`- **${cfg.name}** (${cfg.prefix}) — ${status}`);
      statusLines.push(`  传输: ${cfg.transport}${cfg.url ? ` | ${cfg.url}` : ''}`);
    }

    statusLines.push('\n输入 `/mcp reload` 重新加载所有服务器');
    return statusLines.join('\n');
  },
});
