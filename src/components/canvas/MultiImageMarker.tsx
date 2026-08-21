/**
 * MultiImageMarker — LibTV-style "标记" cross-image element fusion.
 * Select 2-3 image nodes → right-click "标记融合" → draw one rectangle per
 * image to mark the element to take → elements are cropped client-side and
 * fed as references to gpt-image-2 with an auto-built fusion prompt.
 */
import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Wand2 } from 'lucide-react';
import { nanoid } from 'nanoid';
import { useCanvasStore } from '@/stores/canvasStore';
import { saveCanvasImage } from '@/lib/canvas/assetPersist';
import { captureSnapshot } from '@/lib/canvas/history';
import { generateForNode } from '@/lib/canvasGen';
import { defaultNodeStyle } from '@/lib/canvas/layout';

interface MarkerImage {
  nodeId: string;
  url: string;
}

interface Rect { x: number; y: number; w: number; h: number }

export default function MultiImageMarker({ images, onClose }: {
  images: MarkerImage[];
  onClose: () => void;
}) {
  const [marks, setMarks] = useState<Record<string, Rect>>({});
  const [drawing, setDrawing] = useState<{ nodeId: string; startX: number; startY: number } | null>(null);
  const [prompt, setPrompt] = useState('把标记的元素自然融合到一张新图中，保持各元素的原始外观，光线与透视统一。');
  const [busy, setBusy] = useState(false);
  const imgRefs = useRef<Map<string, HTMLImageElement>>(new Map());

  const onMouseDown = useCallback((nodeId: string, e: React.MouseEvent) => {
    const el = imgRefs.current.get(nodeId);
    if (!el) return;
    const r = el.getBoundingClientRect();
    setDrawing({ nodeId, startX: e.clientX - r.left, startY: e.clientY - r.top });
    setMarks((m) => ({ ...m, [nodeId]: { x: e.clientX - r.left, y: e.clientY - r.top, w: 0, h: 0 } }));
  }, []);

  const onMouseMove = useCallback((nodeId: string, e: React.MouseEvent) => {
    if (!drawing || drawing.nodeId !== nodeId) return;
    const el = imgRefs.current.get(nodeId);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = Math.max(0, Math.min(e.clientX - r.left, r.width));
    const cy = Math.max(0, Math.min(e.clientY - r.top, r.height));
    setMarks((m) => ({
      ...m,
      [nodeId]: {
        x: Math.min(drawing.startX, cx),
        y: Math.min(drawing.startY, cy),
        w: Math.abs(cx - drawing.startX),
        h: Math.abs(cy - drawing.startY),
      },
    }));
  }, [drawing]);

  const onMouseUp = useCallback(() => setDrawing(null), []);

  const markedCount = Object.values(marks).filter((r) => r.w > 8 && r.h > 8).length;

  const handleFuse = async () => {
    if (busy || markedCount < 2) return;
    setBusy(true);
    try {
      // 1) Crop each marked region client-side → save to disk
      const cropPaths: string[] = [];
      for (const img of images) {
        const rect = marks[img.nodeId];
        if (!rect || rect.w <= 8 || rect.h <= 8) continue;
        const el = imgRefs.current.get(img.nodeId)!;
        const scaleX = el.naturalWidth / el.clientWidth;
        const scaleY = el.naturalHeight / el.clientHeight;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(rect.w * scaleX);
        canvas.height = Math.round(rect.h * scaleY);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(
          el,
          Math.round(rect.x * scaleX), Math.round(rect.y * scaleY),
          canvas.width, canvas.height,
          0, 0, canvas.width, canvas.height,
        );
        const path = await saveCanvasImage(canvas.toDataURL('image/png'), 'marker');
        cropPaths.push(path);
      }
      if (cropPaths.length < 2) return;

      // 2) Spawn result node next to the first source
      captureSnapshot();
      const store = useCanvasStore.getState();
      const first = store.nodes.find((n) => n.id === images[0].nodeId);
      const newId = `node-${nanoid(8)}`;
      store.addNode({
        id: newId,
        type: 'image',
        position: {
          x: (first?.position.x ?? 100) + (first?.width ?? 200) + 80,
          y: (first?.position.y ?? 100) + 40,
        },
        style: defaultNodeStyle('image'),
        data: { description: prompt, generationMode: 'image-to-image' },
      });
      for (const img of images) {
        store.onConnect({ source: img.nodeId, target: newId, sourceHandle: null, targetHandle: null });
      }
      store.setSelectedNodeId(newId);
      onClose();

      // 3) Fuse via gpt-image-2 with cropped elements as references
      const refLabels = cropPaths.map((_, i) => `@图片${i + 1}`).join('、');
      await generateForNode({
        nodeId: newId,
        engineId: 'gpt-image-2',
        prompt: `融合 ${refLabels} 中的元素：${prompt}`,
        referenceUrls: cropPaths,
        overwrite: true,
      });
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="canvas-dark fixed inset-0 z-[99999] bg-black/85 backdrop-blur-xl flex flex-col" onMouseUp={onMouseUp}>
      <div className="flex items-center justify-between p-4">
        <div className="text-white/90 text-base font-medium bg-white/10 px-4 py-2 rounded-lg backdrop-blur-md">
          标记融合 — 在每张图上框选要提取的元素（已标记 {markedCount}/{images.length}）
        </div>
        <button onClick={onClose} className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white" title="ESC"><X size={18} /></button>
      </div>

      <div className="flex-1 flex items-center justify-center gap-4 px-8 min-h-0">
        {images.map((img) => {
          const rect = marks[img.nodeId];
          return (
            <div key={img.nodeId} className="relative max-h-full" style={{ maxWidth: `${90 / images.length}%` }}>
              <img
                ref={(el) => { if (el) imgRefs.current.set(img.nodeId, el); }}
                src={img.url}
                alt=""
                draggable={false}
                className="max-w-full max-h-[60vh] object-contain select-none cursor-crosshair"
                onMouseDown={(e) => onMouseDown(img.nodeId, e)}
                onMouseMove={(e) => onMouseMove(img.nodeId, e)}
              />
              {rect && rect.w > 4 && (
                <div
                  className="absolute border-2 border-[var(--canvas-accent)] bg-[rgba(31,162,220,0.12)] pointer-events-none"
                  style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="p-4 flex items-center gap-2 justify-center">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="w-[480px] px-3 py-2 rounded-xl text-[12px] bg-[var(--canvas-panel)] border border-[var(--canvas-node-border)] text-[var(--canvas-text-1)] placeholder:text-[var(--canvas-text-3)] focus:outline-none"
          placeholder="描述融合方式…"
        />
        <button
          onClick={() => void handleFuse()}
          disabled={busy || markedCount < 2}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--canvas-accent)] hover:brightness-110 disabled:opacity-40 text-white text-[12px] font-medium"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
          融合生成
        </button>
      </div>
    </div>,
    document.body,
  );
}
