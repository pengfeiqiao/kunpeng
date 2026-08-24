/**
 * workshopStore — 创作工坊状态（6 步流水线）。
 *
 * 文件为源 of truth：~/.kunpeng/aigc-memory/projects/<id>/workshop.json，
 * store 内存态 + debounce 800ms 自动落盘。生成走 canvasGen.runGeneration
 * （与画布共享 MAX 3 槽位队列），产物拷贝进项目 shots/ 目录。
 */
import { create } from 'zustand';
import { copyFile, createDir, exists, BaseDirectory } from '@tauri-apps/api/fs';
import { homeDir } from '@tauri-apps/api/path';
import {
  type AigcProject,
  createProject,
  readProject,
  readProjectFile,
  writeProject,
  writeProjectFile,
} from '@/lib/aigc/projectStore';
import {
  type AssetCandidate,
  type GeneratedAudio,
  type PaletteColor,
  type WorkshopData,
  type WorkshopAssetKind,
  type WorkshopStepId,
  type WsCharacter,
  type WorkshopProjectBibles,
  type WsColorPalette,
  type WsProp,
  type WsScene,
  type WsShot,
  emptyWorkshopData,
  STEP_ORDER,
} from '@/lib/workshop/types';
import { runGeneration, abortCanvasTask } from '@/lib/canvasGen';
import { useCanvasTaskStore } from '@/stores/canvasTaskStore';
import type { RhtvParams } from '@/lib/rhtv/types';
import { loadStyleLibrary } from '@/lib/styleLibrary';
import {
  applyMidjourneyStylePrompt,
  ensureMidjourneyStyleReference,
  getMidjourneyStyle,
  loadMidjourneyStyleLibrary,
  resolveMidjourneyStyleParameters,
} from '@/lib/midjourney/styles';
import { MIDJOURNEY_DEFAULT_VERSION, normalizeMidjourneyVersion } from '@/lib/midjourney/prompt';
import { formatSeedanceValidation, validateSeedancePrompt } from '@/lib/seedance/validation';
import {
  buildColorPalettePrompt,
  buildPaletteUsagePrompt,
  ensureDefaultColorPalettes,
} from '@/lib/workshop/colorPalettes';
import { ensureVideoThumb } from '@/lib/canvas/videoThumbs';
import {
  buildImageRefBindings,
  buildVideoRefBindings,
  numToCn,
  remapShotPromptRefs,
  shotReferenceSignature,
  videoPromptForShot,
} from '@/lib/workshop/shotRefs';
import { DREAMINA_SEEDANCE_25_ENGINE_ID } from '@/lib/dreamina/video';
import { writeGlobalVideoPromptTemplate } from '@/lib/videoPrompt/prompt';

export { getSceneReferencePaths } from '@/lib/workshop/shotRefs';

const WORKSHOP_FILE = 'workshop.json';
const SCENE_VARIANTS = [
  { role: 'wide', label: '远景', hint: '全景/远景，交代空间结构、入口出口、主要动线和光源方向' },
  { role: 'medium', label: '中景', hint: '中景，保留空间关系，适合人物调度与动作发生' },
  { role: 'close', label: '近景', hint: '近景，聚焦关键区域、质感、陈设和可被角色触碰的细节' },
  { role: 'detail', label: '细节', hint: '特写/细节图，强调材质、道具摆放、光影纹理与氛围锚点' },
] as const;

function cloneCandidates(candidates?: AssetCandidate[]): AssetCandidate[] | undefined {
  return candidates?.map((item) => ({ ...item }));
}

function asArray<T>(items: T[] | null | undefined): T[] {
  return Array.isArray(items) ? items : [];
}

function createShotId(projectId: string): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `shot-${projectId}-${random}`;
}

function ensureShotIds(shots: WsShot[], projectId: string): WsShot[] {
  const used = new Set<string>();
  return shots.map((shot) => {
    let id = shot.id;
    if (!id || used.has(id)) id = createShotId(projectId);
    used.add(id);
    return id === shot.id ? shot : { ...shot, id };
  });
}

function shotsNeedIdMigration(shots: WsShot[]): boolean {
  const ids = shots.map((shot) => shot.id).filter(Boolean) as string[];
  return ids.length !== shots.length || new Set(ids).size !== ids.length;
}

function cloneWorkshopData(data: WorkshopData): WorkshopData {
  return {
    ...data,
    breakdownSourceEvidence: data.breakdownSourceEvidence
      ? [...data.breakdownSourceEvidence]
      : data.breakdownSourceEvidence,
    episodes: (data.episodes ?? []).map((item) => ({ ...item })),
    steps: { ...data.steps },
    changelog: (data.changelog ?? []).map((item) => ({ ...item })),
    characters: (data.characters ?? []).map((item) => ({
      ...item,
      lifecycleStages: item.lifecycleStages?.map((stage) => ({ ...stage })),
      candidates: cloneCandidates(item.candidates),
    })),
    scenes: (data.scenes ?? []).map((item) => ({
      ...item,
      selectedImagePaths: item.selectedImagePaths ? [...item.selectedImagePaths] : item.selectedImagePaths,
      candidates: cloneCandidates(item.candidates),
    })),
    props: (data.props ?? []).map((item) => ({
      ...item,
      candidates: cloneCandidates(item.candidates),
    })),
    colorPalettes: (data.colorPalettes ?? []).map((item) => ({
      ...item,
      colors: item.colors?.map((color) => ({ ...color })),
      candidates: cloneCandidates(item.candidates),
    })),
    shots: (data.shots ?? []).map((shot) => ({
      ...shot,
      characterIds: [...(shot.characterIds ?? [])],
      propIds: shot.propIds ? [...shot.propIds] : shot.propIds,
      sceneImagePaths: shot.sceneImagePaths ? [...shot.sceneImagePaths] : shot.sceneImagePaths,
      extraRefImages: shot.extraRefImages ? [...shot.extraRefImages] : shot.extraRefImages,
      directorPrevisVideoPaths: shot.directorPrevisVideoPaths ? [...shot.directorPrevisVideoPaths] : shot.directorPrevisVideoPaths,
      storyboardFrames: shot.storyboardFrames?.map((frame) => ({
        ...frame,
        refImagePaths: frame.refImagePaths ? [...frame.refImagePaths] : frame.refImagePaths,
        candidates: cloneCandidates(frame.candidates),
      })),
      storyboardBoards: shot.storyboardBoards?.map((board) => ({
        ...board,
        frameIds: asArray(board.frameIds),
      })),
      directorConstraintCard: shot.directorConstraintCard
        ? {
            ...shot.directorConstraintCard,
            candidates: cloneCandidates(shot.directorConstraintCard.candidates),
          }
        : undefined,
      voiceCharacterIds: [...(shot.voiceCharacterIds ?? [])],
      audioPrompts: shot.audioPrompts?.map((item) => ({ ...item })),
      generatedAudios: shot.generatedAudios?.map((item) => ({ ...item })),
    })),
    bibles: data.bibles
      ? {
          ...data.bibles,
          director: data.bibles.director ? {
            ...data.bibles.director,
            cameraRules: asArray(data.bibles.director.cameraRules),
            lightingRules: asArray(data.bibles.director.lightingRules),
            colorRules: asArray(data.bibles.director.colorRules),
            pacingRules: asArray(data.bibles.director.pacingRules),
            forbidden: asArray(data.bibles.director.forbidden),
          } : undefined,
          character: data.bibles.character ? {
            ...data.bibles.character,
            rules: asArray(data.bibles.character.rules).map((rule) => ({
              ...rule,
              costumeRules: asArray(rule.costumeRules),
              voiceRules: rule.voiceRules,
              lifecycleRules: rule.lifecycleRules ? asArray(rule.lifecycleRules) : rule.lifecycleRules,
            })),
            globalRules: asArray(data.bibles.character.globalRules),
          } : undefined,
          scene: data.bibles.scene ? {
            ...data.bibles.scene,
            rules: asArray(data.bibles.scene.rules).map((rule) => ({
              ...rule,
              textureRules: asArray(rule.textureRules),
            })),
            globalRules: asArray(data.bibles.scene.globalRules),
          } : undefined,
          continuity: data.bibles.continuity ? {
            ...data.bibles.continuity,
            lockedItems: asArray(data.bibles.continuity.lockedItems),
            blockingContinuity: asArray(data.bibles.continuity.blockingContinuity),
            referenceOrderRules: asArray(data.bibles.continuity.referenceOrderRules),
            costumeContinuity: asArray(data.bibles.continuity.costumeContinuity),
            propContinuity: asArray(data.bibles.continuity.propContinuity),
            lightingContinuity: asArray(data.bibles.continuity.lightingContinuity),
            editContinuity: asArray(data.bibles.continuity.editContinuity),
          } : undefined,
        }
      : data.bibles,
    style: data.style ? { ...data.style } : data.style,
  };
}

function shotRefContext(data: WorkshopData) {
  return {
    scenes: data.scenes,
    characters: data.characters,
    props: data.props ?? [],
    colorPalettes: data.colorPalettes ?? [],
    globalColorPaletteId: data.globalColorPaletteId,
  };
}

/**
 * 全局资产换图后同步所有受影响分镜。编号按资产语义身份重排，
 * 不再依赖旧文件路径碰运气；未受影响的分镜保持原引用，避免全表抖动。
 */
