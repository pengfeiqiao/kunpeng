import { useEffect, useRef, useState } from 'react';
import { Bot, Check, ChevronLeft, FileText, Loader2, Menu, MessageSquare, Paperclip, Pencil, Plus, Send, Users, X, ListChecks } from 'lucide-react';
import { motion } from 'framer-motion';
import { open } from '@tauri-apps/api/dialog';
import { convertFileSrc, invoke } from '@tauri-apps/api/tauri';
import { useLarkStore, type LarkMessage, type LarkReplyMode } from '@/stores/larkStore';
import { useSettingsStore } from '@/stores';
import { useRunStepStore } from '@/stores/runStepStore';
import RunStepTimeline from '@/components/chat/RunStepTimeline';
import FeishuIcon from '@/components/FeishuIcon';
import ChannelStatusBar from '@/components/messaging/ChannelStatusBar';

function shortId(id: string) {
  return id.length > 14 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id;
}

const LARK_SCOPES = [
  'im:message', 'im:message:send_as_bot', 'im:message.p2p_msg:readonly',
  'im:message.group_at_msg:readonly', 'im:message:readonly', 'im:resource',
  'contact:user.employee_id:readonly',
];
const LARK_EVENTS = ['im.message.receive_v1'];

function PermissionScopes() {
  const [open, setOpen] = useState(false);
  const copyAll = () => {
    navigator.clipboard.writeText([...LARK_SCOPES, ...LARK_EVENTS].join('\n')).catch(() => {});
  };
  return (
    <div className="rounded-lg border text-xs" style={{ borderColor: 'rgb(var(--c-border))', background: 'rgb(var(--c-card))' }}>
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between px-3 py-2" style={{ color: 'rgb(var(--c-text-muted))' }}>
        <span style={{ color: 'rgb(var(--c-text))' }}>所需权限列表</span>
        <span>{open ? '收起' : '展开'}</span>
      </button>
      {open && (
        <div className="px-3 pb-2 space-y-1" style={{ color: 'rgb(var(--c-text-muted))' }}>
          <div className="font-medium" style={{ color: 'rgb(var(--c-text))' }}>API 权限</div>
          {LARK_SCOPES.map((s) => <div key={s} className="font-mono text-[10px]">{s}</div>)}
          <div className="font-medium mt-1" style={{ color: 'rgb(var(--c-text))' }}>事件订阅</div>
          {LARK_EVENTS.map((s) => <div key={s} className="font-mono text-[10px]">{s}</div>)}
          <button onClick={copyAll} className="mt-1 rounded-md border px-2 py-1 text-[10px] hover:bg-sky-50" style={{ borderColor: 'rgb(var(--c-border))', color: 'rgb(var(--c-text-muted))' }}>
            一键复制全部权限
          </button>
        </div>
      )}
    </div>
  );
}

function displayName(id: string, names: Record<string, string>) {
  return names[id] || shortId(id);
}

