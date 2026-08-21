/**
 * shotRefs — 工坊分镜参考图顺序与 @图片N 编号的单一权威模块。
 *
 * 修复的核心病灶（与画布 collectRefs.ts 同款病）：store 生成（generateShot）、
 * tools 校验（buildShotRequiredRefs）、UI 展示/重排（StepPrompts 内私有函数）
 * 三处各自维护参考图顺序——任何一处口径不一致都会让 @图片N 指错素材。
 *
 * 纪律：
 * 1. 顺序唯一权威（video）：故事板分镜板(useInVideo)→场景→角色→道具→额外图→色卡。
 * 2. 顺序唯一权威（image/storyboard）：场景→角色→道具→额外图→色卡（不含首帧/故事板——
 *    它们是 imagePrompt 的产物，不能作它自己的参考）。
 * 3. 任何增删参考的写入路径（UI 删除、agent 工具、画布回传、分镜板增删）都必须
 *    经 remapShotPromptRefs 重排提示词编号。
 */
import type { WsShot, StoryboardBoard, StoryboardFrame } from '@/lib/workshop/types';

const NUM_TO_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五'];

export function numToCn(n: number): string {
  return n >= 1 && n <= NUM_TO_CN.length ? NUM_TO_CN[n - 1] : String(n);
}

interface SceneLike { id: string; name?: string; assetImagePath?: string; selectedImagePaths?: string[]; sceneReferenceMode?: 'multi' }
interface AssetLike { id: string; name?: string; assetImagePath?: string }
interface PaletteLike { id: string; name?: string; assetImagePath?: string }

export interface ShotRefsContext {
  scenes: SceneLike[];
  characters: AssetLike[];
  props: AssetLike[];
  colorPalettes?: PaletteLike[];
  globalColorPaletteId?: string;
}

export type ShotRefBindingKind = 'storyboardBoard' | 'directorConstraintCard' | 'scene' | 'character' | 'prop' | 'extra' | 'palette';

export interface ShotRefBinding {
  index: number;
  kind: ShotRefBindingKind;
  label: string;
  path: string;
  id?: string;
}

function bindingIdentityList(bindings: ShotRefBinding[]): string[] {
  const idFrequencies = new Map<string, number>();
  bindings.forEach((binding) => {
    if (!binding.id) return;
    const idKey = `${binding.kind}:${binding.id}`;
    idFrequencies.set(idKey, (idFrequencies.get(idKey) ?? 0) + 1);
  });
  const counts = new Map<string, number>();
  return bindings.map((binding) => {
    const idKey = binding.id ? `${binding.kind}:${binding.id}` : '';
    // 单图角色/道具换文件时身份仍是同一资产；一个场景有多角度时则必须
    // 把路径并入身份，否则拖动多角度顺序会让 @图片N 指向另一张图。
    const base = binding.id && idFrequencies.get(idKey) === 1
      ? idKey
      : `${binding.kind}:${binding.id ?? ''}:${binding.path}`;
    const occurrence = (counts.get(base) ?? 0) + 1;
    counts.set(base, occurrence);
    return `${base}:${occurrence}`;
  });
}

/** 稳定的引用快照签名。Agent 写提示词时用它防止基于旧编号覆盖新状态。 */
export function shotReferenceSignature(shot: WsShot, ctx: ShotRefsContext): string {
  const source = [
    ...buildImageRefBindings(shot, ctx).map((ref) => `i:${ref.kind}:${ref.id ?? ''}:${ref.path}`),
    ...buildVideoRefBindings(shot, ctx).map((ref) => `v:${ref.kind}:${ref.id ?? ''}:${ref.path}`),
  ].join('|');
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `refs-${(hash >>> 0).toString(36)}`;
}

export function getSceneReferencePaths(
  shot: Pick<WsShot, 'sceneId' | 'sceneImagePaths'>,
  scenes: SceneLike[],
): string[] {
  if (shot.sceneImagePaths) return shot.sceneImagePaths.filter(Boolean);
  const scene = scenes.find((x) => x.id === shot.sceneId);
  const selected = scene?.selectedImagePaths?.filter(Boolean) ?? [];
  if (scene?.sceneReferenceMode === 'multi' && selected.length > 0) return selected;
  return scene?.assetImagePath ? [scene.assetImagePath] : [];
}

