/**
 * workshopStore — 创作工坊状态（6 步流水线）。
 *
 * 文件为源 of truth：~/.kunpeng/aigc-memory/projects/<id>/workshop.json，
 * store 内存态 + debounce 800ms 自动落盘。生成走 canvasGen.runGeneration
 * 镜头/单资产生成通过工作台草稿、确认队列调用 canvasGen，结果只进候选。
 * 场景多角度也逐项准备可见草稿，不另开付费执行器或复制产物。
 */
import { create } from 'zustand';
import { useUnifiedProjectStore } from './unifiedProjectStore';
import { editWorkspaceProjectTemplate, editWorkspaceProjectVideoSettings } from '@/lib/workspace/shotEdits';
import { editWorkspaceAssetPrompt, editWorkspaceAssetSettings } from '@/lib/workspace/assetEdits';
import { generateLegacyShots } from '@/lib/workspace/legacyShotGeneration';
import { generateLegacySceneVariants } from '@/lib/workspace/legacySceneGeneration';
import { editLegacyShotReferences, setLegacySceneReferences, setLegacyGlobalPalette, preserveLegacyReferenceDrafts } from '@/lib/workspace/legacyShotReferences';
import { replaceLegacyShots, removeLegacyShot, mergeLegacyShotEdits } from '@/lib/workspace/legacyShotReplacement';
import { publishLegacyProjectCommand } from '@/lib/workspace/legacyProjectCommandRuntime';
import { applyWorkspaceProjectCommand } from '@/lib/workspace/runtime';
import { exists, BaseDirectory } from '@tauri-apps/api/fs';
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
import { abortCanvasTask } from '@/lib/canvasGen';
import { useCanvasTaskStore } from '@/stores/canvasTaskStore';
import {
  buildColorPalettePrompt,
  buildPaletteUsagePrompt,
  ensureDefaultColorPalettes,
} from '@/lib/workshop/colorPalettes';
import { writeGlobalVideoPromptTemplate } from '@/lib/videoPrompt/prompt';
import { PROJECT_OBJECT_SCHEMA_VERSION } from '@/lib/projectObjects/types';
import { migrateWorkshopProjectObjects, stableProjectObjectId } from '@/lib/projectObjects/migrate';
import { patchProjectSpec } from '@/lib/projectObjects/projectSpec';
import { patchProjectViewState } from '@/lib/projectObjects/viewState';
import type { ProjectSpec, ProjectViewState } from '@/lib/projectObjects/types';
import type { ProjectIntakeRecord } from '@/lib/projects/projectIntake';
import { ProjectCreationInterrupted } from '@/lib/projects/projectCreation';

export { getSceneReferencePaths } from '@/lib/workshop/shotRefs';

const WORKSHOP_FILE = 'workshop.json';

/** Compatibility editors publish the same draft command as the new workbench. */
function publishWorkshopDraftData(before: WorkshopData, after: WorkshopData): void {
  const current = useWorkshopStore.getState();
  const activeId = useUnifiedProjectStore.getState().activeId;
  if (current.data !== before || current.project?.id !== before.projectId || after.projectId !== before.projectId
    || (activeId && activeId !== before.projectId)) throw new Error('项目内容已改变，未写入旧编辑');
  if (activeId === before.projectId) {
    if (!applyWorkspaceProjectCommand(before.projectId, (data) => data === before ? after : null)) {
      throw new Error('共享草稿已改变，未覆盖当前内容');
    }
  } else {
    // Standalone legacy workshop remains usable before a unified project is opened.
    useWorkshopStore.setState({ data: after });
  }
}

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
    projectSpec: data.projectSpec ? {
      ...data.projectSpec,
      continuityFacts: [...(data.projectSpec.continuityFacts ?? [])],
      forbidden: [...(data.projectSpec.forbidden ?? [])],
    } : data.projectSpec,
    projectObjects: data.projectObjects ? {
      ...data.projectObjects,
      objects: data.projectObjects.objects.map((item) => ({ ...item, relationIds: [...item.relationIds] })),
      media: data.projectObjects.media.map((item) => ({ ...item, relationIds: [...item.relationIds] })),
      versions: data.projectObjects.versions.map((item) => ({ ...item, relationIds: [...item.relationIds] })),
    } : data.projectObjects,
    projectViewState: data.projectViewState ? {
      ...data.projectViewState,
      selectedObjectIds: data.projectViewState.selectedObjectIds
        ? [...data.projectViewState.selectedObjectIds]
        : data.projectViewState.selectedObjectIds,
      conversationReferences: data.projectViewState.conversationReferences
        ? data.projectViewState.conversationReferences.map((item) => ({ ...item }))
        : data.projectViewState.conversationReferences,
    } : data.projectViewState,
    projectSnapshots: data.projectSnapshots?.map((item) => ({
      ...item,
      mediaPaths: [...item.mediaPaths],
      pendingTaskIds: [...item.pendingTaskIds],
      changedObjectIds: item.changedObjectIds ? [...item.changedObjectIds] : undefined,
    })),
    projectBranches: data.projectBranches?.map((item) => ({
      ...item,
      mediaPaths: [...item.mediaPaths],
    })),
    projectIntake: data.projectIntake ? {
      ...data.projectIntake,
      attachments: data.projectIntake.attachments.map((item) => ({ ...item })),
    } : data.projectIntake,
    breakdownSourceEvidence: data.breakdownSourceEvidence
      ? [...data.breakdownSourceEvidence]
      : data.breakdownSourceEvidence,
    storyFacts: data.storyFacts?.map((fact) => ({
      ...fact,
      participantIds: [...fact.participantIds],
    })),
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