function ConfigPanel({ onClose }: { onClose?: () => void }) {
  const saveConfig = useLarkStore((s) => s.saveConfig);
  const updatePluginSettings = useLarkStore((s) => s.updatePluginSettings);
  const bots = useLarkStore((s) => s.bots);
  const activeBotId = useLarkStore((s) => s.activeBotId);
  const activeBot = activeBotId ? bots[activeBotId] : undefined;
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [port, setPort] = useState(3768);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!activeBot) return;
    setAppId(activeBot.id);
    setVerificationToken(activeBot.verificationToken || '');
    setPort(activeBot.port || 3768);
  }, [activeBot]);

  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      await saveConfig({
        appId: appId.trim(),
        appSecret: appSecret.trim(),
        verificationToken: verificationToken.trim(),
        port,
      });
      onClose?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-[520px] rounded-xl border p-5 shadow-sm" style={{ borderColor: 'rgb(var(--c-border))', background: 'rgb(var(--c-card))' }}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg border flex items-center justify-center" style={{ borderColor: 'rgb(var(--c-border))', background: 'rgb(var(--c-card))' }}>
              <FeishuIcon size={22} />
            </div>
            <div>
              <h2 className="text-base font-medium" style={{ color: 'rgb(var(--c-text))' }}>飞书机器人</h2>
              <p className="mt-1 text-xs" style={{ color: 'rgb(var(--c-text-muted))' }}>填写企业自建应用凭证后，鲲鹏会通过 WebSocket 长连接接收和回复飞书消息。</p>
            </div>
          </div>
          {onClose && (
            <button onClick={onClose} className="rounded-md p-1.5 hover:bg-zinc-100" style={{ color: 'rgb(var(--c-text-muted))' }}>
              <X size={16} />
            </button>
          )}
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs" style={{ color: 'rgb(var(--c-text-muted))' }}>App ID</span>
            <input value={appId} onChange={(e) => setAppId(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-sky-300" style={{ borderColor: 'rgb(var(--c-border))', background: 'rgb(var(--c-bg))', color: 'rgb(var(--c-text))' }} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs" style={{ color: 'rgb(var(--c-text-muted))' }}>App Secret</span>
            <input value={appSecret} onChange={(e) => setAppSecret(e.target.value)} type="password" className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-sky-300" style={{ borderColor: 'rgb(var(--c-border))', background: 'rgb(var(--c-bg))', color: 'rgb(var(--c-text))' }} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs" style={{ color: 'rgb(var(--c-text-muted))' }}>Verification Token</span>
            <input value={verificationToken} onChange={(e) => setVerificationToken(e.target.value)} type="password" className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-sky-300" style={{ borderColor: 'rgb(var(--c-border))', background: 'rgb(var(--c-bg))', color: 'rgb(var(--c-text))' }} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs" style={{ color: 'rgb(var(--c-text-muted))' }}>备用 Webhook 端口</span>
            <input value={port} onChange={(e) => setPort(Number(e.target.value) || 3768)} type="number" className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-sky-300" style={{ borderColor: 'rgb(var(--c-border))', background: 'rgb(var(--c-bg))', color: 'rgb(var(--c-text))' }} />
          </label>
          <div className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'rgb(var(--c-border))', background: 'rgba(14,165,233,0.06)', color: 'rgb(var(--c-text-muted))' }}>
            连接方式：<span style={{ color: 'rgb(var(--c-text))' }}>WebSocket 长连接</span>
            <br />
            飞书后台事件订阅请选择"使用长连接接收事件"，并订阅 im.message.receive_v1。备用端口仅用于旧 Webhook 模式。
          </div>
          <PermissionScopes />
          {activeBot && (
            <div className="rounded-lg border p-3" style={{ borderColor: 'rgb(var(--c-border))', background: 'rgb(var(--c-bg))' }}>
              <div className="mb-2 text-xs font-medium" style={{ color: 'rgb(var(--c-text))' }}>OpenClaw 体验对齐</div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ['streaming', '流式卡片回复'],
                  ['footerStatus', '显示状态'],
                  ['footerElapsed', '显示耗时'],
                  ['threadSession', '话题独立上下文'],
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 rounded-md border px-2 py-2 text-xs" style={{ borderColor: 'rgb(var(--c-border))', color: 'rgb(var(--c-text-muted))' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(activeBot.pluginSettings?.[key as keyof typeof activeBot.pluginSettings])}
                      onChange={(e) => updatePluginSettings(activeBot.id, { [key]: e.target.checked })}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          )}
          {activeBot && (
            <div className="rounded-lg border p-3" style={{ borderColor: 'rgb(var(--c-border))', background: 'rgb(var(--c-bg))' }}>
              <div className="mb-2 text-xs font-medium" style={{ color: 'rgb(var(--c-text))' }}>群聊策略</div>
              <select
                value={activeBot.pluginSettings?.groupPolicy || 'open'}
                onChange={(e) => updatePluginSettings(activeBot.id, { groupPolicy: e.target.value as 'open' | 'allowlist' | 'disabled' })}
                className="w-full rounded-md border px-2 py-1.5 text-xs outline-none"
                style={{ borderColor: 'rgb(var(--c-border))', color: 'rgb(var(--c-text))' }}
              >
                <option value="open">开放 — 所有群聊自动回复</option>
                <option value="allowlist">白名单 — 仅允许指定群聊</option>
                <option value="disabled">禁用 — 群聊不自动回复</option>
              </select>
            </div>
          )}
          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
        </div>

        <button onClick={submit} disabled={saving || !appId.trim() || (!activeBot && !appSecret.trim())} className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-medium text-white transition-opacity disabled:opacity-40">
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
          保存并启动
        </button>
      </motion.div>
    </div>
  );
}

