/**
 * EditorToolbar — 时间轴正上方的片段操作栏（剪映同款位置）。
 * 撤销重做 / 分割删除 / 倒放镜像旋转 / 吸附踩点 / 快捷键速查。
 * 从 EditorTopBar 下移而来：操作离轨道近，鼠标行程短。
 */
import { useState } from 'react';
import {
  Bookmark, ChevronsLeft, ChevronsRight, FlipHorizontal2, Keyboard,
  Loader2, Magnet, MousePointer2, Music4, Redo2, RotateCw, Rewind, Scissors,
  Trash2, Undo2, MoveRight,
  type LucideIcon,
} from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import { captureEditorSnapshot, redoEditor, undoEditor, useEditorHistoryState } from '@/lib/editor/editorHistory';
import { detectBeats } from '@/lib/editor/beatDetect';
import { SHORTCUT_PANEL_EVENT } from '@/hooks/useEditorShortcuts';

function Btn({ icon: Icon, label, onClick, disabled, active, busy }: {
  icon: LucideIcon; label: string; onClick: () => void;
  disabled?: boolean; active?: boolean; busy?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      title={label}
      className={`w-8 h-8 flex items-center justify-center rounded-lg text-[11px] transition-colors disabled:opacity-35 shrink-0 ${
        active ? 'text-[#20d6df] bg-[rgba(32,214,223,0.12)]' : 'text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[rgba(255,255,255,0.06)]'
      }`}
    >
      {busy ? <Loader2 size={15} className="animate-spin" /> : <Icon size={15} />}
      <span className="sr-only">{label}</span>
    </button>
  );
}

const Sep = () => <div className="w-px h-4 mx-1 bg-[rgba(255,255,255,0.07)] shrink-0" />;

export default function EditorToolbar() {
  const clips = useEditorStore((s) => s.clips);
  const audioClips = useEditorStore((s) => s.audioClips);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const selectedOverlayId = useEditorStore((s) => s.selectedOverlayId);
  const selectedTextId = useEditorStore((s) => s.selectedTextId);
  const selectedFxId = useEditorStore((s) => s.selectedFxId);
  const selectedAudioClipId = useEditorStore((s) => s.selectedAudioClipId);
  const selectedSubtitleId = useEditorStore((s) => s.selectedSubtitleId);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
  const rippleEnabled = useEditorStore((s) => s.rippleEnabled);
  const { canUndo, canRedo } = useEditorHistoryState();
  const [beatBusy, setBeatBusy] = useState(false);

  const sel = clips.find((c) => c.id === selectedClipId);
  const hasSelection = Boolean(selectedClipId || selectedOverlayId || selectedTextId || selectedFxId || selectedAudioClipId || selectedSubtitleId);
  const total = useEditorStore.getState().totalDuration();

  const clipAtPlayhead = () => {
    const s = useEditorStore.getState();
    let acc = 0;
    for (const c of s.clips) {
      const len = s.clipLength(c);
      if (s.playheadSec >= acc && s.playheadSec <= acc + len) {
        return { id: c.id, offset: s.playheadSec - acc, speed: c.speed ?? 1, inSec: c.inSec };
      }
      acc += len;
    }
    return null;
  };

  const handleSplit = () => {
    captureEditorSnapshot();
    useEditorStore.getState().splitAtPlayhead();
  };

  const handleTrimToPlayhead = (side: 'left' | 'right') => {
    const hit = clipAtPlayhead();
    if (!hit) return;
    captureEditorSnapshot();
    const srcAt = hit.inSec + hit.offset * hit.speed;
    if (side === 'left') useEditorStore.getState().trimClip(hit.id, srcAt, undefined);
    else useEditorStore.getState().trimClip(hit.id, undefined, srcAt);
  };

  const handleDelete = () => {
    captureEditorSnapshot();
    const s = useEditorStore.getState();
    if (s.rippleEnabled) s.rippleDeleteSelected();
    else s.deleteSelected();
  };

  const patchSel = (p: Parameters<ReturnType<typeof useEditorStore.getState>['updateClip']>[1]) => {
    if (!sel) return;
    captureEditorSnapshot();
    useEditorStore.getState().updateClip(sel.id, p);
  };

  const handleBeats = async () => {
    if (beatBusy) return;
    const src = audioClips.find((a) => {
      const track = useEditorStore.getState().audioTracks.find((t) => t.id === a.trackId);
      return track?.kind === 'bgm';
    })?.path ?? clips[0]?.path;
    if (!src) return;
    setBeatBusy(true);
    try {
      const beats = await detectBeats(src);
      useEditorStore.getState().setMarkers(beats);
    } catch (err) {
      console.warn('[beats] 检测失败:', err);
    } finally {
      setBeatBusy(false);
    }
  };

  return (
    <div
      className="flex items-center gap-1 px-2.5 shrink-0 overflow-x-auto"
      style={{ height: 42, background: 'var(--canvas-panel)', borderTop: '1px solid var(--canvas-node-border)', scrollbarWidth: 'none' }}
    >
      <Btn icon={Undo2} label="撤销" onClick={undoEditor} disabled={!canUndo} />
      <Btn icon={Redo2} label="重做" onClick={redoEditor} disabled={!canRedo} />
      <Sep />
      <Btn icon={MousePointer2} label="选择工具" onClick={() => undefined} active />
      <Btn icon={Scissors} label="分割(E)" onClick={handleSplit} disabled={total <= 0} />
      <Btn icon={ChevronsLeft} label="向左裁剪(Q)" onClick={() => handleTrimToPlayhead('left')} disabled={clips.length === 0} />
      <Btn icon={ChevronsRight} label="向右裁剪(W)" onClick={() => handleTrimToPlayhead('right')} disabled={clips.length === 0} />
      <Btn icon={Trash2} label={rippleEnabled ? '波纹删除' : '删除'} onClick={handleDelete} disabled={!hasSelection} />
      <Btn icon={MoveRight} label="波纹" onClick={() => useEditorStore.getState().setRippleEnabled(!rippleEnabled)} active={rippleEnabled} />
      <Sep />
      <Btn icon={Rewind} label="倒放" onClick={() => patchSel({ reversed: !sel?.reversed })} disabled={!sel} active={sel?.reversed} />
      <Btn icon={FlipHorizontal2} label="镜像" onClick={() => patchSel({ flipH: !sel?.flipH })} disabled={!sel} active={sel?.flipH} />
      <Btn icon={RotateCw} label="旋转" onClick={() => patchSel({ rotate: (((sel?.rotate ?? 0) + 90) % 360) as 0 | 90 | 180 | 270 })} disabled={!sel} active={Boolean(sel?.rotate)} />
      <Sep />
      <Btn icon={Magnet} label="吸附" onClick={() => useEditorStore.getState().setSnapEnabled(!snapEnabled)} active={snapEnabled} />
      <Btn icon={Bookmark} label="添加标记(M)" onClick={() => useEditorStore.getState().addMarker(useEditorStore.getState().playheadSec)} disabled={total <= 0} />
      <Btn icon={Music4} label="踩点" onClick={() => void handleBeats()} busy={beatBusy} disabled={clips.length === 0 && audioClips.length === 0} />
      <div className="flex-1 min-w-2" />
      <Btn icon={Keyboard} label="快捷键 ?" onClick={() => window.dispatchEvent(new CustomEvent(SHORTCUT_PANEL_EVENT))} />
    </div>
  );
}
