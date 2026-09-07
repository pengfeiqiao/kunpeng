import { useState } from 'react';
import { ChevronDown, ChevronUp, AlertCircle, Loader2 } from 'lucide-react';
import { useCanvasTaskStore } from '@/stores/canvasTaskStore';
import './workspace.css';

const ACTIVE = new Set(['queued', 'uploading', 'running', 'downloading']);
const STATUS_LABEL: Record<string, string> = {
  queued: '排队中', uploading: '上传参考中', running: '生成中', downloading: '下载结果中', failed: '失败',
};

/** Per-task progress strip for the workspace, restoring the old workshop generation visibility. */
export default function WorkspaceTaskStrip({ projectId }: { projectId: string }) {
  const tasks = useCanvasTaskStore((state) => state.tasks);
  const [open, setOpen] = useState(true);
  const related = tasks.filter((task) => task.workspaceBinding?.snapshot.projectId === projectId);
  const active = related.filter((task) => ACTIVE.has(task.status));
  const failed = related.filter((task) => task.status === 'failed');
  if (!active.length && !failed.length) return null;
  const failedShown = failed.slice(-3);
  return <section className="workspace-task-strip" aria-label="生成任务进度">
    <button className="workspace-task-strip-heading" aria-expanded={open} onClick={() => setOpen(!open)}>
      {active.length > 0 ? <Loader2 size={13} className="workspace-task-spin" /> : <AlertCircle size={13} />}
      <span>{active.length > 0 ? `${active.length} 个生成任务进行中` : '生成任务'}</span>
      {failed.length > 0 && <span className="workspace-task-failed-count">{failed.length} 失败/中断</span>}
      {open ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
    </button>
    {open && <div className="workspace-task-strip-list">
      {active.map((task) => <div key={task.id} className="workspace-task-row" role="status">
        <span className="workspace-task-kind">{task.kind === 'image' ? '图片' : task.kind === 'video' ? '视频' : '音频'}</span>
        <span className="workspace-task-engine">{task.engineLabel}</span>
        <span className="workspace-task-status">{STATUS_LABEL[task.status] ?? task.status}</span>
        {task.progress && <span className="workspace-task-progress">{task.progress}</span>}
      </div>)}
      {failedShown.map((task) => <div key={task.id} className="workspace-task-row workspace-task-failed" role="alert">
        <span className="workspace-task-kind">{task.kind === 'image' ? '图片' : task.kind === 'video' ? '视频' : '音频'}</span>
        <span className="workspace-task-engine">{task.engineLabel}</span>
        <span className="workspace-task-error">{task.error || '任务失败'}</span>
      </div>)}
      {failed.length > 0 && <p className="workspace-task-hint">失败或中断的任务不会自动重提；核对后可回到对应镜头重新生成。</p>}
    </div>}
  </section>;
}
