/**
 * StepPrompts — ④分镜表 + 提示词：全字段表格，行展开编辑提示词，
 * 行内「AI 优化此条」走抽屉助手。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronRight, ChevronUp, Clapperboard, Crosshair, Grid2X2, ImagePlus, Loader2, Maximize2, MonitorPlay, MoreHorizontal, Palette, Pause, Play, Plus, RefreshCw, RotateCcw, Sparkles, Trash2, Upload, Wand2, X } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { copyFile, createDir, BaseDirectory } from '@tauri-apps/api/fs';
import { homeDir } from '@tauri-apps/api/path';
import { useShallow } from 'zustand/react/shallow';
import { useWorkshopStore } from '@/stores/workshopStore';
import { getSceneReferencePaths } from '@/stores/workshopStore';
import { loadImageBitmap } from '@/lib/canvas/imageSource';
import {
  applyVideoPlanningReferencePrefixes,
  buildImageRefBindings,
  buildStoryboardFrameRefBindings,
  buildVideoRefBindings,
  buildVideoRefPaths,
  compactStoryboardFrameReferences,
  ensureDirectorConstraintMention,
  remapShotPromptRefs as sharedRemapShotPromptRefs,
  stripDirectorConstraintMention,
} from '@/lib/workshop/shotRefs';
import { useCanvasStore } from '@/stores/canvasStore';
import { nanoid } from 'nanoid';
import { buildShotPromptsPrompt, buildOptimizeShotPrompt, buildAudioPromptsPrompt, buildBatchAudioPromptsPrompt } from '@/lib/workshop/workshopPrompts';
import { dispatchWorkshopPrompt } from '../WorkshopChatPanel';
import { buildStyleSection } from '../StyleSelector';
import { syncShotPromptsToCanvas, pullFromCanvas } from '@/lib/workshop/canvasSync';
import type { WorkshopRef } from '@/lib/workshop/canvasSync';
import SmartTextarea from '../SmartTextarea';
import { useChatStore } from '@/stores';
import RunStepTimeline from '@/components/chat/RunStepTimeline';
import { confirm, message as tauriMessage, open as openDialog } from '@tauri-apps/api/dialog';
import { runGeneration } from '@/lib/canvasGen';
import { saveCanvasImage } from '@/lib/canvas/assetPersist';
import type { AssetCandidate, DirectorConstraintCard, StoryboardBoard, StoryboardFrame, WsCharacter, WsColorPalette, WsProp, WsScene, WsShot } from '@/lib/workshop/types';
import { defaultNodeStyle } from '@/lib/canvas/layout';
import ImageFullscreenViewer from '@/components/canvas/ImageFullscreenViewer';
import ArtifactPickerPanel from '@/components/canvas/ArtifactPickerPanel';
import ImageGenerationSettings, { type ImageEngineOption } from '../ImageGenerationSettings';
import { openWorkshopDirector } from '@/lib/director/launch';
import { hasDirectorProject } from '@/stores/directorStore';
import { Z, useEscapeClose } from '@/lib/ui/layers';
import { sendStoryboardFrameToCanvas } from '@/lib/workshop/storyboardBridge';
import VideoPromptVersionSwitch from '../VideoPromptVersionSwitch';
import type { VideoPromptTemplate } from '@/lib/videoPrompt/prompt';

const cellInput = 'bg-transparent text-[11px] text-[var(--canvas-text-1)] w-full rounded placeholder:text-[var(--canvas-text-3)] focus:outline-none hover:bg-[rgba(255,255,255,0.04)] focus-visible:ring-1 focus-visible:ring-[var(--canvas-accent)]';

const NUM_TO_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
function numToCn(n: number): string { return n <= 10 ? NUM_TO_CN[n - 1] : String(n); }

type ColKey = 'shotNo' | 'desc' | 'dialogue' | 'shotType' | 'camera' | 'mood' | 'duration' | 'ratio';
type DirectorAvailability = { storyboard: boolean; videoPrompt: boolean };
const DEFAULT_COL_WIDTHS: Record<ColKey, number> = {
  shotNo: 92, desc: 0, dialogue: 144, shotType: 64, camera: 96, mood: 64, duration: 56, ratio: 64,
};

const COL_WIDTHS_STORAGE_KEY = 'kunpeng.workshop.prompts.colWidths';

function resolvePromptTemplate(shot: WsShot, globalTemplate?: VideoPromptTemplate): VideoPromptTemplate {
  return shot.videoPromptTemplate || globalTemplate || 'legacy';
}

function editableVideoPrompt(shot: WsShot, globalTemplate?: VideoPromptTemplate): string {
  return resolvePromptTemplate(shot, globalTemplate) === 'universal'
    ? shot.universalVideoPrompt || shot.seedance25VideoPrompt || shot.videoPrompt || ''
    : shot.videoPrompt || '';
}

// 列宽持久化：读取 localStorage，损坏/缺字段时回落默认列宽。
function loadColWidths(): Record<ColKey, number> {
  const next = { ...DEFAULT_COL_WIDTHS };
  try {
    const raw = localStorage.getItem(COL_WIDTHS_STORAGE_KEY);
    if (!raw) return next;
    const parsed = JSON.parse(raw) as Partial<Record<ColKey, number>>;
    for (const key of Object.keys(DEFAULT_COL_WIDTHS) as ColKey[]) {
      const value = parsed[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) next[key] = value;
    }
  } catch { /* 本地缓存损坏时用默认列宽 */ }
  return next;
}

const VIDEO_RATIOS = ['16:9', '9:16', '4:3', '3:4', '1:1', '21:9'];

/** 有限并发 map：限制同时在飞的异步任务数（导演预演探测的 IPC 洪峰用） */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}
const STORYBOARD_ENGINES: readonly ImageEngineOption[] = [
  { value: 'gpt-image-2', label: 'GPT', title: 'GPT-Image-2 智能通道生成故事板' },
  { value: 'seedream-v5-pro', label: '豆包', title: '豆包 Seedream 5.0 Pro 生成故事板' },
];

function ratioToBoardSize(ratio?: string): { width: number; height: number } {
  switch (ratio) {
    case '9:16': return { width: 1080, height: 1920 };
    case '3:4': return { width: 1200, height: 1600 };
    case '4:3': return { width: 1600, height: 1200 };
    case '1:1': return { width: 1600, height: 1600 };
    case '21:9': return { width: 2100, height: 900 };
    case '16:9':
    default: return { width: 1920, height: 1080 };
  }
}

// 拼合用图片加载：统一走 loadImageBitmap（readBinaryFile/Tauri http 读原始
// 字节）。曾经的 <img src=asset://> / convertFileSrc 兜底会 taint canvas，
// toDataURL 抛 "The operation is insecure"（与画布裁剪同款坑，见 imageSource.ts）。
function drawCover(ctx: CanvasRenderingContext2D, img: ImageBitmap, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / img.width, h / img.height);
  const sw = w / scale;
  const sh = h / scale;
  const sx = Math.max(0, (img.width - sw) / 2);
  const sy = Math.max(0, (img.height - sh) / 2);
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

async function composeStoryboardBoard(paths: string[], ratio?: string): Promise<string> {
  if (paths.length !== 4) throw new Error('请选择 4 张图再拼成 2x2 分镜板');
  const { width, height } = ratioToBoardSize(ratio);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持 canvas 合成');
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, width, height);
  const gap = Math.max(8, Math.round(width * 0.005));
  const cellW = (width - gap) / 2;
  const cellH = (height - gap) / 2;
  const imgs = await Promise.all(paths.map((p2) => loadImageBitmap(p2)));
  imgs.forEach((img, i) => {
    const x = (i % 2) * (cellW + gap);
    const y = Math.floor(i / 2) * (cellH + gap);
    drawCover(ctx, img, x, y, cellW, cellH);
    img.close();
  });
  return saveCanvasImage(canvas.toDataURL('image/png'), 'workshop-storyboard');
}

function storyboardFrameCandidates(frame: StoryboardFrame): AssetCandidate[] {
  const candidates = frame.candidates?.length
    ? frame.candidates
    : frame.imagePath
      ? [{ path: frame.imagePath, source: 'generate' as const, prompt: frame.prompt, createdAt: Date.now() }]
      : [];
  if (frame.imagePath && !candidates.some((c) => c.path === frame.imagePath)) {
    return [...candidates, { path: frame.imagePath, source: 'generate' as const, prompt: frame.prompt, createdAt: Date.now() }];
  }
  return candidates;
}

function appendStoryboardCandidate(frame: StoryboardFrame, path: string, prompt: string, engineId: string): AssetCandidate[] {
  const candidates = storyboardFrameCandidates(frame);
  if (candidates.some((c) => c.path === path)) return candidates;
  return [...candidates, { path, source: 'generate', engineId, prompt, createdAt: Date.now() }];
}

type PaletteOption = {
  id: string;
  name: string;
  description?: string;
  assetImagePath?: string;
  colors?: { hex: string; label: string }[];
};

// 共享空数组：data.props/colorPalettes 缺省兜底用同一引用，避免每次渲染换引用击穿 ShotRows 的 memo
const EMPTY_ASSET_REFS: { id: string; name: string; assetImagePath?: string }[] = [];
const EMPTY_PALETTE_REFS: PaletteOption[] = [];

type StoryboardRefItem = {
  label: string;
  name: string;
  path: string;
  kind: 'scene' | 'character' | 'prop' | 'extra' | 'palette';
  removable?: boolean;
  removeKind?: PromptRefItem['removeKind'];
  id?: string;
};

type PromptRefItem = {
  label: string;
  url: string;
  type?: 'audio' | 'video';
  path?: string;
  removable?: boolean;
  removeKind?: 'scene' | 'character' | 'prop' | 'palette' | 'extra' | 'storyboardBoard' | 'directorConstraintCard' | 'voice' | 'generatedAudio';
  id?: string;
};

type WorkshopAssetPickItem = {
  id: string;
  assetId: string;
  name: string;
  kind: 'character' | 'scene' | 'prop' | 'palette';
  path: string;
};

type ReferencePlacementKind = 'scene' | 'character' | 'prop' | 'palette' | 'extra';

function createTemporaryAssetFromReference(kind: 'scene' | 'character' | 'prop' | 'palette', shotNo: string, path: string): string {
  const store = useWorkshopStore.getState();
  const safeShotNo = shotNo.replace(/[^\w-]+/g, '_');
  const id = `tmp_${kind}_${safeShotNo}_${nanoid(6)}`;
  const candidate: AssetCandidate = { path, source: 'upload', createdAt: Date.now() };
  if (kind === 'scene') {
    const scene: WsScene = {
      id,
      name: `临时场景 ${shotNo}`,
      description: '用户临时添加的场景参考图，仅用于当前分镜引用。',
      assetImagePath: path,
      candidates: [candidate],
    };
    store.upsertScenes([scene]);
  } else if (kind === 'character') {
    const character: WsCharacter = {
      id,
      name: `临时角色 ${shotNo}`,
      personality: '用户临时添加的角色参考图，仅用于当前分镜引用。',
      appearance: '以临时参考图为准，保持人物身份、五官、发型、服饰和体态一致。',
      assetImagePath: path,
      candidates: [candidate],
    };
    store.upsertCharacters([character]);
  } else if (kind === 'prop') {
    const prop: WsProp = {
      id,
      name: `临时道具 ${shotNo}`,
      description: '用户临时添加的道具参考图，仅用于当前分镜引用。',
      assetImagePath: path,
      candidates: [candidate],
    };
    store.upsertProps([prop]);
  } else {
    const palette: WsColorPalette = {
      id,
      name: `临时色卡 ${shotNo}`,
      description: '用户临时添加的色卡参考图，仅用于当前分镜引用。',
      assetImagePath: path,
      assetPrompt: '临时色卡参考图',
      usagePrompt: '画面配色严格参考该临时色卡，保持整体色彩统一。',
      candidates: [candidate],
      source: 'upload',
      createdAt: Date.now(),
    };
    store.upsertColorPalette(palette);
  }
  return id;
}

