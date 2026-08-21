/**
 * AgentDrawer — 三视图（画布/工坊/剪辑）共享的鲲鹏助手抽屉壳。
 *
 * TapNow 风格：大字问候空态 + 建议胶囊、markdown 气泡、卡片式多行输入区
 * （附件 / 确认模式下拉 / 白圆发送钮）。视图差异（prefix 构建、@ 引用、
 * 自动派发）留在各自的薄 wrapper 里，壳只管 UI。
 *
 * 坑位备忘：收起态竖条的垂直居中（-translate-y-1/2）必须放在不做动画的
 * 外层 div 上——framer 动画值会覆写整个 inline transform。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Square, Loader2, MessageSquare, ArrowUp, ChevronDown,
  ShieldCheck, Zap, Paperclip, ImageIcon,
} from 'lucide-react';
import { open as tauriOpen } from '@tauri-apps/api/dialog';
import { useChatStore } from '@/stores';
import { useSettingsStore } from '@/stores/settingsStore';
import { useSound } from '@/hooks/useSound';
import { MarkdownRenderer } from '@/lib/markdown';
import { stripHarnessPrefix } from '@/lib/agent/harnessDisplay';
import type { useCanvasMention } from '@/hooks/useCanvasMention';
import ProjectSessionSwitcher from '../projects/ProjectSessionSwitcher';
import ArtifactPickerPanel from '../canvas/ArtifactPickerPanel';
import type { ArtifactEntry } from '@/lib/artifacts';
import RunStepTimeline from './RunStepTimeline';
import WorkspaceAgentModelPicker from './WorkspaceAgentModelPicker';
import type { AgentWorkspaceScope } from '@/lib/agent/modelCatalog';
import { AskUserDecisionCard } from '../AskUserDialog';
import { useAskUserStore, type AskUserRecord } from '@/stores/askUserStore';
import ContextUsagePill from './ContextUsagePill';
import { splitStreamingParts } from '@/lib/chat/streamingParts';
import { tailWindow } from '@/lib/performance/tailWindow';
import type { Message } from '@/types';

const EASE = [0.32, 0.72, 0, 1] as const;

const MemoMarkdown = memo(function MemoMarkdown({
  content,
  tone,
}: {
  content: string;
  tone: 'light' | 'dark';
}) {
  return <MarkdownRenderer content={content} tone={tone} />;
});

type DrawerStreamingSnapshot = {
  phase: ReturnType<typeof useChatStore.getState>['streamingPhase'];
  content: string;
  thinking: string;
};

const EMPTY_STREAMING_SNAPSHOT: DrawerStreamingSnapshot = {
  phase: 'idle',
  content: '',
  thinking: '',
};

function readStreamingSnapshot(): DrawerStreamingSnapshot {
  const state = useChatStore.getState();
  return {
    phase: state.streamingPhase,
    content: state.streamingContent,
    thinking: state.streamingThinkingContent,
  };
}

function useThrottledStreamingSnapshot(open: boolean): DrawerStreamingSnapshot {
  const [snapshot, setSnapshot] = useState<DrawerStreamingSnapshot>(() => (
    open ? readStreamingSnapshot() : EMPTY_STREAMING_SNAPSHOT
  ));

  useEffect(() => {
    if (!open) {
      setSnapshot(EMPTY_STREAMING_SNAPSHOT);
      return;
    }

    let latest = readStreamingSnapshot();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      setSnapshot(latest);
    };
    const schedule = () => {
      latest = readStreamingSnapshot();
      if (!timer) timer = setTimeout(flush, 160);
    };

    setSnapshot(latest);
    const unsubscribe = useChatStore.subscribe((state, previous) => {
      if (
        state.streamingPhase !== previous.streamingPhase
        || state.streamingContent !== previous.streamingContent
        || state.streamingThinkingContent !== previous.streamingThinkingContent
      ) {
        schedule();
      }
    });

    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [open]);

  return snapshot;
}

function streamingPhaseLabel(phase: DrawerStreamingSnapshot['phase']): string | null {
  return phase === 'waiting' ? '等待响应...'
    : phase === 'thinking' ? '思考中...'
    : phase === 'processing' ? '执行工具...'
    : null;
}

const THEME_DARK = {
  panelBg: 'rgba(20,20,22,0.98)',
  panelBorder: 'var(--canvas-node-border)',
  panelShadow: '-12px 0 48px rgba(0,0,0,0.4)',
  headerBorder: 'rgba(255,255,255,0.06)',
  iconBadgeBg: 'rgba(255,255,255,0.08)',
  text1: 'var(--canvas-text-1)',
  text2: 'var(--canvas-text-2)',
  text3: 'var(--canvas-text-3)',
  userBubbleBg: 'rgba(255,255,255,0.08)',
  userBubbleText: 'var(--canvas-text-1)',
  assistBubbleBg: 'rgba(255,255,255,0.04)',
  inputCardBg: 'rgba(255,255,255,0.05)',
  inputCardBorder: 'rgba(255,255,255,0.09)',
  inputCardShadow: 'none',
  suggestionBg: 'rgba(255,255,255,0.05)',
  suggestionBorder: 'rgba(255,255,255,0.08)',
  suggestionBorderHover: 'rgba(255,255,255,0.25)',
  controlHoverBg: 'rgba(255,255,255,0.08)',
  stopBg: 'rgba(255,255,255,0.12)',
  stopBgHover: 'rgba(255,255,255,0.2)',
  sendBg: '#FFFFFF',
  sendText: '#000000',
  fileBadgeBg: 'rgba(255,255,255,0.07)',
  tabBg: 'var(--canvas-panel)',
  tabBorder: 'var(--canvas-node-border)',
  tabShadow: '-4px 0 16px rgba(0,0,0,0.25)',
  confirmBg: 'rgba(24,25,28,0.97)',
  confirmBorder: 'rgba(255,255,255,0.09)',
  confirmShadow: '0 12px 36px rgba(0,0,0,0.5)',
  confirmHoverBg: 'rgba(255,255,255,0.04)',
  confirmActiveBg: 'rgba(255,255,255,0.06)',
  cursorBg: 'var(--canvas-text-2)',
  thinkingBg: 'rgba(255,255,255,0.03)',
  mdClass: 'drawer-md',
} as const;

const THEME_LIGHT = {
  panelBg: 'rgba(255,255,255,0.96)',
  panelBorder: 'rgba(0,0,0,0.06)',
  panelShadow: '-8px 0 24px rgba(0,0,0,0.06)',
  headerBorder: 'rgba(0,0,0,0.06)',
  iconBadgeBg: '#F3F4F6',
  text1: '#1A1A1A',
  text2: '#4B5563',
  text3: '#9CA3AF',
  userBubbleBg: '#F3F4F6',
  userBubbleText: '#1A1A1A',
  assistBubbleBg: 'transparent',
  inputCardBg: '#FFFFFF',
  inputCardBorder: 'rgba(0,0,0,0.08)',
  inputCardShadow: '0 1px 3px rgba(0,0,0,0.04)',
  suggestionBg: 'transparent',
  suggestionBorder: 'rgba(0,0,0,0.08)',
  suggestionBorderHover: 'rgba(0,0,0,0.16)',
  controlHoverBg: 'rgba(0,0,0,0.04)',
  stopBg: 'rgba(0,0,0,0.06)',
  stopBgHover: 'rgba(0,0,0,0.1)',
  sendBg: '#1A1A1A',
  sendText: '#FFFFFF',
  fileBadgeBg: '#F3F4F6',
  tabBg: '#FFFFFF',
  tabBorder: 'rgba(0,0,0,0.08)',
  tabShadow: '-4px 0 12px rgba(0,0,0,0.05)',
  confirmBg: '#FFFFFF',
  confirmBorder: 'rgba(0,0,0,0.08)',
  confirmShadow: '0 8px 24px rgba(0,0,0,0.1)',
  confirmHoverBg: 'rgba(0,0,0,0.03)',
  confirmActiveBg: '#F3F4F6',
  cursorBg: '#1A1A1A',
  thinkingBg: '#F9FAFB',
  mdClass: 'drawer-md-light',
} as const;

type DrawerTheme = typeof THEME_DARK | typeof THEME_LIGHT;
type DrawerEvent =
  | { kind: 'message'; at: number; message: Message }
  | { kind: 'decision'; at: number; decision: AskUserRecord };

const DrawerEventList = memo(function DrawerEventList({
  events,
  stripPrefixRe,
  decisionVariant,
  variant,
  theme,
}: {
  events: DrawerEvent[];
  stripPrefixRe: RegExp;
  decisionVariant: 'drawer-light' | 'drawer-dark';
  variant: 'light' | 'dark';
  theme: DrawerTheme;
}) {
  return (
    <>
      {events.map((event, index) => (
        event.kind === 'decision' ? (
          <AskUserDecisionCard
            key={`decision-${event.decision.id}`}
            request={event.decision}
            variant={decisionVariant}
          />
        ) : event.message.role === 'user' ? (
          <div key={event.message.id || index} className="flex justify-end">
            <div
              className="max-w-[85%] px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap"
              style={{ background: theme.userBubbleBg, color: theme.userBubbleText, borderRadius: '14px 14px 4px 14px' }}
            >
              {stripHarnessPrefix(event.message.content).replace(stripPrefixRe, '')}
            </div>
          </div>
        ) : (
          <div key={event.message.id || index} className="flex justify-start">
            <div
              className={`max-w-[92%] px-3 py-2 text-[12px] leading-relaxed ${theme.mdClass}`}
              style={{ background: theme.assistBubbleBg, color: theme.text2, borderRadius: '14px 14px 14px 4px' }}
            >
              <MemoMarkdown content={event.message.content} tone={variant} />
            </div>
          </div>
        )
      ))}
    </>
  );
});

const DrawerStreamingContent = memo(function DrawerStreamingContent({
  open,
  variant,
  theme,
  onVisualUpdate,
}: {
  open: boolean;
  variant: 'light' | 'dark';
  theme: DrawerTheme;
  onVisualUpdate: () => void;
}) {
  const snapshot = useThrottledStreamingSnapshot(open);
  const isStreaming = snapshot.phase !== 'idle';
  const phaseLabel = streamingPhaseLabel(snapshot.phase);
  const { stable, tail } = useMemo(
    () => splitStreamingParts(snapshot.content),
    [snapshot.content],
  );
  const visibleThinkingContent = useMemo(() => {
    const text = snapshot.thinking.trim();
    if (text.length <= 6000) return text;
    return `…前文已折叠\n${text.slice(-6000)}`;
  }, [snapshot.thinking]);

  useEffect(() => {
    if (isStreaming) onVisualUpdate();
  }, [isStreaming, snapshot.content, snapshot.thinking, onVisualUpdate]);

  if (!isStreaming) return null;

  return (
    <>
      <div className="min-w-0 max-w-full overflow-hidden rounded-lg border px-2.5 py-2" style={{ borderColor: theme.headerBorder, background: 'rgba(255,255,255,0.018)' }}>
        <div className="mb-1 flex items-center gap-2 text-[11px] leading-4" style={{ color: theme.text3 }}>
          <Loader2 size={11} className="animate-spin" />
          <span>{phaseLabel || '正在工作'}</span>
        </div>
        <RunStepTimeline compact showHeader={false} className="min-w-0 max-w-full" tone={variant} />
      </div>
      {snapshot.content && (
        <div className="flex justify-start">
          <div
            className={`max-w-[92%] px-3 py-2 text-[12px] leading-relaxed ${theme.mdClass}`}
            style={{ background: theme.assistBubbleBg, color: theme.text2, borderRadius: '14px 14px 14px 4px' }}
          >
            {stable && <MemoMarkdown content={stable} tone={variant} />}
            <span className="whitespace-pre-wrap">{tail}</span>
            <span className="inline-block w-1.5 h-3 ml-0.5 animate-pulse align-middle" style={{ background: theme.cursorBg }} />
          </div>
        </div>
      )}
      {snapshot.phase === 'thinking' && visibleThinkingContent && (
        <div
          className="mx-0.5 max-h-28 max-w-full overflow-y-auto whitespace-pre-wrap break-words rounded-lg border px-2.5 py-2 text-[11px] leading-[18px] [overflow-wrap:anywhere]"
          style={{ background: theme.thinkingBg, borderColor: theme.headerBorder, color: theme.text3 }}
        >
          {visibleThinkingContent}
        </div>
      )}
    </>
  );
});

export interface AgentDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 头部标题（默认 鲲鹏） */
  title?: string;
  /** 渲染用户消息时剥掉的上下文前缀 */
  stripPrefixRe: RegExp;
  /** 空态问候（hello 小字 + title 大字） */
  greeting: { hello: string; title: string };
  /** 建议胶囊（点击填入输入框） */
  suggestions: string[];
  /** 发送（text 为原始输入；prefix 由 wrapper 在此回调里拼） */
  onSend: (text: string, files?: string[]) => void;
  onAbort: () => void;
  /** 收起态徽标计数 */
  badgeCount?: number;
  /** 附件按钮（点击返回选中的文件路径） */
  onPickFiles?: () => Promise<string[] | null>;
  /** @ 引用支持（画布专属，传 useCanvasMention 实例） */
  mention?: ReturnType<typeof useCanvasMention>;
  placeholder?: string;
  /** 主题变体：dark（默认，画布/工坊/剪辑）| light（文案工作室） */
  variant?: 'dark' | 'light';
  /** 控件行额外按钮（附件按钮之后，发送按钮之前） */
  extraActions?: React.ReactNode;
  /** 外部预填草稿；用于工具面板把上下文带入统一抽屉。 */
  draft?: string;
  onDraftConsumed?: () => void;
  /** 收起入口距容器底部的距离，默认 16px。 */
  launcherBottom?: number;
  /** 画布/工坊/剪辑的模型覆盖选择；未传时不显示。 */
  modelScope?: AgentWorkspaceScope;
  /** 派单队列（工坊 AI 派单）；未传或为空时不显示队列条。 */
  queueItems?: { id: string; label: string; status: 'queued' | 'running' }[];
  /** 取消排队项（仅 queued 可取消；running 项由 onAbort 负责） */
  onCancelQueueItem?: (id: string) => void;
  /** 当前交给 Agent 的工作对象，例如画布节点。 */
  contextBanner?: React.ReactNode;
  /** 工作对象稳定键；切换对象时驱动轻量转入动画。 */
  contextBannerKey?: string;
}

