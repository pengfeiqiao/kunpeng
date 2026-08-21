/**
 * AssetLibraryPanel — left drawer for reusable subjects/voices/styles.
 * Tabs: 角色/商品/场景 (image subjects) · 音色 (voice) · 风格 (director DNA).
 * Selecting assets feeds the generation pipeline: subject images become
 * referenceUrls (@图片N), voice becomes audioUrls (@音频一), style appends
 * its prompt fragment.
 */
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Trash2, UserRound, Package, Mountain, AudioLines, Palette, Check } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { open as openDialog } from '@tauri-apps/api/dialog';
import { useAssetLibraryStore, type AssetType, type LibraryAsset } from '@/stores/assetLibraryStore';
import { useMemoryStore } from '@/stores/memoryStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { loadStyleLibrary, type StylePreset } from '@/lib/styleLibrary';

export interface SelectedAssets {
  /** Image reference paths (subjects), in @图片N order. */
  images: string[];
  /** Voice sample path (at most one). */
  audio?: string;
  /** Style prompt fragment appended to the prompt. */
  stylePrompt?: string;
}

const TABS: { key: AssetType; label: string; icon: typeof UserRound }[] = [
  { key: 'character', label: '角色', icon: UserRound },
  { key: 'product', label: '道具', icon: Package },
  { key: 'scene', label: '场景', icon: Mountain },
  { key: 'voice', label: '音色', icon: AudioLines },
  { key: 'style', label: '风格', icon: Palette },
];

