// sessionSanitize — 纯函数：剥离会话数据里内嵌的 base64 媒体。
//
// 背景：image_generate / canvas_generate / timeline_render_frame 等工具把
// 生成图/截图以 base64 source 塞进 result.media，随会话文件原样落盘
// （单条最大 ~5MB），会话文件只增不减（实测一个 52 条消息的会话 57MB，
// 其中 59.4MB 来自 base64）。落盘/读回时统一在此剥离成轻量占位：
// 保留媒体条目的 type，source 换成 { type: 'path', path }（路径从
// result.output 文本解析，解析不到就省略 source），并加 note 标记。
//
// 约束：本模块保持纯函数、零依赖（不许 import tauri / React / 别名路径），
// 以便 node --test 直接单测。所有函数不可变输入，无改动时返回原引用。

export const BASE64_STRIP_NOTE = 'base64 已剥离';

// 各生图/截图工具 output 里的产物路径写法（见 tools/imageGenerateTool.ts、
// canvasGenerateTool.ts、timelineTools.ts、canvasTools.ts）：
//   文件：/path/x.png            （image_generate，全角冒号）
//   主产物: /path/x.png          （canvas_generate）
//   母版概念图：/path/x.png       （mg 生成工具）
//   { ..., "path": "/path/x.png" }（timeline_render_frame / canvas 节点截图，JSON）
const LINE_PATH_PATTERNS = [
  /文件[：:]\s*([^\n]+)/,
  /母版概念图[：:]\s*([^\n]+)/,
  /主产物[：:]\s*([^\n]+)/,
];
const JSON_PATH_PATTERN = /"path"\s*:\s*"([^"]+)"/;

/** 从工具 output 文本里解析产物的本地绝对路径；解析不到返回 undefined。 */
export function extractMediaPathFromOutput(output: unknown): string | undefined {
  if (typeof output !== 'string' || !output) return undefined;
  const candidates: string[] = [];
  for (const pattern of LINE_PATH_PATTERNS) {
    const match = pattern.exec(output);
    if (match) candidates.push(match[1]);
  }
  const jsonMatch = JSON_PATH_PATTERN.exec(output);
  if (jsonMatch) candidates.push(jsonMatch[1]);
  for (const candidate of candidates) {
    const path = candidate.trim();
    // 只接受绝对路径——上述工具产物均为绝对路径；相对片段多半不是路径。
    // Windows 盘符路径（C:\...）同样是绝对路径。
    if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) return path;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 剥离 media 数组里的 base64 source。非数组原样返回；无 base64 条目时返回
 * 原数组引用；有改动时返回新数组，base64 条目替换为轻量占位（保留 type，
 * pathHint 存在时换 source 为 { type: 'path', path }，否则省略 source）。
 */
function stripMediaArray(media: unknown, pathHint: string | undefined): unknown {
  if (!Array.isArray(media)) return media;
  let changed = false;
  const next = media.map((item) => {
    if (!isRecord(item)) return item;
    const source = item.source;
    if (!isRecord(source) || source.type !== 'base64') return item;
    changed = true;
    const placeholder: Record<string, unknown> = { ...item, note: BASE64_STRIP_NOTE };
    if (pathHint) {
      placeholder.source = { type: 'path', path: pathHint };
    } else {
      delete placeholder.source;
    }
    return placeholder;
  });
  return changed ? next : media;
}

/** 剥离单条 toolExecution 的 result.media（路径从 result.output 解析）。 */
function stripExecutionMedia(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const result = raw.result;
  if (!isRecord(result) || !Array.isArray(result.media)) return raw;
  const nextMedia = stripMediaArray(result.media, extractMediaPathFromOutput(result.output));
  if (nextMedia === result.media) return raw;
  return { ...raw, result: { ...result, media: nextMedia } };
}

/**
 * 剥离单条消息里的 base64 媒体（不可变；无改动返回原引用）。覆盖两处：
 *  - UI 消息 metadata.toolExecutions[].result.media（路径解析自 result.output）
 *  - 消息顶层 media 数组（AgentMessage 的 tool 角色消息；路径解析自字符串 content）
 */
export function stripSessionMediaFromMessage<T>(message: T): T {
  if (!isRecord(message)) return message;
  let result: Record<string, unknown> = message;

  const metadata = message.metadata;
  if (isRecord(metadata) && Array.isArray(metadata.toolExecutions)) {
    const executions = metadata.toolExecutions;
    let changed = false;
    const nextExecutions = executions.map((raw) => {
      const stripped = stripExecutionMedia(raw);
      if (stripped !== raw) changed = true;
      return stripped;
    });
    if (changed) {
      result = { ...result, metadata: { ...metadata, toolExecutions: nextExecutions } };
    }
  }

  if (Array.isArray(result.media)) {
    const content = result.content;
    const nextMedia = stripMediaArray(
      result.media,
      extractMediaPathFromOutput(typeof content === 'string' ? content : undefined),
    );
    if (nextMedia !== result.media) {
      result = { ...result, media: nextMedia };
    }
  }

  return result as T;
}

/** 批量剥离消息数组；无任何改动时返回原数组引用。 */
export function stripSessionMedia<T>(messages: T[]): T[] {
  if (!Array.isArray(messages)) return messages;
  let changed = false;
  const next = messages.map((message) => {
    const stripped = stripSessionMediaFromMessage(message);
    if (stripped !== message) changed = true;
    return stripped;
  });
  return changed ? next : messages;
}

/**
 * 处理整个会话文件对象：messages 与 agentMessages 两个数组都可能携带
 * toolExecutions / 顶层 media。无改动时返回原对象引用（存量清洗靠这个
 * 引用比较跳过无需重写的文件）。
 */
export function sanitizeSessionFileData<T extends { messages?: unknown; agentMessages?: unknown }>(
  data: T,
): T {
  if (!isRecord(data)) return data;
  let result = data;
  if (Array.isArray(data.messages)) {
    const nextMessages = stripSessionMedia(data.messages);
    if (nextMessages !== data.messages) {
      result = { ...result, messages: nextMessages };
    }
  }
  if (Array.isArray(data.agentMessages)) {
    const nextAgentMessages = stripSessionMedia(data.agentMessages);
    if (nextAgentMessages !== data.agentMessages) {
      result = { ...result, agentMessages: nextAgentMessages };
    }
  }
  return result;
}
