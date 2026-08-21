import { useState, useEffect, useRef } from 'react';
import { confirm } from '@tauri-apps/api/dialog';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Trash2,
  Settings,
  ChevronLeft,
  Volume2,
  VolumeX,
  Pencil,
  Scissors,
  LayoutDashboard,
  FolderKanban,
  Image as Images,
  Clapperboard,
  PenLine,
} from 'lucide-react';
import { useChatStore, useSettingsStore } from '@/stores';
import { useWechatStore } from '@/stores/wechatStore';
import { useLarkStore } from '@/stores/larkStore';
import { useAigcProjectStore } from '@/stores/aigcProjectStore';
import { useSessions } from '@/hooks';
import { setSessionTitleRaw } from '@/hooks/useSessions';
import SettingsPanel from './Settings';
import FeishuIcon from './FeishuIcon';
import WechatIcon from './WechatIcon';

function SidebarNavItem({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`group relative flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors ${
        active
          ? 'bg-[#e8e8ea] text-zinc-950'
          : 'text-zinc-600 hover:bg-[#eeeeee] hover:text-zinc-950'
      }`}
    >
      {active && <span className="absolute left-0 top-2 bottom-2 w-px rounded-full bg-zinc-500/70" />}
      <span className={active ? 'text-zinc-800' : 'text-zinc-500 group-hover:text-zinc-700'}>{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

export default function Sidebar() {
  const { sessions, currentSessionId, loadSession, deleteSession, createSession } = useSessions();
  const [expandedProjectGroups, setExpandedProjectGroups] = useState<Set<string>>(new Set());
  const { soundEnabled, setSoundEnabled, toggleSidebar, sessionTitles } = useSettingsStore();
  const activeView = useChatStore((s) => s.activeView);
  const setActiveView = useChatStore((s) => s.setActiveView);
  const unreadSessionIds = useChatStore((s) => s.unreadSessionIds);
  const [showSettings, setShowSettings] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ sessionId: string; x: number; y: number } | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);
  const wechatConnected = useWechatStore((s) => Object.values(s.bots).some((bot) => bot.polling && !bot.reconnecting));
  const larkConnected = useLarkStore((s) => Object.values(s.bots).some((b) => b.running));
  const projectNames = useAigcProjectStore((s) =>
    Object.fromEntries(s.projects.map((project) => [project.id, project.name])),
  );

  const resolvedSessionTitle = (session: (typeof sessions)[number]) => {
    const shortId = session.id.split(':').pop() || '';
    return sessionTitles[session.id] || sessionTitles[shortId] || session.title;
  };

  const openSessionInChat = async (sessionId: string) => {
    const result = await loadSession(sessionId);
    if (result.loaded) setActiveView('chat');
  };

  const handleNewChat = async () => {
    await createSession();
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    const confirmed = await confirm('确定要删除这个对话吗？', { title: '删除对话' } as Parameters<typeof confirm>[1]);
    if (confirmed) {
      await deleteSession(sessionId);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, sessionId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ sessionId, x: e.clientX, y: e.clientY });
  };

  const handleRenameStart = (sessionId: string) => {
    const shortId = sessionId.split(':').pop() || '';
    const current =
      sessionTitles[sessionId] ||
      sessionTitles[shortId] ||
      sessions.find((s) => s.id === sessionId)?.title ||
      '';
    setEditingSessionId(sessionId);
    setEditingTitle(current);
    setContextMenu(null);
    setTimeout(() => editInputRef.current?.select(), 30);
  };

  const handleRenameConfirm = (sessionId: string) => {
    const trimmed = editingTitle.trim();
    if (trimmed) {
      setSessionTitleRaw(sessionId, trimmed);
    }
    setEditingSessionId(null);
    setEditingTitle('');
  };

  const handleRenameCancel = () => {
    setEditingSessionId(null);
    setEditingTitle('');
  };

  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [contextMenu]);

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return '今天';
    if (days === 1) return '昨天';
    if (days < 7) return `${days}天前`;
    return date.toLocaleDateString('zh-CN');
  };

  return (
    <div className="h-full w-[280px] flex flex-col border-r border-[#e4e4e7] bg-[#f4f4f5] text-zinc-900">
      {/* Header */}
      <div className="px-3 py-3 border-b border-[#e4e4e7]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="鲲鹏" className="w-6 h-6 object-contain flex-shrink-0 opacity-90" />
            <span className="font-medium text-sm text-zinc-950">鲲鹏</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveView(activeView === 'wechat' ? 'chat' : 'wechat')}
              className={`relative rounded-md p-1.5 transition-colors ${
                activeView === 'wechat' ? 'bg-[#e8e8ea] text-zinc-950' : 'text-zinc-500 hover:bg-[#eeeeee] hover:text-zinc-800'
              }`}
              title="微信助手"
            >
              <WechatIcon size={18} />
              {wechatConnected && (
                <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-zinc-600 ring-2 ring-[#f4f4f5]" />
              )}
            </button>
            <button
              onClick={() => setActiveView(activeView === 'lark' ? 'chat' : 'lark')}
              className={`relative rounded-md p-1.5 transition-colors ${
                activeView === 'lark' ? 'bg-[#e8e8ea] text-zinc-950' : 'text-zinc-500 hover:bg-[#eeeeee] hover:text-zinc-800'
              }`}
              title="飞书机器人"
            >
              <FeishuIcon size={18} />
              {larkConnected && (
                <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-sky-500 ring-2 ring-[#f4f4f5]" />
              )}
            </button>
            <button
              onClick={toggleSidebar}
              className="p-1.5 rounded-md text-zinc-500 hover:bg-[#eeeeee] hover:text-zinc-800 transition-colors"
            >
              <ChevronLeft size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* New Chat Button */}
      <div className="px-2 py-2 border-b border-[#e4e4e7]">
        <button
          onClick={handleNewChat}
          className="mb-2 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-zinc-800 transition-colors hover:bg-[#eeeeee]"
        >
          <Plus size={15} className="text-zinc-500" />
          <span>新对话</span>
        </button>

        <div className="space-y-0.5">
          <SidebarNavItem active={activeView === 'editor'} icon={<Scissors size={15} />} label="剪辑" onClick={() => setActiveView(activeView === 'editor' ? 'chat' : 'editor')} />
          <SidebarNavItem active={activeView === 'copywriting'} icon={<PenLine size={15} />} label="文案" onClick={() => setActiveView(activeView === 'copywriting' ? 'chat' : 'copywriting')} />
          <SidebarNavItem active={activeView === 'canvas'} icon={<LayoutDashboard size={15} />} label="画布" onClick={() => setActiveView(activeView === 'canvas' ? 'chat' : 'canvas')} />
          <SidebarNavItem active={activeView === 'projects'} icon={<FolderKanban size={15} />} label="项目" onClick={() => setActiveView(activeView === 'projects' ? 'chat' : 'projects')} />
          <SidebarNavItem active={activeView === 'library'} icon={<Images size={15} />} label="产物库" onClick={() => setActiveView(activeView === 'library' ? 'chat' : 'library')} />
          <SidebarNavItem active={activeView === 'workshop'} icon={<Clapperboard size={15} />} label="工坊" onClick={() => setActiveView(activeView === 'workshop' ? 'chat' : 'workshop')} />
        </div>
      </div>
      {/* Sessions List */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <div className="px-2 pb-2 text-[11px] font-medium text-zinc-500">任务</div>
        {sessions.some((x) => x.projectId) && (
          <div className="mx-1 mb-2">
            {Object.entries(
              sessions.filter((x) => x.projectId).reduce<Record<string, typeof sessions>>((acc, x) => {
                const key = x.projectId!;
                (acc[key] = acc[key] || []).push(x);
                return acc;
              }, {}),
            ).map(([pid, group]) => {
              const fallbackPrefix = group
                .map((session) => session.title.match(/^(.*?)\s*·\s*对话\s*\d+\s*$/)?.[1]?.trim())
                .find(Boolean);
              const label = projectNames[pid] || fallbackPrefix || '项目';
              const expanded = expandedProjectGroups.has(pid);
              return (
                <div key={pid} className="mb-0.5">
                  <button
                    onClick={() => setExpandedProjectGroups((prev) => {
                      const next = new Set(prev);
                      if (next.has(pid)) next.delete(pid); else next.add(pid);
                      return next;
                    })}
                    className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-zinc-600 hover:bg-[#eeeeee] hover:text-zinc-950 transition-colors"
                  >
                    <FolderKanban size={12} className="text-zinc-500 shrink-0" />
                    <span className="flex-1 text-left text-xs truncate">{label}</span>
                    <span className="text-[10px] text-zinc-500">{group.length}</span>
                  </button>
                  {expanded && group.map((session) => (
                    <div
                      key={session.id}
                      onClick={() => void openSessionInChat(session.id)}
                      onContextMenu={(e) => handleContextMenu(e, session.id)}
                      className={`group ml-4 mb-0.5 px-2.5 py-2 rounded-md cursor-pointer flex items-center gap-2 transition-colors ${
                        currentSessionId === session.id ? 'bg-[#e8e8ea] text-zinc-950' : 'text-zinc-600 hover:bg-[#eeeeee] hover:text-zinc-950'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] truncate" title={resolvedSessionTitle(session)}>
                          {resolvedSessionTitle(session).replace(`${label} · `, '')}
                        </div>
                        <div className="text-[10px] text-zinc-500">{formatDate(session.updatedAt)}</div>
                      </div>
                      {unreadSessionIds.has(session.id) && currentSessionId !== session.id && (
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-pulse flex-shrink-0" />
                      )}
                      <button
                        onClick={(e) => handleDeleteSession(e, session.id)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-[#e1e1e3] rounded transition-all"
                      >
                        <Trash2 size={12} className="text-zinc-500" />
                      </button>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        <AnimatePresence>
          {sessions.filter((x) => !x.projectId).map((session) => (
            <motion.div
              key={session.id}
              onClick={() => {
                if (editingSessionId !== session.id) void openSessionInChat(session.id);
              }}
              onContextMenu={(e) => handleContextMenu(e, session.id)}
              className={`group mx-1 mb-0.5 rounded-md cursor-pointer flex items-center gap-2 px-2.5 py-2 transition-colors ${
                currentSessionId === session.id ? 'bg-[#e8e8ea] text-zinc-950' : 'text-zinc-600 hover:bg-[#eeeeee] hover:text-zinc-950'
              }`}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              {session.channel === 'feishu' && <FeishuIcon size={15} className="flex-shrink-0" />}
              <div className="flex-1 min-w-0">
                {editingSessionId === session.id ? (
                  <input
                    ref={editInputRef}
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); handleRenameConfirm(session.id); }
                      if (e.key === 'Escape') handleRenameCancel();
                    }}
                    onBlur={() => handleRenameConfirm(session.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full bg-transparent border-b border-zinc-500 outline-none text-sm pb-0.5"
                  />
                ) : (
                  <div className="flex items-center gap-1 truncate text-[13px] leading-5" title={sessionTitles[session.id] || sessionTitles[session.id.split(':').pop() || ''] || session.title}>
                    {sessionTitles[session.id] || sessionTitles[session.id.split(':').pop() || ''] || session.title}
                    {session.kind === 'group' && (
                      <span className="text-[10px] text-zinc-500 bg-[#e8e8ea] px-1 rounded">{'\u7FA4'}</span>
                    )}
                  </div>
                )}
              </div>
              {unreadSessionIds.has(session.id) && currentSessionId !== session.id && (
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-zinc-300 animate-pulse flex-shrink-0" />
              )}
              {editingSessionId !== session.id && (
                <button
                  onClick={(e) => handleDeleteSession(e, session.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[#e1e1e3] rounded transition-all"
                >
                  <Trash2 size={13} className="text-zinc-500" />
                </button>
              )}
            </motion.div>
          ))}
          {sessions.length === 0 && (
            <div className="px-4 py-2 text-xs text-zinc-500">暂无对话</div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom Actions */}
      <div className="p-2 border-t border-[#e4e4e7] space-y-0.5">
        <button
          onClick={() => setSoundEnabled(!soundEnabled)}
          className="w-full py-2 px-2.5 hover:bg-[#eeeeee] rounded-md flex items-center gap-2 text-sm text-zinc-600 hover:text-zinc-950 transition-colors"
        >
          {soundEnabled ? (
            <Volume2 size={15} />
          ) : (
            <VolumeX size={15} />
          )}
          <span>消息提示音</span>
          <span className="ml-auto text-xs text-zinc-600">
            {soundEnabled ? '开' : '关'}
          </span>
        </button>

        <button
          onClick={() => setShowSettings(true)}
          className="w-full py-2 px-2.5 hover:bg-[#eeeeee] rounded-md flex items-center gap-2 text-sm text-zinc-600 hover:text-zinc-950 transition-colors"
        >
          <Settings size={15} />
          <span>设置</span>
        </button>
      </div>

      {/* Context Menu */}
      <AnimatePresence>
        {contextMenu && (() => {
          const menuW = 140, menuH = 80;
          const x = contextMenu.x + menuW > window.innerWidth ? contextMenu.x - menuW : contextMenu.x;
          const y = contextMenu.y + menuH > window.innerHeight ? contextMenu.y - menuH : contextMenu.y;
          return (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.08 }}
              className="fixed z-50 bg-[#fafafa] border border-[#e4e4e7] rounded-lg shadow-lg py-1 min-w-[140px]"
              style={{ left: x, top: y }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => handleRenameStart(contextMenu.sessionId)}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-zinc-600 hover:bg-[#eeeeee] hover:text-zinc-950 transition-colors"
              >
                <Pencil size={13} className="text-gray-400" />
                重命名
              </button>
              <button
                onClick={async (e) => {
                  const id = contextMenu.sessionId;
                  setContextMenu(null);
                  await handleDeleteSession(e, id);
                }}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-zinc-600 hover:bg-[#eeeeee] hover:text-zinc-950 transition-colors"
              >
                <Trash2 size={13} />
                删除
              </button>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* Modals */}
      <SettingsPanel
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />
    </div>
  );
}
