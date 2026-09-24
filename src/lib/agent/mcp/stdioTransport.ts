import { withCancellation } from './cancellation';
import { invoke } from '@tauri-apps/api/tauri';
import type { McpTransport } from './transport';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  McpInitializeParams,
} from './types';
import { MCP_PROTOCOL_VERSION } from './constants';

/**
 * MCP stdio 传输实现
 * 通过 Tauri IPC 调用 Rust 后端管理子进程
 */
export class StdioTransport implements McpTransport {
  private readonly serverId = crypto.randomUUID();
  private command: string;
  private args: string[];
  private env: Record<string, string>;
  private nextId = 1;
  private _connected = false;

  constructor(command: string, args: string[], env: Record<string, string>) {
    this.command = command;
    this.args = args;
    this.env = env;
  }

  get connected(): boolean {
    return this._connected;
  }

  async connect(): Promise<void> {
    // Step 1: Spawn the MCP server process
    await invoke('mcp_stdio_spawn', {
      serverId: this.serverId,
      command: this.command,
      args: this.args,
      env: this.env,
    });

    // Step 2: Send initialize request
    const initParams: McpInitializeParams = {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: 'kunpeng',
        version: '1.1.0',
      },
    };

    const initResponse = await this.request('initialize', initParams as unknown as Record<string, unknown>);

    if (initResponse.error) {
      await this.close();
      throw new Error(`MCP stdio initialize failed: ${initResponse.error.message}`);
    }

    // Step 3: Send initialized notification
    await this.sendRaw({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });

    this._connected = true;
  }

  async request(method: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<JsonRpcResponse> {
    const id = this.nextId++;

    const body: JsonRpcRequest = {
      jsonrpc: '2.0',
      method,
      id,
    };

    if (params !== undefined) {
      body.params = params;
    }

    const responseStr = await withCancellation(signal, () => invoke<string>('mcp_stdio_send', {
      serverId: this.serverId,
      message: JSON.stringify(body),
    }), () => this.sendRaw({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id, reason: 'Client cancelled' } }));

    try {
      const response = JSON.parse(responseStr) as JsonRpcResponse;
      if (response.id !== id || !('result' in response || 'error' in response)) throw new Error('Mismatched response');
      return response;
    } catch {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -1,
          message: 'Invalid or mismatched MCP stdio response',
        },
      };
    }
  }

  async close(): Promise<void> {
    this._connected = false;
    await invoke('mcp_stdio_kill', { serverId: this.serverId }).catch(() => {});
  }

  private async sendRaw(body: JsonRpcRequest): Promise<void> {
    await invoke<string>('mcp_stdio_send', {
      serverId: this.serverId,
      message: JSON.stringify(body),
    });
  }
}