function reconcileAssetReferenceChange(oldData: WorkshopData, nextData: WorkshopData): WorkshopData {
  const oldCtx = shotRefContext(oldData);
  const nextCtx = shotRefContext(nextData);
  const shots = nextData.shots.map((nextShot) => {
    const oldShot = oldData.shots.find((shot) => (shot.id && shot.id === nextShot.id) || shot.shotNo === nextShot.shotNo);
    if (!oldShot) return nextShot;
    if (shotReferenceSignature(oldShot, oldCtx) === shotReferenceSignature(nextShot, nextCtx)) return nextShot;
    return {
      ...nextShot,
      ...remapShotPromptRefs(oldShot, nextShot, oldCtx, nextCtx),
      promptNeedsRefresh: true,
    };
  });
  return { ...nextData, shots };
}

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

/**
 * 受影响分镜的引用字段反向补丁：只存 stripAssetFromShots 实际改动过的字段，
 * 未改动的字段不进 patch（undo 自然不碰）。undo 把被删项逐项合并回分镜当前值，
 * 不整组覆盖——删除后用户对同一分镜的后续编辑因此保留。
 */
interface ShotDeletePatch {
  /** 优先使用稳定身份；shotNo 仅用于兼容旧撤销记录。 */
  shotId?: string;
  shotNo: string;
  /** strip 清空了 sceneId 时记录旧值（即被删资产 id） */
  sceneId?: string;
  /** strip 从对应数组移除的 id 及原下标（恒为被删资产 id 一项） */
  characterIds?: RemovedId[];
  propIds?: RemovedId[];
  voiceCharacterIds?: RemovedId[];
  /** strip 按 characterId 匹配移除的配音条目（删除前拷贝） */
  audioPrompts?: WsShot['audioPrompts'];
  generatedAudios?: GeneratedAudio[];
  /** strip 把它从 false/undefined 翻成 true 时记录 true 标记；undo 据此保守保持 true */
  promptNeedsRefresh?: boolean;
}

/** 被 strip 移除的 id 及其在原数组中的下标（undo 按原位插回，保持数组相对顺序） */
interface RemovedId {
  id: string;
  index: number;
}

interface LastDeleteBase {
  id: string;
  name: string;
  affectedShots: number;
  /** 被删资产在原数组中的下标（undo 按原位插回，越界则 push） */
  assetIndex: number;
  /** 每个受影响分镜的反向补丁（只含 strip 实际改动的字段） */
  shotPatches: ShotDeletePatch[];
}

/** 最近一次资产级联删除的局部反向补丁（内存态，可撤销一次，不落盘） */
type LastDelete =
  | (LastDeleteBase & { kind: 'character'; asset: WsCharacter })
  | (LastDeleteBase & { kind: 'scene'; asset: WsScene })
  | (LastDeleteBase & { kind: 'prop'; asset: WsProp });

/**
 * 级联清理资产引用：从所有分镜的 characterIds/propIds/voiceCharacterIds 剔除 id，
 * sceneId === id 的置空；配音数据 audioPrompts/generatedAudios 按 characterId 匹配剔除。
 * 被清理且已有提示词的分镜标记 promptNeedsRefresh。
 * 同时返回每个受影响分镜的反向补丁（只含本次实际改动的字段），供 undoLastDelete 逐项合并。
 */
function stripAssetFromShots(shots: WsShot[], id: string): { shots: WsShot[]; affected: number; patches: ShotDeletePatch[] } {
  let affected = 0;
  const patches: ShotDeletePatch[] = [];
  const next = shots.map((shot) => {
    const inChars = shot.characterIds.includes(id);
    const inProps = shot.propIds?.includes(id) ?? false;
    const inVoices = shot.voiceCharacterIds?.includes(id) ?? false;
    const inScene = shot.sceneId === id;
    const inAudioPrompts = shot.audioPrompts?.some((a) => a.characterId === id) ?? false;
    const inGenAudios = shot.generatedAudios?.some((a) => a.characterId === id) ?? false;
    if (!inChars && !inProps && !inVoices && !inScene && !inAudioPrompts && !inGenAudios) return shot;
    affected += 1;
    // 只记录本函数实际改动的字段；id 数组记录原下标供 undo 原位插回，拷贝移除的条目避免与 state 共享引用
    const patch: ShotDeletePatch = { shotId: shot.id, shotNo: shot.shotNo };
    if (inScene) patch.sceneId = id;
    if (inChars) patch.characterIds = [{ id, index: shot.characterIds.indexOf(id) }];
    if (inProps) patch.propIds = [{ id, index: shot.propIds!.indexOf(id) }];
    if (inVoices) patch.voiceCharacterIds = [{ id, index: shot.voiceCharacterIds!.indexOf(id) }];
    if (inAudioPrompts) {
      patch.audioPrompts = shot.audioPrompts!.filter((a) => a.characterId === id).map((a) => ({ ...a }));
    }
    if (inGenAudios) {
      patch.generatedAudios = shot.generatedAudios!.filter((a) => a.characterId === id).map((a) => ({ ...a }));
    }
    const patched: WsShot = {
      ...shot,
      characterIds: inChars ? shot.characterIds.filter((c) => c !== id) : shot.characterIds,
      propIds: inProps ? shot.propIds!.filter((p) => p !== id) : shot.propIds,
      voiceCharacterIds: inVoices ? shot.voiceCharacterIds!.filter((c) => c !== id) : shot.voiceCharacterIds,
      sceneId: inScene ? undefined : shot.sceneId,
      audioPrompts: inAudioPrompts ? shot.audioPrompts!.filter((a) => a.characterId !== id) : shot.audioPrompts,
      generatedAudios: inGenAudios ? shot.generatedAudios!.filter((a) => a.characterId !== id) : shot.generatedAudios,
    };
    if (patched.imagePrompt || patched.videoPrompt) {
      // 仅从 false/undefined 翻成 true 才记录 true 标记，否则 patch 不存该字段（undo 不碰）
      if (!shot.promptNeedsRefresh) patch.promptNeedsRefresh = true;
      patched.promptNeedsRefresh = true;
    }
    patches.push(patch);
    return patched;
  });
  return { shots: next, affected, patches };
}

/** 按原位插回资产；下标越界时 clamp 到末尾（等价 push） */
function insertAt<T>(list: T[], item: T, index: number): T[] {
  const idx = Math.min(Math.max(index, 0), list.length);
  return [...list.slice(0, idx), item, ...list.slice(idx)];
}

/**
 * 把被移除的 id 按原下标插回当前数组（insertAt clamp 到 min(原下标, 当前长度)，已存在则跳过；
 * 全部已存在时原样返回，保留原引用）。保持数组相对顺序——参考图编号 @图片N 按
 * characterIds/propIds 数组顺序生成，append 到末尾会改变编号对应关系。
 */
