/**
 * ArtifactLibrary — browse every generated artifact (workspace + projects)
 * with type/date filters, multi-select batch export, save-as, reveal in
 * Finder, and drag-back-to-canvas.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Image as Images, Film, Music, FileText, RefreshCw, Download, FolderOpen,
  CheckSquare, Square, Loader2,
} from 'lucide-react';
import { convertFileSrc, invoke } from '@tauri-apps/api/tauri';
import { open as openDialog, message as tauriMessage } from '@tauri-apps/api/dialog';
import { copyFile } from '@tauri-apps/api/fs';
import { listArtifacts, type ArtifactEntry, type ArtifactType } from '@/lib/artifacts';
import { useSettingsStore } from '@/stores/settingsStore';
import { useVideoThumb } from '@/lib/canvas/videoThumbs';
import { useProjectStore } from '@/stores/projectStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useChatStore } from '@/stores/chatStore';
import { nanoid } from 'nanoid';
import { defaultNodeStyle } from '@/lib/canvas/layout';

type TypeFilter = 'all' | ArtifactType;
type DateFilter = 'all' | 'today' | 'week' | 'month';

// Render in pages — mounting hundreds of <img>/<video> at once froze the view.
const PAGE_SIZE = 60;

const TYPE_TABS: { key: TypeFilter; label: string; icon: typeof Images }[] = [
  { key: 'all', label: '全部', icon: Images },
  { key: 'image', label: '图片', icon: Images },
  { key: 'video', label: '视频', icon: Film },
  { key: 'audio', label: '音频', icon: Music },
  { key: 'doc', label: '文档', icon: FileText },
];

function fmtSize(bytes: number): string {
  if (bytes > 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes > 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export default function ArtifactLibrary() {
  const [entries, setEntries] = useState<ArtifactEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const projects = useProjectStore((s) => s.projects);
  const setActiveView = useChatStore((s) => s.setActiveView);
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await listArtifacts());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const cutoff = dateFilter === 'today' ? now - 86400_000
      : dateFilter === 'week' ? now - 7 * 86400_000
      : dateFilter === 'month' ? now - 30 * 86400_000
      : 0;
    return entries.filter((e) =>
      (typeFilter === 'all' || e.type === typeFilter)
      && e.createdAt >= cutoff
      && (projectFilter === 'all'
        || (projectFilter === 'workspace' ? !e.projectId : e.projectId === projectFilter)),
    );
  }, [entries, typeFilter, dateFilter, projectFilter]);

  // Reset pagination when filters change.
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [typeFilter, dateFilter, projectFilter]);
  const visible = filtered.slice(0, visibleCount);

  const toggleSelect = (path: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  const allSelected = filtered.length > 0 && filtered.every((e) => selected.has(e.path));
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(filtered.map((e) => e.path)));
  };

  // Batch export: pick a directory, copy every selected file into it.
  const handleBatchExport = async () => {
    if (selected.size === 0 || exporting) return;
    const dir = await openDialog({ directory: true, title: '选择导出目录' });
    if (!dir || Array.isArray(dir)) return;
    setExporting(true);
    let ok = 0, fail = 0;
    try {
      for (const path of selected) {
        const name = path.split('/').pop()!;
        try {
          await copyFile(path, `${dir}/${name}`);
          ok += 1;
        } catch {
          fail += 1;
        }
      }
      await tauriMessage(`导出完成：成功 ${ok} 个${fail ? `，失败 ${fail} 个` : ''}\n${dir}`, { title: '批量导出' });
      setSelected(new Set());
    } finally {
      setExporting(false);
    }
  };

  const handleSaveAs = async (entry: ArtifactEntry) => {
    try {
      await invoke('save_file_dialog', {
        sourcePath: entry.path,
        defaultName: entry.path.split('/').pop(),
      });
    } catch (err) {
      console.error('另存为失败:', err);
    }
  };

  const handleReveal = (entry: ArtifactEntry) => {
    invoke('open_path', { path: entry.path, reveal: true }).catch(() => {});
  };

  // Drag back to canvas: create an image node from this artifact.
  const handleSendToCanvas = (entry: ArtifactEntry) => {
    if (entry.type !== 'image' && entry.type !== 'video') return;
    const { addNode } = useCanvasStore.getState();
    const url = convertFileSrc(entry.path);
    addNode({
      id: `node-${nanoid(8)}`,
      type: entry.type,
      position: { x: 120 + Math.random() * 120, y: 120 + Math.random() * 120 },
      style: defaultNodeStyle(entry.type),
      data: entry.type === 'image'
        ? { generatedImageUrl: url, localPath: entry.path, description: entry.prompt || '' }
        : {
          generatedVideoUrl: url,
          localPath: entry.path,
          mediaRole: 'output',
          description: entry.prompt || '',
        },
    });
    setActiveView('canvas');
  };

  return (
    <div className="flex-1 flex flex-col bg-stone-50 min-h-0">
      {/* Header / filters */}
      <div className="px-8 pt-6 pb-3 border-b border-stone-200 bg-white">
        {/* 收起时左移让位给 App 层全局 SidebarHandle（浮于左上角，与标题同栏）；padding 不参与 justify-between 分配，标题仍左对齐 */}
        <div className={`flex items-center justify-between mb-4${sidebarCollapsed ? ' pl-5' : ''}`}>
          <div>
            <h1 className="text-xl font-semibold text-stone-800">产物库</h1>
            <p className="text-[13px] text-stone-400 mt-0.5">
              {filtered.length} 个产物 · 含工作区与所有项目目录
            </p>
          </div>
          <button
            onClick={() => void refresh()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-200 text-[12px] text-stone-500 hover:bg-stone-50"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            刷新
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center rounded-lg border border-stone-200 overflow-hidden">
            {TYPE_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTypeFilter(t.key)}
                className={`px-3 py-1.5 text-[12px] ${typeFilter === t.key ? 'bg-stone-800 text-white' : 'text-stone-500 hover:bg-stone-50'}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value as DateFilter)}
            className="px-2.5 py-1.5 rounded-lg border border-stone-200 text-[12px] text-stone-600 bg-white"
          >
            <option value="all">全部时间</option>
            <option value="today">今天</option>
            <option value="week">近 7 天</option>
            <option value="month">近 30 天</option>
          </select>

          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-stone-200 text-[12px] text-stone-600 bg-white max-w-[160px]"
          >
            <option value="all">全部来源</option>
            <option value="workspace">工作区（未归档）</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          <div className="flex-1" />

          <button onClick={toggleAll} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] text-stone-500 hover:bg-stone-100">
            {allSelected ? <CheckSquare size={13} /> : <Square size={13} />}
            全选
          </button>
          {selected.size > 0 && (
            <button
              onClick={() => void handleBatchExport()}
              disabled={exporting}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-900 text-white text-[12px] font-medium disabled:opacity-60"
            >
              {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              导出 {selected.size} 个
            </button>
          )}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-8 py-5">
        {filtered.length === 0 ? (
          <div className="text-center py-20 text-stone-300 text-sm">
            {loading ? '扫描中…' : '没有匹配的产物'}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {visible.map((e) => (
                <ArtifactCard
                  key={e.path}
                  entry={e}
                  selected={selected.has(e.path)}
                  onToggle={() => toggleSelect(e.path)}
                  onSaveAs={() => void handleSaveAs(e)}
                  onReveal={() => handleReveal(e)}
                  onSendToCanvas={() => handleSendToCanvas(e)}
                />
              ))}
            </div>
            {visibleCount < filtered.length && (
              <div className="text-center mt-5">
                <button
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  className="px-5 py-2 rounded-xl border border-stone-200 bg-white text-[12px] text-stone-500 hover:bg-stone-50"
                >
                  加载更多（还有 {filtered.length - visibleCount} 个）
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ArtifactCard({ entry, selected, onToggle, onSaveAs, onReveal, onSendToCanvas }: {
  entry: ArtifactEntry;
  selected: boolean;
  onToggle: () => void;
  onSaveAs: () => void;
  onReveal: () => void;
  onSendToCanvas: () => void;
}) {
  const url = convertFileSrc(entry.path);
  const name = entry.path.split('/').pop()!;

  return (
    <div className={`group relative rounded-xl border bg-white overflow-hidden transition-shadow hover:shadow-md ${selected ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-stone-200'}`}>
      <button onClick={onToggle} className="absolute top-1.5 left-1.5 z-10 p-0.5 rounded bg-white/90 shadow-sm">
        {selected ? <CheckSquare size={14} className="text-indigo-500" /> : <Square size={14} className="text-stone-300 group-hover:text-stone-400" />}
      </button>

      <div className="h-28 bg-stone-100 flex items-center justify-center overflow-hidden">
        {entry.type === 'image' ? (
          <img src={url} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
        ) : entry.type === 'video' ? (
          <VideoThumbCell path={entry.path} />
        ) : entry.type === 'audio' ? (
          <Music size={24} className="text-stone-300" />
        ) : (
          <FileText size={24} className="text-stone-300" />
        )}
      </div>

      <div className="px-2.5 py-2">
        <p className="text-[11px] text-stone-600 truncate" title={entry.prompt || name}>
          {entry.prompt ? entry.prompt.slice(0, 40) : name}
        </p>
        <p className="text-[10px] text-stone-400 mt-0.5">
          {fmtSize(entry.size)} · {new Date(entry.createdAt).toLocaleDateString('zh-CN')}
          {entry.scanned && <span className="ml-1 text-stone-300">扫描</span>}
        </p>
      </div>

      <div className="absolute bottom-9 right-1.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {(entry.type === 'image' || entry.type === 'video') && (
          <CardBtn onClick={onSendToCanvas} title="放到画布"><Images size={12} /></CardBtn>
        )}
        <CardBtn onClick={onSaveAs} title="另存为"><Download size={12} /></CardBtn>
        <CardBtn onClick={onReveal} title="在 Finder 中显示"><FolderOpen size={12} /></CardBtn>
      </div>
    </div>
  );
}

function CardBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      className="p-1.5 rounded-lg bg-white/95 border border-stone-200 text-stone-400 hover:text-stone-700 shadow-sm"
    >
      {children}
    </button>
  );
}

function VideoThumbCell({ path }: { path: string }) {
  const thumb = useVideoThumb(path);
  return thumb ? (
    <div className="relative w-full h-full">
      <img src={thumb} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
      <span className="absolute bottom-1 right-1 px-1 rounded bg-black/60 text-white text-[8px] flex items-center gap-0.5"><Film size={8} />视频</span>
    </div>
  ) : (
    <div className="flex flex-col items-center gap-1 text-stone-300">
      <Film size={24} />
      <span className="text-[9px]">视频</span>
    </div>
  );
}
