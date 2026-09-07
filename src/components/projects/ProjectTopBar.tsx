/**
 * ProjectTopBar — 统一项目模式下恒显的顶栏（Adobe 式）：
 * 项目名 + 工坊/画布/剪辑视图切换 + 返回项目列表。
 * 自由模式（无打开的统一项目）不渲染。
 */
import { useEffect, useState } from 'react';
import { ArrowLeft, Bot, ChevronDown, Clapperboard, LayoutDashboard, MessageSquare, Scissors, X, Wrench, History } from 'lucide-react';
import { useChatStore } from '@/stores';
import { useWorkshopStore } from '@/stores/workshopStore';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';
import { summarizeProjectSpec } from '@/lib/projectObjects/projectSpec';
import { WORKSPACE_ENGINES } from '@/lib/workspace/engineCatalog';
import type { ProjectSpec } from '@/lib/projectObjects/types';
import ProjectSnapshotPanel from './ProjectSnapshotPanel';

const VIEW_TABS = [
  { view: 'chat' as const, label: '对话', icon: MessageSquare },
  { view: 'workshop' as const, label: '工坊', icon: Wrench },
  { view: 'canvas' as const, label: '画布', icon: LayoutDashboard },
  { view: 'editor' as const, label: '剪辑', icon: Scissors },
];

function lines(value: string): string[] {
  return value.split('\n').map((item) => item.trim()).filter(Boolean);
}

const imageEngines = WORKSPACE_ENGINES.filter((engine) => engine.kind === 'image')
  .filter((engine, index, list) => list.findIndex((item) => item.label === engine.label) === index);
const videoEngines = WORKSPACE_ENGINES.filter((engine) => engine.kind === 'video')
  .filter((engine, index, list) => list.findIndex((item) => item.label === engine.label) === index);

