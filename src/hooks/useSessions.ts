import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useChatStore } from '@/stores';
import { useSettingsStore } from '@/stores';
import { Agent, Message, Session } from '@/types';
import { DEFAULT_AGENT_METAS } from '@/types/agent';
import {
  readSessionsFromLocalStorage,
  readMessagesFromLocalStorage,
  readAgentMessagesFromLocalStorage,
  writeSessionToFile,
  readSessionFromFile,
  writeSessionIndex,
  readSessionIndex,
  deleteSessionFile,
  hydrateLocalStorageSession,
  hydrateLocalStorageSessions,
  compactMessagesForStorage,
} from '@/lib/historyPersistence';
import { safeLocalStorage } from '@/lib/safeStorage';
import { stripHarnessPrefix } from '@/lib/agent/harnessDisplay';

// ── Local session persistence ───────────────────────────────────────────
const SESSIONS_LS_KEY = 'kunpeng-sessions';
const MESSAGES_LS_PREFIX = 'kunpeng-messages-';
const LAST_ACTIVE_SESSION_LS_KEY = 'kunpeng-last-active-session-id';
const PLACEHOLDER_TITLES = new Set(['', '新对话', '新的对话', '未命名对话', '日常对话']);

export function isPlaceholderSessionTitle(title: string): boolean {
  const normalized = title.trim();
  return PLACEHOLDER_TITLES.has(normalized)
    || /(?:^|·)\s*对话\s*\d+\s*$/.test(normalized);
}

function firstMeaningfulUserRequest(messages: Message[]): Message | undefined {
  return messages.find((message) => {
    if (message.role !== 'user' || !message.content.trim()) return false;
    return extractLocalTitle(stripHarnessPrefix(message.content)) !== '日常对话';
  });
}

function loadSessionsFromStorage(): import('@/types').Session[] | null {
  return readSessionsFromLocalStorage();
}

function saveSessionsToStorage(sessions: import('@/types').Session[]) {
  safeLocalStorage.setItem(SESSIONS_LS_KEY, JSON.stringify(sessions));
}

function loadMessagesFromStorage(sessionId: string): Message[] | null {
  return readMessagesFromLocalStorage(sessionId);
}

function saveMessagesToStorage(sessionId: string, messages: Message[]) {
  safeLocalStorage.setItem(MESSAGES_LS_PREFIX + sessionId, JSON.stringify(compactMessagesForStorage(messages)));
}

function deleteMessagesFromStorage(sessionId: string) {
  try { localStorage.removeItem(MESSAGES_LS_PREFIX + sessionId); } catch { /* ignore */ }
}

function rememberActiveSession(sessionId: string | null): void {
  if (sessionId) safeLocalStorage.setItem(LAST_ACTIVE_SESSION_LS_KEY, sessionId);
}

/** Update the visible title and both persistence layers in one operation. */
export function setSessionTitleRaw(sessionId: string, title: string): void {
  const normalized = title.trim();
  if (!normalized) return;
  const shortId = sessionId.split(':').pop() || '';
  const settings = useSettingsStore.getState();
  settings.setSessionTitle(sessionId, normalized);
  if (shortId && shortId !== sessionId) settings.setSessionTitle(shortId, normalized);

  const store = useChatStore.getState();
  store.updateSession(sessionId, { title: normalized, updatedAt: Date.now() });
  const sessions = useChatStore.getState().sessions;
  saveSessionsToStorage(sessions);
  void writeSessionIndex(sessions);
}

/** Give a placeholder session a readable title from its first real request. */
export function ensureSessionTitleRaw(sessionId: string, firstRequest: string): string | null {
  const store = useChatStore.getState();
  const session = store.sessions.find((item) => item.id === sessionId);
  if (!session) return null;
  const settings = useSettingsStore.getState();
  const shortId = sessionId.split(':').pop() || '';
  const savedTitle = settings.sessionTitles[sessionId] || settings.sessionTitles[shortId];
  const hasSavedTitle = Boolean(savedTitle && !isPlaceholderSessionTitle(savedTitle));
  if (hasSavedTitle) return savedTitle;
  if (!isPlaceholderSessionTitle(session.title)) {
    setSessionTitleRaw(sessionId, session.title);
    return session.title;
  }

  const title = extractLocalTitle(stripHarnessPrefix(firstRequest));
  setSessionTitleRaw(sessionId, title);
  return title;
}

// ── Coordinator 恢复回调（由 useAgent 注册，避免循环依赖）─────────────────
let _coordinatorRestoreCallback: ((sessionId: string) => Promise<void>) | null = null;

