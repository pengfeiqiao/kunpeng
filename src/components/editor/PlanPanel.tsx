/**
 * PlanPanel — AI 剪辑计划卡片流（OpenStoryline 式可干预提案）。
 * agent timeline_propose_plan 写入 store.plan 后自动弹出；用户逐卡复核：
 * 换素材 / 改入出点 / 拒绝恢复 / 对 AI 说；底部一键全部应用或重新规划。
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Film, RefreshCw, Replace, Sparkles, Trash2, Undo2, X } from 'lucide-react';
import { open as openDialog } from '@tauri-apps/api/dialog';
import { useEditorStore, type PlanShot } from '@/stores/editorStore';
import { useVideoThumb } from '@/lib/canvas/videoThumbs';
import { captureEditorSnapshot } from '@/lib/editor/editorHistory';
import { applyPendingPlanShots } from '@/lib/editor/planApply';
import { dispatchEditorPrompt } from './EditorChatPanel';

export default function PlanPanel() {
  const plan = useEditorStore((s) => s.plan);
  const open = useEditorStore((s) => s.planPanelOpen);
  const setOpen = useEditorStore((s) => s.setPlanPanelOpen);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState('');

  const pending = plan?.shots.filter((x) => x.status === 'pending') ?? [];
  const totalSec = pending.reduce((a, s) => a + (s.outSec - s.inSec), 0);

  const handleApplyAll = async () => {
    if (!plan || applying || pending.length === 0) return;
    setApplying(true);
    setApplyError('');
    try {
      captureEditorSnapshot();
      const r = await applyPendingPlanShots();
      if (r.failures.length > 0) {
        setApplyError(`${r.failures.length} 镜失败：${r.failures.map((f) => `${f.label}（${f.reason}）`).join('；')}`);
      }
    } finally {
      setApplying(false);
    }
  };

  const handleReplan = () => {
    dispatchEditorPrompt(
      `当前剪辑计划「${plan?.title ?? ''}」不满意，请先 timeline_get_state 了解时间轴，再读取现有计划（含被拒绝镜头的理由），重新 timeline_propose_plan 提出改进版本。`,
    );
  };

  return (
    <AnimatePresence>
      {open && plan && (
        <motion.div
          initial={{ x: 24, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 24, opacity: 0 }}
          transition={{ type: 'tween', duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
          className="absolute right-3 top-12 bottom-3 w-[340px] z-30 flex flex-col rounded-2xl overflow-hidden"
          style={{
            background: 'rgba(20,21,24,0.96)',
            border: '1px solid rgba(255,255,255,0.07)',
            boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
          }}
        >
          {/* 头部 */}
          <div className="flex items-center justify-between px-3.5 py-2.5 shrink-0 border-b border-[rgba(255,255,255,0.06)]">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-[var(--canvas-text-1)] truncate">{plan.title}</p>
              <p className="text-[10px] text-[var(--canvas-text-3)] mt-0.5">
                {plan.shots.length} 镜 · 待应用 {pending.length} · 约 {totalSec.toFixed(1)}s
              </p>
            </div>
            <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] transition-colors">
              <X size={14} />
            </button>
          </div>

          {/* 卡片流 */}
          <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2">
            {plan.shots.map((shot, i) => <ShotCard key={shot.id} shot={shot} index={i} />)}
          </div>

          {/* 底部操作 */}
          <div className="shrink-0 border-t border-[rgba(255,255,255,0.06)]">
            {applyError && (
              <div className="px-3 pt-2 text-[10px] text-red-300 leading-snug">{applyError}</div>
            )}
            <div className="flex gap-2 p-2.5">
            <button
              onClick={handleReplan}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] text-[var(--canvas-text-2)] border border-[var(--canvas-node-border)] hover:text-[var(--canvas-text-1)] transition-colors"
            >
              <RefreshCw size={12} /> 重新规划
            </button>
            <button
              onClick={() => void handleApplyAll()}
              disabled={applying || pending.length === 0}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-medium text-black bg-white hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              <Check size={13} /> {applying ? '应用中…' : `全部应用到时间轴（${pending.length}）`}
            </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ShotCard({ shot, index }: { shot: PlanShot; index: number }) {
  const updatePlanShot = useEditorStore((s) => s.updatePlanShot);
  const thumb = useVideoThumb(shot.sourcePath);
  const [askAi, setAskAi] = useState('');
  const rejected = shot.status === 'rejected';
  const applied = shot.status === 'applied';

  const handleReplace = async () => {
    const file = await openDialog({ filters: [{ name: '视频', extensions: ['mp4', 'mov', 'webm'] }] });
    if (!file || Array.isArray(file)) return;
    updatePlanShot(shot.id, { sourcePath: file });
  };

  const handleAskAi = () => {
    const text = askAi.trim();
    if (!text) return;
    setAskAi('');
    dispatchEditorPrompt(
      `针对剪辑计划镜头卡 [${shot.id}]「${shot.label}」（素材 ${shot.sourcePath.split('/').pop()}，${shot.inSec.toFixed(1)}-${shot.outSec.toFixed(1)}s，理由：${shot.reason}）：${text}\n请用 timeline_update_plan_shot 调整这张卡（必要时先 timeline_analyze_media 看素材内容）。`,
    );
  };

  return (
    <div
      className="rounded-xl overflow-hidden border transition-opacity"
      style={{
        background: 'rgba(255,255,255,0.03)',
        borderColor: applied ? 'rgba(74,222,128,0.35)' : 'var(--canvas-node-border)',
        opacity: rejected ? 0.45 : 1,
      }}
    >
      <div className="flex gap-2.5 p-2">
        {/* 缩略图 */}
        <div className="w-[88px] h-[50px] rounded-lg overflow-hidden bg-black/40 shrink-0 flex items-center justify-center">
          {thumb
            ? <img src={thumb} alt="" className="w-full h-full object-cover" />
            : <Film size={16} className="text-[var(--canvas-text-3)]" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-[var(--canvas-text-3)]">{index + 1}</span>
            <p className={`flex-1 text-[12px] font-medium truncate ${rejected ? 'line-through' : ''} text-[var(--canvas-text-1)]`}>{shot.label}</p>
            {applied && <span className="text-[9px] text-green-400 shrink-0">已应用</span>}
          </div>
          <p className="text-[10px] text-[var(--canvas-text-3)] truncate mt-0.5" title={shot.sourcePath}>
            {shot.sourcePath.split('/').pop()}
          </p>
          {/* 入出点 inline 编辑 */}
          <div className="flex items-center gap-1 mt-1">
            <RangeInput value={shot.inSec} onChange={(v) => updatePlanShot(shot.id, { inSec: v })} disabled={applied} />
            <span className="text-[10px] text-[var(--canvas-text-3)]">–</span>
            <RangeInput value={shot.outSec} onChange={(v) => updatePlanShot(shot.id, { outSec: v })} disabled={applied} />
            <span className="text-[9px] text-[var(--canvas-text-3)] ml-0.5">{(shot.outSec - shot.inSec).toFixed(1)}s</span>
            <div className="flex-1" />
            {!applied && (
              <>
                <button onClick={() => void handleReplace()} className="p-1 rounded text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-1)] transition-colors" title="换素材">
                  <Replace size={11} />
                </button>
                {rejected ? (
                  <button onClick={() => updatePlanShot(shot.id, { status: 'pending' })} className="p-1 rounded text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-1)] transition-colors" title="恢复">
                    <Undo2 size={11} />
                  </button>
                ) : (
                  <button onClick={() => updatePlanShot(shot.id, { status: 'rejected' })} className="p-1 rounded text-[var(--canvas-text-3)] hover:text-red-400 transition-colors" title="拒绝此镜">
                    <Trash2 size={11} />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      {/* 理由 */}
      <p className="px-2.5 pb-1.5 text-[10px] leading-relaxed text-[var(--canvas-text-2)]" title={shot.reason}>{shot.reason}</p>
      {/* 对 AI 说 */}
      {!applied && !rejected && (
        <div className="flex items-center gap-1.5 px-2 pb-2">
          <Sparkles size={11} className="text-[var(--canvas-text-3)] shrink-0" />
          <input
            value={askAi}
            onChange={(e) => setAskAi(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAskAi(); }}
            placeholder="对 AI 说：这镜改成…"
            className="flex-1 bg-transparent text-[11px] text-[var(--canvas-text-1)] placeholder:text-[var(--canvas-text-3)] focus:outline-none border-b border-[rgba(255,255,255,0.07)] focus:border-[rgba(255,255,255,0.25)] pb-0.5 transition-colors"
          />
        </div>
      )}
    </div>
  );
}

function RangeInput({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <input
      type="number"
      step={0.1}
      min={0}
      value={Number(value.toFixed(1))}
      disabled={disabled}
      onChange={(e) => onChange(Math.max(0, Number(e.target.value)))}
      className="w-[52px] px-1 py-0.5 rounded bg-[rgba(255,255,255,0.05)] border border-[var(--canvas-node-border)] text-[10px] font-mono text-[var(--canvas-text-1)] focus:outline-none focus:border-[rgba(255,255,255,0.3)] disabled:opacity-50"
    />
  );
}
