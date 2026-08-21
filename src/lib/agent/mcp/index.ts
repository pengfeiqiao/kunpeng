import type { McpTransport } from './transport';
import type { McpServerConfig, McpToolsListResult } from './types';
import type { Tool } from '../types';
import { HttpTransport } from './httpTransport';
import { StdioTransport } from './stdioTransport';
import { createMcpTool } from './mcpToolAdapter';
import { agentLog } from '../logger';

export { MCP_SERVERS } from './servers';
export type { McpServerConfig } from './types';

/**
 * MCP 服务器管理器
 * 管理多个 MCP 服务器连接，发现并桥接工具到 ToolRegistry
 */
export class McpManager {
  private transports: Map<string, McpTransport> = new Map();
  private configs: McpServerConfig[];

  constructor(configs: McpServerConfig[]) {
    this.configs = configs;
  }

  /**
   * 初始化所有 MCP 服务器
   * 并行连接，失败的服务器跳过并记录错误
   * @returns 发现的所有工具 + 错误列表
   */
  async initialize(apiKey: string): Promise<{ tools: Tool[]; errors: string[] }> {
    const allTools: Tool[] = [];
    const errors: string[] = [];

    const results = await Promise.allSettled(
      this.configs.map((config) => this.initServer(config, apiKey)),
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const config = this.configs[i];

      if (result.status === 'fulfilled') {
        allTools.push(...result.value);
        agentLog.info('MCP', `${config.name}: ${result.value.length} tools loaded`);
      } else {
        const raw = result.reason instanceof Error ? result.reason.message : String(result.reason);
        // Truncate long error messages (ZhiPu returns full Java stack traces)
        const short = raw.length > 300 ? raw.slice(0, 300) + '…' : raw;
        const msg = `${config.name}: ${short}`;
        errors.push(msg);
        agentLog.error('MCP', msg);
      }
    }

    return { tools: allTools, errors };
  }

  /** 关闭所有连接 */
  async shutdown(): Promise<void> {
    const promises = Array.from(this.transports.values()).map((t) =>
      t.close().catch(() => {}),
    );
    await Promise.all(promises);
    this.transports.clear();
  }

  /**
   * 热重载：关闭所有连接，重新初始化
   * @returns 新的工具列表 + 错误列表
   */
  async reload(apiKey: string): Promise<{ tools: Tool[]; errors: string[] }> {
    agentLog.info('MCP', 'Reloading all servers...');
    await this.shutdown();
    return this.initialize(apiKey);
  }

  /** 获取已连接的服务器列表 */
  getConnectedServers(): string[] {
    return Array.from(this.transports.keys());
  }

  /** 获取配置列表 */
  getConfigs(): McpServerConfig[] {
    return this.configs;
  }

  // ─── Private ───────────────────────────────────────

  private async initServer(config: McpServerConfig, apiKey: string): Promise<Tool[]> {
    agentLog.info('MCP', `Connecting: ${config.name} (${config.transport})`);
    // 1. Create transport
    let transport: McpTransport;

    if (config.transport === 'http') {
      if (!config.url) throw new Error('HTTP transport requires url');
      transport = new HttpTransport(config.url, apiKey);
    } else {
      if (!config.command) throw new Error('Stdio transport requires command');
      const env: Record<string, string> = {};
      if (config.envKey) {
        env[config.envKey] = apiKey;
      }
      transport = new StdioTransport(config.command, config.args || [], env);
    }

    // 2. Connect (initialize handshake)
    await transport.connect();
    this.transports.set(config.id, transport);

    // 3. Discover tools via tools/list
    const response = await transport.request('tools/list');

    if (response.error) {
      throw new Error(`tools/list failed: ${response.error.message}`);
    }

    const toolsList = response.result as McpToolsListResult;

    if (!toolsList?.tools || !Array.isArray(toolsList.tools)) {
      agentLog.warn('MCP', `${config.name}: tools/list returned no tools`);
      return [];
    }

    // 4. Convert MCP tools to Tool objects
    // Debug: log tool schemas so we can see required params
    for (const schema of toolsList.tools) {
      agentLog.debug('MCP', `${config.name} tool: ${schema.name}`, {
        required: schema.inputSchema.required,
        properties: Object.keys(schema.inputSchema.properties || {}),
      });
    }
    return toolsList.tools.map((schema) =>
      createMcpTool(schema, config.prefix, transport),
    );
  }
}
