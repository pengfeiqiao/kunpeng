import { useEffect } from 'react';
import { useToolConfirmStore } from '@/stores/toolConfirmStore';
import { motion, AnimatePresence } from 'framer-motion';
import { Terminal, FileEdit, FilePlus2, Check, X } from 'lucide-react';

const TOOL_META: Record<string, { icon: typeof Terminal; label: string; accent: string; bg: string }> = {
  bash:       { icon: Terminal,  label: '执行命令',  accent: 'text-orange-400', bg: 'bg-orange-500/10' },
  write_file: { icon: FilePlus2, label: '创建文件',  accent: 'text-sky-400',    bg: 'bg-sky-500/10' },
  edit_file:  { icon: FileEdit,  label: '编辑文件',  accent: 'text-teal-400',   bg: 'bg-teal-500/10' },
};

const DEFAULT_META = { icon: Terminal, label: '执行工具', accent: 'text-gray-400', bg: 'bg-white/5' };

function formatParams(toolName: string, params: Record<string, unknown>): string {
  if (toolName === 'bash') return String(params.command || '');
  if (toolName === 'write_file' || toolName === 'edit_file') return String(params.path || '');
  return JSON.stringify(params, null, 2);
}

export function ToolConfirmDialog() {
  const pending = useToolConfirmStore((s) => s.pending);
  const approve = useToolConfirmStore((s) => s.approve);
  const reject = useToolConfirmStore((s) => s.reject);

  useEffect(() => {
    if (!pending) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); approve(); }
      if (e.key === 'Escape') { e.preventDefault(); reject(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [pending, approve, reject]);

  const meta = pending ? (TOOL_META[pending.toolName] || DEFAULT_META) : null;

  return (
    <AnimatePresence>
      {pending && meta && (
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
            onClick={reject}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Dialog — centered, light-surfaced for readability */}
          <motion.div
            className="relative w-[420px] max-w-[calc(100vw-2rem)] rounded-2xl overflow-hidden"
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
                  {pending.reason && (
                    <p className="text-[12px] text-gray-400 mt-0.5">{pending.reason}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Code block */}
            <div className="px-5 pb-4">
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
            </div>

            {/* Divider */}
            <div className="h-px bg-white/[0.08]" />

            {/* Action bar */}
            <div className="flex items-center px-5 py-3">
              <span className="text-[11px] text-gray-400 tracking-wide">
                <kbd className="px-1 py-0.5 rounded bg-white/[0.08] text-gray-300 text-[10px] font-mono">&#9166;</kbd>
                {' '}允许
                <span className="mx-1.5 text-gray-500">·</span>
                <kbd className="px-1 py-0.5 rounded bg-white/[0.08] text-gray-300 text-[10px] font-mono">esc</kbd>
                {' '}拒绝
              </span>

              <div className="flex-1" />

              <button
                onClick={reject}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] text-gray-400 hover:text-gray-200 hover:bg-white/[0.05] transition-all duration-150 mr-2"
              >
                <X size={14} />
                拒绝
              </button>
              <button
                onClick={approve}
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
                允许
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
