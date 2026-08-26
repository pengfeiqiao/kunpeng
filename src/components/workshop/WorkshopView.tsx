/**
 * WorkshopView — 创作工坊全屏视图（小云雀/火山剧创式 6 步流水线）。
 * 顶栏 + 左 StepNav + 主区当前步骤 + 右抽屉鲲鹏助手。
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Clapperboard, FileUp, Loader2, PanelLeftClose, Plus, Sparkles, Trash2 } from 'lucide-react';
import { confirm as tauriConfirm } from '@tauri-apps/api/dialog';
import { useWorkshopStore } from '@/stores/workshopStore';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';
import { useChatStore } from '@/stores';
import { useSettingsStore } from '@/stores/settingsStore';
import { useMemoryStore } from '@/stores/memoryStore';
import DirectorTab from '../memory/DirectorTab';
import ShotPatternTab from '../memory/ShotPatternTab';
import GenerationLogTab from '../memory/GenerationLogTab';
import { listProjects, deleteProject, type AigcProject } from '@/lib/aigc/projectStore';
import { buildAutoRunPrompt, buildExportPrompt } from '@/lib/workshop/workshopPrompts';
import StepNav from './StepNav';
import WorkshopChatPanel, { dispatchWorkshopPrompt } from './WorkshopChatPanel';
import AiBoxOverlay, { type AiBoxRect } from '@/components/shared/AiBoxOverlay';
import StepScript from './steps/StepScript';
import StepBreakdown from './steps/StepBreakdown';
import StepAssets from './steps/StepAssets';
import StepPrompts from './steps/StepPrompts';
import StepGenerate from './steps/StepGenerate';
import StepHandoff from './steps/StepHandoff';
import TaskQueuePanel from '@/components/canvas/TaskQueuePanel';
import UndoToast from './UndoToast';

interface Props {
  onSendMessage: (content: string, filePaths?: string[]) => Promise<void> | void;
  onAbort: () => void;
}

export default function WorkshopView({ onSendMessage, onAbort }: Props) {
  const project = useWorkshopStore((s) => s.project);
  // 只订阅 currentStep：store 任何写入都会换 data 引用，整订 data 会让整个工坊壳层每次重写
  const currentStep = useWorkshopStore((s) => s.data?.currentStep);
  const contentRef = useRef<HTMLDivElement>(null);
  const [altHeld, setAltHeld] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Alt') setAltHeld(true); };
    const up = (e: KeyboardEvent) => { if (e.key === 'Alt') setAltHeld(false); };
    const blur = () => setAltHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const handleAiBox = (rect: AiBoxRect, instruction: string) => {
    const container = contentRef.current;
    if (!container) return;
    const box = container.getBoundingClientRect();
    const absX = box.left + rect.x;
    const absY = box.top + rect.y;
    const items: string[] = [];
    container.querySelectorAll<HTMLElement>('[data-asset-id], [data-shot-no]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.right > absX && r.left < absX + rect.width && r.bottom > absY && r.top < absY + rect.height) {
        const assetId = el.dataset.assetId;
        const assetKind = el.dataset.assetKind;
        const shotNo = el.dataset.shotNo;
        if (assetId) items.push(`${assetKind}:${assetId}`);
        if (shotNo) items.push(`shot:${shotNo}`);
      }
    });
    const desc = items.length > 0
      ? `用户在工坊中框选了 ${items.length} 个元素：${items.join(', ')}。\n指令：${instruction}`
      : `用户在工坊中画了一个框。\n指令：${instruction}`;
    dispatchWorkshopPrompt(`[工坊 AI 区域操作]\n${desc}`);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 canvas-dark relative" style={{ background: 'var(--canvas-bg)' }}>
      {project && currentStep ? (
        <>
          <TopBar />
          <div className="flex-1 flex min-h-0 relative">
            <StepNav />
            <div ref={contentRef} className="flex-1 min-w-0 overflow-y-auto relative">
              {currentStep === 'script' && <StepScript />}
              {currentStep === 'breakdown' && <StepBreakdown />}
              {currentStep === 'assets' && <StepAssets />}
              {currentStep === 'prompts' && <StepPrompts />}
              {currentStep === 'generate' && <StepGenerate />}
              {currentStep === 'handoff' && <StepHandoff />}
              <AiBoxOverlay active={altHeld} containerRef={contentRef} onSubmit={handleAiBox} onCancel={() => setAltHeld(false)} />
            </div>
            <WorkshopChatPanel onSendMessage={onSendMessage} onAbort={onAbort} />
            <TaskQueuePanel />
            <UndoToast />
          </div>
        </>
      ) : (
        <WorkshopHome />
      )}
    </div>
  );
}

function TopBar() {
  const project = useWorkshopStore((s) => s.project);
  // steps / currentStep 都是稳定引用或标量：步骤状态或当前步骤不变时 TopBar 不重渲染
  const steps = useWorkshopStore((s) => s.data?.steps);
  const currentStep = useWorkshopStore((s) => s.data?.currentStep);
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar);
  const closeUnified = useUnifiedProjectStore((s) => s.closeUnified);
  const close = () => void closeUnified();

  if (!project || !steps || !currentStep) return null;
  const doneCount = Object.values(steps).filter((s) => s.status === 'done').length;

  return (
    <div
      className="flex items-center gap-3 px-4 shrink-0"
      style={{ height: 48, background: 'var(--canvas-panel)', borderBottom: '1px solid var(--canvas-node-border)' }}
    >
      {/* 收起侧边栏；收起时留等宽占位给 App 层全局 SidebarHandle（浮于左上角），后续按钮不位移 */}
      {sidebarCollapsed ? (
        <div className="w-[31px] shrink-0" />
      ) : (
        <button
          onClick={toggleSidebar}
          className="p-2 rounded-lg text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] transition-colors"
          title="收起侧边栏"
        >
          <PanelLeftClose size={15} />
        </button>
      )}
      <button
        onClick={close}
        className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[12px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] transition-colors"
      >
        <ArrowLeft size={14} /> 项目列表
      </button>
      <div className="flex items-center gap-2 min-w-0">
        <Clapperboard size={15} className="text-[var(--canvas-accent)] shrink-0" />
        <span className="text-[14px] font-medium text-[var(--canvas-text-1)] truncate">{project.name}</span>
        <span className="text-[11px] text-[var(--canvas-text-3)]">{doneCount}/6 步完成</span>
      </div>
      <div className="flex-1" />
      <button
        onClick={() => dispatchWorkshopPrompt(buildExportPrompt(currentStep))}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-[var(--canvas-text-2)] border border-[var(--canvas-node-border)] hover:text-[var(--canvas-text-1)] hover:border-[var(--canvas-node-border-selected)] transition-colors"
        title="把当前步骤导出为飞书云文档（统一格式）"
      >
        <FileUp size={13} /> 导出飞书
      </button>
      <button
        onClick={() => dispatchWorkshopPrompt(buildAutoRunPrompt())}
        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12px] text-white transition-opacity hover:opacity-90"
        style={{ background: 'var(--canvas-accent)' }}
        title="AI 自动执行拆解→资产→提示词→生成（生成前会确认）"
      >
        <Sparkles size={13} /> 一键全流程
      </button>
    </div>
  );
}