function reconcileAssetReferenceChange(oldData: WorkshopData, nextData: WorkshopData): WorkshopData {
  return preserveLegacyReferenceDrafts(oldData, nextData);
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
  createAndOpen: (name: string) => Promise<string>;
  save: (options?: { requireSuccess?: boolean }) => Promise<void>;
  commitNow: (options?: { requireSuccess?: boolean }) => Promise<void>;
  reloadCurrent: () => Promise<void>;
  scheduleSave: () => void;
  close: () => void;

  setCurrentStep: (s: WorkshopStepId) => void;
  updateProjectSpec: (patch: Partial<Omit<ProjectSpec, 'revision' | 'updatedAt'>>) => void;
  setProjectIntake: (intake: ProjectIntakeRecord) => void;
  updateProjectViewState: (patch: Partial<ProjectViewState>) => void;
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
  setImageModel: (model: string) => void;
  /** 设置全局视频提示词模板（分镜未单独设置时 fallback） */
  setVideoPromptTemplate: (template: 'legacy' | 'universal') => void;

  generateAsset: (kind: WorkshopAssetKind, id: string, engineId?: string) => Promise<void>;
  generateSceneVariants: (id: string) => Promise<void>;
  generateShot: (shotNo: string, kind: 'image' | 'video', options?: { skipPromptValidation?: boolean }) => Promise<void>;
  generateAll: (kind: 'image' | 'video', onlyMissing?: boolean) => Promise<void>;
  cancelShot: (shotNo: string) => void;

  getStateSummary: () => string;
}

