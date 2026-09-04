import { memo, useState, useCallback, useEffect, useRef } from 'react';
import { Handle, Position, NodeResizer } from 'reactflow';
import type { NodeProps } from 'reactflow';
import { Film, Loader2, Trash2, Pencil, Check, Download, Wand2, Camera, Mic, Upload, Sparkles, Scissors, AudioLines, Bot, Maximize2, Play, Pause, FolderOpen, Clapperboard } from 'lucide-react';
import { useCanvasStore } from '@/stores/canvasStore';
import { useCanvasTaskStore } from '@/stores/canvasTaskStore';
import { captureSnapshot } from '@/lib/canvas/history';
import { invoke } from '@tauri-apps/api/tauri';
import { open as openDialog, message as tauriMessage } from '@tauri-apps/api/dialog';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import type { VideoNodeData } from '@/types/canvas';
import ProgressRing from './ProgressRing';
import NodeParamBadge from './NodeParamBadge';
import ToolbarDropdown from '../ToolbarDropdown';
import NodeToolbarPortal from '../NodeToolbarPortal';
import { extendVideo, lipSyncViaAgent } from '@/lib/canvas/videoTools';
import { increaseFps, separateAudio, sendToEditor, sendToAgent, upscaleVideo } from '@/lib/canvas/videoToolActions';
import { useJustCompleted } from './ImageNode';
import { assetUrlToLocalPath } from '@/lib/rhtv/upload';
import { useVideoThumb } from '@/lib/canvas/videoThumbs';

const ACTIVE = ['queued', 'uploading', 'running', 'downloading'];

function extFromPath(path: string, fallback = 'mp4'): string {
  const clean = path.split('?')[0].split('#')[0];
  const ext = clean.includes('.') ? clean.slice(clean.lastIndexOf('.') + 1).toLowerCase() : '';
  return /^(mp4|mov|webm|m4v)$/.test(ext) ? ext : fallback;
}

function defaultVideoName(path: string): string {
  const base = path.split('/').pop()?.split('?')[0]?.split('#')[0] || '';
  if (/\.(mp4|mov|webm|m4v)$/i.test(base)) return base;
  return `video-${Date.now()}.${extFromPath(path)}`;
}

/** 自绘视频播放器：大播放/暂停按钮 + 粗进度条，nodrag nopan 防误触。 */
function VideoPlayer({
  id,
  src,
  localPath,
  fallbackPoster,
}: {
  id: string;
  src: string;
  localPath?: string;
  fallbackPoster?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const thumbnail = useVideoThumb(localPath);
  const [active, setActive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);

  const toggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!active) {
      window.dispatchEvent(new CustomEvent('kunpeng-canvas-video-activate', { detail: { id } }));
      setActive(true);
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { void v.play(); } else { v.pause(); }
  }, [active, id]);

  useEffect(() => {
    const handleActivate = (event: Event) => {
      const nextId = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (nextId && nextId !== id) setActive(false);
    };
    window.addEventListener('kunpeng-canvas-video-activate', handleActivate);
    return () => window.removeEventListener('kunpeng-canvas-video-activate', handleActivate);
  }, [id]);

  useEffect(() => {
    if (!active) return;
    const timer = requestAnimationFrame(() => {
      void videoRef.current?.play().catch(() => setPlaying(false));
    });
    return () => {
      cancelAnimationFrame(timer);
      const video = videoRef.current;
      if (!video) return;
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [active]);

  const onTime = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setCur(v.currentTime);
    if (v.duration && !Number.isNaN(v.duration)) setDur(v.duration);
  }, []);

  const seek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v || !dur) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    v.currentTime = ratio * dur;
    setCur(ratio * dur);
  }, [dur]);

  const pct = dur > 0 ? (cur / dur) * 100 : 0;

  return (
    <div
      className="relative w-full h-full min-h-[150px] group/video"
    >
      {active ? (
        <video
          ref={videoRef}
          src={src}
          poster={thumbnail || fallbackPoster}
          className="w-full h-full object-cover block pointer-events-none"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={onTime}
          onLoadedMetadata={onTime}
          preload="metadata"
        />
      ) : thumbnail || fallbackPoster ? (
        <img
          src={thumbnail || fallbackPoster}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="h-full w-full bg-black/55" />
      )}
      {/* 居中播放/暂停按钮（不占满，留出边缘可点选节点）。暂停时常显，播放时 hover 显 */}
      <button
        onClick={toggle}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center"
        title={playing ? '暂停' : '播放'}
      >
        <span
          className={`flex items-center justify-center rounded-full bg-black/45 backdrop-blur-sm text-white transition-opacity ${playing ? 'opacity-0 group-hover/video:opacity-100' : 'opacity-90'}`}
          style={{ width: 56, height: 56 }}
        >
          {active && playing ? <Pause size={26} /> : <Play size={26} className="ml-1" />}
        </span>
      </button>
      {/* 底部进度条（粗 8px，好点） */}
      {active && <div
        className="absolute bottom-0 left-0 right-0 px-2 pb-2 pt-3 bg-gradient-to-t from-black/55 to-transparent nodrag nopan"
      >
        <div
          onClick={seek}
          className="relative h-2 rounded-full bg-white/25 cursor-pointer"
          title="点击跳转"
        >
          <div
            className="absolute left-0 top-0 bottom-0 rounded-full bg-white/90"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>}
    </div>
  );
}

