// Agent 引擎模块导出
export { GLMClient, type GLMClientConfig } from './glmClient';
export { AgentCoordinator, repairToolPairingSnapshot, type CoordinatorConfig } from './coordinator';
export { ToolRegistry, createDefaultRegistry } from './toolRegistry';
export { SkillLoader, getSharedSkillLoader, type AgentSkillManifest, type SkillLoaderAdapter } from './skillLoader';
export { buildSystemPrompt } from './systemPrompt';
export { executeCommand } from './commands/index';
export { createBackgroundTaskTool } from './tools/backgroundTaskTool';
export { createTodoWriteTool } from './tools/todoWriteTool';
export { McpManager, MCP_SERVERS } from './mcp';
export { aigcOptimizePromptTool } from './tools/genTools';
export {
  buildDirectorContext,
  loadAllDirectors,
  loadDirector,
  matchDirector,
} from './directorInjector';
export type { DirectorDNA } from './directorInjector';
export { runConsolidation, shouldRunConsolidation } from './autoDream';
export type { ConsolidationResult } from './autoDream';
export type {
  Tool,
  ToolDefinition,
  ToolResult,
  ToolCall,
  ToolExecution,
  ToolRisk,
  AgentMessage,
  AgentUserContentBlock,
  CoordinatorCallbacks,
  TokenUsage,
} from './types';