export function SpecEditor({ spec, onClose, onSave }: {
  spec: ProjectSpec;
  onClose: () => void;
  onSave: (patch: Partial<ProjectSpec>) => void;
}) {
  const [draft, setDraft] = useState(() => ({
    aspectRatio: spec.aspectRatio ?? '',
    targetDurationSec: spec.targetDurationSec ? String(spec.targetDurationSec) : '',
    language: spec.language ?? '',
    styleTone: spec.styleTone ?? '',
    worldAndCharacters: spec.worldAndCharacters ?? '',
    defaultImageModel: spec.defaultImageModel ?? '',
    defaultVideoModel: spec.defaultVideoModel ?? '',
    continuityFacts: (spec.continuityFacts ?? []).join('\n'),
    forbidden: (spec.forbidden ?? []).join('\n'),
    generationConfirmation: spec.generationConfirmation,
  }));
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const field = (key: keyof typeof draft, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-6" onMouseDown={onClose}>
      <div className="canvas-dark w-full max-w-[760px] max-h-[86vh] overflow-y-auto rounded-lg border border-[var(--canvas-node-border)] bg-[#171719] shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--canvas-node-border)] bg-[#171719] px-5 py-4">
          <div><h2 className="text-[15px] font-semibold text-[var(--canvas-text-1)]">项目规格</h2><p className="mt-1 text-[11px] text-[var(--canvas-text-3)]">工坊、画布、剪辑和对话共同遵循</p></div>
          <button onClick={onClose} className="p-2 text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-1)]" title="关闭"><X size={16} /></button>
        </header>
        <div className="grid grid-cols-2 gap-4 p-5">
          <label className="text-[11px] text-[var(--canvas-text-2)]">画幅<input value={draft.aspectRatio} onChange={(e) => field('aspectRatio', e.target.value)} placeholder="16:9" className="mt-1 w-full rounded-md border border-[var(--canvas-node-border)] bg-[#111113] px-3 py-2 text-[12px] text-[var(--canvas-text-1)]" /></label>
          <label className="text-[11px] text-[var(--canvas-text-2)]">目标时长（秒）<input type="number" min="1" value={draft.targetDurationSec} onChange={(e) => field('targetDurationSec', e.target.value)} placeholder="60" className="mt-1 w-full rounded-md border border-[var(--canvas-node-border)] bg-[#111113] px-3 py-2 text-[12px] text-[var(--canvas-text-1)]" /></label>
          <label className="text-[11px] text-[var(--canvas-text-2)]">语言<input value={draft.language} onChange={(e) => field('language', e.target.value)} placeholder="中文" className="mt-1 w-full rounded-md border border-[var(--canvas-node-border)] bg-[#111113] px-3 py-2 text-[12px] text-[var(--canvas-text-1)]" /></label>
          <label className="col-span-2 text-[11px] text-[var(--canvas-text-2)]">视觉与语气<input value={draft.styleTone} onChange={(e) => field('styleTone', e.target.value)} placeholder="克制、写实、低饱和" className="mt-1 w-full rounded-md border border-[var(--canvas-node-border)] bg-[#111113] px-3 py-2 text-[12px] text-[var(--canvas-text-1)]" /></label>
          <label className="col-span-2 text-[11px] text-[var(--canvas-text-2)]">世界观与人物<textarea value={draft.worldAndCharacters} onChange={(e) => field('worldAndCharacters', e.target.value)} rows={3} className="mt-1 w-full resize-y rounded-md border border-[var(--canvas-node-border)] bg-[#111113] px-3 py-2 text-[12px] text-[var(--canvas-text-1)]" /></label>
          <label className="text-[11px] text-[var(--canvas-text-2)]">连续性事实（每行一条）<textarea value={draft.continuityFacts} onChange={(e) => field('continuityFacts', e.target.value)} rows={4} className="mt-1 w-full resize-y rounded-md border border-[var(--canvas-node-border)] bg-[#111113] px-3 py-2 text-[12px] text-[var(--canvas-text-1)]" /></label>
          <label className="text-[11px] text-[var(--canvas-text-2)]">禁止项（每行一条）<textarea value={draft.forbidden} onChange={(e) => field('forbidden', e.target.value)} rows={4} className="mt-1 w-full resize-y rounded-md border border-[var(--canvas-node-border)] bg-[#111113] px-3 py-2 text-[12px] text-[var(--canvas-text-1)]" /></label>
          <label className="text-[11px] text-[var(--canvas-text-2)]">默认生图模型<select value={draft.defaultImageModel} onChange={(e) => field('defaultImageModel', e.target.value)} className="mt-1 w-full rounded-md border border-[var(--canvas-node-border)] bg-[#111113] px-3 py-2 text-[12px] text-[var(--canvas-text-1)]"><option value="">未指定</option>{imageEngines.map((engine) => <option key={engine.id} value={engine.id}>{engine.label}</option>)}</select></label>
          <label className="text-[11px] text-[var(--canvas-text-2)]">默认视频模型<select value={draft.defaultVideoModel} onChange={(e) => field('defaultVideoModel', e.target.value)} className="mt-1 w-full rounded-md border border-[var(--canvas-node-border)] bg-[#111113] px-3 py-2 text-[12px] text-[var(--canvas-text-1)]"><option value="">未指定</option>{videoEngines.map((engine) => <option key={engine.id} value={engine.id}>{engine.label}</option>)}</select></label>
          <label className="col-span-2 text-[11px] text-[var(--canvas-text-2)]">生成前确认<select value={draft.generationConfirmation} onChange={(e) => field('generationConfirmation', e.target.value)} className="mt-1 w-full rounded-md border border-[var(--canvas-node-border)] bg-[#111113] px-3 py-2 text-[12px] text-[var(--canvas-text-1)]"><option value="always-confirm">每次生成前确认</option><option value="paid-only-confirm">仅付费生成前确认（推荐）</option><option value="direct-execute">允许直接执行</option></select></label>
        </div>
        <footer className="sticky bottom-0 flex justify-end gap-2 border-t border-[var(--canvas-node-border)] bg-[#171719] px-5 py-4"><button onClick={onClose} className="px-4 py-2 text-[12px] text-[var(--canvas-text-2)]">取消</button><button onClick={() => { onSave({ aspectRatio: draft.aspectRatio || undefined, targetDurationSec: draft.targetDurationSec ? Math.max(1, Number(draft.targetDurationSec)) : undefined, language: draft.language || undefined, styleTone: draft.styleTone || undefined, worldAndCharacters: draft.worldAndCharacters || undefined, defaultImageModel: draft.defaultImageModel || undefined, defaultVideoModel: draft.defaultVideoModel || undefined, continuityFacts: lines(draft.continuityFacts), forbidden: lines(draft.forbidden), generationConfirmation: draft.generationConfirmation as ProjectSpec['generationConfirmation'] }); onClose(); }} className="rounded-md bg-white px-4 py-2 text-[12px] font-medium text-black">保存规格</button></footer>
      </div>
    </div>
  );
}

