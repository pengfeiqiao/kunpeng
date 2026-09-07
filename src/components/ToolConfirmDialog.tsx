import { useEffect } from 'react';
import { useToolConfirmStore } from '@/stores/toolConfirmStore';
import { motion, AnimatePresence } from 'framer-motion';
import { Terminal, FileEdit, FilePlus2, Check, X, Sparkles, Image, Video, Music, FileText, Link2 } from 'lucide-react';

const TOOL_META: Record<string, { icon: typeof Terminal; label: string; accent: string; bg: string }> = {
  bash:       { icon: Terminal,  label: '执行命令',  accent: 'text-orange-400', bg: 'bg-orange-500/10' },
  write_file: { icon: FilePlus2, label: '创建文件',  accent: 'text-sky-400',    bg: 'bg-sky-500/10' },
  edit_file:  { icon: FileEdit,  label: '编辑文件',  accent: 'text-teal-400',   bg: 'bg-teal-500/10' },
};

const DEFAULT_META = { icon: Terminal, label: '执行工具', accent: 'text-gray-400', bg: 'bg-white/5' };

const REF_META = {
  image: { icon: Image, label: '图片' },
  video: { icon: Video, label: '视频' },
  audio: { icon: Music, label: '音频' },
  file: { icon: FileText, label: '文件' },
  link: { icon: Link2, label: '链接' },
} as const;

