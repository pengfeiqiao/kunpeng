import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { MessageSquare, Send, Loader2, QrCode, ChevronLeft, Menu, Pencil, Check, Plus, X, Paperclip, FileText, Bot, Users, ListChecks } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { open } from '@tauri-apps/api/dialog';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { useWechatStore } from '@/stores/wechatStore';
import { useSettingsStore } from '@/stores';
import { useRunStepStore } from '@/stores/runStepStore';
import RunStepTimeline from '@/components/chat/RunStepTimeline';
import ChannelStatusBar from '@/components/messaging/ChannelStatusBar';
import type { WechatMessage, WechatReplyMode } from '@/stores/wechatStore';

// ── Helper ─────────────────────────────────────────────────────────────────

function displayName(userId: string, nicknames: Record<string, string>): string {
  if (nicknames[userId]) return nicknames[userId];
  const atIdx = userId.indexOf('@');
  const base = atIdx > 0 ? userId.slice(0, atIdx) : userId;
  return base.length > 10 ? base.slice(0, 10) + '...' : base;
}

/** Merge nicknames from all bots */
function allNicknames(bots: Record<string, import('@/stores/wechatStore').WechatBot>): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const bot of Object.values(bots)) {
    Object.assign(merged, bot.nicknames);
  }
  return merged;
}

/** Merge contacts from all bots, keeping the most recent per userId, and track which bot owns each */
function allContacts(bots: Record<string, import('@/stores/wechatStore').WechatBot>): { userId: string; botId: string; lastMessage: string; lastTime: number; unread: number; isGroup?: boolean; replyMode?: WechatReplyMode }[] {
  const map: Record<string, { userId: string; botId: string; lastMessage: string; lastTime: number; unread: number; isGroup?: boolean; replyMode?: WechatReplyMode }> = {};
  for (const [botId, bot] of Object.entries(bots)) {
    for (const c of Object.values(bot.contacts)) {
      const key = `${botId}:${c.userId}`;
      map[key] = { userId: c.userId, botId, lastMessage: c.lastMessage, lastTime: c.lastTime, unread: c.unread, isGroup: c.isGroup, replyMode: c.replyMode };
    }
  }
  return Object.values(map).sort((a, b) => b.lastTime - a.lastTime);
}

// ── QR Login Overlay ────────────────────────────────────────────────────────

