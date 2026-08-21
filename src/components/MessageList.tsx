import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Check, ArrowRight, ChevronDown, ChevronRight, Loader2, BookOpen, PencilLine, Wrench } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { Message } from '@/types';
import { useChatStore } from '@/stores';
import { MarkdownRenderer } from '@/lib/markdown';
import RunStepTimeline from './chat/RunStepTimeline';
import { stripHarnessPrefix } from '@/lib/agent/harnessDisplay';
import { artifactsFromMessage } from '@/lib/chat/artifacts';
import { ArtifactGrid } from './chat/ArtifactPreview';
import { AskUserDecisionCard } from './AskUserDialog';
import { useAskUserStore } from '@/stores/askUserStore';
import { formatElapsedDuration } from '@/lib/chat/formatElapsedDuration';

// ── StreamingCard — unified streaming status card ─────────────────────────

interface StreamingCardProps {
  phase: 'waiting' | 'thinking' | 'streaming' | 'processing';
  sentAt: number | null;
}

function StreamingCard({ phase, sentAt }: StreamingCardProps) {
  // Read streaming content directly from store — avoids re-rendering the entire
  // MessageList/ChatArea tree on every token; only StreamingCard re-renders
  const thinkingContent = useChatStore((s) => s.streamingThinkingContent);
  const streamingContent = useChatStore((s) => s.streamingContent);
  const toolName = useChatStore((s) => s.streamingToolName);
  const subAgentText = useChatStore((s) => s.streamingSubAgentText);
  const [elapsed, setElapsed] = useState(0);
  const [expanded, setExpanded] = useState(true);
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const thinkingRef = useRef<HTMLDivElement>(null);
  const streamingRef = useRef<HTMLDivElement>(null);
  const subAgentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sentAt) { setElapsed(0); return; }
    setElapsed(Math.floor((Date.now() - sentAt) / 1000));
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - sentAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [sentAt]);

  // Auto-scroll thinking content
  useEffect(() => {
    if (thinkingRef.current && thinkingExpanded) {
      thinkingRef.current.scrollTop = thinkingRef.current.scrollHeight;
    }
  }, [thinkingContent, thinkingExpanded]);

  // Auto-scroll streaming content
  useEffect(() => {
    if (streamingRef.current) {
      streamingRef.current.scrollTop = streamingRef.current.scrollHeight;
    }
  }, [streamingContent]);

  // Auto-scroll sub-agent text
  useEffect(() => {
    if (subAgentRef.current) {
      subAgentRef.current.scrollTop = subAgentRef.current.scrollHeight;
    }
  }, [subAgentText]);

  // Header label + icon
  const headerLabel = (() => {
    if (phase === 'processing' && toolName === 'agent') return '子任务执行中';
    if (phase === 'processing') return '正在处理';
    if (phase === 'streaming') return '正在回答';
    return '正在思考';
  })();

  return (
    <motion.div
      className="space-y-3"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-2 py-1 text-left text-[13px] text-[rgb(var(--c-text-muted))] transition-colors hover:text-[rgb(var(--c-text))]"
        >
          <Loader2 size={14} className="animate-spin text-[rgb(var(--c-text-muted))]" />
          <span className="font-medium text-[rgb(var(--c-text))]">执行中</span>
          <span className="truncate">{headerLabel}</span>
          {elapsed >= 2 && <span className="text-[rgb(var(--c-text-muted))]">{formatElapsedDuration(elapsed)}</span>}
          <span className="ml-auto text-[rgb(var(--c-text-muted))]">
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
        </button>

        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              key="active-work-log"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.14 }}
              className="overflow-hidden"
            >
              <div className="pb-2 pt-1">
                <RunStepTimeline compact showHeader={false} />

                {thinkingContent && (
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => setThinkingExpanded((v) => !v)}
                      className="flex items-center gap-1.5 py-1 text-[12px] text-[rgb(var(--c-text-muted))] transition-colors hover:text-[rgb(var(--c-text))]"
                    >
                      {thinkingExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <span>分析过程</span>
                    </button>
                    {thinkingExpanded && (
                      <div
                        ref={thinkingRef}
                        className="whitespace-pre-wrap break-words py-1 pl-4 text-[12.5px] leading-6 text-[rgb(var(--c-text-muted))]"
                      >
                        {thinkingContent}
                      </div>
                    )}
                  </div>
                )}

                {subAgentText && (
                  <div
                    ref={subAgentRef}
                    className="mt-2 whitespace-pre-wrap break-words pl-4 font-mono text-[12px] leading-5 text-[rgb(var(--c-text-muted))]"
                  >
                    {subAgentText}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {streamingContent && (
        <div
          ref={streamingRef}
          className="whitespace-pre-wrap break-words text-[15px] leading-7 text-[rgb(var(--c-text))]"
        >
          {streamingContent}
        </div>
      )}
    </motion.div>
  );
}

