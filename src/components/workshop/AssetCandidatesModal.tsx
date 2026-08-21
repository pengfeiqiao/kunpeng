/**
 * AssetCandidatesModal — 资产候选图集：大图预览 + 候选缩略图条 + 选定最终图
 * + 上传/素材库/重新生成入口。所有历史候选永久保留可随时调换。
 */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ImageIcon, Loader2, Maximize2, RefreshCw, Upload, X } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { open as openDialog } from '@tauri-apps/api/dialog';
import { copyFile, BaseDirectory } from '@tauri-apps/api/fs';
import { homeDir } from '@tauri-apps/api/path';
import { useWorkshopStore } from '@/stores/workshopStore';
import { Z, useEscapeClose } from '@/lib/ui/layers';
import ImageFullscreenViewer from '../canvas/ImageFullscreenViewer';
import ArtifactPickerPanel from '../canvas/ArtifactPickerPanel';
import type { AssetCandidate } from '@/lib/workshop/types';

interface Props {
  kind: 'character' | 'scene' | 'prop' | 'colorPalette';
  id: string;
  onClose: () => void;
}

export default function AssetCandidatesModal({ kind, id, onClose }: Props) {
  const data = useWorkshopStore((s) => s.data);
  const selectAssetCandidate = useWorkshopStore((s) => s.selectAssetCandidate);
  const addAssetCandidate = useWorkshopStore((s) => s.addAssetCandidate);
  const generateAsset = useWorkshopStore((s) => s.generateAsset);
  const setSceneSelectedImages = useWorkshopStore((s) => s.setSceneSelectedImages);
  const [fullscreen, setFullscreen] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  // Esc 全局栈：全屏查看器打开时先关查看器，否则关闭弹窗（栈式保证嵌套弹窗只关最上层）
  useEscapeClose(true, () => (fullscreen ? setFullscreen(null) : onClose()));
  // 素材库选择器作为嵌套层单独入栈：打开时 Esc 只关它，不关整个资产弹窗
  useEscapeClose(pickerOpen, () => setPickerOpen(false));

  const item = kind === 'character'
    ? data?.characters.find((c) => c.id === id)
    : kind === 'scene'
      ? data?.scenes.find((s) => s.id === id)
      : kind === 'colorPalette'
        ? (data?.colorPalettes ?? []).find((p) => p.id === id)
        : (data?.props ?? []).find((p) => p.id === id);
  if (!item) return null;

  const candidates: AssetCandidate[] = item.candidates ?? [];
  const sceneItem = item as { selectedImagePaths?: string[]; sceneReferenceMode?: 'multi' };
  const sceneSelectedPaths = kind === 'scene' && sceneItem.sceneReferenceMode === 'multi'
    ? (sceneItem.selectedImagePaths ?? [])
    : [];
  const current = preview ?? item.assetImagePath ?? candidates[0]?.path ?? null;
  const toggleSceneSelected = (path: string) => {
    if (kind !== 'scene') return;
    const next = sceneSelectedPaths.includes(path)
      ? sceneSelectedPaths.filter((p) => p !== path)
      : [...sceneSelectedPaths, path];
    setSceneSelectedImages(id, next);
  };

  const handleUpload = async () => {
    const selected = await openDialog({ filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (!selected || Array.isArray(selected)) return;
    const project = useWorkshopStore.getState().project;
    if (!project) return;
    const ext = selected.split('.').pop() ?? 'png';
    const rel = `.kunpeng/aigc-memory/projects/${project.id}/assets/${kind}-${id.replace(/[^\w-]+/g, '_')}-up-${Date.now()}.${ext}`;
    await copyFile(selected, rel, { dir: BaseDirectory.Home });
    const home = await homeDir();
    addAssetCandidate(kind, id, { path: `${home}${rel}`, source: 'upload', createdAt: Date.now() }, true);
  };

  const handleRegenerate = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      await generateAsset(kind, id);
    } catch { /* error shows on card */ } finally {
      setGenerating(false);
    }
  };

  const handlePickArtifact = async (entry: { path: string; prompt?: string }) => {
    const project = useWorkshopStore.getState().project;
    if (!project) return;
    const ext = entry.path.split('.').pop() ?? 'png';
    const rel = `.kunpeng/aigc-memory/projects/${project.id}/assets/${kind}-${id.replace(/[^\w-]+/g, '_')}-lib-${Date.now()}.${ext}`;
    await copyFile(entry.path, rel, { dir: BaseDirectory.Home });
    const home = await homeDir();
    addAssetCandidate(kind, id, {
      path: `${home}${rel}`, source: 'artifact', prompt: entry.prompt, createdAt: Date.now(),
    }, true);
    setPickerOpen(false);
  };

  return createPortal(
    <div className="fixed inset-0 canvas-dark flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)', zIndex: Z.modal }} onClick={onClose}>
      <div
        className="relative w-[760px] max-w-[92vw] rounded-2xl border border-[var(--canvas-node-border)] flex flex-col overflow-hidden"
        style={{ background: 'var(--canvas-panel)', maxHeight: '86vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--canvas-node-border)] shrink-0">
          <div>
            <span className="text-[14px] font-medium text-[var(--canvas-text-1)]">{item.name}</span>
            <span className="ml-2 text-[11px] text-[var(--canvas-text-3)]">
              {candidates.length} 个候选 · 点击缩略图切换 · 双击设为最终图{kind === 'scene' ? ` · 多角度参考 ${sceneSelectedPaths.length} 张` : ''}
            </span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] transition-colors">
            <X size={15} />
          </button>
        </div>

        {/* Main preview */}
        <div className="flex-1 min-h-0 flex items-center justify-center bg-black/40 relative" style={{ minHeight: 320 }}>
          {current ? (
            <>
              <img src={convertFileSrc(current)} alt="" decoding="async" className="max-w-full object-contain" style={{ maxHeight: '52vh' }} />
              <button
                onClick={() => setFullscreen(convertFileSrc(current))}
                className="absolute top-3 right-3 p-2 rounded-lg bg-black/60 text-white hover:bg-black/80 transition-colors"
                title="全屏查看"
              >
                <Maximize2 size={14} />
              </button>
              {current === item.assetImagePath && (
                <span className="absolute top-3 left-3 px-2 py-1 rounded-lg bg-green-600/80 text-white text-[10px] flex items-center gap-1">
                  <Check size={10} /> 当前最终图
                </span>
              )}
              {kind === 'scene' && (
                <button
                  onClick={() => toggleSceneSelected(current)}
                  className="absolute top-3 left-24 px-2 py-1 rounded-lg bg-black/65 text-white text-[10px] flex items-center gap-1 hover:bg-black/80 transition-colors"
                >
                  <Check size={10} className={sceneSelectedPaths.includes(current) ? 'text-[var(--canvas-accent)]' : 'text-white/35'} />
                  {sceneSelectedPaths.includes(current) ? '多角度参考中' : '加入多角度参考'}
                </button>
              )}
              {current !== item.assetImagePath && (
                <button
                  onClick={() => { selectAssetCandidate(kind, id, current); setPreview(null); }}
                  className="absolute bottom-3 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-lg text-white text-[12px] transition-opacity hover:opacity-90"
                  style={{ background: 'var(--canvas-accent)' }}
                >
                  设为最终图
                </button>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 text-[var(--canvas-text-3)] py-16">
              <ImageIcon size={28} />
              <span className="text-[12px]">还没有候选图，生成或上传一张</span>
            </div>
          )}
        </div>

        {/* Candidate strip */}
        {candidates.length > 0 && (
          <div className="flex gap-2 px-4 py-3 overflow-x-auto border-t border-[var(--canvas-node-border)] shrink-0">
            {candidates.map((c) => (
              <button
                key={c.path}
                onClick={() => setPreview(c.path)}
                onDoubleClick={() => { selectAssetCandidate(kind, id, c.path); setPreview(null); }}
                className="relative shrink-0 rounded-lg overflow-hidden transition-all"
                style={{
                  width: 72, height: 72,
                  border: c.path === item.assetImagePath
                    ? '2px solid #4ade80'
                    : c.path === current ? '2px solid var(--canvas-accent)' : '2px solid transparent',
                }}
                title={`${c.source}${c.engineId ? ` · ${c.engineId}` : ''}`}
              >
                <img src={convertFileSrc(c.path)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                {c.role && (
                  <span className="absolute left-0.5 bottom-0.5 px-1 rounded bg-black/60 text-white text-[10px]">
                    {c.role}
                  </span>
                )}
                {c.path === item.assetImagePath && (
                  <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-green-500 flex items-center justify-center">
                    <Check size={9} className="text-white" />
                  </span>
                )}
                {kind === 'scene' && sceneSelectedPaths.includes(c.path) && c.path !== item.assetImagePath && (
                  <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-[var(--canvas-accent)] flex items-center justify-center">
                    <Check size={9} className="text-white" />
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-[var(--canvas-node-border)] shrink-0">
          <button
            onClick={() => void handleRegenerate()}
            disabled={generating}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: 'var(--canvas-accent)' }}
          >
            {generating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} 再生成候选
          </button>
          <button
            onClick={() => void handleUpload()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-[var(--canvas-text-2)] border border-[var(--canvas-node-border)] hover:text-[var(--canvas-text-1)] transition-colors"
          >
            <Upload size={12} /> 上传本地图
          </button>
          <button
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] text-[var(--canvas-text-2)] border border-[var(--canvas-node-border)] hover:text-[var(--canvas-text-1)] transition-colors"
          >
            <ImageIcon size={12} /> 从素材库选
          </button>
        </div>

        {/* Artifact picker overlay */}
        {pickerOpen && (
          <div className="absolute inset-0 z-10 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={() => setPickerOpen(false)}>
            <div onClick={(e) => e.stopPropagation()}>
              <ArtifactPickerPanel
                open
                onClose={() => setPickerOpen(false)}
                onPick={(entry) => void handlePickArtifact(entry)}
                inline
              />
            </div>
          </div>
        )}
      </div>

      {fullscreen && <ImageFullscreenViewer imageUrl={fullscreen} onClose={() => setFullscreen(null)} />}
    </div>,
    document.body,
  );
}