function ContactList({ onConfig }: { onConfig: () => void }) {
  const bots = useLarkStore((s) => s.bots);
  const activeBotId = useLarkStore((s) => s.activeBotId);
  const selectedContact = useLarkStore((s) => s.selectedContact);
  const setActiveBot = useLarkStore((s) => s.setActiveBot);
  const setSelectedContact = useLarkStore((s) => s.setSelectedContact);
  const setNickname = useLarkStore((s) => s.setNickname);
  const setReplyMode = useLarkStore((s) => s.setReplyMode);
  const startServer = useLarkStore((s) => s.startServer);
  const resumeBot = useLarkStore((s) => s.resumeBot);
  const queueStatus = useLarkStore((s) => s.queueStatus);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const editRef = useRef<HTMLInputElement>(null);

  const contacts = Object.entries(bots).flatMap(([botId, bot]) =>
    Object.values(bot.contacts).map((c) => ({ ...c, botId })),
  ).sort((a, b) => b.lastTime - a.lastTime);
  const botValues = Object.values(bots);
  const running = botValues.some((b) => b.running);
  const circuitOpen = botValues.some((b) => b.lastError?.includes('已暂停'));

  const startEdit = (e: React.MouseEvent, botId: string, chatId: string) => {
    e.stopPropagation();
    setEditingKey(`${botId}:${chatId}`);
    setEditValue(bots[botId]?.nicknames[chatId] || '');
    setTimeout(() => editRef.current?.focus(), 30);
  };
  const confirmEdit = (botId: string, chatId: string) => {
    if (editValue.trim()) setNickname(botId, chatId, editValue.trim());
    setEditingKey(null);
  };

  return (
    <div className="w-[270px] h-full flex flex-col border-r" style={{ borderColor: 'rgb(var(--c-border))' }}>
      <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'rgb(var(--c-border))', background: 'rgb(var(--c-card))' }}>
        <span className="text-sm font-medium" style={{ color: 'rgb(var(--c-text))' }}>飞书</span>
        <button onClick={onConfig} className="p-1.5 rounded-md transition-colors" style={{ color: 'rgb(var(--c-text-muted))' }} title="配置飞书机器人">
          <Plus size={14} />
        </button>
      </div>
      <ChannelStatusBar
        state={circuitOpen ? 'error' : running ? 'online' : 'offline'}
        label={circuitOpen ? '已暂停' : running ? `长连接已启动 (${botValues.length})` : '未启动'}
        detail={circuitOpen ? botValues.find((bot) => bot.lastError)?.lastError : botValues[0]?.statusText || (running ? '后台持续接收消息' : undefined)}
        active={queueStatus.active}
        pending={queueStatus.pending}
        onRecover={(!running || circuitOpen) && botValues[0] ? () => circuitOpen ? resumeBot(botValues[0].id) : void startServer(botValues[0].id) : undefined}
        recoverLabel={circuitOpen ? '恢复连接' : '启动长连接'}
      />
      <div className="flex-1 overflow-y-auto">
        {contacts.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs" style={{ color: 'rgb(var(--c-text-muted))' }}>等待飞书消息...</div>
        ) : contacts.map((c) => {
          const key = `${c.botId}:${c.chatId}`;
          const selected = activeBotId === c.botId && selectedContact === c.chatId;
          const isEditing = editingKey === key;
          const nicknames = bots[c.botId]?.nicknames || {};
          return (
            <button key={key} onClick={() => { if (!isEditing) { setActiveBot(c.botId); setSelectedContact(c.chatId); } }} className="group w-full px-4 py-3 flex items-start gap-3 text-left transition-colors" style={{ background: selected ? 'rgba(14,165,233,0.08)' : 'transparent', borderBottom: '1px solid rgb(var(--c-border))' }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'rgb(var(--c-card))', border: '1px solid rgb(var(--c-border))' }}>
                {c.chatType === 'group' ? <Users size={14} style={{ color: 'rgb(var(--c-text-muted))' }} /> : <MessageSquare size={14} style={{ color: 'rgb(var(--c-text-muted))' }} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  {isEditing ? (
                    <input ref={editRef} value={editValue} onChange={(e) => setEditValue(e.target.value)} onBlur={() => confirmEdit(c.botId, c.chatId)} onKeyDown={(e) => { if (e.key === 'Enter') confirmEdit(c.botId, c.chatId); if (e.key === 'Escape') setEditingKey(null); }} onClick={(e) => e.stopPropagation()} className="min-w-0 flex-1 bg-transparent border-b text-xs outline-none" />
                  ) : (
                    <>
                      <span className="truncate text-xs font-medium" style={{ color: 'rgb(var(--c-text))' }}>{displayName(c.chatId, nicknames)}</span>
                      <button onClick={(e) => startEdit(e, c.botId, c.chatId)} className="opacity-0 group-hover:opacity-100 p-0.5">
                        <Pencil size={10} style={{ color: 'rgb(var(--c-text-muted))' }} />
                      </button>
                    </>
                  )}
                  {c.unread > 0 && <span className="h-4 min-w-4 rounded-full bg-red-500 px-1 text-[9px] text-white flex items-center justify-center">{c.unread > 9 ? '9+' : c.unread}</span>}
                </div>
                <p className="text-[11px] truncate mt-0.5" style={{ color: 'rgb(var(--c-text-muted))' }}>{c.lastMessage || '...'}</p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-[10px]" style={{ color: 'rgb(var(--c-text-muted))' }}>{c.chatType === 'group' ? '群聊' : '单聊'}</span>
                  <select value={bots[c.botId]?.contacts[c.chatId]?.replyMode ?? 'auto'} onClick={(e) => e.stopPropagation()} onChange={(e) => setReplyMode(c.botId, c.chatId, e.target.value as LarkReplyMode)} className="rounded-md border px-1 py-0.5 text-[10px] outline-none" style={{ color: 'rgb(var(--c-text-muted))', borderColor: 'rgb(var(--c-border))' }}>
                    <option value="auto">自动</option>
                    <option value="manual">手动</option>
                    <option value="ignore">忽略</option>
                  </select>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: LarkMessage }) {
  const isBot = !!msg.isBot;
  const hasText = !!msg.text && !msg.text.startsWith('[用户发送了');
  const hasImage = !!msg.image_local_path;
  const hasFile = !!msg.file_local_path;
  const hasVoice = !!msg.voice_local_path;
  const isImagePlaceholder = msg.msg_type === 'image' && !msg.image_local_path;
  const isFilePlaceholder = (msg.msg_type === 'file' || msg.msg_type === 'media') && !msg.file_local_path;

  const resolveUrl = (url: string) => {
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('asset://')) return url;
    try { return convertFileSrc(url); } catch { return url; }
  };

  return (
    <div className={`flex ${isBot ? 'justify-end' : 'justify-start'}`}>
      <div
        className="max-w-[70%] px-3 py-2 text-sm leading-relaxed"
        style={{
          borderRadius: isBot ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
          background: isBot ? 'rgb(var(--c-card))' : 'rgba(255,255,255,0.5)',
          color: 'rgb(var(--c-text))',
          border: '1px solid rgb(var(--c-border))',
        }}
      >
        {hasText && <div className="whitespace-pre-wrap">{msg.text}</div>}
        {hasImage && (
          <div className={hasText ? 'mt-1.5' : ''}>
            <a href={resolveUrl(msg.image_local_path!)} target="_blank" rel="noreferrer">
              <img
                src={resolveUrl(msg.image_local_path!)}
                alt="图片"
                className="rounded-md max-w-[240px] max-h-[200px] object-cover cursor-pointer"
                style={{ border: '1px solid rgb(var(--c-border))' }}
              />
            </a>
          </div>
        )}
        {isImagePlaceholder && !hasImage && (
          <div className="flex items-center gap-1.5 text-xs" style={{ color: 'rgb(var(--c-text-muted))' }}>
            <Loader2 size={12} className="animate-spin" />
            正在下载图片...
          </div>
        )}
        {hasFile && (
          <div className={`${hasText || hasImage ? 'mt-1.5' : ''}`}>
            {msg.msg_type === 'media' ? (
              <video
                src={resolveUrl(msg.file_local_path!)}
                controls
                className="rounded-md max-w-[280px]"
                style={{ border: '1px solid rgb(var(--c-border))' }}
              />
            ) : (
              <a
                href={resolveUrl(msg.file_local_path!)}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 px-2 py-1.5 rounded-md"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgb(var(--c-border))' }}
              >
                <FileText size={14} style={{ color: 'rgb(var(--c-text-muted))', flexShrink: 0 }} />
                <span className="text-xs truncate" style={{ color: 'rgb(var(--c-text))' }}>{msg.file_name || '文件'}</span>
              </a>
            )}
          </div>
        )}
        {isFilePlaceholder && !hasFile && (
          <div className="flex items-center gap-1.5 text-xs" style={{ color: 'rgb(var(--c-text-muted))' }}>
            <Loader2 size={12} className="animate-spin" />
            正在下载{msg.msg_type === 'media' ? '视频' : '文件'}...
          </div>
        )}
        {hasVoice && (
          <div className={`${hasText || hasImage || hasFile ? 'mt-1.5' : ''}`}>
            <div className="text-xs" style={{ color: 'rgb(var(--c-text-muted))' }}>[语音消息]</div>
          </div>
        )}
        {!hasText && !hasImage && !hasFile && !hasVoice && !isImagePlaceholder && !isFilePlaceholder && (
          <div className="whitespace-pre-wrap">{msg.text || '[空消息]'}</div>
        )}
      </div>
    </div>
  );
}

