import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Download, ZoomIn, ZoomOut, X, Maximize2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/tauri';

interface ImageFullscreenViewerProps {
  imageUrl: string;
  mediaType?: 'image' | 'video';
  onClose: () => void;
}

export default function ImageFullscreenViewer({ imageUrl, mediaType = 'image', onClose }: ImageFullscreenViewerProps) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [mounted, setMounted] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  const handleZoomIn = () => setScale((prev) => Math.min(5, prev + 0.25));
  const handleZoomOut = () => setScale((prev) => Math.max(0.1, prev - 0.25));
  const handleResetZoom = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === '+' || e.key === '=') handleZoomIn();
      else if (e.key === '-') handleZoomOut();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setScale((prev) => Math.max(0.1, Math.min(5, prev + delta)));
    };
    const container = containerRef.current;
    if (container) {
      container.addEventListener('wheel', handleWheel, { passive: false });
      return () => container.removeEventListener('wheel', handleWheel);
    }
  }, []);

  const handleDownload = async () => {
    try {
      await invoke('save_file_dialog', {
        sourcePath: imageUrl,
        defaultName: `image-${Date.now()}.png`,
      });
    } catch (err) {
      console.error('下载图片失败:', err);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    }
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) setPosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };
  const handleMouseUp = () => setIsDragging(false);

  useEffect(() => {
    if (mounted) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [mounted]);

  if (!mounted) return null;

  return createPortal(
    <div
      ref={containerRef}
      className="fixed inset-0 z-[99999] overflow-hidden"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div className="absolute inset-0 backdrop-blur-2xl bg-black/60 z-0" />

      <div
        className="absolute inset-0 overflow-hidden z-[1]"
        style={{ cursor: isDragging ? 'grabbing' : scale > 1 ? 'grab' : 'default' }}
      >
        {mediaType === 'video' ? (
          <video
            src={imageUrl}
            controls
            autoPlay
            className="absolute inset-0 w-full h-full object-contain select-none"
            style={{
              transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
              transition: isDragging ? 'none' : 'transform 0.1s ease-out',
              transformOrigin: 'center center',
            }}
          />
        ) : (
          <img
            ref={imageRef}
            src={imageUrl}
            alt="Fullscreen"
            className="absolute inset-0 w-full h-full object-contain select-none"
            style={{
              transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
              transition: isDragging ? 'none' : 'transform 0.1s ease-out',
              transformOrigin: 'center center',
            }}
            draggable={false}
          />
        )}
      </div>

      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-end p-4 pointer-events-none">
        <div className="flex items-center gap-2 pointer-events-auto">
          <button onClick={handleDownload} className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors backdrop-blur-md" title="下载"><Download className="w-5 h-5" /></button>
          <button onClick={handleZoomIn} className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors backdrop-blur-md" title="放大"><ZoomIn className="w-5 h-5" /></button>
          <button onClick={handleZoomOut} className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors backdrop-blur-md" title="缩小"><ZoomOut className="w-5 h-5" /></button>
          <button onClick={handleResetZoom} className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors backdrop-blur-md" title="重置"><Maximize2 className="w-5 h-5" /></button>
          <button onClick={onClose} className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors backdrop-blur-md" title="关闭 (ESC)"><X className="w-5 h-5" /></button>
        </div>
      </div>

      {Math.abs(scale - 1) > 0.01 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 bg-black/60 backdrop-blur-md rounded-lg text-white text-sm pointer-events-none z-20">
          {Math.round(scale * 100)}%
        </div>
      )}
    </div>,
    document.body,
  );
}
