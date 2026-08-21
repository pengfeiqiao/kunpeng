/**
 * MCP (Model Context Protocol) 类型定义
 * JSON-RPC 2.0 + MCP 协议特定类型
 */

// ─── JSON-RPC 2.0 ───────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
  id?: number;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// ─── MCP Protocol ────────────────────────────────────────

/** MCP initialize 请求参数 */
export interface McpInitializeParams {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  clientInfo: {
    name: string;
    version: string;
  };
}

/** MCP initialize 响应 */
export interface McpInitializeResult {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  serverInfo: {
    name: string;
    version?: string;
  };
}

/** MCP 工具 schema（tools/list 返回） */
export interface McpToolSchema {
  name: string;
  description?: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
}

/** MCP tools/list 响应 */
export interface McpToolsListResult {
  tools: McpToolSchema[];
}

/** MCP tools/call 请求参数 */
export interface McpToolCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}

/** MCP tools/call 响应中的内容块 */
export interface McpContentBlock {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;       // base64 for image
  mimeType?: string;
  resource?: unknown;
}

/** MCP tools/call 响应 */
export interface McpToolCallResult {
  content: McpContentBlock[];
  isError?: boolean;
}

// ─── 服务器配置 ──────────────────────────────────────────

export interface McpServerConfig {
  /** 唯一标识 */
  id: string;
  /** 显示名称 */
  name: string;
  /** 工具名前缀（避免命名冲突） */
  prefix: string;
  /** 传输方式 */
  transport: 'http' | 'stdio';
  /** HTTP 传输的 URL */
  url?: string;
  /** stdio 传输的命令 */
  command?: string;
  /** stdio 传输的命令参数 */
  args?: string[];
  /** stdio 传输中 API Key 的环境变量名 */
  envKey?: string;
}
