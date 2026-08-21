/**
 * TimelinePanel — bottom sheet for multi-clip video composition.
 * Select 2+ video nodes → right-click "视频合成" → order/trim clips, pick
 * transition + optional BGM (connected audio node), compose via ffmpeg.
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { X, GripVertical, Loader2, Clapperboard, ArrowUp, ArrowDown, Music } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { nanoid } from 'nanoid';
import { useCanvasStore } from '@/stores/canvasStore';
import { composeVideos, type ComposeClip } from '@/lib/canvas/videoCompose';
import { captureSnapshot } from '@/lib/canvas/history';
import { exportToJianying } from '@/lib/export/jianying';
import { useEditorStore } from '@/stores/editorStore';
import { useChatStore } from '@/stores/chatStore';
import { useVideoThumb } from '@/lib/canvas/videoThumbs';
import { useShallow } from 'zustand/react/shallow';

export interface TimelineClip extends ComposeClip {
  nodeId: string;
  label: string;
}

export default function TimelinePanel({ clips: initialClips, onClose }: {
  clips: TimelineClip[];
  onClose: () => void;
}) {
  const [clips, setClips] = useState(initialClips);
  const [crossfade, setCrossfade] = useState(0);
  const [bgmPath, setBgmPath] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  // Available audio assets on canvas for BGM
  const audioNodes = useCanvasStore(useShallow((state) => (
    state.nodes.filter((node) => node.type === 'audio')
  )));

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= clips.length) return;
    const next = [...clips];
    [next[i], next[j]] = [next[j], next[i]];
    setClips(next);
  };

  const handleCompose = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const outPath = await composeVideos({
        clips,
        crossfadeSec: crossfade,
        bgmPath,
        bgmVolume: 0.3,
        onProgress: setProgress,
      });
      // Drop result as a new video node
      captureSnapshot();
      const store = useCanvasStore.getState();
      const last = store.nodes.find((n) => n.id === clips[clips.length - 1].nodeId);
      const newId = `node-${nanoid(8)}`;
      store.addNode({
        id: newId,
        type: 'video',
        position: {
          x: (last?.position.x ?? 200) + (last?.width ?? 360) + 80,
          y: last?.position.y ?? 200,
        },
        data: {
          generatedVideoUrl: convertFileSrc(outPath),
          localPath: outPath,
          mediaRole: 'output',
          description: `合成视频（${clips.length} 段${crossfade > 0 ? ' · 淡入淡出' : ''}${bgmPath ? ' · BGM' : ''}）`,
        },
      });
      for (const c of clips) {
        store.onConnect({
          source: c.nodeId,
          target: newId,
          sourceHandle: null,
          targetHandle: null,
          data: { relation: 'composition' },
        });
      }
      store.setSelectedNodeId(newId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  const handleExportJianying = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      setProgress('生成剪映草稿…');
      const draftPath = await exportToJianying(clips.map((c) => c.path));
      setProgress('');
      setError('');
      alert(`已导出剪映草稿：\n${draftPath}\n\n打开剪映专业版即可在草稿列表看到（素材分轨保留）。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 24 }}
      transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
      className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 w-[640px] max-w-[94vw] rounded-2xl overflow-hidden"
      style={{ background: 'rgba(38,38,38,0.92)', backdropFilter: 'blur(16px)', border: '1px solid var(--canvas-node-border)', boxShadow: '0 12px 48px rgba(0,0,0,0.4)' }}
    >
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[rgba(255,255,255,0.06)]">
        <span className="flex items-center gap-2 text-[13px] font-medium text-[var(--canvas-text-1)]">
          <Clapperboard size={14} className="text-[var(--canvas-text-2)]" />
          视频合成（{clips.length} 段）
        </span>
        <button onClick={onClose} className="p-1 rounded hover:bg-[var(--canvas-controls-hover)] text-[var(--canvas-text-2)]"><X size={14} /></button>
      </div>

      {/* Clip list */}
      <div className="max-h-[240px] overflow-y-auto px-3 py-2 space-y-1.5">
        {clips.map((c, i) => (
          <div key={c.nodeId} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)]">
            <GripVertical size={12} className="text-[var(--canvas-text-3)] shrink-0" />
            <span className="text-[11px] text-[var(--canvas-text-2)] w-5 shrink-0">{i + 1}</span>
            <ClipThumb path={c.path} />
            <span className="flex-1 text-[11px] text-[var(--canvas-text-1)] truncate">{c.label}</span>
            <div className="flex items-center gap-1 text-[10px] text-[var(--canvas-text-2)] shrink-0">
              <span>裁剪</span>
              <input
                type="number" min={0} step={0.5} placeholder="始"
                className="w-12 px-1 py-0.5 rounded bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] text-[var(--canvas-text-1)] text-[10px] focus:outline-none"
                onChange={(e) => setClips((cs) => cs.map((x, j) => j === i ? { ...x, inSec: e.target.value ? Number(e.target.value) : undefined } : x))}
              />
              <input
                type="number" min={0} step={0.5} placeholder="止"
                className="w-12 px-1 py-0.5 rounded bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] text-[var(--canvas-text-1)] text-[10px] focus:outline-none"
                onChange={(e) => setClips((cs) => cs.map((x, j) => j === i ? { ...x, outSec: e.target.value ? Number(e.target.value) : undefined } : x))}
              />
            </div>
            <button onClick={() => move(i, -1)} disabled={i === 0} className="p-1 rounded hover:bg-[var(--canvas-controls-hover)] text-[var(--canvas-text-2)] disabled:opacity-30"><ArrowUp size={11} /></button>
            <button onClick={() => move(i, 1)} disabled={i === clips.length - 1} className="p-1 rounded hover:bg-[var(--canvas-controls-hover)] text-[var(--canvas-text-2)] disabled:opacity-30"><ArrowDown size={11} /></button>
          </div>
        ))}
      </div>

      {/* Options */}
      <div className="flex items-center gap-3 px-4 py-2 border-t border-[rgba(255,255,255,0.06)]">
        <label className="flex items-center gap-1.5 text-[11px] text-[var(--canvas-text-2)]">
          转场
          <select
            value={crossfade}
            onChange={(e) => setCrossfade(Number(e.target.value))}
            className="px-2 py-1 rounded-lg bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] text-[var(--canvas-text-1)] text-[11px] focus:outline-none"
          >
            <option value={0}>硬切</option>
            <option value={0.5}>淡入淡出 0.5s</option>
            <option value={1}>淡入淡出 1s</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-[var(--canvas-text-2)]">
          <Music size={11} />
          BGM
          <select
            value={bgmPath ?? ''}
            onChange={(e) => setBgmPath(e.target.value || undefined)}
            className="px-2 py-1 rounded-lg bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] text-[var(--canvas-text-1)] text-[11px] focus:outline-none max-w-[140px]"
          >
            <option value="">无</option>
            {audioNodes.map((n) => {
              const d = n.data as Record<string, unknown>;
              return <option key={n.id} value={(d.localPath as string) || ''}>{(d.fileName as string) || '音频'}</option>;
            })}
          </select>
        </label>

        <div className="flex-1" />
        {progress && <span className="text-[10px] text-[var(--canvas-accent)]">{progress}</span>}
        {error && <span className="text-[10px] text-[var(--canvas-danger)] max-w-[200px] truncate" title={error}>{error}</span>}
        <button
          onClick={() => {
            void useEditorStore.getState().addClips(clips.map((c) => ({ path: c.path, label: c.label, sourceNodeId: c.nodeId })));
            useChatStore.getState().setActiveView('editor');
            onClose();
          }}
          className="px-3 py-1.5 rounded-lg border border-[var(--canvas-node-border)] text-[11px] text-[var(--canvas-text-2)] hover:bg-[var(--canvas-controls-hover)]"
        >
          在剪辑器中打开
        </button>
        <button
          onClick={() => void handleExportJianying()}
          disabled={busy}
          className="px-3 py-1.5 rounded-lg border border-[var(--canvas-node-border)] text-[11px] text-[var(--canvas-text-2)] hover:bg-[var(--canvas-controls-hover)] disabled:opacity-40"
        >
          导出剪映
        </button>
        <button
          onClick={() => void handleCompose()}
          disabled={busy || clips.length < 2}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[var(--canvas-accent)] hover:brightness-110 text-white text-[11px] font-medium disabled:opacity-40"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Clapperboard size={12} />}
          合成
        </button>
      </div>
    </motion.div>
  );
}

function ClipThumb({ path }: { path: string }) {
  const thumb = useVideoThumb(path);
  return thumb
    ? <img src={thumb} alt="" className="w-16 h-9 object-cover rounded shrink-0" />
    : <div className="w-16 h-9 rounded shrink-0 bg-[rgba(255,255,255,0.06)]" />;
}