function ReferencePlacementDialog({ open, path, title, onClose, onPick }: {
  open: boolean;
  path?: string;
  title?: string;
  onClose: () => void;
  onPick: (kind: ReferencePlacementKind) => void;
}) {
  useEscapeClose(open && Boolean(path), onClose);
  if (!open || !path) return null;
  const options: Array<{ kind: ReferencePlacementKind; label: string; desc: string }> = [
    { kind: 'scene', label: '场景图', desc: '创建一个新的临时场景资产并设为本镜场景，不覆盖已有场景' },
    { kind: 'character', label: '角色', desc: '创建一个新的临时角色资产并加入本镜，不覆盖已有角色' },
    { kind: 'prop', label: '道具', desc: '创建一个新的临时道具资产并加入本镜，不覆盖已有道具' },
    { kind: 'palette', label: '色卡', desc: '创建一个新的临时色卡资产并设为本镜色卡，不覆盖全片色卡' },
    { kind: 'extra', label: '额外参考', desc: '作为补充风格/构图/局部参考，排在角色和道具之后' },
  ];
  return createPortal(
    <div className="canvas-dark fixed inset-0 flex items-center justify-center text-[var(--canvas-text-1)]" style={{ background: 'rgba(0,0,0,0.6)', zIndex: Z.modalStack }} onMouseDown={onClose}>
      <div className="w-[520px] max-w-[92vw] overflow-hidden rounded-2xl border border-[var(--canvas-node-border)] bg-[var(--canvas-panel)] shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--canvas-node-border)] px-4 py-3">
          <div>
            <div className="text-[13px] font-medium">{title ?? '选择参考图类型'}</div>
            <div className="text-[10px] text-[var(--canvas-text-3)]">不同类型会影响 @图片N 顺序和后续故事板/视频/画布传入</div>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-[var(--canvas-text-2)] hover:bg-[var(--canvas-controls-hover)] hover:text-[var(--canvas-text-1)]">
            <X size={14} />
          </button>
        </div>
        <div className="grid grid-cols-[160px_1fr] gap-3 p-4">
          <div className="overflow-hidden rounded-xl border border-[var(--canvas-node-border)] bg-black/30">
            <img src={convertFileSrc(path)} alt="" loading="lazy" decoding="async" className="h-[110px] w-full object-cover" />
          </div>
          <div className="space-y-2">
            {options.map((option) => (
              <button
                key={option.kind}
                type="button"
                onClick={() => onPick(option.kind)}
                className="w-full rounded-xl border border-[var(--canvas-node-border)] bg-black/15 px-3 py-2 text-left transition-colors hover:border-[var(--canvas-node-border-selected)] hover:bg-white/5"
              >
                <div className="text-[12px] font-medium text-[var(--canvas-text-1)]">{option.label}</div>
                <div className="mt-0.5 text-[10px] text-[var(--canvas-text-3)]">{option.desc}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

async function copyShotReferenceIntoProject(shotNo: string, sourcePath: string, source: 'upload' | 'artifact' | 'asset'): Promise<string | null> {
  const project = useWorkshopStore.getState().project;
  if (!project) return null;
  const ext = sourcePath.split('.').pop()?.toLowerCase() || 'png';
  const safeShotNo = shotNo.replace(/[^\w-]+/g, '_');
  const relDir = `.kunpeng/aigc-memory/projects/${project.id}/assets`;
  await createDir(relDir, { dir: BaseDirectory.Home, recursive: true }).catch(() => {});
  const rel = `${relDir}/shot-ref-${safeShotNo}-${source}-${Date.now()}.${ext}`;
  await copyFile(sourcePath, rel, { dir: BaseDirectory.Home });
  const home = await homeDir();
  return `${home}${rel}`;
}

function uniqueAppendPath(paths: string[] | undefined, path: string): string[] {
  const next = [...(paths ?? [])];
  if (!next.includes(path)) next.push(path);
  return next;
}

// 参考图按落点（场景/角色/道具/色卡/额外参考）创建临时资产并生成 shot patch。
// 故事板弹窗与展开行共用；两侧差异只在去重集合与写回通道（patchLatestShotRefs vs onPatch）。
function buildReferencePlacementPatch(shot: WsShot, path: string, placement: ReferencePlacementKind): Partial<WsShot> {
  if (placement === 'scene') {
    const id = createTemporaryAssetFromReference('scene', shot.shotNo, path);
    return { sceneId: id, sceneImagePaths: undefined, promptNeedsRefresh: true };
  }
  if (placement === 'character') {
    const id = createTemporaryAssetFromReference('character', shot.shotNo, path);
    return { characterIds: uniqueAppendPath(shot.characterIds, id), promptNeedsRefresh: true };
  }
  if (placement === 'prop') {
    const id = createTemporaryAssetFromReference('prop', shot.shotNo, path);
    return { propIds: uniqueAppendPath(shot.propIds, id), promptNeedsRefresh: true };
  }
  if (placement === 'palette') {
    const id = createTemporaryAssetFromReference('palette', shot.shotNo, path);
    return { colorPaletteId: id, promptNeedsRefresh: true };
  }
  return { extraRefImages: uniqueAppendPath(shot.extraRefImages, path), promptNeedsRefresh: true };
}

// 工坊资产选择器（场景/角色/道具/色卡）生成 shot patch，故事板弹窗与展开行共用。
function buildWorkshopAssetReferencePatch(
  shot: WsShot,
  item: WorkshopAssetPickItem,
  scenes: { id: string; name: string; assetImagePath?: string; selectedImagePaths?: string[]; sceneReferenceMode?: 'multi' }[],
): Partial<WsShot> | null {
  if (item.kind === 'scene') {
    return { sceneImagePaths: uniqueAppendPath(getSceneReferencePaths(shot, scenes), item.path), promptNeedsRefresh: true };
  }
  if (item.kind === 'character') {
    return { characterIds: uniqueAppendPath(shot.characterIds, item.assetId), promptNeedsRefresh: true };
  }
  if (item.kind === 'prop') {
    return { propIds: uniqueAppendPath(shot.propIds, item.assetId), promptNeedsRefresh: true };
  }
  if (item.kind === 'palette') {
    return { colorPaletteId: item.assetId, promptNeedsRefresh: true };
  }
  return null;
}

function remapShotPromptRefs(
  oldShot: WsShot,
  nextShot: WsShot,
  scenes: { id: string; name: string; assetImagePath?: string; selectedImagePaths?: string[]; sceneReferenceMode?: 'multi' }[],
  characters: { id: string; name: string; assetImagePath?: string }[],
  props: { id: string; name: string; assetImagePath?: string }[],
  colorPalettes?: PaletteOption[],
  globalColorPaletteId?: string,
): Partial<WsShot> {
  return sharedRemapShotPromptRefs(oldShot, nextShot, { scenes, characters, props, colorPalettes, globalColorPaletteId });
}

const REF_PATCH_FIELDS = new Set([
  'characterIds',
  'propIds',
  'sceneId',
  'sceneImagePaths',
  'extraRefImages',
  'colorPaletteId',
  'storyboardBoards',
]);

function shouldRemapRefs(patch: Partial<WsShot>): boolean {
  return Object.keys(patch).some((key) => REF_PATCH_FIELDS.has(key));
}

function PalettePreview({ palette, compact = false }: { palette?: PaletteOption; compact?: boolean }) {
  if (!palette) {
    return (
      <div className={`${compact ? 'w-8 h-8' : 'w-12 h-9'} rounded-md border border-[var(--canvas-node-border)] bg-[rgba(255,255,255,0.04)] flex items-center justify-center`}>
        <Palette size={compact ? 14 : 16} className="text-[var(--canvas-text-3)]" />
      </div>
    );
  }
  if (palette.assetImagePath) {
    return (
      <div className={`${compact ? 'w-10 h-8' : 'w-16 h-11'} rounded-md overflow-hidden border border-[var(--canvas-node-border)] bg-black/30 shrink-0`}>
        <img src={convertFileSrc(palette.assetImagePath)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
      </div>
    );
  }
  return (
    <div className={`${compact ? 'w-10 h-8' : 'w-16 h-11'} rounded-md overflow-hidden border border-[var(--canvas-node-border)] flex shrink-0`}>
      {(palette.colors ?? []).slice(0, 8).map((c) => <div key={c.hex} className="flex-1" style={{ background: c.hex }} />)}
    </div>
  );
}

function PaletteSwatches({ palette }: { palette?: PaletteOption }) {
  const colors = palette?.colors ?? [];
  if (colors.length === 0) return null;
  return (
    <div className="mt-1 flex h-2.5 rounded-full overflow-hidden border border-black/20">
      {colors.slice(0, 13).map((c) => <div key={`${palette?.id}-${c.hex}`} className="flex-1" style={{ background: c.hex }} title={`${c.hex} ${c.label}`} />)}
    </div>
  );
}

function PaletteMenu({ value, palettes, placeholder, followLabel, onChange, className = '' }: {
  value?: string;
  palettes: PaletteOption[];
  placeholder: string;
  followLabel?: string;
  onChange: (id?: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const selected = palettes.find((p) => p.id === value);
  const disabledForShot = value === '__none__';
  const label = selected?.name ?? (disabledForShot ? '本镜不使用色卡' : followLabel ?? placeholder);

  const updateMenuPos = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(420, window.innerWidth - 32);
    const left = Math.min(Math.max(16, rect.right - width), window.innerWidth - width - 16);
    setMenuPos({ top: rect.bottom + 8, left, width });
  }, []);

  useEffect(() => {
    if (!open) return;
    updateMenuPos();
    window.addEventListener('resize', updateMenuPos);
    window.addEventListener('scroll', updateMenuPos, true);
    return () => {
      window.removeEventListener('resize', updateMenuPos);
      window.removeEventListener('scroll', updateMenuPos, true);
    };
  }, [open, updateMenuPos]);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        onClick={() => {
          updateMenuPos();
          setOpen((v) => !v);
        }}
        className="h-full min-h-[34px] flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-[var(--canvas-node-border)] bg-[rgba(255,255,255,0.03)] text-left hover:border-[var(--canvas-node-border-selected)] transition-colors"
        title="选择色卡"
      >
        <PalettePreview palette={selected} compact />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] text-[var(--canvas-text-1)] truncate">{label}</p>
          <p className="text-[10px] text-[var(--canvas-text-3)] truncate">{selected?.description ?? (disabledForShot ? '不传入色卡参考图' : 'Color palette menu')}</p>
        </div>
        <ChevronDown size={13} className={`text-[var(--canvas-text-3)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && menuPos && createPortal(
        <>
          <button className="fixed inset-0 cursor-default" style={{ zIndex: Z.popover }} onClick={() => setOpen(false)} />
          <div
            className="canvas-dark canvas-popover-surface fixed rounded-xl border overflow-hidden shadow-2xl"
            style={{
              top: menuPos.top,
              left: menuPos.left,
              width: menuPos.width,
              maxHeight: `min(420px, calc(100vh - ${menuPos.top + 16}px))`,
              zIndex: Z.popover + 1,
            }}
          >
            <div className="px-3 py-2 border-b border-[var(--canvas-node-border)] flex items-center gap-2">
              <Palette size={14} className="text-[var(--canvas-accent)]" />
              <span className="text-[12px] font-medium text-[var(--canvas-text-1)]">选择色卡</span>
            </div>
            <div className="max-h-[420px] overflow-y-auto p-2 space-y-1">
              <button
                onClick={() => { onChange(undefined); setOpen(false); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-[rgba(255,255,255,0.06)] transition-colors"
              >
                <PalettePreview compact />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] text-[var(--canvas-text-1)]">{placeholder}</p>
                  <p className="text-[10px] text-[var(--canvas-text-3)]">{followLabel ? '本镜不覆盖，使用全片设置' : '生成时不传入色卡参考图'}</p>
                </div>
                {!value && <Check size={14} className="text-[var(--canvas-accent)]" />}
              </button>
              {followLabel && (
                <button
                  onClick={() => { onChange('__none__'); setOpen(false); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-[rgba(255,255,255,0.06)] transition-colors"
                >
                  <PalettePreview compact />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] text-[var(--canvas-text-1)]">本镜不使用色卡</p>
                    <p className="text-[10px] text-[var(--canvas-text-3)]">跳过全片色卡，不传入色卡参考图</p>
                  </div>
                  {disabledForShot && <Check size={14} className="text-[var(--canvas-accent)]" />}
                </button>
              )}
              {palettes.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { onChange(p.id); setOpen(false); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-[rgba(255,255,255,0.06)] transition-colors"
                >
                  <PalettePreview palette={p} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-[12px] text-[var(--canvas-text-1)] font-medium truncate">{p.name}</p>
                      {p.id === value && <Check size={13} className="text-[var(--canvas-accent)] shrink-0" />}
                    </div>
                    <p className="text-[10px] text-[var(--canvas-text-3)] truncate">{p.description}</p>
                    <PaletteSwatches palette={p} />
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

function ResizableTh({ colKey, width, label, onResize, children }: {
  colKey: ColKey; width: number; label?: string;
  onResize: (key: ColKey, w: number) => void; children?: React.ReactNode;
}) {
  const startXRef = useRef(0);
  const startWRef = useRef(0);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startXRef.current = e.clientX;
    startWRef.current = width || 200;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const delta = ev.clientX - startXRef.current;
      onResize(colKey, Math.max(40, startWRef.current + delta));
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [colKey, width, onResize]);

  const handle = (
    <div
      onPointerDown={onPointerDown}
      className="group absolute top-0 bottom-0 w-[8px] cursor-col-resize z-10"
      style={{ background: 'transparent' }}
    >
      <div className="absolute inset-y-1 left-1/2 -translate-x-1/2 w-[1px] bg-[var(--canvas-node-border)] opacity-40 transition-colors group-hover:bg-[var(--canvas-accent)] group-hover:opacity-100" />
    </div>
  );

  return (
    <th
      className="relative border-b border-r border-[var(--canvas-node-border)] bg-[var(--canvas-panel)] px-2 py-2 font-normal"
      style={width > 0 ? { width } : undefined}
    >
      {children ?? label}
      {colKey !== 'desc' && (
        <>
          <div className="absolute left-0 top-0 bottom-0" style={{ transform: 'translateX(-4px)' }}>
            {handle}
          </div>
          <div className="absolute right-0 top-0 bottom-0" style={{ transform: 'translateX(4px)' }}>
            {handle}
          </div>
        </>
      )}
    </th>
  );
}

// 展开行内的可折叠分段：小段头（箭头 + 标题）点击切换，默认收起。
// 状态在组件内 useState；ShotRows 以 shotNo 为 key，各分镜互不影响。
function CollapsibleSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mb-1.5 flex items-center gap-1 text-[11px] text-[var(--canvas-text-2)] transition-colors hover:text-[var(--canvas-text-1)]"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{title}</span>
      </button>
      {open && children}
    </div>
  );
}

export default function StepPrompts() {
  // 浅比较对象选择器：只订本页用到的字段。store 任何写入都换 data 引用，
  // 整订会让 logChange/其他步骤状态更新也重渲染整张 61 镜表格
  const data = useWorkshopStore(useShallow((s) => s.data && ({
    projectId: s.data.projectId,
    shots: s.data.shots,
    characters: s.data.characters,
    scenes: s.data.scenes,
    props: s.data.props,
    colorPalettes: s.data.colorPalettes,
    globalColorPaletteId: s.data.globalColorPaletteId,
    videoRatio: s.data.videoRatio,
    videoPromptTemplate: s.data.videoPromptTemplate,
    promptsStatus: s.data.steps.prompts.status,
  })));
  const updateShot = useWorkshopStore((s) => s.updateShot);
  const removeShot = useWorkshopStore((s) => s.removeShot);
  const setShots = useWorkshopStore((s) => s.setShots);
  const markStepStatus = useWorkshopStore((s) => s.markStepStatus);
  const setGlobalColorPalette = useWorkshopStore((s) => s.setGlobalColorPalette);
  const setVideoPromptTemplate = useWorkshopStore((s) => s.setVideoPromptTemplate);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [directorAvailability, setDirectorAvailability] = useState<Record<string, DirectorAvailability>>({});
  const [toolbarMoreOpen, setToolbarMoreOpen] = useState(false);
  const setActiveView = useChatStore((s) => s.setActiveView);
  const [colWidths, setColWidths] = useState<Record<ColKey, number>>(loadColWidths);

  const handleResize = useCallback((key: ColKey, w: number) => {
    setColWidths((prev) => {
      const next = { ...prev, [key]: w };
      try { localStorage.setItem(COL_WIDTHS_STORAGE_KEY, JSON.stringify(next)); } catch { /* 写入失败不影响拖拽 */ }
      return next;
    });
  }, []);

  const resetColWidths = useCallback(() => {
    try { localStorage.removeItem(COL_WIDTHS_STORAGE_KEY); } catch { /* 忽略 */ }
    setColWidths({ ...DEFAULT_COL_WIDTHS });
  }, []);

  // 探测结果只取决于 (projectId, 镜号集合, 磁盘上的导演工程文件)，
  // 与提示词文本等分镜内容无关——依赖换成镜号签名，内容改动不再触发重探。
  // 导演工程只在导演视图（本页已卸载）里写盘，回到本页即重挂载重新探测，不会漏刷新。
  const shotNosSignature = useMemo(() => (data?.shots ?? []).map((shot) => shot.shotNo).join('|'), [data?.shots]);

  useEffect(() => {
    const projectId = data?.projectId;
    if (!projectId || !shotNosSignature) {
      setDirectorAvailability({});
      return;
    }
    let cancelled = false;
    // 500ms 防抖吸收批写入；并发上限 4，61 镜 × 2 模式 ≈ 244 次 IPC 不再一次性打满
    const timer = setTimeout(() => {
      const shots = useWorkshopStore.getState().data?.shots ?? [];
      void mapWithConcurrency(shots, 4, async (shot) => {
        const [storyboard, videoPrompt] = await Promise.all([
          hasDirectorProject(projectId, shot.shotNo, 'storyboard'),
          hasDirectorProject(projectId, shot.shotNo, 'video-prompt'),
        ]);
        return [shot.shotNo, { storyboard, videoPrompt }] as const;
      }).then((entries) => {
        if (!cancelled) setDirectorAvailability(Object.fromEntries(entries));
      });
    }, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [data?.projectId, shotNosSignature]);

  // 当前所选版本的提示词全部填好即自动标记本步完成；切换版本后按可见内容重新判断。
  useEffect(() => {
    if (!data) return;
    const ready = data.shots.length > 0 && data.shots.every((s) => editableVideoPrompt(s, data.videoPromptTemplate).trim());
    const status = data.promptsStatus;
    if (ready && status !== 'done') markStepStatus('prompts', 'done');
    else if (!ready && status === 'done') markStepStatus('prompts', 'in-progress');
  }, [data, markStepStatus]);

  if (!data) return null;

  const handleSyncToCanvas = async () => {
    const msg = await syncShotPromptsToCanvas();
    await tauriMessage(msg, { title: '同步到画布' });
    setActiveView('canvas');
  };

  const handlePull = async () => {
    const msg = await pullFromCanvas();
    await tauriMessage(msg, { title: '从画布拉取' });
  };

  // useCallback 保持引用稳定：配合 ShotRows 的 React.memo，单行编辑不再重渲染全部行
  const toggle = useCallback((no: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(no)) next.delete(no); else next.add(no);
      return next;
    });
  }, []);

  const patchShot = useCallback((shot: WsShot, patch: Partial<WsShot>) => {
    if (!shouldRemapRefs(patch)) {
      updateShot(shot.shotNo, patch);
      return;
    }
    const nextShot = { ...shot, ...patch };
    const remap = remapShotPromptRefs(shot, nextShot, data.scenes, data.characters, data.props ?? [], data.colorPalettes ?? [], data.globalColorPaletteId);
    updateShot(shot.shotNo, { ...remap, ...patch });
  }, [data.characters, data.colorPalettes, data.globalColorPaletteId, data.props, data.scenes, updateShot]);

  const previsShotCount = data.shots.filter((shot) => {
    const status = directorAvailability[shot.shotNo];
    return status?.storyboard || status?.videoPrompt;
  }).length;

  const openDirectorHub = () => {
    const existing = data.shots.find((shot) => {
      const status = directorAvailability[shot.shotNo];
      return status?.storyboard || status?.videoPrompt;
    });
    const target = existing ?? data.shots[0];
    if (!target) return;
    const status = directorAvailability[target.shotNo];
    const mode = status?.storyboard
      ? 'storyboard'
      : status?.videoPrompt ? 'video-prompt'
        : (target.storyboardFrames ?? []).some((frame) => frame.prompt || frame.imagePath) ? 'storyboard' : 'video-prompt';
    openWorkshopDirector(target, data.characters, data.projectId, mode);
  };

  return (
    <div className="max-w-[1440px] mx-auto px-8 py-8 pb-16">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[16px] font-semibold text-[var(--canvas-text-1)]">④ 分镜与提示词</h2>
          <p className="text-[12px] text-[var(--canvas-text-3)] mt-1">
            {data.shots.length} 镜 · 提示词已填 {data.shots.filter((s) => editableVideoPrompt(s, data.videoPromptTemplate).trim()).length} 镜 · 点行首展开编辑提示词
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openDirectorHub}
            disabled={data.shots.length === 0}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-[var(--canvas-node-border)] bg-[rgba(255,255,255,0.035)] px-3 text-[12px] font-medium text-[var(--canvas-text-1)] transition-colors hover:bg-[rgba(255,255,255,0.07)] disabled:opacity-35"
            title="打开导演台，可在当前项目全部分镜预演之间切换"
          >
            <Clapperboard size={13} /> 导演台
            {previsShotCount > 0 && <span className="rounded border border-[var(--canvas-node-border)] px-1.5 py-0.5 text-[10px] font-normal text-[var(--canvas-text-3)]">已有 {previsShotCount} 镜</span>}
          </button>
          <button
            onClick={() => void buildStyleSection().then((sec) => dispatchWorkshopPrompt(buildShotPromptsPrompt(sec, data.videoPromptTemplate ?? 'legacy')))}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-[var(--canvas-node-border)] px-3 text-[12px] font-medium text-[var(--canvas-text-1)] transition-colors hover:bg-[rgba(255,255,255,0.05)]"
          >
            <Sparkles size={12} /> AI 写提示词
          </button>
          <div className="relative">
            <button type="button" onClick={() => setToolbarMoreOpen((value) => !value)} className="flex h-9 items-center gap-1.5 rounded-lg border border-[var(--canvas-node-border)] px-3 text-[11px] text-[var(--canvas-text-2)] transition-colors hover:bg-[rgba(255,255,255,0.05)] hover:text-[var(--canvas-text-1)]">
              <MoreHorizontal size={13} /> 更多
            </button>
            {toolbarMoreOpen && <>
              <button type="button" aria-label="关闭更多菜单" className="fixed inset-0 cursor-default" style={{ zIndex: Z.popover }} onClick={() => setToolbarMoreOpen(false)} />
              <div className="absolute right-0 top-11 w-[320px] rounded-xl border border-[var(--canvas-node-border)] bg-[var(--canvas-panel)] p-3 shadow-2xl" style={{ zIndex: Z.popover + 1 }}>
                <div className="mb-2 text-[10px] font-medium text-[var(--canvas-text-3)]">全片设置</div>
                <PaletteMenu value={data.globalColorPaletteId ?? ''} palettes={data.colorPalettes ?? []} placeholder="不使用全片色卡" onChange={setGlobalColorPalette} className="w-full" />
                <div className="my-3 h-px bg-[var(--canvas-node-border)]" />
                <div className="mb-1 text-[10px] font-medium text-[var(--canvas-text-3)]">分镜管理</div>
                <button type="button" onClick={() => { setToolbarMoreOpen(false); setShots([...data.shots, { shotNo: `${String(data.shots.length + 1).padStart(2, '0')}`, description: '', characterIds: [] }], 'replace'); }} className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[11px] text-[var(--canvas-text-2)] hover:bg-[var(--canvas-controls-hover)] hover:text-[var(--canvas-text-1)]"><Plus size={12} />增加一镜</button>
                <button type="button" onClick={() => { setToolbarMoreOpen(false); dispatchWorkshopPrompt(buildBatchAudioPromptsPrompt()); }} className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[11px] text-[var(--canvas-text-2)] hover:bg-[var(--canvas-controls-hover)] hover:text-[var(--canvas-text-1)]"><Sparkles size={12} />AI 批量写配音提示词</button>
                <div className="my-3 h-px bg-[var(--canvas-node-border)]" />
                <div className="mb-1 text-[10px] font-medium text-[var(--canvas-text-3)]">画布同步</div>
                <button type="button" disabled={data.shots.every((item) => !item.videoPrompt)} onClick={() => { setToolbarMoreOpen(false); void handleSyncToCanvas(); }} className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[11px] text-[var(--canvas-text-2)] hover:bg-[var(--canvas-controls-hover)] hover:text-[var(--canvas-text-1)] disabled:opacity-35"><MonitorPlay size={12} />分镜同步到画布</button>
                <button type="button" onClick={() => { setToolbarMoreOpen(false); void handlePull(); }} className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[11px] text-[var(--canvas-text-2)] hover:bg-[var(--canvas-controls-hover)] hover:text-[var(--canvas-text-1)]"><RefreshCw size={12} />从画布拉取更新</button>
                <div className="my-3 h-px bg-[var(--canvas-node-border)]" />
                <div className="mb-1 text-[10px] font-medium text-[var(--canvas-text-3)]">表格</div>
                <button type="button" onClick={() => { setToolbarMoreOpen(false); resetColWidths(); }} className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-[11px] text-[var(--canvas-text-2)] hover:bg-[var(--canvas-controls-hover)] hover:text-[var(--canvas-text-1)]"><RotateCcw size={12} />重置列宽</button>
              </div>
            </>}
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-4 rounded-xl border border-[var(--canvas-node-border)] bg-[var(--canvas-node-bg)] px-4 py-3">
        <div>
          <div className="text-[12px] font-medium text-[var(--canvas-text-1)]">全局提示词版本</div>
          <div className="mt-0.5 text-[10px] text-[var(--canvas-text-3)]">默认应用于全部分镜，展开单镜后可以单独覆盖。</div>
        </div>
        <div className="w-[250px] shrink-0">
          <VideoPromptVersionSwitch value={data.videoPromptTemplate ?? 'legacy'} onChange={setVideoPromptTemplate} />
        </div>
      </div>

      {data.shots.length === 0 ? (
        <p className="text-center py-16 text-[12px] text-[var(--canvas-text-3)]">先完成第②步拆解，分镜表会自动出现在这里</p>
      ) : (
        <div className="mt-5 overflow-x-auto rounded-xl border border-[var(--canvas-node-border)]">
          <table className="w-full text-[11px]" style={{ tableLayout: 'fixed', minWidth: 1100 }}>
            <thead>
              <tr className="text-left text-[var(--canvas-text-3)] border-b border-[var(--canvas-node-border)]" style={{ background: 'rgba(255,255,255,0.03)' }}>
                <th className="w-8 border-b border-r border-[var(--canvas-node-border)] bg-[var(--canvas-panel)]" />
                <ResizableTh colKey="shotNo" width={colWidths.shotNo} label="段号" onResize={handleResize} />
                <ResizableTh colKey="desc" width={colWidths.desc} label="画面描述" onResize={handleResize} />
                <ResizableTh colKey="dialogue" width={colWidths.dialogue} label="对白" onResize={handleResize} />
                <ResizableTh colKey="shotType" width={colWidths.shotType} label="景别" onResize={handleResize} />
                <ResizableTh colKey="camera" width={colWidths.camera} label="运镜" onResize={handleResize} />
                <ResizableTh colKey="mood" width={colWidths.mood} label="情绪" onResize={handleResize} />
                <ResizableTh colKey="duration" width={colWidths.duration} label="时长" onResize={handleResize} />
                <ResizableTh colKey="ratio" width={colWidths.ratio} label="比例" onResize={handleResize} />
                <th className="w-16 border-b border-[var(--canvas-node-border)] bg-[var(--canvas-panel)]" />
              </tr>
            </thead>
            <tbody>
              {data.shots.map((shot) => (
                <ShotRows
                  key={shot.shotNo}
                  shot={shot}
                  isOpen={expanded.has(shot.shotNo)}
                  onToggle={toggle}
                  onPatch={patchShot}
                  onRemove={removeShot}
                  colWidths={colWidths}
                  characters={data.characters}
                  scenes={data.scenes}
                  props={data.props ?? EMPTY_ASSET_REFS}
                  colorPalettes={data.colorPalettes ?? EMPTY_PALETTE_REFS}
                  globalRatio={data.videoRatio}
                  globalColorPaletteId={data.globalColorPaletteId}
                  globalVideoPromptTemplate={data.videoPromptTemplate}
                  directorAvailability={directorAvailability[shot.shotNo]}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function buildShotRefImages(
  shot: WsShot,
  characters: { id: string; name: string; assetImagePath?: string; voicePath?: string }[],
  scenes: { id: string; name: string; assetImagePath?: string; selectedImagePaths?: string[]; sceneReferenceMode?: 'multi' }[],
  props?: { id: string; name: string; assetImagePath?: string }[],
  colorPalettes?: PaletteOption[],
  globalColorPaletteId?: string,
): PromptRefItem[] {
  const bindings = buildImageRefBindings(shot, {
    characters,
    scenes,
    props: props ?? [],
    colorPalettes: colorPalettes ?? [],
    globalColorPaletteId,
  });
  const items: PromptRefItem[] = bindings.map((binding) => ({
    label: `@图片${numToCn(binding.index)}${binding.kind === 'palette' ? ' 色卡' : ''}`,
    url: convertFileSrc(binding.path),
    path: binding.path,
    removable: true,
    removeKind: binding.kind,
    id: binding.id,
  }));
  (shot.storyboardBoards ?? []).forEach((board, i) => {
    if (board.imagePath) items.push({ label: `分镜板${i + 1}`, url: convertFileSrc(board.imagePath), path: board.imagePath, removable: true, removeKind: 'storyboardBoard', id: board.id });
  });
  let audioIdx = 1;
  if (shot.audioInjected && shot.generatedAudios?.length) {
    for (const ga of shot.generatedAudios) {
      const audioPath = ga.trimmedPath || ga.path;
      items.push({ label: `@配音${numToCn(audioIdx)} (${ga.characterName})`, url: convertFileSrc(audioPath), type: 'audio', path: audioPath, removable: true, removeKind: 'generatedAudio', id: ga.characterId });
      audioIdx++;
    }
  } else {
    for (const cid of (shot.voiceCharacterIds ?? [])) {
      const ch = characters.find((c) => c.id === cid);
      if (ch?.voicePath) {
        items.push({ label: `@音频${numToCn(audioIdx)} ${ch.name}`, url: convertFileSrc(ch.voicePath), type: 'audio', path: ch.voicePath, removable: true, removeKind: 'voice', id: cid });
        audioIdx++;
      }
    }
  }
  return items;
}

function buildShotVideoRefImages(
  shot: WsShot,
  characters: { id: string; name: string; assetImagePath?: string; voicePath?: string }[],
  scenes: { id: string; name: string; assetImagePath?: string; selectedImagePaths?: string[]; sceneReferenceMode?: 'multi' }[],
  props?: { id: string; name: string; assetImagePath?: string }[],
  colorPalettes?: PaletteOption[],
  globalColorPaletteId?: string,
): PromptRefItem[] {
  const items: PromptRefItem[] = [];
  for (const [videoIndex, path] of (shot.directorPrevisVideoPaths ?? []).entries()) {
    items.push({ label: `@视频${numToCn(videoIndex + 1)} 白模预演`, url: convertFileSrc(path), path, type: 'video', removable: false });
  }
  const bindings = buildVideoRefBindings(shot, {
    characters,
    scenes,
    props: props ?? [],
    colorPalettes: colorPalettes ?? [],
    globalColorPaletteId,
  });
  items.push(...bindings.map((binding) => ({
    label: `@图片${numToCn(binding.index)} ${binding.label}`,
    url: convertFileSrc(binding.path),
    path: binding.path,
    removable: true,
    removeKind: binding.kind,
    id: binding.id,
  } as PromptRefItem)));
  let audioIdx = 1;
  if (shot.audioInjected && shot.generatedAudios?.length) {
    for (const ga of shot.generatedAudios) {
      const audioPath = ga.trimmedPath || ga.path;
      items.push({ label: `@配音${numToCn(audioIdx)} (${ga.characterName})`, url: convertFileSrc(audioPath), type: 'audio', path: audioPath, removable: true, removeKind: 'generatedAudio', id: ga.characterId });
      audioIdx++;
    }
  } else {
    for (const cid of (shot.voiceCharacterIds ?? [])) {
      const ch = characters.find((c) => c.id === cid);
      if (ch?.voicePath) {
        items.push({ label: `@音频${numToCn(audioIdx)} ${ch.name}`, url: convertFileSrc(ch.voicePath), type: 'audio', path: ch.voicePath, removable: true, removeKind: 'voice', id: cid });
        audioIdx++;
      }
    }
  }
  return items;
}

function removeShotRefAsset(
  ref: PromptRefItem,
  shot: WsShot,
  scenes: { id: string; name: string; assetImagePath?: string; selectedImagePaths?: string[]; sceneReferenceMode?: 'multi' }[],
): Partial<WsShot> | null {
  if (!ref.removeKind) return null;
  if (ref.removeKind === 'scene' && ref.path) {
    const active = getSceneReferencePaths(shot, scenes);
    return { sceneImagePaths: active.filter((p) => p !== ref.path), promptNeedsRefresh: true };
  }
  if (ref.removeKind === 'character' && ref.id) {
    return {
      characterIds: (shot.characterIds ?? []).filter((id) => id !== ref.id),
      voiceCharacterIds: (shot.voiceCharacterIds ?? []).filter((id) => id !== ref.id),
      audioPrompts: (shot.audioPrompts ?? []).filter((p) => p.characterId !== ref.id),
      generatedAudios: (shot.generatedAudios ?? []).filter((a) => a.characterId !== ref.id),
    };
  }
  if (ref.removeKind === 'prop' && ref.id) return { propIds: (shot.propIds ?? []).filter((id) => id !== ref.id) };
  if (ref.removeKind === 'palette') return { colorPaletteId: '__none__', promptNeedsRefresh: true };
  if (ref.removeKind === 'extra' && ref.path) return { extraRefImages: (shot.extraRefImages ?? []).filter((p) => p !== ref.path) };
  if (ref.removeKind === 'storyboardBoard' && ref.id) {
    return { storyboardBoards: (shot.storyboardBoards ?? []).filter((b) => b.id !== ref.id) };
  }
  if (ref.removeKind === 'directorConstraintCard') {
    return {
      directorConstraintCard: undefined,
      storyboardFrames: (shot.storyboardFrames ?? []).map((frame) => ({
        ...frame,
        useDirectorConstraintCard: false,
        prompt: stripDirectorConstraintMention(frame.prompt),
      })),
    };
  }
  if (ref.removeKind === 'voice' && ref.id) return { voiceCharacterIds: (shot.voiceCharacterIds ?? []).filter((id) => id !== ref.id) };
  if (ref.removeKind === 'generatedAudio' && ref.id) {
    const nextAudios = (shot.generatedAudios ?? []).filter((a) => a.characterId !== ref.id);
    return { generatedAudios: nextAudios, audioInjected: nextAudios.length > 0 ? shot.audioInjected : false };
  }
  return null;
}

function RemovableRefStrip({ refs, shot, scenes, onPatch, onPreview, onMove, canMove }: {
  refs: PromptRefItem[];
  shot: WsShot;
  scenes: { id: string; name: string; assetImagePath?: string; selectedImagePaths?: string[]; sceneReferenceMode?: 'multi' }[];
  onPatch: (p: Partial<WsShot>) => void;
  onPreview?: (url: string) => void;
  onMove?: (ref: PromptRefItem, dir: -1 | 1) => void;
  canMove?: (ref: PromptRefItem, dir: -1 | 1) => boolean;
}) {
  const removable = refs.filter((ref) => ref.removable && ref.path);
  if (removable.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-2">
      {removable.map((ref, i) => (
        <div
          key={`${ref.removeKind}-${ref.id ?? ref.path}-${i}`}
          className="group relative w-[86px] overflow-hidden rounded-lg border border-[var(--canvas-node-border)] bg-black/20"
        >
          <button
            type="button"
            onClick={() => ref.path && ref.type !== 'audio' && ref.type !== 'video' && onPreview?.(ref.url)}
            className="relative block h-[52px] w-full bg-black/30"
            title={ref.type === 'audio' ? '音频资产' : ref.type === 'video' ? '视频资产' : '点击放大查看资产'}
          >
            {ref.type === 'audio' ? (
              <div className="flex h-full items-center justify-center text-[10px] text-[var(--canvas-text-3)]">音频</div>
            ) : ref.type === 'video' ? (
              <div className="flex h-full items-center justify-center text-[10px] text-[var(--canvas-text-3)]">视频</div>
            ) : (
              <img src={ref.url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
            )}
            <span className="absolute left-1 top-1 rounded bg-black/70 px-1 py-0.5 text-[10px] text-white">{ref.label}</span>
            {ref.type !== 'audio' && ref.type !== 'video' && (
              <span className="absolute right-1 bottom-1 hidden h-5 w-5 items-center justify-center rounded bg-black/70 text-white group-hover:flex">
                <Maximize2 size={11} />
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              const patch = removeShotRefAsset(ref, shot, scenes);
              if (patch) onPatch(patch);
            }}
            className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/75 text-white opacity-0 transition-opacity hover:bg-[var(--canvas-danger)] group-hover:opacity-100"
            title="从本镜所有引用中删除这个资产"
          >
            <X size={11} />
          </button>
          <div className="flex items-center justify-between gap-1 px-1.5 py-1">
            <span className="min-w-0 truncate text-[10px] text-[var(--canvas-text-3)]">{ref.removeKind === 'storyboardBoard' ? '分镜板' : ref.removeKind === 'extra' ? '额外' : ref.removeKind === 'palette' ? '色卡' : ref.removeKind === 'character' ? '角色' : ref.removeKind === 'prop' ? '道具' : '参考'}</span>
            {onMove && canMove && (
              <span className="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  disabled={!canMove(ref, -1)}
                  onClick={() => onMove(ref, -1)}
                  className="rounded p-0.5 text-[var(--canvas-text-3)] hover:bg-white/5 hover:text-[var(--canvas-text-1)] disabled:opacity-25"
                  title="上移同类资产"
                >
                  <ChevronUp size={10} />
                </button>
                <button
                  type="button"
                  disabled={!canMove(ref, 1)}
                  onClick={() => onMove(ref, 1)}
                  className="rounded p-0.5 text-[var(--canvas-text-3)] hover:bg-white/5 hover:text-[var(--canvas-text-1)] disabled:opacity-25"
                  title="下移同类资产"
                >
                  <ChevronDown size={10} />
                </button>
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function WorkshopAssetImagePicker({ open, onClose, characters, scenes, props, colorPalettes, onPick }: {
  open: boolean;
  onClose: () => void;
  characters: { id: string; name: string; assetImagePath?: string }[];
  scenes: { id: string; name: string; assetImagePath?: string; selectedImagePaths?: string[]; sceneReferenceMode?: 'multi' }[];
  props: { id: string; name: string; assetImagePath?: string }[];
  colorPalettes: PaletteOption[];
  onPick: (item: WorkshopAssetPickItem) => void;
}) {
  useEscapeClose(open, onClose);
  if (!open) return null;
  const items: WorkshopAssetPickItem[] = [
    ...scenes.flatMap((s) => {
      const paths = s.sceneReferenceMode === 'multi' && s.selectedImagePaths?.length ? s.selectedImagePaths : s.assetImagePath ? [s.assetImagePath] : [];
      return paths.map((path, i) => ({ id: `${s.id}-${i}`, assetId: s.id, name: i === 0 ? `场景 · ${s.name}` : `场景 · ${s.name} 角度${i + 1}`, kind: 'scene' as const, path }));
    }),
    ...characters.filter((c) => c.assetImagePath).map((c) => ({ id: c.id, assetId: c.id, name: `角色 · ${c.name}`, kind: 'character' as const, path: c.assetImagePath! })),
    ...props.filter((p) => p.assetImagePath).map((p) => ({ id: p.id, assetId: p.id, name: `道具 · ${p.name}`, kind: 'prop' as const, path: p.assetImagePath! })),
    ...colorPalettes.filter((p) => p.assetImagePath).map((p) => ({ id: p.id, assetId: p.id, name: `色卡 · ${p.name}`, kind: 'palette' as const, path: p.assetImagePath! })),
  ];
  return createPortal(
    <div className="canvas-dark fixed inset-0 flex items-center justify-center text-[var(--canvas-text-1)]" style={{ background: 'rgba(0,0,0,0.6)', zIndex: Z.picker }} onMouseDown={onClose}>
      <div className="w-[520px] max-w-[92vw] overflow-hidden rounded-2xl border border-[var(--canvas-node-border)] bg-[var(--canvas-panel)] shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--canvas-node-border)] px-4 py-3">
          <div>
            <div className="text-[13px] font-medium">从工坊资产选择</div>
            <div className="text-[10px] text-[var(--canvas-text-3)]">会按资产类型加入本镜引用，高清故事板和视频提示词同步生效</div>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-[var(--canvas-text-2)] hover:bg-[var(--canvas-controls-hover)] hover:text-[var(--canvas-text-1)]">
            <X size={14} />
          </button>
        </div>
        <div className="max-h-[58vh] overflow-y-auto p-3">
          {items.length === 0 ? (
            <div className="py-12 text-center text-[12px] text-[var(--canvas-text-3)]">暂无可用资产图</div>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {items.map((item) => (
                <button
                  key={`${item.kind}-${item.id}-${item.path}`}
                  onClick={() => onPick(item)}
                  className="group overflow-hidden rounded-lg border border-[var(--canvas-node-border)] bg-black/20 text-left hover:border-[var(--canvas-node-border-selected)]"
                  title={item.name}
                >
                  <div className="aspect-video bg-black/30">
                    <img src={convertFileSrc(item.path)} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                  </div>
                  <div className="truncate px-2 py-1.5 text-[10px] text-[var(--canvas-text-2)] group-hover:text-[var(--canvas-text-1)]">{item.name}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SceneRefSelector({ shot, scene, scenes, characters, props, colorPalettes, globalColorPaletteId, onPatch }: {
  shot: WsShot;
  scene?: { id: string; name: string; assetImagePath?: string; selectedImagePaths?: string[]; sceneReferenceMode?: 'multi'; candidates?: AssetCandidate[] };
  scenes: { id: string; name: string; assetImagePath?: string; selectedImagePaths?: string[]; sceneReferenceMode?: 'multi' }[];
  characters: { id: string; name: string; assetImagePath?: string }[];
  props: { id: string; name: string; assetImagePath?: string }[];
  colorPalettes: PaletteOption[];
  globalColorPaletteId?: string;
  onPatch: (p: Partial<WsShot>) => void;
}) {
  if (!scene) return null;
  const candidates = scene.candidates?.length
    ? scene.candidates
    : scene.assetImagePath ? [{ path: scene.assetImagePath, source: 'upload' as const, createdAt: Date.now() }] : [];
  if (candidates.length === 0) return null;
  const inherited = getSceneReferencePaths({ sceneId: scene.id }, [scene]);
  const active = getSceneReferencePaths(shot, [scene]);
  const isOverride = Boolean(shot.sceneImagePaths);

  const applyPaths = async (paths: string[] | undefined) => {
    const nextShot = { ...shot, sceneImagePaths: paths, promptNeedsRefresh: true };
    onPatch({
      sceneImagePaths: paths,
      promptNeedsRefresh: true,
      ...remapShotPromptRefs(shot, nextShot, scenes, characters, props, colorPalettes, globalColorPaletteId),
    });
    const shouldRegenerate = await confirm('场景参考图顺序已改变，是否让 AI 重新生成本镜提示词，避免 @图片 顺序错位？', { title: '更新提示词' }).catch(() => false);
    if (shouldRegenerate) dispatchWorkshopPrompt(buildOptimizeShotPrompt(shot.shotNo));
  };

  const togglePath = (path: string) => {
    const base = isOverride ? active : inherited;
    const next = base.includes(path) ? base.filter((p) => p !== path) : [...base, path];
    void applyPaths(next);
  };

  return (
    <div className="mb-3 rounded-lg border border-[var(--canvas-node-border)] bg-[rgba(255,255,255,0.025)] px-3 py-2">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-[10px] text-[var(--canvas-text-3)]">场景参考图</span>
          <span className="ml-2 text-[11px] text-[var(--canvas-text-1)]">{scene.name}</span>
          <span className="ml-2 text-[10px] text-[var(--canvas-text-3)]">{active.length} 张 · {isOverride ? '本镜覆盖' : '跟随场景'}</span>
          {shot.promptNeedsRefresh && <span className="ml-2 text-[10px] text-[var(--canvas-warning)]">建议重写提示词</span>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isOverride && (
            <button
              onClick={() => void applyPaths(undefined)}
              className="px-2 py-1 rounded-md text-[11px] text-[var(--canvas-text-2)] border border-[var(--canvas-node-border)] hover:text-[var(--canvas-text-1)] transition-colors"
            >
              跟随场景
            </button>
          )}
          <button
            onClick={() => void applyPaths([])}
            className="px-2 py-1 rounded-md text-[11px] text-[var(--canvas-text-2)] border border-[var(--canvas-node-border)] hover:text-[var(--canvas-text-1)] transition-colors"
          >
            本镜不传场景
          </button>
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {candidates.map((c) => {
          const checked = active.includes(c.path);
          return (
            <button
              key={c.path}
              onClick={() => togglePath(c.path)}
              className="relative w-[64px] h-[44px] rounded-md overflow-hidden shrink-0 border transition-colors"
              style={{ borderColor: checked ? 'var(--canvas-accent)' : 'var(--canvas-node-border)' }}
              title={checked ? '点击移出本镜场景参考' : '点击加入本镜场景参考'}
            >
              <img src={convertFileSrc(c.path)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
              {checked && (
                <span className="absolute right-1 top-1 w-4 h-4 rounded-full bg-[var(--canvas-accent)] flex items-center justify-center">
                  <Check size={10} className="text-white" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AudioPromptsSection({ shot, characters, onPatch }: {
  shot: WsShot;
  characters: { id: string; name: string; voicePath?: string }[];
  onPatch: (p: Partial<WsShot>) => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState('');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const globalVideoModel = useWorkshopStore((s) => s.data?.videoModel);
  // 音频总时长上限跟当前分镜有效模型走：Seedance 2.0 限 15s、2.5 限 30s
  const audioLimitSec = (shot.videoModel || globalVideoModel) === 'seedance-2.5' ? 30 : 15;

  const prompts = shot.audioPrompts ?? [];
  const audios = shot.generatedAudios ?? [];
  const relevantCharacterIds = [...new Set([
    ...(shot.characterIds ?? []),
    ...prompts.map((item) => item.characterId),
    ...audios.map((item) => item.characterId),
  ].filter(Boolean))];
  const shotChars = relevantCharacterIds.map((cid) => {
    const character = characters.find((item) => item.id === cid);
    return character ?? { id: cid, name: `未关联角色（${cid}）` };
  });
  const voiceIds = new Set(shot.voiceCharacterIds ?? []);
  const totalDuration = audios.reduce((s, a) => s + (a.trimmedDuration ?? a.duration), 0);
  const roundedTotal = Math.round(totalDuration * 10) / 10;

  const autoFillPrompts = () => {
    dispatchWorkshopPrompt(buildAudioPromptsPrompt(shot.shotNo));
  };

  const updatePrompt = (charId: string, value: string) => {
    const next = [...prompts];
    const idx = next.findIndex((p) => p.characterId === charId);
    if (idx >= 0) next[idx] = { ...next[idx], prompt: value };
    else next.push({ characterId: charId, prompt: value });
    onPatch({ audioPrompts: next });
  };

  const toggleVoiceAsset = (charId: string) => {
    const next = new Set(shot.voiceCharacterIds ?? []);
    if (next.has(charId)) next.delete(charId); else next.add(charId);
    onPatch({ voiceCharacterIds: [...next] });
  };

  const handleGenerate = async () => {
    const { useSettingsStore } = await import('@/stores/settingsStore');
    const { resolveApiKey } = await import('@/lib/credentials');
    const speechSettings = useSettingsStore.getState();
    if (!resolveApiKey(speechSettings, 'doubaoSpeech', speechSettings.doubaoSpeechApiKey).trim()) {
      await tauriMessage('请先在设置中配置豆包语音 API Key', { title: '缺少 API Key' });
      return;
    }
    const data = useWorkshopStore.getState().data;
    if (!data) return;
    setGenerating(true);
    setProgress('0/' + shotChars.length);
    try {
      const { generateShotAudio } = await import('@/lib/doubaoSpeech/generate');
      const results = await generateShotAudio(
        shot,
        data.characters,
        data.projectId,
        (done, total) => setProgress(`${done}/${total}`),
      );
      onPatch({ generatedAudios: results, audioInjected: false });
      if (results.reduce((s, a) => s + a.duration, 0) > audioLimitSec) {
        const doTrim = await confirm(`配音总计 ${results.reduce((s, a) => s + a.duration, 0).toFixed(1)}s，超过 Seedance ${audioLimitSec}s 限制。是否自动裁剪？`, { title: '自动裁剪' }).catch(() => false);
        if (doTrim) {
          const { trimAudiosToFit } = await import('@/lib/doubaoSpeech/trim');
          const trimmed = await trimAudiosToFit(results, audioLimitSec, data.projectId);
          onPatch({ generatedAudios: trimmed });
        }
      }
    } catch (err) {
      await tauriMessage(`配音生成失败: ${err instanceof Error ? err.message : String(err)}`, { title: '错误' });
    } finally {
      setGenerating(false);
      setProgress('');
    }
  };

  const handleInject = async () => {
    if (audios.length === 0) return;
    const effectiveTotal = audios.reduce((s, a) => s + (a.trimmedDuration ?? a.duration), 0);
    if (effectiveTotal > audioLimitSec) {
      await tauriMessage(`配音总计 ${effectiveTotal.toFixed(1)}s，超过 ${audioLimitSec}s 限制，请先裁剪`, { title: '无法注入' });
      return;
    }
    onPatch({ audioInjected: true });
  };

  const playAudio = (charId: string, path: string) => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (playingId === charId) { setPlayingId(null); return; }
    const audio = new Audio(convertFileSrc(path));
    audio.onended = () => setPlayingId(null);
    audio.play();
    audioRef.current = audio;
    setPlayingId(charId);
  };

  return (
    <div className="mt-3 rounded-lg border border-[var(--canvas-node-border)] bg-[rgba(255,255,255,0.025)] px-3 py-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-[var(--canvas-text-3)] font-medium">台词配音</span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={autoFillPrompts}
            className="px-2 py-1 rounded-md text-[11px] bg-[rgba(255,255,255,0.06)] border border-[var(--canvas-node-border)] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] transition-colors"
            title="AI 分析对白和情绪，自动生成配音提示词"
          >
            <Wand2 size={10} className="inline mr-1" />AI 写提示词
          </button>
          <button
            onClick={() => void handleGenerate()}
            disabled={generating || prompts.filter((p) => p.prompt.trim()).length === 0}
            className="px-2 py-1 rounded-md text-[11px] bg-[rgba(255,255,255,0.06)] border border-[var(--canvas-node-border)] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] transition-colors disabled:opacity-40"
          >
            {generating ? `生成中 ${progress}` : '生成全部配音'}
          </button>
        </div>
      </div>
      {shotChars.some((char) => char.voicePath) && (
        <div className="mb-2 rounded-md border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.025)] px-2 py-1.5">
          <div className="mb-1 text-[10px] text-[var(--canvas-text-3)]">本镜音色资产</div>
          <div className="flex flex-wrap gap-1.5">
            {shotChars.filter((char) => char.voicePath).map((char) => {
              const active = voiceIds.has(char.id);
              return (
                <button
                  key={char.id}
                  onClick={() => toggleVoiceAsset(char.id)}
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] transition-colors ${
                    active
                      ? 'border-[var(--canvas-accent)] text-[var(--canvas-accent)] bg-[rgba(38,166,154,0.12)]'
                      : 'border-[var(--canvas-node-border)] text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-1)]'
                  }`}
                  title={active ? '点击移除本镜音色资产' : '点击把该角色音色作为本镜音频参考'}
                >
                  {active ? <Check size={10} /> : <Plus size={10} />}
                  {char.name} 音色
                </button>
              );
            })}
          </div>
        </div>
      )}
      {shotChars.map((char) => {
        const prompt = prompts.find((p) => p.characterId === char.id)?.prompt ?? '';
        const audio = audios.find((a) => a.characterId === char.id);
        return (
          <div key={char.id} className="mb-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[11px] text-[var(--canvas-text-1)]">{char.name}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[rgba(255,255,255,0.06)] text-[var(--canvas-text-3)]">
                {char.voicePath ? (voiceIds.has(char.id) ? '本镜已启用音色' : '有音色·未启用') : '无音色·文生音'}
              </span>
            </div>
            <SmartTextarea
              rows={2}
              value={prompt}
              onChange={(v) => updatePrompt(char.id, v)}
              placeholder={char.voicePath && voiceIds.has(char.id) ? `用@音频的音色说："台词内容"` : `用[描述音色]说："台词内容"`}
              editorTitle={`配音提示词 · ${char.name}`}
            />
            {audio && (
              <div className="flex items-center gap-2 mt-1">
                <button
                  onClick={() => playAudio(char.id, audio.trimmedPath || audio.path)}
                  className="flex h-6 w-6 items-center justify-center rounded text-[var(--canvas-text-2)] hover:bg-[var(--canvas-controls-hover)] hover:text-[var(--canvas-text-1)]"
                  title={playingId === char.id ? '暂停试听' : '播放试听'}
                >
                  {playingId === char.id ? <Pause size={12} /> : <Play size={12} />}
                </button>
                <span className="text-[10px] text-[var(--canvas-text-3)]">
                  {(audio.trimmedDuration ?? audio.duration).toFixed(1)}s
                  {audio.trimmedDuration ? ` (原${audio.duration.toFixed(1)}s)` : ''}
                </span>
              </div>
            )}
          </div>
        );
      })}
      {audios.length > 0 && (
        <div className="flex items-center gap-3 mt-2 pt-2 border-t border-[rgba(255,255,255,0.06)]">
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-24 rounded-full bg-[rgba(255,255,255,0.08)] overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, (roundedTotal / audioLimitSec) * 100)}%`,
                  background: roundedTotal > audioLimitSec ? 'var(--canvas-danger)' : 'rgba(255,255,255,0.3)',
                }}
              />
            </div>
            <span className={`text-[10px] ${roundedTotal > audioLimitSec ? 'text-[var(--canvas-danger)]' : 'text-[var(--canvas-text-3)]'}`}>
              {roundedTotal}s / {audioLimitSec}s
            </span>
          </div>
          {roundedTotal > audioLimitSec && (
            <button
              onClick={async () => {
                const data = useWorkshopStore.getState().data;
                if (!data) return;
                const { trimAudiosToFit } = await import('@/lib/doubaoSpeech/trim');
                const trimmed = await trimAudiosToFit(audios, audioLimitSec, data.projectId);
                onPatch({ generatedAudios: trimmed });
              }}
              className="text-[11px] text-[var(--canvas-danger)] hover:opacity-80"
            >
              自动裁剪到 {audioLimitSec}s
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={() => void handleInject()}
            disabled={shot.audioInjected}
            className="px-2 py-1 rounded-md text-[11px] bg-[rgba(255,255,255,0.06)] border border-[var(--canvas-node-border)] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] transition-colors disabled:opacity-40"
          >
            {shot.audioInjected ? '✓ 已注入视频提示词' : '注入视频提示词'}
          </button>
        </div>
      )}
    </div>
  );
}

function StoryboardModal({ shot, characters, scenes, props, colorPalettes, globalRatio, globalColorPaletteId, onPatch, onClose }: {
  shot: WsShot;
  characters: { id: string; name: string; assetImagePath?: string; voicePath?: string }[];
  scenes: { id: string; name: string; assetImagePath?: string; selectedImagePaths?: string[]; sceneReferenceMode?: 'multi' }[];
  props: { id: string; name: string; assetImagePath?: string }[];
  colorPalettes: PaletteOption[];
  globalRatio?: string;
  globalColorPaletteId?: string;
  onPatch: (p: Partial<WsShot>) => void;
  onClose: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [composeBusy, setComposeBusy] = useState(false);
  const [canvasSendingId, setCanvasSendingId] = useState<string | null>(null);
  const [storyboardWriting, setStoryboardWriting] = useState(false);
  const [fullscreen, setFullscreen] = useState<string | null>(null);
  const [candidateFrameId, setCandidateFrameId] = useState<string | null>(null);
  const [candidatePreview, setCandidatePreview] = useState<string | null>(null);
  const [activeFrameIndex, setActiveFrameIndex] = useState<number | null>(null);
  const [directorCardAssistantActive, setDirectorCardAssistantActive] = useState(false);
  const [assistantText, setAssistantText] = useState('');
  const [assistantRunActive, setAssistantRunActive] = useState(false);
  const [assistantSawStream, setAssistantSawStream] = useState(false);
  const [assistantStatus, setAssistantStatus] = useState('');
  const [generationStatus, setGenerationStatus] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [constraintPickerOpen, setConstraintPickerOpen] = useState(false);
  const [constraintBusy, setConstraintBusy] = useState(false);
  const [directorCardPromptDraft, setDirectorCardPromptDraft] = useState('');
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [pendingStoryboardRef, setPendingStoryboardRef] = useState<{ path: string; title: string } | null>(null);
  const [storyboardEngine, setStoryboardEngine] = useState<'gpt-image-2' | 'seedream-v5-pro'>('gpt-image-2');
  const [storyboardRatio, setStoryboardRatio] = useState(shot.videoRatio || globalRatio || '16:9');
  const [storyboardResolution, setStoryboardResolution] = useState('2k');
  const writingInitialSig = useRef('');
  const assistantInputRef = useRef<HTMLInputElement>(null);
  const streamingPhase = useChatStore((s) => s.streamingPhase);
  const streamingToolName = useChatStore((s) => s.streamingToolName);
  // Esc 栈：本弹窗在最底，候选图/素材库/全屏查看后挂载，逐层向上只关最顶层。
  useEscapeClose(true, onClose);
  useEscapeClose(candidateFrameId !== null, () => { setCandidateFrameId(null); setCandidatePreview(null); });
  useEscapeClose(pickerOpen, () => setPickerOpen(false));
  useEscapeClose(constraintPickerOpen, () => setConstraintPickerOpen(false));
  useEscapeClose(fullscreen !== null, () => setFullscreen(null));
  const frames = shot.storyboardFrames ?? [];
  const boards = shot.storyboardBoards ?? [];
  const directorCard = shot.directorConstraintCard;
  const effectiveRatio = shot.videoRatio || globalRatio || '16:9';
  const storyboardRatioOptions = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'];
  const storyboardResolutionOptions = ['1k', '2k', '4k'];
  const frameSignature = frames.map((frame) => frame.prompt).join('\n---\n');
  const frameCount = frames.length || 8;
  const directorCardAppliedCount = frames.filter((frame) => frame.useDirectorConstraintCard === true).length;
  const assistantTargetLabel = directorCardAssistantActive
    ? '当前修改导演约束卡'
    : activeFrameIndex === null
      ? `整体修改 ${frameCount} 张`
      : `当前修改第 ${Math.min(activeFrameIndex + 1, Math.max(frames.length, 1))} 张`;

  useEffect(() => {
    setDirectorCardPromptDraft(directorCard?.prompt ?? '');
  }, [directorCard?.id, directorCard?.prompt]);

  useEffect(() => {
    if (!storyboardWriting) return;
    if (frameSignature && frameSignature !== writingInitialSig.current) {
      setStoryboardWriting(false);
    }
  }, [frameSignature, storyboardWriting]);

  useEffect(() => {
    if (!assistantRunActive) return;
    if (streamingPhase !== 'idle') {
      setAssistantSawStream(true);
      return;
    }
    if (!assistantSawStream) return;
    setAssistantRunActive(false);
    setAssistantSawStream(false);
    setAssistantStatus(directorCardAssistantActive
      ? '已完成。请检查导演约束卡提示词是否已按要求更新。'
      : '已完成。请检查当前分镜提示词是否已按要求更新。');
    const timer = setTimeout(() => setAssistantStatus(''), 5000);
    return () => clearTimeout(timer);
  }, [assistantRunActive, assistantSawStream, directorCardAssistantActive, streamingPhase]);

  const getStoryboardRefs = (): StoryboardRefItem[] => {
    const refs: StoryboardRefItem[] = [];
    for (const [idx, path] of getSceneReferencePaths(shot, scenes).entries()) {
      const scene = scenes.find((s) => s.id === shot.sceneId);
      refs.push({ label: `@图片${numToCn(refs.length + 1)}`, name: idx === 0 ? `场景：${scene?.name ?? '场景'}` : `场景角度 ${idx + 1}`, path, kind: 'scene', removable: true, removeKind: 'scene' });
    }
    for (const cid of (shot.characterIds ?? [])) {
      const c = characters.find((x) => x.id === cid);
      if (c?.assetImagePath) refs.push({ label: `@图片${numToCn(refs.length + 1)}`, name: `角色：${c.name}`, path: c.assetImagePath, kind: 'character', removable: true, removeKind: 'character', id: cid });
    }
    for (const pid of (shot.propIds ?? [])) {
      const p = props.find((x) => x.id === pid);
      if (p?.assetImagePath) refs.push({ label: `@图片${numToCn(refs.length + 1)}`, name: `道具：${p.name}`, path: p.assetImagePath, kind: 'prop', removable: true, removeKind: 'prop', id: pid });
    }
    for (const [idx, path] of (shot.extraRefImages ?? []).filter(Boolean).entries()) {
      refs.push({ label: `@图片${numToCn(refs.length + 1)}`, name: `额外参考 ${idx + 1}`, path, kind: 'extra', removable: true, removeKind: 'extra' });
    }
    const palette = colorPalettes.find((p) => p.id === (shot.colorPaletteId || globalColorPaletteId));
    if (palette?.assetImagePath) {
      refs.push({ label: `@图片${numToCn(refs.length + 1)}`, name: `色卡：${palette.name}`, path: palette.assetImagePath, kind: 'palette', removable: true, removeKind: 'palette', id: palette.id });
    }
    return refs;
  };
  const storyboardRefs = getStoryboardRefs();

  const currentStoryboardRefPaths = () => storyboardRefs.map((ref) => ref.path);

  const getLatestStoryboardFrames = () =>
    useWorkshopStore.getState().data?.shots.find((s) => s.shotNo === shot.shotNo)?.storyboardFrames ?? frames;

  const patchLatestShotRefs = (patch: Partial<WsShot>) => {
    const store = useWorkshopStore.getState();
    const d = store.data;
    const latestShot = d?.shots.find((s) => s.shotNo === shot.shotNo);
    if (!latestShot || !d) {
      store.updateShot(shot.shotNo, patch);
      void store.commitNow();
      return;
    }
    const ctx = { scenes: d.scenes, characters: d.characters, props: d.props ?? [], colorPalettes: d.colorPalettes ?? [], globalColorPaletteId: d.globalColorPaletteId };
    const nextShot = { ...latestShot, ...patch };
    const remapped = sharedRemapShotPromptRefs(latestShot, nextShot, ctx);
    store.updateShot(shot.shotNo, { ...remapped, ...patch });
    void store.commitNow();
  };

  const commitStoryboardFrames = (updater: (latest: StoryboardFrame[]) => StoryboardFrame[]) => {
    const store = useWorkshopStore.getState();
    const latest = store.data?.shots.find((s) => s.shotNo === shot.shotNo)?.storyboardFrames ?? frames;
    store.updateShot(shot.shotNo, { storyboardFrames: updater(latest) });
    void store.commitNow();
  };

  const commitStoryboardBoards = (updater: (latest: StoryboardBoard[]) => StoryboardBoard[]) => {
    const store = useWorkshopStore.getState();
    const d = store.data;
    const latestShot = d?.shots.find((s) => s.shotNo === shot.shotNo);
    const latest = latestShot?.storyboardBoards ?? boards;
    const patch: Partial<WsShot> = { storyboardBoards: updater(latest) };
    // 分镜板增删/useInVideo 切换会移动 @图片N 编号（板置于视频参考最前）——
    // 必须经 remap 重排视频提示词，否则正文编号指错素材（曾裸 updateShot 绕过）
    if (latestShot && d) {
      const ctx = { scenes: d.scenes, characters: d.characters, props: d.props ?? [], colorPalettes: d.colorPalettes ?? [], globalColorPaletteId: d.globalColorPaletteId };
      const remapped = sharedRemapShotPromptRefs(latestShot, { ...latestShot, ...patch }, ctx);
      const currentPrompt = remapped.videoPrompt ?? latestShot.videoPrompt ?? '';
      const hadPlanningPrefix = /^以(?:分镜[版板]|\s*@导演约束卡)/u.test(latestShot.videoPrompt ?? '');
      if (hadPlanningPrefix) {
        remapped.videoPrompt = applyVideoPlanningReferencePrefixes({ ...latestShot, ...patch }, currentPrompt);
      }
      store.updateShot(shot.shotNo, { ...remapped, ...patch });
    } else {
      store.updateShot(shot.shotNo, patch);
    }
    void store.commitNow();
  };

  const addStoryboardRefPath = async (path: string, placement: ReferencePlacementKind = 'extra') => {
    const latestShot = useWorkshopStore.getState().data?.shots.find((s) => s.shotNo === shot.shotNo) ?? shot;
    const allCurrent = new Set(currentStoryboardRefPaths());
    if (allCurrent.has(path)) return;
    patchLatestShotRefs(buildReferencePlacementPatch(latestShot, path, placement));
  };

  const addStoryboardAssetReference = (item: WorkshopAssetPickItem) => {
    const latestShot = useWorkshopStore.getState().data?.shots.find((s) => s.shotNo === shot.shotNo) ?? shot;
    const patch = buildWorkshopAssetReferencePatch(latestShot, item, scenes);
    if (patch) patchLatestShotRefs(patch);
  };

  const handleUploadStoryboardRef = async () => {
    const selected = await openDialog({ filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (!selected || Array.isArray(selected)) return;
    const absPath = await copyShotReferenceIntoProject(shot.shotNo, selected, 'upload');
    if (absPath) setPendingStoryboardRef({ path: absPath, title: '这张上传图片作为哪类故事板参考？' });
  };

  const handlePickStoryboardArtifact = async (entry: { path: string }) => {
    const absPath = await copyShotReferenceIntoProject(shot.shotNo, entry.path, 'artifact');
    if (absPath) setPendingStoryboardRef({ path: absPath, title: '这张产物作为哪类故事板参考？' });
    setPickerOpen(false);
  };

  const handlePickWorkshopAsset = async (item: WorkshopAssetPickItem) => {
    addStoryboardAssetReference(item);
    setAssetPickerOpen(false);
  };

  const storyboardPromptRefs: PromptRefItem[] = storyboardRefs.map((ref) => ({
    label: ref.label,
    url: convertFileSrc(ref.path),
    path: ref.path,
    removable: ref.removable,
    removeKind: ref.removeKind,
    id: ref.id,
  }));

  const canMoveStoryboardRef = (ref: PromptRefItem, dir: -1 | 1) => {
    const latestShot = useWorkshopStore.getState().data?.shots.find((s) => s.shotNo === shot.shotNo) ?? shot;
    if (ref.removeKind === 'scene') {
      const list = getSceneReferencePaths(latestShot, scenes);
      const idx = list.indexOf(ref.path ?? '');
      return idx >= 0 && idx + dir >= 0 && idx + dir < list.length;
    }
    if (ref.removeKind === 'character' && ref.id) {
      const idx = (latestShot.characterIds ?? []).indexOf(ref.id);
      return idx >= 0 && idx + dir >= 0 && idx + dir < (latestShot.characterIds ?? []).length;
    }
    if (ref.removeKind === 'prop' && ref.id) {
      const idx = (latestShot.propIds ?? []).indexOf(ref.id);
      return idx >= 0 && idx + dir >= 0 && idx + dir < (latestShot.propIds ?? []).length;
    }
    if (ref.removeKind === 'extra' && ref.path) {
      const idx = (latestShot.extraRefImages ?? []).indexOf(ref.path);
      return idx >= 0 && idx + dir >= 0 && idx + dir < (latestShot.extraRefImages ?? []).length;
    }
    return false;
  };

  const moveStoryboardRefAsset = (ref: PromptRefItem, dir: -1 | 1) => {
    const latestShot = useWorkshopStore.getState().data?.shots.find((s) => s.shotNo === shot.shotNo) ?? shot;
    if (ref.removeKind === 'scene') {
      const list = [...getSceneReferencePaths(latestShot, scenes)];
      const idx = list.indexOf(ref.path ?? '');
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= list.length) return;
      [list[idx], list[to]] = [list[to], list[idx]];
      patchLatestShotRefs({ sceneImagePaths: list, promptNeedsRefresh: true });
      return;
    }
    if (ref.removeKind === 'character' && ref.id) {
      const list = [...(latestShot.characterIds ?? [])];
      const idx = list.indexOf(ref.id);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= list.length) return;
      [list[idx], list[to]] = [list[to], list[idx]];
      patchLatestShotRefs({ characterIds: list, promptNeedsRefresh: true });
      return;
    }
    if (ref.removeKind === 'prop' && ref.id) {
      const list = [...(latestShot.propIds ?? [])];
      const idx = list.indexOf(ref.id);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= list.length) return;
      [list[idx], list[to]] = [list[to], list[idx]];
      patchLatestShotRefs({ propIds: list, promptNeedsRefresh: true });
      return;
    }
    if (ref.removeKind === 'extra' && ref.path) {
      const list = [...(latestShot.extraRefImages ?? [])];
      const idx = list.indexOf(ref.path);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= list.length) return;
      [list[idx], list[to]] = [list[to], list[idx]];
      patchLatestShotRefs({ extraRefImages: list, promptNeedsRefresh: true });
    }
  };

  const patchFrame = (frameId: string, patch: Partial<StoryboardFrame>) => {
    commitStoryboardFrames((latest) =>
      latest.map((frame) => frame.id === frameId
        ? { ...frame, ...patch, revision: (frame.revision ?? 0) + 1 }
        : frame),
    );
  };

  const latestShotContext = () => {
    const store = useWorkshopStore.getState();
    const data = store.data;
    const latestShot = data?.shots.find((item) => item.shotNo === shot.shotNo) ?? shot;
    return {
      latestShot,
      ctx: {
        scenes: data?.scenes ?? scenes,
        characters: data?.characters ?? characters,
        props: data?.props ?? props,
        colorPalettes: data?.colorPalettes ?? colorPalettes,
        globalColorPaletteId: data?.globalColorPaletteId ?? globalColorPaletteId,
      },
    };
  };

  const frameReferenceBindings = (frame: StoryboardFrame) => {
    const { latestShot, ctx } = latestShotContext();
    return buildStoryboardFrameRefBindings(latestShot, frame, ctx);
  };

  const setFrameDirectorConstraint = (frame: StoryboardFrame, enabled: boolean) => {
    const { latestShot, ctx } = latestShotContext();
    if (enabled && !latestShot.directorConstraintCard?.imagePath) return;
    const nextFrame = { ...frame, useDirectorConstraintCard: enabled };
    const refs = buildStoryboardFrameRefBindings(latestShot, nextFrame, ctx);
    const cardRef = refs.find((ref) => ref.kind === 'directorConstraintCard');
    patchFrame(frame.id, {
      useDirectorConstraintCard: enabled && Boolean(cardRef),
      refImagePaths: refs.map((ref) => ref.path),
      prompt: cardRef
        ? ensureDirectorConstraintMention(frame.prompt, cardRef.index)
        : stripDirectorConstraintMention(frame.prompt),
    });
  };

  const setAllFramesDirectorConstraint = (enabled: boolean) => {
    const { latestShot, ctx } = latestShotContext();
    if (enabled && !latestShot.directorConstraintCard?.imagePath) return;
    commitStoryboardFrames((latest) => latest.map((frame) => {
      const nextFrame = { ...frame, useDirectorConstraintCard: enabled };
      const refs = buildStoryboardFrameRefBindings(latestShot, nextFrame, ctx);
      const cardRef = refs.find((ref) => ref.kind === 'directorConstraintCard');
      return {
        ...nextFrame,
        useDirectorConstraintCard: enabled && Boolean(cardRef),
        refImagePaths: refs.map((ref) => ref.path),
        prompt: cardRef
          ? ensureDirectorConstraintMention(frame.prompt, cardRef.index)
          : stripDirectorConstraintMention(frame.prompt),
        revision: (frame.revision ?? 0) + 1,
      };
    }));
  };

  const commitDirectorConstraintCard = (card?: DirectorConstraintCard) => {
    const latest = getLatestStoryboardFrames();
    patchLatestShotRefs({
      directorConstraintCard: card,
      ...(card ? {} : {
        storyboardFrames: latest.map((frame) => ({
          ...frame,
          useDirectorConstraintCard: false,
          prompt: stripDirectorConstraintMention(frame.prompt),
          refImagePaths: currentStoryboardRefPaths(),
          revision: (frame.revision ?? 0) + 1,
        })),
      }),
    });
  };

  const setDirectorCardFromPath = (path: string, source: DirectorConstraintCard['source'], prompt?: string) => {
    const latestCard = latestShotContext().latestShot.directorConstraintCard;
    const candidate: AssetCandidate = {
      path,
      source: source === 'artifact' ? 'artifact' : source === 'generate' ? 'generate' : source === 'canvas' ? 'canvas' : 'upload',
      prompt,
      createdAt: Date.now(),
    };
    commitDirectorConstraintCard({
      id: latestCard?.id ?? `director-card-${shot.shotNo}-${nanoid(8)}`,
      imagePath: path,
      prompt: prompt ?? latestCard?.prompt,
      createdAt: latestCard?.createdAt ?? Date.now(),
      source,
      useInVideo: latestCard?.useInVideo ?? false,
      candidates: [...(latestCard?.candidates ?? []), candidate],
    });
  };

  const uploadDirectorConstraintCard = async () => {
    const selected = await openDialog({ filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (!selected || Array.isArray(selected)) return;
    const absPath = await copyShotReferenceIntoProject(shot.shotNo, selected, 'upload');
    if (absPath) setDirectorCardFromPath(absPath, 'upload');
  };

  const pickDirectorConstraintArtifact = async (entry: { path: string }) => {
    const absPath = await copyShotReferenceIntoProject(shot.shotNo, entry.path, 'artifact');
    if (absPath) setDirectorCardFromPath(absPath, 'artifact');
    setConstraintPickerOpen(false);
  };

  const generateDirectorConstraintCard = async () => {
    const { latestShot, ctx } = latestShotContext();
    // 约束卡只借用场景图理解空间。人物、道具、色卡图会诱导模型渲染具体外观，
    // 与“素模站位图”的职责冲突，因此只以文字提供名称和关系。
    const sceneRefs = storyboardRefs.filter((ref) => ref.kind === 'scene');
    const refs = sceneRefs.map((ref) => ref.path);
    if (refs.length === 0) {
      await tauriMessage('请先准备至少一张场景参考图。导演约束卡只读取场景空间，不会传入人物、道具或色卡图片。', { title: '导演约束卡' });
      return;
    }
    setConstraintBusy(true);
    try {
      const referenceOrder = sceneRefs.map((ref, index) => `@图片${numToCn(index + 1)}=${ref.name}`).join('；');
      const characterNames = (latestShot.characterIds ?? [])
        .map((id) => ctx.characters.find((item) => item.id === id)?.name)
        .filter(Boolean)
        .join('、') || '无明确人物';
      const propNames = (latestShot.propIds ?? [])
        .map((id) => ctx.props.find((item) => item.id === id)?.name)
        .filter(Boolean)
        .join('、') || '无关键道具';
      const prompt = `为分镜 ${latestShot.shotNo} 生成一张专业“导演约束卡”，16:9 单张设计图。剧情：${latestShot.description}。
