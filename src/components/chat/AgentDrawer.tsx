/**
 * AgentDrawer — 三视图（画布/工坊/剪辑）共享的鲲鹏助手抽屉壳。
 *
 * 共享创作对话：开放正文、折叠执行记录、固定多行输入区
 * （附件 / 确认模式下拉 / 白圆发送钮）。视图差异（prefix 构建、@ 引用、
 * 自动派发）留在各自的薄 wrapper 里，壳只管 UI。
 *
 * 坑位备忘：收起态竖条的垂直居中（-translate-y-1/2）必须放在不做动画的
 * 外层 div 上——framer 动画值会覆写整个 inline transform。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Square, Loader2, MessageSquare, ArrowUp, EyeOff,
  Paperclip, ImageIcon, Pencil, Trash2, RotateCcw, ListStart,
} from 'lucide-react';
import { open as tauriOpen } from '@tauri-apps/api/dialog';
import { useChatStore } from '@/stores';
import { useSound } from '@/hooks/useSound';
import { MarkdownRenderer } from '@/lib/markdown';
import { stripHarnessPrefix } from '@/lib/agent/harnessDisplay';
import type { useCanvasMention } from '@/hooks/useCanvasMention';
import ProjectSessionSwitcher from '../projects/ProjectSessionSwitcher';
import ArtifactPickerPanel from '../canvas/ArtifactPickerPanel';
import type { ArtifactEntry } from '@/lib/artifacts';
import RunStepTimeline from './RunStepTimeline';
import WorkspaceAgentModelPicker from './WorkspaceAgentModelPicker';
import ConfirmModeSelect from './ConfirmModeSelect';
import type { AgentWorkspaceScope } from '@/lib/agent/modelCatalog';
import { AskUserDecisionCard } from '../AskUserDialog';
import { useAskUserStore, type AskUserRecord } from '@/stores/askUserStore';
import ContextUsagePill from './ContextUsagePill';
import { splitStreamingParts } from '@/lib/chat/streamingParts';
import { tailWindow } from '@/lib/performance/tailWindow';
import type { Message } from '@/types';
import { useWorkshopStore } from '@/stores/workshopStore';
import type { ProjectViewState } from '@/lib/projectObjects/types';
import type { ProjectConversationReference } from '@/lib/projectObjects/types';
import ProjectChangeReview from './ProjectChangeReview';
import { PROJECT_REFERENCE_MIME, projectTransferReferences, resolveReferenceTransfer } from '@/lib/projectObjects/referenceTransfer';
import { mergeProjectConversationReferences } from '@/lib/projectObjects/conversationRefs';
import WorkspaceAssistantMessage from '../workspace/WorkspaceAssistantMessage';
import '../workspace/workspace-assistant.css';
import './conversation.css';
import ConversationAttachment from './ConversationAttachment';

const EMPTY_FILES: string[] = [];

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
  panelBg: '#141516',
  panelBorder: 'var(--canvas-node-border)',
  panelShadow: '-4px 0 24px rgba(0,0,0,0.14)',
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
  panelBg: '#fcfcfb',
  panelBorder: 'rgba(0,0,0,0.06)',
  panelShadow: '-8px 0 24px rgba(0,0,0,0.06)',
  headerBorder: 'rgba(0,0,0,0.06)',
  iconBadgeBg: '#F3F4F6',
  text1: '#1A1A1A',
  text2: '#4B5563',
  text3: '#797b80',
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
  embedded = false,
}: {
  events: DrawerEvent[];
  stripPrefixRe: RegExp;
  decisionVariant: 'drawer-light' | 'drawer-dark';
  variant: 'light' | 'dark';
  theme: DrawerTheme;
  embedded?: boolean;
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
              className={embedded ? 'conversation-user workspace-assistant-user' : 'conversation-user'}
              style={{ background: theme.userBubbleBg, color: theme.userBubbleText, borderRadius: 14 }}
            >
              {event.message.filePaths?.length ? <div className="conversation-reference-history" aria-label="本条消息的参考附件">
                {event.message.filePaths.map((path, i) => <ConversationAttachment key={`${path}:${i}`} path={path} />)}
              </div> : null}
              {stripHarnessPrefix(event.message.content).replace(stripPrefixRe, '').trim()}
            </div>
          </div>
        ) : embedded ? (
          <WorkspaceAssistantMessage key={event.message.id || index} message={event.message} tone={variant} />
        ) : (
          <article key={event.message.id || index} className="conversation-reply">
            <div className="conversation-author">鲲鹏</div>
            {typeof event.message.metadata?.runId === 'string' && <RunStepTimeline runId={event.message.metadata.runId} compact embedded tone={variant} />}
            <div className={`conversation-prose ${theme.mdClass}`}>
              <MemoMarkdown content={event.message.content} tone={variant} />
            </div>
            {event.message.thinkingContent && <details className="conversation-thinking"><summary>思考过程</summary><pre>{event.message.thinkingContent}</pre></details>}
          </article>
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
  embedded = false,
}: {
  open: boolean;
  variant: 'light' | 'dark';
  theme: DrawerTheme;
  onVisualUpdate: () => void;
  embedded?: boolean;
}) {
  const snapshot = useThrottledStreamingSnapshot(open);
  const [thinkingOpen, setThinkingOpen] = useState(false);
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

  return <article className={`conversation-reply workspace-assistant-message workspace-assistant-stream ${embedded ? '' : theme.mdClass}`} data-tone={variant}>
    <div className="conversation-author">鲲鹏<span className="conversation-live-status" role="status"><Loader2 size={11} className="animate-spin" />{phaseLabel || '正在回复'}</span></div>
    <RunStepTimeline compact embedded showHeader={false} tone={variant} />
    {snapshot.thinking && <details className="conversation-thinking" onToggle={(event) => setThinkingOpen(event.currentTarget.open)}>
      <summary>思考过程</summary>{thinkingOpen && <pre>{visibleThinkingContent}</pre>}
    </details>}
    {snapshot.content && <div className="conversation-prose workspace-assistant-prose">
      {stable && <MemoMarkdown content={stable} tone={variant} />}
      <span className="whitespace-pre-wrap">{tail}</span>
      <span className="workspace-assistant-cursor" aria-hidden="true" />
    </div>}
  </article>;
});

export interface AgentDrawerProps {
  /** ProjectWorkspace owns placement and visibility; keep the conversation DOM mounted. */
  embedded?: boolean;
  workspaceComposer?: { key: string; text: string; files: string[]; onChange: (text: string, files: string[]) => void };
  workspaceMessageIds?: Set<string>;
  workspaceStreamingVisible?: boolean;
  onWorkspaceReference?: (reference: ProjectConversationReference) => void;
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
  queueItems?: { id: string; label: string; prompt: string; targetLabel?: string; status: 'queued' | 'running' | 'failed' | 'uncertain'; error?: string }[];
  /** 队列编辑仅作用于尚未执行的消息；运行中任务仍由 onAbort 负责。 */
  onDeleteQueueItem?: (id: string) => void;
  onEditQueueItem?: (id: string, prompt: string) => void;
  onRetryQueueItem?: (id: string) => void;
  onSendQueueItemNow?: (id: string) => void;
  /** 当前交给 Agent 的工作对象，例如画布节点。 */
  contextBanner?: React.ReactNode;
  /** 工作对象稳定键；切换对象时驱动轻量转入动画。 */
  contextBannerKey?: string;
}