export function setCoordinatorRestoreCallback(fn: (sessionId: string) => Promise<void>) {
  _coordinatorRestoreCallback = fn;
}

// ── 非 hook 版本（供 store / 非 React 上下文调用，如项目会话切换）────────────

/** 创建会话（可带 projectId 绑定 AIGC 项目）并切为当前会话。流式任务进行中拒绝创建（返回 null），与 loadSessionRaw 一致——否则 deferred restore 不会补偿，新旧会话会互相串台。 */
export async function createSessionRaw(title?: string, projectId?: string): Promise<import('@/types').Session | null> {
  const store = useChatStore.getState();
  if (store.isStreaming) {
    console.warn('[useSessions] refusing to create a session while streaming');
    return null;
  }
  const agentId = 'main';
  const sessionId = `agent:${agentId}:${uuidv4()}`;
  const now = Date.now();

  const session: import('@/types').Session = {
    id: sessionId,
    title: title || '新对话',
    agentId,
    ...(projectId ? { projectId } : {}),
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
  };

  store.addSession(session);
  store.clearMessages();
  rememberActiveSession(sessionId);
  // Reset coordinator so the new chat does NOT inherit prior context.
  await _coordinatorRestoreCallback?.(sessionId);
  // Create the durable body before exposing the session in the sidebar.
  // Otherwise a fast view switch can select an index-only session and appear
  // to lose the assistant conversation.
  await writeSessionToFile(sessionId, { messages: [], agentMessages: [] });

  const allSessions = [session, ...useChatStore.getState().sessions.filter((x) => x.id !== sessionId)];
  saveSessionsToStorage(allSessions);
  void writeSessionIndex(allSessions);
  return session;
}

/** 加载并切换会话（先恢复 coordinator 再切 UI）。流式中拒绝切换返回 false。 */
export async function loadSessionRaw(sessionId: string): Promise<boolean> {
  const store = useChatStore.getState();
  if (store.isStreaming) return false;
  if (store.currentSessionId === sessionId) {
    rememberActiveSession(sessionId);
    return true;
  }

  let messages = loadMessagesFromStorage(sessionId);
  if (messages === null) {
    const fromFile = await readSessionFromFile(sessionId);
    if (fromFile) {
      hydrateLocalStorageSession(sessionId, fromFile);
      messages = fromFile.messages;
    } else {
      console.warn('[useSessions] refusing to switch to an index-only session:', sessionId);
      return false;
    }
  }
  await _coordinatorRestoreCallback?.(sessionId);
  store.setCurrentSession(sessionId);
  rememberActiveSession(sessionId);
  store.setMessages(messages ?? []);
  const firstUserMessage = messages ? firstMeaningfulUserRequest(messages) : undefined;
  if (firstUserMessage) ensureSessionTitleRaw(sessionId, firstUserMessage.content);
  store.clearSessionUnread(sessionId);
  useSettingsStore.getState().markSessionRead(sessionId);
  return true;
}

/**
 * 将现有普通对话归入项目，但不切换会话、不清空消息，也不重置 Coordinator。
 *
 * 普通聊天进入工坊/画布/剪辑时应继续沿用同一段对话。项目归属只是会话
 * 的组织信息，不应该成为隐式新建或切换对话的理由。
 */
export function bindSessionToProjectRaw(sessionId: string, projectId: string): Session | null {
  const store = useChatStore.getState();
  const current = store.sessions.find((session) => session.id === sessionId);
  if (!current) return null;
  if (current.projectId === projectId) return current;

  const updated: Session = { ...current, projectId };
  store.updateSession(sessionId, { projectId });
  rememberActiveSession(sessionId);
  const sessions = useChatStore.getState().sessions;
  saveSessionsToStorage(sessions);
  void writeSessionIndex(sessions);
  return updated;
}

/**
 * Recover the conversation selected before a surface switch. Auxiliary
 * drawers and the main chat are two views of the same conversation, so a
 * transient missing currentSessionId must not silently create a new task.
 */
