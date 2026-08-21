/**
 * ImageCropEditor — 图片裁剪弹层。
 *
 * 全屏 overlay 显示原图 + 可拖拽/缩放的裁剪框，确认后用 canvas 截取裁剪区域
 * 落盘为新图片节点（不破坏原图），连到原图右侧。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, X, Loader2, Crop as CropIcon } from 'lucide-react';
import { useCanvasStore } from '@/stores/canvasStore';
import { saveCanvasImage } from '@/lib/canvas/assetPersist';
import { loadImageBitmap } from '@/lib/canvas/imageSource';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { nanoid } from 'nanoid';
import { captureSnapshot } from '@/lib/canvas/history';
import { defaultNodeStyle } from '@/lib/canvas/layout';

interface Rect { x: number; y: number; w: number; h: number; }

interface Props {
  sourceNodeId: string;
  imageUrl: string;
  onClose: () => void;
}

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se' | null;

export default function ImageCropEditor({ sourceNodeId, imageUrl, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const bitmapRef = useRef<ImageBitmap | null>(null);
  const [imgReady, setImgReady] = useState(false);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [display, setDisplay] = useState({ w: 0, h: 0 });
  const [rect, setRect] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  const [drag, setDrag] = useState<{ mode: DragMode; startX: number; startY: number; start: Rect } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const onImgLoad = useCallback(async () => {
    const img = imgRef.current;
    if (!img) return;
    const n = { w: img.naturalWidth, h: img.naturalHeight };
    setNatural(n);
    // 适配显示尺寸（最长边 ≤ 80vh）
    const maxH = window.innerHeight * 0.8;
    const maxW = window.innerWidth * 0.8;
    const scale = Math.min(maxW / n.w, maxH / n.h, 1);
    const d = { w: Math.round(n.w * scale), h: Math.round(n.h * scale) };
    setDisplay(d);
    // 初始裁剪框：居中 60%
    setRect({ x: d.w * 0.2, y: d.h * 0.2, w: d.w * 0.6, h: d.h * 0.6 });
    setImgReady(true);
    // 预取 ImageBitmap 用于最终裁剪导出——直接用 <img> 画到 canvas 会因
    // asset:// 跨域导致 canvas tainted，toDataURL 报 "insecure"；浏览器
    // fetch(asset://) 又被 CSP connect-src 拦。统一走 loadImageBitmap
    // （readBinaryFile / Tauri http 读原始字节，绕开跨域）。
    try {
      bitmapRef.current = await loadImageBitmap(imageUrl);
    } catch (err) {
      console.warn('[ImageCropEditor] 预取 bitmap 失败，将回退用 <img>:', err);
    }
  }, [imageUrl]);

  const clampRect = useCallback((r: Rect): Rect => {
    let { x, y, w, h } = r;
    if (w < 30) w = 30;
    if (h < 30) h = 30;
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    if (x + w > display.w) x = display.w - w;
    if (y + h > display.h) y = display.h - h;
    return { x, y, w, h };
  }, [display]);

  const onPointerDown = useCallback((e: React.PointerEvent, mode: DragMode) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setDrag({ mode, startX: e.clientX, startY: e.clientY, start: rect });
  }, [rect]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const s = drag.start;
    let next: Rect = s;
    if (drag.mode === 'move') {
      next = { x: s.x + dx, y: s.y + dy, w: s.w, h: s.h };
    } else {
      // 角拖拽
      let { x, y, w, h } = s;
      if (drag.mode === 'nw') { x = s.x + dx; y = s.y + dy; w = s.w - dx; h = s.h - dy; }
      if (drag.mode === 'ne') { y = s.y + dy; w = s.w + dx; h = s.h - dy; }
      if (drag.mode === 'sw') { x = s.x + dx; w = s.w - dx; h = s.h + dy; }
      if (drag.mode === 'se') { w = s.w + dx; h = s.h + dy; }
      next = { x, y, w, h };
    }
    setRect(clampRect(next));
  }, [drag, clampRect]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    setDrag(null);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (busy || !imgReady) return;
    setBusy(true);
    try {
      // 显示坐标 → 原图坐标
      const scaleX = natural.w / display.w;
      const scaleY = natural.h / display.h;
      const sx = rect.x * scaleX;
      const sy = rect.y * scaleY;
      const sw = rect.w * scaleX;
      const sh = rect.h * scaleY;
      const out = document.createElement('canvas');
      out.width = Math.round(sw);
      out.height = Math.round(sh);
      const oc = out.getContext('2d')!;
      // 用干净的 ImageBitmap（不 tainted）；预取失败则确认时再取一次，
      // 仍失败才回退 <img>（大概率 insecure，但保留最后一搏）
      if (!bitmapRef.current) {
        bitmapRef.current = await loadImageBitmap(imageUrl).catch(() => null);
      }
      const source: CanvasImageSource = bitmapRef.current ?? imgRef.current!;
      oc.drawImage(source, sx, sy, sw, sh, 0, 0, out.width, out.height);
      const savedPath = await saveCanvasImage(out.toDataURL('image/png'), 'crop');
      const assetUrl = convertFileSrc(savedPath);

      const store = useCanvasStore.getState();
      const src = store.nodes.find((n) => n.id === sourceNodeId);
      captureSnapshot();
      const newId = `node-${nanoid(8)}`;
      store.addNode({
        id: newId,
        type: 'image',
        position: { x: (src?.position.x ?? 0) + (src?.width ?? 280) + 60, y: (src?.position.y ?? 0) + 40 },
        style: defaultNodeStyle('image'),
        data: { referenceImage: assetUrl, localPath: savedPath, isUploadedImage: true, description: '裁剪' },
      });
      store.onConnect({ source: sourceNodeId, target: newId, sourceHandle: null, targetHandle: null });
      store.setSelectedNodeId(newId);
      onClose();
    } catch (err) {
      console.error('[ImageCropEditor] 裁剪失败:', err);
      alert('裁剪失败：' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }, [busy, imgReady, rect, natural, display, sourceNodeId, imageUrl, onClose]);

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleStyles = 'absolute w-3 h-3 bg-white border-2 border-[#1a1a1a] rounded-sm';

  return createPortal(
    <div
      ref={containerRef}
      className="fixed inset-0 z-[99999] bg-black/85 backdrop-blur-xl flex flex-col"
      onClick={(e) => { if (e.target === containerRef.current) onClose(); }}
    >
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-6 py-4 shrink-0">
        <div className="flex items-center gap-2 text-white">
          <CropIcon size={18} />
          <span className="text-[15px] font-medium">裁剪图片</span>
          <span className="text-[12px] text-white/50 ml-2">拖动框线或四角调整，确认后生成新节点</span>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10"><X size={18} /></button>
      </div>

      {/* 画布区 */}
      <div className="flex-1 flex items-center justify-center px-6 pb-6 relative" onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        {!imgReady && <Loader2 size={20} className="animate-spin text-white/50" />}
        <div className="relative" style={{ width: display.w || 'auto', height: display.h || 'auto' }}>
          <img
            ref={imgRef}
            src={imageUrl}
            alt=""
            onLoad={onImgLoad}
            className="block max-w-full max-h-full select-none"
            style={{ width: display.w || 'auto', height: display.h || 'auto' }}
            draggable={false}
          />
          {/* 遮暗非裁剪区 */}
          {imgReady && (
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute bg-black/55" style={{ top: 0, left: 0, right: 0, height: rect.y }} />
              <div className="absolute bg-black/55" style={{ top: rect.y + rect.h, left: 0, right: 0, bottom: 0 }} />
              <div className="absolute bg-black/55" style={{ top: rect.y, left: 0, width: rect.x, height: rect.h }} />
              <div className="absolute bg-black/55" style={{ top: rect.y, left: rect.x + rect.w, right: 0, height: rect.h }} />
            </div>
          )}
          {/* 裁剪框 */}
          {imgReady && (
            <div
              className="absolute border-2 border-white cursor-move"
              style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
              onPointerDown={(e) => onPointerDown(e, 'move')}
            >
              {/* 三分线 */}
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-1/3 left-0 right-0 border-t border-white/30" />
                <div className="absolute top-2/3 left-0 right-0 border-t border-white/30" />
                <div className="absolute left-1/3 top-0 bottom-0 border-l border-white/30" />
                <div className="absolute left-2/3 top-0 bottom-0 border-l border-white/30" />
              </div>
              {/* 四角手柄 */}
              <div className={`${handleStyles} -top-1.5 -left-1.5 cursor-nwse-resize`} onPointerDown={(e) => onPointerDown(e, 'nw')} />
              <div className={`${handleStyles} -top-1.5 -right-1.5 cursor-nesw-resize`} onPointerDown={(e) => onPointerDown(e, 'ne')} />
              <div className={`${handleStyles} -bottom-1.5 -left-1.5 cursor-nesw-resize`} onPointerDown={(e) => onPointerDown(e, 'sw')} />
              <div className={`${handleStyles} -bottom-1.5 -right-1.5 cursor-nwse-resize`} onPointerDown={(e) => onPointerDown(e, 'se')} />
            </div>
          )}
        </div>
      </div>

      {/* 底栏 */}
      <div className="flex items-center justify-end gap-3 px-6 py-4 shrink-0 border-t border-white/10">
        <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-white/70 hover:text-white hover:bg-white/10 text-[13px]">取消</button>
        <button
          onClick={() => void handleConfirm()}
          disabled={busy || !imgReady}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-black text-[13px] font-medium hover:bg-white/90 disabled:opacity-40"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
          确认裁剪
        </button>
      </div>
    </div>,
    document.body,
  );
}
