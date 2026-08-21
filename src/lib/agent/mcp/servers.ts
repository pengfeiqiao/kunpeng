import type { McpServerConfig } from './types';

/**
 * 已弃用：原 4 个智谱 MCP（联网搜索 / 网页读取 / 开源仓库 / 智谱视觉）
 * 已迁移为 DMXAPI 内置 API 工具：
 *   - web_search（perplexity 主 + Tencent 备）  → tools/webSearchTool.ts
 *   - image_recognition（doubao 主 + qwen 备）   → tools/visionTool.ts
 *   - 网页读取 → 内置 web_fetch；开源仓库 → 舍弃
 * 保留空数组，McpManager 框架仍在但不连任何外置服务。
 */
export const MCP_SERVERS: McpServerConfig[] = [];