场景空间参考：${referenceOrder}。只读取参考图中的建筑、家具、门窗、桌椅、通道和空间轴线；忽略参考图里可能出现的任何真人、服装和人物外观。
人物名称：${characterNames}。关键道具名称：${propNames}。人物和道具仅依据剧情关系以文字标签表达，没有传入人物图或道具图。
画面左侧约 70% 是简洁灰白素模的透视空间走位图：人物必须是无五官、无发型、无服装细节的中性灰色人形占位模型，仅用姓名标签区分；道具只用简化几何体和名称标签，不渲染真实纹理；显示 2-4 个摄影机图标、镜头朝向和人物动线。画面右侧约 30% 是动作关系卡：只写短标签，说明人物起点、终点、视线、手部与关键道具关系、允许变化和禁止漂移项。不要生成具体演员面孔，不要生成古装或真实服装，不要把人物锁成僵硬精确姿势，不要做俯视平面图，不要复刻真实场景材质，不要出现长段文字。整体像专业电影预演部门的导演工作图，信息清楚、层级克制。`;
      const result = await runGeneration({
        engineId: 'gpt-image-2',
        prompt,
        referenceUrls: refs,
        params: { aspectRatio: '16:9', resolution: '2k' },
        workshopShotNo: shot.shotNo,
        workshopShotKind: 'image',
        projectId: useWorkshopStore.getState().data?.projectId,
      });
      if (!result.success || !result.resultPaths[0]) throw new Error(result.error || '没有返回图片');
      setDirectorCardFromPath(result.resultPaths[0], 'generate', prompt);
    } catch (err) {
      await tauriMessage(`导演约束卡生成失败：${err instanceof Error ? err.message : String(err)}`, { title: '导演约束卡' });
    } finally {
      setConstraintBusy(false);
    }
  };

  const selectDirectorCardForAssistant = () => {
    if (!directorCard?.imagePath) return;
    setDirectorCardAssistantActive(true);
    setActiveFrameIndex(null);
    setAssistantStatus('已选中导演约束卡。请告诉 AI 要怎样修改提示词。');
    requestAnimationFrame(() => assistantInputRef.current?.focus());
  };

  const appendStoryboardRow = () => {
    const latest = getLatestStoryboardFrames();
    const startIndex = latest.length;
    const refImagePaths = currentStoryboardRefPaths();
    const additions: StoryboardFrame[] = Array.from({ length: 4 }, (_, i) => ({
      id: `story-${shot.shotNo}-${Date.now()}-${startIndex + i + 1}-${nanoid(6)}`,
      prompt: '',
      refImagePaths,
      selected: true,
      status: 'idle',
    }));
    commitStoryboardFrames((current) => [...current, ...additions]);
    setActiveFrameIndex(startIndex);
    setAssistantStatus(`已新增第 ${startIndex + 1}-${startIndex + additions.length} 张空分镜。可以让 AI 助手继续补写这些提示词。`);
  };

  const askAgentForFrames = async () => {
    const styleSection = await buildStyleSection({ includeMidjourney: false });
    writingInitialSig.current = frameSignature;
    setStoryboardWriting(true);
    setAssistantRunActive(true);
    setAssistantSawStream(false);
    setAssistantStatus(`已发送：准备为 ${shot.shotNo} 创作 8 张故事板提示词。`);
    const referenceOrderText = storyboardRefs.length
      ? storyboardRefs.map((ref) => `${ref.label}=${ref.name}`).join('\n')
      : '暂无 @图片N 资产。请先提醒用户补齐场景/角色资产，不要凭空写 @图片编号。';
    const sceneLabels = storyboardRefs.filter((ref) => ref.kind === 'scene').map((ref) => ref.label).join('、') || '@图片一';
    const characterLabels = storyboardRefs.filter((ref) => ref.kind === 'character').map((ref) => `${ref.name.replace(/^角色：/, '')}${ref.label}`).join('、') || '无角色参考';
    const directorCardText = directorCard?.imagePath
      ? `本镜已有可选的“导演约束卡”。它不会默认传入。只有确实需要锁定人物站位、视线、机位或动作关系的格子，才在 frames 对应项传 use_director_constraint_card:true；启用后提示词必须明确写“@导演约束卡”，工具会同时补入对应 @图片N。`
      : '本镜目前没有导演约束卡，不要虚构或引用 @导演约束卡。';
    dispatchWorkshopPrompt(`请为工坊分镜 ${shot.shotNo} 创作高清故事板提示词。注意：这一步只写 8 张分镜图的生图提示词，不直接生成图片；写完后我会手动选择是否生成。

