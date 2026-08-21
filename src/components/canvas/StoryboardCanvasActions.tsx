import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, GripVertical, Grid2X2, Image as ImageIcon, Loader2, Search, X } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { message as tauriMessage } from '@tauri-apps/api/dialog';
import { useCanvasStore } from '@/stores/canvasStore';
import { useWorkshopStore } from '@/stores/workshopStore';
import {
  composeCanvasSelectionToStoryboardBoard,
  listStoryboardFrameTargets,
  listStoryboardShotTargets,
  writeCanvasImageToStoryboardFrame,
} from '@/lib/workshop/storyboardBridge';
import type { WorkshopRef } from '@/lib/workshop/canvasSync';
import { Z, useEscapeClose } from '@/lib/ui/layers';

export type StoryboardCanvasActionMode = 'writeback' | 'compose';

interface Props {
  mode: StoryboardCanvasActionMode;
  nodeIds: string[];
  onClose: () => void;
}

function nodePreview(nodeId: string) {
  const node = useCanvasStore.getState().nodes.find((item) => item.id === nodeId);
  const data = node?.data as Record<string, unknown> | undefined;
  return {
    node,
    src: (data?.localPath ? convertFileSrc(data.localPath as string) : data?.generatedImageUrl) as string | undefined,
    label: String(data?.description ?? '画布图片').slice(0, 42),
    ref: data?.workshopRef as WorkshopRef | undefined,
  };
}