export default function AssetLibraryPanel({ open, onClose, selected, onToggleAsset }: {
  open: boolean;
  onClose: () => void;
  /** ids of currently selected assets (managed by NodeInfoBar). */
  selected: Set<string>;
  onToggleAsset: (asset: LibraryAsset | { id: string; type: 'style'; name: string; stylePrompt: string }) => void;
}) {
  const assets = useAssetLibraryStore((s) => s.assets);
  const addAsset = useAssetLibraryStore((s) => s.addAsset);
  const removeAsset = useAssetLibraryStore((s) => s.removeAsset);
  const directors = useMemoryStore((s) => s.directors);
  const loadAll = useMemoryStore((s) => s.loadAll);
  const [tab, setTab] = useState<AssetType>('character');
  const [styleSubTab, setStyleSubTab] = useState<'library' | 'director'>('library');
  const [styleFilter, setStyleFilter] = useState('');
  const [stylePresets, setStylePresets] = useState<StylePreset[]>([]);
  const filteredDirectors = useMemo(
    () => directors.filter((d) =>
      !styleFilter.trim()
      || d.name.includes(styleFilter)
      || d.description.includes(styleFilter)
      || d.tags.some((t) => t.includes(styleFilter)),
    ),
    [directors, styleFilter],
  );

  const filteredPresets = useMemo(
    () => {
      if (!styleFilter.trim()) return stylePresets;
      const q = styleFilter.trim().toLowerCase();
      return stylePresets.filter((s) => s.name.toLowerCase().includes(q));
    },
    [stylePresets, styleFilter],
  );

  useEffect(() => {
    if (open && tab === 'style' && directors.length === 0) void loadAll();
  }, [open, tab, directors.length, loadAll]);

  useEffect(() => {
    if (open && tab === 'style' && styleSubTab === 'library' && stylePresets.length === 0) {
      loadStyleLibrary().then((data) => setStylePresets(data.styles));
    }
  }, [open, tab, styleSubTab, stylePresets.length]);

  const handleCreate = async () => {
    if (tab === 'voice') {
      const file = await openDialog({ filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a'] }], multiple: false });
      if (!file || Array.isArray(file)) return;
      await addAsset({ name: file.split('/').pop()!.replace(/\.\w+$/, ''), type: 'voice', tags: [], images: [], audioPath: file });
      return;
    }
    const files = await openDialog({ filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }], multiple: true });
    if (!files) return;
    const list = Array.isArray(files) ? files : [files];
    if (list.length === 0) return;
    await addAsset({ name: list[0].split('/').pop()!.replace(/\.\w+$/, ''), type: tab, tags: [], images: list });
  };

  /** Create a subject from the currently selected canvas node's image. */
  const handleFromNode = async () => {
    const { nodes, selectedNodeId } = useCanvasStore.getState();
    const node = nodes.find((n) => n.id === selectedNodeId);
    const d = node?.data as Record<string, unknown> | undefined;
    const path = d?.localPath as string | undefined;
    if (!path) return;
    await addAsset({ name: (d?.description as string)?.slice(0, 12) || '画布主体', type: tab, tags: [], images: [path] });
  };

  const filtered = assets.filter((a) => a.type === tab);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, x: -16, y: '-50%' }}
          animate={{ opacity: 1, x: 0, y: '-50%' }}
          exit={{ opacity: 0, x: -16, y: '-50%' }}
          transition={{ duration: 0.15 }}
          className="absolute left-[88px] top-1/2 z-30 w-[320px] flex flex-col rounded-2xl overflow-hidden"
          style={{ height: 'min(560px, 72vh)', background: 'var(--canvas-panel)', border: '1px solid var(--canvas-node-border)', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}
        >
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--canvas-node-border)]">
            <span className="text-[13px] font-medium text-[var(--canvas-text-1)]">资产库</span>
            <button onClick={onClose} className="p-1 rounded hover:bg-[var(--canvas-controls-hover)] text-[var(--canvas-text-2)]"><X size={14} /></button>
          </div>

          <div className="flex border-b border-[var(--canvas-node-border)]">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] transition-colors ${
                  tab === t.key ? 'text-[var(--canvas-text-1)] bg-[rgba(255,255,255,0.05)]' : 'text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-2)]'
                }`}
              >
                <t.icon size={14} />
                {t.label}
              </button>
            ))}
          </div>

          <div className="canvas-asset-scrollbar flex-1 min-h-0 overflow-y-auto p-2">
            {tab === 'style' ? (
              <div className="space-y-1">
                {/* Sub-tabs: 风格库 / 导演DNA */}
                <div className="flex gap-1 mb-2">
                  <button
                    onClick={() => setStyleSubTab('library')}
                    className={`px-2.5 py-1 rounded-lg text-[10px] transition-colors ${
                      styleSubTab === 'library' ? 'bg-[rgba(255,255,255,0.1)] text-[var(--canvas-text-1)] font-medium' : 'text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-2)]'
                    }`}
                  >
                    风格库
                  </button>
                  <button
                    onClick={() => setStyleSubTab('director')}
                    className={`px-2.5 py-1 rounded-lg text-[10px] transition-colors ${
                      styleSubTab === 'director' ? 'bg-[rgba(255,255,255,0.1)] text-[var(--canvas-text-1)] font-medium' : 'text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-2)]'
                    }`}
                  >
                    导演DNA
                  </button>
                </div>
                <input
                  value={styleFilter}
                  onChange={(e) => setStyleFilter(e.target.value)}
                  placeholder={styleSubTab === 'library' ? '搜索风格...' : '搜索导演/风格关键词…'}
                  className="w-full mb-1.5 px-2.5 py-1.5 rounded-lg text-[11px] bg-[rgba(255,255,255,0.05)] border border-[var(--canvas-node-border)] text-[var(--canvas-text-1)] placeholder:text-[var(--canvas-text-3)] focus:outline-none"
                />
                {styleSubTab === 'library' ? (
                  filteredPresets.length === 0 ? (
                    <div className="text-center py-8 text-[11px] text-[var(--canvas-text-3)]">
                      {stylePresets.length === 0 ? '加载风格库…' : '未找到匹配的风格'}
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-1.5">
                      {filteredPresets.map((s) => {
                        const id = `style-lib-${s.id}`;
                        const isSel = selected.has(id);
                        return (
                          <button
                            key={s.id}
                            onClick={() => onToggleAsset({ id, type: 'style', name: s.name, stylePrompt: s.promptTemplate })}
                            className={`flex flex-col items-center rounded-lg border p-1 transition-colors ${
                              isSel
                                ? 'border-[rgba(31,162,220,0.6)] bg-[rgba(31,162,220,0.1)]'
                                : 'border-[var(--canvas-node-border)] hover:border-[var(--canvas-node-border-selected)] hover:bg-[var(--canvas-controls-hover)]'
                            }`}
                          >
                            <div className="w-full aspect-[4/3] rounded-md overflow-hidden bg-[rgba(0,0,0,0.2)]">
                              <img
                                src={convertFileSrc(s.thumbnailPath)}
                                alt={s.name}
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                            </div>
                            <span className="mt-1 text-[9px] text-[var(--canvas-text-2)] text-center leading-tight line-clamp-2 w-full">
                              {s.name}
                            </span>
                            {isSel && <Check size={10} className="text-[var(--canvas-accent)] mt-0.5" />}
                          </button>
                        );
                      })}
                    </div>
                  )
                ) : directors.length === 0 ? (
                  <div className="text-center py-8 text-[11px] text-[var(--canvas-text-3)]">加载导演风格库…</div>
                ) : (
                  <>
                    <p className="px-1 pb-1 text-[9px] text-[var(--canvas-text-3)] leading-relaxed">
                      选中风格后，生成时会把该导演的视觉基因/镜头语言自动追加到提示词末尾（出图带导演风格）
                    </p>
                    {filteredDirectors.map((d) => {
                      const id = `style-${d.id}`;
                      const isSel = selected.has(id);
                      return (
                        <button
                          key={d.id}
                          onClick={() => onToggleAsset({ id, type: 'style', name: d.name, stylePrompt: `${d.visualDNA} ${d.cameraLanguage}`.trim() })}
                          className={`w-full text-left px-3 py-1.5 rounded-lg transition-colors ${
                            isSel ? 'bg-[rgba(31,162,220,0.12)] border border-[rgba(31,162,220,0.4)]' : 'border border-transparent hover:bg-[var(--canvas-controls-hover)]'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[12px] font-medium text-[var(--canvas-text-1)] shrink-0">{d.name}</span>
                            <span className="text-[10px] text-[var(--canvas-text-3)] truncate flex-1">{d.description}</span>
                            {isSel && <Check size={12} className="text-[var(--canvas-accent)] shrink-0" />}
                          </div>
                          {isSel && (
                            <p className="mt-1 text-[9px] leading-relaxed text-[var(--canvas-accent)] line-clamp-2">
                              将注入提示词 → {d.visualDNA} {d.cameraLanguage}
                            </p>
                          )}
                        </button>
                      );
                    })}
                  </>
                )}
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-8 text-[11px] text-[var(--canvas-text-3)]">
                还没有{TABS.find((t) => t.key === tab)?.label}资产
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {filtered.map((a) => {
                  const isSel = selected.has(a.id);
                  return (
                    <div key={a.id} className="relative group/asset">
                      <button
                        onClick={() => onToggleAsset(a)}
                        className={`w-full rounded-xl overflow-hidden border transition-colors text-left ${
                          isSel ? 'border-[rgba(31,162,220,0.6)] ring-2 ring-[rgba(31,162,220,0.2)]' : 'border-[var(--canvas-node-border)] hover:border-[var(--canvas-node-border-selected)]'
                        }`}
                      >
                        {a.type === 'voice' ? (
                          <div className="h-16 flex items-center justify-center bg-[rgba(255,255,255,0.05)]">
                            <AudioLines size={20} className="text-[var(--canvas-text-2)]" />
                          </div>
                        ) : (
                          <div className="h-20 bg-[rgba(255,255,255,0.05)] relative">
                            {a.images[0] && <img src={convertFileSrc(a.images[0])} alt="" loading="lazy" className="w-full h-full object-cover" />}
                            {a.images.length > 1 && (
                              <span className="absolute bottom-1 right-1 text-[8px] px-1 rounded bg-black/60 text-white">{a.images.length} 图</span>
                            )}
                          </div>
                        )}
                        <div className="px-2 py-1.5 flex items-center justify-between">
                          <span className="text-[10px] text-[var(--canvas-text-1)] truncate">{a.name}</span>
                          {isSel && <Check size={11} className="text-[var(--canvas-accent)] shrink-0" />}
                        </div>
                      </button>
                      <button
                        onClick={() => void removeAsset(a.id)}
                        className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[rgba(255,255,255,0.25)] hover:bg-red-500 text-white items-center justify-center hidden group-hover/asset:flex"
                        title="删除资产"
                      >
                        <Trash2 size={8} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {tab !== 'style' && (
            <div className="p-2 border-t border-[var(--canvas-node-border)] flex gap-1.5">
              <button
                onClick={() => void handleCreate()}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-[var(--canvas-accent)] hover:brightness-110 text-white text-[11px] font-medium transition-all"
              >
                <Plus size={12} />{tab === 'voice' ? '上传音频' : '上传图片建主体'}
              </button>
              {tab !== 'voice' && (
                <button
                  onClick={() => void handleFromNode()}
                  className="px-3 py-2 rounded-lg border border-[var(--canvas-node-border)] text-[11px] text-[var(--canvas-text-2)] hover:bg-[var(--canvas-controls-hover)] transition-colors"
                  title="把当前选中节点的图片存为主体"
                >
                  从节点创建
                </button>
              )}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
