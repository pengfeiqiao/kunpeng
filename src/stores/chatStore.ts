import { create } from 'zustand';

export type ActiveView = 'chat' | 'editor' | 'canvas' | 'wechat' | 'lark' | 'projects' | 'library' | 'workshop' | 'copywriting';
import { Message, Session, Agent } from '@/types';

const ATTACHMENT_DRAFT_KEY = 'kunpeng-attachment-drafts-v1';

// Save only path metadata, never file bytes or streaming state. No idle expiry.
function readAttachmentDrafts(): Record<string, string[]> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const parsed: unknown = JSON.parse(localStorage.getItem(ATTACHMENT_DRAFT_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([key, value]) => {
      if (!Array.isArray(value)) return [];
      const paths = [...new Set(value.filter((path): path is string => typeof path === 'string' && path.trim().length > 0))];
      return paths.length ? [[key, paths]] : [];
    }));
  } catch { return {}; }
}

interface ChatState {
  draftFiles: Record<string, string[]>;
  appendCurrentDraftFiles: (paths: string[]) => void;
  setDraftFiles: (key: string, value: string[] | ((previous: string[]) => string[])) => void;
  // Sessions
  sessions: Session[];
  currentSessionId: string | null;
  setSessions: (sessions: Session[]) => void;
  setCurrentSession: (sessionId: string | null) => void;
  addSession: (session: Session) => void;
  removeSession: (sessionId: string) => void;
  updateSession: (sessionId: string, updates: Partial<Session>) => void;

  // Messages
  messages: Message[];
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  updateMessage: (messageId: string, content: string) => void;
  clearMessages: () => void;

  // Agents
  agents: Agent[];
  currentAgent: Agent | null;
  setAgents: (agents: Agent[]) => void;
  setCurrentAgent: (agent: Agent | null) => void;

  // Streaming
  isStreaming: boolean;
  streamingSessions: Record<string, boolean>;
  streamingContent: string;
  streamingSessionId: string | null;
  setIsStreaming: (streaming: boolean) => void;
  setSessionStreaming: (sessionId: string, streaming: boolean) => void;
  setStreamingContent: (content: string) => void;
  clearStreamingContent: () => void;
  setStreamingSessionId: (id: string | null) => void;

  // Working phase
  streamingPhase: 'idle' | 'waiting' | 'thinking' | 'streaming' | 'processing';
  streamingSentAt: number | null;
  streamingLastTextAt: number | null;
  streamingToolName: string | null;
  streamingThinkingContent: string;
  streamingSubAgentText: string;
  /** Atomic: reset content + set phase to 'waiting' in one set() */
  startStreaming: (sessionId: string | null) => void;
  setStreamingPhase: (phase: ChatState['streamingPhase']) => void;
  setStreamingSentAt: (ts: number | null) => void;
  setStreamingLastTextAt: (ts: number | null) => void;
  setStreamingToolName: (name: string | null) => void;
  setStreamingThinkingContent: (content: string) => void;
  setStreamingSubAgentText: (text: string) => void;

  // Context window occupancy — written by the agent loop (useAgent), read by
  // the usage pill in chat/drawer headers. Null when no agent has run yet.
  contextStats: { estimatedTokens: number; maxTokens: number } | null;
  setContextStats: (stats: ChatState['contextStats']) => void;

  // UI State
  isLoading: boolean;
  error: string | null;
  setIsLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  // Unread
  unreadSessionIds: Set<string>;
  markSessionUnread: (sessionId: string) => void;
  clearSessionUnread: (sessionId: string) => void;

  // Active view
  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;

  // Pending input — used by other panels (e.g. MemoryPanel) to seed the
  // composer with a pre-built prompt. MessageInput watches and consumes it.
  pendingInput: string | null;
  setPendingInput: (text: string | null) => void;

  // Draft message — survives view switches (MessageInput reads/writes this)
  draftMessage: string;
  setDraftMessage: (text: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  draftFiles: readAttachmentDrafts(),
  appendCurrentDraftFiles: paths => {
    const state = get();
    const key = state.currentSessionId ?? `new:${state.currentAgent?.id ?? 'main'}`;
    state.setDraftFiles(key, previous => [...new Set([...previous, ...paths])]);
  },
  setDraftFiles: (key, value) => set(state => {
    const next = typeof value === 'function' ? value(state.draftFiles[key] ?? []) : value;
    const draftFiles = { ...state.draftFiles };
    if (next.length) draftFiles[key] = [...next]; else delete draftFiles[key];
    return { draftFiles };
  }),
  // Sessions
  sessions: [],
  currentSessionId: null,
  setSessions: (sessions) => set((state) => {
    // Keep the current conversation reachable even before its first message or
    // when recovering an older session whose index entry was lost.
    if (state.currentSessionId) {
      const hasCurrent = sessions.some((s) => s.id === state.currentSessionId);
      if (!hasCurrent) {
        const existing = state.sessions.find((s) => s.id === state.currentSessionId);
        const now = Date.now();
        sessions = [existing ?? {
          id: state.currentSessionId, title: '新对话', agentId: state.currentSessionId.split(':')[1] || 'main',
          createdAt: now, updatedAt: now, messageCount: state.messages.length,
        }, ...sessions];
      }
    }
    return { sessions };
  }),
  setCurrentSession: (sessionId) => set({ currentSessionId: sessionId }),
  addSession: (session) => set((state) => ({
    sessions: [session, ...state.sessions.filter(item => item.id !== session.id)],
    currentSessionId: session.id,
  })),
  removeSession: (sessionId) => set((state) => {
    const draftFiles = { ...state.draftFiles };
    delete draftFiles[sessionId];
    return {
      sessions: state.sessions.filter((s) => s.id !== sessionId),
      currentSessionId: state.currentSessionId === sessionId ? null : state.currentSessionId,
      draftFiles,
    };
  }),
  updateSession: (sessionId, updates) => set((state) => ({
    sessions: state.sessions.map((s) =>
      s.id === sessionId ? { ...s, ...updates } : s
    ),
  })),

  // Messages
  messages: [],
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({
    messages: [...state.messages, message],
  })),
  updateMessage: (messageId, content) => set((state) => ({
    messages: state.messages.map((m) =>
      m.id === messageId ? { ...m, content } : m
    ),
  })),
  clearMessages: () => set({ messages: [] }),