function getPaletteReferencePath(shot: WsShot, ctx: ShotRefsContext): string | undefined {
  const paletteId = shot.colorPaletteId || ctx.globalColorPaletteId;
  if (!paletteId) return undefined;
  return ctx.colorPalettes?.find((x) => x.id === paletteId)?.assetImagePath;
}

/** 生图/高清故事板的实际参考绑定（缺图资产不占 @图片N 编号）。 */
export function buildImageRefBindings(shot: WsShot, ctx: ShotRefsContext): ShotRefBinding[] {
  const refs: ShotRefBinding[] = [];
  const scene = ctx.scenes.find((x) => x.id === shot.sceneId);
  getSceneReferencePaths(shot, ctx.scenes).forEach((path, i) => {
    refs.push({
      index: refs.length + 1,
      kind: 'scene',
      label: i === 0 ? `场景 ${scene?.name ?? shot.sceneId ?? ''}`.trim() : `场景角度 ${i + 1}`,
      path,
      id: scene?.id,
    });
  });
  for (const cid of (shot.characterIds ?? [])) {
    const c = ctx.characters.find((x) => x.id === cid);
    if (c?.assetImagePath) refs.push({
      index: refs.length + 1,
      kind: 'character',
      label: `角色 ${c.name ?? cid}`,
      path: c.assetImagePath,
      id: cid,
    });
  }
  for (const pid of (shot.propIds ?? [])) {
    const p = ctx.props.find((x) => x.id === pid);
    if (p?.assetImagePath) refs.push({
      index: refs.length + 1,
      kind: 'prop',
      label: `道具 ${p.name ?? pid}`,
      path: p.assetImagePath,
      id: pid,
    });
  }
  for (const path of (shot.extraRefImages ?? []).filter(Boolean)) {
    refs.push({
      index: refs.length + 1,
      kind: 'extra',
      label: `额外参考 ${path.split('/').pop() ?? ''}`.trim(),
      path,
    });
  }
  const palettePath = getPaletteReferencePath(shot, ctx);
  if (palettePath) {
    const paletteId = shot.colorPaletteId || ctx.globalColorPaletteId;
    const palette = ctx.colorPalettes?.find((x) => x.id === paletteId);
    refs.push({
      index: refs.length + 1,
      kind: 'palette',
      label: `色卡 ${palette?.name ?? paletteId ?? ''}`.trim(),
      path: palettePath,
      id: paletteId,
    });
  }
  return refs;
}

/**
 * 单格故事板传入画布时的参考绑定。
 *
 * frame.refImagePaths 是该格提示词写入时保存的真实编号快照，优先级高于
 * 当前资产列表。资产发生重排后 remapShotPromptRefs 会同步更新这份快照；
 * 对旧项目或历史缺失资产，则保留路径并降级为“历史参考”，避免静默漏传。
 */
export function buildStoryboardFrameRefBindings(
  shot: WsShot,
  frame: Pick<StoryboardFrame, 'refImagePaths' | 'useDirectorConstraintCard'>,
  ctx: ShotRefsContext,
): ShotRefBinding[] {
  const current = buildImageRefBindings(shot, ctx);
  const cardPath = shot.directorConstraintCard?.imagePath;
  const paths = frame.refImagePaths?.filter((path) => Boolean(path) && path !== cardPath);
  let resolved: ShotRefBinding[];
  if (!paths?.length) {
    resolved = current;
  } else {
    // 同一路径理论上不应重复占编号；这里用队列匹配，兼容旧数据中的重复路径，
    // 同时确保每一个 @图片N 都能得到对应的可见节点。
    const buckets = new Map<string, ShotRefBinding[]>();
    current.forEach((binding) => {
      const list = buckets.get(binding.path) ?? [];
      list.push(binding);
      buckets.set(binding.path, list);
    });

    resolved = paths.map((path, index) => {
      const matched = buckets.get(path)?.shift();
      return matched
        ? { ...matched, index: index + 1 }
        : {
            index: index + 1,
            kind: 'extra',
            label: `历史参考 ${index + 1}`,
            path,
          };
    });
  }

  if (frame.useDirectorConstraintCard && cardPath) {
    resolved.push({
      index: resolved.length + 1,
      kind: 'directorConstraintCard',
      label: '导演约束卡',
      path: cardPath,
      id: shot.directorConstraintCard?.id,
    });
  }
  return resolved;
}

