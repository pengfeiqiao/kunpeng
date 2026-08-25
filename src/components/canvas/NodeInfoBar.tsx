import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { ImageIcon, Film, Sparkles, ArrowUp, ChevronDown, Maximize2, X, Check, Clock, AudioLines, Aperture, Palette, Link2 } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import type { TextNodeData, ImageNodeData } from '@/types/canvas';
import { generateForNode } from '@/lib/canvasGen';
import { classifyWan3LinkUrl } from '@/lib/videoRouter/wan3';
import { useCanvasMention, type MentionItem } from '@/hooks/useCanvasMention';
import { useSlashMenu } from '@/hooks/useSlashMenu';
import { previewPrice, type PricePreview } from '@/lib/rhtv/pricePreview';
import { useSelectedAssets, clearAssets, toggleAsset, type AttachedAsset } from '@/lib/canvas/selectedAssets';
import { collectNodeReferences, selfUploadFallback, selfVideoFallback } from '@/lib/canvas/collectRefs';
import CameraPresetPicker from './CameraPresetPicker';
import StyleLibraryPicker from './StyleLibraryPicker';
import OmniStyleLibrary from './OmniStyleLibrary';
import OmniMgSetupPanel, { type MgGenerationEngine } from './OmniMgSetupPanel';
import OmniNarrativePanel from './OmniNarrativePanel';
import { rewritePromptWithStyle } from '@/lib/styleRewriter';
import type { StylePreset } from '@/lib/styleLibrary';
import { ParamSummaryPill, PopRow, PopSeg, PopSlider, PopToggle, PopInput, PopDivider } from './ParamPopover';
import { nanoid } from 'nanoid';
import { defaultNodeStyle, textNodeSize } from '@/lib/canvas/layout';
import {
  DEFAULT_MG_MOTION_RECIPE,
  buildOmniMgPolishSystemPrompt,
  getMgStylePreview,
  getMgStylePreset,
  type MgMotionRecipe,
} from '@/lib/omni/styles';
import { OMNI_MG_ENGINE_ID, runMinimaxH3MgForCanvasNode, runOmniForCanvasNode, runSeedanceMiniMgForCanvasNode } from '@/lib/omni/workflow';
import { DREAMINA_SEEDANCE_25_ENGINE_ID } from '@/lib/dreamina/video';
import {
  readGlobalVideoPromptTemplate,
  rewriteVideoPrompt,
  type VideoPromptTemplate,
} from '@/lib/videoPrompt/prompt';
import { MIDJOURNEY_VERSIONS, normalizeMidjourneyVersion, type MidjourneyVersion } from '@/lib/midjourney/apimart';
import { MIDJOURNEY_DEFAULT_VERSION, MIDJOURNEY_PARAMETER_PRESETS } from '@/lib/midjourney/prompt';
import {
  applyMidjourneyStylePrompt,
  ensureMidjourneyStyleReference,
  getMidjourneyStyle,
  resolveMidjourneyStyleParameters,
  type MidjourneyStylePreset,
} from '@/lib/midjourney/styles';

function MentionDropdown({ items, activeIdx, onSelect, onHover }: { items: MentionItem[]; activeIdx: number; onSelect: (item: MentionItem) => void; onHover: (i: number) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="absolute bottom-full mb-2 left-0 right-0 z-50 bg-[var(--canvas-panel)] border border-[var(--canvas-node-border)] rounded-xl shadow-lg py-1 max-h-48 overflow-y-auto">
      {items.map((item, i) => (
        <button
          key={item.nodeId}
          onClick={() => onSelect(item)}
          onMouseEnter={() => onHover(i)}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-[11px] transition-colors ${
            i === activeIdx ? 'bg-[rgba(255,255,255,0.07)] text-[var(--canvas-text-1)]' : 'text-[var(--canvas-text-2)] hover:bg-[var(--canvas-controls-hover)]'
          }`}
        >
          {item.thumbnailUrl ? (
            <div className="w-6 h-6 rounded overflow-hidden border border-[var(--canvas-node-border)] shrink-0 bg-[rgba(255,255,255,0.05)]">
              <img src={item.thumbnailUrl} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
            </div>
          ) : item.type === 'image' ? (
            <ImageIcon size={12} className="text-[var(--canvas-text-2)] shrink-0" />
          ) : item.type === 'audio' ? (
            <AudioLines size={12} className="text-[var(--canvas-text-2)] shrink-0" />
          ) : (
            <Film size={12} className="text-[var(--canvas-text-2)] shrink-0" />
          )}
          <span className="truncate">{item.label}</span>
        </button>
      ))}
    </div>
  );
}

function SlashDropdown({ slash, onPick }: {
  slash: ReturnType<typeof useSlashMenu>;
  onPick: (t: import('@/lib/canvas/promptTemplates').PromptTemplate) => void;
}) {
  return (
    <div className="absolute bottom-full mb-2 left-0 right-0 z-50 bg-[var(--canvas-panel)] border border-[var(--canvas-node-border)] rounded-xl shadow-lg py-1 max-h-56 overflow-y-auto">
      <div className="px-3 py-1 text-[9px] text-[var(--canvas-text-3)]">快捷模板</div>
      {slash.templates.map((t, i) => (
        <button
          key={t.id}
          onClick={() => onPick(t)}
          className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-[11px] transition-colors ${
            i === slash.idx ? 'bg-[rgba(255,255,255,0.07)] text-[var(--canvas-text-1)]' : 'text-[var(--canvas-text-2)] hover:bg-[var(--canvas-controls-hover)]'
          }`}
        >
          <span className="font-medium shrink-0">{t.label}</span>
          <span className="text-[10px] text-[var(--canvas-text-3)] truncate">{t.hint}</span>
        </button>
      ))}
    </div>
  );
}

function AttachedAssetChips({ assets }: { assets: AttachedAsset[] }) {
  if (assets.length === 0) return null;
  return (
    <div className="flex min-w-0 items-start gap-1.5 px-3 pt-2">
      <span className="text-[10px] text-[var(--canvas-text-2)] font-medium shrink-0">资产</span>
      <div className="canvas-asset-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-2">
        {assets.map((a) => (
          <span
            key={a.id}
            className="inline-flex shrink-0 items-center gap-1 px-2 py-0.5 rounded-md bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.25)] text-[10px] text-[var(--canvas-text-1)]"
          >
            {a.name}
            <button onClick={() => toggleAsset(a)} className="text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)]">
              <X size={9} />
            </button>
          </span>
        ))}
        {assets.length > 1 && (
          <button onClick={clearAssets} className="shrink-0 text-[9px] text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-2)]">清空</button>
        )}
      </div>
    </div>
  );
}

function cleanPromptRewrite(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '');
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  return s.trim();
}

function PromptModal({ value, title, placeholder, onSave, onClose }: { value: string; title: string; placeholder: string; onSave: (v: string) => void; onClose: () => void }) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setTimeout(() => ref.current?.focus(), 100); }, []);
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = ''; }; }, []);
  const handleSave = () => { onSave(text); onClose(); };

  return createPortal(
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
      className="canvas-dark fixed inset-0 z-[99999] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) handleSave(); }}
    >
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 12 }}
        transition={{ duration: 0.2, ease: 'easeOut' }} className="w-[560px] max-h-[80vh] flex flex-col bg-[var(--canvas-panel)] rounded-2xl shadow-2xl border border-[var(--canvas-node-border)] overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--canvas-node-border)]">
          <span className="text-sm font-medium text-[var(--canvas-text-1)]">{title}</span>
          <div className="flex items-center gap-1">
            <button onClick={handleSave} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--canvas-accent)] hover:brightness-110 text-white text-xs font-medium transition-colors"><Check size={12} />保存</button>
            <button onClick={onClose} className="p-1.5 rounded-lg text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] transition-colors"><X size={16} /></button>
          </div>
        </div>
        <div className="flex-1 p-4 min-h-0">
          <textarea ref={ref} value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && e.metaKey) { e.preventDefault(); handleSave(); } }}
            placeholder={placeholder}
            className="w-full h-full min-h-[280px] text-sm text-[var(--canvas-text-1)] leading-relaxed bg-[rgba(255,255,255,0.05)] border border-[var(--canvas-node-border)] rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[var(--canvas-node-border-selected)] resize-none"
          />
        </div>
        <div className="px-5 py-2.5 border-t border-[var(--canvas-node-border)] flex justify-between items-center">
          <span className="text-[10px] text-[var(--canvas-text-2)]">{text.length} 字</span>
          <span className="text-[10px] text-[var(--canvas-text-3)]">⌘ Enter 保存 · ESC 关闭</span>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

