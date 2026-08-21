/**
 * ProjectTopBar — 统一项目模式下恒显的顶栏（Adobe 式）：
 * 项目名 + 工坊/画布/剪辑视图切换 + 返回项目列表。
 * 自由模式（无打开的统一项目）不渲染。
 */
import { ArrowLeft, Clapperboard, LayoutDashboard, Scissors, Wrench } from 'lucide-react';
import { useChatStore } from '@/stores';
import { useWorkshopStore } from '@/stores/workshopStore';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';

const VIEW_TABS = [
  { view: 'workshop' as const, label: '工坊', icon: Wrench },
  { view: 'canvas' as const, label: '画布', icon: LayoutDashboard },
  { view: 'editor' as const, label: '剪辑', icon: Scissors },
];

export default function ProjectTopBar() {
  const activeView = useChatStore((s) => s.activeView);
  const setActiveView = useChatStore((s) => s.setActiveView);
  const project = useWorkshopStore((s) => s.project);
  const activeId = useUnifiedProjectStore((s) => s.activeId);
  const closeUnified = useUnifiedProjectStore((s) => s.closeUnified);

  const visible = Boolean(project && activeId)
    && (activeView === 'workshop' || activeView === 'canvas' || activeView === 'editor');
  if (!visible) return null;

  return (
    <div
      className="canvas-dark flex items-center gap-3 px-3 shrink-0"
      style={{ height: 38, background: '#101012', borderBottom: '1px solid var(--canvas-node-border)' }}
    >
      <button
        onClick={() => { void closeUnified(); setActiveView('workshop'); }}
        className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] transition-colors"
        title="返回项目列表"
      >
        <ArrowLeft size={12} />
      </button>
      <div className="flex items-center gap-1.5 min-w-0">
        <Clapperboard size={13} className="text-[var(--canvas-accent)] shrink-0" />
        <span className="text-[12px] font-medium text-[var(--canvas-text-1)] truncate max-w-[220px]">
          {project!.name}
        </span>
      </div>
      <div className="flex items-center gap-0.5 ml-2">
        {VIEW_TABS.map((t) => {
          const active = activeView === t.view;
          return (
            <button
              key={t.view}
              onClick={() => setActiveView(t.view)}
              className="flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] transition-colors"
              style={{
                background: active ? 'rgba(31,162,220,0.15)' : 'transparent',
                color: active ? 'var(--canvas-accent)' : 'var(--canvas-text-2)',
                fontWeight: active ? 600 : 400,
              }}
            >
              <t.icon size={12} /> {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
