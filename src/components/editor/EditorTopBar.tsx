/**
 * EditorTopBar — 剪辑顶栏（瘦身版）：侧边栏开关 / 画幅 / 自动字幕 /
 * 智能剪口播 / 快捷键速查 / 导出。
 * 片段操作类按钮（撤销重做/分割删除/倒放镜像旋转/吸附踩点）已下移至
 * EditorToolbar（预览区与时间轴之间，剪映同款位置）。
 */
import { useEffect, useRef, useState } from 'react';
import {
  Subtitles, Download, SlidersHorizontal, Keyboard, Loader2,
  PanelLeftClose, Sparkles, ChevronDown,
} from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import { dispatchEditorPrompt } from './EditorChatPanel';
import { motionRouterPrompt } from '@/lib/motion/motionPrompt';
import { useSettingsStore } from '@/stores/settingsStore';
import { SHORTCUT_PANEL_EVENT } from '@/hooks/useEditorShortcuts';
import ExportDialog from './ExportDialog';
import { EDITOR_ASPECT_OPTIONS } from '@/lib/editor/aspect';

function Btn({ icon: Icon, label, onClick, disabled, busy }: {
  icon: typeof Subtitles; label: string; onClick: () => void;
  disabled?: boolean; busy?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      title={label}
      className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[rgba(255,255,255,0.06)] transition-colors disabled:opacity-35 shrink-0"
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />}
      <span className="hidden lg:inline whitespace-nowrap">{label}</span>
    </button>
  );
}

const MODES: { id: 'edit' | 'speech' | 'ai'; label: string }[] = [
  { id: 'edit', label: '剪辑' },
  { id: 'speech', label: '口播' },
  { id: 'ai', label: 'AI 成片' },
];

export default function EditorTopBar({ onAutoSubtitle, onSmartCut, onAiSmooth, transcribing }: {
  onAutoSubtitle: () => void;
  onSmartCut: () => void;
  onAiSmooth: () => void;
  transcribing: boolean;
}) {
  const clips = useEditorStore((s) => s.clips);
  const contentCount = useEditorStore((s) => (
    s.clips.length
    + s.overlayClips.length
    + s.textClips.length
    + s.fxClips.length
    + s.audioClips.length
    + s.subtitles.length
  ));
  const aspect = useEditorStore((s) => s.aspect);
  const workflowMode = useEditorStore((s) => s.workflowMode);
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar);
  const [exportOpen, setExportOpen] = useState(false);
  const [aspectOpen, setAspectOpen] = useState(false);
  const aspectRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!aspectOpen) return undefined;
    const close = (ev: PointerEvent) => {
      if (!aspectRef.current?.contains(ev.target as Node)) setAspectOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setAspectOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [aspectOpen]);

  return (
    <div
      className="flex items-center gap-1 px-3 shrink-0"
      style={{ height: 44, background: 'var(--canvas-panel)', borderBottom: '1px solid var(--canvas-node-border)' }}
    >
      {/* 收起侧边栏；收起时留等宽占位给 App 层全局 SidebarHandle（浮于左上角），标题不位移 */}
      {sidebarCollapsed ? (
        <div className="w-[26px] shrink-0" />
      ) : (
        <button
          onClick={toggleSidebar}
          title="收起侧边栏"
          className="flex items-center px-1.5 py-1 rounded-md text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[rgba(255,255,255,0.06)] transition-colors shrink-0"
        >
          <PanelLeftClose size={14} />
        </button>
      )}
      <div className="ml-0.5 min-w-[108px]">
        <p className="text-[12px] font-semibold text-[var(--canvas-text-1)] leading-tight">鲲鹏剪辑</p>
        <p className="text-[9px] text-[var(--canvas-text-3)] leading-tight">时间线 01</p>
      </div>

      <div className="flex-1 min-w-2" />

      {/* 工作流三模式（视图预设，不锁功能） */}
      <div
        className="flex items-center gap-0.5 p-0.5 rounded-full shrink-0"
        style={{ background: 'rgba(255,255,255,0.05)' }}
      >
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => useEditorStore.getState().setWorkflowMode(m.id)}
            className={`px-3 py-1 rounded-full text-[12px] transition-colors whitespace-nowrap ${
              workflowMode === m.id
                ? 'text-black bg-white font-medium'
                : 'text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)]'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-w-2" />

      {/* 口播模式：两颗主按钮前置高亮 */}
      {workflowMode === 'speech' && (
        <>
          <button
            onClick={onSmartCut}
            disabled={clips.length === 0 || transcribing}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors disabled:opacity-35 shrink-0"
            style={{ background: 'rgba(255,255,255,0.10)', color: 'var(--canvas-text-1)' }}
          >
            {transcribing ? <Loader2 size={12} className="animate-spin" /> : <SlidersHorizontal size={12} />}
            智能剪口播
          </button>
          <button
            onClick={onAiSmooth}
            disabled={clips.length === 0}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors disabled:opacity-35 shrink-0"
            style={{ background: 'rgba(255,255,255,0.10)', color: 'var(--canvas-text-1)' }}
          >
            <Sparkles size={12} /> AI 剪流畅
          </button>
        </>
      )}

      <div ref={aspectRef} className="relative shrink-0">
        <button
          onClick={() => setAspectOpen((v) => !v)}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[rgba(255,255,255,0.06)] font-mono"
          title="选择画幅"
        >
          {aspect}
          <ChevronDown size={11} className={`transition-transform ${aspectOpen ? 'rotate-180' : ''}`} />
        </button>
        {aspectOpen && (
          <div
            className="absolute right-0 top-[calc(100%+6px)] z-50 w-36 rounded-xl border border-[rgba(255,255,255,0.10)] p-1 shadow-2xl"
            style={{ background: '#252525' }}
          >
            {EDITOR_ASPECT_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => {
                  useEditorStore.getState().setAspect(opt.id);
                  setAspectOpen(false);
                }}
                className={`w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[12px] transition-colors ${
                  aspect === opt.id
                    ? 'text-[#18d8df] bg-[rgba(24,216,223,0.12)]'
                    : 'text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[rgba(255,255,255,0.06)]'
                }`}
              >
                <span>{opt.label}</span>
                {aspect === opt.id && <span className="text-[10px]">当前</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <Btn icon={Subtitles} label="自动字幕" onClick={onAutoSubtitle} busy={transcribing} disabled={clips.length === 0} />
      <Btn icon={SlidersHorizontal} label="智能剪口播" onClick={onSmartCut} disabled={clips.length === 0} />
      <Btn
        icon={Sparkles}
        label="AI 配特效"
        onClick={() => dispatchEditorPrompt(motionRouterPrompt())}
        disabled={contentCount === 0}
      />
      <Btn icon={Keyboard} label="快捷键" onClick={() => window.dispatchEvent(new CustomEvent(SHORTCUT_PANEL_EVENT))} />
      <button
        onClick={() => setExportOpen(true)}
        disabled={contentCount === 0}
        className="flex items-center gap-1.5 ml-1 px-4 py-1.5 rounded-lg text-[12px] font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40 shrink-0"
        style={{ background: '#ffffff' }}
      >
        <Download size={13} /> 导出
      </button>
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
    </div>
  );
}