export async function ensureActiveConversationSessionRaw(): Promise<Session | null> {
  const store = useChatStore.getState();
  if (store.currentSessionId) {
    const current = store.sessions.find((session) => session.id === store.currentSessionId);
    if (current) {
      rememberActiveSession(current.id);
      return current;
    }

    const now = Date.now();
    const recovered: Session = {
      id: store.currentSessionId,
      title: '新对话',
      agentId: store.currentSessionId.split(':')[1] || 'main',
      createdAt: now,
      updatedAt: now,
      messageCount: store.messages.length,
    };
    store.addSession(recovered);
    rememberActiveSession(recovered.id);
    return recovered;
  }

  const rememberedId = safeLocalStorage.getItem(LAST_ACTIVE_SESSION_LS_KEY);
  const remembered = rememberedId
    ? store.sessions.find((session) => session.id === rememberedId)
    : undefined;
  if (remembered) {
    if (store.messages.length > 0) {
      await _coordinatorRestoreCallback?.(remembered.id);
      store.setCurrentSession(remembered.id);
      rememberActiveSession(remembered.id);
      const firstRequest = firstMeaningfulUserRequest(store.messages);
      if (firstRequest) ensureSessionTitleRaw(remembered.id, firstRequest.content);
      return remembered;
    }
    if (await loadSessionRaw(remembered.id)) return remembered;
  }

  return createSessionRaw();
}

