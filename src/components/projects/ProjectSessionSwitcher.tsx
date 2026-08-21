/**
 * ProjectSessionSwitcher — 抽屉头部的项目对话切换器：
 * 当前对话名下拉（该项目全部对话）+ 新建对话。
 * 仅统一项目模式渲染。
 */
import { useState } from 'react';
import { ChevronDown, MessageSquarePlus } from 'lucide-react';
import { useChatStore } from '@/stores';
import { useWorkshopStore } from '@/stores/workshopStore';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';
import { createProjectSession } from '@/lib/projectSessions';
import { loadSessionRaw } from '@/hooks/useSessions';

export default function ProjectSessionSwitcher() {
  const [open, setOpen] = useState(false);
  const activeId = useUnifiedProjectStore((s) => s.activeId);
  const project = useWorkshopStore((s) => s.project);
  const sessions = useChatStore((s) => s.sessions);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const isStreaming = useChatStore((s) => s.isStreaming);

  if (!activeId || !project) return null;

  const projectSessions = sessions
    .filter((s) => s.projectId === activeId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const current = projectSessions.find((s) => s.id === currentSessionId);

  const handleSwitch = async (id: string) => {
    setOpen(false);
    if (isStreaming) return;
    await loadSessionRaw(id);
  };

  const handleNew = async () => {
    setOpen(false);
    if (isStreaming) return;
    await createProjectSession(activeId, project.name);
  };

  const surfaceStyle = {
    background: 'var(--canvas-panel, rgb(var(--c-card)))',
    borderColor: 'var(--canvas-node-border, rgb(var(--c-border)))',
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] transition-colors max-w-[140px]"
        title="切换项目对话"
      >
        <span className="truncate">
          {current ? current.title.replace(`${project.name} · `, '') : '对话'}
        </span>
        <ChevronDown size={10} className="shrink-0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute top-full right-0 mt-1 w-[200px] z-50 rounded-xl border py-1 shadow-xl"
            style={surfaceStyle}
          >
            {projectSessions.map((s) => (
              <button
                key={s.id}
                onClick={() => void handleSwitch(s.id)}
                className="w-full text-left px-3 py-1.5 text-[11px] transition-colors truncate"
                style={{
                  color: s.id === currentSessionId ? 'var(--canvas-accent, rgb(2 132 199))' : 'var(--canvas-text-2, rgb(var(--c-text-muted)))',
                  fontWeight: s.id === currentSessionId ? 600 : 400,
                }}
              >
                {s.title.replace(`${project.name} · `, '')}
                <span className="ml-1.5 text-[9px] text-[var(--canvas-text-3)]">{s.messageCount} 条</span>
              </button>
            ))}
            <div className="border-t mt-1 pt-1" style={{ borderColor: 'var(--canvas-node-border, rgb(var(--c-border)))' }}>
              <button
                onClick={() => void handleNew()}
                disabled={isStreaming}
                className="w-full text-left px-3 py-1.5 text-[11px] transition-colors flex items-center gap-1.5 disabled:opacity-40"
                style={{ color: 'var(--canvas-text-2, rgb(var(--c-text-muted)))' }}
              >
                <MessageSquarePlus size={11} /> 新建对话
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
