import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, X, Loader2, Video, FolderOpen } from 'lucide-react';
import { invoke } from '@tauri-apps/api/tauri';
import { useBackgroundTaskStore, isTerminalTaskStatus, type BackgroundTask } from '@/stores/backgroundTaskStore';

const AUTO_DISMISS_MS = 10_000;

export default function BackgroundTaskToast() {
  const tasks = useBackgroundTaskStore((s) => s.tasks);
  const pendingCount = tasks.filter((t) => !isTerminalTaskStatus(t.status)).length;
  const unnotified = tasks.filter((t) => isTerminalTaskStatus(t.status) && !t.notified);

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-3 pointer-events-none max-w-[380px]">
      {/* Pending task indicator */}
      <AnimatePresence>
        {pendingCount > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="pointer-events-auto"
          >
            <PendingBadge count={pendingCount} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Completion toasts */}
      <AnimatePresence>
        {unnotified.map((task) => (
          <motion.div
            key={task.id}
            initial={{ opacity: 0, x: 80, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 80, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="pointer-events-auto"
          >
            <CompletionToast task={task} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ── Pending Badge ──────────────────────────────────────────────────────────────

function PendingBadge({ count }: { count: number }) {
  const [dismissed, setDismissed] = useState(false);
  const prevCount = useRef(count);
  useEffect(() => {
    if (count !== prevCount.current) setDismissed(false);
    prevCount.current = count;
  }, [count]);
  if (dismissed) return null;
  return (
    <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-[#1a1a2e]/90 backdrop-blur-xl border border-white/[0.06] shadow-lg shadow-black/20">
      <Loader2 size={14} className="text-indigo-400 animate-spin" />
      <span className="text-[13px] text-gray-300">
        {count} 个任务生成中…
      </span>
      <button onClick={() => setDismissed(true)} className="p-0.5 text-gray-500 hover:text-gray-300 transition-colors">
        <X size={12} />
      </button>
    </div>
  );
}

// ── Completion Toast ───────────────────────────────────────────────────────────

function CompletionToast({ task }: { task: BackgroundTask }) {
  const markNotified = useBackgroundTaskStore((s) => s.markNotified);
  const [progress, setProgress] = useState(100);

  const isSuccess = task.status === 'completed';

  // Auto-dismiss countdown
  useEffect(() => {
    const start = Date.now();
    const raf = () => {
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, 100 - (elapsed / AUTO_DISMISS_MS) * 100);
      setProgress(remaining);
      if (remaining > 0) {
        requestAnimationFrame(raf);
      } else {
        markNotified(task.id);
      }
    };
    const id = requestAnimationFrame(raf);
    return () => cancelAnimationFrame(id);
  }, [task.id, markNotified]);

  const handleDismiss = () => markNotified(task.id);

  const handleOpenFolder = () => {
    const path = task.resultPath || task.resultUrl;
    if (path) {
      invoke('open_path', { path }).catch(() => {});
    }
  };

  const glowColor = isSuccess ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';

  return (
    <div
      className="relative overflow-hidden rounded-2xl bg-[#1a1a2e]/95 backdrop-blur-xl border border-white/[0.06] shadow-2xl shadow-black/30"
      style={{ boxShadow: `0 8px 32px ${glowColor}, 0 2px 8px rgba(0,0,0,0.3)` }}
    >
      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white/[0.04]">
        <motion.div
          className={`h-full ${isSuccess ? 'bg-emerald-500/60' : 'bg-red-500/60'}`}
          initial={{ width: '100%' }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.1 }}
        />
      </div>

      <div className="px-4 py-3.5">
        {/* Header */}
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div
            className={`flex-shrink-0 mt-0.5 w-8 h-8 rounded-xl flex items-center justify-center ${
              isSuccess
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-red-500/15 text-red-400'
            }`}
          >
            {isSuccess ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Video size={12} className="text-gray-500 flex-shrink-0" />
              <span className={`text-[13px] font-medium ${isSuccess ? 'text-emerald-400' : 'text-red-400'}`}>
                {isSuccess ? '生成完成' : '生成失败'}
              </span>
            </div>
            <p className="text-[12px] text-gray-400 mt-1 leading-relaxed line-clamp-2">
              {task.description}
            </p>
            {task.error && (
              <p className="text-[11px] text-red-400/80 mt-1 line-clamp-1">
                {task.error}
              </p>
            )}
            {isSuccess && task.nodeId && (
              <p className="text-[11px] text-emerald-400/80 mt-1">
                已写回画布节点
              </p>
            )}
          </div>

          {/* Close */}
          <button
            onClick={handleDismiss}
            className="flex-shrink-0 p-1 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/[0.06] transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* Action */}
        {isSuccess && (task.resultPath || task.resultUrl) && (
          <div className="mt-2.5 ml-11">
            <button
              onClick={handleOpenFolder}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-white/[0.06] text-gray-300 hover:bg-white/[0.1] hover:text-white transition-colors"
            >
              <FolderOpen size={12} />
              打开文件夹
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