请先调用 workshop_get_state detail:"step" 查看该镜 storyboardReferenceOrder、角色、场景、对白、imagePrompt、videoPrompt 和 bibles，然后调用 workshop_set_storyboard_prompts 写入 8 条 frames。

## 本镜高清故事板专用参考顺序
${referenceOrderText}

注意：这是故事板生图专用顺序，不要使用普通视频生成里的 referenceOrder；不要从 @图片二 开始。场景参考必须从 @图片一 开始。

## 当前风格预设/导演规范
${styleSection || '未设置通用风格时，请继承项目四圣经中的导演、角色、场景和连续性规范，并根据本镜剧情选择统一的电影摄影风格。'}

故事板不使用 Midjourney 专属风格库、风格化参数或 MJ 提示词后缀。即使项目资产选择了 Midjourney，也只继承剧情、角色、场景和连续性，不套用 MJ 风格。

## 导演约束卡
${directorCardText}

要求：
1. 先理解剧情目的：这一镜要表达的信息、情绪转折、人物关系和动作重点，不要机械套"建立/中景/特写"模板。
2. 8 张要像专业导演分镜板：每张承担不同叙事功能，可以是建立空间、人物关系、动作预备、关键表演、手部/道具、反应、环境反馈、尾帧，但要按本镜剧情重新排序和命名。
3. 每条都是单张独立电影剧照提示词，不要写 2x2 拼图，不要写连续视频运动。
4. 每条必须显式引用场景参考 ${sceneLabels}；不能漏掉 @图片一。有人物时，人物名后紧跟对应编号：${characterLabels}。
5. 这是静态图片提示词，不是 Seedance 视频提示词。禁止写台词、对白、字幕、旁白、音效、环境音、音乐、BGM；禁止使用 {}、<>、（）来标注声音或台词。
6. 推荐格式：第N格：${sceneLabels}，人物名@图片N，景别、构图、主体站位、光源方向、色温、材质细节、表演瞬间、空间层次。
7. 每条必须继承当前风格预设/导演规范。人物出镜时必须强调复刻参考图人物脸、发型、服装、五官比例和年龄状态，但不要写成空泛口号。
8. 不要写"电影感十足"、"氛围拉满"、"高级质感"这类空词；用具体镜头语言替代。表演瞬间必须克制真实、有行为目的（能看出角色此刻想隐藏/确认/靠近/疏远什么），默认禁止瞪眼、嘶吼、夸张张嘴、邪魅坏笑等 AI 短剧/漫剧风表情。
9. 输出 frames 时每条 prompt 建议 100-220 中文字，必须可直接送去 gpt-image-2 生图。`);
  };

  const askAssistantToEditFrame = () => {
    const instruction = assistantText.trim();
    if (!instruction) return;
    const referenceOrderText = storyboardRefs.length
      ? storyboardRefs.map((ref) => `${ref.label}=${ref.name}`).join('\n')
      : '暂无 @图片N 资产。请先提醒用户补齐场景/角色资产，不要凭空写 @图片编号。';
    const currentPrompts = frames
      .map((frame, i) => `第${i + 1}张：${frame.prompt || '（空）'}`)
      .join('\n\n');

    setAssistantRunActive(true);
    setAssistantSawStream(false);
    if (directorCardAssistantActive) {
      if (!directorCard?.imagePath) return;
      setAssistantStatus(`已发送：准备修改 ${shot.shotNo} 的导演约束卡提示词。`);
      dispatchWorkshopPrompt(`请帮我修改工坊分镜 ${shot.shotNo} 的导演约束卡提示词。

