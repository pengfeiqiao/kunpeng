/**
 * ProjectSwitcher — current-project dropdown pinned to the canvas top bar.
 */
import { useState, useRef, useEffect } from 'react';
import { ChevronDown, FolderOpen, Plus, LayoutGrid, Loader2 } from 'lucide-react';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores/chatStore';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';

export default function ProjectSwitcher() {
  const { projects, activeProjectId, switching, switchProject, createProject } = useProjectStore();
  const unifiedOpening = useUnifiedProjectStore((s) => s.opening);
  const setActiveView = useChatStore((s) => s.setActiveView);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const active = projects.find((p) => p.id === activeProjectId);
  const busy = switching || unifiedOpening;

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const handleCreate = async () => {
    // window.prompt is unavailable in Tauri WebView — create with a default
    // name; rename from the project console.
    const id = await createProject(`新项目 ${projects.length + 1}`);
    await useUnifiedProjectStore.getState().closeUnified();
    await switchProject(id);
    setOpen(false);
  };

  const handleSwitch = async (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    if (project.aigcProjectId) {
      await useUnifiedProjectStore.getState().openUnified(project.aigcProjectId);
    } else {
      await useUnifiedProjectStore.getState().closeUnified();
      await switchProject(project.id);
    }
    setOpen(false);
  };

  return (
    <div ref={ref} className="absolute top-3 left-1/2 -translate-x-1/2 z-20">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--canvas-panel)] backdrop-blur-sm border border-[var(--canvas-node-border)] shadow-sm hover:bg-[var(--canvas-controls-hover)] transition-colors"
      >
        {busy
          ? <Loader2 size={13} className="animate-spin text-[var(--canvas-text-2)]" />
          : <FolderOpen size={13} className="text-[var(--canvas-text-2)]" />}
        <span className="text-[12px] font-medium text-[var(--canvas-text-1)] max-w-[160px] truncate">
          {active?.name ?? '未选择项目'}
        </span>
        <ChevronDown size={12} className="text-[var(--canvas-text-2)]" />
      </button>

      {open && (
        <div className="absolute top-full mt-1.5 left-1/2 -translate-x-1/2 w-56 bg-[var(--canvas-panel)] rounded-xl border border-[var(--canvas-node-border)] shadow-xl py-1 overflow-hidden">
          <div className="max-h-64 overflow-y-auto">
            {[...projects].sort((a, b) => b.updatedAt - a.updatedAt).map((p) => (
              <button
                key={p.id}
                onClick={() => void handleSwitch(p.id)}
                disabled={busy}
                className={`w-full text-left px-3 py-2 text-[12px] hover:bg-[var(--canvas-controls-hover)] flex items-center gap-2 ${
                  p.id === activeProjectId ? 'text-indigo-600 font-medium' : 'text-[var(--canvas-text-1)]'
                }`}
              >
                <FolderOpen size={12} className="shrink-0 opacity-50" />
                <span className="truncate">{p.name}</span>
              </button>
            ))}
          </div>
          <div className="border-t border-[var(--canvas-node-border)] mt-1 pt-1">
            <button
              onClick={() => void handleCreate()}
              className="w-full text-left px-3 py-2 text-[12px] text-[var(--canvas-text-2)] hover:bg-[var(--canvas-controls-hover)] flex items-center gap-2"
            >
              <Plus size={12} />新建项目
            </button>
            <button
              onClick={() => { setActiveView('projects'); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-[12px] text-[var(--canvas-text-2)] hover:bg-[var(--canvas-controls-hover)] flex items-center gap-2"
            >
              <LayoutGrid size={12} />项目管理台
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
