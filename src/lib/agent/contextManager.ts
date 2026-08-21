import type { AgentMessage, TokenUsage } from './types.ts';
import { agentLog } from './logger.ts';
import { buildToolEvidenceSummary } from './toolEvidence.ts';
import { getMicrocompactPolicy } from './contextRetention.ts';
import {
  COMPACTED_HISTORY_ACK,
  COMPACTED_HISTORY_PREFIX,
  isCompactedHistoryContent,
  mergeCumulativeSummaries,
  truncateKeepingEnds,
  unwrapCompactedHistory,
} from './contextCompaction.ts';

export interface CompactChatClient {
  chat(
    messages: { role: string; content: string }[],
    options?: { maxTokens?: number },
  ): Promise<string>;
}

const COMPACT_PROMPT = `请总结以下对话历史，用简洁的中文输出，保留关键信息。直接输出摘要内容，不要加多余的前缀。

事实边界：
- 只把用户明确提供、工具返回成功、文件实际读取到或测试实际通过的内容写成已验证事实。
- 助手的计划、猜测、待验证根因和失败尝试不能升级成事实；有保留价值时必须标注“未验证”或“曾尝试但未确认”。
- 文件变更只有在工具结果确认写入后才记录；不要把准备修改、建议修改写成已经修改。
- 若摘要与最近工具结果冲突，以工具结果为准。不要保留摘要生成过程中出现的推测性中间结论。

要求保留以下 6 类信息：
1. **用户意图**：用户的主要请求和目标
2. **关键决策**：做了什么技术选择，为什么
3. **文件变更**：修改/创建了哪些文件，改了什么
4. **当前状态**：当前正在做什么，进度如何
5. **待办事项**：还有什么没完成的
6. **工具证据**：原样保留“历史工具证据摘要”里的路径、mtime、内容指纹、读取范围、扫描时间和 Bash output_id；它们是证据索引，不得改写或猜测

对话内容：
`;

/**
 * 工具历史的保留量必须跟真实上下文窗口走。
 *
 * 旧实现无论模型是 128K 还是 1M，每轮都只保留最近 2 条工具结果。
 * 这会让 1M 模型在上下文还很空时就失去项目状态、读文件证据和生成回执。
 */
/** tool 消息超过此字符数才清理 */
const TOOL_CLEAR_THRESHOLD = 200;
/** 最近工具结果也不能无限保留，工坊/画布大状态尤其容易撑爆上下文 */
/**
 * Only tool results from these tools are eligible for microcompact clearing.
 * Why a whitelist: some tool results (e.g. user-facing plan output, skill
 * results the model will re-reference) lose meaning if truncated. Read/search/
 * bash results are safe — they're reproducible by re-running.
 */
const COMPACTABLE_TOOLS = new Set([
  'bash',
  'bash_read_output',
  'read_file',
  'read',
  'bash_command',
  'grep_search',
  'grep',
  'glob_search',
  'glob',
  'list_directory',
  'edit_file',
  'edit',
  'write_file',
  'write',
  'web_fetch',
  'web_search',
  'browser_control',
  'canvas_get_state',
  'canvas_generate',
  'canvas_generate_batch',
  'video_generate',
  'workshop_get_state',
  'workshop_read_source',
  'workshop_generate',
  'image_recognition',
]);
/**
 * Images embedded in tool content larger than this (approx tokens) get
 * replaced with a placeholder during microcompact. 2000 tokens ≈ one 1024x1024
 * PNG base64'd; keeping a whole canvas of them kills the context.
 */
const IMAGE_MAX_TOKEN_SIZE = 2000;
const HARD_CLAMP_SUMMARY_MAX_CHARS = 8000;
const HARD_CLAMP_MIN_RECENT_MESSAGES = 4;
const HARD_CLAMP_MAX_MESSAGE_CHARS = 12000;
const MIN_SUMMARY_INPUT_CHARS = 36_000;
const MAX_SUMMARY_INPUT_CHARS = 700_000;
const MIN_CUMULATIVE_SUMMARY_CHARS = 24_000;
const MAX_CUMULATIVE_SUMMARY_CHARS = 240_000;