export interface CompactStoryboardFrameReferencesResult {
  prompt: string;
  bindings: ShotRefBinding[];
}

/**
 * Convert a frame's sparse references into its own contiguous @图片N scope.
 * Example: a frame using the shot-level @图片一 and @图片三 stores/sends only
 * those two assets and rewrites the latter to local @图片二.
 */
export function compactStoryboardFrameReferences(
  shot: WsShot,
  frame: Pick<StoryboardFrame, 'prompt' | 'refImagePaths' | 'useDirectorConstraintCard'>,
  ctx: ShotRefsContext,
): CompactStoryboardFrameReferencesResult {
  const bindings = buildStoryboardFrameRefBindings(shot, frame, ctx);
  const mentioned = new Set<number>();
  for (const match of frame.prompt.matchAll(/@图片([一二三四五六七八九十]+|\d+)/g)) {
    const raw = match[1];
    const index = /^\d+$/.test(raw) ? Number(raw) : NUM_TO_CN.indexOf(raw) + 1;
    if (index >= 1 && index <= bindings.length) mentioned.add(index);
  }
  if (mentioned.size === 0) return { prompt: frame.prompt, bindings };

  const selected = bindings.filter((binding) => (
    mentioned.has(binding.index)
    || (frame.useDirectorConstraintCard === true && binding.kind === 'directorConstraintCard')
  ));
  const compacted = selected.map((binding, index) => ({ ...binding, index: index + 1 }));
  return {
    prompt: replaceImageMentionsByPath(
      frame.prompt,
      bindings.map((binding) => binding.path),
      compacted.map((binding) => binding.path),
    ) ?? frame.prompt,
    bindings: compacted,
  };
}

/** 视频生成的实际参考绑定（分镜板→导演约束卡→常规资产；分镜图 imagePath 只做产物展示）。 */
export interface VideoRefBindingOptions {
  /** Seedance 2.5 不使用拼合故事板，但仍保留导演约束卡与常规资产。 */
  includeStoryboardBoards?: boolean;
}

export function buildVideoRefBindings(
  shot: WsShot,
  ctx: ShotRefsContext,
  options: VideoRefBindingOptions = {},
): ShotRefBinding[] {
  const refs: ShotRefBinding[] = [];
  if (options.includeStoryboardBoards !== false) {
    for (const [i, board] of (shot.storyboardBoards ?? []).filter((b) => b.imagePath && b.useInVideo !== false).entries()) {
      refs.push({
        index: refs.length + 1,
        kind: 'storyboardBoard',
        label: `高清故事板 ${i + 1}`,
        path: board.imagePath,
        id: board.id,
      });
    }
  }
  if (shot.directorConstraintCard?.imagePath && shot.directorConstraintCard.useInVideo === true) {
    refs.push({
      index: refs.length + 1,
      kind: 'directorConstraintCard',
      label: '导演约束卡',
      path: shot.directorConstraintCard.imagePath,
      id: shot.directorConstraintCard.id,
    });
  }
  for (const binding of buildImageRefBindings(shot, ctx)) {
    refs.push({ ...binding, index: refs.length + 1 });
  }
  return refs;
}

/** 生图/高清故事板的参考路径（不含首帧/故事板，色卡作为普通图片资产排在最后） */
export function buildImageRefPaths(shot: WsShot, ctx: ShotRefsContext): string[] {
  return buildImageRefBindings(shot, ctx).map((ref) => ref.path);
}

/** 视频生成的参考路径（分镜板置首；分镜图 imagePath 只做封面/产物，不作为参考） */
export function buildVideoRefPaths(shot: WsShot, ctx: ShotRefsContext): string[] {
  return buildVideoRefBindings(shot, ctx).map((ref) => ref.path);
}