function shortName(value: string): string {
  const clean = value.split(/[?#]/)[0];
  const name = clean.split('/').filter(Boolean).pop();
  return name || value;
}

function formatParams(toolName: string, params: Record<string, unknown>): string {
  if (toolName === 'bash') return String(params.command || '');
  if (toolName === 'write_file' || toolName === 'edit_file') return String(params.path || '');
  return JSON.stringify(params, null, 2);
}

export function ToolConfirmDialog() {
  const queue = useToolConfirmStore((s) => s.pending);
  const total = useToolConfirmStore((s) => s.total);
  const current = queue[0];
  const pending = current?.payload;
  const approve = useToolConfirmStore((s) => s.approve);
  const reject = useToolConfirmStore((s) => s.reject);
  const approveAll = useToolConfirmStore((s) => s.approveAll);
  const generationGroup = queue.filter((item) => item.scope === current?.scope && item.payload.generationDraft);

  useEffect(() => {
    if (!current) return;
    const handler = (e: KeyboardEvent) => {
      if (e.repeat || e.isComposing) return;
      if (e.key === 'Enter' && !e.shiftKey && e.target === document.body) { e.preventDefault(); approve(current.id); }
      if (e.key === 'Escape') { e.preventDefault(); reject(current.id); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [current, approve, reject]);

  const meta = pending
    ? pending.generationDraft
      ? { icon: Sparkles, label: '开始生成', accent: 'text-sky-300', bg: 'bg-sky-400/10' }
      : (TOOL_META[pending.toolName] || DEFAULT_META)
    : null;

  return (
    <AnimatePresence>
      {pending && current && meta && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center pointer-events-auto"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.1 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => reject(current.id)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Dialog — centered, light-surfaced for readability */}
          <motion.div
            className="relative w-[560px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] rounded-xl overflow-hidden flex flex-col"
            style={{
              background: '#2c2c2e',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.1), 0 24px 48px -12px rgba(0,0,0,0.5)',
            }}
            initial={{ scale: 0.92, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 4 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* Icon + title */}
            <div className="pt-5 pb-3 px-5">
              <div className="flex items-start gap-3">
                <div className={`flex items-center justify-center w-9 h-9 rounded-xl ${meta.bg} flex-shrink-0`}>
                  {(() => {
                    const Icon = meta.icon;
                    return <Icon size={18} className={meta.accent} />;
                  })()}
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <h3 className="text-[14px] font-semibold text-white tracking-[-0.01em]">
                    鲲鹏想要{meta.label}
                  </h3>
                  <p className="mt-1 text-[12px] text-gray-400" aria-live="polite">第 {current.position}/{total} 条 · 待确认 {queue.length} 条</p>
                  {pending.reason && (
                    <p className="text-[12px] text-gray-400 mt-0.5">{pending.reason}</p>
                  )}
                </div>
              </div>
            </div>

            {/* 可读生成草稿 / 普通工具参数 */}
            <div className="px-5 pb-4 min-h-0 overflow-y-auto">
              {pending.generationDraft && generationGroup.length > 1 && (
                <details className="mb-3 rounded-lg border border-white/10 p-3 text-[13px] text-gray-200">
                  <summary className="cursor-pointer">本轮 {generationGroup.length} 项生成草稿</summary>
                  {generationGroup.map((item) => (
                    <details key={item.id} className="mt-2 border-t border-white/10 pt-2">
                      <summary className="cursor-pointer">第 {item.position} 项 · {item.payload.generationDraft?.engineId || item.payload.toolName} · {item.payload.generationDraft?.count} 个</summary>
                      <pre className="mt-2 whitespace-pre-wrap break-words text-[12px] text-gray-300">{JSON.stringify(item.payload.generationDraft, null, 2)}</pre>
                    </details>
                  ))}
                </details>
              )}
              {pending.generationDraft ? (
                <div className="space-y-3">
                  <section className="rounded-lg border border-white/[0.08] bg-[#1c1c1e] p-3">
                    <div className="mb-1.5 text-[11px] text-gray-400">完整提示词</div>
                    <div className="max-h-36 overflow-y-auto whitespace-pre-wrap break-words text-[13px] leading-5 text-gray-100">
                      {pending.generationDraft.prompt || '未提供提示词'}
                    </div>
                  </section>

                  {pending.generationDraft.references.length > 0 && (
                    <section>
                      <div className="mb-1.5 text-[11px] text-gray-400">引用素材与发送顺序</div>
                      <div className="space-y-1">
                        {pending.generationDraft.references.map((reference) => {
                          const refMeta = REF_META[reference.type];
                          const RefIcon = refMeta.icon;
                          return (
                            <div key={`${reference.type}-${reference.ordinal}-${reference.value}`} className="flex items-center gap-2 rounded-md bg-white/[0.04] px-2.5 py-2">
                              <RefIcon size={13} className="shrink-0 text-gray-400" />
                              <span className="shrink-0 text-[11px] text-sky-300">@{refMeta.label}{reference.ordinal}</span>
                              <span className="min-w-0 truncate text-[12px] text-gray-300" title={reference.value}>{shortName(reference.value)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  )}

                  <section className="grid grid-cols-2 gap-2 text-[12px]">
                    <div className="rounded-md bg-white/[0.04] px-2.5 py-2"><span className="text-gray-500">模型</span><div className="mt-0.5 truncate text-gray-200">{pending.generationDraft.engineId || '按当前路由'}</div></div>
                    <div className="rounded-md bg-white/[0.04] px-2.5 py-2"><span className="text-gray-500">数量</span><div className="mt-0.5 text-gray-200">{pending.generationDraft.count}</div></div>
                    <div className="rounded-md bg-white/[0.04] px-2.5 py-2"><span className="text-gray-500">预计费用</span><div className="mt-0.5 text-gray-200">{pending.generationDraft.estimatedCost || '提交后按渠道结算'}</div></div>
                    <div className="rounded-md bg-white/[0.04] px-2.5 py-2"><span className="text-gray-500">参数</span><div className="mt-0.5 truncate text-gray-200" title={JSON.stringify(pending.generationDraft.params)}>{Object.keys(pending.generationDraft.params).length ? JSON.stringify(pending.generationDraft.params) : '使用模型默认值'}</div></div>
                  </section>

                  <p className="rounded-md border border-amber-300/10 bg-amber-300/[0.05] px-2.5 py-2 text-[11px] leading-4 text-amber-100/70">
                    {pending.generationDraft.fallbackNotice || '提交状态不明确时不会重提或自动切换渠道，避免重复扣费。'}
                  </p>
                </div>
              ) : (
              <div className="rounded-xl overflow-hidden border border-white/[0.08]"
                style={{ background: '#1c1c1e' }}>
                <div className="flex items-center gap-1.5 px-3 py-1.5">
                  <span className="text-[11px] text-gray-400 font-mono tracking-wide uppercase">{pending.toolName}</span>
                </div>
                <div className="border-t border-white/[0.04]">
                  <pre className="px-3 py-2.5 text-[13px] text-gray-200 leading-relaxed max-h-40 overflow-y-auto overflow-x-auto whitespace-pre-wrap break-all font-mono selection:bg-white/10">
                    {formatParams(pending.toolName, pending.params)}
                  </pre>
                </div>
              </div>
              )}
            </div>

            {/* Divider */}
            <div className="h-px bg-white/[0.08]" />

            {/* Action bar */}
            <div className="flex flex-wrap items-center gap-y-2 px-5 py-3">
              <span className="text-[11px] text-gray-400 tracking-wide">
                <kbd className="px-1 py-0.5 rounded bg-white/[0.08] text-gray-300 text-[10px] font-mono">&#9166;</kbd>
                {' '}允许
                <span className="mx-1.5 text-gray-500">·</span>
                <kbd className="px-1 py-0.5 rounded bg-white/[0.08] text-gray-300 text-[10px] font-mono">esc</kbd>
                {' '}拒绝
              </span>

              <div className="flex-1" />
              {pending.generationDraft && generationGroup.length > 1 && (
                <button
                  onClick={() => approveAll(current.id, generationGroup.map((item) => item.id))}
                  className="mr-2 rounded-lg border border-teal-300/30 px-3 py-1.5 text-[13px] text-teal-200 hover:bg-teal-300/10"
                >
                  全部确认（{generationGroup.length}）
                </button>
              )}

              <button
                onClick={() => reject(current.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] text-gray-400 hover:text-gray-200 hover:bg-white/[0.05] transition-all duration-150 mr-2"
              >
                <X size={14} />
                拒绝
              </button>
              <button
                onClick={() => approve(current.id)}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[13px] font-medium text-white transition-all duration-150"
                style={{
                  background: 'linear-gradient(to bottom, rgba(99,102,241,0.8), rgba(79,70,229,0.9))',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.1)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(to bottom, rgba(99,102,241,0.95), rgba(79,70,229,1))';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(to bottom, rgba(99,102,241,0.8), rgba(79,70,229,0.9))';
                }}
              >
                <Check size={14} />
                {queue.length > 1 ? '确认本项' : '允许'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