/**
 * 上下文管理器 — 估算 token、微压缩、LLM 摘要压缩
 *
 * 三层策略（借鉴 Claude Code 的分层设计）：
 * 1. Microcompact: 清理旧工具结果，释放 token
 * 2. LLM 摘要: 用 GLM 生成结构化摘要替代旧消息
 * 3. 安全分割: 确保不打断 tool_calls/tool 配对
 */
export class ContextManager {
  private maxTokens: number;
  private usage: TokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
  /**
   * Per-message estimate cache. estimateMessages() runs several times per
   * agent turn over the full history (run start, after every tool batch,
   * inside hardClamp loops, outbound check); without caching that's an
   * O(history) deep scan each time. Messages are treated immutably across
   * the codebase (microcompact/strip helpers replace objects via .map()),
   * so identity + field-reference validation is safe: any rewrite creates a
   * new message object or replaces the field reference, both of which miss
   * the cache and get recomputed.
   */
  private estimateCache = new WeakMap<
    AgentMessage,
    { content: unknown; toolCalls: unknown; thinking: unknown; mediaCount: number; tokens: number }
  >();

  constructor(maxTokens: number = 128000) {
    this.maxTokens = maxTokens;
  }

  /** 运行时更新上下文窗口大小（例如根据当前 model 的 contextWindow 动态调整） */
  updateMaxTokens(maxTokens: number): void {
    this.maxTokens = maxTokens;
  }

  // ─── Token 估算 ────────────────────────────────────