/** 兼容旧调用：按路径重排。新代码应优先使用语义绑定重排。 */
export function replaceImageMentionsByPath(prompt: string | undefined, oldPaths: string[], newPaths: string[]): string | undefined {
  if (!prompt) return prompt;
  const oldIndexToPath = new Map<number, string>();
  oldPaths.forEach((path, i) => oldIndexToPath.set(i + 1, path));
  const newPathToIndex = new Map<string, number>();
  newPaths.forEach((path, i) => {
    if (!newPathToIndex.has(path)) newPathToIndex.set(path, i + 1);
  });

  return prompt.replace(/@图片([一二三四五六七八九十]+|\d+)/g, (match, raw: string) => {
    const oldIndex = /^\d+$/.test(raw) ? Number(raw) : NUM_TO_CN.indexOf(raw) + 1;
    const oldPath = oldIndexToPath.get(oldIndex);
    if (!oldPath) return match;
    const nextIndex = newPathToIndex.get(oldPath);
    if (!nextIndex) return '';
    return `@图片${numToCn(nextIndex)}`;
  });
}

function replaceImageMentionsByBinding(
  prompt: string | undefined,
  oldBindings: ShotRefBinding[],
  newBindings: ShotRefBinding[],
): string | undefined {
  if (!prompt) return prompt;
  const oldIdentities = bindingIdentityList(oldBindings);
  const nextIndexByIdentity = new Map(
    bindingIdentityList(newBindings).map((identity, index) => [identity, index + 1]),
  );
  return prompt
    .replace(/@图片([一二三四五六七八九十]+|\d+)/g, (match, raw: string) => {
      const oldIndex = /^\d+$/.test(raw) ? Number(raw) : NUM_TO_CN.indexOf(raw) + 1;
      const identity = oldIdentities[oldIndex - 1];
      if (!identity) return match;
      const nextIndex = nextIndexByIdentity.get(identity);
      return nextIndex ? `@图片${numToCn(nextIndex)}` : '';
    })
    .replace(/[、，]\s*(?=[、，。；])/g, '')
    .replace(/\s{2,}/g, ' ');
}

/** 参考资产变更后重排 imagePrompt/videoPrompt/storyboardFrames 的 @图片N */
export function remapShotPromptRefs(
  oldShot: WsShot,
  nextShot: WsShot,
  oldCtx: ShotRefsContext,
  nextCtx: ShotRefsContext = oldCtx,
): Partial<WsShot> {
  const oldImageRefs = buildImageRefBindings(oldShot, oldCtx);
  const nextImageRefs = buildImageRefBindings(nextShot, nextCtx);
  const oldVideoRefs = buildVideoRefBindings(oldShot, oldCtx);
  const nextVideoRefs = buildVideoRefBindings(nextShot, nextCtx);
  const oldSeedance25Refs = buildVideoRefBindings(oldShot, oldCtx, { includeStoryboardBoards: false });
  const nextSeedance25Refs = buildVideoRefBindings(nextShot, nextCtx, { includeStoryboardBoards: false });

  const storyboardFrames = (oldShot.storyboardFrames ?? []).map((frame) => {
    const oldFrameRefs = buildStoryboardFrameRefBindings(oldShot, frame, oldCtx);
    const rawNextFrame = nextShot.storyboardFrames?.find((item) => item.id === frame.id) ?? frame;
    // 替换/删除导演卡时，旧卡路径不能降级成“历史参考”继续占一个 @图片N。
    const oldCardPath = oldShot.directorConstraintCard?.imagePath;
    const nextFrame = oldCardPath
      ? {
          ...rawNextFrame,
          refImagePaths: rawNextFrame.refImagePaths?.filter((path) => path !== oldCardPath),
        }
      : rawNextFrame;
    const nextFrameRefs = buildStoryboardFrameRefBindings(nextShot, nextFrame, nextCtx);
    const cardRef = nextFrameRefs.find((ref) => ref.kind === 'directorConstraintCard');
    const remappedPrompt = replaceImageMentionsByBinding(
      frame.prompt,
      oldFrameRefs,
      nextFrameRefs,
    ) ?? frame.prompt;
    return {
      ...frame,
      ...nextFrame,
      prompt: cardRef
        ? ensureDirectorConstraintMention(remappedPrompt, cardRef.index)
        : stripDirectorConstraintMention(remappedPrompt),
      refImagePaths: nextFrameRefs.map((ref) => ref.path),
    };
  });

  return {
    imagePrompt: replaceImageMentionsByBinding(oldShot.imagePrompt, oldImageRefs, nextImageRefs),
    videoPrompt: replaceImageMentionsByBinding(oldShot.videoPrompt, oldVideoRefs, nextVideoRefs),
    seedance25VideoPrompt: replaceImageMentionsByBinding(
      oldShot.seedance25VideoPrompt,
      oldSeedance25Refs,
      nextSeedance25Refs,
    ),
    universalVideoPrompt: replaceImageMentionsByBinding(
      oldShot.universalVideoPrompt,
      oldVideoRefs,
      nextVideoRefs,
    ),
    ...(storyboardFrames.length > 0 ? { storyboardFrames } : {}),
    referenceRevision: (oldShot.referenceRevision ?? 0) + 1,
  };
}

