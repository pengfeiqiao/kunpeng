import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Search, Sparkles, Star, X } from 'lucide-react';
import {
  MG_STYLE_CATEGORIES,
  MG_STYLE_PRESETS,
  getMgStyleCategoryId,
  getMgStylePreview,
  type MgStyleCategoryId,
} from '@/lib/omni/styles';

type StyleContext = 'text' | 'video';

interface OmniStyleLibraryProps {
  open: boolean;
  selectedId: string;
  accentId?: string;
  context: StyleContext;
  onApply: (selection: {
    styleId: string;
    accentStyleId?: string;
  }) => void | Promise<void>;
  onClose: () => void;
}

const VIDEO_RECOMMENDATIONS = [
  'talking-head-premium',
  'keyword-icon-bursts',
  'side-panel-callouts',
  'captionless-visual',
];

const TEXT_RECOMMENDATIONS = [
  'app-premium-3d',
  'kinetic-infographic',
  'absurd-object-ad',
  'particle-swarm',
];

export default function OmniStyleLibrary({
  open,
  selectedId,
  accentId,
  context,
  onApply,
  onClose,
}: OmniStyleLibraryProps) {
  const [categoryId, setCategoryId] = useState<MgStyleCategoryId | 'all'>('all');
  const [query, setQuery] = useState('');
  const [draftStyleId, setDraftStyleId] = useState(selectedId);
  const [draftAccentId, setDraftAccentId] = useState<string | undefined>(accentId);
  const recommendationIds = context === 'video' ? VIDEO_RECOMMENDATIONS : TEXT_RECOMMENDATIONS;

  useEffect(() => {
    if (!open) return;
    setDraftStyleId(selectedId);
    setDraftAccentId(accentId);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [accentId, onClose, open, selectedId]);

  const styles = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return MG_STYLE_PRESETS.filter((style) => {
      if (categoryId !== 'all' && getMgStyleCategoryId(style) !== categoryId) return false;
      if (!normalized) return true;
      return [
        style.name,
        style.id,
        style.bestFor,
        ...(style.tags ?? []),
      ].filter(Boolean).join(' ').toLowerCase().includes(normalized);
    });
  }, [categoryId, query]);

  const recommended = recommendationIds
    .map((id) => MG_STYLE_PRESETS.find((style) => style.id === id))
    .filter((style): style is NonNullable<typeof style> => Boolean(style));

  const handleApply = () => {
    void onApply({
      styleId: draftStyleId,
      accentStyleId: draftAccentId === draftStyleId ? undefined : draftAccentId,
    });
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="canvas-dark fixed inset-0 z-[99998]">
          <motion.button
            type="button"
            aria-label="关闭风格库"
            className="absolute inset-0 bg-black/35"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: 48, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 48, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="absolute inset-y-0 right-0 w-[min(960px,calc(100vw-72px))] flex flex-col border-l border-[var(--canvas-node-border)] bg-[var(--canvas-panel)] shadow-2xl"
          >
            <header className="h-16 px-5 flex items-center gap-4 border-b border-[var(--canvas-node-border)] shrink-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[14px] font-semibold text-[var(--canvas-text-1)]">
                  <Sparkles size={16} />
                  Omni MG 风格库
                  <span className="text-[11px] font-normal text-[var(--canvas-text-3)]">{MG_STYLE_PRESETS.length} 种</span>
                </div>
                <p className="mt-0.5 text-[10px] text-[var(--canvas-text-3)]">点击卡片选择主风格，星标可添加一种点缀风格。</p>
              </div>
              <label className="ml-auto w-64 h-9 px-3 flex items-center gap-2 rounded-md border border-[var(--canvas-node-border)] bg-[rgba(255,255,255,0.04)]">
                <Search size={14} className="text-[var(--canvas-text-3)]" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索风格或用途"
                  className="min-w-0 flex-1 bg-transparent outline-none text-[12px] text-[var(--canvas-text-1)] placeholder:text-[var(--canvas-text-3)]"
                />
              </label>
              <button
                type="button"
                onClick={handleApply}
                className="h-9 shrink-0 rounded-md bg-[var(--canvas-text-1)] px-4 text-[11px] font-semibold text-[#111214] transition-opacity hover:opacity-90"
              >
                应用风格
              </button>
              <button
                type="button"
                onClick={onClose}
                className="w-9 h-9 flex items-center justify-center rounded-md text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)]"
                title="关闭"
              >
                <X size={18} />
              </button>
            </header>

            <div className="px-5 pt-4 shrink-0">
              <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
                <button
                  type="button"
                  onClick={() => setCategoryId('all')}
                  className="px-3 py-1.5 rounded-md text-[11px] whitespace-nowrap transition-colors"
                  style={{
                    color: categoryId === 'all' ? 'var(--canvas-text-1)' : 'var(--canvas-text-3)',
                    background: categoryId === 'all' ? 'rgba(255,255,255,0.1)' : 'transparent',
                  }}
                >
                  全部
                </button>
                {MG_STYLE_CATEGORIES.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => setCategoryId(category.id)}
                    className="px-3 py-1.5 rounded-md text-[11px] whitespace-nowrap transition-colors"
                    style={{
                      color: categoryId === category.id ? 'var(--canvas-text-1)' : 'var(--canvas-text-3)',
                      background: categoryId === category.id ? 'rgba(255,255,255,0.1)' : 'transparent',
                    }}
                    title={category.description}
                  >
                    {category.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
              {!query && categoryId === 'all' && (
                <section className="mb-5">
                  <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-[var(--canvas-text-2)]">
                    <Sparkles size={13} />
                    {context === 'video' ? '适合当前参考视频' : '适合当前纯 MG'}
                  </div>
                  <div className="grid grid-cols-4 gap-2.5">
                    {recommended.map((style) => (
                      <StyleCard
                        key={`recommended-${style.id}`}
                        style={style}
                        selected={style.id === draftStyleId}
                        accented={style.id === draftAccentId}
                        onSelect={() => setDraftStyleId(style.id)}
                        onAccent={() => setDraftAccentId(style.id === draftAccentId ? undefined : style.id)}
                      />
                    ))}
                  </div>
                </section>
              )}

              <section>
                <div className="mb-2 flex items-center justify-between text-[11px] text-[var(--canvas-text-3)]">
                  <span>{categoryId === 'all' ? '全部风格' : MG_STYLE_CATEGORIES.find((item) => item.id === categoryId)?.name}</span>
                  <span>{styles.length} 个结果</span>
                </div>
                <div className="grid grid-cols-4 gap-2.5">
                  {styles.map((style) => (
                    <StyleCard
                      key={style.id}
                      style={style}
                      selected={style.id === draftStyleId}
                      accented={style.id === draftAccentId}
                      onSelect={() => setDraftStyleId(style.id)}
                      onAccent={() => setDraftAccentId(style.id === draftAccentId ? undefined : style.id)}
                    />
                  ))}
                </div>
                {styles.length === 0 && (
                  <div className="py-20 text-center text-[12px] text-[var(--canvas-text-3)]">没有匹配的风格</div>
                )}
              </section>
            </div>

          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function StyleCard({
  style,
  selected,
  accented,
  onSelect,
  onAccent,
}: {
  style: (typeof MG_STYLE_PRESETS)[number];
  selected: boolean;
  accented: boolean;
  onSelect: () => void;
  onAccent: () => void;
}) {
  const preview = getMgStylePreview(style);
  return (
    <div
      className="group relative overflow-hidden rounded-lg border transition-colors"
      style={{
        borderColor: selected ? 'rgba(255,255,255,0.62)' : 'var(--canvas-node-border)',
        background: selected ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.025)',
      }}
    >
      <button type="button" onClick={onSelect} className="block w-full text-left">
        <div className="relative aspect-[4/3] overflow-hidden bg-[rgba(255,255,255,0.035)]">
          <img
            src={preview.src}
            alt=""
            loading="lazy"
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover object-center transition-transform duration-200 group-hover:scale-[1.025]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/35 to-transparent opacity-70" />
          {selected && (
            <span className="absolute top-2 left-2 w-5 h-5 flex items-center justify-center rounded-full bg-white text-black">
              <Check size={12} strokeWidth={2.6} />
            </span>
          )}
        </div>
        <div className="px-2.5 py-2">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--canvas-text-1)]">{style.name}</span>
            {style.tags?.[0] && <span className="text-[9px] text-[var(--canvas-text-3)]">{style.tags[0]}</span>}
          </div>
          <p className="mt-0.5 h-7 overflow-hidden text-[9px] leading-3.5 text-[var(--canvas-text-3)]">{style.bestFor ?? style.guidance}</p>
        </div>
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onAccent();
        }}
        className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-md bg-black/45 text-white/75 opacity-0 group-hover:opacity-100 hover:text-white transition-opacity"
        style={accented ? { opacity: 1, color: '#f7d56b' } : undefined}
        title={accented ? '取消点缀风格' : '设为点缀风格（最多一个）'}
      >
        <Star size={14} fill={accented ? 'currentColor' : 'none'} />
      </button>
    </div>
  );
}