  /**
   * 保守 token 估算。
   *
   * DeepSeek/OpenAI 兼容接口会把消息结构、tool schema、JSON 标点都计入
   * prompt token。旧算法把英文/JSON 按 0.4 token/char 估算，在大工具输出
   * 场景下会明显低估，导致本地以为安全、服务端实际 400 context_length。
   */
  estimateTokens(text: string): number {
    let count = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if ((code >= 0x4e00 && code <= 0x9fff) ||
          (code >= 0x3000 && code <= 0x303f) ||
          (code >= 0xff00 && code <= 0xffef)) {
        count += 2;
      } else {
        count += 1;
      }
    }
    return Math.ceil(count);
  }

  /** 判断消息列表是否需要压缩 */
  shouldCompact(messages: AgentMessage[]): boolean {
    const estimated = this.estimateMessages(messages);
    return estimated > this.maxTokens * 0.7;
  }

  /** 估算消息列表的总 token 数（带逐消息缓存，未变更的消息 O(1) 命中） */
  estimateMessages(messages: AgentMessage[]): number {
    return messages.reduce((total, msg) => {
      const toolCalls = (msg as { tool_calls?: unknown }).tool_calls;
      const thinkingBlocks = (msg as { thinking_blocks?: unknown }).thinking_blocks;
      const mediaCount = msg.role === 'tool' ? (msg.media?.length ?? 0) : 0;
      const cached = this.estimateCache.get(msg);
      if (
        cached
        && cached.content === msg.content
        && cached.toolCalls === toolCalls
        && cached.thinking === thinkingBlocks
        && cached.mediaCount === mediaCount
      ) {
        return total + cached.tokens;
      }
      const content =
        typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      const structured =
        (toolCalls ? JSON.stringify(toolCalls) : '') +
        (thinkingBlocks ? JSON.stringify(thinkingBlocks) : '');
      // Do not stringify base64 media into the estimator. A fixed visual-token
      // allowance tracks pressure without treating transport bytes as text.
      const tokens =
        this.estimateTokens((content || '') + structured) + mediaCount * 1800 + 12;
      this.estimateCache.set(msg, {
        content: msg.content,
        toolCalls,
        thinking: thinkingBlocks,
        mediaCount,
        tokens,
      });
      return total + tokens;
    }, 0);
  }

  /**
   * 最后一层硬裁剪：保证即将发给模型的 messages 不超过预算。
   * 这是请求前保险丝，专门防止 DeepSeek 这类长上下文模型被超大历史、
   * tool 输出、thinking blocks 或 AIGC 注入内容打爆。
   */
  hardClamp(messages: AgentMessage[], maxTokens: number): AgentMessage[] {
    let result = this.microcompact(messages);
    let estimated = this.estimateMessages(result);
    if (estimated <= maxTokens) return result;

    const system = result.filter((m) => m.role === 'system');
    const nonSystem = result.filter((m) => m.role !== 'system');

    let keepCount = Math.max(
      HARD_CLAMP_MIN_RECENT_MESSAGES,
      Math.min(nonSystem.length, Math.floor(nonSystem.length * 0.25)),
    );

    while (keepCount >= HARD_CLAMP_MIN_RECENT_MESSAGES) {
      const rawSplitIndex = nonSystem.length - keepCount;
      const safeSplitIndex = this.findSafeSplitIndex(nonSystem, rawSplitIndex);
      const oldMessages = nonSystem.slice(0, safeSplitIndex);
      const recentMessages = nonSystem.slice(safeSplitIndex);
      const candidate = [
        ...system,
        ...this.buildSummaryPair(this.fallbackSummarize(oldMessages).slice(0, HARD_CLAMP_SUMMARY_MAX_CHARS)),
        ...recentMessages,
      ];
      estimated = this.estimateMessages(candidate);
      if (estimated <= maxTokens) {
        agentLog.warn('Context', `Hard clamp applied: kept ${recentMessages.length} recent messages, estimated ${estimated}/${Math.floor(maxTokens)} tokens`);
        return candidate;
      }

      const nextKeepCount = Math.floor(keepCount * 0.6);
      if (nextKeepCount === keepCount) break;
      keepCount = nextKeepCount;
    }

    const rawSplitIndex = Math.max(0, nonSystem.length - HARD_CLAMP_MIN_RECENT_MESSAGES);
    const safeSplitIndex = this.findSafeSplitIndex(nonSystem, rawSplitIndex);
    const oldMessages = nonSystem.slice(0, safeSplitIndex);
    const recentMessages = this.trimOversizedMessages(nonSystem.slice(safeSplitIndex));
    result = [
      ...system,
      ...this.buildSummaryPair(this.fallbackSummarize(oldMessages).slice(0, HARD_CLAMP_SUMMARY_MAX_CHARS)),
      ...recentMessages,
    ];
    estimated = this.estimateMessages(result);
    if (estimated <= maxTokens) {
      agentLog.warn('Context', `Hard clamp forced: estimated ${estimated}/${Math.floor(maxTokens)} tokens`);
      return result;
    }

    // A handful of recent messages can themselves exceed the whole window
    // (large tool-call arguments, pasted files, or several media blocks). The
    // normal split loop deliberately keeps recent turns verbatim, so add one
    // final valid conversation fallback instead of returning an over-budget
    // array and letting the provider reject it with context_length_exceeded.
    result = this.forceFitSummary(result, maxTokens);
    estimated = this.estimateMessages(result);
    agentLog.warn('Context', `Hard clamp emergency summary: estimated ${estimated}/${Math.floor(maxTokens)} tokens`);
    return result;
  }

  // ─── 第 1 层: Microcompact ─────────────────────────

  /**
   * 清理旧的工具结果消息，保留最近 N 条。
   * 超过 TOOL_CLEAR_THRESHOLD 字符的旧 tool 结果被替换为简短占位。
   *
   * Upgraded (Tier 2.2): only clear results whose tool name is in
   * COMPACTABLE_TOOLS. Also, inline images larger than IMAGE_MAX_TOKEN_SIZE
   * get replaced with a placeholder even when they're "recent".
   */
  microcompact(messages: AgentMessage[]): AgentMessage[] {
    const estimatedBefore = this.estimateMessages(messages);
    const pressure = this.maxTokens > 0 ? estimatedBefore / this.maxTokens : 1;
    const {
      preserveFullToolHistory,
      recentToolKeep,
      protectedToolHardLimit,
      protectedToolHeadChars,
      protectedToolTailChars,
    } = getMicrocompactPolicy(this.maxTokens, estimatedBefore);

    // Build a tool_call_id → tool_name index by walking assistant messages.
    const toolNameById = new Map<string, string>();
    for (const m of messages) {
      if (m.role !== 'assistant') continue;
      const tcs = (m as { tool_calls?: { id: string; function?: { name?: string } }[] }).tool_calls;
      if (!tcs) continue;
      for (const tc of tcs) {
        if (tc.id && tc.function?.name) toolNameById.set(tc.id, tc.function.name);
      }
    }

    // 找出所有 tool 消息的索引
    const toolIndices: number[] = [];
    for (let i = 0; i < messages.length; i++) {
      if (messages[i].role === 'tool') {
        toolIndices.push(i);
      }
    }

    // 1M 窗口在低压力时充分利用可用容量；进入压力区后再退回最近 N 条。
    const protectedIndices = new Set(
      preserveFullToolHistory ? toolIndices : toolIndices.slice(-recentToolKeep),
    );
    let currentToolBatchStart = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message.role === 'assistant' && message.tool_calls?.length) {
        currentToolBatchStart = i;
        break;
      }
      if (message.role === 'user') break;
    }

    let cleared = 0;
    let imagesStripped = 0;
    let latestUserIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        latestUserIndex = i;
        break;
      }
    }

    const result = messages.map((msg, i) => {
      // Extended-thinking payloads are only required while continuing the
      // current tool turn. Re-sending every completed turn can consume most of
      // a 1M context without adding any user-visible memory. Keep the current
      // turn intact, but retain only the assistant's actual conclusion/tool
      // calls for older turns.
      if (msg.role === 'assistant' && msg.thinking_blocks?.length && i < latestUserIndex) {
        const { thinking_blocks: _thinkingBlocks, ...withoutHistoricalThinking } = msg;
        return withoutHistoricalThinking as AgentMessage;
      }

      if (msg.role !== 'tool' || typeof msg.content !== 'string') return msg;

      const keepNativeMedia = Boolean(msg.media?.length) && currentToolBatchStart >= 0 && i > currentToolBatchStart;
      const baseMessage = msg.media?.length && !keepNativeMedia ? { ...msg, media: undefined } : msg;

      const toolName = toolNameById.get((msg as { tool_call_id: string }).tool_call_id);
      const compactable = toolName ? COMPACTABLE_TOOLS.has(toolName) : true;

      // Strip oversized inline images regardless of whether message is "recent".
      // Images embedded as data: URIs or base64 blobs are ~4 chars / byte.
      let content = msg.content;
      const imageMatches = content.match(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g);
      if (imageMatches) {
        for (const img of imageMatches) {
          const approxTokens = this.estimateTokens(img);
          if (approxTokens > IMAGE_MAX_TOKEN_SIZE) {
            content = content.replace(
              img,
              `[image stripped: ~${approxTokens} tokens, ${img.length} chars]`,
            );
            imagesStripped++;
          }
        }
      }

      const protectedButTooLarge =
        compactable &&
        protectedIndices.has(i) &&
        content.length > protectedToolHardLimit;

      if (
        compactable &&
        (!protectedIndices.has(i) || protectedButTooLarge) &&
        content.length > TOOL_CLEAR_THRESHOLD
      ) {
        cleared++;
        if (protectedButTooLarge) {
          const head = content.slice(0, protectedToolHeadChars);
          const tail = content.slice(-protectedToolTailChars);
          const evidence = buildToolEvidenceSummary(toolName, content);
          return {
            ...baseMessage,
            content: `${evidence}\n[工具输出因单条过大被明确截断: 保留 0-${protectedToolHeadChars} 和 ${content.length - protectedToolTailChars}-${content.length}]\n\n${head}\n\n...[中间 ${Math.max(0, content.length - protectedToolHeadChars - protectedToolTailChars)} 字符未发送给模型；优先使用证据摘要中的 next_offset/output_id 分页续读]...\n\n${tail}`,
          } as AgentMessage;
        }
        return {
          ...baseMessage,
          content: buildToolEvidenceSummary(toolName, content),
        } as AgentMessage;
      }

      return content === msg.content ? baseMessage : ({ ...baseMessage, content } as AgentMessage);
    });

    if (cleared > 0 || imagesStripped > 0) {
      agentLog.debug(
        'Context',
        `Microcompact: pressure=${Math.round(pressure * 100)}%, keep=${preserveFullToolHistory ? 'all' : recentToolKeep}, cleared ${cleared} tool results, stripped ${imagesStripped} large images`,
      );
    }

    return result;
  }

  // ─── 第 2 层: 安全分割 ─────────────────────────────

  /**
   * 找到安全的消息分割点，确保不打断 tool_calls/tool 配对。
   * 从 targetIndex 向前搜索，返回一个不会切断配对的索引。
   */
  findSafeSplitIndex(messages: AgentMessage[], targetIndex: number): number {
    if (targetIndex <= 0) return 0;
    if (targetIndex >= messages.length) return messages.length;

    let idx = targetIndex;

    // 如果切点在 tool 消息上，向前找到对应的 assistant (含 tool_calls)
    while (idx > 0 && messages[idx].role === 'tool') {
      idx--;
    }

    // 如果切点在含 tool_calls 的 assistant 上，也要包含进去（向前再退一步）
    if (
      idx > 0 &&
      messages[idx].role === 'assistant' &&
      (messages[idx] as { tool_calls?: unknown }).tool_calls
    ) {
      idx--;
    }

    // 尽量落在 user 消息的边界上（一个完整对话轮次的开头）
    while (idx > 0 && messages[idx].role !== 'user') {
      idx--;
    }

    return Math.max(0, idx);
  }

  // ─── 第 3 层: LLM 摘要压缩 ────────────────────────

  /**
   * 主压缩入口。
   * 1. 先 microcompact（清理旧 tool 结果）
   * 2. 检查 token 阈值
   * 3. 超过则用 LLM 摘要 + 安全分割
   */
  async compact(
    messages: AgentMessage[],
    chatClient?: CompactChatClient,
    force?: boolean,
  ): Promise<AgentMessage[]> {
    // Step 1: microcompact
    let result = this.microcompact(messages);

    // Step 2: check threshold
    const estimated = this.estimateMessages(result);
    const threshold = this.maxTokens * 0.8;

    if (!force && estimated <= threshold) {
      return result;
    }

    agentLog.info('Context', `Compact triggered: ${estimated} tokens (threshold: ${Math.floor(threshold)})`);

    // Step 3: split messages
    const system = result.filter((m) => m.role === 'system');
    const nonSystem = result.filter((m) => m.role !== 'system');

    // 保留最近 30% 的消息，但至少 6 条
    const keepCount = Math.max(6, Math.floor(nonSystem.length * 0.3));
    const rawSplitIndex = nonSystem.length - keepCount;
    const safeSplitIndex = this.findSafeSplitIndex(nonSystem, rawSplitIndex);

    const oldMessages = nonSystem.slice(0, safeSplitIndex);
    const recentMessages = nonSystem.slice(safeSplitIndex);

    if (oldMessages.length === 0) {
      agentLog.warn('Context', 'Nothing to compact (all messages are recent)');
      return result;
    }

    // Step 4: keep the previous cumulative summary verbatim and summarize only
    // the newly retired messages. This prevents recursive "summary of a
    // summary" collapse, which used to turn a long conversation into a few
    // hundred characters after several compactions.
    const previousSummaries: string[] = [];
    const deltaMessages: AgentMessage[] = [];
    for (let i = 0; i < oldMessages.length; i++) {
      const message = oldMessages[i];
      if (this.isCompactedHistoryMessage(message)) {
        previousSummaries.push(unwrapCompactedHistory(message.content as string));
        if (
          oldMessages[i + 1]?.role === 'assistant' &&
          oldMessages[i + 1]?.content === COMPACTED_HISTORY_ACK
        ) {
          i += 1;
        }
        continue;
      }
      deltaMessages.push(message);
    }

    let deltaSummary = '';
    if (deltaMessages.length === 0 && previousSummaries.length === 0) {
      return result;
    }
    if (chatClient) {
      try {
        if (deltaMessages.length > 0) {
          deltaSummary = await this.summarizeWithLLM(deltaMessages, chatClient);
          agentLog.info('Context', `LLM delta summary generated (${deltaSummary.length} chars)`);
        }
      } catch (err) {
        agentLog.warn('Context', 'LLM summary failed, using fallback', err);
        deltaSummary = this.fallbackSummarize(deltaMessages);
      }
    } else if (deltaMessages.length > 0) {
      deltaSummary = this.fallbackSummarize(deltaMessages);
    }

    const cumulativeSummaryMaxChars = Math.min(
      MAX_CUMULATIVE_SUMMARY_CHARS,
      Math.max(MIN_CUMULATIVE_SUMMARY_CHARS, Math.floor(this.maxTokens * 0.12)),
    );
    const summary = mergeCumulativeSummaries(previousSummaries, deltaSummary, cumulativeSummaryMaxChars);

    result = [...system, ...this.buildSummaryPair(summary), ...recentMessages];

    const afterTokens = this.estimateMessages(result);
    agentLog.info('Context', `Compact done: ${estimated} → ${afterTokens} tokens, ${oldMessages.length} messages summarized`);

    return afterTokens > threshold ? this.hardClamp(result, threshold) : result;
  }

  private buildSummaryPair(summary: string): AgentMessage[] {
    return [
      {
        role: 'user',
        content: `${COMPACTED_HISTORY_PREFIX}请基于此摘要继续对话，不要说你不记得之前的内容。\n\n${summary}`,
      },
      {
        role: 'assistant',
        content: COMPACTED_HISTORY_ACK,
      },
    ];
  }

  private trimOversizedMessages(messages: AgentMessage[]): AgentMessage[] {
    return messages.map((msg) => {
      if (msg.role === 'system' || typeof msg.content !== 'string') return msg;
      if (msg.content.length <= HARD_CLAMP_MAX_MESSAGE_CHARS) return msg;

      const keepChars = msg.role === 'tool' ? 8000 : HARD_CLAMP_MAX_MESSAGE_CHARS;
      return {
        ...msg,
        content: `${msg.content.slice(0, keepChars)}\n\n[内容已在发送模型前明确截断于字符 ${keepChars}/${msg.content.length}；请用 offset/output_id 分页续读剩余内容。]`,
      } as AgentMessage;
    });
  }

  private forceFitSummary(messages: AgentMessage[], maxTokens: number): AgentMessage[] {
    const system = messages
      .filter((message) => message.role === 'system')
      .map((message) => ({ ...message, media: undefined, thinking_blocks: undefined } as AgentMessage));
    const nonSystem = messages.filter((message) => message.role !== 'system');
    let summary = this.fallbackSummarize(nonSystem).slice(0, HARD_CLAMP_SUMMARY_MAX_CHARS);
    let candidate = [...system, ...this.buildSummaryPair(summary)];

    // Shrink the summary first; it is derived evidence, while the system prompt
    // carries runtime/tool contracts. truncateKeepingEnds retains both the
    // original request and the latest verified result.
    while (this.estimateMessages(candidate) > maxTokens && summary.length > 256) {
      summary = truncateKeepingEnds(summary, Math.max(256, Math.floor(summary.length * 0.6)));
      candidate = [...system, ...this.buildSummaryPair(summary)];
    }
    if (this.estimateMessages(candidate) <= maxTokens) return candidate;

    // Extremely small model windows can be smaller than the dynamically built
    // system prompt itself. Preserve both ends and make the truncation explicit
    // rather than sending an invalid request.
    let systemChars = system.reduce(
      (total, message) => total + (typeof message.content === 'string' ? message.content.length : 0),
      0,
    );
    let fittedSystem: AgentMessage[] = system;
    while (this.estimateMessages([...fittedSystem, ...this.buildSummaryPair(summary)]) > maxTokens && systemChars > 512) {
      systemChars = Math.max(512, Math.floor(systemChars * 0.7));
      const perMessage = Math.max(128, Math.floor(systemChars / Math.max(1, fittedSystem.length)));
      fittedSystem = fittedSystem.map((message) => ({
        role: 'system',
        content: `${truncateKeepingEnds(
          typeof message.content === 'string' ? message.content : '',
          perMessage,
        )}\n[系统提示因模型窗口过小已明确裁剪]`,
      }));
    }
    candidate = [...fittedSystem, ...this.buildSummaryPair(summary)];
    return candidate;
  }

  /**
   * 用 GLM 生成结构化摘要
   */
  private async summarizeWithLLM(
    messages: AgentMessage[],
    chatClient: CompactChatClient,
  ): Promise<string> {
    // 构建对话文本，包含所有角色（user、assistant、tool）
    const parts: string[] = [];
    for (const msg of messages) {
      const content = typeof msg.content === 'string' ? msg.content : '';
      if (!content) continue;

      const perMessageLimit = this.maxTokens >= 900_000
        ? (msg.role === 'user' ? 32_000 : 24_000)
        : 3_000;
      const truncated = truncateKeepingEnds(content, perMessageLimit);

      if (msg.role === 'user') {
        parts.push(`[用户] ${truncated}`);
      } else if (msg.role === 'assistant') {
        parts.push(`[助手] ${truncated}`);
        // Include tool call names if present
        const tc = (msg as { tool_calls?: { function: { name: string } }[] }).tool_calls;
        if (tc?.length) {
          parts.push(`[助手调用工具] ${tc.map((t) => t.function.name).join(', ')}`);
        }
      } else if (msg.role === 'tool') {
        // 只保留摘要，不放完整输出
        const evidence = content.startsWith('[历史工具证据摘要');
        const limit = evidence ? 800 : 200;
        const brief = content.length > limit ? content.slice(0, limit) + '...' : content;
        parts.push(`[工具结果] ${brief}`);
      }
    }

    const conversationText = parts.join('\n');

    // Scale summary input with the active model. The old fixed 12k-character
    // head-only slice discarded most decisions even on a 1M model. Keep both
    // the beginning (original goal) and the end (latest verified state).
    const maxChars = Math.min(
      MAX_SUMMARY_INPUT_CHARS,
      Math.max(MIN_SUMMARY_INPUT_CHARS, Math.floor(this.maxTokens * 0.55)),
    );
    const trimmed = truncateKeepingEnds(conversationText, maxChars);

    const summaryMessages = [
      { role: 'system', content: '你是一个对话摘要助手。请根据要求总结对话内容。' },
      { role: 'user', content: COMPACT_PROMPT + trimmed },
    ];

    return await chatClient.chat(summaryMessages, {
      maxTokens: this.maxTokens >= 900_000 ? 12_000 : 3_000,
    });
  }

  /**
   * 改进版文本截断（降级方案）
   * 比原版好：保留 tool 消息摘要，保留更多字符
   */
  private fallbackSummarize(messages: AgentMessage[]): string {
    const parts: string[] = [];
    for (const msg of messages) {
      const content = typeof msg.content === 'string' ? msg.content : '';
      if (!content) continue;

      const truncated = truncateKeepingEnds(content, msg.role === 'user' ? 2_000 : 1_200);

      if (msg.role === 'user') {
        parts.push(`用户: ${truncated}`);
      } else if (msg.role === 'assistant') {
        parts.push(`助手回复（其中计划/判断未必已验证）: ${truncated}`);
      } else if (msg.role === 'tool') {
        const evidence = content.startsWith('[历史工具证据摘要');
        const limit = evidence ? 800 : 100;
        const brief = content.length > limit ? content.slice(0, limit) + '...' : content;
        parts.push(`工具返回（仅按原文记录，不补推断）: ${brief}`);
      }
    }
    return parts.join('\n') || '(无内容)';
  }

  private isCompactedHistoryMessage(message: AgentMessage): boolean {
    return message.role === 'user' && isCompactedHistoryContent(message.content);
  }

  // ─── Token 使用量追踪 ─────────────────────────────

  updateUsage(usage: Partial<TokenUsage>): void {
    if (usage.promptTokens !== undefined) this.usage.promptTokens += usage.promptTokens;
    if (usage.completionTokens !== undefined)
      this.usage.completionTokens += usage.completionTokens;
    if (usage.totalTokens !== undefined) this.usage.totalTokens += usage.totalTokens;
  }

  getUsage(): TokenUsage {
    return { ...this.usage };
  }

  resetUsage(): void {
    this.usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }
}