const HOME_TABS = [
  { id: 'projects', label: '项目' },
  { id: 'directors', label: '导演风格' },
  { id: 'shots', label: '镜头模板' },
  { id: 'history', label: '生成记录' },
] as const;
type HomeTab = (typeof HOME_TABS)[number]['id'];

function WorkshopHome() {
  const [projects, setProjects] = useState<AigcProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<HomeTab>('projects');
  const openUnified = useUnifiedProjectStore((s) => s.openUnified);
  const createAndOpen = useWorkshopStore((s) => s.createAndOpen);
  const setActiveView = useChatStore((s) => s.setActiveView);
  const memLoaded = useMemoryStore((s) => s.loaded);
  const loadAll = useMemoryStore((s) => s.loadAll);

  const refresh = async () => {
    setLoading(true);
    try { setProjects(await listProjects()); } finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);
  // 全局记忆（导演 DNA / 镜头模式 / 生成历史）懒加载
  useEffect(() => {
    if (tab !== 'projects' && !memLoaded) loadAll();
  }, [tab, memLoaded, loadAll]);

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      await createAndOpen(`短剧项目 ${new Date().getMonth() + 1}-${new Date().getDate()}`);
      const id = useWorkshopStore.getState().project?.id;
      if (id) await openUnified(id);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (p: AigcProject) => {
    const ok = await tauriConfirm(`删除项目「${p.name}」？目录与产物将一并删除，不可恢复。`, { title: '删除项目', type: 'warning' });
    if (!ok) return;
    await deleteProject(p.id);
    void refresh();
  };

  return (
    <div className="flex-1 overflow-y-auto px-10 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[var(--canvas-text-1)] flex items-center gap-2">
            <Clapperboard size={20} className="text-[var(--canvas-accent)]" /> 短剧工坊
          </h1>
          <p className="text-[12px] text-[var(--canvas-text-3)] mt-1">
            项目工坊（剧本→拆解→资产→提示词→生成→交付）+ 导演 DNA / 镜头模式 / 生成历史
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveView('chat')}
            className="px-3 py-1.5 rounded-lg text-[12px] text-[var(--canvas-text-2)] border border-[var(--canvas-node-border)] hover:text-[var(--canvas-text-1)] transition-colors"
          >
            返回对话
          </button>
          <button
            onClick={() => void handleCreate()}
            disabled={creating}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12px] text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: 'var(--canvas-accent)' }}
          >
            {creating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} 新建项目
          </button>
        </div>
      </div>

      {/* Tabs: 项目工坊 + 全局记忆 */}
      <div className="flex gap-1 mb-5 border-b border-[var(--canvas-node-border)]">
        {HOME_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="px-4 py-2 text-[13px] transition-colors -mb-px"
            style={{
              color: tab === t.id ? 'var(--canvas-text-1)' : 'var(--canvas-text-3)',
              borderBottom: tab === t.id ? '2px solid var(--canvas-accent)' : '2px solid transparent',
              fontWeight: tab === t.id ? 600 : 400,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'directors' ? (
        <DirectorTab />
      ) : tab === 'shots' ? (
        <ShotPatternTab />
      ) : tab === 'history' ? (
        <GenerationLogTab />
      ) : loading ? (
        <div className="text-center py-20 text-[var(--canvas-text-3)] text-sm">
          <Loader2 size={16} className="animate-spin inline mr-2" /> 加载中…
        </div>
      ) : projects.length === 0 ? (
        <button
          onClick={() => void handleCreate()}
          className="w-full py-20 rounded-2xl border border-dashed border-[var(--canvas-node-border)] text-[var(--canvas-text-2)] hover:border-[var(--canvas-node-border-selected)] hover:text-[var(--canvas-text-1)] transition-colors"
        >
          <Plus size={20} className="mx-auto mb-2" />
          <span className="text-[13px]">创建第一个短剧项目</span>
        </button>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {projects.map((p) => (
            <div
              key={p.id}
              className="group relative rounded-2xl border border-[var(--canvas-node-border)] p-4 cursor-pointer hover:border-[var(--canvas-node-border-selected)] transition-colors"
              style={{ background: 'var(--canvas-node-bg)' }}
              onClick={() => void openUnified(p.id)}
            >
              <h3 className="text-[14px] font-medium text-[var(--canvas-text-1)] truncate pr-6">{p.name}</h3>
              <p className="text-[11px] text-[var(--canvas-text-3)] mt-1">
                {new Date(p.updatedAt).toLocaleDateString('zh-CN')} · {p.status}
              </p>
              <div className="flex items-center gap-3 mt-3 text-[11px] text-[var(--canvas-text-2)]">
                <span>分镜 {p.stats.shots}</span>
                <span>资产 {p.stats.assets}</span>
                <span>成片 {p.stats.videosCompleted}</span>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); void handleDelete(p); }}
                className="absolute top-3 right-3 p-1 rounded opacity-0 group-hover:opacity-100 text-[var(--canvas-text-3)] hover:text-red-400 transition-all"
                title="删除项目"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