// ── WorkLogCard — Codex-like collapsed work log for completed messages ──────

function WorkLogCard({
  thinkingContent,
  duration,
  runId,
  toolExecutions,
  defaultExpanded,
  animateEntry,
}: {
  thinkingContent?: string;
  duration: number | null;
  runId?: string;
  toolExecutions?: unknown[];
  defaultExpanded: boolean;
  animateEntry: boolean;
}) {
  // Keep the user-facing task narrative visible after completion. Users can
  // still collapse it, but progress updates should read like part of the
  // conversation instead of disappearing behind a generic summary.
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [thinkingExpanded, setThinkingExpanded] = useState(false);

  if (!thinkingContent && !runId) return null;

  const tools = (toolExecutions ?? []).filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object'));
  const writes = tools.filter((tool) => /write|edit|generate|export|render/i.test(String(tool.toolName ?? ''))).length;
  const reads = tools.filter((tool) => /read|grep|glob|search|fetch/i.test(String(tool.toolName ?? ''))).length;
  const summary = writes > 0
    ? `已编辑 ${writes} 项内容`
    : reads > 0
      ? `已读取 ${reads} 项资料`
      : tools.length > 0
        ? `已运行 ${tools.length} 个操作`
        : '完成任务';
  const SummaryIcon = writes > 0 ? PencilLine : reads > 0 ? BookOpen : Wrench;

  return (
    <motion.div
      className=""
      initial={animateEntry ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <button
        type="button"
        className="flex w-full cursor-pointer select-none items-center gap-2 py-1 text-left text-[13px] text-[rgb(var(--c-text-muted))] transition-colors hover:text-[rgb(var(--c-text))]"
        onClick={() => setExpanded(!expanded)}
      >
        <SummaryIcon size={14} className="text-[rgb(var(--c-text-muted))]" />
        <span className="min-w-0 truncate font-medium text-[rgb(var(--c-text-muted))]">{summary}</span>
        {duration != null && <span className="text-[rgb(var(--c-text-muted))]">{formatElapsedDuration(duration)}</span>}
        <span className="ml-auto text-[rgb(var(--c-text-muted))]">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="completed-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="pb-2 pt-1">
              {runId && <RunStepTimeline compact showHeader={false} runId={runId} />}

              {thinkingContent && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => setThinkingExpanded((v) => !v)}
                    className="flex items-center gap-1.5 py-1 text-[12px] text-[rgb(var(--c-text-muted))] transition-colors hover:text-[rgb(var(--c-text))]"
                  >
                    {thinkingExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      <span>分析过程</span>
                  </button>
                  {thinkingExpanded && (
                    <div className="py-1 pl-4 text-[12.5px] leading-6 text-[rgb(var(--c-text-muted))]">
                      <MarkdownRenderer content={thinkingContent} />
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── MessageList ───────────────────────────────────────────────────────────────

interface MessageListProps {
  messages: Message[];
  isStreaming: boolean;
  streamingPhase?: 'idle' | 'waiting' | 'thinking' | 'streaming' | 'processing';
  streamingSentAt?: number | null;
  onOptionClick?: (option: string) => void;
}

export default function MessageList({
  messages, isStreaming,
  streamingPhase = 'idle', streamingSentAt = null,
  onOptionClick,
}: MessageListProps) {
  const INITIAL_MESSAGE_COUNT = 60;
  const [visibleCount, setVisibleCount] = useState(INITIAL_MESSAGE_COUNT);
  const currentSessionId = useChatStore((state) => state.currentSessionId);
  const pendingDecision = useAskUserStore((state) => state.pending);
  const decisionHistory = useAskUserStore((state) => state.history);
  const decisionQueueLength = useAskUserStore((state) => state.queue.length);
  const conversationKey = messages[0]?.id ?? 'empty';
  const firstVisibleIndex = Math.max(0, messages.length - visibleCount);
  const visibleMessages = messages.slice(firstVisibleIndex);
  const visibleStart = visibleMessages[0]?.timestamp ?? 0;
  const relevantHistory = decisionHistory.filter((record) =>
    record.sourceView === 'chat'
    && record.sourceSessionId === currentSessionId
    && record.createdAt >= visibleStart
  );
  const relevantPending = pendingDecision?.sourceView === 'chat'
    && pendingDecision.sourceSessionId === currentSessionId
    ? pendingDecision
    : null;
  const timelineEvents = [
    ...visibleMessages.map((message) => ({ kind: 'message' as const, at: message.timestamp, message })),
    ...relevantHistory.map((decision) => ({ kind: 'decision' as const, at: decision.createdAt, decision })),
  ].sort((left, right) => left.at - right.at);

  useEffect(() => {
    setVisibleCount(INITIAL_MESSAGE_COUNT);
  }, [conversationKey]);

  // Gap detection: if streaming phase is 'streaming' but no text for 3s+, switch to 'processing'
  useEffect(() => {
    if (!isStreaming) return;
    const timer = setInterval(() => {
      const store = useChatStore.getState();
      const { streamingPhase: phase, streamingLastTextAt, isStreaming: streaming } = store;
      if (streaming && phase === 'streaming' && streamingLastTextAt && Date.now() - streamingLastTextAt > 3000) {
        store.setStreamingPhase('processing');
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [isStreaming]);

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-6 py-8">
      {firstVisibleIndex > 0 && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setVisibleCount((count) => Math.min(messages.length, count + 60))}
            className="rounded-md px-3 py-1.5 text-[12px] text-[rgb(var(--c-text-muted))] transition-colors hover:bg-[rgb(var(--c-card))] hover:text-[rgb(var(--c-text))]"
          >
            显示更早的 {Math.min(60, firstVisibleIndex)} 条消息
          </button>
        </div>
      )}

      {timelineEvents.map((event, visibleIndex) => {
        if (event.kind === 'decision') {
          return (
            <AskUserDecisionCard
              key={`decision-${event.decision.id}`}
              request={event.decision}
              variant="main"
            />
          );
        }
        const message = event.message;
        const messageIndex = messages.findIndex((candidate) => candidate.id === message.id);
        const index = messageIndex >= 0 ? messageIndex : firstVisibleIndex + visibleIndex;
        const isRecent = index >= messages.length - 4;
        return (
        <div key={message.id} className={message.role === 'assistant' ? 'space-y-3' : undefined}>
          {message.role === 'assistant' && (
            <WorkLogCard
              thinkingContent={message.thinkingContent}
              duration={message.workingDuration ?? null}
              runId={typeof message.metadata?.runId === 'string' ? message.metadata.runId : undefined}
              toolExecutions={Array.isArray(message.metadata?.toolExecutions) ? message.metadata.toolExecutions : undefined}
              defaultExpanded={isRecent}
              animateEntry={isRecent}
            />
          )}
          <MessageItem
            message={message}
            index={index}
            animateEntry={isRecent}
            onOptionClick={onOptionClick}
          />
        </div>
        );
      })}

      {/* Codex-like streaming work log */}
      {isStreaming && streamingPhase !== 'idle' && (
        <StreamingCard
          phase={streamingPhase as 'waiting' | 'thinking' | 'streaming' | 'processing'}
          sentAt={streamingSentAt}
        />
      )}

      {relevantPending && (
        <AskUserDecisionCard
          key={`decision-${relevantPending.id}`}
          request={relevantPending}
          variant="main"
          queueLength={decisionQueueLength}
        />
      )}
    </div>
  );
}

/**
 * Detect a numbered/lettered option list at the END of an assistant message.
 * Returns the main content (without options) and the option strings.
 * Only triggers when there are 2–7 short items, so code listings are not affected.
 */
function parseOptions(content: string): { cleanContent: string; options: string[] } {
  // Primary: look for the explicit choices marker.
  // Format: [选项: 文字1 | 文字2 | 文字3]
  const markerMatch = content.match(/\[选项:\s*([^\]]+)\]/);
  if (markerMatch) {
    const options = markerMatch[1].split('|').map((s) => s.trim()).filter(Boolean);
    if (options.length >= 2 && options.length <= 7) {
      const cleanContent = content.replace(/\n?\[选项:[^\]]+\]/, '').trim();
      return { cleanContent, options };
    }
  }

  // Fallback: pattern-match lettered/numbered options at the end of the message.
  // Only matches "A. text" / "1. text" style — NOT bullet points (- •) which are
  // almost always informational lists, not user choices.
  const lines = content.split('\n');
  const OPTION_RE = /^(?:(\d+|[A-Z])[.)、]|[一二三四五六七八][、.])\s*(.+)$/;

  // Skip trailing blank lines and very short non-option lines (≤ 15 chars, e.g. "选哪个？")
  let end = lines.length - 1;
  while (end >= 0) {
    const line = lines[end].trim();
    if (!line || (!OPTION_RE.test(line) && line.length <= 15)) { end--; continue; }
    break;
  }

  const optionLines: string[] = [];
  let firstOptionIndex = end + 1;
  for (let i = end; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    const m = line.match(OPTION_RE);
    if (m) {
      optionLines.unshift((m[2] ?? m[1]).trim());
      firstOptionIndex = i;
    } else {
      break;
    }
  }

  if (optionLines.length >= 2 && optionLines.length <= 7 && optionLines.every((o) => o.length <= 100)) {
    const cleanLines = lines.slice(0, firstOptionIndex);
    while (cleanLines.length > 0 && !cleanLines[cleanLines.length - 1].trim()) cleanLines.pop();
    return { cleanContent: cleanLines.join('\n'), options: optionLines };
  }

  // Last resort: inline options on a single line — "A. text B. text C. text"
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k].trim();
    if (!line || !/^[A-Z][.)]\s/.test(line)) continue;
    const opts: string[] = [];
    const re = /[A-Z][.)]\s+(.+?)(?=\s+[A-Z][.)]|$)/g;
    let match;
    while ((match = re.exec(line)) !== null) {
      const opt = match[1].trim();
      if (opt) opts.push(opt);
    }
    if (opts.length < 2 || opts.length > 7 || opts.some((o) => o.length > 100)) continue;
    const cleanLines = lines.filter((_, idx) => idx !== k);
    while (cleanLines.length > 0 && !cleanLines[cleanLines.length - 1].trim()) cleanLines.pop();
    return { cleanContent: cleanLines.join('\n').trim(), options: opts };
  }

  return { cleanContent: content, options: [] };
}

