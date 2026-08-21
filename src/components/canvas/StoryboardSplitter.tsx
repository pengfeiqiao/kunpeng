import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2 } from 'lucide-react';
import { useCanvasStore } from '@/stores/canvasStore';
import { saveCanvasImage, toAssetUrl } from '@/lib/canvas/assetPersist';
import { loadImageBitmap } from '@/lib/canvas/imageSource';
import { splitAll } from '@/lib/canvas/imageSplit';
import { nanoid } from 'nanoid';
import { defaultNodeStyle } from '@/lib/canvas/layout';

interface StoryboardSplitterProps {
  nodeId: string;
  imageUrl: string;
  onClose: () => void;
}

export default function StoryboardSplitter({ nodeId, imageUrl, onClose }: StoryboardSplitterProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });
  const [isProcessing, setIsProcessing] = useState(false);
  const [gridSize, setGridSize] = useState<2 | 3 | 5>(3);
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const img = new Image();
    if (imageUrl.startsWith('http')) img.crossOrigin = 'anonymous';
    img.onload = () => { setImageSize({ width: img.naturalWidth, height: img.naturalHeight }); setImageLoaded(true); };
    img.onerror = () => { alert('图片加载失败'); onClose(); };
    img.src = imageUrl;
  }, [imageUrl, onClose]);

  useEffect(() => {
    if (!imageLoaded || !imageRef.current) return;
    const update = () => {
      const el = imageRef.current;
      if (el) setDisplaySize({ width: el.clientWidth, height: el.clientHeight });
    };
    const t = setTimeout(update, 100);
    window.addEventListener('resize', update);
    return () => { clearTimeout(t); window.removeEventListener('resize', update); };
  }, [imageLoaded]);

  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = ''; }; }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const getCellBounds = useCallback((i: number) => {
    const col = i % gridSize, row = Math.floor(i / gridSize);
    const cw = (displaySize.width || imageSize.width) / gridSize;
    const ch = (displaySize.height || imageSize.height) / gridSize;
    return { x: col * cw, y: row * ch, width: cw, height: ch };
  }, [imageSize, displaySize, gridSize]);

  const handleCellClick = useCallback(async (cellIndex: number) => {
    if (isProcessing) return;
    if (!window.confirm(`切分第 ${cellIndex + 1} 个分镜？`)) return;
    setIsProcessing(true);

    try {
      // Crop client-side. Draw from a clean ImageBitmap (raw bytes via
      // readBinaryFile / Tauri http) — drawing the asset:// <img> would
      // taint the canvas and make toDataURL throw "insecure".
      const bounds = getCellBounds(cellIndex);
      const scaleX = imageSize.width / (displaySize.width || imageSize.width);
      const scaleY = imageSize.height / (displaySize.height || imageSize.height);
      const sx = Math.round(bounds.x * scaleX), sy = Math.round(bounds.y * scaleY);
      const sw = Math.round(bounds.width * scaleX), sh = Math.round(bounds.height * scaleY);

      const bitmap = await loadImageBitmap(imageUrl);
      const canvas = document.createElement('canvas');
      canvas.width = sw; canvas.height = sh;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
      bitmap.close();
      // Persist the crop to disk — a data URL stored in node data would be
      // persisted to localStorage by canvasStore and blow the quota.
      const dataUrl = canvas.toDataURL('image/png');
      const filePath = await saveCanvasImage(dataUrl, 'storyboard');
      const assetUrl = toAssetUrl(filePath);

      // Create new image node with cropped image
      const store = useCanvasStore.getState();
      const srcNode = store.nodes.find((n) => n.id === nodeId);
      const newId = `node-${nanoid(8)}`;
      store.addNode({
        id: newId,
        type: 'image',
        position: {
          x: (srcNode?.position.x || 0) + (srcNode?.width || 200) + 80,
          y: (srcNode?.position.y || 0) + cellIndex * 50,
        },
        style: defaultNodeStyle('image'),
        data: { referenceImage: assetUrl, localPath: filePath, description: `分镜 ${cellIndex + 1}`, isUploadedImage: true },
      });
      store.onConnect({ source: nodeId, target: newId, sourceHandle: null, targetHandle: null });
      onClose();
    } catch (err) {
      console.error('切分失败:', err);
      alert('切分失败: ' + (err instanceof Error ? err.message : '未知错误'));
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, getCellBounds, imageSize, displaySize, nodeId, imageUrl, onClose]);

  return createPortal(
    <div ref={containerRef} className="fixed inset-0 z-[99999] bg-black/80 backdrop-blur-2xl" onClick={(e) => { if (e.target === containerRef.current) onClose(); }}>
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between p-4">
        <div className="flex items-center gap-2">
          <div className="text-white/90 text-lg font-medium backdrop-blur-md bg-white/10 px-4 py-2 rounded-lg">分镜切分</div>
          <div className="flex items-center rounded-lg overflow-hidden backdrop-blur-md bg-white/10">
            {([2, 3, 5] as const).map((g) => (
              <button
                key={g}
                onClick={() => setGridSize(g)}
                className={`px-3 py-2 text-sm transition-colors ${gridSize === g ? 'bg-white/25 text-white font-medium' : 'text-white/60 hover:text-white'}`}
              >
                {g}x{g}
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              if (isProcessing) return;
              setIsProcessing(true);
              void splitAll(nodeId, imageUrl, gridSize, { namePrefix: 'storyboard' })
                .then(() => onClose())
                .finally(() => setIsProcessing(false));
            }}
            className="px-3 py-2 rounded-lg backdrop-blur-md bg-white/10 hover:bg-white/20 text-white text-sm transition-colors"
          >
            一键全部切分
          </button>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors backdrop-blur-md" title="ESC"><X size={20} /></button>
      </div>
      <div className="absolute inset-0 flex items-center justify-center p-8 pt-20">
        {!imageLoaded ? (
          <div className="flex items-center gap-2 text-white/60"><Loader2 className="w-5 h-5 animate-spin" /><span>加载中...</span></div>
        ) : (
          <div className="relative max-w-full max-h-full">
            <img ref={imageRef} src={imageUrl} alt="Storyboard" className="max-w-full max-h-full object-contain block" crossOrigin="anonymous" />
            <div className="absolute inset-0" style={{ width: displaySize.width || '100%', height: displaySize.height || '100%' }}>
              {Array.from({ length: gridSize * gridSize }).map((_, i) => {
                const b = getCellBounds(i);
                return (
                  <div
                    key={i}
                    className={`absolute border-2 transition-all cursor-pointer ${isProcessing ? 'pointer-events-none opacity-50' : 'border-white/30 hover:border-white/50 hover:bg-white/5'}`}
                    style={{ left: b.x, top: b.y, width: b.width, height: b.height }}
                    onClick={() => handleCellClick(i)}
                  >
                    <div className="absolute top-1 left-1 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center text-white text-xs font-bold">{i + 1}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-black/60 backdrop-blur-md rounded-lg text-white text-sm z-20">
        {isProcessing ? <div className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />处理中...</div> : '点击网格切分，ESC 关闭'}
      </div>
    </div>,
    document.body,
  );
}