async function attachDefaultPaletteImages(data: WorkshopData): Promise<void> {
  const missingImages = (data.colorPalettes ?? []).filter((p) => p.source === 'default' && !p.assetImagePath);
  if (!missingImages.length) return;
  const home = await homeDir();
  for (const p of missingImages) {
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

export const useWorkshopStore = create<WorkshopState>((set, get, api) => ({
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
      let data = safeParse<WorkshopData>(raw) ?? emptyWorkshopData(id);
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
      const migrateProjectObjects = (data.schemaVersion ?? 0) < PROJECT_OBJECT_SCHEMA_VERSION
        || !data.projectSpec
        || !data.projectObjects;
      data.shots = ensureShotIds((data.shots ?? []).map((s) => ({
        ...s,
        characterIds: s.characterIds ?? [],
        propIds: s.propIds ?? [],
        voiceCharacterIds: s.voiceCharacterIds ?? [],
        description: s.description ?? '',
      })), project.id);
      data = migrateWorkshopProjectObjects(data);
      if (migrateShotIds || migrateProjectObjects) {
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
    let expected = get();
    let current = true;
    const watch = () => api.subscribe((state) => {
      if (state.project !== expected.project || state.data !== expected.data) current = false;
    });
    let unsubscribe = watch();
    let createdId: string | undefined;
    try {
      const project = await createProject(name);
      createdId = project.id;
      let data = emptyWorkshopData(project.id);
      data = migrateWorkshopProjectObjects(data);
      // 新建项目默认先进入"创作与拆解剧本"（一次性标记，工作台消费后清除）
      data.projectViewState = { ...data.projectViewState, workspaceScriptToolsOpen: true };
      unsubscribe();
      if (current) set({ project, data: cloneWorkshopData(data), lastDelete: null });
      expected = get();
      unsubscribe = watch();
      await writeProjectFile(project.id, WORKSHOP_FILE, JSON.stringify(data, null, 2), { requireSuccess: true });
      if (!current) throw new ProjectCreationInterrupted(project.id);
      return project.id;
    } catch (error) {
      if (createdId && !(error instanceof ProjectCreationInterrupted)) {
        throw new ProjectCreationInterrupted(createdId, '项目已创建，但初始保存未完成。创意尚未发送，可手动继续原项目。');
      }
      throw error;
    } finally {
      unsubscribe();
      set({ loading: false });
    }
  },

  save: async (options) => {
    const { project, data } = get();
    if (!project || !data) {
      if (options?.requireSuccess) throw new Error('没有可保存的项目');
      return;
    }
    // 保险丝：state 读取时序异常时绝不把 A 项目数据写进 B 的 workshop.json
    if (data.projectId && data.projectId !== project.id) {
      if (options?.requireSuccess) throw new Error('项目已经切换，未保存');
      console.error(`[workshop] save 中止：data.projectId(${data.projectId}) 与当前项目(${project.id})不符`);
      return;
    }
    const persistedData = migrateWorkshopProjectObjects(data);
    if (get().data === data) set({ data: persistedData });
    await writeProjectFile(project.id, WORKSHOP_FILE, JSON.stringify(persistedData, null, 2), options);
    // 回写 index 统计，记忆库项目列表共享
    const stats = {
      shots: persistedData.shots.length,
      scenes: persistedData.scenes.length,
      assets: persistedData.characters.filter((c) => c.assetImagePath).length
        + persistedData.scenes.filter((s) => s.assetImagePath).length
        + (persistedData.colorPalettes ?? []).filter((p) => p.assetImagePath).length,
      videosCompleted: persistedData.shots.filter((s) => s.videoPath).length,
    };
    await writeProject({ ...project, stats });
  },

  commitNow: async (options) => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    // 所有写入路径本身都做不可变更新。这里不再深拷贝整份项目：
    // 大项目下每次 Agent 工具提交都会让所有分镜、图片和提示词组件重渲染。
    // save 是纯数据落盘（workshop.json + 项目元数据），不等 requestAnimationFrame；
    // 期间每个 IPC await 都会让出事件循环，React 有机会提交帧。
    await get().save(options);
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
    let data = safeParse<WorkshopData>(raw);
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
    const migrateProjectObjects = (data.schemaVersion ?? 0) < PROJECT_OBJECT_SCHEMA_VERSION
      || !data.projectSpec
      || !data.projectObjects;
    data = migrateWorkshopProjectObjects(data);
    if (migrateShotIds || migrateProjectObjects) {
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

  updateProjectSpec: (patch) => {
    const { data } = get();
    if (!data?.projectSpec) return;
    const next = migrateWorkshopProjectObjects({
      ...data,
      projectSpec: patchProjectSpec(data.projectSpec, patch),
    });
    set({ data: next });
    get().scheduleSave();
  },

  setProjectIntake: (intake) => {
    const { data } = get();
    if (!data) return;
    set({
      data: {
        ...data,
        projectIntake: {
          ...intake,
          attachments: intake.attachments.map((item) => ({ ...item })),
        },
      },
    });
    get().scheduleSave();
  },

  updateProjectViewState: (patch) => {
    const { data } = get();
    if (!data) return;
    set({
      data: {
        ...data,
        projectViewState: patchProjectViewState(data.projectViewState, patch),
      },
    });
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
    if (mode === 'merge') {
      publishWorkshopDraftData(data, mergeLegacyShotEdits(data, shots, () => createShotId(data.projectId)));
      get().scheduleSave();
      return;
    }
    publishLegacyProjectCommand((state) => replaceLegacyShots(state, shots, () => createShotId(data.projectId)));
  },

  updateShot: (shotNo, patch) => {
    const { data } = get();
    if (!data) return;
    publishWorkshopDraftData(data, editLegacyShotReferences(data, shotNo, patch));
    get().scheduleSave();
  },

  removeShot: (shotNo) => {
    const { data } = get();
    if (!data) return;
    const shot = data.shots.find((item) => item.shotNo === shotNo);
    if (!shot) return;
    publishLegacyProjectCommand((state) => removeLegacyShot(state, shot.id ?? shot.shotNo));
  },

  setAssetPrompt: (kind, id, prompt, engine = 'gpt') => {
    const { data } = get();
    if (!data) return;
    publishWorkshopDraftData(data, editWorkspaceAssetPrompt(data, kind, id, prompt, engine));
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
    const ownerId = stableProjectObjectId(kind === 'colorPalette' ? 'scene-asset' : kind, id);
    const version = data.projectObjects?.versions.find((item) => item.ownerObjectId === ownerId
      && data.projectObjects?.media.some((media) => media.id === item.mediaObjectId && media.path === path));
    if (version) {
      if (!useUnifiedProjectStore.getState().selectProjectAssetVersion(ownerId, version.id)) throw new Error('采用版本失败：对象已锁定或项目已切换');
      return;
    }
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
    set({ data: setLegacySceneReferences(data, id, paths) });
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
    publishWorkshopDraftData(data, editWorkspaceAssetSettings(data, kind, id, { engineId }));
    get().scheduleSave();
  },

  setAssetResolution: (kind, id, resolution) => {
    const { data } = get();
    if (!data) return;
    publishWorkshopDraftData(data, editWorkspaceAssetSettings(data, kind, id, { resolution }));
    get().scheduleSave();
  },

  setAssetAspectRatio: (kind, id, aspectRatio) => {
    const { data } = get();
    if (!data) return;
    publishWorkshopDraftData(data, editWorkspaceAssetSettings(data, kind, id, { aspectRatio }));
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
    set({ data: setLegacyGlobalPalette(data, id) });
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
    publishWorkshopDraftData(data, editWorkspaceProjectVideoSettings(data, { videoRatio: ratio || undefined }));
    get().scheduleSave();
  },

  setVideoModel: (model) => {
    const { data } = get();
    if (!data) return;
    publishWorkshopDraftData(data, editWorkspaceProjectVideoSettings(data, { videoModel: model || undefined }));
    get().scheduleSave();
  },

  setImageModel: (model) => {
    const { data } = get();
    if (!data) return;
    set({ data: { ...data, imageModel: model || undefined } });
    get().scheduleSave();
  },

  setVideoPromptTemplate: (template) => {
    const { data } = get();
    if (!data) return;
    publishWorkshopDraftData(data, editWorkspaceProjectTemplate(data, template));
    writeGlobalVideoPromptTemplate(template);
    get().scheduleSave();
  },

  generateAsset: async (kind, id, engineId) => {
    const { project, data } = get();
    if (!project || !data || project.id !== data.projectId) return;
    const projectId = project.id;
    const { generateWorkspaceAsset } = await import('@/lib/workspace/runtime');
    const outcome = await generateWorkspaceAsset(projectId, kind, id, engineId);
    if (outcome.status === 'invalid' || outcome.status === 'failed' || outcome.status === 'uncertain') {
      throw new Error(outcome.error || '生成未完成，请检查原任务，不要重复提交');
    }
  },

  generateSceneVariants: async (id) => {
    const { project, data } = get();
    if (!project || !data || project.id !== data.projectId) return;
    const { applyWorkspaceProjectCommand, generateWorkspaceDraft } = await import('@/lib/workspace/runtime');
    await generateLegacySceneVariants({ apply: applyWorkspaceProjectCommand, generate: generateWorkspaceDraft }, project.id, id);
  },

  generateShot: async (shotNo, kind, _options) => {
    const { project, data } = get();
    if (!project || !data || project.id !== data.projectId) return;
    const shot = data.shots.find((item) => item.shotNo === shotNo);
    if (!shot) return;
    const sourceId = shot.id ?? shot.shotNo;
    const { applyWorkspaceProjectCommand, generateWorkspaceDraft } = await import('@/lib/workspace/runtime');
    await generateLegacyShots({ apply: applyWorkspaceProjectCommand, generate: generateWorkspaceDraft }, project.id, [sourceId], kind);
  },

  generateAll: async (kind, onlyMissing = true) => {
    const { project, data } = get();
    if (!project || !data || project.id !== data.projectId) return;
    const sourceIds = data.shots.filter((shot) => !onlyMissing || !(kind === 'image' ? shot.imagePath : shot.videoPath))
      .map((shot) => shot.id ?? shot.shotNo);
    const { applyWorkspaceProjectCommand, generateWorkspaceDraft } = await import('@/lib/workspace/runtime');
    await generateLegacyShots({ apply: applyWorkspaceProjectCommand, generate: generateWorkspaceDraft }, project.id, sourceIds, kind);
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
      // 资产绑定断链可见性：没有定版图的资产数量与清单（生成图未采用时 agent 能直接看到）
      assetsWithoutImage: [
        ...data.characters.filter((c) => !c.assetImagePath).map((c) => `角色 ${c.name}(${c.id})`),
        ...data.scenes.filter((s) => !s.assetImagePath).map((s) => `场景 ${s.name}(${s.id})`),
        ...(data.props ?? []).filter((p) => !p.assetImagePath).map((p) => `道具 ${p.name}(${p.id})`),
      ],
      sources: project.sources.map((s) => s.name),
    });
  },
}));
