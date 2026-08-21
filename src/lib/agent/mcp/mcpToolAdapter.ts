import type { McpTransport } from './transport';
import type { McpToolSchema, McpToolCallResult } from './types';
import type { Tool, ToolDefinition, ToolResult } from '../types';
import { agentLog } from '../logger';

/**
 * 将 MCP inputSchema.properties 转为 ToolDefinition 的 parameters.properties 格式
 * MCP 使用完整 JSON Schema，ToolDefinition 使用简化的 { type, description, enum, default }
 */
function convertProperties(
  props: Record<string, unknown> | undefined,
): Record<string, { type: string; description?: string; enum?: string[]; default?: unknown }> {
  if (!props) return {};

  const result: Record<string, { type: string; description?: string; enum?: string[]; default?: unknown }> = {};

  for (const [key, schema] of Object.entries(props)) {
    const s = schema as Record<string, unknown>;

    let type = 'string';
    if (typeof s.type === 'string') {
      type = s.type;
    } else if (Array.isArray(s.type)) {
      // e.g. ["string", "null"] → "string"
      type = s.type.find((t: string) => t !== 'null') || 'string';
    }

    const prop: { type: string; description?: string; enum?: string[]; default?: unknown } = { type };

    if (typeof s.description === 'string') {
      prop.description = s.description;
    }

    if (Array.isArray(s.enum)) {
      prop.enum = s.enum.map(String);
    }

    if (s.default !== undefined) {
      prop.default = s.default;
    }

    result[key] = prop;
  }

  return result;
}

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
    parameters: {
      type: 'object',
      properties: convertProperties(schema.inputSchema.properties),
      required: schema.inputSchema.required,
    },
  };

  return {
    definition,
    async execute(params: Record<string, unknown>): Promise<ToolResult> {
      try {
        agentLog.info('MCP-Tool', `→ ${prefixedName}`, params);
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

        return { success: true, output: output || '(no output)' };
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