function mergeBackIds(current: string[] | undefined, removed: RemovedId[]): string[] {
  let next = current ?? [];
  for (const { id, index } of removed) {
    if (next.includes(id)) continue;
    next = insertAt(next, id, index);
  }
  return next;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

interface WorkshopState {
  project: AigcProject | null;
  data: WorkshopData | null;
  loading: boolean;

  openProject: (id: string) => Promise<void>;
  createAndOpen: (name: string) => Promise<void>;
  save: () => Promise<void>;
  commitNow: () => Promise<void>;
  reloadCurrent: () => Promise<void>;
  scheduleSave: () => void;
  close: () => void;

  setCurrentStep: (s: WorkshopStepId) => void;
  markStepStatus: (s: WorkshopStepId, status: 'pending' | 'in-progress' | 'done') => void;
  setStepLarkDoc: (s: WorkshopStepId, url: string) => void;
  /** 上游变更后把下游已完成步骤标 stale */
  invalidateDownstream: (from: WorkshopStepId) => void;
  logChange: (step: WorkshopStepId, summary: string) => void;

  setSynopsis: (text: string) => void;
  setEpisodes: (eps: WorkshopData['episodes']) => void;
  upsertCharacters: (chars: WsCharacter[]) => void;
  removeCharacter: (id: string) => void;
  upsertScenes: (scenes: WsScene[]) => void;
  removeScene: (id: string) => void;
  upsertProps: (props: WsProp[]) => void;
  removeProp: (id: string) => void;
  /** 最近一次资产级联删除的局部反向补丁（内存态，可撤销一次，不落盘） */
  lastDelete: LastDelete | null;
  /** 撤销最近一次资产删除：资产按 assetIndex 插回原数组；受影响分镜把被删项逐项合并回当前值，不整组覆盖 */
  undoLastDelete: () => void;
  /** 删除前查询资产影响范围：shots=引用该资产的分镜数，voices=其中引用其音色的分镜数 */
  getAssetRefInfo: (kind: 'character' | 'scene' | 'prop', id: string) => { shots: number; voices: number; name: string };
  setShots: (shots: WsShot[], mode?: 'replace' | 'merge') => void;
  updateShot: (shotNo: string, patch: Partial<WsShot>) => void;
  removeShot: (shotNo: string) => void;
  /** 写入资产提示词：engine='mj' 写 assetPromptMj，否则写 assetPrompt */
  setAssetPrompt: (kind: WorkshopAssetKind, id: string, prompt: string, engine?: 'gpt' | 'mj') => void;
  setAssetImage: (kind: WorkshopAssetKind, id: string, absPath: string) => void;
  /** 追加候选图（永不删除），select=true 时同时设为最终图 */
  addAssetCandidate: (kind: WorkshopAssetKind, id: string, candidate: AssetCandidate, select?: boolean) => void;
  /** 从候选集中选定最终图 */
  selectAssetCandidate: (kind: WorkshopAssetKind, id: string, path: string) => void;
  setSceneSelectedImages: (id: string, paths: string[]) => void;
  setShotSceneImages: (shotNo: string, paths?: string[], markRefresh?: boolean) => void;
  setAssetEngine: (kind: WorkshopAssetKind, id: string, engineId: string) => void;
  setAssetResolution: (kind: WorkshopAssetKind, id: string, resolution: string) => void;
  setAssetAspectRatio: (kind: WorkshopAssetKind, id: string, aspectRatio: string) => void;
  upsertColorPalette: (palette: WsColorPalette) => void;
  removeColorPalette: (id: string) => void;
  setGlobalColorPalette: (id?: string) => void;
  setColorPaletteUsagePrompt: (id: string, usagePrompt: string) => void;
  updateColorPaletteColors: (id: string, colors: PaletteColor[]) => void;
  setCharacterVoice: (characterId: string, voicePath: string, source: 'upload' | 'canvas' | 'tts') => void;
  removeCharacterVoice: (characterId: string) => void;
  setStyle: (style: WorkshopData['style']) => void;
  setBibles: (bibles: WorkshopProjectBibles) => void;
  /** 设置全局视频比例（分镜未单独设置时 fallback） */
  setVideoRatio: (ratio: string) => void;
  /** 设置全局视频模型（分镜未单独设置时 fallback） */
  setVideoModel: (model: string) => void;
  /** 设置全局视频提示词模板（分镜未单独设置时 fallback） */
  setVideoPromptTemplate: (template: 'legacy' | 'universal') => void;

  generateAsset: (kind: WorkshopAssetKind, id: string, engineId?: string) => Promise<void>;
  generateSceneVariants: (id: string) => Promise<void>;
  generateShot: (shotNo: string, kind: 'image' | 'video', options?: { skipPromptValidation?: boolean }) => Promise<void>;
  generateAll: (kind: 'image' | 'video', onlyMissing?: boolean) => Promise<void>;
  cancelShot: (shotNo: string) => void;

  getStateSummary: () => string;
}

/** 把生成产物拷贝进项目目录，返回绝对路径 */
async function copyIntoProject(projectId: string, srcAbs: string, relDir: string, baseName: string): Promise<string> {
  const home = await homeDir();
  const ext = srcAbs.includes('.') ? srcAbs.slice(srcAbs.lastIndexOf('.')) : '';
  const rel = `.kunpeng/aigc-memory/projects/${projectId}/${relDir}`;
  await createDir(rel, { dir: BaseDirectory.Home, recursive: true }).catch(() => {});
  const destRel = `${rel}/${baseName}${ext}`;
  await copyFile(srcAbs, destRel, { dir: BaseDirectory.Home });
  return `${home}${destRel}`;
}

/** 安全文件名（shotNo 可能含 ①②/中文） */
function safeName(s: string): string {
  return s.replace(/[^\w一-龥-]+/g, '_');
}

async function attachDefaultPaletteImages(data: WorkshopData): Promise<void> {
  const home = await homeDir();
  for (const p of data.colorPalettes ?? []) {
    if (p.source !== 'default' || p.assetImagePath) continue;
    const rel = `.kunpeng/default-palettes/${p.id}.png`;
    const ok = await exists(rel, { dir: BaseDirectory.Home }).catch(() => false);
    if (!ok) continue;
    const abs = `${home}${rel}`;
    p.assetImagePath = abs;
    p.candidates = p.candidates?.some((c) => c.path === abs)
      ? p.candidates
      : [...(p.candidates ?? []), { path: abs, source: 'default', prompt: p.assetPrompt, createdAt: p.createdAt || Date.now() }];
  }
}

export const useWorkshopStore = create<WorkshopState>((set, get) => ({
  project: null,
  data: null,
  loading: false,
  lastDelete: null,

  openProject: async (id) => {
    // 旧项目还有 800ms debounce 内未落盘的编辑时先 flush——否则定时器在
    // 新项目打开后才触发，save() 拿到的是新项目 state，旧项目最后一笔编辑丢失
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      const prev = get();
      if (prev.project && prev.data && prev.project.id !== id) {
        await get().save().catch((err) => console.warn('[workshop] 切换项目前保存旧项目失败:', err));
      }
    }
    set({ loading: true });
    try {
      const project = await readProject(id);
      if (!project) return;
      const raw = await readProjectFile(id, WORKSHOP_FILE);
      const data = safeParse<WorkshopData>(raw) ?? emptyWorkshopData(id);
      if (data.projectId !== id) data.projectId = id;
      // 旧文件缺字段兜底
      if (!data.changelog) data.changelog = [];
      data.colorPalettes = ensureDefaultColorPalettes(data.colorPalettes);
      // 迁移：有 assetImagePath 但无 candidates 的补一条
      const backfill = <T extends WsCharacter | WsScene | WsProp>(item: T): T =>
        item.assetImagePath && !item.candidates?.length
          ? { ...item, candidates: [{ path: item.assetImagePath, source: 'upload' as const, createdAt: Date.now() }] }
          : item;
      const backfillPalette = (item: WsColorPalette): WsColorPalette =>
        item.assetImagePath && !item.candidates?.length
          ? { ...item, candidates: [{ path: item.assetImagePath, source: item.source === 'default' ? 'default' : 'upload', createdAt: item.createdAt || Date.now() }] }
          : item;
      data.characters = (data.characters ?? []).map(backfill);
      data.scenes = (data.scenes ?? []).map(backfill);
      data.props = (data.props ?? []).map(backfill);
      data.colorPalettes = data.colorPalettes.map(backfillPalette);
      await attachDefaultPaletteImages(data);
      const migrateShotIds = shotsNeedIdMigration(data.shots ?? []);
      data.shots = ensureShotIds((data.shots ?? []).map((s) => ({
        ...s,
        characterIds: s.characterIds ?? [],
        propIds: s.propIds ?? [],
        voiceCharacterIds: s.voiceCharacterIds ?? [],
        description: s.description ?? '',
      })), project.id);
      if (migrateShotIds) {
        await writeProjectFile(project.id, WORKSHOP_FILE, JSON.stringify(data, null, 2));
      }
      // genStatus 脏状态修复
      const home = await homeDir();
      for (const shot of data.shots) {
        if (shot.genStatus === 'generating' || shot.genStatus === 'queued') {
          shot.genStatus = 'idle';
          shot.genTaskId = undefined;
        }
        if (shot.genStatus === 'failed') {
          let fileFound = false;
          for (const p of [shot.imagePath, shot.videoPath]) {
            if (p) {
              try {
                const rel = p.startsWith(home) ? p.slice(home.length) : p;
                fileFound = await exists(rel, { dir: BaseDirectory.Home });
              } catch { /* ignore */ }
              if (fileFound) break;
            }
          }
          if (fileFound) {
            shot.genStatus = 'done';
            shot.genError = undefined;
          }
        }
      }
      set({ project, data: cloneWorkshopData(data), lastDelete: null });
    } finally {
      set({ loading: false });
    }
  },

  createAndOpen: async (name) => {
    set({ loading: true });
    try {
      const project = await createProject(name);
      const data = emptyWorkshopData(project.id);
      data.colorPalettes = ensureDefaultColorPalettes(data.colorPalettes);
      await attachDefaultPaletteImages(data);
      set({ project, data: cloneWorkshopData(data), lastDelete: null });
      await writeProjectFile(project.id, WORKSHOP_FILE, JSON.stringify(data, null, 2));
    } finally {
      set({ loading: false });
    }
  },

  save: async () => {
    const { project, data } = get();
    if (!project || !data) return;
    // 保险丝：state 读取时序异常时绝不把 A 项目数据写进 B 的 workshop.json
    if (data.projectId && data.projectId !== project.id) {
      console.error(`[workshop] save 中止：data.projectId(${data.projectId}) 与当前项目(${project.id})不符`);
      return;
    }
    await writeProjectFile(project.id, WORKSHOP_FILE, JSON.stringify(data, null, 2));
    // 回写 index 统计，记忆库项目列表共享
    const stats = {
      shots: data.shots.length,
      scenes: data.scenes.length,
      assets: data.characters.filter((c) => c.assetImagePath).length
        + data.scenes.filter((s) => s.assetImagePath).length
        + (data.colorPalettes ?? []).filter((p) => p.assetImagePath).length,
      videosCompleted: data.shots.filter((s) => s.videoPath).length,
    };
    await writeProject({ ...project, stats });
  },

  commitNow: async () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    // 所有写入路径本身都做不可变更新。这里不再深拷贝整份项目：
    // 大项目下每次 Agent 工具提交都会让所有分镜、图片和提示词组件重渲染。
    // save 是纯数据落盘（workshop.json + 项目元数据），不等 requestAnimationFrame；
    // 期间每个 IPC await 都会让出事件循环，React 有机会提交帧。
    await get().save();
  },

  reloadCurrent: async () => {
    const { project } = get();
    if (!project) return;
    // 先 flush 内存里未落盘的编辑（800ms debounce 窗口），否则从磁盘读回
    // 旧数据会静默回滚用户刚才的修改
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      await get().save().catch(() => {});
    }
    const raw = await readProjectFile(project.id, WORKSHOP_FILE);
    const data = safeParse<WorkshopData>(raw);
    if (!data) return;
    data.projectId = project.id;
    if (!data.changelog) data.changelog = [];
    data.colorPalettes = ensureDefaultColorPalettes(data.colorPalettes);
    await attachDefaultPaletteImages(data);
    const migrateShotIds = shotsNeedIdMigration(data.shots ?? []);
    data.shots = ensureShotIds((data.shots ?? []).map((s) => ({
      ...s,
      characterIds: s.characterIds ?? [],
      propIds: s.propIds ?? [],
      voiceCharacterIds: s.voiceCharacterIds ?? [],
      description: s.description ?? '',
    })), project.id);
    if (migrateShotIds) {
      await writeProjectFile(project.id, WORKSHOP_FILE, JSON.stringify(data, null, 2));
    }
    set({ data: cloneWorkshopData(data) });
  },

  scheduleSave: () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { void get().save(); }, 800);
  },

  close: () => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    void get().save();
    set({ project: null, data: null, lastDelete: null });
  },

  setCurrentStep: (s) => {
    const { data } = get();
    if (!data) return;
    set({ data: { ...data, currentStep: s } });
    get().scheduleSave();
  },

  markStepStatus: (s, status) => {
    const { data } = get();
    if (!data) return;
    set({
      data: {
        ...data,
        steps: { ...data.steps, [s]: { ...data.steps[s], status, updatedAt: Date.now() } },
      },
    });
    get().scheduleSave();
  },

  setStepLarkDoc: (s, url) => {
    const { data } = get();
    if (!data) return;
    set({
      data: {
        ...data,
        steps: { ...data.steps, [s]: { ...data.steps[s], larkDocUrl: url, updatedAt: Date.now() } },
      },
    });
    get().scheduleSave();
  },

  invalidateDownstream: (from) => {
    const { data } = get();
    if (!data) return;
    const fromIdx = STEP_ORDER.indexOf(from);
    const steps = { ...data.steps };
    for (const id of STEP_ORDER.slice(fromIdx + 1)) {
      if (steps[id].status === 'done') {
        steps[id] = { ...steps[id], status: 'stale', updatedAt: Date.now() };
      }
    }
    set({ data: { ...data, steps } });
    get().scheduleSave();
  },

  logChange: (step, summary) => {
    const { data } = get();
    if (!data) return;
    set({
      data: {
        ...data,
        changelog: [...data.changelog.slice(-99), { at: Date.now(), step, summary }],
      },
    });
    get().scheduleSave();
  },

  setSynopsis: (text) => {
    const { data } = get();
    if (!data) return;
    set({ data: { ...data, synopsis: text } });
    get().invalidateDownstream('breakdown');
  },

  setEpisodes: (eps) => {
    const { data } = get();
    if (!data) return;
    set({ data: { ...data, episodes: eps } });
    get().invalidateDownstream('breakdown');
  },

  upsertCharacters: (chars) => {
    const { data } = get();
    if (!data) return;
    const map = new Map(data.characters.map((c) => [c.id, c]));
    for (const c of chars) map.set(c.id, { ...map.get(c.id), ...c });
    set({ data: { ...data, characters: [...map.values()] } });
    get().scheduleSave();
  },

  removeCharacter: (id) => {
    const { data } = get();
    if (!data) return;
    const assetIndex = data.characters.findIndex((c) => c.id === id);
    if (assetIndex < 0) return;
    const target = data.characters[assetIndex];
    // 只存局部反向补丁（资产 + 受影响分镜的引用字段），undo 不覆盖用户后续编辑
    const { shots, affected, patches } = stripAssetFromShots(data.shots, id);
    set({
      data: { ...data, characters: data.characters.filter((c) => c.id !== id), shots },
      lastDelete: { kind: 'character', id, name: target.name, affectedShots: affected, asset: target, assetIndex, shotPatches: patches },
    });
    get().scheduleSave();
  },

  upsertScenes: (scenes) => {
    const { data } = get();
    if (!data) return;
    const map = new Map(data.scenes.map((s) => [s.id, s]));
    for (const s of scenes) map.set(s.id, { ...map.get(s.id), ...s });
    set({ data: { ...data, scenes: [...map.values()] } });
    get().scheduleSave();
  },

  removeScene: (id) => {
    const { data } = get();
    if (!data) return;
    const assetIndex = data.scenes.findIndex((s) => s.id === id);
    if (assetIndex < 0) return;
    const target = data.scenes[assetIndex];
    // 只存局部反向补丁（资产 + 受影响分镜的引用字段），undo 不覆盖用户后续编辑
    const { shots, affected, patches } = stripAssetFromShots(data.shots, id);
    set({
      data: { ...data, scenes: data.scenes.filter((s) => s.id !== id), shots },
      lastDelete: { kind: 'scene', id, name: target.name, affectedShots: affected, asset: target, assetIndex, shotPatches: patches },
    });
    get().scheduleSave();
  },

  upsertProps: (props) => {
    const { data } = get();
    if (!data) return;
    const map = new Map((data.props ?? []).map((p) => [p.id, p]));
    for (const p of props) map.set(p.id, { ...map.get(p.id), ...p });
    set({ data: { ...data, props: [...map.values()] } });
    get().scheduleSave();
  },

  removeProp: (id) => {
    const { data } = get();
    if (!data) return;
    const assetIndex = (data.props ?? []).findIndex((p) => p.id === id);
    if (assetIndex < 0) return;
    const target = (data.props ?? [])[assetIndex];
    // 只存局部反向补丁（资产 + 受影响分镜的引用字段），undo 不覆盖用户后续编辑
    const { shots, affected, patches } = stripAssetFromShots(data.shots, id);
    set({
      data: { ...data, props: (data.props ?? []).filter((p) => p.id !== id), shots },
      lastDelete: { kind: 'prop', id, name: target.name, affectedShots: affected, asset: target, assetIndex, shotPatches: patches },
    });
    get().scheduleSave();
  },

  undoLastDelete: () => {
    const { data, lastDelete } = get();
    if (!data || !lastDelete) return;
    // 逐字段把被删项合并回分镜当前值（不整组覆盖）：删除后用户对同一分镜的后续编辑保留
    const patchById = new Map(lastDelete.shotPatches.filter((p) => p.shotId).map((p) => [p.shotId!, p]));
    const legacyPatchByShotNo = new Map(lastDelete.shotPatches.filter((p) => !p.shotId).map((p) => [p.shotNo, p]));
    const shots = data.shots.map((shot) => {
      const patch = (shot.id ? patchById.get(shot.id) : undefined) ?? legacyPatchByShotNo.get(shot.shotNo);
      if (!patch) return shot; // 分镜已被删或不受影响，跳过
      const merged: WsShot = { ...shot };
      // string[]：被删 id 不在当前数组才按原下标插回（保持参考图编号顺序），用户后续新增的其他 id 保留
      if (patch.characterIds) merged.characterIds = mergeBackIds(shot.characterIds, patch.characterIds);
      if (patch.propIds) merged.propIds = mergeBackIds(shot.propIds, patch.propIds);
      if (patch.voiceCharacterIds) merged.voiceCharacterIds = mergeBackIds(shot.voiceCharacterIds, patch.voiceCharacterIds);
      // sceneId：仅当分镜当前未另选场景时才恢复旧值；用户已另选则保留用户的
      if (patch.sceneId !== undefined && shot.sceneId === undefined) merged.sceneId = patch.sceneId;
      // 配音条目：按 characterId 去重加回；同角色已有新条目（用户重新生成）则跳过
      if (patch.audioPrompts) {
        const existing = new Set((shot.audioPrompts ?? []).map((a) => a.characterId));
        const back = patch.audioPrompts.filter((a) => !existing.has(a.characterId));
        if (back.length) merged.audioPrompts = [...(shot.audioPrompts ?? []), ...back.map((a) => ({ ...a }))];
      }
      if (patch.generatedAudios) {
        const existing = new Set((shot.generatedAudios ?? []).map((a) => a.characterId));
        const back = patch.generatedAudios.filter((a) => !existing.has(a.characterId));
        if (back.length) merged.generatedAudios = [...(shot.generatedAudios ?? []), ...back.map((a) => ({ ...a }))];
      }
      // promptNeedsRefresh：不恢复删除前的旧值——若用户窗口期改过/重新生成过提示词，撤销资产后
      // 提示词再次失效。strip 翻转过的分镜保守置 true；patch 没存说明与本删除无关，不碰
      if (patch.promptNeedsRefresh) merged.promptNeedsRefresh = true;
      return merged;
    });
    const next: WorkshopData = { ...data, shots };
    // 资产按 assetIndex 插回原数组；同 id 已存在（窗口期内被重建）则不重复插入
    if (lastDelete.kind === 'character') {
      next.characters = data.characters.some((c) => c.id === lastDelete.id)
        ? data.characters
        : insertAt(data.characters, lastDelete.asset, lastDelete.assetIndex);
    } else if (lastDelete.kind === 'scene') {
      next.scenes = data.scenes.some((s) => s.id === lastDelete.id)
        ? data.scenes
        : insertAt(data.scenes, lastDelete.asset, lastDelete.assetIndex);
    } else {
      next.props = (data.props ?? []).some((p) => p.id === lastDelete.id)
        ? data.props
        : insertAt(data.props ?? [], lastDelete.asset, lastDelete.assetIndex);
    }
    set({ data: next, lastDelete: null });
    get().scheduleSave();
  },

  getAssetRefInfo: (kind, id) => {
    const { data } = get();
    if (!data) return { shots: 0, voices: 0, name: '' };
    const list = kind === 'character' ? data.characters : kind === 'scene' ? data.scenes : (data.props ?? []);
    const name = list.find((x) => x.id === id)?.name ?? '';
    let shots = 0;
    let voices = 0;
    for (const s of data.shots) {
      // 配音引用：voiceCharacterIds 音色资产 + audioPrompts/generatedAudios 配音数据（均按 characterId 匹配）
      const refVoice = (s.voiceCharacterIds?.includes(id) ?? false)
        || (s.audioPrompts?.some((a) => a.characterId === id) ?? false)
        || (s.generatedAudios?.some((a) => a.characterId === id) ?? false);
      const refVisual = s.sceneId === id || s.characterIds.includes(id) || (s.propIds?.includes(id) ?? false);
      if (refVisual || refVoice) shots += 1;
      if (refVoice) voices += 1;
    }
    return { shots, voices, name };
  },

  setShots: (shots, mode = 'replace') => {
    const { data } = get();
    if (!data) return;
    let next: WsShot[];
    if (mode === 'merge') {
      const map = new Map(data.shots.map((s) => [s.shotNo, s]));
      for (const s of shots) {
        const existing = map.get(s.shotNo);
        map.set(s.shotNo, {
          ...existing,
          ...s,
          id: s.id ?? existing?.id ?? createShotId(data.projectId),
          characterIds: s.characterIds ?? existing?.characterIds ?? [],
          voiceCharacterIds: s.voiceCharacterIds ?? existing?.voiceCharacterIds ?? [],
        });
      }
      next = [...map.values()];
    } else {
      const oldByShotNo = new Map(data.shots.map((s) => [s.shotNo, s]));
      next = shots.map((s) => ({
        ...s,
        id: s.id ?? oldByShotNo.get(s.shotNo)?.id ?? createShotId(data.projectId),
        characterIds: s.characterIds ?? [],
        voiceCharacterIds: s.voiceCharacterIds ?? [],
      }));
    }
    set({ data: { ...data, shots: ensureShotIds(next, data.projectId) } });
    get().scheduleSave();
  },

  updateShot: (shotNo, patch) => {
    const { data } = get();
    if (!data) return;
    set({
      data: {
        ...data,
        shots: data.shots.map((s) => (s.shotNo === shotNo ? { ...s, ...patch } : s)),
      },
    });
    get().scheduleSave();
  },

  removeShot: (shotNo) => {
    const { data } = get();
    if (!data) return;
    set({ data: { ...data, shots: data.shots.filter((s) => s.shotNo !== shotNo) } });
    get().scheduleSave();
  },

  setAssetPrompt: (kind, id, prompt, engine = 'gpt') => {
    const { data } = get();
    if (!data) return;
    const key = engine === 'mj' ? 'assetPromptMj' as const : 'assetPrompt' as const;
    if (kind === 'character') {
      set({ data: { ...data, characters: data.characters.map((c) => c.id === id ? { ...c, [key]: prompt } : c) } });
    } else if (kind === 'scene') {
      set({ data: { ...data, scenes: data.scenes.map((s) => s.id === id ? { ...s, [key]: prompt } : s) } });
    } else if (kind === 'colorPalette') {
      set({ data: { ...data, colorPalettes: (data.colorPalettes ?? []).map((p) => p.id === id ? { ...p, assetPrompt: prompt } : p) } });
    } else {
      set({ data: { ...data, props: (data.props ?? []).map((p) => p.id === id ? { ...p, [key]: prompt } : p) } });
    }
    get().scheduleSave();
  },

  setAssetImage: (kind, id, absPath) => {
    get().addAssetCandidate(kind, id, { path: absPath, source: 'upload', createdAt: Date.now() }, true);
  },

  addAssetCandidate: (kind, id, candidate, select = false) => {
    const { data } = get();
    if (!data) return;
    const patch = <T extends { candidates?: AssetCandidate[]; assetImagePath?: string }>(item: T): T => {
      const candidates = item.candidates ?? [];
      const exists = candidates.some((c) => c.path === candidate.path);
      return {
        ...item,
        candidates: exists ? candidates : [...candidates, candidate],
        ...(select ? { assetImagePath: candidate.path } : {}),
      };
    };
    let nextData: WorkshopData;
    if (kind === 'character') {
      nextData = { ...data, characters: data.characters.map((c) => c.id === id ? patch(c) as WsCharacter : c) };
    } else if (kind === 'scene') {
      const oldPath = data.scenes.find((scene) => scene.id === id)?.assetImagePath;
      nextData = {
        ...data,
        shots: select && oldPath && oldPath !== candidate.path
          ? data.shots.map((shot) => shot.sceneId === id && shot.sceneImagePaths?.includes(oldPath)
            ? {
                ...shot,
                sceneImagePaths: shot.sceneImagePaths.map((path) => path === oldPath ? candidate.path : path),
              }
            : shot)
          : data.shots,
        scenes: data.scenes.map((s) => s.id === id ? patch(s) as WsScene : s),
      };
    } else if (kind === 'colorPalette') {
      nextData = { ...data, colorPalettes: (data.colorPalettes ?? []).map((p) => p.id === id ? patch(p) as WsColorPalette : p) };
    } else {
      nextData = { ...data, props: (data.props ?? []).map((p) => p.id === id ? patch(p) as WsProp : p) };
    }
    set({ data: select ? reconcileAssetReferenceChange(data, nextData) : nextData });
    if (select) {
      const d = get().data!;
      const allHaveImage =
        d.characters.every((c) => c.assetImagePath) &&
        d.scenes.every((s) => s.assetImagePath) &&
        (d.props ?? []).every((p) => p.assetImagePath);
      if (allHaveImage && d.steps.assets.status === 'in-progress') {
        get().markStepStatus('assets', 'done');
      }
      get().invalidateDownstream('assets');
    }
    else get().scheduleSave();
  },

  selectAssetCandidate: (kind, id, path) => {
    const { data } = get();
    if (!data) return;
    let nextData: WorkshopData;
    if (kind === 'character') {
      nextData = { ...data, characters: data.characters.map((c) => c.id === id ? { ...c, assetImagePath: path } : c) };
    } else if (kind === 'scene') {
      // 场景换图必须传播到已固化 sceneImagePaths 快照的分镜——快照存的是
      // 绝对路径值拷贝，不更新的话 getSceneReferencePaths 永远返回旧图，
      // 生成静默用过期场景（旧文件还在磁盘，无任何报错）。
      const oldPath = data.scenes.find((s) => s.id === id)?.assetImagePath;
      const shots = oldPath && oldPath !== path
        ? data.shots.map((shot) => {
            if (shot.sceneId !== id || !shot.sceneImagePaths?.includes(oldPath)) return shot;
            return {
              ...shot,
              sceneImagePaths: shot.sceneImagePaths.map((p) => (p === oldPath ? path : p)),
              promptNeedsRefresh: true,
            };
          })
        : data.shots;
      nextData = {
        ...data,
        shots,
        scenes: data.scenes.map((s) => s.id === id
          ? { ...s, assetImagePath: path }
          : s),
      };
    } else if (kind === 'colorPalette') {
      nextData = { ...data, colorPalettes: (data.colorPalettes ?? []).map((p) => p.id === id ? { ...p, assetImagePath: path } : p) };
    } else {
      nextData = { ...data, props: (data.props ?? []).map((p) => p.id === id ? { ...p, assetImagePath: path } : p) };
    }
    set({ data: reconcileAssetReferenceChange(data, nextData) });
    get().invalidateDownstream('assets');
  },

  setSceneSelectedImages: (id, paths) => {
    const { data } = get();
    if (!data) return;
    const clean = Array.from(new Set(paths.filter(Boolean)));
    const nextData: WorkshopData = {
      ...data,
      scenes: data.scenes.map((s) => s.id === id
        ? {
            ...s,
            selectedImagePaths: clean,
            sceneReferenceMode: clean.length > 0 ? 'multi' : undefined,
          }
        : s),
    };
    set({ data: reconcileAssetReferenceChange(data, nextData) });
    get().invalidateDownstream('assets');
  },

  setShotSceneImages: (shotNo, paths, markRefresh = true) => {
    const clean = paths ? Array.from(new Set(paths.filter(Boolean))) : undefined;
    const patch: Partial<WsShot> = {
      sceneImagePaths: clean,
      ...(markRefresh ? { promptNeedsRefresh: true } : {}),
    };
    get().updateShot(shotNo, patch);
  },

  setAssetEngine: (kind, id, engineId) => {
    const { data } = get();
    if (!data) return;
    if (kind === 'character') {
      set({ data: { ...data, characters: data.characters.map((c) => c.id === id ? { ...c, assetEngine: engineId } : c) } });
    } else if (kind === 'scene') {
      set({ data: { ...data, scenes: data.scenes.map((s) => s.id === id ? { ...s, assetEngine: engineId } : s) } });
    } else if (kind === 'colorPalette') {
      set({ data: { ...data, colorPalettes: (data.colorPalettes ?? []).map((p) => p.id === id ? { ...p, assetEngine: engineId } : p) } });
    } else {
      set({ data: { ...data, props: (data.props ?? []).map((p) => p.id === id ? { ...p, assetEngine: engineId } : p) } });
    }
    get().scheduleSave();
  },

  setAssetResolution: (kind, id, resolution) => {
    const { data } = get();
    if (!data) return;
    if (kind === 'character') {
      set({ data: { ...data, characters: data.characters.map((c) => c.id === id ? { ...c, assetResolution: resolution } : c) } });
    } else if (kind === 'scene') {
      set({ data: { ...data, scenes: data.scenes.map((s) => s.id === id ? { ...s, assetResolution: resolution } : s) } });
    } else if (kind === 'colorPalette') {
      set({ data: { ...data, colorPalettes: (data.colorPalettes ?? []).map((p) => p.id === id ? { ...p, assetResolution: resolution } : p) } });
    } else {
      set({ data: { ...data, props: (data.props ?? []).map((p) => p.id === id ? { ...p, assetResolution: resolution } : p) } });
    }
    get().scheduleSave();
  },

  setAssetAspectRatio: (kind, id, aspectRatio) => {
    const { data } = get();
    if (!data) return;
    if (kind === 'character') {
      set({ data: { ...data, characters: data.characters.map((c) => c.id === id ? { ...c, assetAspectRatio: aspectRatio } : c) } });
    } else if (kind === 'scene') {
      set({ data: { ...data, scenes: data.scenes.map((s) => s.id === id ? { ...s, assetAspectRatio: aspectRatio } : s) } });
    } else if (kind === 'colorPalette') {
      set({ data: { ...data, colorPalettes: (data.colorPalettes ?? []).map((p) => p.id === id ? { ...p, assetAspectRatio: aspectRatio } : p) } });
    } else {
      set({ data: { ...data, props: (data.props ?? []).map((p) => p.id === id ? { ...p, assetAspectRatio: aspectRatio } : p) } });
    }
    get().scheduleSave();
  },

  upsertColorPalette: (palette) => {
    const { data } = get();
    if (!data) return;
    const exists = (data.colorPalettes ?? []).some((p) => p.id === palette.id);
    const normalized = {
      ...palette,
      assetPrompt: palette.assetPrompt ?? buildColorPalettePrompt(palette.name, palette.description ?? 'cinematic color system', palette.colors ?? []),
      usagePrompt: palette.usagePrompt ?? buildPaletteUsagePrompt(palette.name, palette.colors ?? []),
      assetEngine: palette.assetEngine ?? 'gpt-image-2',
      createdAt: palette.createdAt || Date.now(),
    };
    set({
      data: {
        ...data,
        colorPalettes: exists
          ? (data.colorPalettes ?? []).map((p) => p.id === palette.id ? { ...p, ...normalized } : p)
          : [...(data.colorPalettes ?? []), normalized],
      },
    });
    get().invalidateDownstream('assets');
  },

  removeColorPalette: (id) => {
    const { data } = get();
    if (!data) return;
    set({
      data: {
        ...data,
        colorPalettes: (data.colorPalettes ?? []).filter((p) => p.id !== id),
        globalColorPaletteId: data.globalColorPaletteId === id ? undefined : data.globalColorPaletteId,
        shots: data.shots.map((s) => s.colorPaletteId === id ? { ...s, colorPaletteId: undefined } : s),
      },
    });
    get().invalidateDownstream('assets');
  },

  setGlobalColorPalette: (id) => {
    const { data } = get();
    if (!data) return;
    set({ data: { ...data, globalColorPaletteId: id || undefined } });
    get().invalidateDownstream('prompts');
  },

  setColorPaletteUsagePrompt: (id, usagePrompt) => {
    const { data } = get();
    if (!data) return;
    set({ data: { ...data, colorPalettes: (data.colorPalettes ?? []).map((p) => p.id === id ? { ...p, usagePrompt } : p) } });
    get().invalidateDownstream('prompts');
  },

  updateColorPaletteColors: (id, colors) => {
    const { data } = get();
    if (!data) return;
    set({
      data: {
        ...data,
        colorPalettes: (data.colorPalettes ?? []).map((p) => p.id === id
          ? {
              ...p,
              colors,
              assetPrompt: buildColorPalettePrompt(p.name, p.description ?? 'cinematic color system', colors),
              usagePrompt: buildPaletteUsagePrompt(p.name, colors),
            }
          : p),
      },
    });
    get().invalidateDownstream('assets');
  },

  setCharacterVoice: (characterId, voicePath, source) => {
    const { data } = get();
    if (!data) return;
    set({
      data: {
        ...data,
        characters: data.characters.map((c) =>
          c.id === characterId ? { ...c, voicePath, voiceSource: source } : c,
        ),
      },
    });
    get().scheduleSave();
  },

  removeCharacterVoice: (characterId) => {
    const { data } = get();
    if (!data) return;
    set({
      data: {
        ...data,
        characters: data.characters.map((c) =>
          c.id === characterId ? { ...c, voicePath: undefined, voiceSource: undefined, voiceEngineId: undefined } : c,
        ),
      },
    });
    get().scheduleSave();
  },

  setStyle: (style) => {
    const { data } = get();
    if (!data) return;
    set({ data: { ...data, style } });
    get().scheduleSave();
  },

  setBibles: (bibles) => {
    const { data } = get();
    if (!data) return;
    set({ data: { ...data, bibles } });
    get().logChange('breakdown', '更新项目四圣经');
  },

  setVideoRatio: (ratio) => {
    const { data } = get();
    if (!data) return;
    set({ data: { ...data, videoRatio: ratio || undefined } });
    get().scheduleSave();
  },

  setVideoModel: (model) => {
    const { data } = get();
    if (!data) return;
    set({ data: { ...data, videoModel: model || undefined } });
    get().scheduleSave();
  },

  setVideoPromptTemplate: (template) => {
    const { data } = get();
    if (!data) return;
    writeGlobalVideoPromptTemplate(template);
    set({ data: { ...data, videoPromptTemplate: template } });
    get().scheduleSave();
  },

  generateAsset: async (kind, id, engineId) => {
    const { project, data } = get();
    if (!project || !data) return;
    const item = kind === 'character'
      ? data.characters.find((c) => c.id === id)
      : kind === 'scene'
        ? data.scenes.find((s) => s.id === id)
        : kind === 'colorPalette'
          ? (data.colorPalettes ?? []).find((p) => p.id === id)
          : (data.props ?? []).find((p) => p.id === id);
    if (!item) return;
    const engine = engineId ?? item.assetEngine ?? 'gpt-image-2';
    const isMj = engine.startsWith('midjourney');
    const sep = isMj ? ', ' : '，';
    // 风格后缀：优先用风格库 DNA 的 promptSuffix，兜底用 keywords+customText
    let styleSuffix = '';
    let styleLibName = '';
    if (data.style?.styleLibraryRef) {
      const lib = data.style.library === 'midjourney'
        ? await loadMidjourneyStyleLibrary()
        : await loadStyleLibrary();
      const preset = lib.styles.find(s => s.name === data.style!.styleLibraryRef);
      styleLibName = preset?.name ?? data.style.styleLibraryRef;
      if (preset?.promptSuffix) {
        styleSuffix = preset.promptSuffix;
      } else if (preset?.promptTemplate) {
        styleSuffix = preset.promptTemplate;
      }
    }
    if (!styleSuffix && data.style) {
      styleSuffix = [...(data.style.keywords ?? []), data.style.customText ?? ''].filter(Boolean).join(sep);
    }
    // 双轨取词：MJ 读 assetPromptMj，GPT 读 assetPrompt；角色且 GPT 路径下
    // 若存量提示词不含三视图标记则弃用（保证一定是设定图），另为空时走兜底。
    const stored = isMj
      ? (item as WsCharacter|WsScene|WsProp).assetPromptMj
      : item.assetPrompt;
    const isLegacy = kind === 'character' && !isMj && stored
      && !/三视图|设定图|character design sheet|three-view/i.test(stored);
    const basePrompt = (!stored || isLegacy)
      ? (isMj
        ? (kind === 'character'
          ? `character design sheet, large front face portrait on the left, full-body three-view turnaround (front, side, back) on the right, ${(item as WsCharacter).appearance}, consistent character, plain light grey background, cinematic character sheet, high detail, no text`
          : kind === 'scene'
            ? `establishing shot of ${(item as WsScene).description}, no people, concept art, cinematic lighting, high detail`
            : kind === 'colorPalette'
              ? buildColorPalettePrompt((item as WsColorPalette).name, (item as WsColorPalette).description ?? 'cinematic color system', (item as WsColorPalette).colors ?? [])
            : `prop design, ${(item as WsProp).name}, ${(item as WsProp).description}, product photography, studio lighting, detailed, no text`)
        : (kind === 'character'
          ? `角色设计三视图组合图：画面左侧为${(item as WsCharacter).name}的正脸肖像大图；画面右侧为同一角色的三视图——正面、侧面、背面全身视图并排，${(item as WsCharacter).appearance}，完整展示服装结构与体态。背景统一为纯色浅灰。超高细节，电影级角色设计图格式，画面无任何文字`
          : kind === 'scene'
            ? `${(item as WsScene).name}，${(item as WsScene).description}，场景概念图，无人物，电影感布光，高质量`
            : kind === 'colorPalette'
              ? buildColorPalettePrompt((item as WsColorPalette).name, (item as WsColorPalette).description ?? 'cinematic color system', (item as WsColorPalette).colors ?? [])
            : `${(item as WsProp).name}，${(item as WsProp).description}，道具设计图，产品摄影风格，细节丰富，无文字`))
      : stored;
    let prompt = (() => {
      if (!styleSuffix) return basePrompt;
      // 角色三视图：只注入色调/气质，保护干净背景
      if (kind === 'character' && styleLibName) {
        const charStyleHint = isMj
          ? `art style inspired by ${styleLibName}, keep plain light grey background, standard studio lighting, no scene elements`
          : `整体画风参考「${styleLibName}」的色调与角色气质，但严格保持纯色浅灰背景、标准摄影棚布光，不添加任何场景元素或多余光影`;
        return `${basePrompt}${sep}${charStyleHint}`;
      }
      if (basePrompt.includes(styleSuffix)) return basePrompt;
      return `${basePrompt}${sep}${styleSuffix}`;
    })();
    const imageResolution = item.assetResolution ?? '2k';
    const mjStyle = isMj ? getMidjourneyStyle(data.style?.midjourneyStyleId) : undefined;
    if (isMj) prompt = applyMidjourneyStylePrompt(prompt, mjStyle);
    const mjVersion = normalizeMidjourneyVersion(
      data.style?.midjourneyVersion
      ?? mjStyle?.recommendedVersion
      ?? engine.match(/midjourney-(v?\d+(?:[.-]\d+)?)/i)?.[1]
      ?? MIDJOURNEY_DEFAULT_VERSION,
    );
    const resolvedMj = resolveMidjourneyStyleParameters(mjStyle, mjStyle?.creativityMode, {
      version: mjVersion,
      ...(data.style?.midjourneyStylize !== undefined ? { stylize: data.style.midjourneyStylize } : {}),
      ...(data.style?.midjourneyChaos !== undefined ? { chaos: data.style.midjourneyChaos } : {}),
      ...(data.style?.midjourneyRaw !== undefined ? { raw: data.style.midjourneyRaw } : {}),
      ...(data.style?.midjourneyStyleWeight !== undefined ? { styleWeight: data.style.midjourneyStyleWeight } : {}),
      ...(data.style?.midjourneyImageWeight !== undefined ? { imageWeight: data.style.midjourneyImageWeight } : {}),
      ...(data.style?.midjourneyWeird !== undefined ? { weird: data.style.midjourneyWeird } : {}),
      aspectRatio: item.assetAspectRatio ?? '16:9',
    });
    const mjStyleReference = isMj ? await ensureMidjourneyStyleReference(mjStyle) : undefined;
    const imageParams: RhtvParams = isMj
      ? {
          aspectRatio: resolvedMj.aspectRatio ?? '16:9',
          version: mjVersion,
          quality: '1',
          stylize: resolvedMj.stylize,
          chaos: resolvedMj.chaos,
          raw: resolvedMj.raw,
          iw: resolvedMj.imageWeight,
          sw: resolvedMj.styleWeight,
          weird: resolvedMj.weird,
          sv: 6,
          hd: false,
        }
      : { aspectRatio: item.assetAspectRatio ?? '16:9', resolution: imageResolution };
    const result = await runGeneration({
      engineId: engine,
      prompt,
      styleReferenceUrls: mjStyleReference ? [mjStyleReference] : undefined,
      // 角色=三视图组合图（左正脸+右三视图）是宽幅构图
      params: imageParams,
    });
    if (result.success && result.resultPaths.length > 0) {
      // 所有输出（MJ 返 4 张）全部进候选集，第一张设为当前图。
      // Copy failure must not lose a paid result — fall back to artifact path.
      const ts = Date.now();
      for (let i = 0; i < result.resultPaths.length; i++) {
        let dest = result.resultPaths[i];
        try {
          dest = await copyIntoProject(project.id, result.resultPaths[i], 'assets', `${kind}-${safeName(id)}-${ts}-${i}`);
        } catch (err) {
          console.warn('[workshop] 资产图入库失败，使用产物库路径:', err);
        }
        get().addAssetCandidate(kind, id, {
          path: dest,
          source: 'generate',
          engineId: engine,
          prompt,
          createdAt: ts + i,
        }, i === 0);
      }
      await get().commitNow();
    } else if (result.error) {
      throw new Error(result.error);
    }
  },

  generateSceneVariants: async (id) => {
    const { project, data } = get();
    if (!project || !data) return;
    const scene = data.scenes.find((s) => s.id === id);
    if (!scene?.assetImagePath) throw new Error('请先生成或上传一张场景默认图，再做场景迭代');

    const basePrompt = scene.assetPrompt || `${scene.name}，${scene.description}，场景概念图，无人物，电影感布光，高质量`;
    // 风格后缀：优先用风格库 DNA 的 promptSuffix，兜底 keywords+customText
    let sceneStyleSuffix = '';
    if (data.style?.styleLibraryRef) {
      const lib = await loadStyleLibrary();
      const preset = lib.styles.find(s => s.name === data.style!.styleLibraryRef);
      if (preset?.promptSuffix) {
        sceneStyleSuffix = preset.promptSuffix;
      } else if (preset?.promptTemplate) {
        sceneStyleSuffix = preset.promptTemplate;
      }
    }
    if (!sceneStyleSuffix && data.style) {
      sceneStyleSuffix = [...(data.style.keywords ?? []), data.style.customText ?? ''].filter(Boolean).join('，');
    }
    const ts = Date.now();
    const sceneEngine = scene.assetEngine ?? 'gpt-image-2';
    const sceneAspectRatio = scene.assetAspectRatio ?? '16:9';
    const sceneResolution = scene.assetResolution ?? '2k';

    for (let i = 0; i < SCENE_VARIANTS.length; i++) {
      const variant = SCENE_VARIANTS[i];
      const prompt = [
        `${basePrompt}`,
        `基于参考图保持同一场景、同一美术风格、同一色彩系统和光源方向，生成${variant.label}迭代图。`,
        variant.hint,
        '不要加入人物，不要改变建筑/空间主设定，不要出现文字。',
        sceneStyleSuffix,
      ].filter(Boolean).join('，');
      const result = await runGeneration({
        engineId: sceneEngine,
        prompt,
        referenceUrls: [scene.assetImagePath],
        params: { aspectRatio: sceneAspectRatio, resolution: sceneResolution },
      });
      if (!result.success || result.resultPaths.length === 0) {
        throw new Error(result.error || `${variant.label}迭代生成失败`);
      }
      for (let j = 0; j < result.resultPaths.length; j++) {
        let dest = result.resultPaths[j];
        try {
          dest = await copyIntoProject(project.id, result.resultPaths[j], 'assets', `scene-${safeName(id)}-${variant.role}-${ts}-${j}`);
        } catch (err) {
          console.warn('[workshop] 场景迭代图入库失败，使用产物库路径:', err);
        }
        get().addAssetCandidate('scene', id, {
          path: dest,
          source: 'generate',
          engineId: sceneEngine,
          prompt,
          role: variant.role,
          createdAt: ts + i * 10 + j,
        }, false);
      }
      await get().commitNow();
    }

    get().invalidateDownstream('assets');
    await get().commitNow();
  },

  generateShot: async (shotNo, kind, options) => {
    const { project, data } = get();
    if (!project || !data) return;
    const shot = data.shots.find((s) => s.shotNo === shotNo);
    if (!shot) return;

    // 参考图顺序对齐提示词 referenceOrder：常规生成为场景参考组在前
    //（@图片一/二/三…），角色/道具随后按出场顺序继续编号。
    // 视频生成若启用高清故事板，则分镜板作为最高优先级参考放在最前。
    const refContext = {
      scenes: data.scenes,
      characters: data.characters,
      props: data.props ?? [],
      colorPalettes: data.colorPalettes ?? [],
      globalColorPaletteId: data.globalColorPaletteId,
    };
    const effectiveModel = shot.videoModel || data.videoModel || 'seedance-2.0';
    const isSeedance25 = kind === 'video' && effectiveModel === 'seedance-2.5';
    const refBindings = kind === 'video'
      ? buildVideoRefBindings(shot, refContext, { includeStoryboardBoards: !isSeedance25 })
      : buildImageRefBindings(shot, refContext);
    const refs = refBindings.map((ref) => ref.path);
    const refLabels = refBindings.map((ref) => ref.label);
    const sceneRefIndices = refBindings.filter((ref) => ref.kind === 'scene').map((ref) => ref.index);
    const paletteRefIndex = refBindings.find((ref) => ref.kind === 'palette')?.index ?? null;

    let audioRefs: string[] = [];
    const audioLabels: string[] = [];
    if (shot.audioInjected && shot.generatedAudios?.length) {
      for (const ga of shot.generatedAudios) {
        audioRefs.push(ga.trimmedPath || ga.path);
        audioLabels.push(ga.characterName);
      }
    } else {
      for (const cid of (shot.voiceCharacterIds ?? [])) {
        const c = data.characters.find((x) => x.id === cid);
        if (c?.voicePath) {
          audioRefs.push(c.voicePath);
          audioLabels.push(c.name);
        }
      }
    }

    const promptTemplate = shot.videoPromptTemplate || data.videoPromptTemplate || 'legacy';
    const prompt = kind === 'image'
      ? shot.imagePrompt
      : videoPromptForShot(shot, refContext, {
          template: promptTemplate,
          includeStoryboardBoards: !isSeedance25,
        });
    if (!prompt) {
      get().updateShot(shotNo, { genStatus: 'failed', genError: `缺少${kind === 'image' ? '生图' : '视频'}提示词，请先完成第④步` });
      return;
    }
    const paletteRefLabel = paletteRefIndex ? `@图片${numToCn(paletteRefIndex)}` : '';
    // 色卡图只要进了 refs 就必须在提示词里被 @图片N 点名（Seedance 校验按
    // refs.length 数）。但色卡是全局配色参考，只补一条末尾约束，避免每个镜头
    // 反复出现"画面配色严格参考..."。
    const promptWithPaletteRef = paletteRefLabel
      ? prompt.replace(/@色卡|色卡对应的@图片N|色卡对应的 @图片N/g, paletteRefLabel)
      : prompt;
    const paletteConstraint = kind === 'image'
      ? `画面配色严格参考 ${paletteRefLabel}（色卡），用于统一整体色彩。`
      : `全片画面配色严格参考 ${paletteRefLabel}（色卡），用于统一色彩风格。`;
    const finalPrompt = paletteRefLabel && !promptWithPaletteRef.includes(paletteRefLabel)
      ? `${promptWithPaletteRef}\n\n${paletteConstraint}`
      : promptWithPaletteRef;

    const effectiveRatio = shot.videoRatio || data.videoRatio;
    if (kind === 'video' && !effectiveRatio) {
      get().updateShot(shotNo, { genStatus: 'failed', genError: '请先在页面顶部设置全局视频比例，或在分镜单独选择比例' });
      return;
    }

    const isMini = effectiveModel === 'seedance-2.0-mini';
    // MiniMax H3 单端点多模态：有无参考图都用同一个引擎 id
    const isH3 = effectiveModel === 'minimax-h3';
    // 万相 3.0 全能参考单端点：文生/图/视频/音频参考同引擎 id
    const isWan3 = effectiveModel === 'wan-3.0';
    const engineId = kind === 'image'
      ? 'gpt-image-2'
      : isSeedance25
        ? DREAMINA_SEEDANCE_25_ENGINE_ID
        : isH3
        ? 'minimax-hailuo-h3'
        : isWan3
          ? 'wan-3.0'
          : isMini
            ? (refs.length > 0 ? 'seedance-2.0-mini-i2v' : 'seedance-2.0-mini-t2v')
            : (refs.length > 0 ? 'seedance-2.0' : 'seedance-2.0-t2v');

    if (kind === 'video' && refs.length > 0 && !isH3 && !isWan3) {
      const requiredRefs = refs.map((_, i) => ({ index: i + 1, label: refLabels[i] ?? `参考图 ${i + 1}` }));
      const validation = validateSeedancePrompt(finalPrompt, {
        refCount: refs.length,
        requiredRefs,
        requireSceneRef: sceneRefIndices.length > 0,
        sceneRefIndices,
        maxImageRefs: isSeedance25 ? 30 : 10,
      });
      if (!validation.ok && !options?.skipPromptValidation) {
        get().updateShot(shotNo, {
          genStatus: 'failed',
          genError: `Seedance 提示词检查未通过：\n${formatSeedanceValidation(validation)}`,
        });
        return;
      }
    }

    get().updateShot(shotNo, { genStatus: 'queued', genError: undefined });
    await get().commitNow();
    // 跨项目守卫：生成中用户可能切换项目，shotNo（如"01-01"）在项目间高概率
    // 重复——所有 await 之后的回填必须确认还是发起时的项目，否则 A 的产物
    // 会写进 B 的同号分镜并落盘。不匹配时留给 useCanvasTaskRecovery 按
    // task.projectId 在切回后回填（该机制已存在）。
    const startProjectId = data.projectId;
    const sameProject = () => get().data?.projectId === startProjectId;
    const guardedUpdateShot = (no: string, patch: Partial<WsShot>) => {
      if (!sameProject()) {
        console.warn(`[workshop] 项目已切换（${startProjectId} → ${get().data?.projectId ?? 'none'}），跳过分镜 ${no} 回填，等待后台恢复`);
        return false;
      }
      get().updateShot(no, patch);
      return true;
    };
    try {
      if (kind === 'video' && audioRefs.length > 0) {
        const { trimAudioPathsToFit } = await import('@/lib/doubaoSpeech/trim');
        // 上限跟分镜时长走：8s 的镜配 15s 音频，Seedance 收到超画面时长的
        // 音频会截断或拖节奏。Seedance 单镜硬上限 15s。
        const maxAudioSec = Math.min(isSeedance25 ? 30 : 15, shot.durationSec ?? (isSeedance25 ? 30 : 15));
        const prepared = await trimAudioPathsToFit(audioRefs, maxAudioSec, data.projectId, audioLabels);
        audioRefs = prepared.paths;
        if (prepared.trimmed) {
          console.info(`[workshop] ${shotNo} 音频资产总时长 ${prepared.totalDuration.toFixed(1)}s，已自动裁剪至 ${maxAudioSec}s 内`);
        }
      }
      const result = await runGeneration({
        engineId,
        prompt: finalPrompt,
        referenceUrls: refs,
        videoUrls: kind === 'video' && (shot.directorPrevisVideoPaths?.length ?? 0) > 0
          ? shot.directorPrevisVideoPaths
          : undefined,
        audioUrls: audioRefs.length > 0 ? audioRefs : undefined,
        params: kind === 'video'
          ? isSeedance25
            ? {
                resolution: '720p',
                duration: String(Math.min(30, Math.max(4, shot.durationSec ?? 5))),
                ratio: effectiveRatio!,
              }
          : isH3
            ? {
                // H3 只有 2K；时长枚举 5-15（4s 分镜提到 5s）；ratio 透传；
                // 不下发 generateAudio 等 Seedance 专有参数
                resolution: '2K',
                duration: String(Math.min(15, Math.max(5, shot.durationSec ?? 5))),
                ratio: effectiveRatio!,
              }
            : isWan3
              ? {
                  // 万相 3.0：480P/720P/1080P，时长 2-30
                  resolution: '720P',
                  duration: String(Math.min(30, Math.max(2, shot.durationSec ?? 5))),
                  ratio: effectiveRatio!,
                }
            : {
                duration: String(shot.durationSec ?? 5),
                ratio: effectiveRatio!,
                generateAudio: true,
                generate_audio: true,
              }
          : {},
        workshopShotNo: shotNo,
        workshopShotKind: kind,
        projectId: data.projectId,
        onTaskCreated: (taskId) => {
          guardedUpdateShot(shotNo, { genStatus: 'generating', genTaskId: taskId });
        },
      });
      const mediaPath = kind === 'video'
        ? result.resultPaths.find((p) => /\.(mp4|mov|webm|m4v|mkv|avi)(?:\?|$)/i.test(p))
        : result.resultPaths.find((p) => /\.(png|jpe?g|webp|gif|bmp)(?:\?|$)/i.test(p)) ?? result.resultPaths[0];
      if (result.success && mediaPath) {
        // Copy failure must not strand a finished generation as "generating".
        let dest = mediaPath;
        try {
          const ts = new Date().toISOString().replaceAll('-', '').replaceAll(':', '').replace('T', '').slice(0, 15);
          dest = await copyIntoProject(project.id, mediaPath, 'shots', `${safeName(shotNo)}-${kind}-${ts}`);
        } catch (err) {
          console.warn('[workshop] 产物入库失败，使用产物库路径:', err);
        }
        const videoThumb = kind === 'video' ? await ensureVideoThumb(dest).catch(() => null) : null;
        if (guardedUpdateShot(shotNo, {
          genStatus: 'done',
          genTaskId: undefined,
          ...(kind === 'image'
            ? { imagePath: dest }
            : { videoPath: dest, ...(videoThumb?.path ? { videoThumbPath: videoThumb.path } : {}) }),
        })) {
          await get().commitNow();
        }
      } else {
        const activeTask = result.taskId
          ? useCanvasTaskStore.getState().tasks.find((t) => t.id === result.taskId)
          : undefined;
        const applied = activeTask && ['queued', 'uploading', 'running', 'downloading'].includes(activeTask.status)
          ? guardedUpdateShot(shotNo, {
              genStatus: 'generating',
              genTaskId: activeTask.id,
              genError: result.error ? `${result.error}\n后台仍在继续查询结果。` : undefined,
            })
          : guardedUpdateShot(shotNo, { genStatus: 'failed', genError: result.error, genTaskId: undefined });
        if (applied) await get().commitNow();
      }
    } catch (err) {
      if (guardedUpdateShot(shotNo, {
        genStatus: 'failed',
        genError: err instanceof Error ? err.message : String(err),
        genTaskId: undefined,
      })) {
        await get().commitNow();
      }
    }
  },

  generateAll: async (kind, onlyMissing = true) => {
    const { data } = get();
    if (!data) return;
    const busy = data.shots.some((s) => s.genStatus === 'queued' || s.genStatus === 'generating');
    if (busy) {
      console.warn('[workshop] generateAll skipped: shots already in progress');
      return;
    }
    const targets = data.shots.filter((s) => {
      if (!onlyMissing) return true;
      return kind === 'image' ? !s.imagePath : !s.videoPath;
    });
    await Promise.allSettled(targets.map((s) => get().generateShot(s.shotNo, kind)));
  },

  cancelShot: (shotNo) => {
    const { data } = get();
    const shot = data?.shots.find((s) => s.shotNo === shotNo);
    if (shot?.genTaskId) {
      abortCanvasTask(shot.genTaskId);
      // abort 只断前台 Promise——任务在 canvasTaskStore 里若仍 active，
      // 恢复线程稍后会把"已取消"的结果回填回来（取消形同虚设）。
      // 直接把任务标记为 failed 终态，恢复线程不再碰它。
      const task = useCanvasTaskStore.getState().tasks.find((t) => t.id === shot.genTaskId);
      if (task && ['queued', 'uploading', 'running', 'downloading'].includes(task.status)) {
        useCanvasTaskStore.getState().updateTask(task.id, {
          status: 'failed',
          error: '用户已取消',
          finishedAt: Date.now(),
        });
      }
    }
    get().updateShot(shotNo, { genStatus: 'idle', genTaskId: undefined });
    void get().commitNow();
  },

  getStateSummary: () => {
    const { project, data } = get();
    if (!project || !data) return JSON.stringify({ open: false, hint: '当前没有打开的工坊项目' });
    return JSON.stringify({
      open: true,
      project: { id: project.id, name: project.name },
      currentStep: data.currentStep,
      steps: Object.fromEntries(
        Object.entries(data.steps).map(([k, v]) => [k, { status: v.status, larkDocUrl: v.larkDocUrl }]),
      ),
      synopsis: data.synopsis.slice(0, 200),
      episodeCount: data.episodes.length,
      characterCount: data.characters.length,
      charactersWithVoice: data.characters.filter((c) => c.voicePath).length,
      sceneCount: data.scenes.length,
      propCount: (data.props ?? []).length,
      colorPaletteCount: (data.colorPalettes ?? []).length,
      globalColorPaletteId: data.globalColorPaletteId,
      bibles: {
        director: Boolean(data.bibles?.director),
        character: Boolean(data.bibles?.character),
        scene: Boolean(data.bibles?.scene),
        continuity: Boolean(data.bibles?.continuity),
      },
      shotCount: data.shots.length,
      shotsWithImage: data.shots.filter((s) => s.imagePath).length,
      shotsWithVideo: data.shots.filter((s) => s.videoPath).length,
      sources: project.sources.map((s) => s.name),
    });
  },
}));
