/**
 * EditorView — 剪辑视图六区布局（v3）：
 * 顶部操作栏 / 左侧资源库（竖 tab）/ 中央分层预览 / 右侧属性 /
 * 底部多轨时间轴 / 右缘鲲鹏抽屉。
 * 自动字幕与智能剪口播在此实现（TopBar 只发回调，信号流单向）。
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { message as tauriMessage } from '@tauri-apps/api/dialog';
import { useEditorStore } from '@/stores/editorStore';
import { useEditorShortcuts } from '@/hooks/useEditorShortcuts';
import { useEditorPrerender } from '@/hooks/useEditorPrerender';
import { transcribeEditorTimelineAudio } from '@/lib/editor/transcribe';
import { runSpeechAudit, isAuditRunning } from '@/lib/editor/speechAudit/engine';
import { captureEditorSnapshot } from '@/lib/editor/editorHistory';
import EditorTopBar from './EditorTopBar';
import EditorToolbar from './EditorToolbar';
import ShortcutPanel from './ShortcutPanel';
import LeftPanel, { type LeftTab } from './LeftPanel';
import PreviewPlayer from './PreviewPlayer';
import PropertiesPanel from './PropertiesPanel';
import TimelineTracks from './TimelineTracks';
import EditorChatPanel, { EDITOR_DRAWER_OPEN_EVENT, dispatchEditorPrompt } from './EditorChatPanel';
import PlanPanel from './PlanPanel';
import SpeechCutPanel from './SpeechCutPanel';
import AiBoxOverlay, { type AiBoxRect } from '@/components/shared/AiBoxOverlay';

interface EditorViewProps {
  onSendMessage: (content: string, filePaths?: string[]) => void;
  onAbort: () => void;
}

const LAYOUT_LIMITS = {
  left: { min: 300, max: 640, fallback: 392 },
  right: { min: 280, max: 620, fallback: 340 },
  timeline: { min: 280, max: 640, fallback: 404 },
} as const;
const MIN_PREVIEW_WIDTH = 520;

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function readLayoutSize(key: string, fallback: number, min: number, max: number) {
  if (typeof window === 'undefined') return fallback;
  const n = Number(window.localStorage.getItem(key));
  return Number.isFinite(n) ? clamp(n, min, max) : fallback;
}

function ResizeHandle({
  axis,
  onMouseDown,
  title,
}: {
  axis: 'x' | 'y';
  onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  title: string;
}) {
  const cls = axis === 'x'
    ? 'w-[3px] cursor-col-resize'
    : 'h-[6px] cursor-row-resize';
  const indicatorCls = axis === 'x'
    ? 'absolute inset-y-0 left-1/2 w-px -translate-x-1/2'
    : 'absolute inset-x-0 top-1/2 h-px -translate-y-1/2';
  return (
    <div
      onMouseDown={onMouseDown}
      title={title}
      className={`${cls} group relative shrink-0 bg-[#151515] z-10`}
    >
      <div className={`${indicatorCls} bg-transparent group-hover:bg-[#00d8e6] group-active:bg-[#00d8e6] transition-colors`} />
    </div>
  );
}

export default function EditorView({ onSendMessage, onAbort }: EditorViewProps) {
  const transcribing = useEditorStore((s) => s.transcribing);
  const workflowMode = useEditorStore((s) => s.workflowMode);
  const [leftTab, setLeftTab] = useState<LeftTab>('media');
  const [speechDrawerOpen, setSpeechDrawerOpen] = useState(false);
  const [leftWidth, setLeftWidth] = useState(() => readLayoutSize('kunpeng.editor.leftWidth', LAYOUT_LIMITS.left.fallback, LAYOUT_LIMITS.left.min, LAYOUT_LIMITS.left.max));
  const [rightWidth, setRightWidth] = useState(() => readLayoutSize('kunpeng.editor.rightWidth', LAYOUT_LIMITS.right.fallback, LAYOUT_LIMITS.right.min, LAYOUT_LIMITS.right.max));
  const [timelineHeight, setTimelineHeight] = useState(() => readLayoutSize('kunpeng.editor.timelineHeight', LAYOUT_LIMITS.timeline.fallback, LAYOUT_LIMITS.timeline.min, LAYOUT_LIMITS.timeline.max));
  const editorRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentWidth, setContentWidth] = useState(0);
  const [altHeld, setAltHeld] = useState(false);
  useEditorShortcuts();
  useEditorPrerender();

  useEffect(() => {
    window.localStorage.setItem('kunpeng.editor.leftWidth', String(leftWidth));
  }, [leftWidth]);

  useEffect(() => {
    window.localStorage.setItem('kunpeng.editor.rightWidth', String(rightWidth));
  }, [rightWidth]);

  useEffect(() => {
    window.localStorage.setItem('kunpeng.editor.timelineHeight', String(timelineHeight));
  }, [timelineHeight]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const update = () => setContentWidth(el.getBoundingClientRect().width);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAltHeld(true);
    };
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
    const container = editorRef.current;
    if (!container) return;
    const box = container.getBoundingClientRect();
    const absX = box.left + rect.x;
    const absY = box.top + rect.y;
    const items: string[] = [];
    container.querySelectorAll<HTMLElement>('[data-clip-id]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.right > absX && r.left < absX + rect.width && r.bottom > absY && r.top < absY + rect.height) {
        items.push(`${el.dataset.trackType ?? 'clip'}:${el.dataset.clipId}`);
      }
    });
    const desc = items.length > 0
      ? `用户在剪辑视图中框选了 ${items.length} 个元素：${items.join(', ')}。\n指令：${instruction}`
      : `用户在剪辑视图中画了一个框。\n指令：${instruction}`;
    dispatchEditorPrompt(`[剪辑 AI 区域操作]\n${desc}`);
  };

  // 工作流模式 = 视图预设（不锁功能）：口播 → 剪口播抽屉；AI 成片 → 拉开鲲鹏抽屉
  useEffect(() => {
    if (workflowMode === 'speech') setSpeechDrawerOpen(true);
    else if (workflowMode === 'ai') {
      window.dispatchEvent(new CustomEvent(EDITOR_DRAWER_OPEN_EVENT));
    } else setLeftTab('media');
  }, [workflowMode]);

  /** 整条时间轴音频转写 → 字幕轨 */
  const handleAutoSubtitle = async () => {
    const s = useEditorStore.getState();
    if (s.transcribing || s.clips.length === 0) return;
    s.setTranscribing(true);
    try {
      const cues = await transcribeEditorTimelineAudio();
      if (cues.length === 0) {
        await tauriMessage('未识别到语音内容（视频可能没有人声）', { title: '自动字幕' });
        return;
      }
      captureEditorSnapshot();
      s.setSubtitles(cues);
    } catch (err) {
      await tauriMessage(`转写失败：${err instanceof Error ? err.message : String(err)}`, { title: '自动字幕', type: 'error' });
    } finally {
      useEditorStore.getState().setTranscribing(false);
    }
  };

  /** 智能剪口播：打开剪口播抽屉并启动审片（语气词/停顿秒出，重复/口误渐进补充） */
  const handleSmartCut = async () => {
    const s = useEditorStore.getState();
    if (s.clips.length === 0) return;
    setSpeechDrawerOpen(true);
    if (isAuditRunning()) return;
    try {
      await runSpeechAudit();
    } catch (err) {
      await tauriMessage(`审片失败：${err instanceof Error ? err.message : String(err)}`, { title: '智能剪口播', type: 'error' });
    }
  };

  /** AI 剪流畅：预制 prompt 进抽屉（agent 读逐字稿 → 计划卡片流提案） */
  const handleAiSmooth = () => {
    dispatchEditorPrompt(
      '请帮我把这条口播视频剪流畅：\n1. 先 timeline_get_state 了解时间轴；素材若未转写，先调用 timeline_transcribe\n2. 通读逐字稿，找出口癖、重复句、说错重说的部分和过长停顿\n3. 用 timeline_propose_plan 提出「保留句」的镜头计划（不要直接动时间轴），每段写清保留/删除理由，等我在计划卡片里确认后再 timeline_apply_plan\n如果我接下来贴了目标稿，请严格按目标稿保留对应句子并按目标稿顺序排列。',
    );
  };

  const startDragResize = (
    e: React.MouseEvent<HTMLDivElement>,
    axis: 'x' | 'y',
    cursor: 'col-resize' | 'row-resize',
    update: (dx: number, dy: number) => void,
  ) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = cursor;
    document.body.style.userSelect = 'none';
    const move = (ev: MouseEvent) => {
      update(ev.clientX - startX, ev.clientY - startY);
    };
    const up = () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    void axis;
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const startResizeLeft = (e: React.MouseEvent<HTMLDivElement>) => {
    const start = leftWidth;
    startDragResize(e, 'x', 'col-resize', (dx) => {
      setLeftWidth(clamp(start + dx, LAYOUT_LIMITS.left.min, LAYOUT_LIMITS.left.max));
    });
  };

  const startResizeRight = (e: React.MouseEvent<HTMLDivElement>) => {
    const start = rightWidth;
    startDragResize(e, 'x', 'col-resize', (dx) => {
      setRightWidth(clamp(start - dx, LAYOUT_LIMITS.right.min, LAYOUT_LIMITS.right.max));
    });
  };

  const startResizeTimeline = (e: React.MouseEvent<HTMLDivElement>) => {
    const start = timelineHeight;
    startDragResize(e, 'y', 'row-resize', (_dx, dy) => {
      setTimelineHeight(clamp(start - dy, LAYOUT_LIMITS.timeline.min, LAYOUT_LIMITS.timeline.max));
    });
  };

  const rightMax = contentWidth > 0
    ? Math.max(240, contentWidth - 260 - MIN_PREVIEW_WIDTH - 6)
    : LAYOUT_LIMITS.right.max;
  const effectiveRightWidth = contentWidth > 0
    ? clamp(rightWidth, 240, Math.min(LAYOUT_LIMITS.right.max, rightMax))
    : rightWidth;
  const leftMax = contentWidth > 0
    ? Math.max(260, contentWidth - effectiveRightWidth - MIN_PREVIEW_WIDTH - 6)
    : LAYOUT_LIMITS.left.max;
  const effectiveLeftWidth = contentWidth > 0
    ? clamp(leftWidth, 260, Math.min(LAYOUT_LIMITS.left.max, leftMax))
    : leftWidth;

  return (
    <div ref={editorRef} className="canvas-dark relative flex flex-col flex-1 min-h-0 overflow-hidden" style={{ background: 'var(--canvas-bg)' }}>
      <EditorTopBar
        onAutoSubtitle={() => void handleAutoSubtitle()}
        onSmartCut={() => void handleSmartCut()}
        onAiSmooth={handleAiSmooth}
        transcribing={transcribing}
      />

      <div className="flex-1 min-h-0 flex px-[3px] pt-[3px]">
        {/* 剪口播占位抽屉：弹出后成为一个模块，不再盖住预览和时间轴 */}
        <AnimatePresence initial={false}>
          {speechDrawerOpen && (
            <motion.div
              key="speech-drawer"
              initial={{ width: 0, opacity: 0, x: -12 }}
              animate={{ width: 430, opacity: 1, x: 0 }}
              exit={{ width: 0, opacity: 0, x: -12 }}
              transition={{ type: 'tween', duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
              className="h-full shrink-0 overflow-hidden pr-[3px]"
            >
              <div
                className="h-full rounded-xl overflow-hidden"
                style={{
                  border: '1px solid rgba(255,255,255,0.09)',
                  boxShadow: '4px 0 20px rgba(0,0,0,0.24)',
                }}
              >
                <SpeechCutPanel onClose={() => setSpeechDrawerOpen(false)} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={contentRef} className="flex-1 min-w-0 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 flex gap-0">
            <LeftPanel tab={leftTab} onTabChange={setLeftTab} width={effectiveLeftWidth} onOpenSpeechDrawer={() => setSpeechDrawerOpen(true)} />
            <ResizeHandle axis="x" onMouseDown={startResizeLeft} title="拖动调整素材区宽度" />
            <div className="flex-1 min-w-0 min-h-0 flex flex-col">
              <PreviewPlayer />
            </div>
            <ResizeHandle axis="x" onMouseDown={startResizeRight} title="拖动调整参数区宽度" />
            <PropertiesPanel width={effectiveRightWidth} />
          </div>

          <ResizeHandle axis="y" onMouseDown={startResizeTimeline} title="拖动调整时间轴高度" />
          <EditorToolbar />
          <TimelineTracks height={timelineHeight} />
        </div>
      </div>

      <ShortcutPanel />
      <PlanPanel />
      <AiBoxOverlay active={altHeld} containerRef={editorRef} onSubmit={handleAiBox} onCancel={() => setAltHeld(false)} />
      <EditorChatPanel onSendMessage={onSendMessage} onAbort={onAbort} />
    </div>
  );
}