/** 会移动 @图片N 编号的分镜字段 */
export const REF_PATCH_FIELDS = new Set<string>([
  'characterIds',
  'propIds',
  'sceneId',
  'sceneImagePaths',
  'extraRefImages',
  'colorPaletteId',
  'storyboardBoards',
  'directorConstraintCard',
]);

export function patchTouchesRefs(patch: Partial<WsShot>): boolean {
  return Object.keys(patch).some((key) => REF_PATCH_FIELDS.has(key));
}

/** 带重排的分镜补丁：任何增删参考的写入都应走这里而不是裸 updateShot */
export function buildRefAwarePatch(shot: WsShot, patch: Partial<WsShot>, ctx: ShotRefsContext): Partial<WsShot> {
  if (!patchTouchesRefs(patch)) return patch;
  const nextShot = { ...shot, ...patch };
  const remap = remapShotPromptRefs(shot, nextShot, ctx);
  return { ...remap, ...patch };
}

/** 视频提示词的分镜板前缀（编号与 buildVideoRefPaths 中分镜板置首严格一致） */
export function storyboardVideoPrefix(boards: StoryboardBoard[]): string {
  const active = boards.filter((b) => b.imagePath && b.useInVideo !== false);
  if (active.length === 0) return '';
  const refs = active.map((_b, i) => `@图片${numToCn(i + 1)}`).join('、');
  return `以分镜板${refs}作为本镜景别变化和画面参考，保持人物脸部一致、光线方向和画面层次。`;
}

export function stripStoryboardVideoPrefix(prompt?: string): string {
  return (prompt ?? '')
    // 旧版本与 Agent 曾写出多种分镜板前缀。只要它位于提示词开头，
    // Seedance 2.5 隐藏分镜板时都必须整行移除，不能仅删掉 @图片N 后留下
    // “以分镜板作为参考”这种幽灵约束。
    .replace(/^(?:以|参考)\s*分镜[版板][^\n]*(?:\n|$)/u, '')
    .trimStart();
}

const DIRECTOR_CONSTRAINT_PREFIX_RE = /^参考\s*@导演约束卡（对应\s*@图片(?:[一二三四五六七八九十]+|\d+)）[^\n]*\n?/u;
const DIRECTOR_CONSTRAINT_VIDEO_PREFIX_RE = /^以\s*@导演约束卡（对应\s*@图片(?:[一二三四五六七八九十]+|\d+)）[^\n]*\n?/u;

/** 单格故事板启用导演约束卡时的稳定前缀；同时保留模型可识别的 @图片N。 */
export function ensureDirectorConstraintMention(prompt: string, imageIndex: number): string {
  const body = stripDirectorConstraintMention(prompt);
  return `参考 @导演约束卡（对应 @图片${numToCn(imageIndex)}）锁定人物站位、视线、机位和动作关系；只继承空间调度约束，不复制白模材质或僵硬姿势。\n${body}`.trim();
}