export default function ProjectTopBar() {
  const activeView = useChatStore((s) => s.activeView);
  const setActiveView = useChatStore((s) => s.setActiveView);
  const project = useWorkshopStore((s) => s.project);
  const spec = useWorkshopStore((s) => s.data?.projectSpec);
  const agentDrawerState = useWorkshopStore((s) => s.data?.projectViewState?.agentDrawerState);
  const updateProjectSpec = useWorkshopStore((s) => s.updateProjectSpec);
  const updateProjectViewState = useWorkshopStore((s) => s.updateProjectViewState);
  const activeId = useUnifiedProjectStore((s) => s.activeId);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const closeUnified = useUnifiedProjectStore((s) => s.closeUnified);
  const [editingSpec, setEditingSpec] = useState(false);
  const [showSnapshots, setShowSnapshots] = useState(false);

  useEffect(() => {
    if (!activeId) return;
    updateProjectViewState({
      activeConversationId: currentSessionId ?? undefined,
      activeView: activeView === 'chat' || activeView === 'workshop' || activeView === 'canvas' || activeView === 'editor'
        ? activeView
        : undefined,
    });
  }, [activeId, activeView, currentSessionId, updateProjectViewState]);

  const visible = Boolean(project && activeId)
    && (activeView === 'chat' || activeView === 'workshop' || activeView === 'canvas' || activeView === 'editor');
  if (!visible) return null;

  return (
    <div
      className="canvas-dark flex items-center gap-3 px-3 shrink-0"
      style={{ height: 38, background: '#101012', borderBottom: '1px solid var(--canvas-node-border)' }}
    >
      <button
        onClick={() => { void closeUnified(); setActiveView('projects'); }}
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
              onClick={() => {
                // 画布/剪辑/工坊统一进入项目工作台对应工作面，不再跳旧版独立页面
                if (t.view === 'chat') {
                  updateProjectViewState({ activeView: 'chat' });
                  setActiveView('chat');
                  return;
                }
                updateProjectViewState({
                  activeView: 'workshop',
                  ...(t.view === 'canvas'
                    ? { workspaceSurface: 'media' as const, workspaceMediaView: 'canvas' as const }
                    : t.view === 'editor'
                      ? { workspaceSurface: 'editor' as const }
                      : { workspaceSurface: 'media' as const, workspaceMediaView: 'list' as const }),
                });
                setActiveView('workshop');
              }}
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
      <button onClick={() => setEditingSpec(true)} className="ml-auto flex min-w-0 max-w-[420px] items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-[var(--canvas-text-3)] hover:bg-[var(--canvas-controls-hover)] hover:text-[var(--canvas-text-1)]" title="查看和编辑项目规格"><span className="truncate">{summarizeProjectSpec(spec)}</span><ChevronDown size={12} className="shrink-0" /></button>
      {agentDrawerState === 'hidden' ? (
        <button
          onClick={() => updateProjectViewState({ agentDrawerState: 'expanded' })}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-[var(--canvas-text-2)] hover:bg-[var(--canvas-controls-hover)] hover:text-[var(--canvas-text-1)]"
          title="打开项目助手"
        >
          <Bot size={12} /> 助手
        </button>
      ) : null}
      {editingSpec && spec ? <SpecEditor spec={spec} onClose={() => setEditingSpec(false)} onSave={updateProjectSpec} /> : null}
      <button onClick={() => setShowSnapshots(true)} title="项目快照" aria-label="项目快照" className="shrink-0 rounded-md p-1.5 text-[var(--canvas-text-2)] hover:bg-[var(--canvas-controls-hover)]"><History size={15} /></button>
      {showSnapshots && <ProjectSnapshotPanel key={activeId} onClose={() => setShowSnapshots(false)} />}
    </div>
  );
}