function VideoNodeComponent({ id, data, selected }: NodeProps<VideoNodeData>) {
  const isGenerating = data.isGenerating || false;
  const deleteNode = useCanvasStore((s) => s.deleteNode);
  const updateNode = useCanvasStore((s) => s.updateNode);
  const activeTask = useCanvasTaskStore((s) => {
    const t = [...s.tasks].reverse().find((x) => x.nodeId === id && ACTIVE.includes(x.status));
    return t ? { progress: t.progress, engineId: t.engineId, createdAt: t.createdAt } : null;
  });
  const taskProgress = activeTask?.progress;
  const justCompleted = useJustCompleted((data as Record<string, unknown>).justCompletedAt as number | undefined);
  const [editing, setEditing] = useState(false);

  const handleReplace = async () => {
    const file = await openDialog({ filters: [{ name: '视频', extensions: ['mp4', 'mov', 'webm'] }] });
    if (!file || Array.isArray(file)) return;
    updateNode(id, {
      generatedVideoUrl: convertFileSrc(file),
      localPath: file,
      sourceVideoPath: file,
      mediaRole: 'reference',
    });
  };
  const [editValue, setEditValue] = useState('');
  const title = data.isMgAnimationNode || data.modelVersion === 'omni-mg-animation' ? 'MG动画' : 'Video';
  const referenceImageCount = data.referenceImages?.length ?? 0;
  const referenceVideoCount = data.referenceVideos?.length ?? 0;
  const referenceCount = referenceImageCount + referenceVideoCount;
  const descriptionText = (data.description || '').trim();

  const startEdit = () => { setEditValue(data.description || ''); setEditing(true); };
  const confirmEdit = () => { updateNode(id, { description: editValue }); setEditing(false); };

  const handleDownload = useCallback(async () => {
    const source = data.localPath || (data.generatedVideoUrl ? assetUrlToLocalPath(data.generatedVideoUrl) : '');
    if (!source) return;
    try {
      await invoke('save_file_dialog', {
        sourcePath: source,
        defaultName: defaultVideoName(source),
      });
    } catch (err) {
      console.error('下载视频失败:', err);
    }
  }, [data.generatedVideoUrl, data.localPath]);

  const handleOpenFolder = useCallback(async () => {
    const d = data as unknown as Record<string, unknown>;
    let localPath = (d.localPath as string) || '';
    const url = data.generatedVideoUrl || '';
    if (!localPath) {
      localPath = assetUrlToLocalPath(url);
    }
    if (!localPath) { await tauriMessage('未找到本地文件路径', { title: '提示' }); return; }
    try {
      await invoke('open_path', { path: localPath, reveal: true });
    } catch (err) {
      console.error('打开文件夹失败:', err);
      await tauriMessage(`打开失败：${err instanceof Error ? err.message : String(err)}`, { title: '错误' });
    }
  }, [data]);

  return (
    // w-full follows the width NodeResizer writes to node.style (reactflow
    // applies node.style to its wrapper); min width keeps the old footprint.
    <div
      className={`relative group w-full h-full ${isGenerating ? 'flowing-border' : ''} ${justCompleted ? 'node-new-highlight' : ''}`}
      style={{ minWidth: 200, minHeight: 150, height: '100%' }}
    >
      {/* 节点外左上角标题 */}
      <div className="absolute -top-6 left-0.5 flex items-center gap-1.5 pointer-events-none">
        <Film size={11} className="text-[var(--canvas-text-3)]" />
        <span className="text-[11px] text-[var(--canvas-text-3)] font-medium">{title}</span>
      </div>

      {selected && (
        <NodeToolbarPortal nodeId={id}>
        <div className="flex items-center gap-1 px-2 py-1.5 rounded-2xl"
          style={{ background: 'rgba(38,38,38,0.92)', backdropFilter: 'blur(12px) saturate(1.5)', boxShadow: '0 2px 12px rgba(0,0,0,0.1), 0 0 0 1px rgba(255,255,255,0.08)' }}
        >
          {data.generatedVideoUrl && (<>
            <ToolBtnV onClick={() => window.dispatchEvent(new CustomEvent('kunpeng-open-video-fullscreen', { detail: { url: data.generatedVideoUrl } }))} icon={Maximize2} label="全屏" title="全屏查看视频" />
            <ToolBtnV onClick={() => void handleOpenFolder()} icon={FolderOpen} label="打开" title="在 Finder 中定位视频文件" />
            <ToolBtnV onClick={() => void sendToEditor(id)} icon={Scissors} label="剪辑" title="加入剪辑时间轴" />
            <ToolBtnV onClick={() => window.dispatchEvent(new CustomEvent('kunpeng-frame-capture', { detail: { nodeId: id } }))} icon={Camera} label="捕捉帧" title="截取任意一帧为图片节点" />
            <ToolBtnV onClick={() => window.dispatchEvent(new CustomEvent('kunpeng-video-breakdown', { detail: { nodeId: id } }))} icon={Wand2} label="解析" title="拉片：解析镜头/景别/运镜为分镜表" />
            <ToolBtnV onClick={() => void separateAudio(id)} icon={AudioLines} label="音频分离" title="人声分离 / 提取音轨为音频节点" />
            <ToolbarDropdown
              icon={Film}
              label="更多"
              items={[
                { id: 'up720', icon: Sparkles, label: '超分 720p', hint: 'AI 视频超分，默认档位最省钱', onClick: () => void upscaleVideo(id, '720p') },
                { id: 'up1080', icon: Sparkles, label: '超分 1080p', hint: 'AI 视频超分至 1080p', onClick: () => void upscaleVideo(id, '1080p') },
                { id: 'up2k', icon: Sparkles, label: '超分 2K', hint: 'AI 视频超分至 2K，价格较高', onClick: () => void upscaleVideo(id, '2K') },
                { id: 'up4k', icon: Sparkles, label: '超分 4K', hint: 'AI 视频超分至 4K，价格较高', onClick: () => void upscaleVideo(id, '4K') },
                { id: 'fps', icon: Sparkles, label: '帧率增强', hint: 'AI 插帧提升流畅度', onClick: () => void increaseFps(id) },
                { id: 'ext5', icon: Film, label: '延长 +5 秒', hint: 'Seedance 续写后续剧情', onClick: () => void extendVideo(id, 5) },
                { id: 'ext10', icon: Film, label: '延长 +10 秒', hint: 'Seedance 续写后续剧情', onClick: () => void extendVideo(id, 10) },
                { id: 'lipsync', icon: Mic, label: '对口型', hint: '连接音频节点后按音频对口型', onClick: () => lipSyncViaAgent(id) },
                { id: 'download', icon: Download, label: '下载', hint: '另存为本地文件', onClick: () => void handleDownload() },
                { id: 'edit', icon: Pencil, label: '编辑描述', onClick: startEdit },
              ]}
            />
          </>)}
          <ToolBtnV onClick={() => sendToAgent(id)} icon={Bot} label="Agent" title="把当前视频节点交给 Agent 操作" />
          {descriptionText && (
            <ToolBtnV
              onClick={() => window.dispatchEvent(new CustomEvent('kunpeng-open-director', { detail: { origin: {
                kind: 'canvas-prompt',
                title: descriptionText.slice(0, 48) || '视频提示词预演',
                nodeId: id,
                prompt: descriptionText,
              } } }))}
              icon={Clapperboard}
              label="预演"
              title="只使用提示词进入白模导演预演，不传入视频资产"
            />
          )}
          <button onClick={() => { captureSnapshot(); deleteNode(id); }} className="flex flex-col items-center gap-1.5 px-3 py-2 min-w-[50px] rounded-xl text-[var(--canvas-text-2)] hover:text-red-500 hover:bg-[rgba(255,97,99,0.15)] transition-all" title="删除节点">
            <Trash2 size={16} /><span className="text-[11px] leading-none">删除</span>
          </button>
        </div>
        </NodeToolbarPortal>
      )}

      {selected && (
        <NodeResizer
          color="#a8a8a8"
          isVisible={selected}
          minWidth={200}
          minHeight={150}
          keepAspectRatio={Boolean(data.generatedVideoUrl)}
          handleStyle={{ backgroundColor: '#a8a8a8', border: '1px solid #141414', borderRadius: '50%', width: 6, height: 6 }}
          lineStyle={{ borderColor: '#a8a8a8', borderWidth: 1, borderStyle: 'dashed' }}
        />
      )}

      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      {data.generatedVideoUrl && !isGenerating && (
        <button
          onClick={(e) => { e.stopPropagation(); void handleReplace(); }}
          className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium text-white opacity-0 group-hover:opacity-100 transition-all hover:brightness-125"
          style={{ background: 'rgba(28,28,32,0.88)', backdropFilter: 'blur(12px)', boxShadow: '0 2px 10px rgba(0,0,0,0.35)' }}
          title="替换视频"
        >
          <Upload size={13} /> 替换
        </button>
      )}

      <div
        className={`rounded-2xl overflow-hidden min-w-[200px] w-full h-full transition-all duration-200 ${
          selected ? 'shadow-[0_0_0_1.5px_rgba(255,255,255,0.7),0_4px_24px_rgba(0,0,0,0.35)]' : 'shadow-sm hover:shadow-[0_1px_4px_1px_rgba(255,255,255,0.08)]'
        }`}
        style={{ minHeight: 150, background: 'var(--canvas-node-bg)', border: `1px solid ${selected ? 'transparent' : 'var(--canvas-node-border)'}` }}
      >
        {data.generatedVideoUrl && !isGenerating ? (
          <VideoPlayer
            id={id}
            src={data.generatedVideoUrl}
            localPath={data.localPath}
            fallbackPoster={data.imageUrl}
          />
        ) : isGenerating ? (
          <div className="relative w-full h-full min-h-[150px]">
            {data.imageUrl && (
              <img src={data.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
            )}
            <div className="absolute inset-0 cv-shimmer" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center gap-1">
                {activeTask
                  ? <ProgressRing engineId={activeTask.engineId} startedAt={activeTask.createdAt} size={30} />
                  : <Loader2 size={18} className="animate-spin text-[var(--canvas-text-2)]" />}
                <span className="text-[9px] text-[var(--canvas-text-2)]">{taskProgress || '视频生成中…'}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-[150px] w-full flex-col justify-center gap-2 p-3">
            <div className="flex items-center justify-center">
              <Film size={22} className="text-[var(--canvas-text-3)]" />
            </div>
            {referenceCount > 0 && (
              <div className="mx-auto rounded-full border border-[var(--canvas-node-border)] bg-black/20 px-2.5 py-1 text-[10px] text-[var(--canvas-text-2)]">
                已接入 {referenceImageCount} 图{referenceVideoCount > 0 ? ` / ${referenceVideoCount} 视频` : ''}
              </div>
            )}
            {descriptionText && (
              <div className="max-h-[54px] overflow-hidden rounded-lg bg-black/15 px-2 py-1.5 text-[10px] leading-relaxed text-[var(--canvas-text-3)]">
                {descriptionText}
              </div>
            )}
          </div>
        )}

        {editing && (
          <div className="p-2 flex gap-1">
            <input
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="flex-1 text-[11px] text-[var(--canvas-text-1)] bg-[rgba(255,255,255,0.05)] border border-[var(--canvas-node-border)] rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-300"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') confirmEdit(); e.stopPropagation(); }}
              onMouseDown={(e) => e.stopPropagation()}
            />
            <button onClick={confirmEdit} className="p-1 rounded bg-blue-500 text-white hover:bg-blue-600"><Check size={11} /></button>
          </div>
        )}
        <NodeParamBadge data={data as Record<string, unknown>} />
      </div>
    </div>
  );
}

function ToolBtnV({ onClick, icon: Icon, label, title }: { onClick: () => void; icon: typeof Film; label: string; title: string }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1.5 px-3 py-2.5 min-w-[54px] rounded-xl text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] transition-all" title={title}>
      <Icon size={18} /><span className="text-[12px] leading-none whitespace-nowrap">{label}</span>
    </button>
  );
}

export default memo(VideoNodeComponent);