用户具体要求：${instruction}

请先调用 workshop_get_state detail:"step" 确认本镜剧情、人物名称、道具名称和导演约束卡状态，然后只调用 workshop_update_director_constraint_prompt 写回完整 prompt。不要修改单格故事板提示词，不要替换图片，也不要重新生成图片。

## 当前导演约束卡提示词
${directorCard.prompt?.trim() || '（当前为空，请根据本镜剧情补写）'}

改写要求：
1. 约束卡只使用场景图理解空间；人物、道具、色卡图片不会传入。不得要求复刻具体人物面孔、发型、服装或真实道具纹理。
2. 人物必须描述为无五官、无发型、无服装细节的中性灰色人形占位模型，用人物姓名标签区分。
3. 道具使用简化几何体和名称标签；重点写清人物站位、起终点、视线、机位、镜头朝向、人物动线、手部与道具关系。
4. 输出应是透视空间走位图加动作关系卡，不是正交俯视图，不是正式渲染分镜，也不要用长段说明文字。
5. 保留用户提出的有效调整，返回一条可直接用于重新生成导演约束卡的完整提示词。`);
    } else if (activeFrameIndex === null) {
      setAssistantStatus(`已发送：准备整体修改 ${shot.shotNo} 的 ${frameCount} 张故事板提示词。`);
      dispatchWorkshopPrompt(`请帮我整体修改工坊分镜 ${shot.shotNo} 的高清故事板提示词。

用户具体要求：${instruction}

请先调用 workshop_get_state detail:"step" 确认当前项目和该镜信息，然后调用 workshop_update_storyboard_frame_prompts，按当前已有格子数量一次性传入需要修改的 updates。不要调用 workshop_set_storyboard_prompts，因为那会覆盖已生成图片。

## 本镜故事板专用参考顺序
${referenceOrderText}

## 当前 ${frameCount} 张提示词快照
${currentPrompts}

改写要求：
1. 把当前 ${frameCount} 张作为一组连续导演分镜来改，不要机械重复同一构图。
2. 每张都必须沿用本镜参考顺序中的 @图片N；场景参考不能漏，人物出镜时人物名后紧跟对应 @图片N。
3. 这是静态图片提示词，禁止写台词、对白、字幕、旁白、音效、环境音、音乐、BGM；禁止用 {}、<>、（）写声音或台词。
4. 保留每一格的叙事分工和前后连续性，按用户要求统一调整风格、构图、光线、表演或节奏。
5. 调用 workshop_update_storyboard_frame_prompts 时，updates 里 index 从 1 开始；没必要改的格子也可以保留原 prompt 后写回，以保证整体一致。
6. 故事板不使用 Midjourney 专属风格库、风格化参数或 MJ 提示词后缀。即使项目资产选择了 Midjourney，也只继承剧情、角色、场景、导演约束卡和连续性，不套用 MJ 风格。`);
    } else {
      const targetIndex = Math.min(Math.max(activeFrameIndex + 1, 1), Math.max(frames.length, 1));
      const targetFrame = frames[targetIndex - 1];
      setAssistantStatus(`已发送：准备修改第 ${targetIndex} 张故事板提示词。`);
      dispatchWorkshopPrompt(`请帮我修改工坊分镜 ${shot.shotNo} 的高清故事板提示词。

用户要改的是：第 ${targetIndex} 张。
用户具体要求：${instruction}

请先调用 workshop_get_state detail:"step" 确认当前项目和该镜信息，然后调用 workshop_update_storyboard_frame_prompts，只修改第 ${targetIndex} 张，不要覆盖其它分镜，不要删除已生成图片。

## 本镜故事板专用参考顺序
${referenceOrderText}

## 当前第 ${targetIndex} 张提示词
${targetFrame?.prompt || '（空）'}

## 当前 ${frameCount} 张提示词快照
${currentPrompts}