export function stripDirectorConstraintMention(prompt?: string): string {
  return (prompt ?? '').replace(DIRECTOR_CONSTRAINT_PREFIX_RE, '').trimStart();
}

/** 视频生成启用导演约束卡时的稳定前缀。 */
export function directorConstraintVideoPrefix(
  shot: WsShot,
  options: VideoRefBindingOptions = {},
): string {
  if (!shot.directorConstraintCard?.imagePath || shot.directorConstraintCard.useInVideo !== true) return '';
  const boardCount = options.includeStoryboardBoards === false
    ? 0
    : (shot.storyboardBoards ?? []).filter((board) => board.imagePath && board.useInVideo !== false).length;
  return `以 @导演约束卡（对应 @图片${numToCn(boardCount + 1)}）锁定本镜人物站位、视线、机位和动作关系；只继承调度约束，不复制白模材质。`;
}

export function stripDirectorConstraintVideoPrefix(prompt?: string): string {
  return (prompt ?? '').replace(DIRECTOR_CONSTRAINT_VIDEO_PREFIX_RE, '').trimStart();
}

/** 生成或手动写入视频提示词时统一补齐可选参考前缀。 */
export function applyVideoPlanningReferencePrefixes(
  shot: WsShot,
  prompt?: string,
  options: VideoRefBindingOptions = {},
): string {
  const body = stripDirectorConstraintVideoPrefix(stripStoryboardVideoPrefix(prompt));
  const prefixes = [
    options.includeStoryboardBoards === false ? '' : storyboardVideoPrefix(shot.storyboardBoards ?? []),
    directorConstraintVideoPrefix(shot, options),
  ].filter(Boolean);
  return [...prefixes, body].filter(Boolean).join('\n').trim();
}

/** 在不改写存量提示词的前提下，为 Seedance 2.5 隐藏故事板并重排 @图片N。 */
export function seedance25PromptForShot(shot: WsShot, ctx: ShotRefsContext): string {
  if (shot.seedance25VideoPrompt?.trim()) {
    return applyVideoPlanningReferencePrefixes(
      shot,
      shot.seedance25VideoPrompt,
      { includeStoryboardBoards: false },
    );
  }
  const fullRefs = buildVideoRefBindings(shot, ctx);
  const seedance25Refs = buildVideoRefBindings(shot, ctx, { includeStoryboardBoards: false });
  const remapped = replaceImageMentionsByBinding(shot.videoPrompt, fullRefs, seedance25Refs);
  return applyVideoPlanningReferencePrefixes(
    shot,
    remapped,
    { includeStoryboardBoards: false },
  );
}

/**
 * Resolve the active prompt variant without mutating either saved template.
 * Seedance 2.5 keeps its historical no-storyboard prompt slot because its
 * submitted reference scope differs from the normal full storyboard scope.
 */
export function videoPromptForShot(
  shot: WsShot,
  ctx: ShotRefsContext,
  options: {
    template: 'legacy' | 'universal';
    includeStoryboardBoards: boolean;
  },
): string {
  const fullRefs = buildVideoRefBindings(shot, ctx);
  const targetRefs = buildVideoRefBindings(shot, ctx, {
    includeStoryboardBoards: options.includeStoryboardBoards,
  });
  const usesHistoricalNoStoryboardPrompt = options.template === 'universal'
    && !options.includeStoryboardBoards
    && !shot.universalVideoPrompt?.trim()
    && Boolean(shot.seedance25VideoPrompt?.trim());
  const basePrompt = options.template === 'universal'
    ? shot.universalVideoPrompt || shot.seedance25VideoPrompt || shot.videoPrompt || ''
    : shot.videoPrompt || '';
  const remapped = options.includeStoryboardBoards || usesHistoricalNoStoryboardPrompt
    ? basePrompt
    : replaceImageMentionsByBinding(basePrompt, fullRefs, targetRefs);
  return applyVideoPlanningReferencePrefixes(shot, remapped, {
    includeStoryboardBoards: options.includeStoryboardBoards,
  });
}
