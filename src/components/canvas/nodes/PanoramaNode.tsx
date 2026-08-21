/**
 * PanoramaNode — 3D 世界节点：提示词生成 360° 全景图（equirect 2:1），
 * 有图时球面内壁拖拽预览（three.js lazy），可一键设为导演台背景。
 */
import { memo, useEffect, useRef, useState } from 'react';
import { Handle, Position, NodeResizer } from 'reactflow';
import type { NodeProps } from 'reactflow';
import { Bot, Globe2, Loader2, Video, Download, Trash2, Maximize2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/tauri';
import { useCanvasStore } from '@/stores/canvasStore';
import { useCanvasTaskStore } from '@/stores/canvasTaskStore';
import ProgressRing from './ProgressRing';
import { useJustCompleted } from './ImageNode';
import { openCanvasNodeInAgent } from '@/lib/canvas/nodeAgent';
import { useHasMultiNodeSelection } from '../NodeToolbarPortal';

const ACTIVE = ['queued', 'uploading', 'running', 'downloading'];

export interface PanoramaNodeData {
  description?: string;
  panoramaUrl?: string;
  localPath?: string;
  isGenerating?: boolean;
  justCompletedAt?: number;
}

function PanoramaNodeComponent({ id, data, selected }: NodeProps<PanoramaNodeData>) {
  const hasMultiSelection = useHasMultiNodeSelection();
  const isGenerating = data.isGenerating || false;
  const deleteNode = useCanvasStore((s) => s.deleteNode);
  const activeTask = useCanvasTaskStore((s) => {
    const t = [...s.tasks].reverse().find((x) => x.nodeId === id && ACTIVE.includes(x.status));
    return t ? { progress: t.progress, engineId: t.engineId, createdAt: t.createdAt } : null;
  });
  const justCompleted = useJustCompleted(data.justCompletedAt);
  const viewerRef = useRef<HTMLDivElement>(null);
  const [viewerReady, setViewerReady] = useState(false);

  // 懒加载球面预览
  useEffect(() => {
    if (!data.panoramaUrl || !viewerRef.current || isGenerating) return;
    let dispose: (() => void) | null = null;
    let alive = true;
    void (async () => {
      const { mountPanoViewer } = await import('@/lib/canvas/panoViewer');
      if (!alive || !viewerRef.current) return;
      dispose = mountPanoViewer(viewerRef.current, data.panoramaUrl!);
      setViewerReady(true);
    })();
    return () => { alive = false; dispose?.(); setViewerReady(false); };
  }, [data.panoramaUrl, isGenerating]);

  const handleSetDirectorBg = () => {
    if (!data.localPath) return;
    void import('@/stores/directorStore').then(({ useDirectorStore }) => {
      useDirectorStore.getState().setPanorama(data.localPath!);
      window.dispatchEvent(new CustomEvent('kunpeng-open-director'));
    });
  };

  const handleDownload = async () => {
    if (!data.localPath) return;
    await invoke('save_file_dialog', { sourcePath: data.localPath, defaultName: `panorama-${Date.now()}.png` }).catch(() => {});
  };

  return (
    <div
      className={`relative group w-full ${isGenerating ? 'flowing-border' : ''} ${justCompleted ? 'node-new-highlight' : ''}`}
      style={{ minWidth: 280 }}
    >
      {/* 节点外左上角标题 */}
      <div className="absolute -top-6 left-0.5 flex items-center gap-1.5 pointer-events-none">
        <Globe2 size={11} className="text-[var(--canvas-text-3)]" />
        <span className="text-[11px] text-[var(--canvas-text-3)] font-medium">3D World</span>
      </div>

      {/* 选中工具条 */}
      {selected && !hasMultiSelection && (
        <div
          className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1.5 rounded-2xl z-10"
          style={{ bottom: '100%', marginBottom: 8, background: 'rgba(38,38,38,0.92)', backdropFilter: 'blur(12px)', boxShadow: '0 2px 12px rgba(0,0,0,0.2), 0 0 0 1px rgba(255,255,255,0.08)' }}
        >
          <button onClick={() => openCanvasNodeInAgent(id)} className="flex flex-col items-center gap-1.5 px-3.5 py-2.5 min-w-[58px] rounded-xl text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] transition-all" title="把当前 3D 世界节点交给 Agent 操作">
            <Bot size={18} /><span className="text-[12px] leading-none">Agent</span>
          </button>
          {data.panoramaUrl && (
            <>
              <button onClick={handleSetDirectorBg} className="flex flex-col items-center gap-1.5 px-3.5 py-2.5 min-w-[58px] rounded-xl text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] transition-all" title="设为 3D 导演台背景">
                <Video size={18} /><span className="text-[12px] leading-none">导演台</span>
              </button>
              <button onClick={() => void handleDownload()} className="flex flex-col items-center gap-1.5 px-3.5 py-2.5 min-w-[58px] rounded-xl text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] transition-all" title="另存为本地文件">
                <Download size={18} /><span className="text-[12px] leading-none">下载</span>
              </button>
            </>
          )}
          <button onClick={() => deleteNode(id)} className="flex flex-col items-center gap-1.5 px-3.5 py-2.5 min-w-[58px] rounded-xl text-[var(--canvas-text-2)] hover:text-red-500 hover:bg-[rgba(255,97,99,0.15)] transition-all" title="删除节点">
            <Trash2 size={18} /><span className="text-[12px] leading-none">删除</span>
          </button>
        </div>
      )}

      {selected && (
        <NodeResizer
          color="#a8a8a8"
          isVisible={selected}
          minWidth={280}
          minHeight={160}
          handleStyle={{ backgroundColor: '#a8a8a8', border: '1px solid #141414', borderRadius: '50%', width: 6, height: 6 }}
          lineStyle={{ borderColor: '#a8a8a8', borderWidth: 1, borderStyle: 'dashed' }}
        />
      )}

      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      <div
        className={`rounded-2xl w-full transition-all duration-200 ${
          selected ? 'shadow-[0_0_0_1.5px_rgba(255,255,255,0.7),0_4px_24px_rgba(0,0,0,0.35)]' : 'shadow-sm hover:shadow-[0_1px_4px_1px_rgba(255,255,255,0.08)]'
        }`}
        style={{ background: 'var(--canvas-node-bg)', border: `1px solid ${selected ? 'transparent' : 'var(--canvas-node-border)'}` }}
      >
        <div className="p-2.5">
          {data.panoramaUrl && !isGenerating ? (
            <div className="relative rounded-lg overflow-hidden" style={{ height: 200 }}>
              <div ref={viewerRef} className="absolute inset-0 cursor-grab active:cursor-grabbing nodrag" />
              {!viewerReady && (
                <img src={data.panoramaUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
              )}
              <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/60 text-white text-[9px] flex items-center gap-1 pointer-events-none">
                <Maximize2 size={8} /> 拖拽环视
              </span>
            </div>
          ) : isGenerating ? (
            <div className="relative h-36 rounded-lg overflow-hidden border border-[var(--canvas-node-border)] bg-[rgba(255,255,255,0.06)]">
              <div className="absolute inset-0 cv-shimmer" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex flex-col items-center gap-1.5">
                  {activeTask
                    ? <ProgressRing engineId={activeTask.engineId} startedAt={activeTask.createdAt} size={32} />
                    : <Loader2 size={20} className="animate-spin text-[var(--canvas-text-2)]" />}
                  <span className="text-[10px] text-[var(--canvas-text-2)]">{activeTask?.progress || '全景生成中…'}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-32 flex items-center justify-center border border-dashed border-[var(--canvas-node-border)] rounded-lg bg-[rgba(255,255,255,0.04)]">
              <div className="text-center">
                <Globe2 size={22} className="text-[var(--canvas-text-3)] mx-auto mb-1.5" />
                <div className="text-[11px] text-[var(--canvas-text-3)]">生成 360° 全景场景</div>
                <div className="text-[10px] text-[var(--canvas-text-3)] mt-0.5">选中节点后在下方配置生成</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(PanoramaNodeComponent);