export function useSessions() {
  const sessions = useChatStore((s) => s.sessions);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const setSessions = useChatStore((s) => s.setSessions);
  const setCurrentSession = useChatStore((s) => s.setCurrentSession);
  const setMessages = useChatStore((s) => s.setMessages);
  const clearMessages = useChatStore((s) => s.clearMessages);

  // Load sessions: file index is the source of truth, merged with any
  // localStorage entries the file is missing (forward-compat for sessions
  // written by older code paths). Stale localStorage no longer hides newer
  // sessions on disk.
  const loadSessions = useCallback(async () => {
    try {
      const fromFile = (await readSessionIndex()) ?? [];
      const fromLs = loadSessionsFromStorage() ?? [];

      const byId = new Map<string, import('@/types').Session>();
      for (const s of fromFile) byId.set(s.id, s);
      for (const s of fromLs) {
        const prev = byId.get(s.id);
        if (!prev) {
          byId.set(s.id, s);
        } else if ((s.updatedAt ?? 0) > (prev.updatedAt ?? 0)) {
          byId.set(s.id, s);
        }
      }
      const merged = Array.from(byId.values()).sort(
        (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
      );

      // Re-sync localStorage cache to match the merged source of truth so the
      // next read returns the same set; also ensures the file index keeps the
      // forward-compat additions.
      if (merged.length > 0) {
        hydrateLocalStorageSessions(merged);
        void writeSessionIndex(merged);
      }

      const { deletedSessionIds } = useSettingsStore.getState();

      const visible = merged.filter((s) => {
        const bareUuid = s.id.split(':').pop() || '';
        return !deletedSessionIds.includes(s.id) && !deletedSessionIds.includes(bareUuid);
      });

      // Heal legacy placeholder titles before the sidebar paints them. This is
      // local and bounded to one small session file per untitled task.
      const settingsForTitles = useSettingsStore.getState();
      const healed = await Promise.all(visible.map(async (session) => {
        const shortId = session.id.split(':').pop() || '';
        const saved = settingsForTitles.sessionTitles[session.id] || settingsForTitles.sessionTitles[shortId];
        const hasSavedTitle = Boolean(saved && !isPlaceholderSessionTitle(saved));
        if (hasSavedTitle) {
          return saved === session.title ? session : { ...session, title: saved };
        }
        if (!isPlaceholderSessionTitle(session.title)) {
          settingsForTitles.setSessionTitle(session.id, session.title);
          if (shortId && shortId !== session.id) settingsForTitles.setSessionTitle(shortId, session.title);
          return session;
        }
        const localMessages = loadMessagesFromStorage(session.id);
        const diskMessages = localMessages === null ? (await readSessionFromFile(session.id))?.messages : null;
        const firstUserMessage = firstMeaningfulUserRequest(localMessages ?? diskMessages ?? []);
        if (!firstUserMessage) return session;
        const title = extractLocalTitle(stripHarnessPrefix(firstUserMessage.content));
        settingsForTitles.setSessionTitle(session.id, title);
        if (shortId && shortId !== session.id) settingsForTitles.setSessionTitle(shortId, title);
        return { ...session, title };
      }));

      setSessions(healed);
      if (healed.some((session, index) => session.title !== visible[index]?.title)) {
        saveSessionsToStorage(healed);
        void writeSessionIndex(healed);
      }

      // Seed unread state
      const { sessionLastReadAt } = useSettingsStore.getState();
      const chatState = useChatStore.getState();
      for (const session of healed) {
        const lastRead = sessionLastReadAt[session.id] || 0;
        if (session.updatedAt > lastRead && session.id !== chatState.currentSessionId) {
          chatState.markSessionUnread(session.id);
        }
      }
    } catch (error) {
      console.error('[useSessions] Failed to load sessions:', error);
    }
  }, [setSessions]);

  // Create new session (delegates to the raw module function)
  const createSession = useCallback(
    async (title?: string, projectId?: string) => createSessionRaw(title, projectId),
    []
  );

  // Delete session
  const deleteSession = useCallback(
    async (sessionId: string) => {
      const bareUuid = sessionId.split(':').pop() || '';
      useSettingsStore.getState().addDeletedSessionId(sessionId);
      if (bareUuid !== sessionId) {
        useSettingsStore.getState().addDeletedSessionId(bareUuid);
      }

      // Remove from store
      useChatStore.getState().removeSession(sessionId);
      if (currentSessionId === sessionId) {
        clearMessages();
      }

      // Remove from localStorage
      deleteMessagesFromStorage(sessionId);
      // Also remove persisted AgentMessage[]
      try { localStorage.removeItem('kunpeng-agent-messages-' + sessionId); } catch { /* ignore */ }
      const remaining = useChatStore.getState().sessions;
      saveSessionsToStorage(remaining);
      void writeSessionIndex(remaining);
      void deleteSessionFile(sessionId);
    },
    [currentSessionId, clearMessages]
  );

  // Load session messages
  const loadSession = useCallback(
    async (sessionId: string) => {
      const currentState = useChatStore.getState();
      if (currentState.isStreaming && currentState.currentSessionId !== sessionId) {
        return { messages: [], loaded: false };
      }

      // Project drawers and the main chat are two views of the same live
      // conversation. Do not reload the active conversation from disk: a
      // newly-created legacy session may still only exist in memory. Persist
      // it here so it becomes durable before the user leaves the project UI.
      if (currentState.currentSessionId === sessionId) {
        rememberActiveSession(sessionId);
        const currentMessages = currentState.messages;
        const agentMessages = readAgentMessagesFromLocalStorage(sessionId) ?? [];
        await writeSessionToFile(sessionId, {
          messages: compactMessagesForStorage(currentMessages),
          agentMessages,
        });
        const firstUserMessage = firstMeaningfulUserRequest(currentMessages);
        if (firstUserMessage) ensureSessionTitleRaw(sessionId, firstUserMessage.content);
        currentState.clearSessionUnread(sessionId);
        useSettingsStore.getState().markSessionRead(sessionId);
        return { messages: currentMessages, loaded: true };
      }

      let messages = loadMessagesFromStorage(sessionId);
      let hasRecoveryData = true;
      if (messages === null) {
        const fromFile = await readSessionFromFile(sessionId);
        if (fromFile) {
          hydrateLocalStorageSession(sessionId, fromFile);
          messages = fromFile.messages;
        } else {
          hasRecoveryData = false;
        }
      }
      if (!hasRecoveryData) {
        console.warn('[useSessions] refusing to load an index-only session:', sessionId);
        return { messages: [], loaded: false };
      }
      // Restore coordinator BEFORE setting UI state
      await _coordinatorRestoreCallback?.(sessionId);

      setCurrentSession(sessionId);
      rememberActiveSession(sessionId);
      if (messages !== null) {
        setMessages(messages);
        const firstUserMessage = firstMeaningfulUserRequest(messages);
        if (firstUserMessage) ensureSessionTitleRaw(sessionId, firstUserMessage.content);
      }

      // Clear unread
      useChatStore.getState().clearSessionUnread(sessionId);
      useSettingsStore.getState().markSessionRead(sessionId);

      return { messages: messages ?? [], loaded: true };
    },
    [setCurrentSession, setMessages]
  );

  // Switch to agent
  const switchToAgent = useCallback(async (agent: Agent) => {
    if (useChatStore.getState().isStreaming) return;
    const store = useChatStore.getState();
    store.setCurrentAgent(agent);

    const { deletedSessionIds } = useSettingsStore.getState();
    const agentSessions = store.sessions
      .filter((s) => {
        const parts = s.id.split(':');
        const sAgentId = parts.length >= 3 && parts[0] === 'agent' ? parts[1] : 'main';
        const bareUuid = s.id.split(':').pop() || '';
        return (
          sAgentId === agent.id &&
          !deletedSessionIds.includes(s.id) &&
          !deletedSessionIds.includes(bareUuid)
        );
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);

    if (agentSessions.length > 0) {
      const sessionId = agentSessions[0].id;
      let messages = loadMessagesFromStorage(sessionId);
      let hasRecoveryData = true;
      if (messages === null) {
        const fromFile = await readSessionFromFile(sessionId);
        if (fromFile) {
          hydrateLocalStorageSession(sessionId, fromFile);
          messages = fromFile.messages;
        } else {
          hasRecoveryData = false;
        }
      }
      // Restore coordinator BEFORE setting UI state, so the coordinator is
      // ready before any code reads currentSessionId.
      await _coordinatorRestoreCallback?.(sessionId);

      store.setCurrentSession(sessionId);
      rememberActiveSession(sessionId);
      let resolvedMessages: Message[] = [];
      if (messages !== null) {
        store.setMessages(messages);
        resolvedMessages = messages;
      } else if (!hasRecoveryData) {
        console.warn('[useSessions] skip setMessages on switchToAgent: storage parse failed and no file recovery');
        return;
      }

      // Auto-title if needed
      const settingsState = useSettingsStore.getState();
      const shortId = sessionId.split(':').pop() || '';
      const savedTitle = settingsState.sessionTitles[sessionId] || settingsState.sessionTitles[shortId] || '';
      const hasTitle = Boolean(savedTitle && !isPlaceholderSessionTitle(savedTitle));
      if (!hasTitle && resolvedMessages.length > 0) {
        const firstUserMsg = firstMeaningfulUserRequest(resolvedMessages);
        if (firstUserMsg?.content) {
          ensureSessionTitleRaw(sessionId, firstUserMsg.content);
        }
      }
    } else {
      store.setCurrentSession(null);
      store.clearMessages();
      safeLocalStorage.setItem(LAST_ACTIVE_SESSION_LS_KEY, '');
    }
  }, []);

  // Load agents from local config
  const loadAgents = useCallback(async () => {
    const storedMetas = useSettingsStore.getState().agentMetas;

    // Only use agents defined in DEFAULT_AGENT_METAS (canonical list).
    // storedMetas can override display properties but cannot add new agents.
    const agents: Agent[] = Object.keys(DEFAULT_AGENT_METAS).map((id) => {
      const meta = storedMetas[id] ?? DEFAULT_AGENT_METAS[id];
      return {
        id,
        name: meta.name,
        description: meta.description || '',
        icon: meta.icon,
      };
    });

    useChatStore.getState().setAgents(agents);
    if (agents.length > 0) {
      useChatStore.getState().setCurrentAgent(agents[0]);
    }
  }, []);

  // Persist messages when they change (called externally after addMessage)
  const persistMessages = useCallback((targetSessionId?: string, targetMessages?: Message[]) => {
    const state = useChatStore.getState();
    const sid = targetSessionId ?? state.currentSessionId;
    const msgs = compactMessagesForStorage(targetMessages ?? state.messages);
    if (sid && msgs.length > 0) {
      saveMessagesToStorage(sid, msgs);
      rememberActiveSession(sid);
      const firstRequest = firstMeaningfulUserRequest(msgs);
      if (firstRequest) ensureSessionTitleRaw(sid, firstRequest.content);
      // Update session in storage
      const latestState = useChatStore.getState();
      const allSessions = latestState.sessions.map(s =>
        s.id === sid
          ? { ...s, updatedAt: Date.now(), messageCount: msgs.length }
          : s
      );
      latestState.setSessions(allSessions);
      saveSessionsToStorage(allSessions);
      void writeSessionIndex(allSessions);
      // Bundle agentMessages from cache so the on-disk session file stays
      // self-contained for cross-origin restore (dev <-> prod webview).
      const agentMessages = readAgentMessagesFromLocalStorage(sid) ?? [];
      void writeSessionToFile(sid, { messages: msgs, agentMessages });
    }
  }, []);

  return {
    sessions,
    currentSessionId,
    loadSessions,
    createSession,
    deleteSession,
    loadSession,
    switchToAgent,
    loadAgents,
    persistMessages,
    setCurrentSession,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * 从用户第一条消息本地提取标题（最多10字）。
 * 纯本地处理，不调用任何 API。
 */
export function extractLocalTitle(message: string): string {
  const clean = message
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]+\]\([^)]*\)/g, ' ')
    .replace(/(?:~|～)\/\S+|\/(?:Users|tmp|private\/tmp)\/\S+/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^[#/]+\S*\s*/, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean || /^(?:你好|您好|在吗|hello|hi)[！!。.]?$/i.test(clean)) return '日常对话';

  const MAX = 28;
  if (clean.length <= MAX) return clean;
  const candidate = clean.slice(0, MAX);
  for (const ch of ['。', '！', '？', '；', '，', '、', '.', '!', '?', ';', ',', ' ']) {
    const idx = candidate.lastIndexOf(ch);
    if (idx >= 8) return candidate.slice(0, idx);
  }
  return `${candidate.trim()}…`;
}
