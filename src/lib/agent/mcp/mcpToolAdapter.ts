import type { McpTransport } from './transport';
import type { McpToolSchema, McpToolCallResult } from './types';
import type { Tool, ToolDefinition, ToolResult } from '../types';
import { agentLog } from '../logger';

/**
 * 将 MCP 工具 schema 转为 ToolRegistry 兼容的 Tool 对象
 */
export function createMcpTool(
  schema: McpToolSchema,
  prefix: string,
  transport: McpTransport,
): Tool {
  const prefixedName = `${prefix}_${schema.name}`;

  const definition: ToolDefinition = {
    name: prefixedName,
    description: schema.description || prefixedName,
    // Retain nested arrays/objects, unions and numeric enums from MCP.
    parameters: structuredClone({ ...schema.inputSchema, properties: schema.inputSchema.properties ?? {} }) as ToolDefinition['parameters'],
  };

  return {
    definition,
    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      try {
        agentLog.info('MCP-Tool', `→ ${prefixedName}`);
        const response = await transport.request('tools/call', {
          name: schema.name, // 用原始名，不带前缀
          arguments: params,
        });

        if (response.error) {
          agentLog.error('MCP-Tool', `← ${prefixedName} error [${response.error.code}]`, response.error.message);
          return {
            success: false,
            output: '',
            error: `MCP error [${response.error.code}]: ${response.error.message}`,
          };
        }

        const result = response.result as McpToolCallResult;

        if (result.isError) {
          const errorText = result.content
            .map((c) => c.text || '')
            .filter(Boolean)
            .join('\n');
          agentLog.error('MCP-Tool', `← ${prefixedName} isError`, errorText);
          return {
            success: false,
            output: '',
            error: errorText || 'MCP tool returned an error',
          };
        }

        // Concatenate all content blocks
        const output = result.content
          .map((c) => {
            if (c.type === 'text' && c.text) return c.text;
            if (c.type === 'image') return `[image: ${c.mimeType || 'unknown'}]`;
            return '';
          })
          .filter(Boolean)
          .join('\n');

        const media: NonNullable<ToolResult['media']> = result.content.flatMap(block =>
          block.type === 'image' && block.data && block.mimeType && ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(block.mimeType)
            ? [{ type: 'image' as const, source: { type: 'base64' as const, media_type: block.mimeType, data: block.data } }] : []);
        return { success: true, output: output || '(no output)', ...(media.length ? { media } : {}) };
      } catch (err) {
        agentLog.error('MCP-Tool', `← ${prefixedName} transport error`, err);
        return {
          success: false,
          output: '',
          error: `MCP transport error: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}
