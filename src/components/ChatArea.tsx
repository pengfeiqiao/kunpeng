import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, Menu, PanelRight } from 'lucide-react';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
import { useChatStore, useSettingsStore } from '@/stores';
import { useSound } from '@/hooks';
import { DEFAULT_AGENT_METAS } from '@/types/agent';
import FeishuIcon from './FeishuIcon';
import OutputDrawer from './chat/OutputDrawer';
import { collectChatArtifacts, isPresentableOutputArtifact } from '@/lib/chat/artifacts';
import { SYSTEM_REPAIR_PROMPT_EVENT, type SystemRepairPromptDetail } from '@/lib/agent/systemRepair';
import { useAskUserStore } from '@/stores/askUserStore';
import ContextUsagePill from './chat/ContextUsagePill';
import ChatKeySetupCard from './chat/ChatKeySetupCard';
import { hasAnyChatProviderKey } from '@/lib/credentials';

interface ChatAreaProps {
  isConnected: boolean;
  onSendMessage: (content: string, filePaths?: string[]) => Promise<void>;
  onAbort?: () => void;
}

export default function ChatArea({ isConnected, onSendMessage, onAbort }: ChatAreaProps) {
  // Only subscribe to what ChatArea needs for layout — streaming CONTENT
  // is read directly by StreamingCard to avoid re-rendering the entire message list
  const messages = useChatStore((s) => s.messages);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const currentAgent = useChatStore((s) => s.currentAgent);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const streamingSessionId = useChatStore((s) => s.streamingSessionId);
  const error = useChatStore((s) => s.error);
  const streamingPhase = useChatStore((s) => s.streamingPhase);
  const streamingSentAt = useChatStore((s) => s.streamingSentAt);
  const activeView = useChatStore((s) => s.activeView);
  const pendingDecision = useAskUserStore((state) => state.pending);
  const decisionHistoryLength = useAskUserStore((state) => state.history.length);

  const currentSession = useChatStore((s) => s.sessions.find(ss => ss.id === s.currentSessionId));
  const { sidebarCollapsed, toggleSidebar, sessionTitles } = useSettingsStore();
  const { playNotification } = useSound();
  const listRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const followOutputRef = useRef(true);
  const autoOpenedSessionRef = useRef<string | null>(null);
  const [outputOpen, setOutputOpen] = useState(false);
  const [outputOverlay, setOutputOverlay] = useState(false);
  const [queuedRepair, setQueuedRepair] = useState<string | null>(null);

  // ChatArea 可能在切到画布/工坊后仍保留挂载。此时不要在后台继续
  // 渲染主聊天的流式卡片，让当前工作视图自己的抽屉负责展示。
  const isCurrentStreaming = activeView === 'chat'
    && isStreaming
    && currentSessionId === streamingSessionId;
  const artifacts = useMemo(() => collectChatArtifacts(messages), [messages]);
  const outputCount = artifacts.filter(isPresentableOutputArtifact).length;
  const shortSessionId = currentSessionId?.split(':').pop() || '';
  const displayTitle = currentSession
    ? sessionTitles[currentSession.id] || sessionTitles[shortSessionId] || currentSession.title
    : currentAgent?.name || '鲲鹏';
  const hasPendingDecision = pendingDecision?.sourceView === 'chat'
    && pendingDecision.sourceSessionId === currentSessionId;

  const wasStreaming = useRef(false);
  useEffect(() => {
    if (wasStreaming.current && !isStreaming) {
      const currentError = useChatStore.getState().error;
      if (!currentError) {
        playNotification();
      }
    }
    wasStreaming.current = isStreaming;
  }, [isStreaming, playNotification]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const update = () => setOutputOverlay(frame.clientWidth < 1080);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!currentSessionId || outputCount === 0 || !frameRef.current) return;
    if (autoOpenedSessionRef.current === currentSessionId) return;
    autoOpenedSessionRef.current = currentSessionId;
    if (frameRef.current.clientWidth >= 1180) setOutputOpen(true);
  }, [currentSessionId, outputCount]);

  useEffect(() => {
    if (!followOutputRef.current || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, isCurrentStreaming, pendingDecision?.id, decisionHistoryLength]);

  useEffect(() => {
    let scrollFrame: number | null = null;
    const unsubscribe = useChatStore.subscribe((state, previous) => {
      if (
        state.streamingContent === previous.streamingContent
        || state.activeView !== 'chat'
        || !followOutputRef.current
        || scrollFrame !== null
      ) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = null;
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
      });
    });
    return () => {
      unsubscribe();
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
    };
  }, []);

  const handleSend = async (content: string, filePaths?: string[]) => {
    if (!content.trim() && !filePaths?.length) return;

    if (!isConnected) {
      useChatStore.getState().setError('Agent 未就绪，请检查 API Key 设置');
      return;
    }

    try {
      followOutputRef.current = true;
      await onSendMessage(content, filePaths);
    } catch (err) {
      console.error('[ChatArea] Failed to send message:', err);
      const errorMsg = err instanceof Error ? err.message : '发送消息失败';
      useChatStore.getState().setError(errorMsg);
    }
  };

  useEffect(() => {
    const handler = (event: Event) => {
      const prompt = (event as CustomEvent<SystemRepairPromptDetail>).detail?.prompt;
      if (!prompt) return;
      if (useChatStore.getState().streamingPhase === 'idle') {
        setTimeout(() => void handleSend(prompt), 250);
      } else {
        setQueuedRepair(prompt);
      }
    };
    window.addEventListener(SYSTEM_REPAIR_PROMPT_EVENT, handler);
    return () => window.removeEventListener(SYSTEM_REPAIR_PROMPT_EVENT, handler);
    // handleSend reads current connection/store state when the event fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

  useEffect(() => {
    if (!queuedRepair || streamingPhase !== 'idle') return;
    const prompt = queuedRepair;
    setQueuedRepair(null);
    setTimeout(() => void handleSend(prompt), 250);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queuedRepair, streamingPhase]);

  return (
    <div className="relative flex h-full flex-col bg-[rgb(var(--c-bg))]">
      <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-[rgb(var(--c-border))] px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          {sidebarCollapsed && (
            <button
              onClick={toggleSidebar}
              className="flex h-8 w-8 items-center justify-center rounded-md text-[rgb(var(--c-text-muted))] transition-colors hover:bg-[rgb(var(--c-border))] hover:text-[rgb(var(--c-text))]"
              title="展开侧栏"
            >
              <Menu size={17} />
            </button>
          )}
          <div className="min-w-0">
            <h1 className="flex min-w-0 items-center gap-2 text-[14px] font-medium text-[rgb(var(--c-text))]">
              <span className="truncate">{displayTitle}</span>
              {currentSession?.channel === 'feishu' && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-normal text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  <FeishuIcon size={12} />
                  {currentSession.kind === 'group' ? '飞书群聊' : '飞书'}
                </span>
              )}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {error && (
            <div className="mr-1 flex max-w-[320px] items-center gap-1.5 truncate text-[11px] text-red-500" title={error}>
              <AlertCircle size={13} className="shrink-0" />
              <span className="truncate">{error}</span>
            </div>
          )}
          <ContextUsagePill tone="light" />
          <span
            className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-red-500'}`}
            title={isConnected ? 'Agent 已就绪' : 'Agent 未就绪'}
          />
          <button
            type="button"
            onClick={() => setOutputOpen((value) => !value)}
            className={`relative flex h-8 w-8 items-center justify-center rounded-md transition-colors ${outputOpen ? 'bg-[rgb(var(--c-border))] text-[rgb(var(--c-text))]' : 'text-[rgb(var(--c-text-muted))] hover:bg-[rgb(var(--c-border))] hover:text-[rgb(var(--c-text))]'}`}
            title={outputOpen ? '收起输出' : '显示输出'}
          >
            <PanelRight size={16} />
            {outputCount > 0 && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-zinc-500" />}
          </button>
        </div>
      </div>

      <div ref={frameRef} className="relative flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            ref={listRef}
            className="min-h-0 flex-1 overflow-y-auto"
            onScroll={(event) => {
              const element = event.currentTarget;
              followOutputRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
            }}
          >
            {messages.length === 0 && !hasPendingDecision ? (
              <WelcomeScreen agent={currentAgent} onSend={handleSend} />
            ) : (
              <MessageList
                messages={messages}
                isStreaming={isCurrentStreaming}
                streamingPhase={isCurrentStreaming ? streamingPhase : 'idle'}
                streamingSentAt={isCurrentStreaming ? streamingSentAt : null}
                onOptionClick={(opt) => handleSend(opt)}
              />
            )}
          </div>

          <div className="shrink-0 bg-gradient-to-t from-[rgb(var(--c-bg))] via-[rgb(var(--c-bg))]/94 to-transparent px-4 pb-4 pt-3">
            {currentSession?.channel === 'feishu' ? (
              <div className="flex items-center justify-center gap-2 rounded-lg border border-[rgb(var(--c-border))] bg-[rgb(var(--c-card))] px-4 py-3">
                <FeishuIcon size={14} />
                <span className="text-sm text-[rgb(var(--c-text-muted))]">只读模式，请在飞书中回复</span>
              </div>
            ) : (
              <MessageInput onSend={handleSend} onAbort={onAbort} />
            )}
          </div>
        </div>
        <AnimatePresence>
          {outputOpen && (
            <OutputDrawer
              messages={messages}
              sessionId={currentSessionId}
              overlay={outputOverlay}
              onClose={() => setOutputOpen(false)}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function WelcomeScreen({ agent, onSend }: { agent: { id?: string; name: string; description?: string } | null; onSend: (text: string) => void }) {
  const agentId = agent?.id ?? 'main';
  const storedMetas = useSettingsStore((s) => s.agentMetas);
  const glmApiKey = useSettingsStore((s) => s.glmApiKey);
  const providerApiKeys = useSettingsStore((s) => s.providerApiKeys);
  const credentials = useSettingsStore((s) => s.credentials);
  const credentialRefs = useSettingsStore((s) => s.credentialRefs);
  const meta = storedMetas[agentId] ?? DEFAULT_AGENT_METAS[agentId] ?? DEFAULT_AGENT_METAS.main;
  const displayName = agent?.name ?? meta.name;
  // 主聊天无任何 key 时显示补配卡（跳过引导的用户 3 步内补上）
  const showKeySetup = !hasAnyChatProviderKey({ glmApiKey, providerApiKeys, credentials, credentialRefs });

  return (
    <div className="h-full flex items-center justify-center px-8 py-12 overflow-y-auto">
      <motion.div
        key={agentId}
        className="text-center w-full max-w-2xl"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        {showKeySetup && <ChatKeySetupCard />}
        <div className="flex justify-center mb-5">
          <img
            src="/logo-char.png"
            alt={displayName}
            className="w-40 h-40 object-contain"
          />
        </div>
        <h2 className="mb-1">
          <span className="block text-[0.85rem] tracking-[0.45em] text-gray-400 mb-1 uppercase">我是</span>
          <span
            className="text-[3rem] tracking-[0.18em] font-normal leading-tight"
            style={{ fontFamily: "'STFangsong', 'FangSong', '仿宋', 'NSimSun', serif" }}
          >
            {displayName}
          </span>
        </h2>
        <p className="text-gray-500 mb-12 text-[0.88rem] tracking-[0.2em] mt-3">
          {meta.slogan}
        </p>
        <div className="flex flex-wrap justify-center gap-2.5">
          {meta.suggestions.map((s, i) => (
            <motion.button
              key={s}
              onClick={() => onSend(s)}
              className="px-4 py-2 rounded-full border border-dark-border text-sm hover:bg-dark-card transition-colors"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.3 }}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
            >
              {s}
            </motion.button>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