export default function AgentDrawer({
  open, onOpenChange, title = '鲲鹏', stripPrefixRe, greeting, suggestions,
  onSend, onAbort, badgeCount, onPickFiles, mention, placeholder,
  variant = 'dark', extraActions, draft, onDraftConsumed, launcherBottom = 16,
  modelScope, queueItems, onCancelQueueItem, contextBanner, contextBannerKey,
}: AgentDrawerProps) {
  const t = variant === 'light' ? THEME_LIGHT : THEME_DARK;
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [artifactPickerOpen, setArtifactPickerOpen] = useState(false);
  const [visibleHistoryCount, setVisibleHistoryCount] = useState(60);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    if (!draft) return;
    setInput(draft);
    onDraftConsumed?.();
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }, [draft, onDraftConsumed]);

  const messages = useChatStore((s) => s.messages);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const activeView = useChatStore((s) => s.activeView);
  // Only phase stays in the drawer shell. Token content is subscribed inside
  // DrawerStreamingContent so a delta cannot reconcile the full history/input.
  const streamingPhase = useChatStore((s) => s.streamingPhase);
  const isStreaming = streamingPhase !== 'idle';
  const pendingDecision = useAskUserStore((state) => state.pending);
  const decisionHistory = useAskUserStore((state) => state.history);
  const decisionQueueLength = useAskUserStore((state) => state.queue.length);

  const { playNotification } = useSound();
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      const currentError = useChatStore.getState().error;
      if (!currentError) playNotification();
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming, playNotification]);

  const scheduleScrollToBottom = useCallback((force = false) => {
    if (!open || (!force && !stickToBottomRef.current) || scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const list = listRef.current;
      if (list) list.scrollTop = list.scrollHeight;
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    stickToBottomRef.current = true;
    const timer = setTimeout(() => scheduleScrollToBottom(true), 300);
    return () => clearTimeout(timer);
  }, [open, currentSessionId, scheduleScrollToBottom]);

  useEffect(() => {
    scheduleScrollToBottom();
  }, [messages, pendingDecision?.id, decisionHistory.length, scheduleScrollToBottom]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  // 动画结束后再聚焦（提前聚焦的 scroll-to-focus 会拽飞行中的面板）
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 320);
    return () => clearTimeout(t);
  }, [open]);

  const handleSend = () => {
    if (!input.trim()) return;
    onSend(input.trim(), files.length > 0 ? [...files] : undefined);
    setInput('');
    setFiles([]);
    if (inputRef.current) inputRef.current.style.height = 'auto';
  };

  const handleAttach = async () => {
    if (onPickFiles) {
      const picked = await onPickFiles();
      if (picked && picked.length > 0) setFiles((prev) => [...prev, ...picked]);
      return;
    }
    const picked = await tauriOpen({
      multiple: true,
      filters: [{ name: '支持的文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'mov', 'webm', 'mp3', 'wav', 'md', 'txt', 'pdf', 'doc', 'docx', 'csv', 'json', 'srt'] }],
    });
    if (picked) {
      const paths = Array.isArray(picked) ? picked : [picked];
      if (paths.length > 0) setFiles((prev) => [...prev, ...paths]);
    }
  };

  const handleArtifactPick = (entry: ArtifactEntry) => {
    setFiles((prev) => [...prev, entry.path]);
    setArtifactPickerOpen(false);
  };

  const writeClipboardText = async (text: string) => {
    try {
      await navigator.clipboard?.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  };

  const readClipboardText = async () => {
    try {
      return await navigator.clipboard?.readText();
    } catch {
      return '';
    }
  };

  const replaceTextareaSelection = (el: HTMLTextAreaElement, text: string) => {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const next = el.value.slice(0, start) + text + el.value.slice(end);
    el.value = next;
    setInput(next);
    const cursor = start + text.length;
    requestAnimationFrame(() => {
      el.focus({ preventScroll: true });
      el.setSelectionRange(cursor, cursor);
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 130)}px`;
    });
  };

  const protectTextShortcut = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (e.altKey) return;
    const k = e.key.toLowerCase();
    const el = e.currentTarget;
    if (k === 'a') {
      e.preventDefault();
      e.stopPropagation();
      el.select();
      return;
    }
    if (k === 'c') {
      e.preventDefault();
      e.stopPropagation();
      const selected = el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0);
      if (selected) void writeClipboardText(selected);
      return;
    }
    if (k === 'x') {
      e.preventDefault();
      e.stopPropagation();
      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? 0;
      const selected = el.value.slice(start, end);
      if (!selected) return;
      void writeClipboardText(selected);
      replaceTextareaSelection(el, '');
      return;
    }
    if (k === 'v') {
      e.preventDefault();
      e.stopPropagation();
      void readClipboardText().then((text) => {
        if (text) replaceTextareaSelection(el, text);
      });
      return;
    }
    if (k === 'z') {
      e.stopPropagation();
    }
  };

  const phaseLabel = streamingPhaseLabel(streamingPhase);
  const chat = useMemo(
    () => messages.filter((message) => message.role === 'user' || message.role === 'assistant'),
    [messages],
  );
  const historyWindow = useMemo(
    () => tailWindow(chat, visibleHistoryCount),
    [chat, visibleHistoryCount],
  );
  const firstVisibleHistoryIndex = historyWindow.startIndex;
  const visibleChat = historyWindow.items;
  const visibleHistoryStart = visibleChat[0]?.timestamp ?? 0;
  const relevantDecisionHistory = useMemo(() => decisionHistory.filter((record) =>
    record.sourceView === activeView
      && record.sourceSessionId === currentSessionId
      && record.createdAt >= visibleHistoryStart
  ), [activeView, currentSessionId, decisionHistory, visibleHistoryStart]);
  const relevantPendingDecision = pendingDecision?.sourceView === activeView
    && pendingDecision.sourceSessionId === currentSessionId
    ? pendingDecision
    : null;
  const drawerEvents = useMemo<DrawerEvent[]>(() => [
    ...visibleChat.map((message) => ({ kind: 'message' as const, at: message.timestamp, message })),
    ...relevantDecisionHistory.map((decision) => ({ kind: 'decision' as const, at: decision.createdAt, decision })),
  ].sort((left, right) => left.at - right.at), [relevantDecisionHistory, visibleChat]);
  const combinedBadgeCount = (badgeCount ?? 0) + (relevantPendingDecision ? 1 : 0);
  const decisionVariant = variant === 'light' ? 'drawer-light' : 'drawer-dark';

  useEffect(() => {
    setVisibleHistoryCount(60);
  }, [currentSessionId]);

  return (
    <>
      {/* 收起态：右缘轻量入口 */}
      <AnimatePresence>
        {!open && variant === 'dark' && (
          <div className="absolute right-3 z-40" style={{ bottom: launcherBottom }}>
            <motion.button
              initial={{ x: 16, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 16, opacity: 0 }}
              transition={{ type: 'tween', duration: 0.2, ease: EASE }}
              onClick={() => onOpenChange(true)}
              className="relative flex h-9 w-9 items-center justify-center rounded-full border transition-colors hover:bg-white/[0.08]"
              style={{
                background: 'rgba(18,18,20,0.88)',
                borderColor: t.tabBorder,
                boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
              }}
              title={`打开${title}助手`}
            >
              <MessageSquare size={16} style={{ color: t.text2 }} />
              {combinedBadgeCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 rounded-full bg-zinc-200 text-black text-[9px] font-medium flex items-center justify-center">
                  {combinedBadgeCount > 9 ? '9+' : combinedBadgeCount}
                </span>
              )}
            </motion.button>
          </div>
        )}
      </AnimatePresence>

      {/* 收起态 light variant：参与 flex 布局的窄图标栏 */}
      {!open && variant === 'light' && (
        <button
          onClick={() => onOpenChange(true)}
          className="relative shrink-0 flex items-center justify-center cursor-pointer transition-colors"
          style={{
            width: 34,
            height: '100%',
            borderLeft: '1px solid var(--cw-border)',
            background: 'var(--cw-sidebar)',
            color: '#6B7280',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#F3F4F6'; e.currentTarget.style.color = '#1A1A1A'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'var(--cw-sidebar)'; e.currentTarget.style.color = '#6B7280'; }}
          title={`打开${title}`}
        >
          <MessageSquare size={14} />
          {combinedBadgeCount > 0 && (
            <span className="absolute right-1 top-1 flex h-2 w-2 rounded-full bg-zinc-900" aria-label="有待回答问题" />
          )}
        </button>
      )}

      {/* 抽屉本体 */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ x: 388 }}
            animate={{ x: 0 }}
            exit={{ x: 388 }}
            transition={{ type: 'tween', duration: 0.28, ease: EASE }}
            className="absolute top-0 bottom-0 right-0 w-[380px] flex flex-col z-40"
            style={{
              background: t.panelBg,
              backdropFilter: variant === 'light' ? 'blur(24px) saturate(1.3)' : undefined,
              WebkitBackdropFilter: variant === 'light' ? 'blur(24px) saturate(1.3)' : undefined,
              borderLeft: `1px solid ${t.panelBorder}`,
              boxShadow: t.panelShadow,
              willChange: 'transform',
            }}
          >
            {/* 头部 */}
            <div className="flex items-center justify-between px-4 shrink-0" style={{ height: 46, borderBottom: `1px solid ${t.headerBorder}` }}>
              <div className="flex items-center gap-2">
                {variant === 'dark' && (
                  <span className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: t.iconBadgeBg }}>
                    <MessageSquare size={13} style={{ color: t.text1 }} />
                  </span>
                )}
                <span className="text-sm font-medium" style={{ color: t.text1 }}>{title}</span>
                {isStreaming && phaseLabel && (
                  <span className="flex items-center gap-1 text-[10px]" style={{ color: t.text2 }}>
                    <Loader2 size={10} className="animate-spin" />{phaseLabel}
                  </span>
                )}
                {!isStreaming && relevantPendingDecision && (
                  <span className="text-[10px]" style={{ color: t.text2 }}>等待你的选择</span>
                )}
              </div>
              <div className="flex items-center gap-0.5">
                <ContextUsagePill tone={variant} />
                <ProjectSessionSwitcher />
                <button onClick={() => onOpenChange(false)} className="p-1.5 rounded-md transition-colors" style={{ color: t.text2 }}
                  onMouseEnter={e => { e.currentTarget.style.color = t.text1; e.currentTarget.style.background = t.controlHoverBg; }}
                  onMouseLeave={e => { e.currentTarget.style.color = t.text2; e.currentTarget.style.background = 'transparent'; }}
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            <AnimatePresence initial={false} mode="wait">
              {contextBanner && (
                <motion.div
                  key={contextBannerKey || 'agent-context'}
                  initial={{ opacity: 0, y: -7, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -5, scale: 0.98 }}
                  transition={{ duration: 0.2, delay: 0.42, ease: EASE }}
                  className="shrink-0 px-3 py-2"
                  style={{ borderBottom: `1px solid ${t.headerBorder}` }}
                >
                  {contextBanner}
                </motion.div>
              )}
            </AnimatePresence>

            {/* 派单队列条：执行中项 + 排队项（仅 queued 可取消） */}
            {queueItems && queueItems.length > 0 && (
              <div className="px-4 py-2 shrink-0 space-y-1" style={{ borderBottom: `1px solid ${t.headerBorder}` }}>
                {queueItems.map((item) => (
                  <div key={item.id} className="flex items-center gap-1.5 text-[11px] leading-4 min-w-0">
                    {item.status === 'running' ? (
                      <Loader2 size={10} className="animate-spin shrink-0" style={{ color: t.text2 }} />
                    ) : (
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: t.text3 }} />
                    )}
                    <span className="truncate" style={{ color: item.status === 'running' ? t.text1 : t.text2 }}>
                      {item.label}
                    </span>
                    <span className="shrink-0 text-[10px]" style={{ color: t.text3 }}>
                      {item.status === 'running' ? '执行中' : '排队中'}
                    </span>
                    {item.status === 'queued' && onCancelQueueItem && (
                      <button
                        onClick={() => onCancelQueueItem(item.id)}
                        className="ml-auto p-0.5 rounded shrink-0 transition-colors"
                        style={{ color: t.text3 }}
                        onMouseEnter={e => { e.currentTarget.style.color = t.text1; e.currentTarget.style.background = t.controlHoverBg; }}
                        onMouseLeave={e => { e.currentTarget.style.color = t.text3; e.currentTarget.style.background = 'transparent'; }}
                        title="取消排队"
                      >
                        <X size={10} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* 消息区 */}
            <div
              ref={listRef}
              onScroll={(event) => {
                const element = event.currentTarget;
                stickToBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
              }}
              className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0"
            >
              {drawerEvents.length === 0 && !isStreaming && !relevantPendingDecision ? (
                variant === 'light' ? (
                <div className="h-full flex flex-col justify-center px-3 pb-10">
                  <p className="text-[13px] mb-1" style={{ color: t.text3 }}>{greeting.hello}</p>
                  <p className="text-[15px] font-medium mb-5" style={{ color: t.text1 }}>{greeting.title}</p>
                  <div className="flex flex-col gap-1">
                    {suggestions.map((sg) => (
                      <button
                        key={sg}
                        onClick={() => { setInput(sg); inputRef.current?.focus({ preventScroll: true }); }}
                        className="text-left text-[12px] py-1 transition-colors"
                        style={{ color: t.text3 }}
                        onMouseEnter={e => { e.currentTarget.style.color = t.text1; }}
                        onMouseLeave={e => { e.currentTarget.style.color = t.text3; }}
                      >
                        <span style={{ marginRight: 6, opacity: 0.4 }}>›</span>{sg}
                      </button>
                    ))}
                  </div>
                </div>
                ) : (
                <div className="h-full flex flex-col justify-center px-2 pb-10">
                  <span className="w-9 h-9 rounded-xl flex items-center justify-center mb-4" style={{ background: t.iconBadgeBg }}>
                    <MessageSquare size={17} style={{ color: t.text1 }} />
                  </span>
                  <p className="text-[19px] leading-snug" style={{ color: t.text2 }}>{greeting.hello}</p>
                  <p className="text-[23px] font-bold leading-snug mb-6" style={{ color: t.text1 }}>{greeting.title}</p>
                  <div className="flex flex-wrap gap-2">
                    {suggestions.map((sg) => (
                      <button
                        key={sg}
                        onClick={() => { setInput(sg); inputRef.current?.focus({ preventScroll: true }); }}
                        className="px-3 py-2 rounded-full text-[11px] transition-colors"
                        style={{ color: t.text2, background: t.suggestionBg, border: `1px solid ${t.suggestionBorder}` }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = t.suggestionBorderHover; e.currentTarget.style.color = t.text1; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = t.suggestionBorder; e.currentTarget.style.color = t.text2; }}
                      >
                        {sg}
                      </button>
                    ))}
                  </div>
                </div>
                )
              ) : (
                <>
                  {firstVisibleHistoryIndex > 0 && (
                    <div className="flex justify-center">
                      <button
                        type="button"
                        onClick={() => setVisibleHistoryCount((count) => Math.min(chat.length, count + 60))}
                        className="rounded-md px-3 py-1.5 text-[11px] transition-colors"
                        style={{ color: t.text3 }}
                        onMouseEnter={(event) => { event.currentTarget.style.color = t.text1; event.currentTarget.style.background = t.controlHoverBg; }}
                        onMouseLeave={(event) => { event.currentTarget.style.color = t.text3; event.currentTarget.style.background = 'transparent'; }}
                      >
                        显示更早的 {Math.min(60, firstVisibleHistoryIndex)} 条消息
                      </button>
                    </div>
                  )}
                  <DrawerEventList
                    events={drawerEvents}
                    stripPrefixRe={stripPrefixRe}
                    decisionVariant={decisionVariant}
                    variant={variant}
                    theme={t}
                  />
                  <DrawerStreamingContent
                    open={open}
                    variant={variant}
                    theme={t}
                    onVisualUpdate={scheduleScrollToBottom}
                  />
                  {relevantPendingDecision && (
                    <AskUserDecisionCard
                      key={`decision-${relevantPendingDecision.id}`}
                      request={relevantPendingDecision}
                      variant={decisionVariant}
                      queueLength={decisionQueueLength}
                    />
                  )}
                </>
              )}
            </div>

            {/* 输入卡片 */}
            <div className="px-3 pb-3 pt-1 shrink-0">
              <div
                className="rounded-2xl relative"
                style={{ background: t.inputCardBg, border: `1px solid ${t.inputCardBorder}`, boxShadow: t.inputCardShadow }}
              >
                {files.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
                    {files.map((f, i) => (
                      <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px]" style={{ background: t.fileBadgeBg, color: t.text2 }}>
                        {f.split('/').pop()}
                        <button onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} style={{ color: t.text2 }}
                          onMouseEnter={e => { e.currentTarget.style.color = t.text1; }}
                          onMouseLeave={e => { e.currentTarget.style.color = t.text2; }}
                        ><X size={9} /></button>
                      </span>
                    ))}
                  </div>
                )}
                <textarea
                  ref={inputRef}
                  data-kunpeng-ai-input="true"
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 130)}px`;
                    mention?.handleInputChange(e.target.value, e.target.selectionStart || 0);
                  }}
                  onKeyDown={(e) => {
                    if (mention?.showMention && mention.mentionItems.length > 0) {
                      if (mention.handleKeyDown(e)) {
                        if (e.key === 'Enter') setInput(mention.handleSelect(mention.mentionItems[mention.mentionIdx], input));
                        return;
                      }
                    }
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleSend(); }
                  }}
                  onKeyDownCapture={protectTextShortcut}
                  onCopy={(e) => e.stopPropagation()}
                  onCut={(e) => e.stopPropagation()}
                  onPaste={(e) => e.stopPropagation()}
                  placeholder={isStreaming ? '补充要求，发送后会调整当前任务...' : (placeholder ?? '描述创意或需求，@ 引用素材')}
                  rows={1}
                  className="w-full bg-transparent px-3.5 pt-3 pb-1 text-[12.5px] leading-relaxed resize-none focus:outline-none max-h-[130px]"
                  style={{ color: t.text1 }}
                />
                {mention?.showMention && mention.mentionItems.length > 0 && (
                  <div className="absolute bottom-full mb-2 left-0 right-0 bg-[var(--canvas-panel)] border border-[var(--canvas-node-border)] rounded-xl shadow-lg py-1 max-h-44 overflow-y-auto z-50">
                    {mention.mentionItems.map((item, i) => (
                      <button
                        key={item.nodeId}
                        onClick={() => setInput(mention.handleSelect(item, input))}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left transition-colors ${
                          i === mention.mentionIdx ? 'bg-[rgba(255,255,255,0.07)] text-[var(--canvas-text-1)]' : 'text-[var(--canvas-text-2)] hover:bg-[var(--canvas-controls-hover)]'
                        }`}
                      >
                        {item.thumbnailUrl && (
                          <img src={item.thumbnailUrl} alt="" loading="lazy" decoding="async" className="w-6 h-6 rounded object-cover shrink-0" />
                        )}
                        <span className="truncate">{item.label}</span>
                      </button>
                    ))}
                  </div>
                )}
                {/* 控件行 */}
                <div className="flex items-center gap-1 px-2 pb-2 pt-0.5">
                  <button
                    onClick={() => void handleAttach()}
                    className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center transition-colors"
                    style={{ color: t.text2 }}
                    onMouseEnter={e => { e.currentTarget.style.color = t.text1; e.currentTarget.style.background = t.controlHoverBg; }}
                    onMouseLeave={e => { e.currentTarget.style.color = t.text2; e.currentTarget.style.background = 'transparent'; }}
                    title="上传文件"
                  >
                    <Paperclip size={14} />
                  </button>
                  <button
                    onClick={() => setArtifactPickerOpen(true)}
                    className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center transition-colors"
                    style={{ color: t.text2 }}
                    onMouseEnter={e => { e.currentTarget.style.color = t.text1; e.currentTarget.style.background = t.controlHoverBg; }}
                    onMouseLeave={e => { e.currentTarget.style.color = t.text2; e.currentTarget.style.background = 'transparent'; }}
                    title="从产物库选取"
                  >
                    <ImageIcon size={14} />
                  </button>
                  <ConfirmModeSelect variant={variant} compact />
                  {modelScope && (
                    <div className="min-w-0 w-[88px] max-w-[104px] shrink overflow-hidden sm:w-[112px] sm:max-w-[112px]">
                      <WorkspaceAgentModelPicker
                        scope={modelScope}
                        variant={variant}
                        disabled={isStreaming}
                      />
                    </div>
                  )}
                  {extraActions}
                  <div className="min-w-0 flex-1" />
                  {isStreaming ? (
                    <div className="flex shrink-0 items-center gap-1.5">
                      {input.trim() && (
                        <button
                          onClick={handleSend}
                          className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center transition-all active:scale-95"
                          style={{ background: t.sendBg, color: t.sendText }}
                          title="补充当前任务"
                        >
                          <ArrowUp size={15} strokeWidth={2.5} />
                        </button>
                      )}
                      <button
                        onClick={onAbort}
                        className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center transition-colors"
                        style={{ background: t.stopBg, color: t.text1 }}
                        onMouseEnter={e => { e.currentTarget.style.background = t.stopBgHover; }}
                        onMouseLeave={e => { e.currentTarget.style.background = t.stopBg; }}
                        title="停止"
                      >
                        <Square size={11} fill="currentColor" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={handleSend}
                      disabled={!input.trim()}
                      className="w-8 h-8 shrink-0 rounded-full disabled:opacity-30 flex items-center justify-center transition-all active:scale-95"
                      style={{ background: t.sendBg, color: t.sendText }}
                      title="发送"
                    >
                      <ArrowUp size={15} strokeWidth={2.5} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ArtifactPickerPanel
        open={artifactPickerOpen}
        onClose={() => setArtifactPickerOpen(false)}
        onPick={handleArtifactPick}
        inline
      />
    </>
  );
}

/** 确认模式下拉：手动确认 / 自动执行（全局设置，主聊天同享） */
function ConfirmModeSelect({ variant = 'dark', compact = false }: { variant?: 'dark' | 'light'; compact?: boolean }) {
  const t = variant === 'light' ? THEME_LIGHT : THEME_DARK;
  const mode = useSettingsStore((s) => s.toolConfirmMode);
  const setMode = useSettingsStore((s) => s.setToolConfirmMode);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const Icon = mode === 'manual' ? ShieldCheck : Zap;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className={`flex h-7 items-center justify-center rounded-full text-[10.5px] transition-colors ${compact ? 'w-7 px-0' : 'gap-1 px-2'}`}
        style={{ color: t.text2 }}
        onMouseEnter={e => { e.currentTarget.style.color = t.text1; e.currentTarget.style.background = t.controlHoverBg; }}
        onMouseLeave={e => { e.currentTarget.style.color = t.text2; e.currentTarget.style.background = 'transparent'; }}
        title="工具执行确认模式"
        aria-label={`工具执行确认模式：${mode === 'manual' ? '手动确认' : '自动执行'}`}
      >
        <Icon size={11} />
        {!compact && <>{mode === 'manual' ? '手动确认' : '自动执行'}<ChevronDown size={9} className={`transition-transform ${open ? 'rotate-180' : ''}`} /></>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.12 }}
            className="absolute bottom-full mb-1.5 left-0 w-[210px] rounded-xl py-1 z-50"
            style={{ background: t.confirmBg, border: `1px solid ${t.confirmBorder}`, boxShadow: t.confirmShadow }}
          >
            {([
              ['manual', ShieldCheck, '手动确认', '危险操作（生成花钱/写文件等）先弹窗'],
              ['auto', Zap, '自动执行', '跳过确认直接执行，危险命令仍会被拦截'],
            ] as const).map(([v, MIcon, label, desc]) => (
              <button
                key={v}
                onClick={() => { setMode(v); setOpen(false); }}
                className="w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors"
                style={{ background: mode === v ? t.confirmActiveBg : 'transparent' }}
                onMouseEnter={e => { if (mode !== v) e.currentTarget.style.background = t.confirmHoverBg; }}
                onMouseLeave={e => { if (mode !== v) e.currentTarget.style.background = 'transparent'; }}
              >
                <MIcon size={13} className="mt-0.5 shrink-0" style={{ color: mode === v ? t.text1 : t.text3 }} />
                <span>
                  <span className="block text-[11.5px] font-medium" style={{ color: mode === v ? t.text1 : t.text2 }}>{label}</span>
                  <span className="block text-[9.5px] mt-0.5 leading-tight" style={{ color: t.text3 }}>{desc}</span>
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
