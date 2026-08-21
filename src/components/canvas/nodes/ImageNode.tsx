import { memo, useEffect, useState } from 'react';
import { Handle, Position, NodeResizer } from 'reactflow';
import type { NodeProps } from 'reactflow';
import { useCanvasStore } from "@/stores/canvasStore";
import { Bot, ImageIcon, Loader2, Sparkles, Upload } from 'lucide-react';
import { useCanvasTaskStore } from '@/stores/canvasTaskStore';
import type { ImageNodeData } from '@/types/canvas';
import { open as openDialog } from '@tauri-apps/api/dialog';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import ImageNodeToolbar from '../ImageNodeToolbar';
import ProgressRing from './ProgressRing';
import NodeParamBadge from './NodeParamBadge';
import NodeToolbarPortal from '../NodeToolbarPortal';
import { openCanvasNodeInAgent } from '@/lib/canvas/nodeAgent';

const ACTIVE = ['queued', 'uploading', 'running', 'downloading'];
const HIGHLIGHT_MS = 2600;

/** True for ~2.6s after data.justCompletedAt — drives the breathing outline. */
export function useJustCompleted(justCompletedAt: number | undefined): boolean {
  const [active, setActive] = useState(
    () => Boolean(justCompletedAt && Date.now() - justCompletedAt < HIGHLIGHT_MS),
  );
  useEffect(() => {
    if (!justCompletedAt) return;
    const remaining = HIGHLIGHT_MS - (Date.now() - justCompletedAt);
    if (remaining <= 0) { setActive(false); return; }
    setActive(true);
    const t = setTimeout(() => setActive(false), remaining);
    return () => clearTimeout(t);
  }, [justCompletedAt]);
  return active;
}

function ImageNodeComponent({ id, data, selected }: NodeProps<ImageNodeData>) {
  const updateNode = useCanvasStore((s) => s.updateNode);
  const isGenerating = data.isGenerating || false;
  const isI2I = data.generationMode === 'image-to-image';
  const displayUrl = data.generatedImageUrl || data.referenceImage || '';  // filter falsy
  // In-place progress from the task queue (rhtv chain).
  const activeTask = useCanvasTaskStore((s) => {
    const t = [...s.tasks].reverse().find((x) => x.nodeId === id && ACTIVE.includes(x.status));
    return t ? { progress: t.progress, engineId: t.engineId, createdAt: t.createdAt } : null;
  });
  const progressLabel = activeTask?.progress || '生成中...';
  const justCompleted = useJustCompleted((data as Record<string, unknown>).justCompletedAt as number | undefined);

  const handleReplace = async () => {
    const file = await openDialog({ filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
    if (!file || Array.isArray(file)) return;
    updateNode(id, { generatedImageUrl: convertFileSrc(file), localPath: file, isUploadedImage: true });
  };

  return (
    // width:100% lets the node follow the wrapper width that NodeResizer
    // writes to node.style — a hardcoded 160 made resizing visually no-op.
    // minWidth keeps fresh (unsized) nodes at the old default footprint.
    <div
      className={`relative group h-full ${isGenerating ? 'flowing-border' : ''} ${justCompleted ? 'node-new-highlight' : ''}`}
      style={{ width: '100%', height: '100%', minWidth: 200, minHeight: displayUrl ? 160 : 150 }}
    >
      {/* 节点外左上角标题 */}
      <div className="absolute -top-6 left-0.5 flex items-center gap-1.5 pointer-events-none">
        <ImageIcon size={11} className="text-[var(--canvas-text-3)]" />
        <span className="text-[11px] text-[var(--canvas-text-3)] font-medium">{isI2I ? '图生图' : 'Image'}</span>
      </div>

      {selected && displayUrl && (
        <ImageNodeToolbar nodeId={id} imageUrl={displayUrl} />
      )}
      {selected && !displayUrl && (
        <NodeToolbarPortal nodeId={id}>
          <button
            onClick={() => openCanvasNodeInAgent(id)}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-neutral-900/95 px-3 py-2 text-[11px] text-white shadow-xl transition-colors hover:bg-neutral-800"
            title="把当前图片节点交给 Agent 操作"
          >
            <Bot size={14} /> 交给 Agent
          </button>
        </NodeToolbarPortal>
      )}

      {selected && (
        <NodeResizer
          color="#a8a8a8"
          isVisible={selected}
          minWidth={200}
          minHeight={80}
          keepAspectRatio={Boolean(displayUrl)}
          handleStyle={{ backgroundColor: '#a8a8a8', border: '1px solid #141414', borderRadius: '50%', width: 6, height: 6 }}
          lineStyle={{ borderColor: '#a8a8a8', borderWidth: 1, borderStyle: 'dashed' }}
        />
      )}

      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      {displayUrl && !isGenerating && (
        <button
          onClick={(e) => { e.stopPropagation(); void handleReplace(); }}
          className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium text-white opacity-0 group-hover:opacity-100 transition-all hover:brightness-125"
          style={{ background: 'rgba(28,28,32,0.88)', backdropFilter: 'blur(12px)', boxShadow: '0 2px 10px rgba(0,0,0,0.35)' }}
          title="替换图片"
        >
          <Upload size={13} /> 替换
        </button>
      )}

      <div
        className={`rounded-2xl overflow-hidden transition-all duration-200 ${
          selected ? 'shadow-[0_0_0_1.5px_rgba(255,255,255,0.7),0_4px_24px_rgba(0,0,0,0.35)]' : 'shadow-sm hover:shadow-[0_1px_4px_1px_rgba(255,255,255,0.08)]'
        }`}
        style={{ width: '100%', height: '100%', minHeight: displayUrl ? 160 : 150, background: 'var(--canvas-node-bg)', border: `1px solid ${selected ? 'transparent' : 'var(--canvas-node-border)'}` }}
      >
        {displayUrl && !isGenerating ? (
          <img src={displayUrl} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover block" />
        ) : displayUrl && isGenerating ? (
          <div className="relative w-full h-full min-h-[160px]">
            <img src={displayUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover opacity-40 block" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center gap-1.5">
                {activeTask
                  ? <ProgressRing engineId={activeTask.engineId} startedAt={activeTask.createdAt} size={32} />
                  : <Loader2 size={20} className="animate-spin text-[var(--canvas-text-2)]" />}
                <span className="text-[9px] text-[var(--canvas-text-2)]">{progressLabel}</span>
              </div>
            </div>
          </div>
        ) : isGenerating ? (
          <div className="relative w-full h-full min-h-[150px]">
            <div className="absolute inset-0 cv-shimmer" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center gap-1.5">
                {activeTask
                  ? <ProgressRing engineId={activeTask.engineId} startedAt={activeTask.createdAt} size={28} />
                  : <Loader2 size={18} className="animate-spin text-[var(--canvas-text-2)]" />}
                <span className="text-[9px] text-[var(--canvas-text-2)]">{progressLabel}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center w-full h-full min-h-[150px]">
            <div className="text-center px-4">
              {isI2I ? <Sparkles size={24} className="text-[var(--canvas-text-3)] mx-auto" /> : <ImageIcon size={24} className="text-[var(--canvas-text-3)] mx-auto" />}
              {isI2I && <div className="text-[10px] text-[var(--canvas-text-3)] mt-2">已连接参考图</div>}
            </div>
          </div>
        )}
        <NodeParamBadge data={data as Record<string, unknown>} />
      </div>
    </div>
  );
}

export default memo(ImageNodeComponent);