改写要求：
1. 只输出并写回第 ${targetIndex} 张的完整 prompt。
2. 必须沿用本镜参考顺序中的 @图片N；场景参考不能漏，人物出镜时人物名后紧跟对应 @图片N。
3. 这是静态图片提示词，禁止写台词、对白、字幕、旁白、音效、环境音、音乐、BGM；禁止用 {}、<>、（）写声音或台词。
4. 保留本镜剧情连续性，不要把它改成和前后格断裂的新故事。
5. 根据用户要求具体修改构图、景别、表演、光线、材质或情绪，不要写空泛形容词。
6. 故事板不使用 Midjourney 专属风格库、风格化参数或 MJ 提示词后缀。即使项目资产选择了 Midjourney，也只继承剧情、角色、场景、导演约束卡和连续性，不套用 MJ 风格。`);
    }
    setAssistantText('');
  };

  const generateFrame = async (frame: StoryboardFrame, options?: { keepStatus?: boolean; silentStatus?: boolean }) => {
    if (!frame.prompt.trim()) return;
    if (!options?.silentStatus) setBusyId(frame.id);
    const frameIndex = getLatestStoryboardFrames().findIndex((item) => item.id === frame.id);
    if (!options?.silentStatus) setGenerationStatus(`正在生成第 ${frameIndex >= 0 ? frameIndex + 1 : ''} 张分镜图…`);
    patchFrame(frame.id, { status: 'generating', error: undefined });
    try {
      const latestFrameAtStart = getLatestStoryboardFrames().find((item) => item.id === frame.id) ?? frame;
      const { latestShot, ctx } = latestShotContext();
      const compacted = compactStoryboardFrameReferences(latestShot, latestFrameAtStart, ctx);
      const bindings = compacted.bindings;
      const cardRef = bindings.find((ref) => ref.kind === 'directorConstraintCard');
      const generationPrompt = cardRef
        ? ensureDirectorConstraintMention(compacted.prompt, cardRef.index)
        : stripDirectorConstraintMention(compacted.prompt);
      const result = await runGeneration({
        engineId: storyboardEngine,
        prompt: generationPrompt,
        referenceUrls: bindings.map((ref) => ref.path),
        params: { aspectRatio: storyboardRatio, resolution: storyboardResolution },
        workshopShotNo: shot.shotNo,
        workshopShotKind: 'image',
        workshopStoryboardFrameId: frame.id,
        projectId: useWorkshopStore.getState().data?.projectId,
      });
      if (!result.success || !result.resultPaths[0]) throw new Error(result.error || '没有返回图片');
      const latestFrame = useWorkshopStore.getState().data?.shots
        .find((s) => s.shotNo === shot.shotNo)?.storyboardFrames
        ?.find((item) => item.id === frame.id) ?? frame;
      patchFrame(frame.id, {
        imagePath: result.resultPaths[0],
        prompt: generationPrompt,
        refImagePaths: bindings.map((ref) => ref.path),
        candidates: appendStoryboardCandidate(latestFrame, result.resultPaths[0], generationPrompt, storyboardEngine),
        status: 'done',
        error: undefined,
      });
    } catch (err) {
      patchFrame(frame.id, { status: 'failed', error: err instanceof Error ? err.message : String(err) });
    } finally {
      if (!options?.silentStatus) setBusyId(null);
      if (!options?.keepStatus) setGenerationStatus('');
    }
  };

  const generateSelected = async () => {
    const targets = getLatestStoryboardFrames().filter((frame) => frame.selected !== false);
    if (targets.length === 0) {
      await tauriMessage('请先选择要生成的分镜格', { title: '高清故事板' });
      return;
    }
    setBatchBusy(true);
    let completed = 0;
    setGenerationStatus(`并行生成中 · 0/${targets.length} 已完成`);
    try {
      await Promise.allSettled(targets.map(async (frame) => {
        await generateFrame(frame, { keepStatus: true, silentStatus: true });
        completed += 1;
        setGenerationStatus(`并行生成中 · ${completed}/${targets.length} 已完成`);
      }));
    } finally {
      setBatchBusy(false);
      setGenerationStatus('');
    }
  };

  const sendFrameToCanvas = async (frame: StoryboardFrame) => {
    setCanvasSendingId(frame.id);
    try {
      const result = await sendStoryboardFrameToCanvas(shot.id ?? shot.shotNo, frame.id);
      await tauriMessage(`已把这张分镜的图片、提示词和 ${result.referenceCount} 个对应资产一起送入画布，并完成全部连线。画布生成新图后可直接“回传本格”。`, {
        title: '已传入画布',
      });
      onClose();
      useChatStore.getState().setActiveView('canvas');
    } catch (err) {
      await tauriMessage(`传入画布失败：${err instanceof Error ? err.message : String(err)}`, { title: '高清故事板' });
    } finally {
      setCanvasSendingId(null);
    }
  };

  const composeSelected = async () => {
    const selected = getLatestStoryboardFrames().filter((frame) => frame.selected !== false && frame.imagePath);
    if (selected.length < 4) {
      await tauriMessage('至少选择 4 张已生成图片，才能拼成 2x2 分镜板', { title: '高清故事板' });
      return;
    }
    setComposeBusy(true);
    try {
      const newBoards: StoryboardBoard[] = [];
      for (let i = 0; i + 3 < selected.length; i += 4) {
        const group = selected.slice(i, i + 4);
        const imagePath = await composeStoryboardBoard(group.map((frame) => frame.imagePath!), effectiveRatio);
        newBoards.push({
          id: `board-${shot.shotNo}-${Date.now()}-${i / 4 + 1}`,
          frameIds: group.map((frame) => frame.id),
          imagePath,
          createdAt: Date.now(),
          useInVideo: true,
        });
      }
      commitStoryboardBoards((latest) => [...latest, ...newBoards]);
      const leftover = selected.length % 4;
      if (leftover > 0) {
        await tauriMessage(`已拼合 ${newBoards.length} 块分镜板；剩余 ${leftover} 张不足 4 张未拼合，可补选图片后再拼。`, { title: '高清故事板' });
      }
    } catch (err) {
      await tauriMessage(`拼合失败：${err instanceof Error ? err.message : String(err)}`, { title: '高清故事板' });
    } finally {
      setComposeBusy(false);
    }
  };

  const injectToVideoPrompt = () => {
    const store = useWorkshopStore.getState();
    const d = store.data;
    const latestShot = d?.shots.find((s) => s.shotNo === shot.shotNo) ?? shot;
    const hasPlanningAsset = (latestShot.storyboardBoards ?? []).some((board) => board.imagePath && board.useInVideo !== false)
      || Boolean(latestShot.directorConstraintCard?.imagePath && latestShot.directorConstraintCard.useInVideo === true);
    if (!hasPlanningAsset) return;
    if (!d) {
      onPatch({ videoPrompt: applyVideoPlanningReferencePrefixes(latestShot, latestShot.videoPrompt) });
      return;
    }
    const ctx = { scenes: d.scenes, characters: d.characters, props: d.props ?? [], colorPalettes: d.colorPalettes ?? [], globalColorPaletteId: d.globalColorPaletteId };
    const withoutPlanningAssets = {
      ...latestShot,
      storyboardBoards: [],
      directorConstraintCard: latestShot.directorConstraintCard
        ? { ...latestShot.directorConstraintCard, useInVideo: false }
        : undefined,
    };
    const remapped = sharedRemapShotPromptRefs(withoutPlanningAssets, latestShot, ctx);
    onPatch({ videoPrompt: applyVideoPlanningReferencePrefixes(latestShot, remapped.videoPrompt ?? latestShot.videoPrompt) });
  };

  const moveStoryboardBoard = (boardId: string, dir: -1 | 1) => {
    commitStoryboardBoards((latest) => {
      const idx = latest.findIndex((board) => board.id === boardId);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= latest.length) return latest;
      const next = [...latest];
      [next[idx], next[to]] = [next[to], next[idx]];
      return next;
    });
  };

  const moveStoryboardFrame = (frameId: string, dir: -1 | 1) => {
    commitStoryboardFrames((latest) => {
      const idx = latest.findIndex((frame) => frame.id === frameId);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= latest.length) return latest;
      const next = [...latest];
      [next[idx], next[to]] = [next[to], next[idx]];
      setActiveFrameIndex(to);
      return next;
    });
  };

  const deleteStoryboardFrame = (frameId: string) => {
    commitStoryboardFrames((latest) => latest.filter((frame) => frame.id !== frameId));
    commitStoryboardBoards((latest) =>
      latest
        .map((board) => ({ ...board, frameIds: board.frameIds.filter((id) => id !== frameId) }))
        .filter((board) => board.frameIds.length > 0),
    );
    setActiveFrameIndex((idx) => {
      if (idx === null) return null;
      const nextLength = Math.max(0, getLatestStoryboardFrames().length - 1);
      return nextLength === 0 ? null : Math.min(idx, nextLength - 1);
    });
  };

  const assistantPhaseText = (() => {
    if (streamingPhase === 'waiting') return '等待模型响应';
    if (streamingPhase === 'thinking') return '整理修改方案';
    if (streamingPhase === 'processing') return streamingToolName ? `正在执行：${streamingToolName}` : '正在写回修改';
    if (streamingPhase === 'streaming') return '正在生成回复';
    return assistantStatus || '空闲';
  })();
  const candidateFrame = candidateFrameId ? frames.find((frame) => frame.id === candidateFrameId) : null;
  const candidateList = candidateFrame ? storyboardFrameCandidates(candidateFrame) : [];
  const candidateCurrent = candidatePreview ?? candidateFrame?.imagePath ?? candidateList[0]?.path ?? null;
  const selectStoryboardCandidate = (path: string) => {
    if (!candidateFrame) return;
    // candidates 必须从 store 最新态计算——candidateFrame 是渲染期快照，
    // 弹窗打开期间并行生成追加的新候选会被陈旧快照整组覆盖丢失
    const latestFrame = getLatestStoryboardFrames().find((f) => f.id === candidateFrame.id) ?? candidateFrame;
    patchFrame(candidateFrame.id, {
      imagePath: path,
      candidates: storyboardFrameCandidates(latestFrame),
      status: 'done',
      error: undefined,
    });
    setCandidatePreview(null);
  };

  const candidateModal = candidateFrame ? (
    <div
      className="canvas-dark fixed inset-0 flex items-center justify-center text-[var(--canvas-text-1)]"
      style={{ background: 'rgba(0,0,0,0.6)', zIndex: Z.modalStack }}
      onMouseDown={() => {
        setCandidateFrameId(null);
        setCandidatePreview(null);
      }}
    >
      <div
        className="relative w-[760px] max-w-[92vw] max-h-[86vh] rounded-2xl border border-[var(--canvas-node-border)] bg-[var(--canvas-panel)] overflow-hidden flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--canvas-node-border)] shrink-0">
          <div>
            <span className="text-[14px] font-medium text-[var(--canvas-text-1)]">分镜候选图</span>
            <span className="ml-2 text-[11px] text-[var(--canvas-text-3)]">
              {candidateList.length} 个候选 · 点击缩略图切换 · 双击设为最终图
            </span>
          </div>
          <button
            onClick={() => {
              setCandidateFrameId(null);
              setCandidatePreview(null);
            }}
            className="p-1.5 rounded-md text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] transition-colors"
          >
            <X size={15} />
          </button>
        </div>
        <div className="flex-1 min-h-0 flex items-center justify-center bg-black/40 relative" style={{ minHeight: 320 }}>
          {candidateCurrent ? (
            <>
              <img src={convertFileSrc(candidateCurrent)} alt="" decoding="async" className="max-w-full object-contain" style={{ maxHeight: '52vh' }} />
              <button
                onClick={() => setFullscreen(convertFileSrc(candidateCurrent))}
                className="absolute top-3 right-3 p-2 rounded-lg bg-black/60 text-white hover:bg-black/80 transition-colors"
                title="全屏查看"
              >
                <Maximize2 size={14} />
              </button>
              {candidateCurrent === candidateFrame.imagePath && (
                <span className="absolute top-3 left-3 px-2 py-1 rounded-lg bg-[var(--canvas-success)] text-white text-[10px] flex items-center gap-1">
                  <Check size={10} /> 当前最终图
                </span>
              )}
              {candidateCurrent !== candidateFrame.imagePath && (
                <button
                  onClick={() => selectStoryboardCandidate(candidateCurrent)}
                  className="absolute bottom-3 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-lg text-white text-[12px] transition-opacity hover:opacity-90"
                  style={{ background: 'var(--canvas-accent)' }}
                >
                  设为最终图
                </button>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 text-[var(--canvas-text-3)] py-16">
              <ImagePlus size={28} />
              <span className="text-[12px]">还没有候选图，先生成一张</span>
            </div>
          )}
        </div>
        {candidateList.length > 0 && (
          <div className="flex gap-2 px-4 py-3 overflow-x-auto border-t border-[var(--canvas-node-border)] shrink-0">
            {candidateList.map((candidate, index) => (
              <button
                key={candidate.path}
                onClick={() => setCandidatePreview(candidate.path)}
                onDoubleClick={() => selectStoryboardCandidate(candidate.path)}
                className="relative shrink-0 rounded-lg overflow-hidden transition-all"
                style={{
                  width: 72,
                  height: 72,
                  border: candidate.path === candidateFrame.imagePath
                    ? '2px solid var(--canvas-success)'
                    : candidate.path === candidateCurrent ? '2px solid var(--canvas-accent)' : '2px solid transparent',
                }}
                title={`${candidate.source}${candidate.engineId ? ` · ${candidate.engineId}` : ''}`}
              >
                <img src={convertFileSrc(candidate.path)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                <span className="absolute left-0.5 bottom-0.5 px-1 rounded bg-black/60 text-white text-[10px]">
                  候选 {index + 1}
                </span>
                {candidate.path === candidateFrame.imagePath && (
                  <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-[var(--canvas-success)] flex items-center justify-center">
                    <Check size={9} className="text-white" />
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  ) : null;

  const modal = (
    <div
      className="canvas-dark fixed inset-0 flex items-center justify-center px-6 py-6 text-[var(--canvas-text-1)]"
      style={{ background: 'rgba(0,0,0,0.6)', zIndex: Z.modal }}
      onMouseDown={onClose}
    >
      <div
        className="w-[min(1180px,96vw)] max-h-[90vh] rounded-2xl border shadow-2xl overflow-hidden flex flex-col"
        style={{ background: 'var(--canvas-panel)', borderColor: 'var(--canvas-node-border)', boxShadow: '0 24px 80px rgba(0,0,0,0.55)' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b flex items-start justify-between gap-4" style={{ borderColor: 'var(--canvas-node-border)', background: 'var(--canvas-panel-elevated)' }}>
          <div>
              <div className="flex flex-wrap items-center gap-2">
                <Grid2X2 size={16} className="text-[var(--canvas-accent)]" />
                <h3 className="text-[14px] font-semibold text-[var(--canvas-text-1)]">高清故事板 · {shot.shotNo}</h3>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[rgba(255,255,255,0.06)] text-[var(--canvas-text-3)]">{storyboardEngine === 'seedream-v5-pro' ? '豆包' : 'GPT'} · {storyboardRatio} · {storyboardResolution.toUpperCase()}</span>
            </div>
            <p className="mt-1 text-[11px] text-[var(--canvas-text-3)]">默认 8 张单帧分镜图，可每次追加 4 张 → 选图 → 每 4 张拼成 2x2 分镜板 → 一键写入视频提示词参考。</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const projectId = useWorkshopStore.getState().project?.id;
                if (!projectId) return;
                onClose();
                openWorkshopDirector(shot, characters, projectId, 'storyboard');
              }}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--canvas-node-border)] px-3 text-[11px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)]"
            >
              <Clapperboard size={12} /> 白模预演
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-1)] hover:bg-[rgba(255,255,255,0.06)]">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="p-5 overflow-y-auto">
          <div className="mb-4">
            <ImageGenerationSettings
              engine={storyboardEngine}
              engineOptions={STORYBOARD_ENGINES}
              onEngineChange={(engine) => {
                setStoryboardEngine(engine as 'gpt-image-2' | 'seedream-v5-pro');
              }}
              ratio={storyboardRatio}
              ratioOptions={storyboardRatioOptions}
              onRatioChange={setStoryboardRatio}
              resolution={storyboardResolution}
              resolutionOptions={storyboardResolutionOptions}
              onResolutionChange={setStoryboardResolution}
            />
          </div>
          <div className="mb-4 rounded-xl border border-[var(--canvas-node-border)] bg-[var(--canvas-node-bg)] p-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Sparkles size={14} className="text-[var(--canvas-accent)]" />
                  <div className="text-[12px] font-medium text-[var(--canvas-text-1)]">AI 助手</div>
                  <span className="rounded-full border border-[rgba(255,255,255,0.08)] bg-black/20 px-2 py-0.5 text-[10px] text-[var(--canvas-text-3)]">
                    共享当前项目对话记忆
                  </span>
                  {(frames.length > 0 || directorCardAssistantActive) && (
                    <span className="rounded-full border border-[rgba(45,177,255,0.22)] bg-[rgba(45,177,255,0.10)] px-2 py-0.5 text-[10px] text-[var(--canvas-accent)]">
                      {assistantTargetLabel}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[10px] leading-relaxed text-[var(--canvas-text-3)]">
                  让 AI 先理解本镜剧情、项目风格和已有资产，默认写 8 张；需要更细可以继续追加 4 张一行。
                </p>
                {frames.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDirectorCardAssistantActive(false);
                        setActiveFrameIndex(null);
                      }}
                      className={`rounded-lg border px-3 py-1.5 text-[11px] transition-colors ${
                        activeFrameIndex === null
                          ? 'border-[rgba(45,177,255,0.42)] bg-[rgba(45,177,255,0.14)] text-[var(--canvas-accent)]'
                          : 'border-[var(--canvas-node-border)] bg-black/15 text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)]'
                      }`}
                    >
                      整体修改 {frameCount} 张
                    </button>
                    <span className="text-[10px] text-[var(--canvas-text-3)]">
                      点某张卡片改单张，点空白处或这里改整组
                    </span>
                  </div>
                )}
                <div className="mt-2 flex max-w-[620px] items-center gap-2">
                  <input
                    ref={assistantInputRef}
                    value={assistantText}
                    onChange={(e) => setAssistantText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        askAssistantToEditFrame();
                      }
                    }}
                    disabled={frames.length === 0 && !directorCardAssistantActive}
                    placeholder={directorCardAssistantActive
                      ? '例如：改成更清楚的透视走位图，强调两人视线和摄影机位置'
                      : frames.length === 0
                        ? '先让 AI 创作默认 8 张提示词'
                        : activeFrameIndex === null
                          ? '例如：把整组改得更像冷峻悬疑电影，每张都拉开景别差异'
                          : '例如：把当前这张改成低机位特写，光线更冷，人物更紧张'}
                    className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--canvas-node-border)] bg-black/20 px-3 text-[11px] text-[var(--canvas-text-1)] outline-none transition-colors placeholder:text-[var(--canvas-text-3)] focus:border-[var(--canvas-node-border-selected)] disabled:opacity-50"
                  />
                  <button
                    onClick={askAssistantToEditFrame}
                    disabled={!assistantText.trim() || (frames.length === 0 && !directorCardAssistantActive)}
                    className="h-9 shrink-0 rounded-lg border border-[var(--canvas-node-border)] px-3 text-[11px] text-[var(--canvas-text-2)] transition-colors hover:text-[var(--canvas-text-1)] disabled:opacity-40"
                  >
                    发送
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
              <button
                onClick={() => void askAgentForFrames()}
                disabled={storyboardWriting}
                className="flex min-w-[160px] items-center justify-center gap-2 px-3 py-2 rounded-lg text-[12px] text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                style={{ background: 'var(--canvas-accent)' }}
              >
	                {storyboardWriting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {storyboardWriting ? 'AI 正在写 8 张提示词' : 'AI 创作 8 张分镜提示词'}
	              </button>
              <button
                onClick={appendStoryboardRow}
                disabled={storyboardWriting || batchBusy || composeBusy}
                className="flex min-w-[118px] items-center justify-center gap-2 px-3 py-2 rounded-lg border border-[var(--canvas-node-border)] text-[12px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] disabled:opacity-40"
                title="新增一行 4 张空分镜"
              >
                <Plus size={13} /> 新增 4 张
              </button>
	              <button
	                onClick={() => void generateSelected()}
                disabled={batchBusy || frames.length === 0}
                className="flex min-w-[118px] items-center justify-center gap-2 px-3 py-2 rounded-lg border border-[var(--canvas-node-border)] text-[12px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] disabled:opacity-40"
              >
                <ImagePlus size={13} /> {batchBusy ? '生成中…' : `用${storyboardEngine === 'seedream-v5-pro' ? '豆包' : ' GPT '}生成选中`}
              </button>
              <button
                onClick={() => void composeSelected()}
                disabled={composeBusy || frames.filter((f) => f.selected !== false && f.imagePath).length < 4}
                className="flex min-w-[118px] items-center justify-center gap-2 px-3 py-2 rounded-lg border border-[var(--canvas-node-border)] text-[12px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] disabled:opacity-40"
              >
                <Grid2X2 size={13} /> {composeBusy ? '拼合中…' : '选图拼成 2x2'}
              </button>
              <button
                onClick={injectToVideoPrompt}
                disabled={boards.filter((b) => b.useInVideo !== false).length === 0 && directorCard?.useInVideo !== true}
                className="flex min-w-[118px] items-center justify-center gap-2 px-3 py-2 rounded-lg border border-[var(--canvas-node-border)] text-[12px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] disabled:opacity-40"
              >
                <MonitorPlay size={13} /> 写入视频提示词
              </button>
              </div>
            </div>
            {storyboardWriting && (
              <div className="mt-3 rounded-lg border border-[rgba(45,177,255,0.28)] bg-[rgba(45,177,255,0.08)] px-2.5 py-2 text-[10px] leading-relaxed text-[var(--canvas-text-2)]">
                已发送给工坊 AI。写完后会自动填入下面分镜卡片；右侧抽屉里可以看到执行过程。
              </div>
            )}
            {generationStatus && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-[rgba(45,177,255,0.28)] bg-[rgba(45,177,255,0.08)] px-2.5 py-2 text-[10px] leading-relaxed text-[var(--canvas-text-2)]">
                <Loader2 size={11} className="animate-spin text-[var(--canvas-accent)]" />
                <span>{generationStatus}</span>
              </div>
            )}
            {(assistantRunActive || assistantStatus) && (
              <div className="mt-3 rounded-lg border border-[rgba(45,177,255,0.22)] bg-[rgba(10,22,30,0.55)] p-2.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2 text-[10px] text-[var(--canvas-text-2)]">
                    {assistantRunActive && <Loader2 size={11} className="animate-spin text-[var(--canvas-accent)]" />}
                    <span className="shrink-0 text-[var(--canvas-accent)]">AI 助手进度</span>
                    <span className="truncate">{assistantPhaseText}</span>
                  </div>
                  <span className="shrink-0 text-[10px] text-[var(--canvas-text-3)]">显示执行过程，不展示私有逐字推理</span>
                </div>
                {assistantRunActive ? (
                  <RunStepTimeline compact showHeader={false} />
                ) : (
                  <div className="text-[10px] leading-relaxed text-[var(--canvas-text-3)]">{assistantStatus}</div>
                )}
              </div>
            )}
            </div>

          <div
            className="mb-4 rounded-xl border border-[var(--canvas-node-border)] bg-[var(--canvas-node-bg)] p-3"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setActiveFrameIndex(null);
            }}
          >
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[12px] font-medium text-[var(--canvas-text-1)]">本镜故事板参考顺序</div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[var(--canvas-text-3)]">提示词必须按这些编号写 @图片N</span>
                <button
                  type="button"
                  onClick={() => void handleUploadStoryboardRef()}
                  className="rounded-lg border border-[var(--canvas-node-border)] bg-black/15 px-2 py-1 text-[11px] text-[var(--canvas-text-2)] transition-colors hover:text-[var(--canvas-text-1)]"
                >
                  上传参考图
                </button>
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="rounded-lg border border-[var(--canvas-node-border)] bg-black/15 px-2 py-1 text-[11px] text-[var(--canvas-text-2)] transition-colors hover:text-[var(--canvas-text-1)]"
                >
                  从素材库选
                </button>
                <button
                  type="button"
                  onClick={() => setAssetPickerOpen(true)}
                  className="rounded-lg border border-[var(--canvas-node-border)] bg-black/15 px-2 py-1 text-[11px] text-[var(--canvas-text-2)] transition-colors hover:text-[var(--canvas-text-1)]"
                >
                  从资产选
                </button>
              </div>
            </div>
            {storyboardPromptRefs.length > 0 ? (
              <RemovableRefStrip
                refs={storyboardPromptRefs}
                shot={shot}
                scenes={scenes}
                onPatch={(patch) => patchLatestShotRefs({ ...patch, promptNeedsRefresh: true })}
                onPreview={setFullscreen}
                onMove={moveStoryboardRefAsset}
                canMove={canMoveStoryboardRef}
              />
            ) : (
              <div className="rounded-lg border border-dashed border-[var(--canvas-node-border)] px-3 py-4 text-center text-[11px] text-[var(--canvas-text-3)]">
                还没有可用于故事板的场景或角色资产。请先在资产步骤确定场景图和角色图。
              </div>
            )}
            {frames.length > 0 && (
              <button
                type="button"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setActiveFrameIndex(null);
                }}
                className={`mt-3 w-full rounded-lg border border-dashed px-3 py-2 text-[11px] transition-colors ${
                  activeFrameIndex === null
                    ? 'border-[rgba(45,177,255,0.35)] bg-[rgba(45,177,255,0.08)] text-[var(--canvas-accent)]'
                    : 'border-[var(--canvas-node-border)] bg-black/10 text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-2)]'
                }`}
              >
                切换为整体修改 {frameCount} 张提示词
              </button>
            )}
          </div>

          <div className="mb-4 overflow-hidden rounded-xl border border-[var(--canvas-node-border)] bg-[var(--canvas-node-bg)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--canvas-node-border)] px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[rgba(45,177,255,0.10)] text-[var(--canvas-accent)]">
                  <Crosshair size={14} />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-medium text-[var(--canvas-text-1)]">导演约束卡</span>
                    <span className="rounded-full border border-[var(--canvas-node-border)] px-1.5 py-0.5 text-[10px] text-[var(--canvas-text-3)]">可选</span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-[var(--canvas-text-3)]">锁定站位、视线、机位与动作关系；每格独立启用，不会改变普通参考图顺序。</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void generateDirectorConstraintCard()}
                  disabled={constraintBusy}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--canvas-node-border)] bg-black/15 px-2.5 text-[11px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] disabled:opacity-50"
                >
                  {constraintBusy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  {constraintBusy ? '生成中' : directorCard ? 'AI 重生成' : 'AI 生成'}
                </button>
                <button
                  type="button"
                  onClick={() => void uploadDirectorConstraintCard()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--canvas-node-border)] bg-black/15 px-2.5 text-[11px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)]"
                >
                  <Upload size={12} /> 上传
                </button>
                <button
                  type="button"
                  onClick={() => setConstraintPickerOpen(true)}
                  className="h-8 rounded-lg border border-[var(--canvas-node-border)] bg-black/15 px-2.5 text-[11px] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)]"
                >
                  从素材库选
                </button>
              </div>
            </div>
            {directorCard?.imagePath ? (
              <div
                className={`grid gap-3 p-3 md:grid-cols-[220px_minmax(0,1fr)] ${
                  directorCardAssistantActive ? 'bg-[rgba(45,177,255,0.045)]' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => setFullscreen(convertFileSrc(directorCard.imagePath))}
                  className="group relative aspect-video overflow-hidden rounded-lg border border-[var(--canvas-node-border)] bg-black/30"
                  title="放大查看导演约束卡"
                >
                  <img src={convertFileSrc(directorCard.imagePath)} alt="导演约束卡" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                  <span className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-lg bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100">
                    <Maximize2 size={13} />
                  </span>
                </button>
                <div className="flex min-w-0 flex-col justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[11px] text-[var(--canvas-text-1)]">已应用到 {directorCardAppliedCount}/{frames.length} 格</div>
                      <button
                        type="button"
                        onClick={selectDirectorCardForAssistant}
                        className={`inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-[10px] transition-colors ${
                          directorCardAssistantActive
                            ? 'border-[rgba(45,177,255,0.45)] bg-[rgba(45,177,255,0.14)] text-[var(--canvas-accent)]'
                            : 'border-[var(--canvas-node-border)] bg-black/15 text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)]'
                        }`}
                        title="让 Agent 只修改导演约束卡提示词"
                      >
                        <Sparkles size={11} /> Agent 修改提示词
                      </button>
                    </div>
                    <div className="mt-1 text-[10px] leading-relaxed text-[var(--canvas-text-3)]">启用的格子会把本卡追加为最后一张参考图，并在提示词中自动写入“@导演约束卡（对应 @图片N）”。</div>
                    <label className="mt-3 block text-[10px] font-medium text-[var(--canvas-text-2)]">
                      导演约束卡提示词
                    </label>
                    <textarea
                      value={directorCardPromptDraft}
                      onChange={(event) => setDirectorCardPromptDraft(event.target.value)}
                      onFocus={() => {
                        setDirectorCardAssistantActive(true);
                        setActiveFrameIndex(null);
                      }}
                      onBlur={() => {
                        const latestCard = latestShotContext().latestShot.directorConstraintCard;
                        if (!latestCard || directorCardPromptDraft === (latestCard.prompt ?? '')) return;
                        commitDirectorConstraintCard({ ...latestCard, prompt: directorCardPromptDraft.trim() });
                      }}
                      placeholder="描述素模站位、视线、机位、动线和动作关系。AI 生成时只会传入场景图。"
                      className="mt-1.5 h-[104px] w-full resize-y rounded-lg border border-[var(--canvas-node-border)] bg-black/20 px-2.5 py-2 text-[10px] leading-relaxed text-[var(--canvas-text-1)] outline-none placeholder:text-[var(--canvas-text-3)] focus:border-[var(--canvas-node-border-selected)]"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setAllFramesDirectorConstraint(true)}
                      disabled={frames.length === 0}
                      className="h-8 rounded-lg border border-[rgba(45,177,255,0.30)] bg-[rgba(45,177,255,0.08)] px-3 text-[11px] text-[var(--canvas-accent)] disabled:opacity-40"
                    >
                      全部应用
                    </button>
                    <button
                      type="button"
                      onClick={() => setAllFramesDirectorConstraint(false)}
                      disabled={directorCardAppliedCount === 0}
                      className="h-8 rounded-lg border border-[var(--canvas-node-border)] px-3 text-[11px] text-[var(--canvas-text-2)] disabled:opacity-40"
                    >
                      全部关闭
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const latestCard = latestShotContext().latestShot.directorConstraintCard;
                        if (latestCard) commitDirectorConstraintCard({ ...latestCard, useInVideo: latestCard.useInVideo !== true });
                      }}
                      className={`h-8 rounded-lg border px-3 text-[11px] ${
                        directorCard.useInVideo === true
                          ? 'border-[rgba(45,177,255,0.34)] bg-[rgba(45,177,255,0.10)] text-[var(--canvas-accent)]'
                          : 'border-[var(--canvas-node-border)] text-[var(--canvas-text-2)]'
                      }`}
                    >
                      {directorCard.useInVideo === true ? '已传入视频' : '传入视频'}
                    </button>
                    <button
                      type="button"
                      onClick={() => commitDirectorConstraintCard(undefined)}
                      className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[11px] text-[var(--canvas-text-3)] hover:bg-[rgba(255,97,99,0.12)] hover:text-[var(--canvas-danger)]"
                    >
                      <Trash2 size={12} /> 删除
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-[82px] items-center justify-center px-4 py-5 text-center text-[11px] text-[var(--canvas-text-3)]">
                没有导演约束卡。普通故事板仍可正常生成，需要加强空间连续性时再添加。
              </div>
            )}
          </div>

          <div className="rounded-xl p-2 -m-2 transition-colors hover:bg-white/[0.015]" onMouseDown={() => {
            setDirectorCardAssistantActive(false);
            setActiveFrameIndex(null);
          }}>
          <div className="grid grid-cols-4 gap-3">
            {frames.map((frame, idx) => (
              <div
                key={frame.id}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setDirectorCardAssistantActive(false);
                  setActiveFrameIndex(idx);
                }}
                className="group rounded-xl border bg-[var(--canvas-node-bg)] overflow-hidden transition-colors"
                style={{ borderColor: activeFrameIndex === idx ? 'var(--canvas-node-border-selected)' : 'var(--canvas-node-border)' }}
              >
                <div className="w-full aspect-video bg-black/35 relative">
                  {frame.imagePath ? (
                    <button
                      type="button"
                      onClick={() => setFullscreen(convertFileSrc(frame.imagePath!))}
                      className="block w-full h-full group cursor-zoom-in"
                      title="放大预览这张分镜图"
                      aria-label={`放大预览第 ${idx + 1} 张分镜图`}
                    >
                      <img src={convertFileSrc(frame.imagePath)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                      <span className="pointer-events-none absolute bottom-2 right-2 z-10 flex h-7 w-7 items-center justify-center rounded-lg bg-black/70 text-white opacity-90 transition-opacity group-hover:opacity-100">
                        <Maximize2 size={14} />
                      </span>
                    </button>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[11px] text-[var(--canvas-text-3)]">第 {idx + 1} 张</div>
                  )}
                  <button
                    onClick={() => patchFrame(frame.id, { selected: frame.selected === false })}
                    className={`absolute left-2 top-2 w-5 h-5 rounded-full border flex items-center justify-center ${frame.selected === false ? 'bg-black/40 border-white/20' : 'bg-[var(--canvas-accent)] border-transparent'}`}
                    title={frame.selected === false ? '点击选中' : '点击取消选择'}
                  >
                    {frame.selected !== false && <Check size={12} className="text-white" />}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteStoryboardFrame(frame.id);
                    }}
                    className="absolute bottom-2 right-11 z-20 flex h-7 w-7 items-center justify-center rounded-lg bg-black/70 text-white opacity-0 transition-opacity hover:bg-[var(--canvas-danger)] group-hover:opacity-100 focus-visible:opacity-100"
                    title="删除这张故事板"
                  >
                    <Trash2 size={12} />
                  </button>
                  {storyboardFrameCandidates(frame).length > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCandidateFrameId(frame.id);
                        setCandidatePreview(null);
                      }}
                      className="absolute right-2 top-2 rounded-md bg-black/70 px-2 py-1 text-[11px] text-white hover:bg-black/85"
                      title="打开候选图集，选择最终图"
                    >
                      候选 {storyboardFrameCandidates(frame).length}
                    </button>
                  )}
                  {(frame.status === 'generating' || busyId === frame.id) && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55 text-white">
                      <Loader2 size={18} className="animate-spin text-[var(--canvas-accent)]" />
                      <span className="rounded-full bg-black/55 px-2 py-1 text-[10px]">正在生成第 {idx + 1} 张</span>
                    </div>
                  )}
                  {frame.status === 'failed' && <span className="absolute right-2 top-2 text-[10px] text-[var(--canvas-danger)]">失败</span>}
                </div>
                <div className="p-2">
                  <div className="mb-2 flex min-h-9 items-center gap-1 overflow-x-auto pb-1">
                    {compactStoryboardFrameReferences(shot, frame, {
                      scenes,
                      characters,
                      props,
                      colorPalettes,
                      globalColorPaletteId,
                    }).bindings.map((ref) => {
                      const isDirectorCard = ref.kind === 'directorConstraintCard';
                      return (
                        <button
                          type="button"
                          key={`${frame.id}-${ref.index}-${ref.path}`}
                          onClick={isDirectorCard ? (event) => {
                            event.stopPropagation();
                            setFrameDirectorConstraint(frame, false);
                          } : undefined}
                          className={`relative h-9 w-9 shrink-0 overflow-hidden rounded-md border bg-black/25 ${isDirectorCard ? 'cursor-pointer border-[rgba(45,177,255,0.72)]' : 'cursor-default border-[rgba(45,177,255,0.42)]'}`}
                          title={isDirectorCard
                            ? `@图片${numToCn(ref.index)} · 导演约束卡（点击停止传入）`
                            : `@图片${numToCn(ref.index)} · ${ref.label}`}
                        >
                          <img
                            src={convertFileSrc(ref.path)}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className="h-full w-full object-cover"
                          />
                          <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/65 text-center text-[8px] leading-[13px] text-white">
                            图{numToCn(ref.index)}
                          </span>
                        </button>
                      );
                    })}
                    {directorCard?.imagePath && (() => {
                      const cardRef = frameReferenceBindings(frame).find((ref) => ref.kind === 'directorConstraintCard');
                      const enabled = frame.useDirectorConstraintCard === true && Boolean(cardRef);
                      if (enabled) return null;
                      return (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setFrameDirectorConstraint(frame, !enabled);
                          }}
                          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] transition-colors ${
                            enabled
                              ? 'border-[rgba(45,177,255,0.50)] bg-[rgba(45,177,255,0.14)] text-[var(--canvas-accent)]'
                              : 'border-[var(--canvas-node-border)] bg-black/15 text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-2)]'
                          }`}
                          title="点击让本格使用导演约束卡"
                        >
                          <Crosshair size={10} />
                          使用导演约束卡
                        </button>
                      );
                    })()}
                  </div>
                  <textarea
                    value={frame.prompt}
                    onFocus={() => {
                      setDirectorCardAssistantActive(false);
                      setActiveFrameIndex(idx);
                    }}
                    onChange={(e) => {
                      const refs = frameReferenceBindings(frame);
                      patchFrame(frame.id, { prompt: e.target.value, refImagePaths: refs.map((ref) => ref.path) });
                    }}
                    className="w-full h-[118px] resize-none rounded-lg border border-[var(--canvas-node-border)] bg-black/20 px-2 py-1.5 text-[11px] leading-relaxed text-[var(--canvas-text-1)] focus:outline-none focus:border-[var(--canvas-node-border-selected)]"
                  />
                  {frame.error && <div className="mt-1 text-[10px] text-[var(--canvas-danger)] line-clamp-2">{frame.error}</div>}
                  <div className="mt-2 rounded-xl border border-[var(--canvas-node-border)] bg-black/30 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-[var(--canvas-text-1)]">调整生成图片位置</span>
                      <span className="rounded-md border border-[var(--canvas-node-border)] bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-[var(--canvas-text-2)]">当前第 {idx + 1} 张</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => moveStoryboardFrame(frame.id, -1)}
                        disabled={idx === 0 || batchBusy || busyId === frame.id}
                        className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-[var(--canvas-node-border)] bg-[var(--canvas-controls-hover)] px-2 py-1.5 text-[11px] font-semibold text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-active)] disabled:bg-black/20 disabled:text-[var(--canvas-text-3)] disabled:opacity-60 disabled:cursor-not-allowed"
                        title="把这张生成图向前移动一格"
                      >
                        <ChevronUp size={11} /> 前移
                      </button>
                      <button
                        type="button"
                        onClick={() => moveStoryboardFrame(frame.id, 1)}
                        disabled={idx === frames.length - 1 || batchBusy || busyId === frame.id}
                        className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-[var(--canvas-node-border)] bg-[var(--canvas-controls-hover)] px-2 py-1.5 text-[11px] font-semibold text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-active)] disabled:bg-black/20 disabled:text-[var(--canvas-text-3)] disabled:opacity-60 disabled:cursor-not-allowed"
                        title="把这张生成图向后移动一格"
                      >
                        后移 <ChevronDown size={11} />
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={() => void generateFrame(frame)}
                    disabled={busyId === frame.id || batchBusy}
                    className="mt-2 w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] text-[var(--canvas-text-2)] border border-[var(--canvas-node-border)] hover:text-[var(--canvas-text-1)] disabled:opacity-40"
                  >
                    <RefreshCw size={12} className={busyId === frame.id ? 'animate-spin' : ''} />
                    {busyId === frame.id
                      ? '生成中…'
                      : `用${storyboardEngine === 'seedream-v5-pro' ? '豆包' : ' GPT '}${frame.imagePath ? '重生成' : '生成'}`}
                  </button>
                  <button
                    onClick={() => void sendFrameToCanvas(frame)}
                    disabled={canvasSendingId === frame.id || batchBusy}
                    className="mt-1.5 w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] text-[var(--canvas-accent)] border border-[rgba(45,177,255,0.28)] bg-[rgba(45,177,255,0.07)] hover:bg-[rgba(45,177,255,0.12)] disabled:opacity-40"
                    title="把本格图片、提示词和精确回传目标送入画布"
                  >
                    {canvasSendingId === frame.id
                      ? <Loader2 size={12} className="animate-spin" />
                      : <MonitorPlay size={12} />}
                    画布精修
                  </button>
                </div>
              </div>
            ))}
            {frames.length === 0 && (
              <div className="col-span-4 py-16 text-center text-[12px] text-[var(--canvas-text-3)] rounded-xl border border-dashed border-[var(--canvas-node-border)]">
                先让 AI 按剧情和当前风格创作默认 8 张分镜提示词，也可以先新增 4 张空分镜。
              </div>
            )}
          </div>
          </div>

          {boards.length > 0 && (
              <div className="mt-5 rounded-xl border border-[var(--canvas-node-border)] bg-[var(--canvas-node-bg)] p-3">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-[12px] text-[var(--canvas-text-1)] font-medium">分镜板资产</div>
                <span className="text-[10px] text-[var(--canvas-text-3)]">用于视频生成时会排在参考图最前面</span>
              </div>
              <div className="grid grid-cols-4 gap-3">
                {boards.map((board, i) => (
                  <div key={board.id} className="rounded-lg overflow-hidden border border-[var(--canvas-node-border)] bg-black/25">
                    <button
                      type="button"
                      onClick={() => setFullscreen(convertFileSrc(board.imagePath))}
                      className="relative block w-full aspect-video group cursor-zoom-in bg-black/30"
                      title="放大预览这张分镜板"
                      aria-label={`放大预览第 ${i + 1} 张分镜板`}
                    >
                      <img src={convertFileSrc(board.imagePath)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                      <span className="absolute left-2 bottom-2 rounded-md bg-black/70 px-2 py-1 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                        点击放大
                      </span>
                      <span className="absolute right-2 bottom-2 flex w-7 h-7 rounded-lg bg-black/70 items-center justify-center text-white opacity-90 group-hover:opacity-100">
                        <Maximize2 size={14} />
                      </span>
                    </button>
                    <div className="px-2 py-1.5 flex items-center justify-between gap-2">
                      <span className="text-[10px] text-[var(--canvas-text-3)]">分镜板 {i + 1}</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveStoryboardBoard(board.id, -1)}
                          disabled={i === 0}
                          className="rounded p-1 text-[var(--canvas-text-3)] hover:bg-white/5 hover:text-[var(--canvas-text-1)] disabled:opacity-30"
                          title="上移分镜板"
                        >
                          <ChevronUp size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveStoryboardBoard(board.id, 1)}
                          disabled={i === boards.length - 1}
                          className="rounded p-1 text-[var(--canvas-text-3)] hover:bg-white/5 hover:text-[var(--canvas-text-1)] disabled:opacity-30"
                          title="下移分镜板"
                        >
                          <ChevronDown size={12} />
                        </button>
                        <button
                          onClick={() => commitStoryboardBoards((latest) =>
                            latest.map((b) => b.id === board.id ? { ...b, useInVideo: b.useInVideo === false } : b),
                          )}
                          className={`text-[11px] ${board.useInVideo === false ? 'text-[var(--canvas-text-3)]' : 'text-[var(--canvas-accent)]'}`}
                        >
                          {board.useInVideo === false ? '不传入' : '传入视频'}
                        </button>
                        <button
                          type="button"
                          onClick={() => commitStoryboardBoards((latest) => latest.filter((b) => b.id !== board.id))}
                          className="rounded p-1 text-[var(--canvas-text-3)] hover:bg-[rgba(255,97,99,0.15)] hover:text-[var(--canvas-danger)]"
                          title="删除这张分镜板资产"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(
    <>
      {modal}
      {candidateModal}
      {pickerOpen && (
        <div className="canvas-dark fixed inset-0 flex items-center justify-center text-[var(--canvas-text-1)]" style={{ background: 'rgba(0,0,0,0.6)', zIndex: Z.picker }} onMouseDown={() => setPickerOpen(false)}>
          <div onMouseDown={(e) => e.stopPropagation()}>
            <ArtifactPickerPanel
              open
              onClose={() => setPickerOpen(false)}
              onPick={(entry) => void handlePickStoryboardArtifact(entry)}
              inline
            />
          </div>
        </div>
      )}
      {constraintPickerOpen && (
        <div className="canvas-dark fixed inset-0 flex items-center justify-center text-[var(--canvas-text-1)]" style={{ background: 'rgba(0,0,0,0.6)', zIndex: Z.picker }} onMouseDown={() => setConstraintPickerOpen(false)}>
          <div onMouseDown={(e) => e.stopPropagation()}>
            <ArtifactPickerPanel
              open
              onClose={() => setConstraintPickerOpen(false)}
              onPick={(entry) => void pickDirectorConstraintArtifact(entry)}
              inline
            />
          </div>
        </div>
      )}
      <WorkshopAssetImagePicker
        open={assetPickerOpen}
        onClose={() => setAssetPickerOpen(false)}
        characters={characters}
        scenes={scenes}
        props={props}
        colorPalettes={colorPalettes}
        onPick={(item) => void handlePickWorkshopAsset(item)}
      />
      <ReferencePlacementDialog
        open={Boolean(pendingStoryboardRef)}
        path={pendingStoryboardRef?.path}
        title={pendingStoryboardRef?.title}
        onClose={() => setPendingStoryboardRef(null)}
        onPick={(kind) => {
          if (pendingStoryboardRef?.path) void addStoryboardRefPath(pendingStoryboardRef.path, kind);
          setPendingStoryboardRef(null);
        }}
      />
      {fullscreen && <ImageFullscreenViewer imageUrl={fullscreen} onClose={() => setFullscreen(null)} />}
    </>,
    document.body,
  );
}

const ShotRows = memo(function ShotRows({ shot, isOpen, onToggle, onPatch: onPatchShot, onRemove, colWidths, characters, scenes, props, colorPalettes, globalRatio, globalColorPaletteId, globalVideoPromptTemplate, directorAvailability }: {
  shot: WsShot;
  isOpen: boolean;
  onToggle: (shotNo: string) => void;
  onPatch: (shot: WsShot, p: Partial<WsShot>) => void;
  onRemove: (shotNo: string) => void;
  colWidths: Record<ColKey, number>;
  characters: { id: string; name: string; assetImagePath?: string; voicePath?: string }[];
  scenes: { id: string; name: string; assetImagePath?: string; selectedImagePaths?: string[]; sceneReferenceMode?: 'multi'; candidates?: AssetCandidate[] }[];
  props: { id: string; name: string; assetImagePath?: string }[];
  colorPalettes: PaletteOption[];
  globalRatio?: string;
  globalColorPaletteId?: string;
  globalVideoPromptTemplate?: VideoPromptTemplate;
  directorAvailability?: DirectorAvailability;
}) {
  const [storyboardOpen, setStoryboardOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState<string | null>(null);
  const [promptPickerOpen, setPromptPickerOpen] = useState(false);
  const [promptAssetPickerOpen, setPromptAssetPickerOpen] = useState(false);
  const [pendingPromptRef, setPendingPromptRef] = useState<{ path: string; title: string } | null>(null);
  // Esc 栈：素材库选择器与全屏查看后开先关；资产选择器/参考类型弹窗各自注册。
  useEscapeClose(promptPickerOpen, () => setPromptPickerOpen(false));
  useEscapeClose(fullscreen !== null, () => setFullscreen(null));
  // 父级传入 (shot, patch) 单一处理器保证引用稳定；行内统一经此处补当前 shot，调用点不变
  const onPatch = useCallback((p: Partial<WsShot>) => { onPatchShot(shot, p); }, [onPatchShot, shot]);
  // 参考图列表按输入缓存：本行本地弹窗/展开态变化不再重建；shot 或资产列表引用变化才重算
  const refImages = useMemo(
    () => buildShotRefImages(shot, characters, scenes, props, colorPalettes, globalColorPaletteId),
    [shot, characters, scenes, props, colorPalettes, globalColorPaletteId],
  );
  const videoRefImages = useMemo(
    () => buildShotVideoRefImages(shot, characters, scenes, props, colorPalettes, globalColorPaletteId),
    [shot, characters, scenes, props, colorPalettes, globalColorPaletteId],
  );
  const scene = scenes.find((s) => s.id === shot.sceneId);
  const activeVideoPromptTemplate = resolvePromptTemplate(shot, globalVideoPromptTemplate);
  const activeVideoPrompt = editableVideoPrompt(shot, globalVideoPromptTemplate);

  const buildAuthoritativeVideoCanvasRefs = (): PromptRefItem[] => {
    const paths = buildVideoRefPaths(shot, {
      scenes,
      characters,
      props,
      colorPalettes,
      globalColorPaletteId,
    });
    const seen = new Set<string>();
    const imageRefs = paths
      .filter((path) => {
        if (!path || seen.has(path)) return false;
        seen.add(path);
        return true;
      })
      .map((path, i): PromptRefItem => ({
        label: `@图片${numToCn(i + 1)}`,
        url: convertFileSrc(path),
        path,
      }));
    const mediaRefs = videoRefImages.filter((ref) => ref.type === 'audio' || ref.type === 'video');
    return [...imageRefs, ...mediaRefs];
  };

  const addReferencePathByPlacement = (path: string, placement: ReferencePlacementKind) => {
    const all = new Set([...refImages, ...videoRefImages].map((ref) => ref.path).filter(Boolean));
    if (all.has(path)) return;
    onPatch(buildReferencePlacementPatch(shot, path, placement));
  };

  const addWorkshopAssetReference = (item: WorkshopAssetPickItem) => {
    const patch = buildWorkshopAssetReferencePatch(shot, item, scenes);
    if (patch) onPatch(patch);
  };

  const handleUploadPromptRef = async () => {
    const selected = await openDialog({ filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (!selected || Array.isArray(selected)) return;
    const absPath = await copyShotReferenceIntoProject(shot.shotNo, selected, 'upload');
    if (absPath) setPendingPromptRef({ path: absPath, title: '这张上传图片作为哪类参考？' });
  };

  const handlePickPromptArtifact = async (entry: { path: string }) => {
    const absPath = await copyShotReferenceIntoProject(shot.shotNo, entry.path, 'artifact');
    if (absPath) setPendingPromptRef({ path: absPath, title: '这张产物作为哪类参考？' });
    setPromptPickerOpen(false);
  };

  const handlePickPromptAsset = async (item: WorkshopAssetPickItem) => {
    addWorkshopAssetReference(item);
    setPromptAssetPickerOpen(false);
  };

  const connectRefsToNode = (targetNodeId: string, refs: PromptRefItem[], x: number, y: number) => {
    const project = useWorkshopStore.getState().project;
    if (!project) return;
    const store = useCanvasStore.getState();
    for (const [idx, ref] of refs.filter((r) => r.path).entries()) {
      const path = ref.path!;
      const refNodeId = `node-${nanoid(8)}`;
      const kind = ref.type === 'audio' ? 'audio' : ref.type === 'video' ? 'video' : 'image';
      store.addNode({
        id: refNodeId,
        type: kind,
        position: { x: x - 300, y: y + idx * 92 },
        ...(kind !== 'audio' ? { style: defaultNodeStyle(kind) } : {}),
        data: kind === 'audio'
          ? { audioUrl: convertFileSrc(path), localPath: path, fileName: ref.label, description: `${shot.shotNo} ${ref.label}`, workshopPromptRefTarget: targetNodeId }
          : kind === 'video'
            ? {
                generatedVideoUrl: convertFileSrc(path),
                localPath: path,
                sourceVideoPath: path,
                mediaRole: 'reference',
                description: `${shot.shotNo} ${ref.label}`,
                workshopPromptRefTarget: targetNodeId,
              }
            : {
                generatedImageUrl: convertFileSrc(path),
                localPath: path,
                description: `${shot.shotNo} ${ref.label}`,
                workshopPromptRefTarget: targetNodeId,
                workshopRef: { projectId: project.id, kind: 'shot', id: shot.shotNo, role: 'asset' } satisfies WorkshopRef,
              },
      });
      store.onConnect({ source: refNodeId, target: targetNodeId, sourceHandle: null, targetHandle: null });
    }
  };

  const handleSendImageToCanvas = () => {
    const project = useWorkshopStore.getState().project;
    if (!project || !shot.imagePrompt) return;
    const store = useCanvasStore.getState();
    const nodeId = `node-${nanoid(8)}`;
    store.addNode({
      id: nodeId,
      type: 'image',
      position: { x: 400 + Math.random() * 200, y: 300 + Math.random() * 200 },
      style: defaultNodeStyle('image'),
      data: {
        description: shot.imagePrompt,
        ...(shot.imagePath ? { generatedImageUrl: convertFileSrc(shot.imagePath), localPath: shot.imagePath } : {}),
        workshopRef: { projectId: project.id, kind: 'shot', id: shot.shotNo, role: 'shot-image' } satisfies WorkshopRef,
      },
    });
    const target = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
    if (target) connectRefsToNode(nodeId, refImages.filter((ref) => ref.type !== 'audio' && ref.type !== 'video' && ref.label.startsWith('@图片')), target.position.x, target.position.y);
  };

  const handleSendVideoToCanvas = () => {
    const project = useWorkshopStore.getState().project;
    if (!project || !activeVideoPrompt) return;
    const store = useCanvasStore.getState();
    const videoNodeId = `node-${nanoid(8)}`;
    store.addNode({
      id: videoNodeId,
      type: 'video',
      position: { x: 400 + Math.random() * 200, y: 300 + Math.random() * 200 },
      style: defaultNodeStyle('video'),
      data: {
        description: activeVideoPrompt,
        videoPromptTemplate: shot.videoPromptTemplate,
        legacyVideoPrompt: shot.videoPrompt,
        universalVideoPrompt: shot.universalVideoPrompt || shot.seedance25VideoPrompt,
        referenceImages: [],
        referenceVideos: [],
        generatedVideoUrl: undefined,
        localPath: undefined,
        workshopRef: { projectId: project.id, kind: 'shot', id: shot.shotNo, role: 'shot-video' } satisfies WorkshopRef,
      },
    });
    const videoNode = useCanvasStore.getState().nodes.find((n) => n.id === videoNodeId);
    if (videoNode) connectRefsToNode(videoNodeId, buildAuthoritativeVideoCanvasRefs(), videoNode.position.x, videoNode.position.y);
  };

  return (
    <>
      {storyboardOpen && (
        <StoryboardModal
          shot={shot}
          characters={characters}
          scenes={scenes}
          props={props}
          colorPalettes={colorPalettes}
          globalRatio={globalRatio}
          globalColorPaletteId={globalColorPaletteId}
          onPatch={onPatch}
          onClose={() => setStoryboardOpen(false)}
        />
      )}
      {fullscreen && <ImageFullscreenViewer imageUrl={fullscreen} onClose={() => setFullscreen(null)} />}
      {promptPickerOpen && (
        <div className="canvas-dark fixed inset-0 flex items-center justify-center text-[var(--canvas-text-1)]" style={{ background: 'rgba(0,0,0,0.6)', zIndex: Z.picker }} onMouseDown={() => setPromptPickerOpen(false)}>
          <div onMouseDown={(e) => e.stopPropagation()}>
            <ArtifactPickerPanel
              open
              onClose={() => setPromptPickerOpen(false)}
              onPick={(entry) => void handlePickPromptArtifact(entry)}
              inline
            />
          </div>
        </div>
      )}
      <WorkshopAssetImagePicker
        open={promptAssetPickerOpen}
        onClose={() => setPromptAssetPickerOpen(false)}
        characters={characters}
        scenes={scenes}
        props={props}
        colorPalettes={colorPalettes}
        onPick={(item) => void handlePickPromptAsset(item)}
      />
      <ReferencePlacementDialog
        open={Boolean(pendingPromptRef)}
        path={pendingPromptRef?.path}
        title={pendingPromptRef?.title}
        onClose={() => setPendingPromptRef(null)}
        onPick={(kind) => {
          if (pendingPromptRef?.path) addReferencePathByPlacement(pendingPromptRef.path, kind);
          setPendingPromptRef(null);
        }}
      />
      <tr className="border-t border-[var(--canvas-node-border)] hover:bg-[rgba(255,255,255,0.02)]">
        <td className="pl-2">
          <button onClick={() => onToggle(shot.shotNo)} className="p-0.5 text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-1)] transition-colors">
            {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        </td>
        <td className="px-2 py-2 text-[var(--canvas-text-2)]" style={colWidths.shotNo > 0 ? { width: colWidths.shotNo } : undefined}>
          <div className="font-mono">{shot.shotNo}</div>
          {(directorAvailability?.storyboard || directorAvailability?.videoPrompt) && (
            <button
              type="button"
              onClick={() => {
                const projectId = useWorkshopStore.getState().data?.projectId;
                if (projectId) openWorkshopDirector(shot, characters, projectId, directorAvailability.storyboard ? 'storyboard' : 'video-prompt');
              }}
              className="mt-1 flex items-center gap-1 whitespace-nowrap rounded-md border border-[var(--canvas-node-border)] bg-[rgba(255,255,255,0.05)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--canvas-text-1)] hover:bg-[rgba(255,255,255,0.09)]"
              title={directorAvailability.storyboard && directorAvailability.videoPrompt ? '已有分镜白模和动作预演，点击进入' : '已有导演预演，点击继续'}
            >
              <Clapperboard size={10} /> {directorAvailability.storyboard && directorAvailability.videoPrompt ? '2 类预演' : '已有预演'}
            </button>
          )}
        </td>
        <td className="px-2 py-2" style={colWidths.desc > 0 ? { width: colWidths.desc } : undefined}>
          <SmartTextarea
            rows={1}
            value={shot.description}
            onChange={(v) => onPatch({ description: v })}
            placeholder="画面描述"
            editorTitle={`画面描述 · ${shot.shotNo}`}
            className={cellInput + ' cursor-text truncate'}
          />
        </td>
        <td className="px-2 py-2" style={colWidths.dialogue > 0 ? { width: colWidths.dialogue } : undefined}>
          <SmartTextarea
            rows={1}
            value={shot.dialogue ?? ''}
            onChange={(v) => onPatch({ dialogue: v })}
            placeholder="—"
            editorTitle={`对白 · ${shot.shotNo}`}
            className={cellInput + ' cursor-text truncate'}
          />
        </td>
        <td className="px-2 py-2" style={colWidths.shotType > 0 ? { width: colWidths.shotType } : undefined}>
          <input className={cellInput} value={shot.shotType ?? ''} placeholder="—" onChange={(e) => onPatch({ shotType: e.target.value })} />
        </td>
        <td className="px-2 py-2" style={colWidths.camera > 0 ? { width: colWidths.camera } : undefined}>
          <input className={cellInput} value={shot.camera ?? ''} placeholder="—" onChange={(e) => onPatch({ camera: e.target.value })} />
        </td>
        <td className="px-2 py-2" style={colWidths.mood > 0 ? { width: colWidths.mood } : undefined}>
          <input className={cellInput} value={shot.mood ?? ''} placeholder="—" onChange={(e) => onPatch({ mood: e.target.value })} />
        </td>
        <td className="px-2 py-2" style={colWidths.duration > 0 ? { width: colWidths.duration } : undefined}>
          <input
            className={cellInput}
            type="number"
            value={shot.durationSec ?? ''}
            placeholder="5"
            onChange={(e) => onPatch({ durationSec: e.target.value ? Number(e.target.value) : undefined })}
          />
        </td>
        <td className="px-2 py-2" style={colWidths.ratio > 0 ? { width: colWidths.ratio } : undefined}>
          <select
            className={cellInput + ' cursor-pointer'}
            value={shot.videoRatio ?? ''}
            onChange={(e) => onPatch({ videoRatio: e.target.value || undefined })}
            style={{ background: 'var(--canvas-panel)' }}
          >
            <option value="">{globalRatio ? `全局(${globalRatio})` : '—'}</option>
            {VIDEO_RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </td>
        <td className="px-1">
          <div className="flex items-center gap-2">
            <button
              onClick={() => dispatchWorkshopPrompt(buildOptimizeShotPrompt(shot.shotNo))}
              className="flex h-6 w-6 items-center justify-center rounded text-[var(--canvas-text-3)] hover:text-[var(--canvas-accent)] transition-colors"
              title="AI 优化此条提示词"
            >
              <Wand2 size={11} />
            </button>
            <button onClick={() => onRemove(shot.shotNo)} className="flex h-6 w-6 items-center justify-center rounded text-[var(--canvas-text-3)] hover:text-[var(--canvas-danger)] transition-colors" title="删除整镜">
              <Trash2 size={11} />
            </button>
          </div>
        </td>
      </tr>
      {isOpen && (
        <tr className="border-t border-[rgba(255,255,255,0.04)]" style={{ background: 'rgba(255,255,255,0.015)' }}>
          <td />
          <td colSpan={9} className="px-2 py-3">
            <CollapsibleSection title="本镜色卡">
              <div className="flex items-center gap-2">
                <PaletteMenu
                  value={shot.colorPaletteId ?? ''}
                  palettes={colorPalettes}
                  placeholder={globalColorPaletteId ? '跟随全片色卡' : '不使用色卡'}
                  followLabel={globalColorPaletteId ? '跟随全片色卡' : undefined}
                  onChange={(id) => onPatch({ colorPaletteId: id })}
                  className="w-[260px]"
                />
                {globalColorPaletteId && !shot.colorPaletteId && (
                  <span className="text-[10px] text-[var(--canvas-text-3)]">
                    当前：{colorPalettes.find((p) => p.id === globalColorPaletteId)?.name ?? '全片色卡'}
                  </span>
                )}
              </div>
            </CollapsibleSection>
            {scene && (
              <CollapsibleSection title="场景参考图">
                <SceneRefSelector shot={shot} scene={scene} scenes={scenes} characters={characters} props={props} colorPalettes={colorPalettes} globalColorPaletteId={globalColorPaletteId} onPatch={onPatch} />
              </CollapsibleSection>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label className="block text-[10px] text-[var(--canvas-text-3)]">高清故事板</label>
                  <span className="text-[10px] text-[var(--canvas-text-3)]">
                    {(shot.storyboardFrames ?? []).filter((f) => f.imagePath).length}/{(shot.storyboardFrames ?? []).length || 8} 图 · {(shot.storyboardBoards ?? []).length} 板
                  </span>
                </div>
                <SmartTextarea
                  rows={3}
                  value={shot.imagePrompt ?? ''}
                  onChange={(v) => onPatch({ imagePrompt: v })}
                  placeholder="基础分镜图提示词。需要高清分镜时，点下方故事板工作台默认拆成 8 张图，也可继续追加。"
                  editorTitle={`生图提示词 · ${shot.shotNo}`}
                  mentionHighlight
                  referenceImages={refImages}
                />
                <RemovableRefStrip refs={refImages} shot={shot} scenes={scenes} onPatch={onPatch} onPreview={setFullscreen} />
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <button
                    onClick={() => setStoryboardOpen(true)}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-white transition-opacity hover:opacity-90"
                    style={{ background: 'var(--canvas-accent)' }}
                  >
                    <Grid2X2 size={10} /> 故事板工作台
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const projectId = useWorkshopStore.getState().project?.id;
                      if (projectId) openWorkshopDirector(shot, characters, projectId, 'storyboard');
                    }}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-[var(--canvas-text-2)] border border-[var(--canvas-node-border)] hover:text-[var(--canvas-text-1)] transition-colors"
                    title="按已有分镜图或画面描述建立白模机位"
                  >
                    <Clapperboard size={10} /> 白模预演
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleUploadPromptRef()}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-[var(--canvas-text-3)] border border-[var(--canvas-node-border)] hover:text-[var(--canvas-text-1)] hover:border-[var(--canvas-node-border-selected)] transition-colors"
                    title="上传本镜参考图，高清故事板和视频提示词同步使用"
                  >
                    <Upload size={10} /> 上传
                  </button>
                  <button
                    type="button"
                    onClick={() => setPromptPickerOpen(true)}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-[var(--canvas-text-3)] border border-[var(--canvas-node-border)] hover:text-[var(--canvas-text-1)] hover:border-[var(--canvas-node-border-selected)] transition-colors"
                    title="从素材库添加本镜参考图"
                  >
                    <ImagePlus size={10} /> 素材库
                  </button>
                  <button
                    type="button"
                    onClick={() => setPromptAssetPickerOpen(true)}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-[var(--canvas-text-3)] border border-[var(--canvas-node-border)] hover:text-[var(--canvas-text-1)] hover:border-[var(--canvas-node-border-selected)] transition-colors"
                    title="从角色、场景、道具、色卡中添加本镜参考图"
                  >
                    <Sparkles size={10} /> 资产
                  </button>
                  {shot.imagePrompt && (
                  <button
                    onClick={handleSendImageToCanvas}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-[var(--canvas-text-3)] border border-dashed border-[var(--canvas-node-border)] hover:text-[var(--canvas-text-1)] hover:border-[var(--canvas-node-border-selected)] transition-colors"
                  >
                    <MonitorPlay size={10} /> 生图→画布
                  </button>
                  )}
                  {(shot.storyboardBoards ?? []).some((b) => b.useInVideo !== false) && (
                    <span className="text-[10px] text-[var(--canvas-accent)]">视频生成会优先传入分镜板</span>
                  )}
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label className="block text-[10px] text-[var(--canvas-text-3)]">视频提示词 · {activeVideoPromptTemplate === 'universal' ? '新版' : '经典版'}（Seedance：@图片N 引用 / {'{}'}台词 / {'<>'}音效 / （）音乐）</label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void handleUploadPromptRef()}
                      className="rounded-md border border-[var(--canvas-node-border)] px-1.5 py-0.5 text-[11px] text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-1)]"
                      title="上传本镜参考图，所有提示词位置同步生效"
                    >
                      上传
                    </button>
                    <button
                      type="button"
                      onClick={() => setPromptPickerOpen(true)}
                      className="rounded-md border border-[var(--canvas-node-border)] px-1.5 py-0.5 text-[11px] text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-1)]"
                      title="从素材库添加本镜参考图"
                    >
                      素材库
                    </button>
                    <button
                      type="button"
                      onClick={() => setPromptAssetPickerOpen(true)}
                      className="rounded-md border border-[var(--canvas-node-border)] px-1.5 py-0.5 text-[11px] text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-1)]"
                      title="从工坊资产添加本镜参考图"
                    >
                      资产
                    </button>
                  </div>
                </div>
                <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-[var(--canvas-node-border)] bg-[rgba(255,255,255,0.02)] px-2.5 py-2">
                  <span className="text-[10px] text-[var(--canvas-text-3)]">
                    {shot.videoPromptTemplate ? '本镜单独设置' : `跟随全局：${globalVideoPromptTemplate === 'universal' ? '新版' : '经典版'}`}
                  </span>
                  <div className="flex rounded-md border border-[var(--canvas-node-border)] bg-[var(--canvas-panel)] p-0.5">
                    {([['', '跟随全局'], ['legacy', '经典版'], ['universal', '新版']] as const).map(([value, label]) => {
                      const active = (shot.videoPromptTemplate ?? '') === value;
                      return (
                        <button
                          key={value || 'global'}
                          type="button"
                          onClick={() => onPatch({ videoPromptTemplate: value || undefined })}
                          className="rounded px-2 py-1 text-[10px] font-medium transition-colors"
                          style={{
                            background: active ? 'var(--canvas-controls-hover)' : 'transparent',
                            color: active ? 'var(--canvas-text-1)' : 'var(--canvas-text-3)',
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <SmartTextarea
                  rows={3}
                  value={activeVideoPrompt}
                  onChange={(v) => onPatch(activeVideoPromptTemplate === 'universal' ? { universalVideoPrompt: v } : { videoPrompt: v })}
                  placeholder={activeVideoPromptTemplate === 'universal' ? '按新版规范填写视频提示词…' : '按经典版填写视频提示词…'}
                  editorTitle={`视频提示词 · ${shot.shotNo} · ${activeVideoPromptTemplate === 'universal' ? '新版' : '经典版'}`}
                  mentionHighlight
                  referenceImages={videoRefImages}
                />
                <RemovableRefStrip refs={videoRefImages} shot={shot} scenes={scenes} onPatch={onPatch} onPreview={setFullscreen} />
                {activeVideoPrompt && (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <button
                      onClick={handleSendVideoToCanvas}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-[var(--canvas-text-3)] border border-dashed border-[var(--canvas-node-border)] hover:text-[var(--canvas-text-1)] hover:border-[var(--canvas-node-border-selected)] transition-colors"
                    >
                      <MonitorPlay size={10} /> 视频→画布
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const projectId = useWorkshopStore.getState().project?.id;
                        if (projectId) openWorkshopDirector({ ...shot, videoPrompt: activeVideoPrompt }, characters, projectId, 'video-prompt');
                      }}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-[var(--canvas-text-2)] border border-[var(--canvas-node-border)] hover:text-[var(--canvas-text-1)] transition-colors"
                    >
                      <Clapperboard size={10} /> 动作预演
                    </button>
                  </div>
                )}
              </div>
            </div>
            {((shot.characterIds?.length ?? 0) > 0 || (shot.audioPrompts?.length ?? 0) > 0 || (shot.generatedAudios?.length ?? 0) > 0) && (
              <CollapsibleSection title="台词配音">
                <AudioPromptsSection shot={shot} characters={characters} onPatch={onPatch} />
              </CollapsibleSection>
            )}
          </td>
        </tr>
      )}
    </>
  );
});
