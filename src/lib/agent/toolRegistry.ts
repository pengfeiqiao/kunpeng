import type { Tool, ToolDefinition, ToolResult } from './types';
import { agentLog } from './logger';
import { isToolEnabled } from './toolGating';
import { useChatStore } from '@/stores/chatStore';

const TOOL_TEXT_DESCRIPTION_LIMIT = 900;
const TOOL_TEXT_PARAM_DESCRIPTION_LIMIT = 220;

function trimForPrompt(text: string | undefined, limit: number): string {
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, limit)}...（详见 function schema，按需调用工具获取完整说明）` : text;
}

function viewHintForTool(name: string): string | null {
  const activeView = useChatStore.getState().activeView;
  if (name.startsWith('timeline_')) return `工具 ${name} 属于「剪辑」视图，当前视图是「${activeView}」。请先让用户切到剪辑，或改用当前视图可用工具。`;
  if (name.startsWith('workshop_')) return `工具 ${name} 属于「工坊」视图，当前视图是「${activeView}」。请先让用户切到工坊，或改用当前视图可用工具。`;
  if (name.startsWith('copywriting_')) return `工具 ${name} 属于「文案」视图，当前视图是「${activeView}」。请先让用户切到文案，或改用当前视图可用工具。`;
  if (name.startsWith('canvas_')) return `工具 ${name} 通常用于「画布」视图；当前视图是「${activeView}」。如果工具不可见，请切到画布后重试。`;
  if (name.startsWith('director_')) return `工具 ${name} 仅在白模导演台打开时可用；当前视图是「${activeView}」。`;
  return null;
}

/**
 * 工具注册表 — 管理所有可用工具
 */
export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool): void {
    this.tools.set(tool.definition.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** 移除名称以指定前缀开头的所有工具（用于 MCP 热重载） */
  unregisterByPrefix(prefix: string): number {
    let count = 0;
    for (const name of Array.from(this.tools.keys())) {
      if (name.startsWith(prefix + '_') || name.startsWith(prefix)) {
        this.tools.delete(name);
        count++;
      }
    }
    return count;
  }

  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * 为单个远程会话创建隔离的注册表。工具实现本身保持共享，但会话临时
   * 工具（例如 send_file_to_user）不会再覆盖其他联系人的目标上下文。
   */
  clone(): ToolRegistry {
    const registry = new ToolRegistry();
    for (const tool of this.tools.values()) registry.register(tool);
    return registry;
  }

  /** 运行期对模型可见的工具（应用 toolGating 门控） */
  getEnabled(): Tool[] {
    return this.getAll().filter((t) => isToolEnabled(t.definition.name));
  }

  /** 获取所有工具定义 (用于传给 GLM API) */
  getDefinitions(): ToolDefinition[] {
    return this.getEnabled().map((t) => t.definition);
  }

  /** 执行工具 */
  async execute(
    name: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      agentLog.warn('Tool', `Unknown tool: ${name}`);
      const hint = viewHintForTool(name);
      return {
        success: false,
        output: '',
        error: hint ? `Unknown tool: ${name}. ${hint}` : `Unknown tool: ${name}`,
      };
    }

    const start = Date.now();
    agentLog.info('Tool', `→ ${name}`, params);

    try {
      const result = await tool.execute(params, signal);
      const ms = Date.now() - start;
      if (result.success) {
        agentLog.info('Tool', `← ${name} OK (${ms}ms, ${result.output.length} chars)`);
      } else {
        agentLog.error('Tool', `← ${name} FAIL (${ms}ms): ${result.error}`);
      }
      return result;
    } catch (err) {
      const ms = Date.now() - start;
      const msg = err instanceof Error ? err.message : String(err);
      agentLog.error('Tool', `← ${name} THROW (${ms}ms): ${msg}`);
      return {
        success: false,
        output: '',
        error: msg,
      };
    }
  }

  /** 获取工具描述文本 (用于系统提示词) */
  getDescriptionText(): string {
    return this.getEnabled()
      .map((t) => {
        const params = Object.entries(t.definition.parameters.properties || {})
          .map(([k, v]) => `    - ${k} (${v.type}): ${trimForPrompt(v.description, TOOL_TEXT_PARAM_DESCRIPTION_LIMIT)}`)
          .join('\n');
        const required = t.definition.parameters.required?.join(', ') || '';
        return `- **${t.definition.name}**: ${trimForPrompt(t.definition.description, TOOL_TEXT_DESCRIPTION_LIMIT)}\n  参数:\n${params}\n  必填: ${required}`;
      })
      .join('\n\n');
  }
}

// Import all built-in tools
import { bashReadOutputTool, bashTool } from './tools/bashTool';
import { readTool } from './tools/readTool';
import { writeTool } from './tools/writeTool';
import { editTool } from './tools/editTool';
import { globTool } from './tools/globTool';
import { grepTool } from './tools/grepTool';
import { listDirectoryTool } from './tools/listDirectoryTool';
import { allCanvasTools } from './tools/canvasTools';
import {
  canvasGenerateBatchTool,
  canvasGenerateTool,
  mgReferenceVideoGenerateTool,
  mgTextFallbackGenerateTool,
} from './tools/canvasGenerateTool';
import { canvasTranscribeTool } from './tools/canvasTranscribeTool';
import { allTimelineTools } from './tools/timelineTools';
import { allWorkshopTools } from './tools/workshopTools';
import { askUserQuestionTool } from './tools/askUserQuestionTool';
import { skillInvokeTool } from './tools/skillInvokeTool';
import { webFetchTool } from './tools/webFetchTool';
import { webSearchTool } from './tools/webSearchTool';
import { browserControlTool } from './tools/browserTool';
import { visionTool } from './tools/visionTool';
import { sleepTool, scheduleCronTool } from './tools/scheduleCronTool';
import { aigcOptimizePromptTool } from './tools/genTools';
import { allTouliuTools } from './tools/touliuTools';
import { doubaoSpeechGenerateTool } from './tools/doubaoSpeechTool';
import { allCopywritingTools } from './tools/copywritingTools';
import { allProjectTools } from './tools/projectTools';
import { allAppTools } from './tools/appTools';
import { allDirectorTools } from './tools/directorTools';
import { taskStatusTool } from './tools/taskStatusTool';
import { allStoryboardTools } from './tools/storyboardTools';
import { videoGenerateTool } from './tools/videoGenerateTool';
import { imageGenerateTool } from './tools/imageGenerateTool';
import { memoryWriteTool } from './tools/memoryTool';
import { apimartRouteStatusTool } from './tools/apimartRouteTool';

/** 创建包含所有内置工具的默认注册表 */
export function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(bashTool);
  registry.register(bashReadOutputTool);
  registry.register(readTool);
  registry.register(writeTool);
  registry.register(editTool);
  registry.register(globTool);
  registry.register(grepTool);
  registry.register(listDirectoryTool);
  // Tier 3 new tools
  registry.register(askUserQuestionTool);
  registry.register(skillInvokeTool);
  registry.register(webFetchTool);
  registry.register(webSearchTool);
  registry.register(browserControlTool);
  registry.register(visionTool);
  registry.register(sleepTool);
  registry.register(scheduleCronTool);
  registry.register(taskStatusTool);
  registry.register(memoryWriteTool);
  registry.register(videoGenerateTool);
  registry.register(imageGenerateTool);
  registry.register(apimartRouteStatusTool);
  for (const tool of allAppTools) {
    registry.register(tool);
  }
  for (const tool of allCanvasTools) {
    registry.register(tool);
  }
  registry.register(canvasGenerateTool);
  registry.register(canvasGenerateBatchTool);
  registry.register(mgReferenceVideoGenerateTool);
  registry.register(mgTextFallbackGenerateTool);
  registry.register(canvasTranscribeTool);
  registry.register(doubaoSpeechGenerateTool);
  for (const tool of allTimelineTools) {
    registry.register(tool);
  }
  for (const tool of allWorkshopTools) {
    registry.register(tool);
  }
  for (const tool of allStoryboardTools) {
    registry.register(tool);
  }
  for (const tool of allCopywritingTools) {
    registry.register(tool);
  }
  for (const tool of allProjectTools) {
    registry.register(tool);
  }
  for (const tool of allDirectorTools) {
    registry.register(tool);
  }
  registry.register(aigcOptimizePromptTool);
  for (const tool of allTouliuTools) {
    registry.register(tool);
  }
  return registry;
}
