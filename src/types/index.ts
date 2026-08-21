export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinkingContent?: string;  // reasoning/thinking content from GLM-5
  attachments?: Attachment[];
  filePaths?: string[];   // local file/folder paths selected by user
  timestamp: number;
  workingContent?: string;   // streaming content accumulated during assistant work
  workingDuration?: number;  // working duration in seconds
  metadata?: Record<string, unknown>;  // tool executions, etc.
}

export interface Attachment {
  type: string;
  fileName: string;
  content: string; // base64
  size?: number;
}

export interface Session {
  id: string;
  title: string;
  agentId: string;
  channel?: string;   // 'feishu' | 'webchat' | undefined
  kind?: string;      // 'direct' | 'group' | undefined
  /** 绑定的 AIGC 项目（项目对话隔离）；普通对话为 undefined */
  projectId?: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  icon?: string;
  systemPrompt?: string;
}

export interface StreamChunk {
  type: 'text' | 'tool_use' | 'thinking' | 'heartbeat' | 'error' | 'done';
  content?: string;
  toolName?: string;
  toolInput?: unknown;
}