function QrLoginOverlay({ onClose }: { onClose?: () => void }) {
  const { qrcodeUrl, loginStatus, loginScanning, fetchQrcode, pollQrcodeStatus, startPolling, resetLogin } = useWechatStore();
  const pollingRef = useRef(false);

  const startLogin = useCallback(async () => {
    await fetchQrcode();
    pollingRef.current = true;

    while (pollingRef.current) {
      const result = await pollQrcodeStatus();
      if (result === 'confirmed') {
        const { bots } = useWechatStore.getState();
        const botIds = Object.keys(bots);
        const newBotId = botIds[botIds.length - 1];
        if (newBotId) await startPolling(newBotId);
        pollingRef.current = false;
        onClose?.();
        return;
      }
      if (result === 'expired') {
        if (!pollingRef.current) return;
        // Auto-refresh: fetch a new QR code and keep polling
        await fetchQrcode();
        continue;
      }
      if (result === 'error') {
        pollingRef.current = false;
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }, [fetchQrcode, pollQrcodeStatus, startPolling, onClose]);

  useEffect(() => () => { pollingRef.current = false; }, []);

  const handleClose = () => {
    pollingRef.current = false;
    resetLogin();
    onClose?.();
  };

  return (
    <div className="flex-1 flex items-center justify-center relative">
      {onClose && (
        <button onClick={handleClose} className="absolute top-3 right-3 p-1.5 rounded-md" style={{ color: 'rgb(var(--c-text-muted))' }}>
          <X size={16} />
        </button>
      )}
      <div className="text-center">
        {loginStatus === 'idle' && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <div className="w-16 h-16 rounded-2xl bg-dark-card border border-dark-border flex items-center justify-center mx-auto mb-4">
              <MessageSquare size={28} style={{ color: 'rgb(var(--c-text-muted))' }} />
            </div>
            <h2 className="text-lg font-medium mb-2" style={{ color: 'rgb(var(--c-text))' }}>微信助手</h2>
            <p className="text-sm mb-6" style={{ color: 'rgb(var(--c-text-muted))' }}>扫码登录后，鲲鹏可以通过微信接收和回复消息</p>
            <button
              onClick={startLogin}
              className="px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
              style={{ background: 'rgb(var(--c-card))', border: '1px solid rgb(var(--c-border))', color: 'rgb(var(--c-text))' }}
            >
              <QrCode size={16} className="inline mr-2" style={{ verticalAlign: -3 }} />
              扫码登录
            </button>
          </motion.div>
        )}

        {loginStatus === 'loading' && (
          <div className="flex items-center gap-2" style={{ color: 'rgb(var(--c-text-muted))' }}>
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">获取二维码...</span>
          </div>
        )}

        {(loginStatus === 'waiting' || loginStatus === 'expired') && (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
            {loginStatus === 'expired' ? (
              <div className="mb-4">
                <p className="text-sm mb-3" style={{ color: 'rgb(var(--c-text-muted))' }}>二维码已过期</p>
                <button onClick={startLogin} className="text-sm underline" style={{ color: 'rgb(var(--c-text))' }}>重新获取</button>
              </div>
            ) : (
              <>
                {qrcodeUrl && (
                  <div className="mb-4 p-4 rounded-xl inline-block" style={{ background: '#fff' }}>
                    <QRCodeSVG value={qrcodeUrl} size={200} level="M" />
                  </div>
                )}
                <p className="text-sm" style={{ color: 'rgb(var(--c-text-muted))' }}>
                  {loginScanning ? '已扫码，请在手机上确认...' : '请使用微信扫描二维码'}
                </p>
              </>
            )}
          </motion.div>
        )}

        {loginStatus === 'error' && (
          <div>
            <p className="text-sm mb-3" style={{ color: 'rgb(var(--c-text-muted))' }}>登录失败</p>
            <button onClick={startLogin} className="text-sm underline" style={{ color: 'rgb(var(--c-text))' }}>重试</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Contact List ────────────────────────────────────────────────────────────

function ContactList({ onAddBot }: { onAddBot: () => void }) {
  const bots = useWechatStore((s) => s.bots);
  const selectedContact = useWechatStore((s) => s.selectedContact);
  const activeBotId = useWechatStore((s) => s.activeBotId);
  const setSelectedContact = useWechatStore((s) => s.setSelectedContact);
  const setActiveBot = useWechatStore((s) => s.setActiveBot);
  const setNickname = useWechatStore((s) => s.setNickname);
  const startPolling = useWechatStore((s) => s.startPolling);
  const resumeBot = useWechatStore((s) => s.resumeBot);
  const setReplyMode = useWechatStore((s) => s.setReplyMode);
  const queueStatus = useWechatStore((s) => s.queueStatus);

  const nicknames = allNicknames(bots);
  const contacts = allContacts(bots);

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const editRef = useRef<HTMLInputElement>(null);

  const botValues = Object.values(bots);
  const anyPolling = botValues.some((b) => b.polling);
  const anyReconnecting = botValues.some((b) => b.reconnecting);
  const firstDisconnected = botValues.find((b) => !b.polling || b.reconnecting);
  const circuitOpen = firstDisconnected?.lastError?.includes('已暂停');
  const sessionExpired = firstDisconnected?.lastError?.includes('已过期');
  const botCount = Object.keys(bots).length;
  const statusText = sessionExpired ? '会话过期' : circuitOpen ? '已暂停' : anyReconnecting ? '恢复中' : anyPolling ? `已连接 (${botCount})` : '未连接';

  const startEdit = (e: React.MouseEvent, botId: string, userId: string) => {
    e.stopPropagation();
    const key = `${botId}:${userId}`;
    setEditingKey(key);
    setEditValue(nicknames[userId] || '');
    setTimeout(() => editRef.current?.focus(), 30);
  };

  const confirmEdit = (botId: string, userId: string) => {
    const trimmed = editValue.trim();
    if (trimmed) setNickname(botId, userId, trimmed);
    setEditingKey(null);
  };

  const selectContact = (botId: string, userId: string) => {
    setActiveBot(botId);
    setSelectedContact(userId);
  };

  const replyModeLabel: Record<WechatReplyMode, string> = {
    auto: '自动',
    manual: '手动',
    ignore: '忽略',
  };

  return (
    <div className="w-[260px] h-full flex flex-col border-r" style={{ borderColor: 'rgb(var(--c-border))' }}>
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: 'rgb(var(--c-border))', background: 'rgb(var(--c-card))' }}>
        <span className="text-sm font-medium" style={{ color: 'rgb(var(--c-text))' }}>微信</span>
        <button
          onClick={onAddBot}
          className="p-1.5 rounded-md transition-colors"
          style={{ color: 'rgb(var(--c-text-muted))' }}
          title="添加微信号"
        >
          <Plus size={14} />
        </button>
      </div>

      <ChannelStatusBar
        state={(circuitOpen || sessionExpired) ? 'error' : anyReconnecting ? 'reconnecting' : anyPolling ? 'online' : 'offline'}
        label={statusText}
        detail={firstDisconnected?.lastError || (anyPolling ? '后台持续接收消息' : undefined)}
        active={queueStatus.active}
        pending={queueStatus.pending}
        onRecover={sessionExpired ? onAddBot : firstDisconnected ? () => circuitOpen ? resumeBot(firstDisconnected.id) : void startPolling(firstDisconnected.id) : undefined}
        recoverLabel={sessionExpired ? '重新登录' : circuitOpen ? '恢复连接' : '手动重连'}
      />

      {/* Contacts */}
      <div className="flex-1 overflow-y-auto">
        {contacts.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-xs" style={{ color: 'rgb(var(--c-text-muted))' }}>等待消息...</p>
          </div>
        ) : (
          contacts.map((c) => {
            const key = `${c.botId}:${c.userId}`;
            const isEditing = editingKey === key;
            const isSelected = activeBotId === c.botId && selectedContact === c.userId;
            return (
              <button
                key={key}
                onClick={() => { if (!isEditing) selectContact(c.botId, c.userId); }}
                className="group w-full px-4 py-3 flex items-start gap-3 transition-colors text-left"
                style={{
                  background: isSelected ? 'rgba(14,165,233,0.08)' : 'transparent',
                  borderBottom: '1px solid rgb(var(--c-border))',
                }}
              >
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'rgb(var(--c-card))', border: '1px solid rgb(var(--c-border))' }}>
                  {c.isGroup ? <Users size={14} style={{ color: 'rgb(var(--c-text-muted))' }} /> : <MessageSquare size={14} style={{ color: 'rgb(var(--c-text-muted))' }} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    {isEditing ? (
                      <div className="flex items-center gap-1 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                        <input
                          ref={editRef}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') confirmEdit(c.botId, c.userId);
                            if (e.key === 'Escape') setEditingKey(null);
                          }}
                          onBlur={() => confirmEdit(c.botId, c.userId)}
                          className="flex-1 min-w-0 bg-transparent border-b text-xs font-medium outline-none"
                          style={{ color: 'rgb(var(--c-text))', borderColor: 'rgb(var(--c-text-muted))' }}
                          placeholder="输入备注名"
                        />
                        <button onClick={() => confirmEdit(c.botId, c.userId)} className="shrink-0 p-0.5">
                          <Check size={12} style={{ color: 'rgb(var(--c-text-muted))' }} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="text-xs font-medium truncate" style={{ color: 'rgb(var(--c-text))' }}>
                          {displayName(c.userId, nicknames)}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={(e) => startEdit(e, c.botId, c.userId)}
                            className="opacity-0 group-hover:opacity-100 p-0.5 transition-opacity"
                            title="设置备注名"
                          >
                            <Pencil size={10} style={{ color: 'rgb(var(--c-text-muted))' }} />
                          </button>
                          {c.unread > 0 && (
                            <span className="w-4 h-4 rounded-full bg-red-500 text-[9px] text-white flex items-center justify-center font-bold">
                              {c.unread > 9 ? '9+' : c.unread}
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  <p className="text-[11px] truncate mt-0.5" style={{ color: 'rgb(var(--c-text-muted))' }}>
                    {c.lastMessage || '...'}
                  </p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-[10px]" style={{ color: 'rgb(var(--c-text-muted))' }}>{c.isGroup ? '群聊只读' : c.botId.slice(0, 8)}</span>
                    {c.isGroup ? (
                      <span className="rounded-md border px-1 py-0.5 text-[10px]" style={{ color: 'rgb(var(--c-text-muted))', borderColor: 'rgb(var(--c-border))' }}>
                        不支持
                      </span>
                    ) : (
                      <select
                        value={bots[c.botId]?.contacts[c.userId]?.replyMode ?? 'auto'}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setReplyMode(c.botId, c.userId, e.target.value as WechatReplyMode)}
                        className="rounded-md border px-1 py-0.5 text-[10px] outline-none"
                        style={{ color: 'rgb(var(--c-text-muted))', borderColor: 'rgb(var(--c-border))' }}
                        title="自动回复策略"
                      >
                        {(Object.keys(replyModeLabel) as WechatReplyMode[]).map((mode) => (
                          <option key={mode} value={mode}>{replyModeLabel[mode]}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Message Bubble ──────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: WechatMessage }) {
  const isBot = !!msg.isBot;
  const hasText = !!msg.text;
  const hasImages = msg.images && msg.images.length > 0;
  const hasFiles = msg.files && msg.files.length > 0;
  const hasVideos = msg.videos && msg.videos.length > 0;
  const hasVoice = !!msg.voice_url || !!msg.voice_text;

  // For local file paths, convert to asset URL
  const resolveUrl = (url: string) => {
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    if (url.startsWith('asset://')) return url;
    try {
      const resolved = convertFileSrc(url);
      console.log('[wechat-ui] resolveUrl:', url, '->', resolved);
      return resolved;
    } catch { return url; }
  };

  return (
    <div className={`flex ${isBot ? 'justify-end' : 'justify-start'}`}>
      <div
        className="max-w-[70%] px-3 py-2 text-sm leading-relaxed"
        style={{
          borderRadius: isBot ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
          background: isBot ? 'rgb(var(--c-card))' : 'rgba(255,255,255,0.03)',
          color: 'rgb(var(--c-text))',
          border: '1px solid rgb(var(--c-border))',
        }}
      >
        {hasText && <div className="whitespace-pre-wrap">{msg.text}</div>}
        {hasImages && (
          <div className={`flex flex-wrap gap-1.5 ${hasText ? 'mt-1.5' : ''}`}>
            {msg.images!.map((url, i) => {
              const src = resolveUrl(url);
              return (
                <a key={i} href={src} target="_blank" rel="noreferrer" className="block">
                  <img
                    src={src}
                    alt="图片"
                    className="rounded-md max-w-[240px] max-h-[200px] object-cover cursor-pointer"
                    style={{ border: '1px solid rgb(var(--c-border))' }}
                    onError={(e) => {
                      console.error('[wechat-ui] img load error:', url, src);
                      (e.target as HTMLImageElement).alt = '[图片加载失败]';
                      (e.target as HTMLImageElement).style.padding = '8px';
                      (e.target as HTMLImageElement).style.minWidth = '120px';
                      (e.target as HTMLImageElement).style.minHeight = '40px';
                    }}
                  />
                </a>
              );
            })}
          </div>
        )}
        {hasFiles && (
          <div className={`space-y-1 ${hasText || hasImages ? 'mt-1.5' : ''}`}>
            {msg.files!.map((f, i) => (
              <a
                key={i}
                href={resolveUrl(f.url)}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgb(var(--c-border))' }}
              >
                <FileText size={14} style={{ color: 'rgb(var(--c-text-muted))', flexShrink: 0 }} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs truncate" style={{ color: 'rgb(var(--c-text))' }}>{f.name}</div>
                  {f.size > 0 && (
                    <div className="text-[10px]" style={{ color: 'rgb(var(--c-text-muted))' }}>
                      {f.size < 1024 ? `${f.size} B` : f.size < 1048576 ? `${(f.size / 1024).toFixed(1)} KB` : `${(f.size / 1048576).toFixed(1)} MB`}
                    </div>
                  )}
                </div>
              </a>
            ))}
          </div>
        )}
        {hasVideos && (
          <div className={`space-y-1.5 ${hasText || hasImages || hasFiles ? 'mt-1.5' : ''}`}>
            {msg.videos!.map((url, i) => (
              <video
                key={i}
                src={resolveUrl(url)}
                controls
                className="rounded-md max-w-[280px]"
                style={{ border: '1px solid rgb(var(--c-border))' }}
              />
            ))}
          </div>
        )}
        {hasVoice && (
          <div className={`${hasText || hasImages || hasFiles || hasVideos ? 'mt-1.5' : ''}`}>
            {msg.voice_text ? (
              <div>
                <div className="text-xs whitespace-pre-wrap" style={{ color: 'rgb(var(--c-text))' }}>{msg.voice_text}</div>
                <div className="text-[10px] mt-0.5" style={{ color: 'rgb(var(--c-text-muted))' }}>语音转文字</div>
              </div>
            ) : (
              <div className="text-xs" style={{ color: 'rgb(var(--c-text-muted))' }}>[语音消息]</div>
            )}
          </div>
        )}
        {!hasText && !hasImages && !hasFiles && !hasVideos && !hasVoice && (
          <span style={{ color: 'rgb(var(--c-text-muted))' }}>[unsupported]</span>
        )}
      </div>
    </div>
  );
}

// ── Chat Panel ──────────────────────────────────────────────────────────────

function ChatPanel() {
  const bots = useWechatStore((s) => s.bots);
  const activeBotId = useWechatStore((s) => s.activeBotId);
  const selectedContact = useWechatStore((s) => s.selectedContact);
  const sendMessage = useWechatStore((s) => s.sendMessage);
  const sendFile = useWechatStore((s) => s.sendFile);
  const triggerAiReply = useWechatStore((s) => s.triggerAiReply);
  const setSelectedContact = useWechatStore((s) => s.setSelectedContact);
  const setReplyMode = useWechatStore((s) => s.setReplyMode);
  const processingStatus = useWechatStore((s) => s.processingStatus);
  const sessionRunId = useRunStepStore((s) => (
    selectedContact && activeBotId
      ? s.runIdsBySession[`wechat:${activeBotId}:${selectedContact}`]?.[0]
      : undefined
  ));
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [showRun, setShowRun] = useState(false);
  const [userToggledRun, setUserToggledRun] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const bot = activeBotId ? bots[activeBotId] : null;
  const nicknames = bot?.nicknames || {};
  const contactMessages = selectedContact && bot ? (bot.messages[selectedContact] || []) : [];
  const contact = selectedContact && bot ? bot.contacts[selectedContact] : undefined;
  const replyMode = contact?.isGroup ? 'ignore' : (contact?.replyMode ?? 'auto');
  const isGroupUnsupported = !!contact?.isGroup;
  const hasRun = Boolean(sessionRunId);

  const statusKey = activeBotId && selectedContact ? `${activeBotId}:${selectedContact}` : '';
  const currentStatus = statusKey ? processingStatus[statusKey] : undefined;

  useEffect(() => {
    if (currentStatus && !userToggledRun) setShowRun(true);
    if (!currentStatus && !userToggledRun && showRun) {
      const t = setTimeout(() => setShowRun(false), 5000);
      return () => clearTimeout(t);
    }
  }, [!!currentStatus]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [contactMessages.length]);

  const handleSend = async () => {
    if (!input.trim() || !selectedContact || !activeBotId || sending || isGroupUnsupported) return;
    const text = input.trim();
    setInput('');
    setSending(true);
    try {
      await sendMessage(activeBotId, selectedContact, text);
    } catch { /* */ }
    setSending(false);
  };

  const handleAttach = async () => {
    if (!selectedContact || !activeBotId || sending || isGroupUnsupported) return;
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
    for (const p of paths) {
      try {
        await sendFile(activeBotId, selectedContact, p);
      } catch (e) {
        console.error('[wechat] attach error:', e);
      }
    }
    setSending(false);
  };

  if (!selectedContact) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm" style={{ color: 'rgb(var(--c-text-muted))' }}>选择一个联系人开始对话</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="px-4 py-3 border-b flex items-center gap-3" style={{ borderColor: 'rgb(var(--c-border))', background: 'rgb(var(--c-card))' }}>
        <button onClick={() => setSelectedContact(null)} className="p-1 rounded-md md:hidden" style={{ color: 'rgb(var(--c-text-muted))' }}>
          <ChevronLeft size={16} />
        </button>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {contact?.isGroup ? <Users size={14} style={{ color: 'rgb(var(--c-text-muted))' }} /> : <MessageSquare size={14} style={{ color: 'rgb(var(--c-text-muted))' }} />}
            <span className="text-sm font-medium truncate" style={{ color: 'rgb(var(--c-text))' }}>
              {displayName(selectedContact, nicknames)}
            </span>
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: 'rgb(var(--c-text-muted))' }}>
            {contact?.isGroup ? '当前微信插件暂不支持群聊，只能查看收到的群消息' : '单聊'}
          </div>
        </div>
        {hasRun && (
          <button
            onClick={() => { setShowRun((v) => !v); setUserToggledRun(true); }}
            className="ml-auto flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors hover:bg-sky-50"
            style={{ color: 'rgb(var(--c-text-muted))', borderColor: 'rgb(var(--c-border))' }}
            title="查看执行链"
          >
            <ListChecks size={13} />
            执行链
          </button>
        )}
        {!isGroupUnsupported && (
          <>
            <button
              onClick={() => activeBotId && selectedContact && triggerAiReply(activeBotId, selectedContact)}
              disabled={!activeBotId || !selectedContact}
              className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors hover:bg-sky-50 disabled:opacity-40"
              style={{ color: 'rgb(var(--c-text-muted))', borderColor: 'rgb(var(--c-border))' }}
              title="让鲲鹏读取最新消息并回复"
            >
              <Bot size={13} />
              AI 回复
            </button>
            <select
              value={replyMode}
              onChange={(e) => setReplyMode(activeBotId!, selectedContact, e.target.value as WechatReplyMode)}
              className="rounded-md border px-2 py-1 text-xs outline-none"
              style={{ color: 'rgb(var(--c-text-muted))', borderColor: 'rgb(var(--c-border))' }}
              title="本会话自动回复策略"
            >
              <option value="auto">自动回复</option>
              <option value="manual">手动处理</option>
              <option value="ignore">忽略消息</option>
            </select>
          </>
        )}
      </div>

      {showRun && hasRun && (
        <div className="border-b px-4 py-2" style={{ borderColor: 'rgb(var(--c-border))', background: 'rgb(var(--c-card))' }}>
          <RunStepTimeline compact showHeader runId={sessionRunId} />
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {contactMessages.map((msg, i) => (
          <MessageBubble key={msg.message_id || i} msg={msg} />
        ))}
        {currentStatus && (
          <div className="flex items-start gap-2 max-w-[80%]">
            <div className="rounded-xl px-3 py-2 text-sm animate-pulse" style={{ background: 'rgb(var(--c-card))', border: '1px solid rgb(var(--c-border))', color: 'rgb(var(--c-text-muted))' }}>
              {currentStatus.stage === 'thinking' && '正在分析...'}
              {currentStatus.stage === 'tool' && `执行工具: ${currentStatus.toolName || '...'}`}
              {currentStatus.stage === 'generating' && '正在生成回复...'}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="px-4 py-3 border-t" style={{ borderColor: 'rgb(var(--c-border))', background: 'rgb(var(--c-card))' }}>
        {isGroupUnsupported && (
          <div className="mb-2 rounded-lg border px-3 py-2 text-xs" style={{ color: 'rgb(var(--c-text-muted))', borderColor: 'rgb(var(--c-border))', background: 'rgb(var(--c-bg))' }}>
            当前微信插件暂不支持群聊发送或自动回复。这里仅展示收到的群消息。
          </div>
        )}
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'rgb(var(--c-card))', border: '1px solid rgb(var(--c-border))' }}>
          <button
            onClick={handleAttach}
            disabled={sending || isGroupUnsupported}
            className="p-1 rounded-md transition-opacity shrink-0"
            style={{ color: 'rgb(var(--c-text-muted))', opacity: sending || isGroupUnsupported ? 0.3 : 0.7 }}
            title="发送图片/文件"
          >
            <Paperclip size={15} />
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            disabled={isGroupUnsupported}
            placeholder={isGroupUnsupported ? '群聊暂不支持回复' : '输入回复...'}
            className="flex-1 bg-transparent text-sm focus:outline-none"
            style={{ color: 'rgb(var(--c-text))' }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending || isGroupUnsupported}
            className="p-1.5 rounded-md transition-opacity"
            style={{ opacity: input.trim() && !isGroupUnsupported ? 1 : 0.3, color: 'rgb(var(--c-text-muted))' }}
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main View ───────────────────────────────────────────────────────────────

export default function WechatView() {
  const bots = useWechatStore((s) => s.bots);
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar);
  const [showLogin, setShowLogin] = useState(false);

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
        {showLogin ? (
          <QrLoginOverlay onClose={() => setShowLogin(false)} />
        ) : !hasBots ? (
          <QrLoginOverlay />
        ) : (
          <>
            <ContactList onAddBot={() => setShowLogin(true)} />
            <ChatPanel />
          </>
        )}
      </div>
    </div>
  );
}
