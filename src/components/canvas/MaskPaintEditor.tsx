/**
 * MaskPaintEditor — 局部重绘/擦除的可视化定位编辑器。
 *
 * 全屏弹层：原图上用红笔涂抹或拉矩形框标记目标区域（笔刷可调、橡皮、
 * 撤销），底部填指令 → 确认后把「原图+红色标记」合成一张图落盘，
 * 作为参考图传给 gpt-image-2 指令式编辑（提示词引用"红色标记区域"，
 * 视觉定位远比纯文字描述精准）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Brush, Eraser, Loader2, Redo2, Square as SquareIcon, Undo2, X } from 'lucide-react';
import { nanoid } from 'nanoid';
import { useCanvasStore } from '@/stores/canvasStore';
import { saveCanvasImage } from '@/lib/canvas/assetPersist';
import { loadImageBitmap } from '@/lib/canvas/imageSource';
import { captureSnapshot } from '@/lib/canvas/history';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { defaultNodeStyle } from '@/lib/canvas/layout';

export type MaskToolMode = 'inpaint' | 'erase';

interface Props {
  sourceNodeId: string;
  imageUrl: string;
  mode: MaskToolMode;
  onClose: () => void;
}

type Tool = 'brush' | 'rect' | 'eraser';

const MARK_COLOR = 'rgba(255, 46, 46, 0.55)';
const MARK_STROKE = 'rgba(255, 46, 46, 0.95)';

export default function MaskPaintEditor({ sourceNodeId, imageUrl, mode, onClose }: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const maskRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [imgReady, setImgReady] = useState(false);
  const [tool, setTool] = useState<Tool>('brush');
  const [brushSize, setBrushSize] = useState(36);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [hasMark, setHasMark] = useState(false);
  // 撤销栈：每笔结束存一帧
  const undoStack = useRef<ImageData[]>([]);
  const redoStack = useRef<ImageData[]>([]);
  const drawingRef = useRef(false);
  const rectStartRef = useRef<{ x: number; y: number } | null>(null);
  const rectSnapshotRef = useRef<ImageData | null>(null);
  const [, forceTick] = useState(0);

  // 初始化遮罩画布尺寸 = 图片自然尺寸（保证标记分辨率与原图一致）
  const handleImgLoad = () => {
    const img = imgRef.current;
    const cv = maskRef.current;
    if (!img || !cv) return;
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    setImgReady(true);
  };

  const ctx = () => maskRef.current?.getContext('2d') ?? null;

  const pushUndo = useCallback(() => {
    const c = ctx();
    const cv = maskRef.current;
    if (!c || !cv) return;
    undoStack.current.push(c.getImageData(0, 0, cv.width, cv.height));
    if (undoStack.current.length > 30) undoStack.current.shift();
    redoStack.current = [];
    forceTick((t) => t + 1);
  }, []);

  const checkHasMark = useCallback(() => {
    const c = ctx();
    const cv = maskRef.current;
    if (!c || !cv) return;
    const data = c.getImageData(0, 0, cv.width, cv.height).data;
    for (let i = 3; i < data.length; i += 4 * 97) {
      if (data[i] > 8) { setHasMark(true); return; }
    }
    setHasMark(false);
  }, []);

  const undo = useCallback(() => {
    const c = ctx();
    const cv = maskRef.current;
    if (!c || !cv || undoStack.current.length === 0) return;
    redoStack.current.push(c.getImageData(0, 0, cv.width, cv.height));
    c.putImageData(undoStack.current.pop()!, 0, 0);
    checkHasMark();
    forceTick((t) => t + 1);
  }, [checkHasMark]);

  const redo = useCallback(() => {
    const c = ctx();
    const cv = maskRef.current;
    if (!c || !cv || redoStack.current.length === 0) return;
    undoStack.current.push(c.getImageData(0, 0, cv.width, cv.height));
    c.putImageData(redoStack.current.pop()!, 0, 0);
    checkHasMark();
    forceTick((t) => t + 1);
  }, [checkHasMark]);

  // 屏幕坐标 → 画布坐标
  const toCanvasXY = (e: React.PointerEvent): { x: number; y: number } | null => {
    const cv = maskRef.current;
    if (!cv) return null;
    const rect = cv.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * cv.width,
      y: ((e.clientY - rect.top) / rect.height) * cv.height,
    };
  };

  const scaledBrush = () => {
    const cv = maskRef.current;
    if (!cv) return brushSize;
    const rect = cv.getBoundingClientRect();
    return brushSize * (cv.width / rect.width);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const pt = toCanvasXY(e);
    const c = ctx();
    if (!pt || !c) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    pushUndo();
    drawingRef.current = true;

    if (tool === 'rect') {
      rectStartRef.current = pt;
      rectSnapshotRef.current = c.getImageData(0, 0, maskRef.current!.width, maskRef.current!.height);
      return;
    }
    c.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    c.strokeStyle = MARK_COLOR;
    c.fillStyle = MARK_COLOR;
    c.lineWidth = scaledBrush();
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    c.arc(pt.x, pt.y, scaledBrush() / 2, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.moveTo(pt.x, pt.y);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawingRef.current) return;
    const pt = toCanvasXY(e);
    const c = ctx();
    if (!pt || !c) return;

    if (tool === 'rect') {
      const start = rectStartRef.current;
      const snap = rectSnapshotRef.current;
      if (!start || !snap) return;
      c.putImageData(snap, 0, 0);
      c.globalCompositeOperation = 'source-over';
      c.fillStyle = MARK_COLOR;
      c.strokeStyle = MARK_STROKE;
      c.lineWidth = 4;
      const x = Math.min(start.x, pt.x);
      const y = Math.min(start.y, pt.y);
      const w = Math.abs(pt.x - start.x);
      const h = Math.abs(pt.y - start.y);
      c.fillRect(x, y, w, h);
      c.strokeRect(x, y, w, h);
      return;
    }
    c.lineTo(pt.x, pt.y);
    c.stroke();
  };

  const onPointerUp = () => {
    drawingRef.current = false;
    rectStartRef.current = null;
    rectSnapshotRef.current = null;
    const c = ctx();
    if (c) c.globalCompositeOperation = 'source-over';
    checkHasMark();
  };

  // 快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'Z' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); }
      if (e.key === 'b') setTool('brush');
      if (e.key === 'r') setTool('rect');
      if (e.key === 'e') setTool('eraser');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, undo, redo]);

  const handleConfirm = async () => {
    if (busy || !hasMark) return;
    setBusy(true);
    try {
      // 合成：原图 + 红色标记层 → 一张图。
      // 注意：直接用 <img> 元素画到 canvas 会因 asset:// 跨域导致 canvas tainted，
      // toDataURL 报 "The operation is insecure"；浏览器 fetch(asset://) 又被
      // CSP connect-src 拦。统一走 loadImageBitmap（readBinaryFile / Tauri http
      // 读原始字节），canvas 干净可导出。
      const mask = maskRef.current!;
      const imgBitmap = await loadImageBitmap(imageUrl);
      const out = document.createElement('canvas');
      out.width = imgBitmap.width;
      out.height = imgBitmap.height;
      const oc = out.getContext('2d')!;
      oc.drawImage(imgBitmap, 0, 0);
      oc.drawImage(mask, 0, 0);
      imgBitmap.close();
      const markedPath = await saveCanvasImage(out.toDataURL('image/png'), mode === 'erase' ? 'erase-mark' : 'inpaint-mark');
      const markedUrl = convertFileSrc(markedPath);

      // 涂红后直接新建一个成品图节点（内容=原图+红色标记），不触发 AI。
      // 用户拿到这个节点后自己决定后续操作。
      const store = useCanvasStore.getState();
      const src = store.nodes.find((n) => n.id === sourceNodeId);
      captureSnapshot();
      const newId = `node-${nanoid(8)}`;
      store.addNode({
        id: newId,
        type: 'image',
        position: {
          x: (src?.position.x ?? 100) + (src?.width ?? 200) + 60,
          y: src?.position.y ?? 100,
        },
        style: defaultNodeStyle('image'),
        data: {
          referenceImage: markedUrl,
          localPath: markedPath,
          isUploadedImage: true,
          description: instruction.trim() || (mode === 'erase' ? '擦除标注' : '局部重绘标注'),
        },
      });
      store.onConnect({ source: sourceNodeId, target: newId, sourceHandle: null, targetHandle: null });
      store.setSelectedNodeId(newId);
      onClose();
    } catch (err) {
      console.error('[MaskPaintEditor] 保存失败:', err);
      alert('保存涂红节点失败：' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  };

  const tools: { id: Tool; icon: typeof Brush; label: string; key: string }[] = [
    { id: 'brush', icon: Brush, label: '红笔涂抹', key: 'B' },
    { id: 'rect', icon: SquareIcon, label: '矩形框选', key: 'R' },
    { id: 'eraser', icon: Eraser, label: '擦掉标记', key: 'E' },
  ];

  return createPortal(
    <div className="fixed inset-0 z-[96] canvas-dark flex flex-col" style={{ background: 'rgba(10,10,12,0.96)' }}>
      {/* 顶栏 */}
      <div className="flex items-center gap-3 px-5 shrink-0" style={{ height: 52, borderBottom: '1px solid var(--canvas-node-border)' }}>
        <span className="text-[14px] font-medium text-[var(--canvas-text-1)]">
          {mode === 'erase' ? '擦除物体' : '局部重绘'}
        </span>
        <span className="text-[11px] text-[var(--canvas-text-3)]">
          用红笔涂抹或拉框标记{mode === 'erase' ? '要移除的物体' : '要重绘的区域'} · B 笔刷 / R 框选 / E 橡皮 / ⌘Z 撤销
        </span>
        <div className="flex-1" />
        <button onClick={onClose} className="p-2 rounded-lg text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] transition-colors">
          <X size={18} />
        </button>
      </div>

      {/* 工具条 */}
      <div className="flex items-center gap-2 px-5 py-2.5 shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        {tools.map((t) => (
          <button
            key={t.id}
            onClick={() => setTool(t.id)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] transition-colors"
            style={{
              background: tool === t.id ? 'rgba(255,46,46,0.15)' : 'rgba(255,255,255,0.04)',
              color: tool === t.id ? '#ff5e5e' : 'var(--canvas-text-2)',
              border: `1px solid ${tool === t.id ? 'rgba(255,46,46,0.4)' : 'transparent'}`,
            }}
          >
            <t.icon size={14} /> {t.label}
          </button>
        ))}
        {tool !== 'rect' && (
          <label className="flex items-center gap-2 ml-3 text-[11px] text-[var(--canvas-text-2)]">
            笔刷
            <input
              type="range" min={8} max={120} value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              className="w-28 accent-[#ff5e5e]"
            />
            <span className="w-7 text-[var(--canvas-text-3)]">{brushSize}</span>
          </label>
        )}
        <div className="flex-1" />
        <button onClick={undo} disabled={undoStack.current.length === 0} className="p-2 rounded-lg text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] transition-colors disabled:opacity-30" title="撤销 ⌘Z">
          <Undo2 size={15} />
        </button>
        <button onClick={redo} disabled={redoStack.current.length === 0} className="p-2 rounded-lg text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] transition-colors disabled:opacity-30" title="重做 ⇧⌘Z">
          <Redo2 size={15} />
        </button>
      </div>

      {/* 画布区 */}
      <div ref={containerRef} className="flex-1 min-h-0 flex items-center justify-center p-6 overflow-hidden">
        <div className="relative max-w-full max-h-full" style={{ cursor: tool === 'rect' ? 'crosshair' : 'none' }}>
          <img
            ref={imgRef}
            src={imageUrl}
            alt=""
            onLoad={handleImgLoad}
            className="max-w-full block select-none"
            style={{ maxHeight: 'calc(100vh - 240px)' }}
            draggable={false}
          />
          <canvas
            ref={maskRef}
            className="absolute inset-0 w-full h-full touch-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          />
          {!imgReady && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 size={20} className="animate-spin text-[var(--canvas-text-3)]" />
            </div>
          )}
          <BrushCursor containerRef={containerRef} size={brushSize} visible={tool !== 'rect'} />
        </div>
      </div>

      {/* 底部：备注（可选） + 保存 */}
      <div className="flex items-center gap-3 px-5 py-4 shrink-0" style={{ borderTop: '1px solid var(--canvas-node-border)' }}>
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleConfirm(); }}
          placeholder="可选：给新节点起个名/备注"
          className="flex-1 px-4 py-3 rounded-xl bg-[rgba(255,255,255,0.05)] border border-[var(--canvas-node-border)] text-[13px] text-[var(--canvas-text-1)] focus:outline-none focus:border-[rgba(31,162,220,0.5)] placeholder:text-[var(--canvas-text-3)]"
        />
        <button
          onClick={() => void handleConfirm()}
          disabled={busy || !hasMark}
          className="flex items-center gap-2 px-5 py-3 rounded-xl text-[13px] text-white font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
          style={{ background: 'var(--canvas-accent)' }}
          title={!hasMark ? '先在图上标记区域' : ''}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : null}
          保存为新节点
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** 跟随鼠标的笔刷圈 */
function BrushCursor({ containerRef, size, visible }: {
  containerRef: React.RefObject<HTMLDivElement>;
  size: number;
  visible: boolean;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !visible) return;
    const onMove = (e: PointerEvent) => setPos({ x: e.clientX, y: e.clientY });
    const onLeave = () => setPos(null);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [containerRef, visible]);

  if (!visible || !pos) return null;
  return createPortal(
    <div
      className="fixed pointer-events-none z-[97] rounded-full"
      style={{
        left: pos.x - size / 2,
        top: pos.y - size / 2,
        width: size,
        height: size,
        border: '2px solid rgba(255,94,94,0.9)',
        background: 'rgba(255,46,46,0.15)',
      }}
    />,
    document.body,
  );
}
