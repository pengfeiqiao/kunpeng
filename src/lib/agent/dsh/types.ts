import type { AgentUserContentBlock, CoordinatorCallbacks } from '../types';
import type { ToolRegistry } from '../toolRegistry';

export interface DshStartOptions {
  runId: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  persona: string;
  workspace: string;
  maxTokens?: number;
  contextWindow?: number;
  httpProxy?: string;
  httpsProxy?: string;
}

export interface DshRunOptions extends DshStartOptions {
  input: string;
  mediaBlocks?: AgentUserContentBlock[];
  toolRegistry: ToolRegistry;
  callbacks: CoordinatorCallbacks;
  signal?: AbortSignal;
}

export interface DshRunResult {
  text: string;
  thinking: string;
  visibleOutput: boolean;
  stopReason?: string;
}

export interface DshAcpLineEvent {
  runId: string;
  instanceId: string;
  line: string;
}

export interface DshHarnessEvent {
  runId: string;
  instanceId: string;
  event: Record<string, unknown>;
}

export interface DshToolCallEvent {
  runId: string;
  instanceId: string;
  requestId: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface DshToolCancelEvent {
  runId: string;
  instanceId: string;
  requestId: string;
}

export type AcpContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource_link'; uri: string; name: string; mimeType?: string };
