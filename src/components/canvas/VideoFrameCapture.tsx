/**
 * VideoFrameCapture — fullscreen frame picker for a video node.
 * Keys: ←/→ ±1s, ↑/↓ ±0.1s, Shift+↑/↓ ±0.01s, Enter capture (stays open
 * for multi-capture), ESC close. (LibTV timeline key conventions.)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Camera, Check } from 'lucide-react';
import { captureFrameAt, spawnFrameNode } from '@/lib/canvas/videoFrames';

export default function VideoFrameCapture({ nodeId, videoUrl, onClose }: {
  nodeId: string;
  videoUrl: string;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [captured, setCaptured] = useState(0);
  const [flash, setFlash] = useState(false);

  const seekBy = useCallback((delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta));
  }, []);

  const capture = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    const path = await captureFrameAt(v);
    spawnFrameNode(nodeId, path, v.currentTime);
    setCaptured((c) => c + 1);
    setFlash(true);
    setTimeout(() => setFlash(false), 250);
  }, [nodeId]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'Enter') { e.preventDefault(); void capture(); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); seekBy(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); seekBy(1); }
      if (e.key === 'ArrowUp') { e.preventDefault(); seekBy(e.shiftKey ? 0.01 : 0.1); }
      if (e.key === 'ArrowDown') { e.preventDefault(); seekBy(e.shiftKey ? -0.01 : -0.1); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, capture, seekBy]);

  return createPortal(
    <div className="canvas-dark fixed inset-0 z-[99999] bg-black/90 backdrop-blur-xl flex flex-col">
      <div className="flex items-center justify-between p-4">
        <div className="text-white/90 text-base font-medium bg-white/10 px-4 py-2 rounded-lg backdrop-blur-md">
          取帧 — Enter 截取当前帧{captured > 0 && <span className="text-[var(--canvas-accent)] ml-2">已截 {captured} 帧</span>}
        </div>
        <button onClick={onClose} className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white" title="ESC"><X size={18} /></button>
      </div>

      <div className="flex-1 flex items-center justify-center min-h-0 px-8 relative">
        <video
          ref={videoRef}
          src={videoUrl}
          controls={false}
          className="max-w-full max-h-full"
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onClick={() => { const v = videoRef.current; if (v) v.paused ? v.play() : v.pause(); }}
        />
        {flash && <div className="absolute inset-8 border-4 border-[var(--canvas-accent)] rounded-xl pointer-events-none animate-pulse" />}
      </div>

      <div className="p-4 flex items-center gap-3 justify-center">
        <span className="text-[12px] text-white/70 font-mono w-24 text-right">{time.toFixed(2)}s</span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.01}
          value={time}
          onChange={(e) => { const v = videoRef.current; if (v) v.currentTime = Number(e.target.value); }}
          className="w-[420px] accent-[#1fa2dc]"
        />
        <span className="text-[12px] text-white/40 font-mono w-24">{duration.toFixed(2)}s</span>
        <button
          onClick={() => void capture()}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--canvas-accent)] hover:brightness-110 text-white text-[12px] font-medium"
        >
          <Camera size={13} />截取此帧
        </button>
        {captured > 0 && (
          <button onClick={onClose} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-[12px]">
            <Check size={13} />完成
          </button>
        )}
      </div>
      <div className="pb-3 text-center text-[10px] text-white/40">
        ←/→ ±1s · ↑/↓ ±0.1s · Shift+↑/↓ ±0.01s · Enter 截取 · 点击画面播放/暂停 · ESC 关闭
      </div>
    </div>,
    document.body,
  );
}
