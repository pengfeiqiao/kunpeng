/**
 * MediaBin — left pane: pick clips from canvas video nodes, artifact
 * library, or local files; click/double-click to add to the timeline.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Film, FolderOpen, Grid2X2, HardDrive, List, Plus, Loader2, Search, RefreshCw } from 'lucide-react';
import { message as tauriMessage, open as openDialog } from '@tauri-apps/api/dialog';
import { useCanvasStore } from '@/stores/canvasStore';
import { useEditorStore } from '@/stores/editorStore';
import { listArtifacts, type ArtifactEntry } from '@/lib/artifacts';
import { useVideoThumb } from '@/lib/canvas/videoThumbs';

type Tab = 'canvas' | 'library' | 'local';
type ViewMode = 'grid' | 'list';

function isAudioPath(path: string) {
  return /\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i.test(path);
}

function readInternalDropTarget() {
  return (window as unknown as {
    __kunpengTimelineDropTarget?: { sec: number; track: string; at: number };
    __kunpengTimelineDropConsumed?: boolean;
  });
}

function dispatchMediaDrag(raw: string, x: number, y: number) {
  window.dispatchEvent(new CustomEvent('kunpeng:media-drag', { detail: { raw, x, y } }));
}

function dispatchMediaDragEnd() {
  window.dispatchEvent(new Event('kunpeng:media-drag-end'));
}

async function fallbackDropToTimeline(raw: string) {
  const w = readInternalDropTarget();
  const target = w.__kunpengTimelineDropTarget;
  const consumed = Boolean(w.__kunpengTimelineDropConsumed);
  delete w.__kunpengTimelineDropTarget;
  delete w.__kunpengTimelineDropConsumed;
  if (consumed || !target || Date.now() - target.at > 800) return;
  let payload: { kind?: string; path?: string; label?: string } | null = null;
  try {
    payload = JSON.parse(raw) as typeof payload;
  } catch {
    payload = { kind: isAudioPath(raw) ? 'audio' : 'video', path: raw };
  }
  if (!payload?.path) return;
  const store = useEditorStore.getState();
  if (target.track === 'overlay-0' || target.track === 'overlay-1') {
    const id = await store.addOverlayClip({
      path: payload.path,
      kind: /\.(png|jpe?g|webp|gif)$/i.test(payload.path) ? 'image' : 'video',
      label: payload.label,
      startSec: target.sec,
      trackIndex: target.track === 'overlay-1' ? 1 : 0,
    });
    useEditorStore.getState().selectOverlay(id);
    return;
  }
  if (target.track.startsWith('audio-') || payload.kind === 'audio' || isAudioPath(payload.path)) {
    const kind = target.track.startsWith('audio-') ? target.track.replace('audio-', '') as 'bgm' | 'sfx' | 'voice' : 'sfx';
    const id = await store.addAudioClip(kind, { path: payload.path, label: payload.label, startSec: target.sec, loop: false });
    useEditorStore.getState().selectAudioClip(id);
    return;
  }
  const before = store.clips;
  const ids = await store.addClips([{ path: payload.path, label: payload.label }]);
  const newId = ids[0];
  if (!newId) return;
  let acc = 0;
  let targetIndex = before.length;
  for (let i = 0; i < before.length; i += 1) {
    const len = store.clipLength(before[i]);
    if (target.sec < acc + len / 2) {
      targetIndex = i;
      break;
    }
    acc += len;
  }
  const nextIds = before.map((clip) => clip.id);
  nextIds.splice(targetIndex, 0, newId);
  useEditorStore.getState().setOrder(nextIds);
  useEditorStore.getState().select(newId);
}

export default function MediaBin({ embedded }: { embedded?: boolean }) {
  const [tab, setTab] = useState<Tab>('canvas');
  const [artifacts, setArtifacts] = useState<ArtifactEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [libraryError, setLibraryError] = useState('');
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const addClips = useEditorStore((s) => s.addClips);
  const timelineClips = useEditorStore((s) => s.clips);
  const canvasVideos = useCanvasStore((s) =>
    s.nodes.filter((n) => n.type === 'video' && Boolean((n.data as Record<string, unknown>).localPath)),
  );
  const addWithFeedback = useCallback(async (items: Parameters<typeof addClips>[0]) => {
    try {
      await addClips(items);
    } catch (error) {
      await tauriMessage(error instanceof Error ? error.message : String(error), { title: '导入素材失败', type: 'error' }).catch(() => {});
    }
  }, [addClips]);

  const refreshLibrary = useCallback(async () => {
    setLoading(true);
    setLibraryError('');
    try {
      const all = await listArtifacts();
      const videos = all.filter((a) => a.type === 'video' || /\.(mp4|mov|webm)$/i.test(a.path));
      setArtifacts(videos);
    } catch (err) {
      setLibraryError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'library') void refreshLibrary();
  }, [tab, refreshLibrary]);

  const handleLocal = async () => {
    const files = await openDialog({ filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'webm'] }], multiple: true });
    if (!files) return;
    const list = Array.isArray(files) ? files : [files];
    await addWithFeedback(list.map((p) => ({ path: p })));
  };

  const usedPaths = useMemo(() => new Set(timelineClips.map((c) => c.path)), [timelineClips]);
  const q = query.trim().toLowerCase();

  return (
    <div
      className={embedded ? 'flex-1 min-h-0 flex flex-col' : 'w-[280px] shrink-0 flex flex-col border-r border-[var(--canvas-node-border)]'}
      style={embedded ? undefined : { background: 'var(--canvas-panel)' }}
    >
      <div className="flex border-b border-[var(--canvas-node-border)] bg-[rgba(255,255,255,0.015)]">
        {([['canvas', '画布', Film], ['library', '产物库', FolderOpen], ['local', '本地', HardDrive]] as const).map(([k, label, Icon]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] transition-colors ${
              tab === k ? 'text-[var(--canvas-text-1)] bg-[rgba(255,255,255,0.05)]' : 'text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-2)]'
            }`}
          >
            <Icon size={12} />{label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-[rgba(255,255,255,0.05)]">
        <button
          onClick={() => void handleLocal()}
          className="h-8 px-2.5 rounded-lg bg-[rgba(255,255,255,0.08)] text-[11px] font-medium text-[var(--canvas-text-1)] hover:bg-[rgba(255,255,255,0.12)] transition-colors inline-flex items-center gap-1"
          title="导入本地视频"
        >
          <Plus size={12} /> 导入
        </button>
        <div className="flex-1 min-w-0 flex items-center gap-1.5 rounded-lg bg-[rgba(0,0,0,0.18)] border border-[rgba(255,255,255,0.06)] px-2 py-1.5">
          <Search size={12} className="text-[var(--canvas-text-3)] shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索素材"
            className="min-w-0 flex-1 bg-transparent text-[11px] text-[var(--canvas-text-1)] placeholder:text-[var(--canvas-text-3)] outline-none"
          />
        </div>
        <button
          onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-1)] hover:bg-[rgba(255,255,255,0.06)]"
          title={viewMode === 'grid' ? '切换列表' : '切换网格'}
        >
          {viewMode === 'grid' ? <List size={14} /> : <Grid2X2 size={14} />}
        </button>
        {tab === 'library' && (
          <button
            onClick={() => void refreshLibrary()}
            disabled={loading}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-1)] hover:bg-[rgba(255,255,255,0.06)] disabled:opacity-50"
            title="刷新产物库"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        )}
      </div>

      {tab === 'library' && (
        <div className="px-2 pt-2 text-[10px] text-[var(--canvas-text-3)] flex items-center justify-between">
          <span>{loading ? '正在刷新产物库' : `视频产物 ${artifacts.length} 个`}</span>
          {libraryError && <span className="text-[#ff9a9a] truncate max-w-[160px]" title={libraryError}>读取失败</span>}
        </div>
      )}

      <div
        className={`flex-1 min-h-0 overflow-y-auto p-2 ${viewMode === 'grid' ? 'grid gap-2 content-start' : 'space-y-1.5'}`}
        style={viewMode === 'grid' ? { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gridAutoRows: 'max-content' } : undefined}
      >
        {tab === 'canvas' && (
          canvasVideos.length === 0 ? (
            <p className="col-span-2 text-center py-8 text-[11px] text-[var(--canvas-text-3)]">画布上还没有已生成的视频节点</p>
          ) : canvasVideos.filter((n) => {
            const d = n.data as Record<string, unknown>;
            const label = `${String(d.description ?? '')} ${n.id}`.toLowerCase();
            return !q || label.includes(q);
          }).map((n) => {
            const d = n.data as Record<string, unknown>;
            const path = d.localPath as string;
            return (
              <BinItem
                key={n.id}
                videoPath={path}
                label={(d.description as string)?.slice(0, 30) || n.id}
                used={usedPaths.has(path)}
                viewMode={viewMode}
                onAdd={() => void addWithFeedback([{ path, label: (d.description as string)?.slice(0, 24), sourceNodeId: n.id }])}
              />
            );
          })
        )}
        {tab === 'library' && (
          loading && artifacts.length === 0 ? (
            <p className="col-span-2 text-center py-8 text-[11px] text-[var(--canvas-text-3)]"><Loader2 size={14} className="animate-spin inline" /> 扫描中…</p>
          ) : libraryError ? (
            <div className="col-span-2 rounded-xl border border-[rgba(255,120,120,0.22)] bg-[rgba(255,80,80,0.06)] p-3 text-center">
              <p className="text-[11px] text-[var(--canvas-text-2)]">产物库读取失败</p>
              <p className="mt-1 text-[9px] text-[var(--canvas-text-3)] line-clamp-2" title={libraryError}>{libraryError}</p>
              <button
                onClick={() => void refreshLibrary()}
                className="mt-2 h-7 px-3 rounded-lg bg-[rgba(255,255,255,0.08)] text-[10px] text-[var(--canvas-text-1)] hover:bg-[rgba(255,255,255,0.12)]"
              >
                重新刷新
              </button>
            </div>
          ) : artifacts.length === 0 ? (
            <div className="col-span-2 text-center py-8">
              <p className="text-[11px] text-[var(--canvas-text-3)]">产物库中还没有视频</p>
              <button
                onClick={() => void refreshLibrary()}
                className="mt-2 h-7 px-3 rounded-lg bg-[rgba(255,255,255,0.08)] text-[10px] text-[var(--canvas-text-1)] hover:bg-[rgba(255,255,255,0.12)]"
              >
                刷新
              </button>
            </div>
          ) : artifacts.filter((a) => {
            const label = `${a.prompt ?? ''} ${a.path}`.toLowerCase();
            return !q || label.includes(q);
          }).map((a) => (
            <BinItem
              key={a.path}
              videoPath={a.path}
              label={a.prompt?.slice(0, 30) || a.path.split('/').pop()!}
              used={usedPaths.has(a.path)}
              viewMode={viewMode}
              onAdd={() => void addWithFeedback([{ path: a.path, label: a.prompt?.slice(0, 24) }])}
            />
          ))
        )}
        {tab === 'local' && (
          <button
            onClick={() => void handleLocal()}
            className="col-span-2 w-full py-8 rounded-xl border border-dashed border-[var(--canvas-node-border)] text-[12px] text-[var(--canvas-text-2)] hover:border-[var(--canvas-node-border-selected)] hover:text-[var(--canvas-text-1)] transition-colors"
          >
            <Plus size={16} className="mx-auto mb-1" />
            选择本地视频文件
          </button>
        )}
      </div>
    </div>
  );
}

function BinItem({ videoPath, label, onAdd, used, viewMode }: { videoPath: string; label: string; onAdd: () => void; used: boolean; viewMode: ViewMode }) {
  const thumb = useVideoThumb(videoPath);
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    const payload = JSON.stringify({ kind: 'video', path: videoPath, label });
    const w = window as unknown as { __kunpengMediaDragPayload?: string; __kunpengTimelineDropConsumed?: boolean };
    w.__kunpengMediaDragPayload = payload;
    w.__kunpengTimelineDropConsumed = false;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/x-kunpeng-media', payload);
    e.dataTransfer.setData('application/json', payload);
    e.dataTransfer.setData('text/plain', videoPath);
    if (thumb) {
      const img = new Image();
      img.src = thumb;
      try { e.dataTransfer.setDragImage(img, 48, 28); } catch {}
    }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={handleDragStart}
      onDrag={(e) => {
        const raw = (window as unknown as { __kunpengMediaDragPayload?: string }).__kunpengMediaDragPayload;
        if (raw) dispatchMediaDrag(raw, e.clientX, e.clientY);
      }}
      onDragEnd={() => {
        const w = window as unknown as { __kunpengMediaDragPayload?: string };
        const raw = w.__kunpengMediaDragPayload;
        if (raw) void fallbackDropToTimeline(raw).catch((error) => tauriMessage(error instanceof Error ? error.message : String(error), { title: '拖入素材失败', type: 'error' }).catch(() => {}));
        delete w.__kunpengMediaDragPayload;
        dispatchMediaDragEnd();
      }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('[data-add-button]')) return;
      }}
      onDoubleClick={onAdd}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onAdd();
        }
      }}
      className={`w-full min-w-0 text-left rounded-md overflow-hidden border border-[var(--canvas-node-border)] hover:border-[var(--canvas-node-border-selected)] transition-colors group cursor-grab active:cursor-grabbing bg-[rgba(255,255,255,0.018)] ${viewMode === 'list' ? 'flex items-center' : 'block'}`}
      title="双击加入时间轴，或拖到下方时间轴"
    >
      <div
        className={`relative bg-black/40 shrink-0 ${viewMode === 'list' ? 'w-32' : 'w-full'}`}
        style={{ height: viewMode === 'list' ? 76 : 76, minHeight: viewMode === 'list' ? 76 : 76 }}
      >
        {thumb
          ? <img src={thumb} alt="" draggable={false} loading="lazy" decoding="async" className="w-full h-full object-cover pointer-events-none" />
          : <div className="w-full h-full flex items-center justify-center text-[var(--canvas-text-3)]"><Film size={20} /></div>}
        {used && <span className="absolute left-1 top-1 px-1 py-0.5 rounded bg-black/70 text-[9px] text-white">已添加</span>}
        <button
          data-add-button
          onClick={(e) => { e.stopPropagation(); onAdd(); }}
          className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-[var(--canvas-accent)] text-white text-[9px] opacity-0 group-hover:opacity-100 transition-opacity"
        >
          加入
        </button>
      </div>
      <div className="min-w-0 px-1.5 py-1">
        <p className="text-[9px] text-[var(--canvas-text-2)] truncate">{label}</p>
        <p className="mt-0.5 text-[8px] text-[var(--canvas-text-3)] truncate">{videoPath.split('/').pop()}</p>
      </div>
    </div>
  );
}
