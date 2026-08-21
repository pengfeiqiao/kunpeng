import { useEffect, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize, Expand, Shrink } from 'lucide-react';
import { useReactFlow, useViewport } from 'reactflow';
import { appWindow } from '@tauri-apps/api/window';

export default function CanvasToolbar() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  // useViewport subscribes to viewport changes — getZoom() during render
  // returned a stale value because zooming doesn't re-render this component.
  const { zoom } = useViewport();
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    appWindow.isFullscreen().then(setIsFullscreen).catch(() => {});
  }, []);

  const toggleFullscreen = async () => {
    try {
      const next = !(await appWindow.isFullscreen());
      await appWindow.setFullscreen(next);
      setIsFullscreen(next);
    } catch (err) {
      console.warn('切换全屏失败:', err);
    }
  };

  return (
    <div className="absolute bottom-4 left-4 z-10 flex items-center gap-1 bg-[var(--canvas-panel)] rounded-lg border border-[var(--canvas-node-border)] shadow-md px-1.5 py-1">
      <button onClick={() => zoomOut()} className="p-2.5 rounded-lg hover:bg-[var(--canvas-controls-hover)] text-[var(--canvas-text-2)] transition-colors" title="缩小">
        <ZoomOut size={17} />
      </button>
      <span className="text-[12px] text-[var(--canvas-text-2)] min-w-[42px] text-center font-medium">
        {Math.round(zoom * 100)}%
      </span>
      <button onClick={() => zoomIn()} className="p-2.5 rounded-lg hover:bg-[var(--canvas-controls-hover)] text-[var(--canvas-text-2)] transition-colors" title="放大">
        <ZoomIn size={17} />
      </button>
      <div className="w-px h-4 bg-[rgba(255,255,255,0.12)] mx-0.5" />
      <button onClick={() => fitView({ padding: 0.2 })} className="p-2.5 rounded-lg hover:bg-[var(--canvas-controls-hover)] text-[var(--canvas-text-2)] transition-colors" title="适配画布">
        <Maximize size={17} />
      </button>
      <button onClick={() => void toggleFullscreen()} className="p-2.5 rounded-lg hover:bg-[var(--canvas-controls-hover)] text-[var(--canvas-text-2)] transition-colors" title={isFullscreen ? '退出全屏' : '全屏'}>
        {isFullscreen ? <Shrink size={17} /> : <Expand size={17} />}
      </button>
    </div>
  );
}