  // Agents
  agents: [],
  currentAgent: null,
  setAgents: (agents) => set({ agents }),
  setCurrentAgent: (agent) => set({ currentAgent: agent }),

  // Streaming
  isStreaming: false,
  streamingSessions: {},
  streamingContent: '',
  streamingSessionId: null,
  setIsStreaming: (isStreaming) => set({ isStreaming }),
  setSessionStreaming: (sessionId, streaming) =>
    set((state) => {
      const next = { ...state.streamingSessions };
      if (streaming) {
        next[sessionId] = true;
      } else {
        delete next[sessionId];
      }
      return { streamingSessions: next, isStreaming: Object.keys(next).length > 0 };
    }),
  setStreamingContent: (content) => set({ streamingContent: content }),
  clearStreamingContent: () => set({
    streamingContent: '',
    streamingThinkingContent: '',
    streamingSubAgentText: '',
    streamingPhase: 'idle',
    streamingSentAt: null,
    streamingLastTextAt: null,
    streamingToolName: null,
  }),
  setStreamingSessionId: (streamingSessionId) => set({ streamingSessionId }),

  // Working phase
  streamingPhase: 'idle',
  streamingSentAt: null,
  streamingLastTextAt: null,
  streamingToolName: null,
  streamingThinkingContent: '',
  streamingSubAgentText: '',
  startStreaming: (sessionId) => set((state) => {
    const next: Partial<ChatState> = {
      isStreaming: true,
      streamingSessionId: sessionId,
      streamingContent: '',
      streamingThinkingContent: '',
      streamingSubAgentText: '',
      streamingPhase: 'waiting',
      streamingSentAt: Date.now(),
      streamingLastTextAt: null,
      streamingToolName: null,
    };
    if (sessionId) {
      next.streamingSessions = { ...state.streamingSessions, [sessionId]: true };
    }
    return next;
  }),
  setStreamingPhase: (phase) => set({ streamingPhase: phase }),
  setStreamingSentAt: (streamingSentAt) => set({ streamingSentAt }),
  setStreamingLastTextAt: (streamingLastTextAt) => set({ streamingLastTextAt }),
  setStreamingToolName: (streamingToolName) => set({ streamingToolName }),
  setStreamingThinkingContent: (streamingThinkingContent) => set({ streamingThinkingContent }),
  setStreamingSubAgentText: (streamingSubAgentText) => set({ streamingSubAgentText }),

  contextStats: null,
  setContextStats: (contextStats) => set({ contextStats }),

  // UI State
  isLoading: false,
  error: null,
  setIsLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  // Unread
  unreadSessionIds: new Set(),
  markSessionUnread: (sessionId) =>
    set((state) => {
      const next = new Set(state.unreadSessionIds);
      next.add(sessionId);
      return { unreadSessionIds: next };
    }),
  clearSessionUnread: (sessionId) =>
    set((state) => {
      const next = new Set(state.unreadSessionIds);
      next.delete(sessionId);
      return { unreadSessionIds: next };
    }),

  // Active view
  activeView: 'chat',
  setActiveView: (activeView) => set({ activeView }),

  // Pending input
  pendingInput: null,
  setPendingInput: (pendingInput) => set({ pendingInput }),

  draftMessage: '',
  setDraftMessage: (draftMessage) => set({ draftMessage }),
}));

// Synchronous small writes protect against suspension/reload immediately after a drop.
// Unrelated updates (including streaming tokens and focus changes) never write here.
useChatStore.subscribe((state, previous) => {
  if (state.draftFiles === previous.draftFiles || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(ATTACHMENT_DRAFT_KEY, JSON.stringify(state.draftFiles));
  } catch {
    // Keep the in-memory draft and surface a real failure instead of claiming it was saved.
    useChatStore.getState().setError('附件草稿暂时无法保存，重启前请先发送或备份附件。');
  }
});
