export type ChatModelOption = {
  value: string;
  label: string;
  detail: string;
};

export type AgentWorkspaceScope = 'canvas' | 'workshop' | 'editor';

export const CHAT_MODELS: Record<string, ChatModelOption[]> = {
  glm: [
    { value: 'glm-5.3', label: 'GLM 5.3', detail: '最新旗舰 · 1M 上下文' },
    { value: 'glm-5.2', label: 'GLM 5.2', detail: '综合创作与工具调用' },
    { value: 'glm-5.1', label: 'GLM 5.1', detail: '兼容备用模型' },
  ],
  deepseek: [
    { value: 'deepseek-v4-flash-vision-exp', label: 'DeepSeek V4 Vision', detail: '默认 · 原生识图（实验）' },
    { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', detail: '复杂推理与长任务' },
    { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', detail: '快速响应' },
    { value: 'deepseek-chat', label: 'DeepSeek Chat', detail: '通用对话' },
    { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner', detail: '深度推理' },
  ],
  kimi: [
    { value: 'k3[1m]', label: 'Kimi K3 1M', detail: '多模态与 1M 长上下文' },
    { value: 'k3', label: 'Kimi K3', detail: '多模态推理与 256K 上下文' },
  ],
  minimax: [
    { value: 'MiniMax-M3', label: 'MiniMax M3', detail: '旗舰 · 1M 上下文 · 多模态输入' },
    { value: 'MiniMax-M2.7', label: 'MiniMax M2.7', detail: '上一代主力 · 204K' },
    { value: 'MiniMax-M2.5', label: 'MiniMax M2.5', detail: '高性价比 · 204K' },
  ],
  qwen: [
    { value: 'qwen3.8-max', label: 'Qwen 3.8 Max', detail: '旗舰 · 1M 上下文 · 原生视觉' },
    { value: 'qwen3.7-max', label: 'Qwen 3.7 Max', detail: '上代旗舰 · 1M' },
    { value: 'qwen3.7-plus', label: 'Qwen 3.7 Plus', detail: '均衡性价比' },
  ],
  doubao: [
    { value: 'doubao-seed-2-1-pro-260628', label: '豆包 Seed 2.1 Pro', detail: '旗舰 · 256K · 编程/Agent' },
    { value: 'doubao-seed-2-0-lite-260428', label: '豆包 Seed 2.0 Lite', detail: '轻量低成本 · 256K' },
  ],
};

export const CHAT_PROVIDER_LABELS: Record<string, string> = {
  glm: '智谱 GLM',
  deepseek: 'DeepSeek',
  kimi: 'Kimi',
  minimax: 'MiniMax',
  qwen: '通义 Qwen',
  doubao: '豆包 Doubao',
};

export const WORKSPACE_SCOPE_LABELS: Record<AgentWorkspaceScope, string> = {
  canvas: '画布',
  workshop: '工坊',
  editor: '剪辑',
};

export function encodeChatModel(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`;
}

export function decodeChatModel(value?: string | null): { providerId: string; modelId: string } | null {
  if (!value || value === 'global') return null;
  const separator = value.indexOf(':');
  if (separator <= 0 || separator === value.length - 1) return null;
  return {
    providerId: value.slice(0, separator),
    modelId: value.slice(separator + 1),
  };
}

export function getChatModelLabel(providerId: string, modelId: string): string {
  return CHAT_MODELS[providerId]?.find((item) => item.value === modelId)?.label ?? modelId;
}

export function getDefaultModelId(providerId: string): string {
  return CHAT_MODELS[providerId]?.[0]?.value ?? providerId;
}

export function inferAgentWorkspaceScope(content: string): AgentWorkspaceScope | null {
  if (content.startsWith('[用户正在画布视图中操作')) return 'canvas';
  if (content.startsWith('[工坊上下文：')) return 'workshop';
  if (content.startsWith('[用户正在剪辑视图操作')) return 'editor';
  return null;
}