export default function StoryboardCanvasActions({ mode, nodeIds, onClose }: Props) {
  const data = useWorkshopStore((state) => state.data);
  const project = useWorkshopStore((state) => state.project);
  const [query, setQuery] = useState('');
  const [orderedIds, setOrderedIds] = useState(nodeIds);
  const [shotId, setShotId] = useState('');
  const [frameId, setFrameId] = useState('');
  const [setCurrent, setSetCurrent] = useState(true);
  const [syncPrompt, setSyncPrompt] = useState(false);
  const [fit, setFit] = useState<'contain' | 'cover'>('contain');
  const [busy, setBusy] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const frameTargets = useMemo(() => listStoryboardFrameTargets(), [data, project]);
  const shotTargets = useMemo(() => listStoryboardShotTargets(), [data, project]);
  const originRef = nodeIds.length === 1 ? nodePreview(nodeIds[0]).ref : undefined;

  useEscapeClose(true, onClose);

  useEffect(() => {
    if (mode === 'writeback' && originRef?.kind === 'storyboardFrame') {
      setShotId(originRef.shotId ?? '');
      setFrameId(originRef.frameId ?? originRef.id);
      return;
    }
    if (mode === 'compose' && shotTargets.length === 1) setShotId(shotTargets[0].shotId);
  }, [mode, originRef?.frameId, originRef?.id, originRef?.kind, originRef?.shotId, shotTargets]);

  const filteredShots = shotTargets.filter((shot) => {
    const needle = query.trim().toLowerCase();
    return !needle || `${shot.shotNo} ${shot.description}`.toLowerCase().includes(needle);
  });
  const selectedShotFrames = frameTargets.filter((target) => target.shotId === shotId);
  const target = frameTargets.find((item) => item.frameId === frameId && item.shotId === shotId);
  const willCreateFrame = mode === 'writeback' && Boolean(shotId) && selectedShotFrames.length === 0;

  const moveDragged = (to: number) => {
    if (dragIndex === null || dragIndex === to) return;
    setOrderedIds((current) => {
      const next = [...current];
      const [item] = next.splice(dragIndex, 1);
      next.splice(to, 0, item);
      return next;
    });
    setDragIndex(to);
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (mode === 'writeback') {
        if (!target && !willCreateFrame) throw new Error('请选择要回传的具体分镜格');
        const result = await writeCanvasImageToStoryboardFrame({
          nodeId: nodeIds[0],
          shotId: target?.shotId ?? shotId,
          frameId: target?.frameId,
          expectedRevision: target?.revision,
          setCurrent,
          syncPrompt,
          clientToken: `ui-${nodeIds[0]}-${target?.frameId ?? `${shotId}-new-frame`}-${Date.now()}`,
        });
        await tauriMessage(
          result.createdFrame
            ? `该镜原本没有故事板，已新建第 1 格并设为当前图`
            : `已回传到 ${result.shotNo} 第 ${result.frameIndex + 1} 格${setCurrent ? '，并设为当前图' : '，已加入候选版本'}`,
          { title: '回传完成' },
        );
      } else {
        if (!shotId) throw new Error('请选择分镜板要回传到哪一镜');
        const result = await composeCanvasSelectionToStoryboardBoard({
          nodeIds: orderedIds,
          shotId,
          fit,
          useInVideo: true,
          clientToken: `ui-board-${orderedIds.join('-')}-${Date.now()}`,
        });
        await tauriMessage(
          `已生成 ${result.board.layout} 分镜板并回传到 ${result.shotNo}。它已排在视频参考图最前面，@图片N 已自动重排。`,
          { title: '分镜板已回传' },
        );
      }
      onClose();
    } catch (err) {
      await tauriMessage(err instanceof Error ? err.message : String(err), { title: '操作未完成' });
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="canvas-dark fixed inset-0 flex items-center justify-center p-5"
      style={{ zIndex: Z.modal, background: 'rgba(0,0,0,0.62)' }}
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[88vh] w-[min(920px,94vw)] flex-col overflow-hidden rounded-2xl border border-[var(--canvas-node-border)] bg-[var(--canvas-panel)] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between border-b border-[var(--canvas-node-border)] px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-[var(--canvas-text-1)]">
              {mode === 'writeback' ? '回传到故事板分镜' : '拼成完整分镜板'}
            </h2>
            <p className="mt-1 text-[11px] text-[var(--canvas-text-3)]">
              {mode === 'writeback'
                ? '默认识别来源格；也可以精确选择其他镜头和格子。回传会保留历史版本。'
                : `已选 ${orderedIds.length} 张图片。先确认顺序和显示方式，再选择视频提示词所属镜头。`}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-[var(--canvas-text-3)] hover:bg-[var(--canvas-controls-hover)] hover:text-[var(--canvas-text-1)]">
            <X size={16} />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(280px,0.88fr)_minmax(360px,1.12fr)] overflow-hidden">
          <section className="overflow-y-auto border-r border-[var(--canvas-node-border)] p-4">
            <div className="mb-2 text-[11px] font-medium text-[var(--canvas-text-2)]">
              {mode === 'writeback' ? '回传图片' : '拼板顺序'}
            </div>
            <div className={mode === 'writeback' ? '' : 'grid grid-cols-2 gap-2'}>
              {(mode === 'writeback' ? nodeIds : orderedIds).map((nodeId, index) => {
                const preview = nodePreview(nodeId);
                return (
                  <div
                    key={nodeId}
                    draggable={mode === 'compose'}
                    onDragStart={() => setDragIndex(index)}
                    onDragEnter={() => moveDragged(index)}
                    onDragEnd={() => setDragIndex(null)}
                    className="group mb-2 overflow-hidden rounded-lg border border-[var(--canvas-node-border)] bg-black/20"
                  >
                    <div className="relative aspect-video bg-black/35">
                      {preview.src
                        ? <img src={preview.src} alt="" className="h-full w-full object-contain" />
                        : <div className="flex h-full items-center justify-center text-[var(--canvas-text-3)]"><ImageIcon size={18} /></div>}
                      {mode === 'compose' && (
                        <>
                          <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">{index + 1}</span>
                          <span className="absolute right-1.5 top-1.5 cursor-grab rounded bg-black/70 p-1 text-white"><GripVertical size={12} /></span>
                        </>
                      )}
                    </div>
                    <div className="truncate px-2 py-1.5 text-[10px] text-[var(--canvas-text-3)]">{preview.label}</div>
                  </div>
                );
              })}
            </div>
            {mode === 'compose' && (
              <div className="mt-3">
                <div className="mb-2 text-[11px] font-medium text-[var(--canvas-text-2)]">图片显示</div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setFit('contain')}
                    className={`rounded-lg border px-3 py-2 text-[11px] ${fit === 'contain' ? 'border-[var(--canvas-node-border-selected)] text-[var(--canvas-accent)]' : 'border-[var(--canvas-node-border)] text-[var(--canvas-text-2)]'}`}
                  >
                    完整显示
                  </button>
                  <button
                    onClick={() => setFit('cover')}
                    className={`rounded-lg border px-3 py-2 text-[11px] ${fit === 'cover' ? 'border-[var(--canvas-node-border-selected)] text-[var(--canvas-accent)]' : 'border-[var(--canvas-node-border)] text-[var(--canvas-text-2)]'}`}
                  >
                    铺满裁切
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="min-h-0 overflow-y-auto p-4">
            <div className="relative mb-3">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--canvas-text-3)]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索镜号或画面描述"
                className="h-9 w-full rounded-lg border border-[var(--canvas-node-border)] bg-black/20 pl-8 pr-3 text-[11px] text-[var(--canvas-text-1)] outline-none focus:border-[var(--canvas-node-border-selected)]"
              />
            </div>
            <div className="space-y-2">
              {filteredShots.map((shot) => (
                <div key={shot.shotId} className={`rounded-xl border p-3 ${shotId === shot.shotId ? 'border-[var(--canvas-node-border-selected)] bg-[rgba(45,177,255,0.07)]' : 'border-[var(--canvas-node-border)] bg-black/15'}`}>
                  <button onClick={() => { setShotId(shot.shotId); setFrameId(''); }} className="flex w-full items-start gap-3 text-left">
                    <span className="mt-0.5 flex h-6 min-w-12 items-center justify-center rounded-md bg-black/25 px-2 text-[11px] font-medium text-[var(--canvas-text-1)]">{shot.shotNo}</span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-[11px] leading-relaxed text-[var(--canvas-text-2)]">{shot.description || '未填写画面描述'}</span>
                      <span className="mt-1 block text-[10px] text-[var(--canvas-text-3)]">{shot.frameCount} 格 · {shot.boardCount} 块分镜板</span>
                    </span>
                    {shotId === shot.shotId && mode === 'compose' && <Check size={15} className="mt-1 text-[var(--canvas-accent)]" />}
                  </button>
                  {mode === 'writeback' && shotId === shot.shotId && (
                    <div className="mt-3 border-t border-[var(--canvas-node-border)] pt-3">
                      {selectedShotFrames.length === 0 ? (
                        <div className="flex items-center gap-3 rounded-lg border border-dashed border-[var(--canvas-node-border-selected)] bg-[rgba(45,177,255,0.06)] px-3 py-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[rgba(45,177,255,0.12)] text-[var(--canvas-accent)]">
                            <ImageIcon size={16} />
                          </span>
                          <span>
                            <span className="block text-[11px] font-medium text-[var(--canvas-text-1)]">新建第 1 格故事板</span>
                            <span className="mt-0.5 block text-[10px] text-[var(--canvas-text-3)]">该镜暂无故事板，确认回传后自动创建并设为当前图。</span>
                          </span>
                          <Check size={14} className="ml-auto shrink-0 text-[var(--canvas-accent)]" />
                        </div>
                      ) : (
                        <div className="grid grid-cols-4 gap-2">
                          {selectedShotFrames.map((frame) => (
                            <button
                              key={frame.frameId}
                              onClick={() => setFrameId(frame.frameId)}
                              className={`overflow-hidden rounded-lg border text-left ${frameId === frame.frameId ? 'border-[var(--canvas-node-border-selected)]' : 'border-[var(--canvas-node-border)]'}`}
                              title={frame.prompt}
                            >
                              <div className="aspect-video bg-black/30">
                                {frame.imagePath
                                  ? <img src={convertFileSrc(frame.imagePath)} alt="" className="h-full w-full object-cover" />
                                  : <div className="flex h-full items-center justify-center text-[10px] text-[var(--canvas-text-3)]">无图</div>}
                              </div>
                              <div className="flex items-center justify-between px-2 py-1 text-[10px]">
                                <span className="text-[var(--canvas-text-2)]">第 {frame.frameIndex + 1} 格</span>
                                {frameId === frame.frameId && <Check size={11} className="text-[var(--canvas-accent)]" />}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {filteredShots.length === 0 && (
                <div className="rounded-xl border border-dashed border-[var(--canvas-node-border)] py-10 text-center text-[11px] text-[var(--canvas-text-3)]">
                  当前工坊项目里没有可回传的镜头
                </div>
              )}
            </div>
          </section>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-[var(--canvas-node-border)] px-5 py-3">
          <div className="flex items-center gap-4">
            {mode === 'writeback' && (
              <>
                <label className="flex items-center gap-2 text-[11px] text-[var(--canvas-text-2)]">
                  <input type="checkbox" checked={willCreateFrame || setCurrent} disabled={willCreateFrame} onChange={(event) => setSetCurrent(event.target.checked)} />
                  {willCreateFrame ? '新建首格并设为当前图' : '设为当前图'}
                </label>
                <label className="flex items-center gap-2 text-[11px] text-[var(--canvas-text-2)]" title="默认关闭，避免画布提示词覆盖工坊原提示词">
                  <input type="checkbox" checked={syncPrompt} onChange={(event) => setSyncPrompt(event.target.checked)} />
                  同步提示词
                </label>
              </>
            )}
            {mode === 'compose' && (
              <span className="flex items-center gap-1.5 text-[10px] text-[var(--canvas-text-3)]">
                <Grid2X2 size={12} /> 拼板会自动成为该镜视频参考图，并重排 @图片N
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="h-9 rounded-lg px-4 text-[11px] text-[var(--canvas-text-2)] hover:bg-[var(--canvas-controls-hover)]">取消</button>
            <button
              onClick={() => void submit()}
              disabled={busy || (mode === 'writeback' ? (!target && !willCreateFrame) : !shotId)}
              className="flex h-9 items-center gap-2 rounded-lg bg-[var(--canvas-accent)] px-4 text-[11px] font-medium text-white disabled:opacity-40"
            >
              {busy && <Loader2 size={13} className="animate-spin" />}
              {mode === 'writeback' ? '确认回传' : '生成并回传分镜板'}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
