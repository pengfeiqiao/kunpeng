import type { McpTransport } from './transport';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  McpInitializeParams,
} from './types';
import { agentLog } from '../logger';
import { fetch as tauriFetch, Body, ResponseType } from '@tauri-apps/api/http';
import { MCP_PROTOCOL_VERSION } from './constants';

/**
 * MCP HTTP Streamable 传输实现
 * 使用 Tauri HTTP 客户端绕过 WebView CORS 限制（浏览器 fetch 无法读取 mcp-session-id 响应头）
 */
export class HttpTransport implements McpTransport {
  private url: string;
  private apiKey: string;
  private sessionId: string | null = null;
  private nextId = 1;
  private _connected = false;

  constructor(url: string, apiKey: string) {
    this.url = url;
    this.apiKey = apiKey;
  }

  get connected(): boolean {
    return this._connected;
  }

  async connect(): Promise<void> {
    // Step 1: initialize
    const initParams: McpInitializeParams = {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: 'kunpeng',
        version: '1.1.0',
      },
    };

    const initResponse = await this.rawRequest('initialize', initParams as unknown as Record<string, unknown>);

    if (initResponse.error) {
      throw new Error(`MCP initialize failed: ${initResponse.error.message}`);
    }

    // Step 2: send initialized notification (no id = notification)
    await this.sendNotification('notifications/initialized');

    this._connected = true;
  }

  async request(method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse> {
    if (!this._connected) {
      // Auto-reconnect on session expiration
      await this.connect();
    }

    const response = await this.rawRequest(method, params);

    if (response.error && response.error.code === -32600) {
      agentLog.warn('MCP-HTTP', `Session expired for ${this.url}, reconnecting...`);
      this._connected = false;
      this.sessionId = null;
      await this.connect();
      return this.rawRequest(method, params);
    }

    return response;
  }

  async close(): Promise<void> {
    this._connected = false;
    this.sessionId = null;
  }

  // ─── Private ───────────────────────────────────────

  private async rawRequest(method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse> {
    const id = this.nextId++;

    const body: JsonRpcRequest = {
      jsonrpc: '2.0',
      method,
      id,
    };

    if (params !== undefined) {
      body.params = params;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Authorization': `Bearer ${this.apiKey}`,
    };

    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId;
    }

    agentLog.debug('MCP-HTTP', `→ ${method} id=${id} session=${this.sessionId || 'none'}`);

    // Use Tauri HTTP client to bypass WebView CORS restrictions
    // (browser fetch can't read mcp-session-id header without Access-Control-Expose-Headers)
    const res = await tauriFetch(this.url, {
      method: 'POST',
      headers,
      body: Body.json(body),
      responseType: ResponseType.Text,
    });

    // Extract session ID from response headers (Tauri headers are Record<string, string>)
    const newSessionId = res.headers['mcp-session-id'];
    if (newSessionId) {
      this.sessionId = newSessionId;
      agentLog.debug('MCP-HTTP', `Session ID: ${newSessionId}`);
    }

    if (!res.ok) {
      const text = typeof res.data === 'string' ? res.data : '';
      // Truncate long error bodies (ZhiPu returns full Java stack traces)
      const short = text.length > 200 ? text.slice(0, 200) + '…' : text;
      agentLog.error('MCP-HTTP', `${method} → HTTP ${res.status}: ${short || 'unknown'}`);
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: res.status,
          message: `HTTP ${res.status}: ${text || 'unknown'}`,
        },
      };
    }

    const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    const contentType = res.headers['content-type'] || '';

    // Handle SSE responses (ZhiPu MCP returns text/event-stream)
    if (contentType.includes('text/event-stream')) {
      return this.parseSSEText(text, id);
    }

    // Standard JSON response
    let json: unknown;
    try {
      json = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    } catch {
      agentLog.error('MCP-HTTP', `${method} → invalid JSON: ${text.slice(0, 200)}`);
      return { jsonrpc: '2.0', id, error: { code: -1, message: 'Invalid JSON response' } };
    }

    const obj = json as Record<string, unknown>;

    // Handle ZhiPu non-standard error format: HTTP 200 + {"code":401,"msg":"...","success":false}
    if (obj && typeof obj.code === 'number' && obj.success === false && !obj.jsonrpc) {
      agentLog.error('MCP-HTTP', `${method} → ZhiPu error [${obj.code}]: ${obj.msg}`);
      return {
        jsonrpc: '2.0',
        id,
        error: { code: obj.code as number, message: (obj.msg as string) || `ZhiPu error ${obj.code}` },
      };
    }

    // MCP may return an array of JSON-RPC responses; take the one matching our id
    if (Array.isArray(json)) {
      const match = (json as JsonRpcResponse[]).find((r) => r.id === id);
      return match || json[0] || { jsonrpc: '2.0', id, error: { code: -1, message: 'Empty response array' } };
    }

    return json as JsonRpcResponse;
  }

  private async sendNotification(method: string, params?: Record<string, unknown>): Promise<void> {
    const body: JsonRpcRequest = {
      jsonrpc: '2.0',
      method,
    };

    if (params !== undefined) {
      body.params = params;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Authorization': `Bearer ${this.apiKey}`,
    };

    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId;
    }

    // Notifications don't expect a meaningful response
    await tauriFetch(this.url, {
      method: 'POST',
      headers,
      body: Body.json(body),
      responseType: ResponseType.Text,
    }).catch(() => {});
  }

  private parseSSEText(text: string, requestId: number): JsonRpcResponse {
    // Some servers return JSON-RPC directly with SSE content-type — try parsing as plain JSON first
    try {
      const json = JSON.parse(text);
      if (json.jsonrpc === '2.0') {
        return json as JsonRpcResponse;
      }
      if (Array.isArray(json)) {
        const match = (json as JsonRpcResponse[]).find((r) => r.id === requestId);
        return match || json[0] || { jsonrpc: '2.0', id: requestId, error: { code: -1, message: 'Empty response array' } };
      }
    } catch {
      // Not plain JSON, continue with SSE parsing
    }

    // Standard SSE parsing: look for "data:" lines
    const lines = text.split('\n');
    let dataBuffer = '';

    for (const line of lines) {
      if (line.startsWith('data: ') || line.startsWith('data:')) {
        const data = line.startsWith('data: ') ? line.slice(6).trim() : line.slice(5).trim();
        if (data === '[DONE]') continue;

        if (dataBuffer) dataBuffer += '\n';
        dataBuffer += data;
      } else if (line.trim() === '' && dataBuffer) {
        try {
          const json = JSON.parse(dataBuffer);
          if (json.jsonrpc === '2.0') {
            return json as JsonRpcResponse;
          }
        } catch {
          // Skip malformed events
        }
        dataBuffer = '';
      }
    }

    // Try parsing any remaining buffered data
    if (dataBuffer) {
      try {
        const json = JSON.parse(dataBuffer);
        if (json.jsonrpc === '2.0') {
          return json as JsonRpcResponse;
        }
      } catch {
        // ignore
      }
    }

    return {
      jsonrpc: '2.0',
      id: requestId,
      error: { code: -1, message: 'No valid JSON-RPC response in SSE stream' },
    };
  }
}
