/**
 * ArtifactPickerPanel — in-canvas drawer to pick artifacts from the library
 * and drop them onto the canvas as nodes, without leaving the canvas view.
 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, Film, RefreshCw } from 'lucide-react';
import { useVideoThumb } from '@/lib/canvas/videoThumbs';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { useReactFlow } from 'reactflow';
import { listArtifacts, type ArtifactEntry } from '@/lib/artifacts';
import { useCanvasStore } from '@/stores/canvasStore';
import { nanoid } from 'nanoid';

const PAGE = 40;

interface PickerProps {
  open: boolean;
  onClose: () => void;
  /** 覆盖默认"添加到画布"行为（如工坊选资产图） */
  onPick?: (entry: ArtifactEntry) => void;
  /** 内联模式：不用画布定位（fixed 居中），脱离 reactflow 可用 */
  inline?: boolean;
}

export default function ArtifactPickerPanel({ open, onClose, onPick, inline }: PickerProps) {
  const [entries, setEntries] = useState<ArtifactEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [count, setCount] = useState(PAGE);
  const [tab, setTab] = useState<'image' | 'video'>('image');
  // inline 模式下不在 ReactFlowProvider 内，不能调 useReactFlow
  const flow = inline ? null : useReactFlow(); // eslint-disable-line react-hooks/rules-of-hooks

  const refresh = async () => {
    setLoading(true);
    try {
      setEntries(await listArtifacts());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) { void refresh(); setCount(PAGE); }
  }, [open]);

  const filtered = entries.filter((e) => e.type === tab);
  const visible = filtered.slice(0, count);

  const handlePick = (entry: ArtifactEntry) => {
    if (onPick) { onPick(entry); return; }
    if (!flow) return;
    const { addNode, setSelectedNodeId } = useCanvasStore.getState();
    const center = flow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const url = convertFileSrc(entry.path);
    const id = `node-${nanoid(8)}`;
    addNode({
      id,
      type: entry.type === 'video' ? 'video' : 'image',
      position: { x: center.x + (Math.random() - 0.5) * 80, y: center.y + (Math.random() - 0.5) * 80 },
      data: entry.type === 'video'
        ? {
          generatedVideoUrl: url,
          localPath: entry.path,
          sourceVideoPath: entry.path,
          mediaRole: 'reference',
          description: entry.prompt || '',
        }
        : { generatedImageUrl: url, localPath: entry.path, description: entry.prompt || '' },
    });
    setSelectedNodeId(id);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, x: -16, y: inline ? 0 : '-50%' }}
          animate={{ opacity: 1, x: 0, y: inline ? 0 : '-50%' }}
          exit={{ opacity: 0, x: -16, y: inline ? 0 : '-50%' }}
          className={`${inline ? 'relative' : 'absolute left-[88px] top-1/2'} z-30 w-[300px] flex flex-col bg-[var(--canvas-panel)] rounded-2xl border border-[var(--canvas-node-border)] shadow-xl overflow-hidden`}
          style={{ height: 'min(520px, 70vh)' }}
        >
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--canvas-node-border)]">
            <span className="text-[13px] font-medium text-[var(--canvas-text-1)]">产物库</span>
            <div className="flex items-center gap-1">
              <button onClick={() => void refresh()} className="p-1 rounded hover:bg-[var(--canvas-controls-hover)] text-[var(--canvas-text-2)]" title="刷新">
                {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              </button>
              <button onClick={onClose} className="p-1 rounded hover:bg-[var(--canvas-controls-hover)] text-[var(--canvas-text-2)]">
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="flex border-b border-[var(--canvas-node-border)]">
            {(['image', 'video'] as const).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); setCount(PAGE); }}
                className={`flex-1 py-1.5 text-[12px] ${tab === t ? 'text-[var(--canvas-text-1)] font-medium border-b-2 border-stone-800' : 'text-[var(--canvas-text-2)]'}`}
              >
                {t === 'image' ? '图片' : '视频'}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {visible.length === 0 ? (
              <div className="text-center py-10 text-[12px] text-[var(--canvas-text-3)]">
                {loading ? '加载中…' : '暂无产物'}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-1.5">
                {visible.map((e) => (
                  <button
                    key={e.path}
                    onClick={() => handlePick(e)}
                    className="relative aspect-square rounded-lg overflow-hidden border border-[var(--canvas-node-border)] hover:border-indigo-300 hover:ring-2 hover:ring-indigo-100 bg-[rgba(255,255,255,0.05)]"
                    title={`点击添加到画布\n${e.prompt || e.path.split('/').pop()}`}
                  >
                    {e.type === 'image' ? (
                      <img src={convertFileSrc(e.path)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                    ) : (
                      <PickerVideoThumb path={e.path} />
                    )}
                  </button>
                ))}
              </div>
            )}
            {count < filtered.length && (
              <button
                onClick={() => setCount((c) => c + PAGE)}
                className="w-full mt-2 py-1.5 text-[11px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] rounded-lg hover:bg-[var(--canvas-controls-hover)]"
              >
                加载更多（{filtered.length - count}）
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PickerVideoThumb({ path }: { path: string }) {
  const thumb = useVideoThumb(path);
  return thumb ? (
    <div className="relative w-full h-full">
      <img src={thumb} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
      <Film size={10} className="absolute bottom-1 right-1 text-white drop-shadow" />
    </div>
  ) : (
    <div className="w-full h-full flex items-center justify-center text-[var(--canvas-text-3)]">
      <Film size={18} />
    </div>
  );
}
