/**
 * TaskQueuePanel — bottom-right drawer listing canvas generation tasks
 * (running / queued / finished), with retry & cancel. Mirrors the
 * task-queue pattern from TapNow/LibTV: progress lives on the canvas, the
 * panel is the overview.
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ListTodo, X, RotateCcw, Square, Trash2, Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { useCanvasTaskStore, type CanvasTask } from '@/stores/canvasTaskStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useWorkshopStore } from '@/stores/workshopStore';
import { generateForNode, abortCanvasTask, runGeneration } from '@/lib/canvasGen';
import { collectNodeReferences, selfVideoFallback } from '@/lib/canvas/collectRefs';
import { mergeCanvasNodeGenerationParams } from '@/lib/canvas/generationParams';

const ACTIVE_STATUSES = ['queued', 'uploading', 'running', 'downloading'];

function retryEngineId(task: CanvasTask): string {
  if (task.engineId.startsWith('api:')) {
    return task.engineId.includes('seedream-v5-pro') ? 'seedream-v5-pro' : 'gpt-image-2';
  }
  if (task.engineId.includes('seedream-v5-pro')) return 'seedream-v5-pro';
  if (task.engineId.startsWith('gpt-image')) return 'gpt-image-2';
  return task.engineId;
}

function StatusIcon({ task }: { task: CanvasTask }) {
  switch (task.status) {
    case 'succeeded': return <CheckCircle2 size={13} className="text-emerald-500" />;
    case 'failed': return <XCircle size={13} className="text-red-400" />;
    case 'queued': return <Clock size={13} className="text-[var(--canvas-text-2)]" />;
    default: return <Loader2 size={13} className="animate-spin text-indigo-400" />;
  }
}

function TaskRow({ task }: { task: CanvasTask }) {
  const removeTask = useCanvasTaskStore((s) => s.removeTask);
  const setSelectedNodeId = useCanvasStore((s) => s.setSelectedNodeId);
  const isActive = ACTIVE_STATUSES.includes(task.status);

  const handleRetry = () => {
    removeTask(task.id);
    if (task.workshopStoryboardFrameId) {
      // 故事板格子任务：直接重跑该格子的生成，绝不能落到 generateShot——
      // 那会用分镜主提示词覆盖整镜首帧图（imagePath）。
      void runGeneration({
        engineId: retryEngineId(task),
        prompt: task.prompt,
        referenceUrls: task.referenceUrls,
        params: task.params,
        projectId: task.projectId,
        workshopShotNo: task.workshopShotNo,
        workshopShotKind: task.workshopShotKind ?? 'image',
        workshopStoryboardFrameId: task.workshopStoryboardFrameId,
      });
    } else if (task.workshopShotNo) {
      void useWorkshopStore.getState().generateShot(task.workshopShotNo, task.workshopShotKind ?? 'image');
    } else {
      // 从节点重新收集参考素材：必须与 NodeInfoBar / canvas_generate 同源，
      // 否则重试会漏掉组图、音频、视频和工坊局部参考节点。
      const collected = collectNodeReferences(task.nodeId);
      const referenceUrls = collected.images.map((r) => r.submitUrl);
      const audioUrls = collected.audios.map((r) => r.submitUrl);
      const videoUrls = selfVideoFallback(task.nodeId, collected).slice(0, 1);
      const node = useCanvasStore.getState().nodes.find((item) => item.id === task.nodeId);
      const retryParams = mergeCanvasNodeGenerationParams(
        task.kind,
        (node?.data ?? {}) as Record<string, unknown>,
        (task.params ?? {}) as Record<string, string | number | boolean>,
      );
      void generateForNode({
        nodeId: task.nodeId,
        engineId: task.engineId,
        prompt: task.prompt,
        ...(referenceUrls.length > 0 ? { referenceUrls } : {}),
        ...(audioUrls.length > 0 ? { audioUrls } : {}),
        ...(videoUrls.length > 0 ? { videoUrls } : {}),
        params: retryParams,
        overwrite: true,
      });
    }
  };

  const handleLocate = () => {
    if (task.nodeId) setSelectedNodeId(task.nodeId);
  };

  return (
    <div className="flex items-start gap-2 px-3 py-2 border-b border-[var(--canvas-node-border)] last:border-0 hover:bg-[var(--canvas-controls-hover)] group">
      <div className="mt-0.5 shrink-0"><StatusIcon task={task} /></div>
      <button
        className="flex-1 min-w-0 text-left"
        onClick={handleLocate}
        title={task.workshopShotNo ? `工坊分镜 ${task.workshopShotNo}` : '定位节点'}
      >
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium text-[var(--canvas-text-1)]">{task.engineLabel}</span>
          {task.fallbackUsed && (
            <span className="text-[9px] px-1 rounded bg-amber-50 text-amber-600 border border-amber-200">降级</span>
          )}
        </div>
        <p className="text-[11px] text-[var(--canvas-text-2)] truncate">{task.prompt}</p>
        {task.progress && isActive && (
          <p className="text-[10px] text-indigo-400">{task.progress}</p>
        )}
        {task.error && (
          <p className="text-[10px] text-red-400 line-clamp-2">{task.error}</p>
        )}
      </button>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {task.status === 'failed' && (
          <button onClick={handleRetry} className="p-1 rounded hover:bg-[var(--canvas-controls-active)] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)]" title="重试">
            <RotateCcw size={12} />
          </button>
        )}
        {isActive && (
          <button onClick={() => abortCanvasTask(task.id)} className="p-1 rounded hover:bg-[var(--canvas-controls-active)] text-[var(--canvas-text-2)] hover:text-red-500" title="取消">
            <Square size={12} />
          </button>
        )}
        {!isActive && (
          <button onClick={() => removeTask(task.id)} className="p-1 rounded hover:bg-[var(--canvas-controls-active)] text-[var(--canvas-text-2)] hover:text-red-500" title="移除记录">
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

export default function TaskQueuePanel() {
  const tasks = useCanvasTaskStore((s) => s.tasks);
  const clearFinished = useCanvasTaskStore((s) => s.clearFinished);
  const [open, setOpen] = useState(false);

  const activeCount = tasks.filter((t) => ACTIVE_STATUSES.includes(t.status)).length;
  if (tasks.length === 0) return null;

  return (
    // right-20 keeps clear of the CanvasChatBubble pinned at bottom-5 right-5
    <div className="absolute bottom-4 right-20 z-20 flex flex-col items-end gap-2">
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            className="w-[320px] max-h-[360px] overflow-hidden flex flex-col bg-[var(--canvas-panel)] rounded-xl border border-[var(--canvas-node-border)] shadow-xl"
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--canvas-node-border)]">
              <span className="text-[12px] font-medium text-[var(--canvas-text-1)]">
                生成任务 {activeCount > 0 && <span className="text-indigo-500">· {activeCount} 进行中</span>}
              </span>
              <div className="flex items-center gap-1">
                <button onClick={clearFinished} className="text-[10px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] px-1.5 py-0.5 rounded hover:bg-[var(--canvas-controls-hover)]">
                  清除已完成
                </button>
                <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-[var(--canvas-controls-hover)] text-[var(--canvas-text-2)]">
                  <X size={13} />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto">
              {[...tasks].reverse().map((t) => <TaskRow key={t.id} task={t} />)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[var(--canvas-panel)] border border-[var(--canvas-node-border)] shadow-md hover:shadow-lg text-[var(--canvas-text-1)] transition-shadow"
        title="生成任务队列"
      >
        {activeCount > 0
          ? <Loader2 size={14} className="animate-spin text-indigo-500" />
          : <ListTodo size={14} className="text-[var(--canvas-text-2)]" />}
        <span className="text-[12px] font-medium">
          {activeCount > 0 ? `${activeCount} 个任务` : '任务'}
        </span>
      </button>
    </div>
  );
}
