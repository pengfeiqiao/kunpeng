/**
 * ProjectListView — Adobe-style project console（统一项目首页）。
 *
 * 主区 = AIGC 项目（工坊+画布+剪辑+对话一体），点开走 openUnified；
 * 折叠区 = 未关联工坊的自由画布项目（原画布项目列表）。
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ChevronDown, ChevronRight, Clapperboard, Clock, Download, FolderOpen, Loader2,
  Pencil, Plus, Trash2, Upload,
} from 'lucide-react';
import { open as openDialog, message as tauriMessage } from '@tauri-apps/api/dialog';
import { useProjectStore, type Project } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useWorkshopStore } from '@/stores/workshopStore';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';
import { listProjects, deleteProject as deleteAigcProject, writeProject, type AigcProject } from '@/lib/aigc/projectStore';
import { confirm as tauriConfirm } from '@tauri-apps/api/dialog';
import { readTextFile, exists, BaseDirectory } from '@tauri-apps/api/fs';
import { exportProject, importProject } from '@/lib/projectArchive';

function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return '刚刚';
  if (d < 3600_000) return `${Math.floor(d / 60_000)} 分钟前`;
  if (d < 86400_000) return `${Math.floor(d / 3600_000)} 小时前`;
  return `${Math.floor(d / 86400_000)} 天前`;
}

export default function ProjectListView() {
  const [aigcProjects, setAigcProjects] = useState<AigcProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [exportingCanvasId, setExportingCanvasId] = useState<string | null>(null);
  const [showFree, setShowFree] = useState(false);
  const canvasProjects = useProjectStore((s) => s.projects);
  const initialize = useProjectStore((s) => s.initialize);
  const setActiveView = useChatStore((s) => s.setActiveView);
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const openUnified = useUnifiedProjectStore((s) => s.openUnified);
  const createAndOpen = useWorkshopStore((s) => s.createAndOpen);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setAigcProjects(await listProjects()); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void initialize();
    void refresh();
  }, [initialize, refresh]);

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      await createAndOpen(`短剧项目 ${new Date().getMonth() + 1}-${new Date().getDate()}`);
      const id = useWorkshopStore.getState().project?.id;
      if (id) {
        await openUnified(id);
        setActiveView('workshop');
      }
    } catch (err) {
      await tauriMessage(`新建项目失败：${err instanceof Error ? err.message : String(err)}`, { title: '新建项目失败' });
    } finally {
      setCreating(false);
    }
  };

  const handleOpen = async (p: AigcProject) => {
    try {
      await openUnified(p.id);
      setActiveView('workshop');
    } catch (err) {
      await tauriMessage(`打开项目失败：${err instanceof Error ? err.message : String(err)}`, { title: '打开项目失败' });
    }
  };

  // 查工坊项目对应的画布项目 id（localStorage 画布 projects 反查，或 workshop.json 文件）
  const findCanvasId = async (aigcId: string): Promise<string | undefined> => {
    const cp = useProjectStore.getState().projects.find((p) => p.aigcProjectId === aigcId);
    if (cp) return cp.id;
    try {
      const wsRel = `.kunpeng/aigc-memory/projects/${aigcId}/workshop.json`;
      if (await exists(wsRel, { dir: BaseDirectory.Home })) {
        const ws = JSON.parse(await readTextFile(wsRel, { dir: BaseDirectory.Home }));
        return ws?.canvasProjectId ?? ws?.data?.canvasProjectId;
      }
    } catch { /* ignore */ }
    return undefined;
  };

  const handleExport = async (p: AigcProject) => {
    if (exportingId) return;
    setExportingId(p.id);
    try {
      const canvasId = await findCanvasId(p.id);
      const zipPath = await exportProject(p.id, canvasId);
      await tauriMessage(`工程已导出到桌面：\n${zipPath}`, { title: '导出成功' });
    } catch (err) {
      await tauriMessage(`导出失败：${err instanceof Error ? err.message : String(err)}`, { title: '导出失败' });
    } finally {
      setExportingId(null);
    }
  };

  const handleImport = async () => {
    if (importing) return;
    try {
      const selected = await openDialog({
        filters: [{ name: '鲲鹏工程', extensions: ['zip'] }],
        multiple: false,
      });
      if (!selected || Array.isArray(selected)) return;
      setImporting(true);
      const result = await importProject(selected);
      await refresh();
      await tauriMessage(`已导入工程「${result.name}」并打开`, { title: '导入成功' });
      setActiveView('workshop');
    } catch (err) {
      await tauriMessage(`导入失败：${err instanceof Error ? err.message : String(err)}`, { title: '导入失败' });
    } finally {
      setImporting(false);
    }
  };

  const handleExportCanvas = async (p: Project) => {
    if (exportingCanvasId) return;
    setExportingCanvasId(p.id);
    try {
      // 自由画布无工坊项目，flush 后只打包画布
      await useProjectStore.getState().flushActiveCanvas();
      const zipPath = await exportProject(undefined, p.id);
      await tauriMessage(`画布已导出到桌面：\n${zipPath}`, { title: '导出成功' });
    } catch (err) {
      await tauriMessage(`导出失败：${err instanceof Error ? err.message : String(err)}`, { title: '导出失败' });
    } finally {
      setExportingCanvasId(null);
    }
  };

  const handleDelete = async (p: AigcProject) => {
    const ok = await tauriConfirm(`删除项目「${p.name}」？工坊数据、产物与关联画布将一并删除，不可恢复。`, { title: '删除项目', type: 'warning' });
    if (!ok) return;
    await deleteAigcProject(p.id);
    // 级联删除关联的画布项目，防止幽灵画布堆积
    const ps = useProjectStore.getState();
    const linked = ps.projects.filter((c) => c.aigcProjectId === p.id);
    for (const c of linked) {
      await ps.deleteProject(c.id, true).catch(() => {});
    }
    void refresh();
  };

  const handleRename = async (p: AigcProject, name: string) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === p.name) return;
    await writeProject({ ...p, name: trimmed });

    // 1. 同步画布 Project.name（修画布 ProjectSwitcher 显示旧名）
    const ps = useProjectStore.getState();
    const linked = ps.projects.find((c) => c.aigcProjectId === p.id);
    if (linked && linked.name !== trimmed) ps.renameProject(linked.id, trimmed);

    // 2. 同步内存中正打开的工坊 project（修 ProjectTopBar stale）
    const ws = useWorkshopStore.getState();
    if (ws.project?.id === p.id) {
      useWorkshopStore.setState({ project: { ...ws.project, name: trimmed } });
    }

    // 3. 同步会话 title 前缀「旧名 · 对话N」→「新名 · 对话N」（修侧边栏会话组名）
    const oldPrefix = `${p.name} · `;
    const newPrefix = `${trimmed} · `;
    const { sessions, updateSession } = useChatStore.getState();
    for (const s of sessions.filter((x) => x.projectId === p.id)) {
      if (s.title.startsWith(oldPrefix)) {
        updateSession(s.id, { title: newPrefix + s.title.slice(oldPrefix.length) });
      }
    }

    void refresh();
  };

  // 自由画布 = 未关联任何 AIGC 项目的画布项目
  const freeCanvas = canvasProjects.filter((c) => !c.aigcProjectId);

  // 清理空画布（历史 bug 产生的幽灵画布：无节点、未关联）
  const handleCleanupEmpty = async () => {
    const ps = useProjectStore.getState();
    const orphans = ps.projects.filter((c) => !c.aigcProjectId);
    let removed = 0;
    for (const c of orphans) {
      try {
        const rel = `.kunpeng/projects/${c.id}/canvas.json`;
        let empty = true;
        if (await exists(rel, { dir: BaseDirectory.Home })) {
          const raw = await readTextFile(rel, { dir: BaseDirectory.Home });
          const parsed = JSON.parse(raw) as { nodes?: unknown[] };
          empty = !parsed.nodes || parsed.nodes.length === 0;
        }
        if (empty && ps.projects.length - removed > 1 && c.id !== ps.activeProjectId) {
          await ps.deleteProject(c.id, true);
          removed++;
        }
      } catch { /* skip unreadable */ }
    }
    await tauriMessage(removed > 0 ? `已清理 ${removed} 个空画布` : '没有可清理的空画布', { title: '清理空画布' });
  };
  const coverFor = (p: AigcProject): string | undefined =>
    canvasProjects.find((c) => c.aigcProjectId === p.id)?.coverUrl;

  const sorted = [...aigcProjects].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="flex-1 overflow-y-auto bg-stone-50">
      <div className="max-w-5xl mx-auto px-8 py-8">
        {/* 收起时左移让位给 App 层全局 SidebarHandle（浮于左上角，与标题同栏）；padding 不参与 justify-between 分配，标题仍左对齐 */}
        <div className={`flex items-center justify-between mb-6${sidebarCollapsed ? ' pl-5' : ''}`}>
          <div>
            <h1 className="text-xl font-semibold text-stone-800">项目</h1>
            <p className="text-[13px] text-stone-400 mt-0.5">
              每个项目 = 工坊流水线 + 专属画布 + 剪辑时间轴 + 项目对话
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void handleImport()}
              disabled={importing}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white hover:bg-stone-50 border border-stone-200 text-stone-700 text-[13px] font-medium transition-colors disabled:opacity-50"
              title="从 zip 导入鲲鹏工程"
            >
              {importing ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}导入工程
            </button>
            <button
              onClick={() => void handleCreate()}
              disabled={creating}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-stone-800 hover:bg-stone-900 text-white text-[13px] font-medium transition-colors disabled:opacity-50"
            >
              {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}新建项目
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-20 text-stone-300 text-sm">
            <Loader2 size={16} className="animate-spin inline mr-2" />加载中…
          </div>
        ) : sorted.length === 0 ? (
          <button
            onClick={() => void handleCreate()}
            className="w-full py-20 rounded-2xl border-2 border-dashed border-stone-200 text-stone-400 hover:border-stone-300 hover:text-stone-500 transition-colors"
          >
            <Plus size={22} className="mx-auto mb-2" />
            <span className="text-sm">创建第一个项目</span>
          </button>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {sorted.map((p) => (
              <AigcProjectCard
                key={p.id}
                project={p}
                coverUrl={coverFor(p)}
                onOpen={() => void handleOpen(p)}
                onDelete={() => void handleDelete(p)}
                onRename={(name) => void handleRename(p, name)}
                onExport={() => void handleExport(p)}
                exporting={exportingId === p.id}
              />
            ))}
          </div>
        )}

        {/* 自由画布折叠区 */}
        {freeCanvas.length > 0 && (
          <div className="mt-10">
            <button
              onClick={() => setShowFree((v) => !v)}
              className="flex items-center gap-1.5 text-[13px] text-stone-500 hover:text-stone-700 transition-colors mb-3"
            >
              {showFree ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              自由画布（{freeCanvas.length}）
              <span className="text-[11px] text-stone-300 ml-1">未关联工坊的独立画布</span>
            </button>
            {showFree && (
              <button
                onClick={() => void handleCleanupEmpty()}
                className="mb-3 ml-5 text-[11px] text-stone-400 hover:text-red-500 transition-colors"
              >
                清理空画布
              </button>
            )}
            {showFree && (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {freeCanvas.map((c) => (
                  <FreeCanvasCard
                    key={c.id}
                    project={c}
                    onExport={() => void handleExportCanvas(c)}
                    exporting={exportingCanvasId === c.id}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AigcProjectCard({ project, coverUrl, onOpen, onDelete, onRename, onExport, exporting }: {
  project: AigcProject;
  coverUrl?: string;
  onOpen: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
  onExport: () => void;
  exporting: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);

  return (
    <div className="group relative rounded-2xl border border-stone-200 bg-white overflow-hidden transition-shadow hover:shadow-lg">
      <button onClick={onOpen} className="block w-full text-left">
        <div className="h-32 bg-stone-100 flex items-center justify-center overflow-hidden">
          {coverUrl ? (
            <img src={coverUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <Clapperboard size={28} className="text-stone-300" />
          )}
        </div>
        <div className="px-3.5 py-3">
          {editing ? (
            <input
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { onRename(name); setEditing(false); }
                if (e.key === 'Escape') { setName(project.name); setEditing(false); }
              }}
              onBlur={() => { onRename(name); setEditing(false); }}
              className="w-full text-sm font-medium text-stone-700 bg-stone-50 border border-stone-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-300"
            />
          ) : (
            <span className="text-sm font-medium text-stone-700 truncate block">{project.name}</span>
          )}
          <div className="flex items-center gap-2.5 mt-1.5 text-[11px] text-stone-400">
            <span className="flex items-center gap-1"><Clock size={10} />{timeAgo(project.updatedAt)}</span>
            <span>分镜 {project.stats.shots}</span>
            <span>成片 {project.stats.videosCompleted}</span>
          </div>
        </div>
      </button>
      <div className="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={(e) => { e.stopPropagation(); onExport(); }} disabled={exporting} className="p-1.5 rounded-lg bg-white/90 border border-stone-200 text-stone-400 hover:text-stone-600 shadow-sm disabled:opacity-50" title="导出工程到桌面">
          {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
        </button>
        <button onClick={(e) => { e.stopPropagation(); setEditing(true); }} className="p-1.5 rounded-lg bg-white/90 border border-stone-200 text-stone-400 hover:text-stone-600 shadow-sm" title="重命名">
          <Pencil size={12} />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-1.5 rounded-lg bg-white/90 border border-stone-200 text-stone-400 hover:text-red-500 shadow-sm" title="删除项目">
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

function FreeCanvasCard({ project, onExport, exporting }: {
  project: Project;
  onExport: () => void;
  exporting: boolean;
}) {
  const switchProject = useProjectStore((s) => s.switchProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const setActiveView = useChatStore((s) => s.setActiveView);

  const handleOpen = async () => {
    // 自由画布：关掉统一项目再切，避免 ProjectTopBar 误显
    await useUnifiedProjectStore.getState().closeUnified();
    await switchProject(project.id);
    setActiveView('canvas');
  };

  const handleDelete = async () => {
    const ok = await tauriConfirm(`删除画布「${project.name}」？（文件保留在磁盘）`, { title: '删除画布' });
    if (!ok) return;
    try {
      await deleteProject(project.id, false);
    } catch (err) {
      await tauriMessage(err instanceof Error ? err.message : String(err), { title: '无法删除' });
    }
  };

  return (
    <div className="group relative rounded-2xl border border-stone-200 bg-white overflow-hidden transition-shadow hover:shadow-md">
      <button onClick={() => void handleOpen()} className="block w-full text-left">
        <div className="h-24 bg-stone-100 flex items-center justify-center overflow-hidden">
          {project.coverUrl ? (
            <img src={project.coverUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <FolderOpen size={24} className="text-stone-300" />
          )}
        </div>
        <div className="px-3 py-2.5">
          <span className="text-[13px] font-medium text-stone-600 truncate block">{project.name}</span>
          <span className="text-[10px] text-stone-400">{timeAgo(project.updatedAt)}</span>
        </div>
      </button>
      <div className="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); onExport(); }}
          disabled={exporting}
          className="p-1.5 rounded-lg bg-white/90 border border-stone-200 text-stone-400 hover:text-stone-600 shadow-sm disabled:opacity-50"
          title="导出画布到桌面"
        >
          {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); void handleDelete(); }}
          className="p-1.5 rounded-lg bg-white/90 border border-stone-200 text-stone-400 hover:text-red-500 shadow-sm"
          title="删除"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}