export default function AgentDrawer({
  open, onOpenChange, title = '鲲鹏', stripPrefixRe, greeting, suggestions,
  onSend, onAbort, badgeCount, onPickFiles, mention, placeholder,
  variant = 'dark', extraActions, draft, onDraftConsumed, launcherBottom = 16,
  modelScope, queueItems, onDeleteQueueItem, onEditQueueItem, onRetryQueueItem,
  onSendQueueItemNow, contextBanner, contextBannerKey, embedded = false,
  workspaceComposer, workspaceMessageIds, workspaceStreamingVisible,
  onWorkspaceReference,
}: AgentDrawerProps) {
  const t = variant === 'light' ? THEME_LIGHT : THEME_DARK;
  const projectId = useWorkshopStore((state) => state.data?.projectId);
  const persistedDrawerState = useWorkshopStore((state) => state.data?.projectViewState?.agentDrawerState);
  const updateProjectViewState = useWorkshopStore((state) => state.updateProjectViewState);
  const effectiveDrawerState: NonNullable<ProjectViewState['agentDrawerState']> = projectId
    ? (persistedDrawerState ?? (open ? 'expanded' : 'collapsed'))
    : (open ? 'expanded' : 'collapsed');
  const drawerOpen = embedded || effectiveDrawerState === 'expanded';
  const [editingQueueId, setEditingQueueId] = useState<string | null>(null);
  const [editingQueuePrompt, setEditingQueuePrompt] = useState('');
  const [localInput, setLocalInput] = useState('');
  const fileDraftKey = useChatStore(state => state.currentSessionId ?? `new:${state.currentAgent?.id ?? 'main'}`);
  const localFiles = useChatStore(state => state.draftFiles?.[fileDraftKey]) ?? EMPTY_FILES;
  const setLocalFiles = (value: string[] | ((previous: string[]) => string[])) => useChatStore.getState().setDraftFiles(fileDraftKey, value);
  const composer = embedded ? workspaceComposer : undefined;
  const composerRef = useRef(composer); composerRef.current = composer;
  const input = composer?.text ?? localInput;
  const files = composer?.files ?? localFiles;
  const setInput = (value: string) => {
    if (!composer) { setLocalInput(value); return; }
    const next = { ...composer, ...composerRef.current, text: value };
    composerRef.current = next; composer.onChange(next.text, next.files);
  };
  const setFiles = (value: string[] | ((previous: string[]) => string[])) => {
    if (!composer) { setLocalFiles(value); return; }
    const current = composerRef.current ?? composer;
    const next = { ...current, files: typeof value === 'function' ? value(current.files) : value };
    composerRef.current = next; composer.onChange(next.text, next.files);
  };
  const [artifactPickerOpen, setArtifactPickerOpen] = useState(false);
  const [visibleHistoryCount, setVisibleHistoryCount] = useState(60);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const stickToBottomRef = useRef(true);

  const setDrawerState = useCallback((next: NonNullable<ProjectViewState['agentDrawerState']>) => {
    if (projectId) updateProjectViewState({ agentDrawerState: next });
    onOpenChange(next === 'expanded');
  }, [onOpenChange, projectId, updateProjectViewState]);

  // Existing wrappers still open the drawer with their local boolean. Mirror an
  // explicit open request into the project preference without changing callers.
  const previousOpenRef = useRef(open);
  useEffect(() => {
    const wasOpen = previousOpenRef.current;
    previousOpenRef.current = open;
    if (!embedded && projectId && open && !wasOpen && persistedDrawerState !== 'expanded') {
      updateProjectViewState({ agentDrawerState: 'expanded' });
    }
  }, [embedded, open, persistedDrawerState, projectId, updateProjectViewState]);

  useEffect(() => {
    if (!draft) return;
    setInput(draft);
    onDraftConsumed?.();
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }, [draft, onDraftConsumed]);

  const messages = useChatStore((s) => s.messages);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
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
    if (!drawerOpen || (!force && !stickToBottomRef.current) || scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const list = listRef.current;
      if (list) list.scrollTop = list.scrollHeight;
    });
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen) return;
    stickToBottomRef.current = true;
    const timer = setTimeout(() => scheduleScrollToBottom(true), 300);
    return () => clearTimeout(timer);
  }, [drawerOpen, currentSessionId, contextBannerKey, scheduleScrollToBottom]);

  useEffect(() => {
    scheduleScrollToBottom();
  }, [messages, pendingDecision?.id, decisionHistory.length, scheduleScrollToBottom]);

  useEffect(() => {
    const list = listRef.current;
    if (!drawerOpen || !list) return;
    const observer = new ResizeObserver(() => scheduleScrollToBottom());
    for (const child of Array.from(list.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [drawerOpen, messages, scheduleScrollToBottom]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  // 动画结束后再聚焦（提前聚焦的 scroll-to-focus 会拽飞行中的面板）
  useEffect(() => {
    if (!drawerOpen) return;
    const t = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 320);
    return () => clearTimeout(t);
  }, [drawerOpen]);

  const handleSend = () => {
    if (!input.trim()) return;
    onSend(input.trim(), files.length > 0 ? [...files] : undefined);
    setInput('');
    setFiles([]);
    if (inputRef.current) inputRef.current.style.height = 'auto';
  };

  const handleAttach = async () => {
    const originKey = composerRef.current?.key;
    if (onPickFiles) {
      const picked = await onPickFiles();
      if (embedded && composerRef.current?.key !== originKey) return;
      if (picked && picked.length > 0) setFiles((prev) => [...prev, ...picked]);
      return;
    }
    const picked = await tauriOpen({
      multiple: true,
      filters: [{ name: '支持的文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'mov', 'webm', 'mp3', 'wav', 'md', 'txt', 'pdf', 'doc', 'docx', 'csv', 'json', 'srt'] }],
    });
    if (embedded && composerRef.current?.key !== originKey) return;
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
      const originKey = composerRef.current?.key;
      void readClipboardText().then((text) => {
        if (text && (!embedded || composerRef.current?.key === originKey)) replaceTextareaSelection(el, text);
      });
      return;
    }
    if (k === 'z') {
      e.stopPropagation();
    }
  };

  const phaseLabel = streamingPhaseLabel(streamingPhase);
  const chat = useMemo(
    () => messages.filter((message) => (message.role === 'user' || message.role === 'assistant')
      && (!embedded || !workspaceMessageIds || workspaceMessageIds.has(message.id))),
    [messages, embedded, workspaceMessageIds],
  );
  const historyWindow = useMemo(
    () => tailWindow(chat, visibleHistoryCount),
    [chat, visibleHistoryCount],
  );
  const firstVisibleHistoryIndex = historyWindow.startIndex;
  const visibleChat = historyWindow.items;
  const visibleHistoryStart = visibleChat[0]?.timestamp ?? 0;
  const relevantDecisionHistory = useMemo(() => decisionHistory.filter((record) =>
    record.sourceSessionId === currentSessionId
      && record.createdAt >= visibleHistoryStart
  ), [currentSessionId, decisionHistory, visibleHistoryStart]);
  const relevantPendingDecision = pendingDecision != null && pendingDecision.sourceSessionId === currentSessionId
    ? pendingDecision
    : null;
  const drawerEvents = useMemo<DrawerEvent[]>(() => [
    ...visibleChat.map((message) => ({ kind: 'message' as const, at: message.timestamp, message })),
    ...relevantDecisionHistory.map((decision) => ({ kind: 'decision' as const, at: decision.createdAt, decision })),
  ].sort((left, right) => left.at - right.at), [relevantDecisionHistory, visibleChat]);
  const revealedDecision = useRef<string | null>(null);
  useEffect(() => {
    if (!relevantPendingDecision || revealedDecision.current === relevantPendingDecision.id) return;
    if (!drawerOpen) { setDrawerState('expanded'); return; }
    revealedDecision.current = relevantPendingDecision.id;
    scheduleScrollToBottom(true);
  }, [relevantPendingDecision?.id, drawerOpen, setDrawerState, scheduleScrollToBottom]);

  const combinedBadgeCount = (badgeCount ?? 0) + (relevantPendingDecision ? 1 : 0);
  const decisionVariant = variant === 'light' ? 'drawer-light' : 'drawer-dark';

  useEffect(() => {
    setVisibleHistoryCount(60);
  }, [currentSessionId]);

  return (
    <>
      {/* 收起态：右缘轻量入口 */}
      <AnimatePresence>
        {!embedded && effectiveDrawerState === 'collapsed' && variant === 'dark' && (
          <div className="absolute right-3 z-40" style={{ bottom: launcherBottom }}>
            <motion.button
              initial={{ x: 16, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 16, opacity: 0 }}
              transition={{ type: 'tween', duration: 0.2, ease: EASE }}
              onClick={() => setDrawerState('expanded')}
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
      {!embedded && effectiveDrawerState === 'collapsed' && variant === 'light' && (
        <button
          onClick={() => setDrawerState('expanded')}
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
        {drawerOpen && (
          <motion.div
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes(PROJECT_REFERENCE_MIME)) {
                event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
              }
            }}
            onDrop={(event) => {
              if (!event.dataTransfer.types.includes(PROJECT_REFERENCE_MIME)) return;
              event.preventDefault(); event.stopPropagation();
              const data = useWorkshopStore.getState().data;
              if (!data) return;
              const reference = resolveReferenceTransfer(event.dataTransfer.getData(PROJECT_REFERENCE_MIME), data.projectId, projectTransferReferences(data));
              if (reference) {
                if (embedded && onWorkspaceReference) onWorkspaceReference(reference);
                else updateProjectViewState({ conversationReferences: mergeProjectConversationReferences(data.projectViewState?.conversationReferences, [reference]) });
              }
            }}
            initial={embedded ? false : { x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: embedded ? 0 : '100%' }}
            transition={{ type: 'tween', duration: 0.28, ease: EASE }}
            className={embedded ? 'conversation-shell workspace-embedded-agent relative flex flex-col flex-1 min-h-0 min-w-0 w-full overflow-hidden' : 'conversation-shell conversation-drawer absolute top-0 bottom-0 right-0 w-[400px] max-w-full flex flex-col z-40'}
            data-tone={variant}
            style={{
              background: t.panelBg,


              borderLeft: embedded ? undefined : `1px solid ${t.panelBorder}`,
              boxShadow: embedded ? undefined : t.panelShadow,
              willChange: embedded ? undefined : 'transform',
            }}
          >
            {/* 头部 */}
            {!embedded && <div className="conversation-header flex items-center justify-between px-4 shrink-0" style={{ height: 52, borderBottom: `1px solid ${t.headerBorder}` }}>
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
                <button onClick={() => setDrawerState('hidden')} className="p-1.5 rounded-md transition-colors" style={{ color: t.text2 }}
                  onMouseEnter={e => { e.currentTarget.style.color = t.text1; e.currentTarget.style.background = t.controlHoverBg; }}
                  onMouseLeave={e => { e.currentTarget.style.color = t.text2; e.currentTarget.style.background = 'transparent'; }}
                  title="隐藏助手"
                >
                  <EyeOff size={14} />
                </button>
                <button onClick={() => setDrawerState('collapsed')} className="p-1.5 rounded-md transition-colors" style={{ color: t.text2 }}
                  onMouseEnter={e => { e.currentTarget.style.color = t.text1; e.currentTarget.style.background = t.controlHoverBg; }}
                  onMouseLeave={e => { e.currentTarget.style.color = t.text2; e.currentTarget.style.background = 'transparent'; }}
                  title="收起助手"
                >
                  <X size={14} />
                </button>
              </div>
            </div>}

            {embedded ? (contextBanner && <div className="shrink-0 px-3 py-2" style={{ borderBottom: `1px solid ${t.headerBorder}` }}>{contextBanner}</div>) : <AnimatePresence initial={false} mode="wait">
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
            </AnimatePresence>}

            {!embedded && <ProjectChangeReview variant={variant} />}

            {/* 派单队列：失败项保留，用户可修改后重试；“优先处理”只调整顺序，不打断当前任务。 */}
            {queueItems && queueItems.length > 0 && (
              <div className={`px-4 py-2 shrink-0 space-y-1.5 ${embedded ? 'workspace-assistant-queue' : ''}`} style={{ borderBottom: `1px solid ${t.headerBorder}` }}>
                {queueItems.map((item) => (
                  <div key={item.id} className="rounded-md px-2 py-1.5" style={{ background: item.status === 'failed' ? 'rgba(239,68,68,0.08)' : t.controlHoverBg }}>
                    {editingQueueId === item.id ? (
                      <div className="space-y-1.5">
                        <textarea
                          value={editingQueuePrompt}
                          onChange={(event) => setEditingQueuePrompt(event.target.value)}
                          rows={3}
                          autoFocus
                          className="w-full resize-none rounded-md border px-2 py-1.5 text-[11px] leading-4 outline-none"
                          style={{ background: t.inputCardBg, borderColor: t.headerBorder, color: t.text1 }}
                        />
                        <div className="flex justify-end gap-1.5">
                          <button onClick={() => setEditingQueueId(null)} className="rounded px-2 py-1 text-[10px]" style={{ color: t.text2 }}>取消</button>
                          <button
                            onClick={() => {
                              onEditQueueItem?.(item.id, editingQueuePrompt);
                              setEditingQueueId(null);
                            }}
                            disabled={!editingQueuePrompt.trim()}
                            className="rounded px-2 py-1 text-[10px] disabled:opacity-40"
                            style={{ background: t.sendBg, color: t.sendText }}
                          >
                            保存并排队
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-1.5 text-[11px] leading-4 min-w-0">
                          {item.status === 'running' ? (
                            <Loader2 size={10} className="animate-spin shrink-0" style={{ color: t.text2 }} />
                          ) : (
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: item.status === 'failed' ? '#ef4444' : t.text3 }} />
                          )}
                          <span className="truncate" style={{ color: item.status === 'failed' ? '#ef4444' : item.status === 'running' ? t.text1 : t.text2 }}>
                            {item.label}
                          </span>
                          <span className="shrink-0 text-[10px]" style={{ color: item.status === 'failed' ? '#ef4444' : t.text3 }}>
                            {item.status === 'running' ? '执行中' : item.status === 'uncertain' ? '待核实' : item.status === 'failed' ? '未发送' : '排队中'}
                          </span>
                          {item.status !== 'running' && (
                            <div className="ml-auto flex items-center gap-0.5 shrink-0">
                              {item.status === 'failed' && onRetryQueueItem && (
                                <button onClick={() => onRetryQueueItem(item.id)} className="p-1 rounded" style={{ color: t.text2 }} title="重试"><RotateCcw size={11} /></button>
                              )}
                              {item.status !== 'uncertain' && onSendQueueItemNow && (
                                <button onClick={() => onSendQueueItemNow(item.id)} className="p-1 rounded" style={{ color: t.text2 }} title="排到下一项，不打断当前任务"><ListStart size={11} /></button>
                              )}
                              {item.status !== 'uncertain' && onEditQueueItem && (
                                <button
                                  onClick={() => { setEditingQueueId(item.id); setEditingQueuePrompt(item.prompt); }}
                                  className="p-1 rounded"
                                  style={{ color: t.text2 }}
                                  title="编辑消息"
                                ><Pencil size={11} /></button>
                              )}
                              {onDeleteQueueItem && (
                                <button onClick={() => onDeleteQueueItem(item.id)} className="p-1 rounded" style={{ color: t.text2 }} title="删除消息"><Trash2 size={11} /></button>
                              )}
                            </div>
                          )}
                        </div>
                        {embedded && item.targetLabel && <p className="mt-1 text-[10px]" style={{ color: t.text3 }}>{item.targetLabel}</p>}
                        {(item.status === 'failed' || item.status === 'uncertain') && item.error && (
                          <p className="mt-1 pl-3 text-[10px] leading-4 line-clamp-2" style={{ color: t.text3 }} title={item.error}>{item.error}</p>
                        )}
                      </>
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
              className={embedded ? 'conversation-feed workspace-assistant-conversation flex-1 overflow-y-auto min-h-0' : 'conversation-feed flex-1 overflow-y-auto min-h-0'}
            >
              {drawerEvents.length === 0 && !isStreaming && !relevantPendingDecision ? (
                embedded ? (
                  <div className="workspace-assistant-empty">
                    <p>还没有对话</p>
                  </div>
                ) : (
                  <div className="conversation-empty">
                    <span className="conversation-author">{title}</span>
                    <h2>{greeting.title}</h2>
                    <p>从一个想法开始，也可以添加参考素材。</p>
                    <div className="conversation-suggestions">{suggestions.map((suggestion) => <button key={suggestion}
                      onClick={() => { setInput(suggestion); inputRef.current?.focus({ preventScroll: true }); }}>{suggestion}<span aria-hidden="true">↗</span></button>)}</div>
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
                    embedded={embedded}
                  />
                  {(!embedded || workspaceStreamingVisible !== false) && <DrawerStreamingContent
                    open={drawerOpen}
                    variant={variant}
                    theme={t}
                    onVisualUpdate={scheduleScrollToBottom}
                    embedded={embedded}
                  />}
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
            <div className={embedded ? 'conversation-composer workspace-assistant-composer shrink-0' : 'conversation-composer shrink-0'}>
              <div
                className={embedded ? 'conversation-input workspace-assistant-input relative' : 'conversation-input relative'}
                style={{ background: t.inputCardBg, border: `1px solid ${t.inputCardBorder}`, boxShadow: t.inputCardShadow }}
              >
                {files.length > 0 && (
                  <div className="conversation-attachments">
                    {files.map((file, index) => <ConversationAttachment key={`${file}:${index}`} path={file}
                      onRemove={() => setFiles((previous) => previous.filter((_, i) => i !== index))} />)}
                  </div>
                )}
                <textarea
                  ref={inputRef}
                  data-kunpeng-ai-input="true"
                  aria-label="对话消息"
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 130)}px`;
                    mention?.handleInputChange(e.target.value, e.target.selectionStart || 0);
                  }}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
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
                <div className={embedded ? 'conversation-input-tools workspace-assistant-input-tools' : 'conversation-input-tools'}>
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
                  {!embedded && <button
                    onClick={() => setArtifactPickerOpen(true)}
                    className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center transition-colors"
                    style={{ color: t.text2 }}
                    onMouseEnter={e => { e.currentTarget.style.color = t.text1; e.currentTarget.style.background = t.controlHoverBg; }}
                    onMouseLeave={e => { e.currentTarget.style.color = t.text2; e.currentTarget.style.background = 'transparent'; }}
                    title="从产物库选取"
                  >
                    <ImageIcon size={14} />
                  </button>}
                  <ConfirmModeSelect variant={variant} compact />
                  {modelScope && (
                    <div className="min-w-0 w-[88px] max-w-[104px] shrink sm:w-[112px] sm:max-w-[112px]">
                      <WorkspaceAgentModelPicker
                        scope={modelScope}
                        variant={variant}
                        disabled={isStreaming}
                      />
                    </div>
                  )}
                  {extraActions && <div className="conversation-extra-actions">{extraActions}</div>}
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
                      title="发送（⌘ / Ctrl + Enter）"
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

/** 确认模式下拉已抽为共享组件：src/components/chat/ConfirmModeSelect.tsx（普通对话/画布/剪辑/文案/工坊共用） */