function optionParts(option: string): { title: string; detail: string } {
  const normalized = option.trim();
  const bold = normalized.match(/^\*\*(.+?)\*\*\s*(?:[—–-]\s*)?(.*)$/);
  if (bold) return { title: bold[1].trim(), detail: bold[2].trim() };
  const split = normalized.match(/^(.{1,24}?)\s*[—–]\s*(.+)$/);
  if (split) return { title: split[1].trim(), detail: split[2].trim() };
  return { title: normalized.replace(/\*\*/g, ''), detail: '' };
}

interface MessageItemProps {
  message: Message;
  index: number;
  animateEntry?: boolean;
  isStreaming?: boolean;
  onOptionClick?: (option: string) => void;
}

function MessageItem({ message, index, animateEntry = true, isStreaming, onOptionClick }: MessageItemProps) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const displayContent = isUser ? stripHarnessPrefix(message.content) : message.content;
  const artifacts = artifactsFromMessage(message).filter((artifact) => artifact.origin !== 'source');

  const handleCopy = async () => {
    await navigator.clipboard.writeText(displayContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const { cleanContent, options } =
    !isUser && !isStreaming
      ? parseOptions(displayContent)
      : { cleanContent: displayContent, options: [] };

  // ── User message ──────────────────────────────────────────────────
  if (isUser) {
    return (
      <motion.div
        className="flex flex-col items-end"
        initial={animateEntry ? { opacity: 0, y: 8 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: Math.min(index * 0.02, 0.2) }}
      >
        {artifacts.length > 0 && <div className="w-full max-w-[78%]"><ArtifactGrid artifacts={artifacts} compact /></div>}
        {displayContent && (
          <div className="mt-2 max-w-[72%] whitespace-pre-wrap rounded-2xl rounded-tr-[6px] bg-[rgb(var(--c-card))] px-4 py-2.5 text-[15px] leading-relaxed text-[rgb(var(--c-text))]">
            {displayContent}
          </div>
        )}
        <div className="mt-1 text-[11px] text-[rgb(var(--c-text-muted))] opacity-0 transition-opacity hover:opacity-100">
          {new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </motion.div>
    );
  }

  // ── Assistant message ─────────────────────────────────────────────
  return (
    <motion.div
      className="group"
      initial={animateEntry ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.02, 0.2) }}
    >
        {/* Text (no bubble background) */}
        {(cleanContent || isStreaming) && <div className="text-[15px] leading-relaxed">
          <MarkdownRenderer content={cleanContent} />
          {isStreaming && (
            <motion.span
              className="inline-block w-0.5 h-[1em] bg-gray-400 ml-0.5 align-text-bottom"
              animate={{ opacity: [1, 0] }}
              transition={{ repeat: Infinity, duration: 0.7 }}
            />
          )}
        </div>}

        <ArtifactGrid artifacts={artifacts} />

        {/* Clickable option buttons */}
        {options.length > 0 && (
          <div className="mt-3 max-w-xl overflow-hidden rounded-lg border border-[rgb(var(--c-border))] bg-white dark:bg-transparent">
            {options.map((opt, i) => (
              <button
                key={i}
                onClick={() => onOptionClick?.(opt)}
                className={`group/option flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[rgb(var(--c-card))] ${i > 0 ? 'border-t border-[rgb(var(--c-border))]' : ''}`}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[rgb(var(--c-border))] text-[10px] text-[rgb(var(--c-text-muted))] transition-colors group-hover/option:border-[rgb(var(--c-text-muted))]">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 text-[13px] leading-5">
                  <span className="font-medium text-[rgb(var(--c-text))]">{optionParts(opt).title}</span>
                  {optionParts(opt).detail && <span className="ml-2 text-[rgb(var(--c-text-muted))]">{optionParts(opt).detail}</span>}
                </span>
                <ArrowRight size={13} className="shrink-0 text-[rgb(var(--c-text-muted))] opacity-0 transition-opacity group-hover/option:opacity-100" />
              </button>
            ))}
          </div>
        )}

        {/* Copy + timestamp — appear on hover */}
        <div className="mt-2 flex items-center gap-3">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-xs text-[rgb(var(--c-text-muted))] opacity-0 transition-all hover:text-[rgb(var(--c-text))] group-hover:opacity-100"
          >
            {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
            {copied ? '已复制' : '复制'}
          </button>
          <span className="text-xs text-[rgb(var(--c-text-muted))] opacity-0 transition-opacity group-hover:opacity-100">
            {new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
    </motion.div>
  );
}