function ChatPanel() {
  const bots = useLarkStore((s) => s.bots);
  const activeBotId = useLarkStore((s) => s.activeBotId);
  const selectedContact = useLarkStore((s) => s.selectedContact);
  const setSelectedContact = useLarkStore((s) => s.setSelectedContact);
  const sendMessage = useLarkStore((s) => s.sendMessage);
  const triggerAiReply = useLarkStore((s) => s.triggerAiReply);
  const setReplyMode = useLarkStore((s) => s.setReplyMode);
  const runId = useRunStepStore((s) => (
    selectedContact && activeBotId
      ? s.runIdsBySession[`lark:${activeBotId}:${selectedContact}`]?.[0]
      : undefined
  ));
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [showRun, setShowRun] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const bot = activeBotId ? bots[activeBotId] : null;
  const contact = selectedContact && bot ? bot.contacts[selectedContact] : undefined;
  const messages = selectedContact && bot ? (bot.messages[selectedContact] || []) : [];
  const hasRun = Boolean(runId);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  const handleSend = async () => {
    if (!input.trim() || !activeBotId || !selectedContact || sending) return;
    const text = input.trim();
    setInput('');
    setSending(true);
    try { await sendMessage(activeBotId, selectedContact, text); } catch (e) { console.error('[lark] send error:', e); }
    setSending(false);
  };

  const handleAttach = async () => {
    if (!activeBotId || !selectedContact || sending) return;
    const selected = await open({
      multiple: true,
      directory: false,
      filters: [
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] },
        { name: 'Files', extensions: ['*'] },
      ],
    }).catch(() => null);
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    setSending(true);
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'];
    for (const p of paths) {
      const ext = p.split('.').pop()?.toLowerCase() || '';
      try {
        if (imageExts.includes(ext)) {
          await invoke('lark_send_image', { botId: activeBotId, chatId: selectedContact, filePath: p });
        } else {
          await invoke('lark_send_file', { botId: activeBotId, chatId: selectedContact, filePath: p });
        }
      } catch (e) {
        console.error('[lark] attach error:', e);
      }
    }
    setSending(false);
  };

  if (!selectedContact) {
    return <div className="flex-1 flex items-center justify-center text-sm" style={{ color: 'rgb(var(--c-text-muted))' }}>选择一个飞书会话</div>;
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="px-4 py-3 border-b flex items-center gap-3" style={{ borderColor: 'rgb(var(--c-border))', background: 'rgb(var(--c-card))' }}>
        <button onClick={() => setSelectedContact(null)} className="p-1 rounded-md md:hidden" style={{ color: 'rgb(var(--c-text-muted))' }}>
          <ChevronLeft size={16} />
        </button>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {contact?.chatType === 'group' ? <Users size={14} /> : <MessageSquare size={14} />}
            <span className="text-sm font-medium truncate" style={{ color: 'rgb(var(--c-text))' }}>{displayName(selectedContact, bot?.nicknames || {})}</span>
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: 'rgb(var(--c-text-muted))' }}>
            {contact?.chatType === 'group' ? '群聊' : '单聊'}
            {bot?.lastEventAt ? ` · 最近事件 ${new Date(bot.lastEventAt).toLocaleTimeString()}` : ''}
          </div>
        </div>
        {hasRun && (
          <button onClick={() => setShowRun((v) => !v)} className="ml-auto flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-sky-50" style={{ color: 'rgb(var(--c-text-muted))', borderColor: 'rgb(var(--c-border))' }}>
            <ListChecks size={13} />执行链
          </button>
        )}
        <button onClick={() => activeBotId && selectedContact && triggerAiReply(activeBotId, selectedContact)} className={`${hasRun ? '' : 'ml-auto'} flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-sky-50`} style={{ color: 'rgb(var(--c-text-muted))', borderColor: 'rgb(var(--c-border))' }}>
          <Bot size={13} />AI 回复
        </button>
        <select value={contact?.replyMode ?? 'auto'} onChange={(e) => activeBotId && selectedContact && setReplyMode(activeBotId, selectedContact, e.target.value as LarkReplyMode)} className="rounded-md border px-2 py-1 text-xs outline-none" style={{ color: 'rgb(var(--c-text-muted))', borderColor: 'rgb(var(--c-border))' }}>
          <option value="auto">自动回复</option>
          <option value="manual">手动处理</option>
          <option value="ignore">忽略消息</option>
        </select>
      </div>
      {showRun && hasRun && (
        <div className="border-b px-4 py-2" style={{ borderColor: 'rgb(var(--c-border))', background: 'rgb(var(--c-card))' }}>
          <RunStepTimeline compact showHeader runId={runId} />
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {messages.map((msg, i) => <MessageBubble key={msg.message_id || i} msg={msg} />)}
        <div ref={endRef} />
      </div>
      <div className="px-4 py-3 border-t" style={{ borderColor: 'rgb(var(--c-border))', background: 'rgb(var(--c-card))' }}>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'rgb(var(--c-card))', border: '1px solid rgb(var(--c-border))' }}>
          <button
            onClick={handleAttach}
            disabled={sending}
            className="p-1 rounded-md transition-opacity shrink-0"
            style={{ color: 'rgb(var(--c-text-muted))', opacity: sending ? 0.3 : 0.7 }}
            title="发送图片/文件"
          >
            <Paperclip size={15} />
          </button>
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); } }} placeholder="输入飞书回复..." className="flex-1 bg-transparent text-sm focus:outline-none" style={{ color: 'rgb(var(--c-text))' }} />
          <button onClick={handleSend} disabled={!input.trim() || sending} className="p-1.5 rounded-md transition-opacity" style={{ opacity: input.trim() ? 1 : 0.3, color: 'rgb(var(--c-text-muted))' }}>
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LarkView() {
  const bots = useLarkStore((s) => s.bots);
  const configOpen = useLarkStore((s) => s.configOpen);
  const setConfigOpen = useLarkStore((s) => s.setConfigOpen);
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar);
  const hasBots = Object.keys(bots).length > 0;

  return (
    <div className="w-full h-full flex flex-col" style={{ background: 'rgb(var(--c-bg))' }}>
      {sidebarCollapsed && (
        <div className="px-4 py-2 border-b" style={{ borderColor: 'rgb(var(--c-border))' }}>
          <button onClick={toggleSidebar} className="p-2 hover:bg-dark-border rounded-lg transition-colors">
            <Menu size={20} style={{ color: 'rgb(var(--c-text))' }} />
          </button>
        </div>
      )}
      <div className="flex-1 flex min-h-0">
        {configOpen || !hasBots ? (
          <ConfigPanel onClose={hasBots ? () => setConfigOpen(false) : undefined} />
        ) : (
          <>
            <ContactList onConfig={() => setConfigOpen(true)} />
            <ChatPanel />
          </>
        )}
      </div>
    </div>
  );
}
