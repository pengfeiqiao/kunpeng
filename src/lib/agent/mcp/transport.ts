import type { JsonRpcResponse } from './types';

/**
 * MCP Transport 抽象接口
 * 支持 HTTP 和 stdio 两种传输方式
 */
export interface McpTransport {
  /** 建立连接（initialize 握手） */
  connect(): Promise<void>;

  /** 发送 JSON-RPC 请求并获取响应 */
  request(method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse>;

  /** 关闭连接 / 清理资源 */
  close(): Promise<void>;

  /** 当前是否已连接 */
  readonly connected: boolean;
}