function SelectPill({
  value,
  onChange,
  options,
  title,
  gridCols = 1,
  maxRows,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  title: string;
  gridCols?: 1 | 2 | 3 | 4;
  maxRows?: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);
  const gridMode = gridCols > 1;
  const maxHeight = maxRows ? maxRows * 36 + 8 : undefined;

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  return (
    <div ref={ref} className="relative shrink-0" title={title}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 bg-[rgba(255,255,255,0.05)] hover:bg-[var(--canvas-controls-hover)] border border-[var(--canvas-node-border)] rounded-xl text-[12px] text-[var(--canvas-text-1)] font-medium py-2 pl-3 pr-2 transition-colors"
      >
        {current?.label}
        <ChevronDown size={10} className={`text-[var(--canvas-text-2)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.96 }}
            transition={{ duration: 0.12 }}
            className={`absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-[var(--canvas-panel)] border border-[var(--canvas-node-border)] rounded-xl shadow-lg p-1 z-50 ${gridMode ? 'overflow-y-auto' : 'overflow-hidden'}`}
            style={gridMode ? { width: 520, maxHeight } : undefined}
          >
            <div
              className={gridMode ? 'grid gap-1' : ''}
              style={gridMode ? { gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` } : undefined}
            >
            {options.map((o) => (
              <button
                key={o.value}
                onClick={() => { onChange(o.value); setIsOpen(false); }}
                className={`w-full text-left px-3 py-2 text-[12px] whitespace-nowrap rounded-lg transition-colors ${
                  o.value === value ? 'text-[var(--canvas-text-1)] font-semibold bg-[rgba(255,255,255,0.05)]' : 'text-[var(--canvas-text-2)] hover:bg-[var(--canvas-controls-hover)] hover:text-[var(--canvas-text-1)]'
                }`}
              >
                {o.label}
              </button>
            ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const NUM_TO_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
function numToCn(n: number): string { return n <= 10 ? NUM_TO_CN[n - 1] : String(n); }

const MENTION_SPLIT_RE = /(@(?:图片|视频|音频)[一二三四五六七八九十\d]+)/g;
const MENTION_TEST_RE = /^@(?:图片|视频|音频)[一二三四五六七八九十\d]+$/;

function MentionHighlight({ text }: { text: string }) {
  if (!text) return null;
  const parts = text.split(MENTION_SPLIT_RE);
  return (
    <>
      {parts.map((p, i) =>
        MENTION_TEST_RE.test(p)
          ? <span key={i} style={{ color: '#3b9eff', fontWeight: 500 }}>{p}</span>
          : <span key={i}>{p}</span>,
      )}
    </>
  );
}

function PromptRewriteError({ message, onDismiss }: { message?: string; onDismiss: () => void }) {
  if (!message) return null;
  return (
    <div className="mx-3 mb-2 flex items-start gap-2 rounded-lg border border-red-400/25 bg-red-400/[0.07] px-2.5 py-2 text-[10px] leading-4 text-red-200">
      <span className="min-w-0 flex-1">提示词优化失败：{message}</span>
      <button type="button" onClick={onDismiss} className="shrink-0 rounded p-0.5 text-red-200/70 hover:bg-white/10 hover:text-red-100" title="关闭">
        <X size={11} />
      </button>
    </div>
  );
}

function resizePromptTextarea(el: HTMLTextAreaElement): void {
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
}

/** 参考图样式生成按钮：深色胶囊 [¥估价 ⬤白圆钮] 一体 */
function GenerateButton({ onClick, disabled, price, label }: {
  onClick: () => void; disabled?: boolean; price: PricePreview | null; label?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="group/gen flex items-center gap-2.5 pl-4 pr-1.5 py-1.5 rounded-full transition-all hover:brightness-110 active:scale-95 disabled:opacity-40 shrink-0"
      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
      title={label ?? '生成'}
    >
      <span className="flex items-center gap-1 text-[13px] font-medium" style={{ color: 'rgba(255,255,255,0.62)' }}>
        {price && !price.isFreeThisCall && <span className="text-[12px] opacity-70">¥</span>}
        {price ? (price.isFreeThisCall ? '免费' : price.estimatedPrice) : (label ?? '生成')}
      </span>
      <span
        className="w-9 h-9 rounded-full flex items-center justify-center transition-transform group-hover/gen:scale-105"
        style={{ background: '#ffffff' }}
      >
        <ArrowUp size={17} className="text-black" strokeWidth={2.5} />
      </span>
    </button>
  );
}

/** 估价 hook：endpoint+params 变化 debounce 800ms 调 price-preview */
function usePriceEstimate(endpoint: string | null, params: Record<string, unknown>): PricePreview | null {
  const [price, setPrice] = useState<PricePreview | null>(null);
  const paramsKey = JSON.stringify(params);
  useEffect(() => {
    if (!endpoint) { setPrice(null); return; }
    let alive = true;
    const t = setTimeout(() => {
      void previewPrice(endpoint, JSON.parse(paramsKey)).then((p) => { if (alive) setPrice(p); });
    }, 800);
    return () => { alive = false; clearTimeout(t); };
  }, [endpoint, paramsKey]);
  return price;
}

export default function NodeInfoBar() {
  const selectedNodeId = useCanvasStore((state) => state.selectedNodeId);
  const customMediaApis = useSettingsStore((state) => state.customMediaApis);
  const node = useCanvasStore((state) => (
    state.selectedNodeId
      ? state.nodes.find((item) => item.id === state.selectedNodeId) ?? null
      : null
  ));
  // Keep reference previews fresh without subscribing this 1,900-line panel
  // to the full nodes/edges arrays. Unrelated Agent edits now keep the same
  // scalar key and do not re-render the inspector.
  const referenceDependencyKey = useCanvasStore((state) => {
    const targetId = state.selectedNodeId;
    if (!targetId) return '';
    const incomingEdges = state.edges.filter((edge) => edge.target === targetId);
    const sourceIds = new Set(incomingEdges.map((edge) => edge.source));
    const sourceById = new Map(
      state.nodes
        .filter((item) => sourceIds.has(item.id))
        .map((item) => [item.id, item] as const),
    );
    return incomingEdges
      .map((edge) => {
        const source = sourceById.get(edge.source);
        const data = (source?.data ?? {}) as Record<string, unknown>;
        return [
          edge.id,
          edge.source,
          edge.target,
          data.generatedImageUrl,
          data.referenceImage,
          data.generatedVideoUrl,
          data.audioUrl,
          data.localPath,
        ].join(':');
      })
      .join('|');
  });
  void referenceDependencyKey;
  const triggerAgentAction = useCanvasStore((s) => s.triggerAgentAction);
  const updateNode = useCanvasStore((s) => s.updateNode);

  const [imagePrompt, setImagePrompt] = useState('');
  const [textPrompt, setTextPrompt] = useState('');
  const [panoPrompt, setPanoPrompt] = useState('');
  const [audioPrompt, setAudioPrompt] = useState('');
  const [audioMode, setAudioMode] = useState<'song' | 'tts' | 'music' | 'dubbing'>('music');
  const [songVersion, setSongVersion] = useState('v5');
  const [songTitle, setSongTitle] = useState('');
  const [songStyle, setSongStyle] = useState('');
  const [songInstrumental, setSongInstrumental] = useState(false);
  const [songRewriting, setSongRewriting] = useState(false);
  const [dubbingRefPath, setDubbingRefPath] = useState('');
  const [dubbingGenerating, setDubbingGenerating] = useState(false);
  const [ttsVoice, setTtsVoice] = useState('Wise_Woman');
  const [ttsEmotion, setTtsEmotion] = useState('neutral');
  const [textGenerating, setTextGenerating] = useState(false);
  const [videoPrompt, setVideoPrompt] = useState('');
  // Video params
  const [vResolution, setVResolution] = useState('720p');
  const [vRatio, setVRatio] = useState('16:9');
  const [vDuration, setVDuration] = useState(5);
  const [vModel, setVModel] = useState('seedance-2.0');
  const [wanRefLink, setWanRefLink] = useState('');
  const [videoPromptTemplateOverride, setVideoPromptTemplateOverride] = useState<VideoPromptTemplate | ''>('');
  const [globalVideoPromptTemplate, setGlobalVideoPromptTemplate] = useState<VideoPromptTemplate>(() => readGlobalVideoPromptTemplate());
  const [showPromptOptimizeMenu, setShowPromptOptimizeMenu] = useState(false);
  const [mgStyleId, setMgStyleId] = useState('app-premium-3d');
  const [mgAccentStyleId, setMgAccentStyleId] = useState<string | undefined>();
  const [mgRecipe, setMgRecipe] = useState<MgMotionRecipe>(DEFAULT_MG_MOTION_RECIPE);
  const [mgGenerationEngine, setMgGenerationEngine] = useState<MgGenerationEngine>('minimax-h3');
  const [showMgStyleLibrary, setShowMgStyleLibrary] = useState(false);
  const [showMgNarrative, setShowMgNarrative] = useState(false);
  // Prompt rewrites are asynchronous and this toolbar is reused across selected nodes.
  // Track work by node id so a response started for node A can never overwrite node B.
  const rewriteJobsRef = useRef<Set<string>>(new Set());
  const [rewritingNodeIds, setRewritingNodeIds] = useState<Set<string>>(() => new Set());
  const [rewriteErrors, setRewriteErrors] = useState<Record<string, string>>({});
  // 视频模式：multimodal=全能参考（默认）、t2v=纯文生、startend=首尾帧、dreamina=即梦备用
  const [vMode, setVMode] = useState<'multimodal' | 't2v' | 'startend' | 'dreamina' | 'omni'>('multimodal');
  const [vGenAudio, setVGenAudio] = useState(true);
  const [vSeed, setVSeed] = useState('');
  // Image params
  const [imgSource, setImgSource] = useState('gpt-image-2');
  const [imgRatio, setImgRatio] = useState('16:9');
  const [imgRes, setImgRes] = useState('2k');
  // V8.2 is the production default; V8.1 remains the RunningHub-first route.
  const [mjVersion, setMjVersion] = useState<MidjourneyVersion>(MIDJOURNEY_DEFAULT_VERSION);
  const [mjStylize, setMjStylize] = useState<number>(MIDJOURNEY_PARAMETER_PRESETS.balanced.stylize);
  const [mjChaos, setMjChaos] = useState<number>(MIDJOURNEY_PARAMETER_PRESETS.balanced.chaos);
  const [mjRaw, setMjRaw] = useState(false);
  const [mjStyleWeight, setMjStyleWeight] = useState(100);
  const [mjImageWeight, setMjImageWeight] = useState(1);
  const [mjWeird, setMjWeird] = useState(0);
  const [mjQuality, setMjQuality] = useState<'1' | '4'>('1');
  // Modal states
  const [showImgModal, setShowImgModal] = useState(false);
  const [showVideoModal, setShowVideoModal] = useState(false);
  // Mode: 'api' = 直接调 API, 'agent' = 走 Agent 对话
  const [genMode, setGenMode] = useState<'api' | 'agent'>('api');

  const imageInputRef = useRef<HTMLTextAreaElement>(null);
  const videoInputRef = useRef<HTMLTextAreaElement>(null);
  const isEditingRef = useRef(false);
  const composingRef = useRef(false);
  const [imgFocused, setImgFocused] = useState(false);
  const [vidFocused, setVidFocused] = useState(false);

  const mention = useCanvasMention(selectedNodeId || undefined);
  const imgSlash = useSlashMenu('image');
  const vidSlash = useSlashMenu('video');
  const attachedAssets = useSelectedAssets();

  // ── 估价（RunningHub price-preview，参数变化 debounce 刷新）──
  const isVideoNode = node?.type === 'video';
  const isImageNode = node?.type === 'image';
  const priceEndpoint = isImageNode
    ? (imgSource === 'midjourney'
      ? (mjVersion === 'v8.1' ? 'youchuan/text-to-image-v81' : null)
      : imgSource === 'dreamina'
          ? null // 即梦走 Agent，无 rhtv 估价
          : null) // GPT-Image-2 走智能通道，单个 RunningHub 端点估价会误导
    : isVideoNode
      ? (vModel === 'seedance-2.5'
        ? null
        : vModel === 'minimax-h3'
        ? 'minimax/hailuo-h3/multimodal-to-video'
        : vModel === 'wan-3.0'
        ? 'alibaba/wan-3.0/reference-to-video'
        : vModel.includes('mini')
        ? (vMode === 't2v'
          ? 'rhart-video/sparkvideo-2.0-mini/text-to-video'
          : 'rhart-video/sparkvideo-2.0-mini/image-to-video')
        : vMode === 'startend'
          ? 'rhart-video/sparkvideo-2.0/image-to-video'
          : vMode === 't2v'
            ? `bytedance/${vModel.includes('fast') ? 'seedance-2.0-global-fast' : 'seedance-2.0-global'}/text-to-video`
            : `bytedance/${vModel.includes('fast') ? 'seedance-2.0-global-fast' : 'seedance-2.0-global'}/multimodal-video`)
      : null;
  const fastClampRes = vModel.includes('fast') && vResolution === '1080p' ? '720p' : vResolution;
  // MJ 估价和生成同规：8 个参数缺一不可（少传 → 605 / 估价 null）
  const priceParams = isImageNode
    ? (imgSource === 'midjourney'
      ? { prompt: 'estimate', aspectRatio: imgRatio, stylize: mjStylize, chaos: mjChaos, raw: mjRaw, quality: mjQuality, iw: 1, sw: 100, sv: 6, hd: false }
      : { prompt: 'estimate', aspectRatio: imgRatio, resolution: imgRes })
    : vModel === 'minimax-h3'
      // H3 只有 2K、时长 5-15，且不收 generateAudio 等 Seedance 参数
      ? { prompt: 'estimate', resolution: '2K', ratio: vRatio, duration: String(Math.min(15, Math.max(5, vDuration))) }
      : vModel === 'wan-3.0'
      // 万相 3.0：480P/720P/1080P 三档，时长 2-30
      ? { prompt: 'estimate', resolution: (['480P', '720P', '1080P'].includes(vResolution) ? vResolution : '720P'), aspectRatio: vRatio, duration: String(Math.min(30, Math.max(2, vDuration))) }
      : { prompt: 'estimate', resolution: fastClampRes, ratio: vRatio, duration: String(vDuration), generateAudio: vGenAudio };
  const estPrice = usePriceEstimate(
    genMode === 'api' && vMode !== 'dreamina' ? priceEndpoint : null,
    priceParams,
  );
  const [showCameraPicker, setShowCameraPicker] = useState(false);
  const [showStylePicker, setShowStylePicker] = useState(false);
  const [activeStyle, setActiveStyle] = useState<StylePreset | null>(null);
  const beginNodeRewrite = (nodeId: string): boolean => {
    if (rewriteJobsRef.current.has(nodeId)) return false;
    rewriteJobsRef.current.add(nodeId);
    setRewritingNodeIds((current) => new Set(current).add(nodeId));
    setRewriteErrors((current) => {
      if (!(nodeId in current)) return current;
      const next = { ...current };
      delete next[nodeId];
      return next;
    });
    return true;
  };
  const finishNodeRewrite = (nodeId: string, error?: unknown) => {
    rewriteJobsRef.current.delete(nodeId);
    setRewritingNodeIds((current) => {
      const next = new Set(current);
      next.delete(nodeId);
      return next;
    });
    if (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRewriteErrors((current) => ({ ...current, [nodeId]: message || '模型没有返回可用内容' }));
      console.error(`[NodeInfoBar] prompt rewrite failed for ${nodeId}:`, error);
    }
  };
  const dismissRewriteError = (nodeId: string) => setRewriteErrors((current) => {
    if (!(nodeId in current)) return current;
    const next = { ...current };
    delete next[nodeId];
    return next;
  });
  const isCurrentNodeRewriting = Boolean(node && rewritingNodeIds.has(node.id));
  const currentRewriteError = node ? rewriteErrors[node.id] : undefined;

  useEffect(() => {
    if (!node || isEditingRef.current) return;
    const data = node.data as Record<string, unknown>;
    const desc = (data.description as string) || '';
    if (node.type === 'image') {
      setImagePrompt(desc);
      if (data.imageModel) setImgSource(data.imageModel as string);
      if (data.modelVersion) setMjVersion(normalizeMidjourneyVersion(data.modelVersion));
      if (typeof data.midjourneyStylize === 'number') setMjStylize(data.midjourneyStylize);
      if (typeof data.midjourneyChaos === 'number') setMjChaos(data.midjourneyChaos);
      if (typeof data.midjourneyRaw === 'boolean') setMjRaw(data.midjourneyRaw);
      if (typeof data.midjourneyStyleWeight === 'number') setMjStyleWeight(data.midjourneyStyleWeight);
      if (typeof data.midjourneyImageWeight === 'number') setMjImageWeight(data.midjourneyImageWeight);
      if (typeof data.midjourneyWeird === 'number') setMjWeird(data.midjourneyWeird);
      setActiveStyle(getMidjourneyStyle(data.midjourneyStyleId as string | undefined) ?? null);
      if (data.aspectRatio) setImgRatio(data.aspectRatio as string);
      requestAnimationFrame(() => { if (imageInputRef.current) resizePromptTextarea(imageInputRef.current); });
    }
    if (node.type === 'video') {
      const override = data.videoPromptTemplate === 'legacy' || data.videoPromptTemplate === 'universal'
        ? data.videoPromptTemplate
        : '';
      const globalTemplate = readGlobalVideoPromptTemplate();
      const activeTemplate = override || globalTemplate;
      const storedPrompt = activeTemplate === 'universal'
        ? (data.universalVideoPrompt as string) || desc
        : (data.legacyVideoPrompt as string) || desc;
      setVideoPromptTemplateOverride(override);
      setGlobalVideoPromptTemplate(globalTemplate);
      setVideoPrompt(storedPrompt);
      if (data.resolution) setVResolution(data.resolution as string);
      if (data.aspectRatio) setVRatio(data.aspectRatio as string);
      if (data.duration) setVDuration(data.duration as number);
      setWanRefLink(typeof data.wanRefLink === 'string' ? data.wanRefLink : '');
      // modelVersion 存的是引擎 id（minimax-hailuo-h3），SelectPill 值是短名
      if (data.modelVersion) setVModel(
        data.modelVersion === 'minimax-hailuo-h3'
          ? 'minimax-h3'
          : data.modelVersion === DREAMINA_SEEDANCE_25_ENGINE_ID
            ? 'seedance-2.5'
            : data.modelVersion as string,
      );
      if (data.mgStyleId) setMgStyleId(data.mgStyleId as string);
      setMgAccentStyleId(typeof data.mgAccentStyleId === 'string' ? data.mgAccentStyleId : undefined);
      setMgRecipe({
        ...DEFAULT_MG_MOTION_RECIPE,
        ...(typeof data.mgRecipe === 'object' && data.mgRecipe ? data.mgRecipe as Partial<MgMotionRecipe> : {}),
      });
      if (data.isMgAnimationNode || data.modelVersion === OMNI_MG_ENGINE_ID) {
        const storedMgEngine: MgGenerationEngine = data.mgGenerationEngine === 'minimax-h3'
          || String(data.modelVersion ?? '').includes('minimax-hailuo-h3')
          ? 'minimax-h3'
          : data.mgGenerationEngine === 'seedance-mini'
            || String(data.modelVersion ?? '').includes('seedance-2.0-mini')
            ? 'seedance-mini'
            : data.mgGenerationEngine === 'omni' || data.modelVersion === OMNI_MG_ENGINE_ID
              ? 'omni'
              : 'minimax-h3';
        setVMode('omni');
        setMgGenerationEngine(storedMgEngine);
        setVResolution(storedMgEngine === 'minimax-h3' ? '2K' : '720p');
        setVDuration(storedMgEngine === 'omni'
          ? 10
          : storedMgEngine === 'minimax-h3'
            ? Math.min(15, Math.max(5, Number(data.duration) || 5))
            : Math.min(15, Math.max(4, Number(data.duration) || 5)));
      }
      requestAnimationFrame(() => { if (videoInputRef.current) resizePromptTextarea(videoInputRef.current); });
    }
  }, [
    selectedNodeId,
    node?.type,
    node?.data?.description,
    node?.data?.mgStyleId,
    node?.data?.mgAccentStyleId,
    node?.data?.mgRecipe,
    node?.data?.mgGenerationEngine,
    node?.data?.modelVersion,
    node?.data?.midjourneyStyleId,
    node?.data?.midjourneyStylize,
    node?.data?.midjourneyChaos,
    node?.data?.midjourneyRaw,
    node?.data?.midjourneyStyleWeight,
    node?.data?.midjourneyImageWeight,
    node?.data?.midjourneyWeird,
    node?.data?.videoPromptTemplate,
    node?.data?.legacyVideoPrompt,
    node?.data?.universalVideoPrompt,
  ]);

  // 音频提示词必须跟随节点保存。此前 audioPrompt 只有一份组件状态，
  // 切换多个音频节点时会一直显示最后编辑的内容，造成提示词互相覆盖的假象。
  useEffect(() => {
    if (node?.type !== 'audio') return;
    const data = node.data as Record<string, unknown>;
    setAudioPrompt((data.description as string) || '');
  }, [selectedNodeId, node?.type, node?.data?.description]);

  useEffect(() => {
    if (!node) return;
    const data = node.data as Record<string, unknown>;
    const desc = (data.description as string) || '';
    if (!desc) {
      if (node.type === 'image') setTimeout(() => imageInputRef.current?.focus(), 100);
      if (node.type === 'video') setTimeout(() => videoInputRef.current?.focus(), 100);
    }
  }, [selectedNodeId]);

  if (!node) return null;

  const data = node.data as unknown;

  // ─── Text ───
  if (node.type === 'text') {
    const textData = data as TextNodeData;
    const handleTextGenerate = async () => {
      const prompt = textPrompt.trim();
      if (!prompt || textGenerating) return;
      setTextGenerating(true);
      updateNode(node.id, { isGenerating: true });
      try {
        const { quickChat } = await import('@/lib/agent/quickChat');
        const result = await quickChat([
          { role: 'system', content: '你是专业的创意文案与剧本写手。直接输出成品内容（可用 markdown 排版），不要解释。' },
          { role: 'user', content: prompt },
        ], { maxTokens: 6000, continueOnTruncation: true });
        const size = textNodeSize(result);
        useCanvasStore.setState((state) => ({
          nodes: state.nodes.map((n) => n.id === node.id
            ? { ...n, style: { ...(n.style ?? {}), width: Math.max(n.width ?? 0, size.width), height: Math.max(n.height ?? 0, size.height) }, data: { ...n.data, generatedContent: result, isGenerating: false, justCompletedAt: Date.now() } }
            : n),
        }));
      } catch (err) {
        updateNode(node.id, { isGenerating: false });
        alert(`文本生成失败: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setTextGenerating(false);
      }
    };
    return (
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 w-[720px] max-w-[94vw] bg-[var(--canvas-panel)] backdrop-blur-sm rounded-2xl border border-[var(--canvas-node-border)] shadow-lg px-4 py-3">
        <textarea
          value={textPrompt}
          onChange={(e) => setTextPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleTextGenerate(); }
            e.stopPropagation();
          }}
          placeholder="描述想生成的内容（剧本梗概 / 台词 / 营销文案…），Enter 生成"
          rows={3}
          className="w-full min-h-[76px] resize-none bg-transparent text-[14px] text-[var(--canvas-text-1)] focus:outline-none placeholder:text-[var(--canvas-text-3)] leading-relaxed"
        />
        <div className="flex items-center gap-2.5 mt-2">
          <span className="px-3 py-1.5 rounded-xl text-[12px] bg-[rgba(255,255,255,0.05)] text-[var(--canvas-text-2)]">文本 · 全能语言模型</span>
          <button onClick={() => triggerAgentAction('ai-polish', node.id)} className="px-3 py-1.5 rounded-xl bg-[rgba(255,255,255,0.07)] hover:bg-[var(--canvas-controls-active)] text-[var(--canvas-text-2)] text-[12px] transition-colors">
            润色
          </button>
          <button onClick={() => triggerAgentAction('ai-expand', node.id)} className="px-3 py-1.5 rounded-xl bg-[rgba(255,255,255,0.07)] hover:bg-[var(--canvas-controls-active)] text-[var(--canvas-text-2)] text-[12px] transition-colors">
            扩写
          </button>
          <button
            onClick={() => updateNode(node.id, { isEditing: true })}
            className="p-2 rounded-xl hover:bg-[var(--canvas-controls-hover)] text-[var(--canvas-text-2)] transition-colors"
            title="展开编辑节点内容"
          >
            <Maximize2 size={15} />
          </button>
          <span className="text-[10px] text-[var(--canvas-text-3)] max-w-[120px] truncate">{textData.generatedContent ? `${textData.generatedContent.length} 字` : ''}</span>
          <div className="flex-1" />
          <GenerateButton
            onClick={() => void handleTextGenerate()}
            disabled={!textPrompt.trim() || textGenerating}
            price={null}
            label={textGenerating ? '生成中…' : '文本生成'}
          />
        </div>
      </div>
    );
  }

  // ─── Image ───
  if (node.type === 'image') {
    const imgData = data as ImageNodeData;
    const hasImage = !!(imgData.generatedImageUrl || imgData.referenceImage);
    const isDreamina = imgSource === 'dreamina';

    const handleImageGenerate = async () => {
      const prompt = imagePrompt.trim();
      if (!prompt) return;
      console.log('[handleImageGenerate] prompt:', prompt, 'genMode:', genMode, 'imgSource:', imgSource);
      // 统一参考收集（单一权威顺序 = edge 序，组原地展开，资产图尾部追加，
      // 自身上一轮产物自动排除）。@提及只作确认引用存在，不再重排顺序。
      const assetImages = attachedAssets.flatMap((a) => a.images ?? []);
      const collected = collectNodeReferences(node.id, { extraTailImages: assetImages });
      const refUrls = selfUploadFallback(node.id, collected);

      // Agent 模式 或 即梦引擎 → 走 Agent
      if (genMode === 'agent' || isDreamina) {
        updateNode(node.id, {
          description: prompt,
          imageModel: imgSource,
          aspectRatio: imgRatio,
          ...(imgSource === 'midjourney' ? { modelVersion: mjVersion } : {}),
          ...(isDreamina ? { modelVersion: '5.0Pro', resolution: imgRes } : {}),
        });
        const fullPrompt = refUrls.length > 0 ? `${prompt}\n\n参考图片: ${refUrls.join(', ')}` : prompt;
        triggerAgentAction('ai-generate-image', node.id, fullPrompt);
        return;
      }

      // API 模式：统一走 canvasGen 编排层（rhtv 主链 + dmx 降级）。
      // 上传、轮询、下载、节点回写、任务记录都在编排层内完成。
      updateNode(node.id, {
        imageModel: imgSource,
        aspectRatio: imgRatio,
        ...(imgSource === 'midjourney' ? {
          modelVersion: mjVersion,
          midjourneyStyleId: activeStyle?.id,
          midjourneyStylize: mjStylize,
          midjourneyChaos: mjChaos,
          midjourneyRaw: mjRaw,
          midjourneyStyleWeight: mjStyleWeight,
          midjourneyImageWeight: mjImageWeight,
          midjourneyWeird: mjWeird,
        } : {}),
      });
      const stylePrompts = attachedAssets.map((a) => a.stylePrompt).filter(Boolean);
      const isMj = imgSource === 'midjourney';
      const mjStyle = isMj ? getMidjourneyStyle(activeStyle?.id) : undefined;
      const basePrompt = stylePrompts.length > 0 ? `${prompt}\n风格：${stylePrompts.join('；')}` : prompt;
      const finalPrompt = isMj ? applyMidjourneyStylePrompt(basePrompt, mjStyle) : basePrompt;
      const resolvedMj = resolveMidjourneyStyleParameters(mjStyle, mjStyle?.creativityMode, {
        version: mjVersion,
        aspectRatio: imgRatio,
        stylize: mjStylize,
        chaos: mjChaos,
        raw: mjRaw,
        styleWeight: mjStyleWeight,
        imageWeight: mjImageWeight,
        weird: mjWeird,
      });
      const styleReference = isMj ? await ensureMidjourneyStyleReference(mjStyle) : undefined;
      const imageEngineId = isMj
        ? `midjourney-${mjVersion.replace('.', '')}`
        : imgSource === 'seedream-v5-pro'
          ? 'seedream-v5-pro'
          : imgSource.startsWith('custom-media:')
            ? imgSource
            : 'gpt-image-2';
      const result = await generateForNode({
        nodeId: node.id,
        engineId: imageEngineId,
        prompt: finalPrompt,
        referenceUrls: refUrls,
        styleReferenceUrls: styleReference ? [styleReference] : undefined,
        overwrite: true,
        params: isMj
          ? {
              version: mjVersion,
              aspectRatio: imgRatio,
              stylize: resolvedMj.stylize,
              chaos: resolvedMj.chaos,
              raw: resolvedMj.raw,
              quality: mjQuality,
              sw: resolvedMj.styleWeight,
              iw: resolvedMj.imageWeight,
              weird: resolvedMj.weird,
            }
          : { aspectRatio: imgRatio, resolution: imgRes },
      });
      if (!result.success) {
        alert('生图失败: ' + (result.error || '未知错误'));
      }
    };

    const handleImageToImage = () => {
      const currentImgUrl = imgData.generatedImageUrl || imgData.referenceImage || '';
      if (!currentImgUrl) return;
      const store = useCanvasStore.getState();
      const newId = `node-${nanoid(8)}`;
      const srcPos = node.position || { x: 0, y: 0 };
      store.addNode({
        id: newId,
        type: 'image',
        position: { x: srcPos.x + 220, y: srcPos.y },
        style: defaultNodeStyle('image'),
        data: {
          description: '',
          generationMode: 'image-to-image',
          referenceImage: '',
          generatedImageUrl: '',
          referenceImages: [{ url: currentImgUrl, name: imgData.description?.slice(0, 20) || '参考图' }],
        },
      });
      store.onConnect({ source: node.id, target: newId, sourceHandle: null, targetHandle: null });
      store.setSelectedNodeId(newId);
    };

    const isI2I = imgData.generationMode === 'image-to-image' || (imgData.referenceImages && imgData.referenceImages.length > 0);
    const refImages = imgData.referenceImages || [];

    // When @ selects an image in i2i mode, add to referenceImages
    const handleMentionSelectForImage = (item: MentionItem) => {
      const newText = mention.handleSelect(item, imagePrompt);
      setImagePrompt(newText);
      if (item.type === 'image') {
        const existing = refImages.map(r => r.url);
        if (!existing.includes(item.url)) {
          updateNode(node.id, { referenceImages: [...refImages, { url: item.url, name: item.label }] });
        }
      }
    };

    return (
      <>
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 w-[720px] max-w-[94vw]">
        <div
          className="rounded-2xl border border-[var(--canvas-node-border)]"
          style={{ background: 'rgba(38,38,38,0.88)', backdropFilter: 'blur(12px) saturate(1.4)', boxShadow: '0 4px 24px rgba(0,0,0,0.08), 0 0 0 1px rgba(255,255,255,0.08)' }}
        >
          <AttachedAssetChips assets={attachedAssets} />
          {/* Reference images row */}
          {refImages.length > 0 && (
            <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
              {isI2I && <span className="text-[10px] text-[var(--canvas-text-2)] font-medium shrink-0">参考图</span>}
              <div className="canvas-asset-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-2">
                {refImages.map((ref, i) => (
                  <div key={i} className="relative group/ref shrink-0">
                    <div
                      className="w-10 h-10 rounded-lg overflow-hidden border border-[var(--canvas-node-border)] bg-[rgba(255,255,255,0.05)] cursor-pointer hover:ring-1 hover:ring-[#3b9eff] transition-all"
                      onClick={() => {
                        const m = `@图片${numToCn(i + 1)}`;
                        const ta = imageInputRef.current;
                        if (!ta) { setImagePrompt((p) => p + m); return; }
                        const pos = ta.selectionStart ?? imagePrompt.length;
                        const next = imagePrompt.slice(0, pos) + m + imagePrompt.slice(pos);
                        setImagePrompt(next);
                        requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(pos + m.length, pos + m.length); });
                      }}
                      title={`点击插入 @图片${numToCn(i + 1)}`}
                    >
                      <img src={ref.url} alt="" className="w-full h-full object-cover" />
                    </div>
                    <button
                      onClick={() => updateNode(node.id, { referenceImages: refImages.filter((_, j) => j !== i) })}
                      className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[rgba(255,255,255,0.25)] hover:bg-red-500 text-white flex items-center justify-center opacity-0 group-hover/ref:opacity-100 transition-all"
                    >
                      <X size={8} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Textarea */}
          <div className="px-4 pt-3 pb-3 relative">
            <textarea
              ref={imageInputRef}
              value={imagePrompt}
              onChange={(e) => {
                setImagePrompt(e.target.value);
                resizePromptTextarea(e.target);
                if (!composingRef.current) {
                  mention.handleInputChange(e.target.value, e.target.selectionStart || 0);
                  imgSlash.handleInputChange(e.target.value, e.target.selectionStart || 0);
                }
              }}
              onPaste={(e) => requestAnimationFrame(() => resizePromptTextarea(e.currentTarget))}
              onKeyDown={(e) => {
                if (composingRef.current) return;
                if (imgSlash.show && imgSlash.templates.length > 0) {
                  if (imgSlash.handleKeyDown(e)) {
                    if (e.key === 'Enter') {
                      setImagePrompt(imgSlash.select(imgSlash.templates[imgSlash.idx], imagePrompt));
                    }
                    return;
                  }
                }
                if (mention.showMention && mention.mentionItems.length > 0) {
                  if (mention.handleKeyDown(e)) {
                    if (e.key === 'Enter') {
                      handleMentionSelectForImage(mention.mentionItems[mention.mentionIdx]);
                    }
                    return;
                  }
                }
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleImageGenerate(); }
              }}
              onFocus={() => { isEditingRef.current = true; setImgFocused(true); }}
              onBlur={() => { isEditingRef.current = false; setImgFocused(false); updateNode(node.id, { description: imagePrompt.trim() }); }}
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={(e) => { composingRef.current = false; setImagePrompt((e.target as HTMLTextAreaElement).value); }}
              placeholder={isI2I ? '描述你想基于参考图生成的内容，@ 引用更多图片...' : '描述你想要生成的图片内容，@ 引用画布中的素材...'}
              rows={2}
              className={`w-full min-h-[68px] bg-transparent text-[14px] leading-relaxed focus:outline-none placeholder:text-[var(--canvas-text-3)] resize-none max-h-[180px] text-[var(--canvas-text-1)] ${imgFocused ? '' : 'caret-transparent'}`}
              style={imgFocused ? undefined : { color: 'transparent' }}
            />
            {!imgFocused && (
              <div
                className="absolute inset-0 pointer-events-none overflow-hidden"
                aria-hidden
              >
                <div className="px-4 pt-3 pb-3">
                  <div className="text-[14px] leading-relaxed whitespace-pre-wrap break-words text-[var(--canvas-text-1)] min-h-[68px] max-h-[180px] overflow-hidden">
                    {imagePrompt ? <MentionHighlight text={imagePrompt} /> : (
                      <span className="text-[var(--canvas-text-3)]">
                        {isI2I ? '描述你想基于参考图生成的内容，@ 引用更多图片...' : '描述你想要生成的图片内容，@ 引用画布中的素材...'}
                      </span>
                    )}
                  </div>
                </div>
                {imagePrompt.length > 240 && (
                  <button
                    type="button"
                    onClick={() => setShowImgModal(true)}
                    className="pointer-events-auto absolute bottom-2 right-2 rounded-lg border border-[var(--canvas-node-border)] bg-[var(--canvas-panel)]/95 px-2 py-1 text-[9px] font-medium text-[var(--canvas-text-2)] shadow-md hover:text-[var(--canvas-text-1)]"
                    title="查看完整图片提示词"
                  >
                    {imagePrompt.length} 字 · 查看全文
                  </button>
                )}
              </div>
            )}
            {mention.showMention && (
              <MentionDropdown items={mention.mentionItems} activeIdx={mention.mentionIdx} onSelect={handleMentionSelectForImage} onHover={(_i) => {}} />
            )}
            {imgSlash.show && (
              <SlashDropdown slash={imgSlash} onPick={(t) => setImagePrompt(imgSlash.select(t, imagePrompt))} />
            )}
            <CameraPresetPicker
              open={showCameraPicker && node.type === 'image'}
              kind="image"
              onClose={() => setShowCameraPicker(false)}
              onAppend={(body) => setImagePrompt((p) => p ? `${p}，${body}` : body)}
            />
            <StyleLibraryPicker
              open={showStylePicker && node.type === 'image'}
              library={imgSource === 'midjourney' ? 'midjourney' : 'general'}
              onClose={() => setShowStylePicker(false)}
              onApply={async (style) => {
                setActiveStyle(style);
                if (style.library === 'midjourney') {
                  const mjStyle = style as MidjourneyStylePreset;
                  const resolved = resolveMidjourneyStyleParameters(mjStyle);
                  const nextVersion = resolved.version;
                  const nextStylize = resolved.stylize;
                  const nextChaos = resolved.chaos;
                  const nextRaw = resolved.raw;
                  setMjVersion(nextVersion);
                  setMjStylize(nextStylize);
                  setMjChaos(nextChaos);
                  setMjRaw(nextRaw);
                  setMjStyleWeight(resolved.styleWeight);
                  setMjImageWeight(resolved.imageWeight);
                  setMjWeird(resolved.weird);
                  updateNode(node.id, {
                    midjourneyStyleId: mjStyle.id,
                    modelVersion: nextVersion,
                    midjourneyStylize: nextStylize,
                    midjourneyChaos: nextChaos,
                    midjourneyRaw: nextRaw,
                    midjourneyStyleWeight: resolved.styleWeight,
                    midjourneyImageWeight: resolved.imageWeight,
                    midjourneyWeird: resolved.weird,
                  });
                }
                const targetNodeId = node.id;
                const currentPrompt = imagePrompt.trim();
                if (currentPrompt && beginNodeRewrite(targetNodeId)) {
                  try {
                    const rewritten = cleanPromptRewrite(await rewritePromptWithStyle(currentPrompt, style));
                    if (!rewritten) throw new Error('模型没有返回可用的图片提示词');
                    const target = useCanvasStore.getState().nodes.find((item) => item.id === targetNodeId);
                    if (!target || target.type !== 'image') throw new Error('目标图片节点已不存在');
                    useCanvasStore.getState().updateNode(targetNodeId, { description: rewritten });
                    if (useCanvasStore.getState().selectedNodeId === targetNodeId) {
                      setImagePrompt(rewritten);
                      requestAnimationFrame(() => { if (imageInputRef.current) resizePromptTextarea(imageInputRef.current); });
                    }
                  } catch (err) {
                    finishNodeRewrite(targetNodeId, err);
                    return;
                  }
                  finishNodeRewrite(targetNodeId);
                }
              }}
              onClear={() => {
                setActiveStyle(null);
                updateNode(node.id, { midjourneyStyleId: undefined });
              }}
            />
          </div>

          <PromptRewriteError message={currentRewriteError} onDismiss={() => dismissRewriteError(node.id)} />

          {/* Divider */}
          <div className="h-px bg-[rgba(255,255,255,0.06)] mx-3" />

          {/* Bottom toolbar */}
          <div className="flex items-center gap-1.5 px-3 py-2.5">
            {/* Mode toggle */}
            <button
              onClick={() => setGenMode(genMode === 'api' ? 'agent' : 'api')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-medium transition-colors shrink-0 border ${
                genMode === 'api'
                  ? 'bg-[rgba(255,255,255,0.1)] border-[var(--canvas-node-border-selected)] text-[var(--canvas-text-1)]'
                  : 'bg-[rgba(255,255,255,0.04)] border-[var(--canvas-node-border)] text-[var(--canvas-text-2)]'
              }`}
              title={genMode === 'api' ? 'API 直连' : 'Agent 模式'}
            >
              {genMode === 'api' ? 'API' : 'Agent'}
            </button>
            <SelectPill
              value={imgSource}
              onChange={setImgSource}
              options={[
                { value: 'gpt-image-2', label: 'GPT-Image-2 智能通道' },
                { value: 'seedream-v5-pro', label: 'Seedream 5 Pro' },
                { value: 'midjourney', label: 'Midjourney' },
                { value: 'dreamina', label: '即梦' },
                ...(customMediaApis ?? [])
                  .filter((api) => api.kind === 'image' && api.enabled)
                  .map((api) => ({ value: `custom-media:${api.id}`, label: api.label })),
              ]}
              title="引擎（GPT/Seedream 使用智能通道；Midjourney 走 APIMart）"
            />
            {imgSource === 'midjourney' && (
              <SelectPill
                value={mjVersion}
                onChange={(value) => {
                  const version = normalizeMidjourneyVersion(value);
                  setMjVersion(version);
                  updateNode(node.id, { modelVersion: version });
                }}
                options={MIDJOURNEY_VERSIONS.map((item) => ({ ...item }))}
                title="Midjourney 版本（统一走 APIMart 通道）"
              />
            )}
            <ParamSummaryPill
              title="生成参数"
              summary={
                imgSource === 'midjourney'
                  ? `${mjVersion.toUpperCase()} / ${imgRatio} / 风格${mjStylize}${mjRaw ? ' / RAW' : ''}`
                  : `${imgRatio} / ${imgRes}`
              }
            >
              <PopRow label="比例">
                <PopSeg
                  value={imgRatio}
                  onChange={(value) => {
                    setImgRatio(value);
                    updateNode(node.id, { aspectRatio: value });
                  }}
                  options={['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'].map((v) => ({ value: v, label: v }))}
                />
              </PopRow>
              {imgSource !== 'midjourney' && (
                <PopRow label="分辨率">
                  <PopSeg
                    value={imgRes}
                    onChange={setImgRes}
                    options={['1k', '2k', '4k'].map((v) => ({ value: v, label: v.toUpperCase() }))}
                  />
                </PopRow>
              )}
              {imgSource === 'midjourney' && (
                <>
                  <PopDivider />
                  <PopRow label="风格化" hint="越高 MJ 美学越强">
                    <PopSeg
                      value={String(mjStylize)}
                      onChange={(v) => {
                        const value = Number(v);
                        setMjStylize(value);
                        updateNode(node.id, { midjourneyStylize: value });
                      }}
                      options={['0', '50', '100', '250', '500', '1000'].map((v) => ({ value: v, label: v }))}
                    />
                  </PopRow>
                  <PopRow label="混沌度" hint="越高 4 张差异越大">
                    <PopSeg
                      value={String(mjChaos)}
                      onChange={(v) => {
                        const value = Number(v);
                        setMjChaos(value);
                        updateNode(node.id, { midjourneyChaos: value });
                      }}
                      options={['0', '25', '50', '100'].map((v) => ({ value: v, label: v }))}
                    />
                  </PopRow>
                  {mjVersion === 'v8.1' && (
                    <PopRow label="质量">
                      <PopSeg
                        value={mjQuality}
                        onChange={(v) => setMjQuality(v as '1' | '4')}
                        options={[{ value: '1', label: '标准' }, { value: '4', label: '高清' }]}
                      />
                    </PopRow>
                  )}
                  <PopRow label="怪诞度" hint="默认关闭，实验画面再提高">
                    <PopSeg
                      value={String(mjWeird)}
                      onChange={(v) => {
                        const value = Number(v);
                        setMjWeird(value);
                        updateNode(node.id, { midjourneyWeird: value });
                      }}
                      options={['0', '100', '300', '500'].map((v) => ({ value: v, label: v }))}
                    />
                  </PopRow>
                  <PopRow label="RAW 模式" hint="更忠实于提示词">
                    <PopToggle checked={mjRaw} onChange={(value) => {
                      setMjRaw(value);
                      updateNode(node.id, { midjourneyRaw: value });
                    }} />
                  </PopRow>
                </>
              )}
            </ParamSummaryPill>
            <button
              onClick={() => setShowCameraPicker((v) => !v)}
              className={`p-2 rounded-xl transition-colors shrink-0 ${showCameraPicker ? 'bg-[var(--canvas-controls-active)] text-[var(--canvas-text-1)]' : 'text-[var(--canvas-text-2)] hover:bg-[var(--canvas-controls-hover)] hover:text-[var(--canvas-text-1)]'}`}
              title="镜头语言预设（相机组合/运镜）"
            >
              <Aperture size={16} />
            </button>
            <button
              onClick={() => { setShowStylePicker((v) => !v); setShowCameraPicker(false); }}
              className={`p-2 rounded-xl transition-colors shrink-0 ${showStylePicker ? 'bg-[var(--canvas-controls-active)] text-[var(--canvas-text-1)]' : 'text-[var(--canvas-text-2)] hover:bg-[var(--canvas-controls-hover)] hover:text-[var(--canvas-text-1)]'}`}
              title="风格库"
            >
              <Palette size={16} />
            </button>
            {activeStyle && (
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[rgba(31,162,220,0.1)] text-[10px] text-[var(--canvas-accent)] shrink-0">
                <Palette size={10} />
                <span className="max-w-[60px] truncate">{activeStyle.name}</span>
                <button onClick={() => setActiveStyle(null)} className="hover:text-white"><X size={8} /></button>
              </div>
            )}
            {isCurrentNodeRewriting && (
              <span className="text-[10px] text-[var(--canvas-text-3)] animate-pulse shrink-0">改写中...</span>
            )}

            {/* Spacer */}
            <div className="flex-1" />

            {/* Expand */}
            <button onClick={() => setShowImgModal(true)} className="p-2 rounded-xl hover:bg-[var(--canvas-controls-hover)] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] transition-colors shrink-0" title="展开编辑">
              <Maximize2 size={16} />
            </button>

            {/* Derive */}
            {hasImage && (
              <button onClick={handleImageToImage} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[rgba(255,255,255,0.07)] hover:bg-[var(--canvas-controls-active)] text-[var(--canvas-text-1)] text-[12px] font-medium transition-colors shrink-0">
                <Sparkles size={12} />衍生
              </button>
            )}

            {/* Generate */}
            <GenerateButton onClick={handleImageGenerate} disabled={!imagePrompt.trim()} price={estPrice} />
          </div>
        </div>
      </div>
      {/* Generation history thumbnails */}
      {imgData.generationHistory && imgData.generationHistory.length > 0 && (
        <div className="absolute bottom-[72px] left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 bg-[var(--canvas-panel)] backdrop-blur-sm rounded-xl border border-[var(--canvas-node-border)] shadow-md px-2 py-1.5">
          <Clock size={11} className="text-[var(--canvas-text-2)] shrink-0" />
          <div className="flex items-center gap-1 overflow-x-auto max-w-[400px]">
            {imgData.generationHistory.map((h, i) => (
              <button
                key={i}
                onClick={() => updateNode(node.id, { generatedImageUrl: h.url })}
                className={`w-10 h-10 rounded-lg overflow-hidden border-2 shrink-0 transition-colors ${
                  h.url === imgData.generatedImageUrl ? 'border-stone-800' : 'border-[var(--canvas-node-border)] hover:border-[var(--canvas-node-border-selected)]'
                }`}
              >
                <img src={h.url} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}
      <AnimatePresence>
        {showImgModal && (
          <PromptModal
            value={imagePrompt}
            title="图片描述"
            placeholder="输入图片描述..."
            onSave={(v) => { setImagePrompt(v); if (v.trim()) updateNode(node.id, { description: v.trim() }); }}
            onClose={() => setShowImgModal(false)}
          />
        )}
      </AnimatePresence>
      </>
    );
  }

  // ─── Panorama（3D 世界）───
  if (node.type === 'panorama') {
    const handlePanoGenerate = async () => {
      const prompt = panoPrompt.trim();
      if (!prompt) return;
      updateNode(node.id, { description: prompt, isGenerating: true });
      const { generateForNode } = await import('@/lib/canvasGen');
      const fullPrompt = `${prompt}，equirectangular 360 degree panorama, 2:1 aspect ratio, seamless left-right edges, 无接缝全景图, 球面投影`;
      const result = await generateForNode({
        nodeId: node.id,
        engineId: 'gpt-image-2',
        prompt: fullPrompt,
        params: { aspectRatio: '21:9', resolution: '2k' },
        overwrite: true,
      });
      if (result.success && result.primaryUrl) {
        updateNode(node.id, { panoramaUrl: result.primaryUrl, localPath: result.resultPaths[0], isGenerating: false, justCompletedAt: Date.now() });
      } else {
        updateNode(node.id, { isGenerating: false });
        if (result.error) alert(`全景生成失败: ${result.error}`);
      }
    };
    return (
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 w-[600px] max-w-[92vw] bg-[var(--canvas-panel)] backdrop-blur-sm rounded-2xl border border-[var(--canvas-node-border)] shadow-lg px-3 py-2.5">
        <textarea
          value={panoPrompt}
          onChange={(e) => setPanoPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handlePanoGenerate(); }
            e.stopPropagation();
          }}
          placeholder="描述 360° 场景（环境/光线/氛围），生成后可拖拽环视、设为导演台背景"
          rows={2}
          className="w-full resize-none bg-transparent text-xs text-[var(--canvas-text-1)] focus:outline-none placeholder:text-[var(--canvas-text-3)] leading-relaxed"
        />
        <div className="flex items-center gap-2 mt-1.5">
          <span className="px-2 py-1 rounded-lg text-[11px] bg-[rgba(255,255,255,0.05)] text-[var(--canvas-text-2)]">3D 世界 · 全景图</span>
          <span className="text-[10px] text-[var(--canvas-text-3)]">宽幅 2:1 球面投影</span>
          <div className="flex-1" />
          <GenerateButton
            onClick={() => void handlePanoGenerate()}
            disabled={!panoPrompt.trim()}
            price={null}
            label="生成全景"
          />
        </div>
      </div>
    );
  }

  // ─── Audio（写歌 / 配音 / 纯音乐 / 台词配音）───
  if (node.type === 'audio') {
    const audioData = data as Record<string, unknown>;
    const hasAudio = Boolean(audioData.audioUrl);
    const handleAudioGenerate = async () => {
      if (audioMode === 'dubbing') {
        const prompt = audioPrompt.trim();
        if (!prompt) return;
        setDubbingGenerating(true);
        updateNode(node.id, { description: prompt, isGenerating: true });
        try {
          const { fetchSpeechAudioBytes, generateSpeech } = await import('@/lib/doubaoSpeech/client');
          const { readBinaryFile, writeBinaryFile, createDir } = await import('@tauri-apps/api/fs');
          const { invoke } = await import('@tauri-apps/api/tauri');
          const references: { audio_data?: string }[] = [];
          if (dubbingRefPath) {
            const bytes = await readBinaryFile(dubbingRefPath);
            const u8 = new Uint8Array(bytes);
            let binary = '';
            for (let i = 0; i < u8.length; i++) binary += String.fromCharCode(u8[i]);
            references.push({ audio_data: btoa(binary) });
          }
          const resp = await generateSpeech({
            text_prompt: prompt,
            references: references.length > 0 ? references : undefined,
          });
          const workspace = await invoke<string>('ensure_workspace');
          const dir = `${workspace}/audio`;
          await createDir(dir, { recursive: true }).catch(() => {});
          const arr = await fetchSpeechAudioBytes(resp);
          const path = `${dir}/dubbing_${Date.now()}.mp3`;
          await writeBinaryFile(path, arr);
          const assetUrl = `asset://localhost/${encodeURIComponent(path)}`;
          updateNode(node.id, {
            isGenerating: false,
            justCompletedAt: Date.now(),
            audioUrl: assetUrl,
            localPath: path,
            fileName: path.split('/').pop(),
          });
        } catch (err) {
          updateNode(node.id, { isGenerating: false });
          alert(`台词配音失败: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          setDubbingGenerating(false);
        }
        return;
      }
      const prompt = audioPrompt.trim();
      if (!prompt && !(audioMode === 'song' && songInstrumental)) return;
      updateNode(node.id, { description: prompt, isGenerating: true });
      const { runGeneration } = await import('@/lib/canvasGen');
      const engineId = audioMode === 'song' ? 'suno-v5' : audioMode === 'tts' ? 'minimax-speech' : 'minimax-music';
      // 实测必传参数（price-preview 验证 2026-06-11）
      const audioParams: Record<string, string | number | boolean> = {};
      if (audioMode === 'song') {
        // Suno（APIMart）：custom 自定义模式，prompt 作歌词
        audioParams.custom = true;
        audioParams.version = songVersion;
        audioParams.instrumental = songInstrumental;
        if (songTitle.trim()) audioParams.title = songTitle.trim();
        if (songStyle.trim()) audioParams.style = songStyle.trim();
      } else if (audioMode === 'tts') {
        audioParams.text = prompt;
        audioParams.voice_id = ttsVoice;
        audioParams.emotion = ttsEmotion;
        audioParams.enable_base64_output = false;
        audioParams.english_normalization = false;
        audioParams.speed = 1;
        audioParams.volume = 1;
        audioParams.pitch = 0;
      } else {
        audioParams.lyrics = '';
        audioParams.bitrate = '256000';
        audioParams.sampleRate = '44100';
      }
      const result = await runGeneration({ engineId, prompt, params: audioParams, nodeId: node.id });
      if (result.success && result.resultPaths[0]) {
        updateNode(node.id, {
          isGenerating: false,
          justCompletedAt: Date.now(),
          audioUrl: result.resultUrls[0],
          localPath: result.resultPaths[0],
          fileName: result.resultPaths[0].split('/').pop(),
        });
      } else {
        updateNode(node.id, { isGenerating: false });
        if (result.error) alert(`音频生成失败: ${result.error}`);
      }
    };
    const handleSunoRewrite = async () => {
      const rough = [songStyle.trim(), audioPrompt.trim()].filter(Boolean).join('\n');
      if (!rough) return;
      setSongRewriting(true);
      try {
        const { quickChat } = await import('@/lib/agent/quickChat');
        const { SUNO_REWRITE_SYSTEM_PROMPT, parseSunoRewrite } = await import('@/lib/suno/promptTemplate');
        const text = await quickChat([
          { role: 'system', content: SUNO_REWRITE_SYSTEM_PROMPT },
          { role: 'user', content: rough },
        ]);
        const draft = parseSunoRewrite(text);
        if (!draft) throw new Error('改写结果格式无法解析，请重试');
        setSongStyle(draft.style);
        setAudioPrompt(draft.lyrics);
        updateNode(node.id, { description: draft.lyrics });
      } catch (err) {
        alert(`提示词改写失败: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setSongRewriting(false);
      }
    };
    return (
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 w-[600px] max-w-[92vw] bg-[var(--canvas-panel)] backdrop-blur-sm rounded-2xl border border-[var(--canvas-node-border)] shadow-lg px-3 py-2.5">
        <div className="flex items-center gap-0.5 rounded-lg p-0.5 mb-2 w-fit" style={{ background: 'rgba(255,255,255,0.05)' }}>
          {([['song', '写歌'], ['tts', '配音'], ['music', '纯音乐'], ['dubbing', '台词配音']] as const).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setAudioMode(m)}
              className="px-2.5 py-1 rounded-md text-[11px] transition-colors"
              style={{
                background: audioMode === m ? 'rgba(255,255,255,0.12)' : 'transparent',
                color: audioMode === m ? 'var(--canvas-text-1)' : 'var(--canvas-text-3)',
                fontWeight: audioMode === m ? 600 : 400,
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {audioMode === 'song' && (
          <div className="mb-1.5 space-y-1.5">
            <div className="flex gap-2">
              <SelectPill
                value={songVersion}
                onChange={setSongVersion}
                options={[
                  { value: 'v5.5', label: 'Suno v5.5' },
                  { value: 'v5', label: 'Suno v5' },
                  { value: 'v4.5+', label: 'Suno v4.5+' },
                  { value: 'v4.5', label: 'Suno v4.5' },
                  { value: 'v4', label: 'Suno v4' },
                  { value: 'v3.5', label: 'Suno v3.5' },
                ]}
                title="Suno 版本（APIMart 通道）"
              />
              <button
                type="button"
                onClick={() => setSongInstrumental((v) => !v)}
                className="px-2.5 py-1 rounded-md text-[11px] transition-colors"
                style={{
                  background: songInstrumental ? 'rgba(255,255,255,0.12)' : 'transparent',
                  color: songInstrumental ? 'var(--canvas-text-1)' : 'var(--canvas-text-3)',
                }}
                title="纯音乐（无人声）"
              >
                纯音乐
              </button>
              <div className="flex-1" />
              <button
                type="button"
                disabled={songRewriting || (!audioPrompt.trim() && !songStyle.trim())}
                onClick={() => void handleSunoRewrite()}
                className="px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors disabled:opacity-40"
                style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--canvas-text-1)' }}
                title="用 AI 把粗略想法改写成专业 Suno 提示词（风格行 + 结构歌词）"
              >
                {songRewriting ? '改写中…' : '✨ 提示词改写'}
              </button>
            </div>
            <div className="flex gap-2">
              <input
                value={songTitle}
                onChange={(e) => setSongTitle(e.target.value)}
                placeholder="歌名（可留空）"
                className="w-36 px-2 py-1 rounded-lg text-[11px] bg-[rgba(255,255,255,0.04)] border border-[var(--canvas-node-border)] text-[var(--canvas-text-1)] focus:outline-none focus:border-[rgba(255,255,255,0.4)]"
              />
              <input
                value={songStyle}
                onChange={(e) => setSongStyle(e.target.value)}
                placeholder="风格标签（流派+情绪+配器+人声+BPM，如：cinematic pop, 史诗感, 弦乐+钢琴, 女声高亢, 92 BPM）"
                className="flex-1 px-2 py-1 rounded-lg text-[11px] bg-[rgba(255,255,255,0.04)] border border-[var(--canvas-node-border)] text-[var(--canvas-text-1)] focus:outline-none focus:border-[rgba(255,255,255,0.4)]"
              />
            </div>
          </div>
        )}
        <textarea
          value={audioPrompt}
          onChange={(e) => {
            const nextPrompt = e.target.value;
            setAudioPrompt(nextPrompt);
            updateNode(node.id, { description: nextPrompt });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleAudioGenerate(); }
            e.stopPropagation();
          }}
          placeholder={audioMode === 'song' ? '歌词（用 [Verse] [Chorus] 结构标记分段；点「提示词改写」可由 AI 代写）' : audioMode === 'tts' ? '输入要配音的台词文案（支持中英混合）' : audioMode === 'dubbing' ? '台词配音提示词，如：（压低音量，唏嘘口吻）"他十来岁就当了皇帝。"' : '描述音乐氛围与风格（如：紧张悬疑的电影配乐，弦乐渐强，120BPM…）'}
          rows={2}
          className="w-full resize-none bg-transparent text-xs text-[var(--canvas-text-1)] focus:outline-none placeholder:text-[var(--canvas-text-3)] leading-relaxed"
        />
        {audioMode === 'tts' && (
          <div className="flex gap-2 mt-1.5">
            <SelectPill
              value={ttsVoice}
              onChange={setTtsVoice}
              options={[
                { value: 'Wise_Woman', label: '知性女声' },
                { value: 'Friendly_Person', label: '亲和中性' },
                { value: 'Deep_Voice_Man', label: '低沉男声' },
                { value: 'Calm_Woman', label: '沉稳女声' },
                { value: 'Casual_Guy', label: '随性男声' },
                { value: 'Lively_Girl', label: '活泼女声' },
                { value: 'Patient_Man', label: '温和男声' },
                { value: 'Young_Knight', label: '少年音' },
              ]}
              title="音色"
            />
            <SelectPill
              value={ttsEmotion}
              onChange={setTtsEmotion}
              options={[
                { value: 'neutral', label: '平静' },
                { value: 'happy', label: '愉悦' },
                { value: 'sad', label: '低沉' },
                { value: 'angry', label: '愤怒' },
                { value: 'surprised', label: '惊讶' },
              ]}
              title="情绪"
            />
          </div>
        )}
        {audioMode === 'dubbing' && (
          <div className="flex items-center gap-2 mt-1.5">
            <button
              onClick={async () => {
                const { open } = await import('@tauri-apps/api/dialog');
                const selected = await open({ filters: [{ name: '音频', extensions: ['mp3', 'wav', 'm4a', 'flac'] }], multiple: false });
                if (typeof selected === 'string') setDubbingRefPath(selected);
              }}
              className="px-2 py-1 rounded-lg text-[11px] bg-[rgba(255,255,255,0.06)] border border-[var(--canvas-node-border)] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] transition-colors"
            >
              {dubbingRefPath ? `参考音色: ${dubbingRefPath.split('/').pop()}` : '上传参考音色（可选）'}
            </button>
            {dubbingRefPath && (
              <button onClick={() => setDubbingRefPath('')} className="text-[10px] text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-1)]">✕</button>
            )}
          </div>
        )}
        <div className="flex items-center gap-2 mt-1.5">
          <span className="px-2 py-1 rounded-lg text-[11px] bg-[rgba(255,255,255,0.05)] text-[var(--canvas-text-2)]">
            {audioMode === 'song' ? `Suno ${songVersion} · APIMart` : audioMode === 'tts' ? 'MiniMax Speech' : audioMode === 'dubbing' ? 'Doubao Seed-Audio' : 'MiniMax Music'}
          </span>
          {hasAudio && <span className="text-[10px] text-[var(--canvas-text-3)]">已有音频，重新生成将衍生新版本</span>}
          <div className="flex-1" />
          <GenerateButton
            onClick={() => void handleAudioGenerate()}
            disabled={!audioPrompt.trim() || dubbingGenerating}
            price={null}
            label={dubbingGenerating ? '生成中…' : '生成'}
          />
        </div>
      </div>
    );
  }

  // ─── Video ───
  if (node.type === 'video') {
    const effectiveVideoPromptTemplate: VideoPromptTemplate = videoPromptTemplateOverride || globalVideoPromptTemplate;
    const promptSlotPatch = (prompt: string, template = effectiveVideoPromptTemplate) => template === 'universal'
      ? { universalVideoPrompt: prompt }
      : { legacyVideoPrompt: prompt };

    const handleVideoGenerate = async () => {
      const prompt = videoPrompt.trim();
      if (!prompt) return;
      // 统一参考收集：顺序 = edge 序（组原地展开），与工具栏"参考素材"行的
      // @图片N 编号严格一致；音频去重按本地路径形态；视频参考实时收集
      //（源视频后生成/重新生成都拿最新的）。资产库主体图尾部追加。
      const assetImages = attachedAssets.flatMap((a) => a.images ?? []);
      const collected = collectNodeReferences(node.id, { extraTailImages: assetImages });
      const mergedRefs = collected.images.map((r) => r.submitUrl);
      const audioUrls = collected.audios.map((r) => r.submitUrl);
      const videoLimit = vModel === 'seedance-2.5' ? 10 : vModel === 'minimax-h3' ? 3 : vModel === 'wan-3.0' ? 5 : 1;
      const refVideoUrls = selfVideoFallback(node.id, collected).slice(0, videoLimit);

      updateNode(node.id, {
        description: prompt,
        ...promptSlotPatch(prompt),
        resolution: effectiveVRes,
        aspectRatio: vRatio,
        duration: vDuration,
        ...(vModel === 'wan-3.0' ? { wanRefLink: wanRefLink.trim() } : {}),
        // H3 写回引擎 id（非下拉短名），保证徽章/重试链路一致
        modelVersion: vModel === 'minimax-h3'
          ? 'minimax-hailuo-h3'
          : vModel === 'seedance-2.5' ? DREAMINA_SEEDANCE_25_ENGINE_ID : vModel,
      });

      if (vMode === 'omni') {
        const duration = mgGenerationEngine === 'omni'
          ? 10
          : mgGenerationEngine === 'minimax-h3'
            ? Math.min(15, Math.max(5, Math.round(vDuration)))
            : Math.min(15, Math.max(4, Math.round(vDuration)));
        const aspectRatio = vRatio === '9:16' ? '9:16' : '16:9';
        updateNode(node.id, {
          description: prompt,
          resolution: mgGenerationEngine === 'minimax-h3' ? '2K' : '720p',
          aspectRatio,
          duration,
          modelVersion: mgGenerationEngine === 'omni'
            ? OMNI_MG_ENGINE_ID
            : mgGenerationEngine === 'minimax-h3' ? 'minimax-hailuo-h3' : 'seedance-2.0-mini',
          isMgAnimationNode: true,
          mgGenerationEngine,
          mgStyleId,
          mgAccentStyleId,
          mgRecipe,
        });

        if (mgGenerationEngine === 'omni') {
          const result = await runOmniForCanvasNode(node.id, mgStyleId);
          if (!result.success) {
            alert('Omni MG 动画生成失败: ' + (result.error || '未知错误'));
          }
          return;
        }

        if (mgGenerationEngine === 'minimax-h3') {
          const result = await runMinimaxH3MgForCanvasNode(node.id, {
            styleId: mgStyleId,
            duration,
            aspectRatio,
          });
          if (!result.success) {
            alert('MiniMax H3 MG 动画生成失败: ' + (result.error || '未知错误'));
          }
          return;
        }

        const result = await runSeedanceMiniMgForCanvasNode(node.id, {
          styleId: mgStyleId,
          duration,
          aspectRatio,
        });
        if (!result.success) {
          alert('Seedance Mini MG 动画生成失败: ' + (result.error || '未知错误'));
        }
        return;
      }

      // 即梦备用 或 Agent 模式 → 走 Agent 链路
      if (vMode === 'dreamina') {
        const fullPrompt = `${prompt}\n\n[请使用即梦 dreamina 生成此视频（multimodal2video），参数：分辨率 ${effectiveVRes}，比例 ${vRatio}，时长 ${vDuration}s]${mergedRefs.length > 0 ? `\n参考图片: ${mergedRefs.join(', ')}` : ''}`;
        triggerAgentAction('ai-generate-video', node.id, fullPrompt);
        return;
      }
      if (genMode === 'agent') {
        const refs: string[] = [];
        if (mergedRefs.length > 0) refs.push(`参考图片（可作为首帧）: ${mergedRefs.join(', ')}`);
        if (refVideoUrls.length > 0) refs.push(`参考视频（请基于此视频修改，不要文生新视频）: ${refVideoUrls.join(', ')}`);
        const fullPrompt = refs.length > 0 ? `${prompt}\n\n${refs.join('\n')}` : prompt;
        triggerAgentAction('ai-generate-video', node.id, fullPrompt);
        return;
      }

      // API 直连：canvasGen → rhtv，按模式选引擎
      const assetAudio = attachedAssets.map((a) => a.audioPath).filter((x): x is string => Boolean(x));
      const stylePrompts = attachedAssets.map((a) => a.stylePrompt).filter(Boolean);
      const mergedAudio = [...new Set([...audioUrls, ...assetAudio])];
      const finalVPrompt = stylePrompts.length > 0 ? `${prompt}\n风格：${stylePrompts.join('；')}` : prompt;
      const isFastModel = vModel.includes('fast');
      const isMiniModel = vModel.includes('mini');
      const isH3Model = vModel === 'minimax-h3';
      const isWan3Model = vModel === 'wan-3.0';
      const isCustomMediaModel = vModel.startsWith('custom-media:');
      const isSeedance25Model = vModel === 'seedance-2.5';
      // 只有图/音/视频参考全部为空才落 t2v——只连音频/视频（无图）时必须
      // 保持 multimodal 引擎，否则参考素材被 t2v 引擎静默丢弃。
      const hasAnyRef = mergedRefs.length > 0 || mergedAudio.length > 0 || refVideoUrls.length > 0;
      let engineId: string;
      if (vMode === 'startend') {
        engineId = 'startend-v3.1-pro';
      } else if (isSeedance25Model) {
        engineId = DREAMINA_SEEDANCE_25_ENGINE_ID;
      } else if (isH3Model) {
        // MiniMax H3 单端点：i2v/t2v 通用，有参考无参考都用同一个 id
        engineId = 'minimax-hailuo-h3';
      } else if (isWan3Model) {
        // 万相 3.0 全能参考单端点：文生/图/视频/音频/文档/网页同引擎 id
        engineId = 'wan-3.0';
      } else if (isCustomMediaModel) {
        // 自定义视频插件：引擎 id 即 custom-media:{插件id}
        engineId = vModel;
      } else if ((vMode === 't2v' && refVideoUrls.length === 0) || !hasAnyRef) {
        engineId = isMiniModel ? 'seedance-2.0-mini-t2v' : 'seedance-2.0-t2v';
      } else {
        engineId = isMiniModel ? 'seedance-2.0-mini-i2v' : isFastModel ? 'seedance-2.0-fast' : 'seedance-2.0';
      }
      // 显式文生视频：画布上连着的参考不随请求提交（t2v 引擎不支持，
      // 传了会被引擎能力校验拦截报错）
      const isT2v = engineId.endsWith('-t2v');
      // 万相 3.0 参考链接：文档扩展名 → file（文档），其余公网 URL → link（网页）
      const wanLink = isWan3Model ? wanRefLink.trim() : '';
      const wanLinkKind = wanLink ? classifyWan3LinkUrl(wanLink) : null;
      const result = await generateForNode({
        nodeId: node.id,
        engineId,
        prompt: finalVPrompt,
        referenceUrls: isT2v ? [] : mergedRefs,
        audioUrls: isT2v ? [] : mergedAudio,
        videoUrls: isT2v ? [] : refVideoUrls,
        documentUrl: wanLinkKind === 'document' ? wanLink : undefined,
        linkUrl: wanLinkKind === 'link' ? wanLink : undefined,
        overwrite: true,
        // H3 只收 resolution(2K)/duration(5-15)/ratio，不传 Seedance 专有参数
        params: isSeedance25Model
          ? { resolution: effectiveVRes, ratio: vRatio, duration: String(Math.min(30, Math.max(4, Math.round(vDuration)))) }
          : isH3Model
          ? { resolution: '2K', ratio: vRatio, duration: String(Math.min(15, Math.max(5, Math.round(vDuration)))) }
          : isWan3Model
          ? { resolution: effectiveVRes, ratio: vRatio, duration: String(Math.min(30, Math.max(2, Math.round(vDuration)))), generateAudio: vGenAudio }
          : isCustomMediaModel
          ? { resolution: effectiveVRes, ratio: vRatio, duration: String(Math.min(30, Math.max(2, Math.round(vDuration)))) }
          : { resolution: effectiveVRes, ratio: vRatio, duration: String(vDuration), generateAudio: vGenAudio, realPersonMode: true, ...(isMiniModel ? { mode: 'mini' } : isFastModel ? { mode: 'fast' } : {}), ...(vSeed ? { seed: Number(vSeed) } : {}) },
      });
      if (!result.success) {
        alert('生成视频失败: ' + (result.error || '未知错误'));
      }
    };

    const isFast = vModel.includes('fast');
    const isMini = vModel.includes('mini');
    const isH3 = vModel === 'minimax-h3';
    const isWan3 = vModel === 'wan-3.0';
    const isSeedance25 = vModel === 'seedance-2.5';
    // MiniMax H3 分辨率只有 2K 一档（枚举大写 K）；万相 3.0 为 480P/720P/1080P
    const vResOptions = isSeedance25
      ? [{ value: '480p', label: '480p' }, { value: '720p', label: '720p' }]
      : isH3
      ? [{ value: '2K', label: '2K' }]
      : isWan3
      ? [{ value: '480P', label: '480P' }, { value: '720P', label: '720P' }, { value: '1080P', label: '1080P' }]
      : (isFast || isMini)
      ? [{ value: '480p', label: '480p' }, { value: '720p', label: '720p' }, { value: '1080p', label: '1080p' }, { value: '2k', label: '2k' }, { value: '4k', label: '4k' }]
      : [{ value: '480p', label: '480p' }, { value: '720p', label: '720p' }, { value: 'native1080p', label: '原生1080p' }, { value: '1080p', label: '1080p' }, { value: '2k', label: '2k' }, { value: '4k', label: '4k' }];
    // Fast/Mini 模型不支持 1080p — 在渲染期间用钳制值，切换模型的事件回调里
    // 再写回 state（不能在 render 中 setState）。
    const effectiveVRes = isSeedance25
      ? (vResolution === '480p' ? '480p' : '720p')
      : isH3 ? '2K'
      : isWan3 ? (['480P', '720P', '1080P'].includes(vResolution) ? vResolution : '720P')
      : (isFast || isMini) && vResolution === 'native1080p' ? '720p' : vResolution;
    // H3 时长枚举 5-15：普通模式看模型 SelectPill，MG 模式看引擎切换
    const h3DurationMode = (vMode === 'omni' && mgGenerationEngine === 'minimax-h3') || (vMode !== 'omni' && isH3);

    // 连入本节点的参考素材（图/音/视频）——与提交逻辑严格同源：同一个
    // collectNodeReferences 产出，编号即提交顺序（含资产库尾部图），
    // 工具栏点击插入的 @图片N 必然指向提交序第 N 张。
    const vAssetImages = attachedAssets.flatMap((a) => a.images ?? []);
    const vCollected = collectNodeReferences(node.id, { extraTailImages: vAssetImages });
    type VRefItem = { kind: 'image' | 'audio' | 'video'; url: string; name?: string; edgeId?: string };
    const vRefItems: VRefItem[] = [
      ...vCollected.images.map((r): VRefItem => ({
        kind: 'image',
        url: r.url,
        name: r.name || '参考图片',
        edgeId: r.edgeId,
      })),
      ...vCollected.audios.map((r): VRefItem => ({ kind: 'audio', url: r.url, name: r.name || '音频', edgeId: r.edgeId })),
      ...vCollected.videos.map((r): VRefItem => ({ kind: 'video', url: r.url, name: r.name || '视频', edgeId: r.edgeId })),
    ];

    const handlePromptRewrite = async (template: VideoPromptTemplate) => {
      const current = videoPrompt.trim();
      const targetNodeId = node.id;
      if (!current || !beginNodeRewrite(targetNodeId)) return;
      const targetDuration = Math.min(30, Math.max(4, vDuration));
      const targetRatio = vRatio;
      const targetResolution = effectiveVRes;
      const targetReferences = vRefItems.map((item) => ({ ...item }));
      setShowPromptOptimizeMenu(false);
      try {
        let imageIndex = 0;
        let videoIndex = 0;
        let audioIndex = 0;
        const rewritten = await rewriteVideoPrompt({
          prompt: current,
          references: targetReferences.map((item) => {
            const index = item.kind === 'image' ? ++imageIndex : item.kind === 'video' ? ++videoIndex : ++audioIndex;
            const prefix = item.kind === 'image' ? '@图片' : item.kind === 'video' ? '@视频' : '@音频';
            return { label: `${prefix}${numToCn(index)} ${item.name ?? ''}`.trim(), kind: item.kind };
          }),
          duration: targetDuration,
          ratio: targetRatio,
        }, template);
        const target = useCanvasStore.getState().nodes.find((item) => item.id === targetNodeId);
        if (!target || target.type !== 'video') throw new Error('目标视频节点已不存在');
        useCanvasStore.getState().updateNode(targetNodeId, {
          description: rewritten,
          videoPromptTemplate: template,
          ...(template === 'universal'
            ? { universalVideoPrompt: rewritten }
            : { legacyVideoPrompt: rewritten }),
          resolution: targetResolution,
          aspectRatio: targetRatio,
          duration: targetDuration,
        });
        if (useCanvasStore.getState().selectedNodeId === targetNodeId) {
          setVideoPromptTemplateOverride(template);
          setVideoPrompt(rewritten);
          requestAnimationFrame(() => {
            if (videoInputRef.current) resizePromptTextarea(videoInputRef.current);
          });
        }
      } catch (error) {
        finishNodeRewrite(targetNodeId, error);
        return;
      }
      finishNodeRewrite(targetNodeId);
    };

    const handleMgEngineChange = (engine: MgGenerationEngine) => {
      const duration = engine === 'omni'
        ? 10
        : engine === 'minimax-h3'
          ? Math.min(15, Math.max(5, vDuration))
          : Math.min(15, Math.max(4, vDuration));
      setMgGenerationEngine(engine);
      setVDuration(duration);
      updateNode(node.id, {
        mgGenerationEngine: engine,
        modelVersion: engine === 'omni' ? OMNI_MG_ENGINE_ID : engine === 'minimax-h3' ? 'minimax-hailuo-h3' : 'seedance-2.0-mini',
        isMgAnimationNode: true,
        duration,
        resolution: engine === 'minimax-h3' ? '2K' : '720p',
      });
    };

    const handleMgPolish = async (): Promise<boolean> => {
      const current = videoPrompt.trim();
      const targetNodeId = node.id;
      if (!current || !beginNodeRewrite(targetNodeId)) return false;
      const nextStyleId = mgStyleId;
      const nextAccentStyleId = mgAccentStyleId;
      const nextRecipe = mgRecipe;
      const targetEngine = mgGenerationEngine;
      const duration = targetEngine === 'omni' ? 10 : vDuration;
      const targetData = node.data as Record<string, unknown>;
      const targetTemplate: VideoPromptTemplate = targetData.videoPromptTemplate === 'legacy'
        || targetData.videoPromptTemplate === 'universal'
        ? targetData.videoPromptTemplate
        : readGlobalVideoPromptTemplate();
      useCanvasStore.getState().updateNode(targetNodeId, {
        mgStyleId: nextStyleId,
        mgAccentStyleId: nextAccentStyleId,
        mgRecipe: nextRecipe,
        modelVersion: targetEngine === 'omni' ? OMNI_MG_ENGINE_ID : targetEngine === 'minimax-h3' ? 'minimax-hailuo-h3' : 'seedance-2.0-mini',
        mgGenerationEngine: targetEngine,
        duration,
        resolution: targetEngine === 'minimax-h3' ? '2K' : '720p',
        isMgAnimationNode: true,
      });
      try {
        const { quickChat } = await import('@/lib/agent/quickChat');
        const style = getMgStylePreset(nextStyleId);
        const accentStyle = nextAccentStyleId ? getMgStylePreset(nextAccentStyleId) : null;
        const rewritten = await quickChat([
          {
            role: 'system',
            content: buildOmniMgPolishSystemPrompt(duration),
          },
          {
            role: 'user',
            content: [
              `主风格：${style.name}`,
              `风格语言：${style.prompt}`,
              `设计指导：${style.guidance}`,
              accentStyle && accentStyle.id !== style.id ? `点缀风格：${accentStyle.name}（最多占 20%）` : '',
              `效果叙事：元素=${nextRecipe.density}；空间=${nextRecipe.spatial}；节奏=${nextRecipe.rhythm}；画面关系=${nextRecipe.relationship}；材质=${nextRecipe.material}`,
              `时长：${duration}s`,
              `原始要求：${current}`,
            ].filter(Boolean).join('\n'),
          },
        ], { maxTokens: 5000, continueOnTruncation: true });
        const next = cleanPromptRewrite(rewritten);
        if (next) {
          const target = useCanvasStore.getState().nodes.find((item) => item.id === targetNodeId);
          if (!target || target.type !== 'video') throw new Error('目标 MG 节点已不存在');
          useCanvasStore.getState().updateNode(targetNodeId, {
            description: next,
            videoPromptTemplate: targetTemplate,
            ...(targetTemplate === 'universal'
              ? { universalVideoPrompt: next }
              : { legacyVideoPrompt: next }),
            mgStyleId: nextStyleId,
            mgAccentStyleId: nextAccentStyleId,
            mgRecipe: nextRecipe,
            modelVersion: targetEngine === 'omni' ? OMNI_MG_ENGINE_ID : targetEngine === 'minimax-h3' ? 'minimax-hailuo-h3' : 'seedance-2.0-mini',
            mgGenerationEngine: targetEngine,
            duration,
            resolution: targetEngine === 'minimax-h3' ? '2K' : '720p',
            isMgAnimationNode: true,
          });
          if (useCanvasStore.getState().selectedNodeId === targetNodeId) {
            setVideoPrompt(next);
            requestAnimationFrame(() => {
              if (videoInputRef.current) resizePromptTextarea(videoInputRef.current);
            });
          }
          finishNodeRewrite(targetNodeId);
          return true;
        }
        finishNodeRewrite(targetNodeId, new Error('模型没有返回可用的 MG 提示词'));
        return false;
      } catch (err) {
        finishNodeRewrite(targetNodeId, err);
        return false;
      }
    };

    const currentMgStyle = getMgStylePreset(mgStyleId);
    const currentMgStylePreview = getMgStylePreview(currentMgStyle);

    return (
      <>
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 w-[720px] max-w-[94vw]">
        <div
          className="rounded-2xl border border-[var(--canvas-node-border)]"
          style={{ background: 'rgba(38,38,38,0.88)', backdropFilter: 'blur(12px) saturate(1.4)', boxShadow: '0 4px 24px rgba(0,0,0,0.08), 0 0 0 1px rgba(255,255,255,0.08)' }}
        >
          {/* 模式 tab 行（参考图：首尾帧 / 文生视频 / 全能参考 / 即梦 / Omni 置顶） */}
          <div className="flex items-center gap-1.5 px-4 pt-3">
            {([['startend', '首尾帧'], ['t2v', '文生视频'], ['multimodal', '全能参考'], ['dreamina', '即梦'], ['omni', 'Omni MG']] as const).map(([m, label]) => (
              <button
                key={m}
                onClick={() => {
                  setVMode(m as typeof vMode);
                  if (m === 'omni') {
                    setMgGenerationEngine('omni');
                    setShowCameraPicker(false);
                    setShowStylePicker(false);
                    setVResolution('720p');
                    setVDuration(10);
                    if (vRatio !== '16:9' && vRatio !== '9:16') setVRatio('16:9');
                    updateNode(node.id, {
                      isMgAnimationNode: true,
                      modelVersion: OMNI_MG_ENGINE_ID,
                      mgGenerationEngine: 'omni',
                      resolution: '720p',
                      duration: 10,
                      mgStyleId,
                      mgAccentStyleId,
                      mgRecipe,
                    });
                  }
                }}
                className="px-3.5 py-2 rounded-xl text-[12px] transition-colors whitespace-nowrap"
                style={{
                  background: vMode === m ? 'rgba(255,255,255,0.1)' : 'transparent',
                  color: vMode === m ? 'var(--canvas-text-1)' : 'var(--canvas-text-3)',
                  fontWeight: vMode === m ? 600 : 400,
                  border: vMode === m ? '1px solid rgba(255,255,255,0.14)' : '1px solid transparent',
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {vMode === 'omni' && (
            <OmniMgSetupPanel
              engine={mgGenerationEngine}
              duration={mgGenerationEngine === 'omni' ? 10 : vDuration}
              styleName={currentMgStyle.name}
              stylePreview={currentMgStylePreview.src}
              recipe={mgRecipe}
              hasPrompt={Boolean(videoPrompt.trim())}
              polishing={isCurrentNodeRewriting}
              onEngineChange={handleMgEngineChange}
              onOpenStyles={() => setShowMgStyleLibrary(true)}
              onOpenNarrative={() => setShowMgNarrative(true)}
              onPolish={() => void handleMgPolish()}
            />
          )}
          <AttachedAssetChips assets={attachedAssets} />
          {/* Reference media row (connected image/audio nodes) */}
          {vRefItems.length > 0 && (
            <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
              <span className="text-[10px] text-[var(--canvas-text-2)] font-medium shrink-0">参考素材</span>
              <div className="canvas-asset-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-2">
                {(() => {
                  let imgIdx = 0;
                  let audIdx = 0;
                  let vidIdx = 0;
                  return vRefItems.map((item, i) => {
                    const curImgIdx = item.kind === 'image' ? ++imgIdx : 0;
                    const curAudIdx = item.kind === 'audio' ? ++audIdx : 0;
                    const curVidIdx = item.kind === 'video' ? ++vidIdx : 0;
                    const insertMention = (mentionText: string) => {
                      const ta = videoInputRef.current;
                      if (!ta) { setVideoPrompt((p) => p + mentionText); return; }
                      const pos = ta.selectionStart ?? videoPrompt.length;
                      const next = videoPrompt.slice(0, pos) + mentionText + videoPrompt.slice(pos);
                      setVideoPrompt(next);
                      requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(pos + mentionText.length, pos + mentionText.length); });
                    };
                    return (
                      <div key={i} className="relative group/ref shrink-0">
                        {item.kind === 'image' ? (
                          <div
                            className="w-10 h-10 rounded-lg overflow-hidden border border-[var(--canvas-node-border)] bg-[rgba(255,255,255,0.05)] cursor-pointer hover:ring-1 hover:ring-[#3b9eff] transition-all"
                            onClick={() => insertMention(`@图片${numToCn(curImgIdx)}`)}
                            title={`@图片${numToCn(curImgIdx)} · ${item.name || '参考图片'}（点击插入提示词）`}
                          >
                            <img src={item.url} alt="" className="w-full h-full object-cover" />
                            <span className="absolute bottom-0 left-0 right-0 text-center text-[8px] text-white/90 bg-black/50 leading-tight">图{curImgIdx}</span>
                          </div>
                        ) : item.kind === 'video' ? (
                          <div
                            className="w-10 h-10 rounded-lg border border-[var(--canvas-node-border)] bg-[rgba(255,255,255,0.05)] flex flex-col items-center justify-center cursor-pointer hover:ring-1 hover:ring-[#3b9eff] transition-all"
                            onClick={() => insertMention(`@视频${numToCn(curVidIdx)}`)}
                            title={`@视频${numToCn(curVidIdx)} · ${item.name || '参考视频'}（点击插入提示词）`}
                          >
                            <Film size={12} className="text-[var(--canvas-text-2)]" />
                            <span className="text-[7px] text-[var(--canvas-text-3)] leading-tight">视{curVidIdx}</span>
                          </div>
                        ) : (
                          <div
                            className="w-10 h-10 rounded-lg border border-[var(--canvas-node-border)] bg-[rgba(255,255,255,0.05)] flex flex-col items-center justify-center cursor-pointer hover:ring-1 hover:ring-[#3b9eff] transition-all"
                            onClick={() => insertMention(`@音频${numToCn(curAudIdx)}`)}
                            title={`点击插入 @音频${numToCn(curAudIdx)}`}
                          >
                            <AudioLines size={12} className="text-[var(--canvas-text-2)]" />
                            <span className="text-[7px] text-[var(--canvas-text-3)] leading-tight">音{curAudIdx}</span>
                          </div>
                        )}
                        {item.edgeId && (
                          <button
                            onClick={() => useCanvasStore.getState().deleteEdge(item.edgeId!)}
                            className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[rgba(255,255,255,0.25)] hover:bg-red-500 text-white flex items-center justify-center opacity-0 group-hover/ref:opacity-100 transition-all"
                            title="断开此参考"
                          >
                            <X size={8} />
                          </button>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          )}

          {/* 万相 3.0 专属：参考文档 / 网页链接输入 */}
          {vModel === 'wan-3.0' && vMode !== 'omni' && (
            <div className="flex items-center gap-2 px-3 pt-2 pb-1">
              <span className="text-[10px] text-[var(--canvas-text-2)] font-medium shrink-0 flex items-center gap-1">
                <Link2 size={11} />
                参考链接
              </span>
              <input
                value={wanRefLink}
                onChange={(e) => setWanRefLink(e.target.value)}
                onBlur={() => updateNode(node.id, { wanRefLink: wanRefLink.trim() })}
                placeholder="可选：粘贴文档（pdf/docx/md…）或公开网页 URL，万相 3.0 会参考它生成"
                className="min-w-0 flex-1 h-7 rounded-md border border-[var(--canvas-node-border)] bg-[var(--canvas-panel)] px-2 text-[11px] text-[var(--canvas-text-1)] outline-none placeholder:text-[var(--canvas-text-3)] focus:border-[var(--canvas-node-border-selected)]"
              />
              {wanRefLink.trim() && (
                <span className="shrink-0 text-[9px] text-[var(--canvas-text-3)]">
                  {classifyWan3LinkUrl(wanRefLink) === 'document' ? '按文档传入' : '按网页传入'}
                </span>
              )}
            </div>
          )}

          {/* Textarea */}
          <div className="px-4 pt-3 pb-3 relative">
            <textarea
              ref={videoInputRef}
              value={videoPrompt}
              onChange={(e) => {
                setVideoPrompt(e.target.value);
                resizePromptTextarea(e.target);
                if (!composingRef.current) {
                  mention.handleInputChange(e.target.value, e.target.selectionStart || 0);
                  vidSlash.handleInputChange(e.target.value, e.target.selectionStart || 0);
                }
              }}
              onPaste={(e) => requestAnimationFrame(() => resizePromptTextarea(e.currentTarget))}
              onKeyDown={(e) => {
                if (composingRef.current) return;
                if (vidSlash.show && vidSlash.templates.length > 0) {
                  if (vidSlash.handleKeyDown(e)) {
                    if (e.key === 'Enter') {
                      setVideoPrompt(vidSlash.select(vidSlash.templates[vidSlash.idx], videoPrompt));
                    }
                    return;
                  }
                }
                if (mention.showMention && mention.mentionItems.length > 0) {
                  if (mention.handleKeyDown(e)) {
                    if (e.key === 'Enter') {
                      const newText = mention.handleSelect(mention.mentionItems[mention.mentionIdx], videoPrompt);
                      setVideoPrompt(newText);
                    }
                    return;
                  }
                }
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleVideoGenerate(); }
              }}
              onFocus={() => { isEditingRef.current = true; setVidFocused(true); }}
              onBlur={() => {
                isEditingRef.current = false;
                setVidFocused(false);
                const prompt = videoPrompt.trim();
                updateNode(node.id, { description: prompt, ...promptSlotPatch(prompt) });
              }}
              onCompositionStart={() => { composingRef.current = true; }}
              onCompositionEnd={(e) => { composingRef.current = false; setVideoPrompt((e.target as HTMLTextAreaElement).value); }}
              rows={2}
              placeholder={vMode === 'omni'
                ? '先描述这支 MG 动画要表达什么，再选择风格和效果叙事…'
                : '描述你想要生成的视频内容，@ 引用画布中的素材…'}
              className={`w-full min-h-[68px] bg-transparent text-[14px] leading-relaxed focus:outline-none placeholder:text-[var(--canvas-text-3)] resize-none max-h-[180px] text-[var(--canvas-text-1)] ${vidFocused ? '' : 'caret-transparent'}`}
              style={vidFocused ? undefined : { color: 'transparent' }}
            />
            {!vidFocused && (
              <div
                className="absolute inset-0 pointer-events-none overflow-hidden"
                aria-hidden
              >
                <div className="px-4 pt-3 pb-3">
                  <div className="text-[14px] leading-relaxed whitespace-pre-wrap break-words text-[var(--canvas-text-1)] min-h-[68px] max-h-[180px] overflow-hidden">
                    {videoPrompt ? <MentionHighlight text={videoPrompt} /> : (
                      <span className="text-[var(--canvas-text-3)]">
                        {vMode === 'omni'
                          ? '先描述这支 MG 动画要表达什么，再选择风格和效果叙事…'
                          : '描述你想要生成的视频内容，@ 引用画布中的素材…'}
                      </span>
                    )}
                  </div>
                </div>
                {videoPrompt.length > 240 && (
                  <button
                    type="button"
                    onClick={() => setShowVideoModal(true)}
                    className="pointer-events-auto absolute bottom-2 right-2 rounded-lg border border-[var(--canvas-node-border)] bg-[var(--canvas-panel)]/95 px-2 py-1 text-[9px] font-medium text-[var(--canvas-text-2)] shadow-md hover:text-[var(--canvas-text-1)]"
                    title="查看完整视频提示词"
                  >
                    {videoPrompt.length} 字 · 查看全文
                  </button>
                )}
              </div>
            )}
            {mention.showMention && (
              <MentionDropdown items={mention.mentionItems} activeIdx={mention.mentionIdx} onSelect={(item) => { setVideoPrompt(mention.handleSelect(item, videoPrompt)); }} onHover={(_i) => {}} />
            )}
            {vidSlash.show && (
              <SlashDropdown slash={vidSlash} onPick={(t) => setVideoPrompt(vidSlash.select(t, videoPrompt))} />
            )}
            <CameraPresetPicker
              open={showCameraPicker && node.type === 'video'}
              kind="video"
              onClose={() => setShowCameraPicker(false)}
              onAppend={(body) => setVideoPrompt((p) => p ? `${p}，${body}` : body)}
            />
            <StyleLibraryPicker
              open={showStylePicker && node.type === 'video'}
              onClose={() => setShowStylePicker(false)}
              onApply={async (style) => {
                setActiveStyle(style);
                const targetNodeId = node.id;
                const currentPrompt = videoPrompt.trim();
                if (currentPrompt && beginNodeRewrite(targetNodeId)) {
                  try {
                    const rewritten = cleanPromptRewrite(await rewritePromptWithStyle(currentPrompt, style));
                    if (!rewritten) throw new Error('模型没有返回可用的视频提示词');
                    const target = useCanvasStore.getState().nodes.find((item) => item.id === targetNodeId);
                    if (!target || target.type !== 'video') throw new Error('目标视频节点已不存在');
                    const targetData = target.data as Record<string, unknown>;
                    const template: VideoPromptTemplate = targetData.videoPromptTemplate === 'legacy'
                      || targetData.videoPromptTemplate === 'universal'
                      ? targetData.videoPromptTemplate
                      : readGlobalVideoPromptTemplate();
                    useCanvasStore.getState().updateNode(targetNodeId, {
                      description: rewritten,
                      videoPromptTemplate: template,
                      ...(template === 'universal'
                        ? { universalVideoPrompt: rewritten }
                        : { legacyVideoPrompt: rewritten }),
                    });
                    if (useCanvasStore.getState().selectedNodeId === targetNodeId) {
                      setVideoPrompt(rewritten);
                      requestAnimationFrame(() => { if (videoInputRef.current) resizePromptTextarea(videoInputRef.current); });
                    }
                  } catch (err) {
                    finishNodeRewrite(targetNodeId, err);
                    return;
                  }
                  finishNodeRewrite(targetNodeId);
                }
              }}
              onClear={() => setActiveStyle(null)}
            />
          </div>

          <PromptRewriteError message={currentRewriteError} onDismiss={() => dismissRewriteError(node.id)} />

          {/* Divider */}
          <div className="h-px bg-[rgba(255,255,255,0.06)] mx-3" />

          {/* Bottom toolbar — 不能用 overflow-x-auto：会把向上弹出的参数面板裁掉 */}
          <div className="flex items-center gap-1.5 px-3 py-2.5">
            {/* API = canvasGen → rhtv Seedance 直连；Agent = 画布气泡派发 */}
            {vMode !== 'omni' && (
              <button
                onClick={() => setGenMode(genMode === 'api' ? 'agent' : 'api')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-medium transition-colors shrink-0 border ${
                  genMode === 'api'
                    ? 'bg-[rgba(255,255,255,0.1)] border-[var(--canvas-node-border-selected)] text-[var(--canvas-text-1)]'
                    : 'bg-[rgba(255,255,255,0.04)] border-[var(--canvas-node-border)] text-[var(--canvas-text-2)]'
                }`}
                title={genMode === 'api' ? 'API 直连（RunningHub）' : 'Agent 模式'}
              >
                {genMode === 'api' ? 'API' : 'Agent'}
              </button>
            )}
            {vMode !== 'startend' && vMode !== 'dreamina' && vMode !== 'omni' && (
              <SelectPill
                value={vModel}
                onChange={(val) => {
                  setVModel(val);
                  // Fast/Mini 模型不支持原生 1080p，切换时同步钳制
                  if ((val.includes('fast') || val.includes('mini')) && vResolution === 'native1080p') setVResolution('720p');
                  if (val === 'seedance-2.5') {
                    setVResolution('720p');
                    setVDuration(Math.min(30, Math.max(4, vDuration)));
                  }
                  if (val === 'wan-3.0') {
                    setVResolution('720P');
                    setVDuration(Math.min(30, Math.max(2, vDuration)));
                  }
                  updateNode(node.id, {
                    modelVersion: val === 'minimax-h3'
                      ? 'minimax-hailuo-h3'
                      : val === 'seedance-2.5' ? DREAMINA_SEEDANCE_25_ENGINE_ID : val,
                    ...(val === 'seedance-2.5' ? { resolution: '720p', duration: Math.min(30, Math.max(4, vDuration)) } : {}),
                  });
                }}
                options={[
                  { value: 'seedance-2.0', label: 'Seedance 2.0' },
                  { value: 'seedance-2.5', label: 'Seedance 2.5' },
                  { value: 'seedance-2.0-fast', label: 'Seedance 2.0 Fast' },
                  { value: 'seedance-2.0-mini', label: 'Seedance 2.0 Mini' },
                  { value: 'minimax-h3', label: 'MiniMax H3' },
                  { value: 'wan-3.0', label: '万相 3.0' },
                  ...(customMediaApis ?? [])
                    .filter((api) => api.kind === 'video' && api.enabled)
                    .map((api) => ({ value: `custom-media:${api.id}`, label: api.label })),
                ]}
                title="模型"
              />
            )}
            <ParamSummaryPill
              title="生成参数"
              summary={vMode === 'omni'
                ? `${mgGenerationEngine === 'minimax-h3' ? '2K' : '720p'} / ${mgGenerationEngine === 'omni' ? 10 : vDuration}s / ${vRatio === '9:16' ? '9:16' : '16:9'}`
                : `${vResOptions.find((o) => o.value === effectiveVRes)?.label ?? effectiveVRes} / ${vDuration}s / ${isSeedance25 ? '多模态' : vGenAudio ? '音频' : '静音'} / ${vRatio === 'adaptive' ? '自适应' : vRatio}`}
              width={320}
            >
              {vMode !== 'omni' && (
                <PopRow label="分辨率" hint="2k/4k 为超分档，价格较高">
                  <PopSeg value={effectiveVRes} onChange={setVResolution} options={vResOptions} />
                </PopRow>
              )}
              <PopRow label="时长">
                {vMode !== 'omni' && isSeedance25 ? (
                  <PopSlider
                    value={Math.min(30, Math.max(4, vDuration))}
                    min={4}
                    max={30}
                    step={1}
                    unit="s"
                    onChange={setVDuration}
                  />
                ) : (
                  <PopSeg
                    value={String(vMode === 'omni' && mgGenerationEngine === 'omni' ? 10 : h3DurationMode ? Math.min(15, Math.max(5, vDuration)) : vDuration)}
                    onChange={(v) => setVDuration(Number(v))}
                    options={(vMode === 'omni' && mgGenerationEngine === 'omni'
                      ? [10]
                      : h3DurationMode
                        ? [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
                        : [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
                    ).map((d) => ({ value: String(d), label: `${d}s` }))}
                  />
                )}
              </PopRow>
              <PopRow label="画幅">
                <PopSeg
                  value={vMode === 'omni' && vRatio !== '9:16' ? '16:9' : vRatio}
                  onChange={setVRatio}
                  options={vMode === 'omni'
                    ? [{ value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }]
                    : [{ value: 'adaptive', label: '自适应' }, { value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }, { value: '1:1', label: '1:1' }, { value: '4:3', label: '4:3' }, { value: '3:4', label: '3:4' }, { value: '21:9', label: '21:9' }]}
                />
              </PopRow>
              {vMode !== 'omni' && !isSeedance25 && (
                <>
                  <PopDivider />
                  <PopRow label="生成音频" hint="同期声与音效">
                    <PopToggle checked={vGenAudio} onChange={setVGenAudio} />
                  </PopRow>
                  <PopRow label="随机种子" hint="留空=随机">
                    <PopInput value={vSeed} onChange={(v) => setVSeed(v.replace(/[^0-9]/g, ''))} placeholder="随机" />
                  </PopRow>
                </>
              )}
            </ParamSummaryPill>
            {vMode !== 'omni' && (
              <>
                <button
                  onClick={() => setShowCameraPicker((v) => !v)}
                  className={`p-2 rounded-xl transition-colors shrink-0 ${showCameraPicker ? 'bg-[var(--canvas-controls-active)] text-[var(--canvas-text-1)]' : 'text-[var(--canvas-text-2)] hover:bg-[var(--canvas-controls-hover)] hover:text-[var(--canvas-text-1)]'}`}
                  title="镜头语言预设（相机组合/运镜）"
                >
                  <Aperture size={16} />
                </button>
                <button
                  onClick={() => { setShowStylePicker((v) => !v); setShowCameraPicker(false); }}
                  className={`p-2 rounded-xl transition-colors shrink-0 ${showStylePicker ? 'bg-[var(--canvas-controls-active)] text-[var(--canvas-text-1)]' : 'text-[var(--canvas-text-2)] hover:bg-[var(--canvas-controls-hover)] hover:text-[var(--canvas-text-1)]'}`}
                  title="风格库"
                >
                  <Palette size={16} />
                </button>
              </>
            )}
            {vMode !== 'omni' && activeStyle && (
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[rgba(31,162,220,0.1)] text-[10px] text-[var(--canvas-accent)] shrink-0">
                <Palette size={10} />
                <span className="max-w-[60px] truncate">{activeStyle.name}</span>
                <button onClick={() => setActiveStyle(null)} className="hover:text-white"><X size={8} /></button>
              </div>
            )}
            {isCurrentNodeRewriting && (
              <span className="text-[10px] text-[var(--canvas-text-3)] animate-pulse shrink-0">改写中...</span>
            )}
            {vMode !== 'omni' && (
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setShowPromptOptimizeMenu((open) => !open)}
                  disabled={!videoPrompt.trim() || isCurrentNodeRewriting}
                  className={`flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
                    showPromptOptimizeMenu
                      ? 'bg-[var(--canvas-controls-active)] text-[var(--canvas-text-1)]'
                      : 'text-[var(--canvas-text-2)] hover:bg-[var(--canvas-controls-hover)] hover:text-[var(--canvas-text-1)]'
                  }`}
                  title="选择经典版或新版规范优化当前提示词"
                >
                  <Sparkles size={14} className={isCurrentNodeRewriting ? 'animate-pulse' : ''} />
                  <span>{isCurrentNodeRewriting ? '优化中' : '优化'}</span>
                  <ChevronDown size={12} />
                </button>
                {showPromptOptimizeMenu && (
                  <div className="absolute bottom-full left-0 z-[80] mb-2 w-44 overflow-hidden rounded-xl border border-[var(--canvas-node-border)] bg-[var(--canvas-panel)] p-1.5 shadow-2xl">
                    {([
                      ['legacy', '经典版优化', '沿用原来的多镜头写法'],
                      ['universal', '新版优化', '强化站位、时间轴与连续性'],
                    ] as const).map(([value, label, description]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => void handlePromptRewrite(value)}
                        className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--canvas-controls-hover)]"
                      >
                        <Sparkles size={13} className="mt-0.5 shrink-0 text-[var(--canvas-text-2)]" />
                        <span className="min-w-0">
                          <span className="block text-[11px] font-medium text-[var(--canvas-text-1)]">{label}</span>
                          <span className="mt-0.5 block text-[9px] leading-4 text-[var(--canvas-text-3)]">{description}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex-1" />

            <button onClick={() => setShowVideoModal(true)} className="p-2 rounded-xl hover:bg-[var(--canvas-controls-hover)] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] transition-colors shrink-0" title="展开编辑">
              <Maximize2 size={16} />
            </button>

            <GenerateButton
              onClick={handleVideoGenerate}
              disabled={!videoPrompt.trim() || isCurrentNodeRewriting}
              price={genMode === 'api' && vMode !== 'dreamina' && vMode !== 'omni' ? estPrice : null}
              label={isCurrentNodeRewriting
                ? '正在完善提示词…'
                : vMode === 'dreamina'
                ? 'Agent 生成'
                : vMode === 'omni'
                  ? mgGenerationEngine === 'omni' ? 'Omni生成' : mgGenerationEngine === 'minimax-h3' ? 'H3生成' : 'Mini生成'
                  : '生成'}
            />
          </div>
        </div>
      </div>
      <AnimatePresence>
        {showVideoModal && (
          <PromptModal
            value={videoPrompt}
            title="视频描述"
            placeholder="输入视频描述..."
            onSave={(v) => {
              const prompt = v.trim();
              setVideoPrompt(prompt);
              if (prompt) updateNode(node.id, { description: prompt, ...promptSlotPatch(prompt) });
            }}
            onClose={() => setShowVideoModal(false)}
          />
        )}
      </AnimatePresence>
      <OmniStyleLibrary
        open={showMgStyleLibrary}
        selectedId={mgStyleId}
        accentId={mgAccentStyleId}
        context={vRefItems.some((item) => item.kind === 'video') ? 'video' : 'text'}
        onApply={(selection) => {
          setMgStyleId(selection.styleId);
          setMgAccentStyleId(selection.accentStyleId);
          updateNode(node.id, {
            mgStyleId: selection.styleId,
            mgAccentStyleId: selection.accentStyleId,
            modelVersion: mgGenerationEngine === 'omni' ? OMNI_MG_ENGINE_ID : mgGenerationEngine === 'minimax-h3' ? 'minimax-hailuo-h3' : 'seedance-2.0-mini',
            mgGenerationEngine,
            isMgAnimationNode: true,
          });
          setShowMgStyleLibrary(false);
        }}
        onClose={() => setShowMgStyleLibrary(false)}
      />
      <OmniNarrativePanel
        open={showMgNarrative}
        duration={mgGenerationEngine === 'omni' ? 10 : vDuration}
        recipe={mgRecipe}
        onApply={(nextRecipe) => {
          setMgRecipe(nextRecipe);
          updateNode(node.id, {
            mgRecipe: nextRecipe,
            modelVersion: mgGenerationEngine === 'omni' ? OMNI_MG_ENGINE_ID : mgGenerationEngine === 'minimax-h3' ? 'minimax-hailuo-h3' : 'seedance-2.0-mini',
            mgGenerationEngine,
            isMgAnimationNode: true,
          });
        }}
        onClose={() => setShowMgNarrative(false)}
      />
      </>
    );
  }

  return null;
}
