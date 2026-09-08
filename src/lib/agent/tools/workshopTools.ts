/**
 * workshopTools — agent tools that operate the creation workshop directly.
 * Mirrors the timelineTools pattern: tools mutate workshopStore, the
 * workshop UI updates reactively. Gated to activeView==='workshop'.
 */
import type { Tool } from '../types';
import { useWorkshopStore } from '@/stores/workshopStore';
import { useCanvasTaskStore } from '@/stores/canvasTaskStore';
import { useRunStepStore } from '@/stores/runStepStore';
import { listProjectFiles, projectAbsPath } from '@/lib/aigc/projectStore';
import type { AssetCandidate, WorkshopAssetKind, WorkshopProjectBibles, WorkshopStepId, WorkshopStoryFact, WsCharacter, WsProp, WsScene, WsShot } from '@/lib/workshop/types';
import { renderStepExport } from '@/lib/workshop/exportTemplates';
import { writeProjectFile } from '@/lib/aigc/projectStore';
import { homeDir } from '@tauri-apps/api/path';
import { formatSeedanceValidation, validateSeedancePrompt } from '@/lib/seedance/validation';
import { findAiDramaPerformanceHits, PERFORMANCE_BRIEF } from '@/lib/videoPrompt/performance';
import { ensureVideoThumb } from '@/lib/canvas/videoThumbs';
import {
  applyVideoPlanningReferencePrefixes,
  buildImageRefBindings,
  buildVideoRefBindings,
  clearExplicitEmptyLocks,
  findExtraRefAssetConflict,
  getSceneReferencePaths,
  numToCn,
  patchTouchesRefs,
  remapShotPromptRefs,
  shotReferenceSignature,
  stripDirectorConstraintMention,
  type ShotRefBinding,
} from '@/lib/workshop/shotRefs';
import { mergeAudioPrompts } from '@/lib/workshop/audioPrompts';
import {
  classifyWorkshopEditScope,
  findUnsupportedPromptDialogue,
  findUnsupportedRelationshipClaims,
  isTextSupportedByCanonical,
  valuesEqual,
  type WorkshopEditScope,
} from '@/lib/workshop/narrativeGuard';
import {
  auditShotNarrative,
  auditShotSequence,
  auditStoryFactCoverage,
  auditVideoPromptNarrative,
  findFunctionalRoles,
} from '@/lib/workshop/shotNarrativeAudit';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';

const STEP_IDS = ['script', 'breakdown', 'assets', 'prompts', 'generate', 'handoff'];

const NUM_TO_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五'];

function currentWorkshopEditScope(): { scope: WorkshopEditScope; request: string } {
  const runState = useRunStepStore.getState();
  const run = runState.currentRunId ? runState.runsById[runState.currentRunId] : undefined;
  const request = run?.userRequest?.trim() ?? '';
  return { scope: classifyWorkshopEditScope(request), request };
}

function guardError(action: string, request: string): string {
  return [
    `事实锁已阻止${action}。当前用户要求被识别为“${request || '未明确要求改剧本'}”，不是剧本改写。`,
    '修改提示词时只能写 imagePrompt/videoPrompt/audioPrompts，不得顺带改画面描述、对白、角色、场景或道具关系。',
    '只有用户明确要求修改剧本、剧情、对白、人物关系，或明确要求重排分镜结构时，才能改对应字段。',
  ].join('\n');
}

/**
 * 自动将提示词中的 @文件名.ext 引用转换为 @图片N 格式。
 * 映射规则：最终场景资产在前；只有用户明确启用多角度参考时，场景参考组才连续占位，角色/道具随后。
 */
function normalizePromptRefs(shotNo: string, prompt: string, mode: 'image' | 'video'): string {
  const s = useWorkshopStore.getState();
  if (!s.data) return prompt;
  const shot = s.data.shots.find((x) => x.shotNo === shotNo);
  if (!shot) return prompt;

  const context = {
    scenes: s.data.scenes,
    characters: s.data.characters,
    props: s.data.props ?? [],
    colorPalettes: s.data.colorPalettes ?? [],
    globalColorPaletteId: s.data.globalColorPaletteId,
  };
  const bindings = mode === 'video'
    ? buildVideoRefBindings(shot, context)
    : buildImageRefBindings(shot, context);
  const fileToIdx = new Map<string, number>();
  for (const binding of bindings) {
    const fileName = binding.path.split('/').pop();
    if (fileName && !fileToIdx.has(fileName)) fileToIdx.set(fileName, binding.index);
  }
  const paletteIdx = bindings.find((binding) => binding.kind === 'palette')?.index ?? null;

  let nextPrompt = prompt.replace(/@([^\s@,;，；]+\.\w{2,5})/g, (_match, fileName: string) => {
    const i = fileToIdx.get(fileName);
    return i ? `@图片${numToCn(i)}` : _match;
  });
  if (paletteIdx) {
    nextPrompt = nextPrompt.replace(/@色卡|色卡对应的@图片N|色卡对应的 @图片N/g, `@图片${numToCn(paletteIdx)}`);
  }
  // Agent 写回视频提示词时就固化分镜板/导演约束卡前缀，不能等到点击
  // “生成视频”才临时补。这样界面、校验、画布和实际请求看到的是同一份 prompt。
  return mode === 'video'
    ? applyVideoPlanningReferencePrefixes(shot, nextPrompt)
    : nextPrompt;
}

function textLen(text?: string): number {
  return (text ?? '').replace(/\s+/g, '').length;
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

function isDeclaredLongTake(videoPrompt?: string): boolean {
  return !!videoPrompt && /长镜头|一镜到底|不中断|连续调度|continuous\s+shot|long\s+take/i.test(videoPrompt);
}

function countPattern(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function collectDirectorPromptWarnings(shotNo: string, imagePrompt?: string, videoPrompt?: string): string[] {
  const warnings: string[] = [];

  if (imagePrompt !== undefined) {
    const len = textLen(imagePrompt);
    if (len < 80) warnings.push(`${shotNo}: imagePrompt 过短（${len}字），需要空间锚点、主体站位、景别构图、表演瞬间、光线色温和材质细节`);
    if (!/@图片[一二三四五六七八九十]/.test(imagePrompt)) warnings.push(`${shotNo}: imagePrompt 缺少 @图片N 参考图引用`);
    if (!hasAny(imagePrompt, [/景|构图|特写|近景|中景|全景|远景|过肩|俯拍|仰拍/])) warnings.push(`${shotNo}: imagePrompt 缺少明确景别/构图`);
    if (!hasAny(imagePrompt, [/光|灯|阴影|色温|逆光|侧光|顶光|冷白|暖黄|霓虹|月光|日光|反光/])) warnings.push(`${shotNo}: imagePrompt 缺少光线/色温描述`);
    if (!hasAny(imagePrompt, [/眼神|视线|嘴角|眉|下颌|肩|手指|呼吸|停顿|颤|握|低头|抬眼|僵住|背影/])) warnings.push(`${shotNo}: imagePrompt 缺少表演瞬间或微表情`);
    if (countPattern(imagePrompt, /画面配色严格参考/g) > 1 || countPattern(imagePrompt, /色卡/g) > 2) {
      warnings.push(`${shotNo}: imagePrompt 色卡/配色约束出现过多；色卡只在最后一句统一写一次，不要在每个画面短句重复`);
    }
    const imageDramaHits = findAiDramaPerformanceHits(imagePrompt);
    if (imageDramaHits.length > 0) {
      warnings.push(`${shotNo}: imagePrompt 含 AI 短剧/漫剧风表演词（${imageDramaHits.join('、')}）；默认禁止此类夸张程式化表演，改成克制真实的表演瞬间`);
    }
  }

  if (videoPrompt !== undefined) {
    const len = textLen(videoPrompt);
    const longTake = isDeclaredLongTake(videoPrompt);
    const minLen = longTake ? 520 : 650;
    if (len < minLen) warnings.push(`${shotNo}: videoPrompt 过短（${len}字），默认应写到 700-950 字、约 800 字；${longTake ? '长镜头也需要写清连续调度、焦点变化、表演节拍和环境反馈' : '需要按好莱坞导演分镜标准扩写到多子镜头、拍摄技巧、表演节奏、剪辑切换、空间、光线、材质反馈和环境响应'}`);
    if (!hasAny(videoPrompt, [/光|灯|阴影|色温|逆光|侧光|顶光|冷白|暖黄|霓虹|月光|日光|反光/])) warnings.push(`${shotNo}: videoPrompt 缺少光线/色温变化`);
    if (!hasAny(videoPrompt, [/眼神|视线|嘴角|眉|下颌|肩|手指|呼吸|停顿|颤|握|低头|抬眼|僵住|咬|吞咽|指节|背脊/])) warnings.push(`${shotNo}: videoPrompt 缺少演员表演微动作/微表情`);
    if (!hasAny(videoPrompt, [/摩擦|变形|破裂|碎|灰尘|水面|雪|衣摆|发丝|玻璃|金属|木|地面|墙面|褶皱|震动|回声|反弹|溅|晃动/])) warnings.push(`${shotNo}: videoPrompt 缺少材质变化或环境物理反馈`);
    if (!hasAny(videoPrompt, [/前景|中景|背景|遮挡|纵深|门框|窗框|货架|栏杆|玻璃后|人群后/])) warnings.push(`${shotNo}: videoPrompt 缺少空间层次（前景/中景/背景或遮挡关系）`);
    if (!hasAny(videoPrompt, [/推轨|推镜|拉镜|横移|跟拍|手持|稳定器|摇镜|俯拍|仰拍|过肩|反打|插入镜头|特写|大特写|焦点|景深|移焦|rack\s*focus/i])) warnings.push(`${shotNo}: videoPrompt 缺少明确拍摄技巧（镜头运动、焦点、景别变化或机位设计）`);
    if (!longTake && !hasAny(videoPrompt, [/剪辑|切到|硬切|反应镜头|插入镜头|节奏|停顿|加速|放慢|匹配剪辑|动作接动作|快切|慢切|转场/])) warnings.push(`${shotNo}: videoPrompt 缺少剪辑节奏设计；非长镜头应写出切换触发点、反应镜头或动作接动作的节奏`);
    if (/切换到镜头\S*的理由|切换理由|理由[:：]/.test(videoPrompt)) {
      warnings.push(`${shotNo}: videoPrompt 不要写"理由"说明或"切换到某镜头的理由"这类分析文字；请把剪辑动机改写为画面内可见的动作、视线、声音或情绪触发点`);
    }
    if (/(?:没有|无|不需要|无需).{0,8}(?:VO|vo|旁白|画外音)|(?:VO|vo|旁白|画外音).{0,8}(?:没有|无|不需要|无需)|本句没有|本镜没有/.test(videoPrompt)) {
      warnings.push(`${shotNo}: videoPrompt 不要写"本句没有VO/本镜没有旁白/无画外音"这类占位说明；没有旁白就完全省略 VO 行`);
    }
    if (/很悲伤|很愤怒|很紧张|非常悲伤|非常愤怒|非常紧张|情绪复杂|氛围感|电影感十足/.test(videoPrompt)) {
      warnings.push(`${shotNo}: videoPrompt 出现抽象情绪/空泛形容，需改成可见的身体动作和环境反馈`);
    }
    const videoDramaHits = findAiDramaPerformanceHits(videoPrompt);
    if (videoDramaHits.length > 0) {
      warnings.push(`${shotNo}: videoPrompt 含 AI 短剧/漫剧风表演词（${videoDramaHits.join('、')}）；默认禁止此类夸张程式化表演，改成按"触发→发酵→释放"分层的克制表演，并写清行为目的`);
    }
    if (countPattern(videoPrompt, /画面配色严格参考/g) > 1 || countPattern(videoPrompt, /全片画面配色严格参考/g) > 1 || countPattern(videoPrompt, /色卡/g) > 3) {
      warnings.push(`${shotNo}: videoPrompt 色卡/配色约束重复出现；色卡是全局风格参考，只能在全文最后一句点名一次，子镜头里不要反复写`);
    }
  }

  return warnings;
}

function buildShotRequiredRefs(shot: WsShot, data: NonNullable<ReturnType<typeof useWorkshopStore.getState>['data']>) {
  const bindings = buildShotRefBindings(shot, data);
  const sceneRefIndices = bindings.filter((ref) => ref.kind === 'scene').map((ref) => ref.index);
  return {
    refs: bindings.map((ref) => ({ index: ref.index, label: ref.label })),
    sceneRefCount: sceneRefIndices.length,
    sceneRefIndices,
  };
}

function buildShotRefBindings(shot: WsShot, data: NonNullable<ReturnType<typeof useWorkshopStore.getState>['data']>): ShotRefBinding[] {
  return buildVideoRefBindings(shot, {
    scenes: data.scenes,
    characters: data.characters,
    props: data.props ?? [],
    colorPalettes: data.colorPalettes ?? [],
    globalColorPaletteId: data.globalColorPaletteId,
  });
}

function remapPromptRefsForShot(
  oldShot: WsShot,
  nextShot: WsShot,
  data: NonNullable<ReturnType<typeof useWorkshopStore.getState>['data']>,
): Partial<WsShot> {
  return remapShotPromptRefs(oldShot, nextShot, data);
}

function touchesReferenceFields(patch: Partial<WsShot>): boolean {
  return patchTouchesRefs(patch);
}

function sameStringArray(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  return a.every((item, i) => item === b[i]);
}

function verifyShotPatch(latest: WsShot, patch: Partial<WsShot>): string[] {
  const failures: string[] = [];
  const arrayFields: Array<keyof WsShot> = ['characterIds', 'propIds', 'sceneImagePaths', 'extraRefImages', 'voiceCharacterIds'];
  for (const key of arrayFields) {
    if (key in patch && !sameStringArray(latest[key], patch[key])) failures.push(String(key));
  }
  const scalarFields: Array<keyof WsShot> = ['sceneId', 'imagePath', 'videoPath', 'videoThumbPath', 'videoRatio'];
  for (const key of scalarFields) {
    if (key in patch && latest[key] !== patch[key]) failures.push(String(key));
  }
  return failures;
}

function parseImageRefIndex(ref: unknown): number | null {
  if (typeof ref === 'number' && Number.isFinite(ref)) return Math.max(1, Math.floor(ref));
  if (typeof ref !== 'string') return null;
  const m = ref.match(/@?图片([一二三四五六七八九十]|\d+)/);
  if (!m) return null;
  const raw = m[1];
  const cn = NUM_TO_CN.indexOf(raw);
  if (cn >= 0) return cn + 1;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function uniqStrings(items: unknown[]): string[] {
  return [...new Set(items.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()))];
}

function collectUnlinkedCharacterWarnings(
  shotNo: string,
  shot: WsShot,
  data: NonNullable<ReturnType<typeof useWorkshopStore.getState>['data']>,
  prompts: Array<string | undefined>,
): string[] {
  const text = prompts.filter(Boolean).join('\n');
  if (!text) return [];
  return data.characters
    .filter((character) => character.name && text.includes(character.name) && !(shot.characterIds ?? []).includes(character.id))
    .map((character) => `${shotNo}: 提示词写了角色“${character.name}”，但本镜没有关联该角色。需要露脸时先用 workshop_update_shot_refs 加入 ${character.id}；如果只是剪影或背影，请改写成“织作剪影”等描述性称谓，不要使用具体角色名。`);
}

function validatePromptPatch(
  shotNo: string,
  shot: WsShot,
  data: NonNullable<ReturnType<typeof useWorkshopStore.getState>['data']>,
  imagePrompt?: string,
  videoPrompt?: string,
): { promptNeedsRefresh: boolean; warnings: string[] } {
  const warnings: string[] = [];
  warnings.push(...collectDirectorPromptWarnings(shotNo, imagePrompt, videoPrompt));
  warnings.push(...collectUnlinkedCharacterWarnings(shotNo, shot, data, [imagePrompt, videoPrompt]));

  if (videoPrompt) {
    const narrativeAudit = auditVideoPromptNarrative(shot, videoPrompt, data.characters);
    warnings.push(...narrativeAudit.warnings);
    const { refs: requiredRefs, sceneRefCount, sceneRefIndices } = buildShotRequiredRefs(shot, data);
    const validation = validateSeedancePrompt(videoPrompt, {
      refCount: requiredRefs.length,
      requiredRefs,
      requireSceneRef: sceneRefCount > 0,
      sceneRefIndices,
    });
    if (!validation.ok || validation.warnings.length > 0) {
      warnings.push(`${shotNo}: Seedance 提示词检查\n${formatSeedanceValidation(validation)}`);
    }

    const directorCardRef = buildShotRefBindings(shot, data).find((ref) => ref.kind === 'directorConstraintCard');
    if (directorCardRef) {
      const expectedImageRef = `@图片${numToCn(directorCardRef.index)}`;
      const opening = videoPrompt.slice(0, 520);
      if (!opening.includes('@导演约束卡') || !opening.includes(expectedImageRef)) {
        warnings.push(`${shotNo}: 已启用导演约束卡，但 videoPrompt 开头没有明确引用 @导演约束卡（对应 ${expectedImageRef}）；必须用它锁定人物站位、视线、机位和动作关系`);
      }
    }

    const subShotCount = (videoPrompt.match(/镜头\S+-\d+/g) || []).length;
    const longTake = isDeclaredLongTake(videoPrompt);
    if (!longTake && subShotCount < 3) {
      warnings.push(`${shotNo}: videoPrompt 只有 ${subShotCount} 个子镜头；非长镜头的 8-15 秒分镜默认应包含 3-5 个子镜头，并写出剪辑切换、机位/焦点变化和表演节奏`);
    }
    if (longTake && subShotCount > 1) {
      warnings.push(`${shotNo}: videoPrompt 声明了长镜头/一镜到底，但又写了 ${subShotCount} 个子镜头；请二选一：要么多镜头剪辑，要么写成单个连续调度镜头`);
    }

  }

  return { promptNeedsRefresh: warnings.length > 0, warnings };
}

async function applySinglePromptPatch(
  shotNo: string,
  patch: Pick<Partial<WsShot>, 'imagePrompt' | 'videoPrompt' | 'audioPrompts'>,
  options: { dryRun?: boolean; shotOverride?: WsShot } = {},
): Promise<{ ok: boolean; warnings: string[]; error?: string; appliedPatch?: Partial<WsShot> }> {
  const ws = useWorkshopStore.getState();
  const shot = options.shotOverride ?? ws.data?.shots.find((x) => x.shotNo === shotNo);
  if (!ws.data || !shot) return { ok: false, warnings: [], error: `分镜 ${shotNo} 不存在` };

  const normalizedImage = patch.imagePrompt !== undefined ? normalizePromptRefs(shotNo, patch.imagePrompt, 'image') : undefined;
  const normalizedVideo = patch.videoPrompt !== undefined ? normalizePromptRefs(shotNo, patch.videoPrompt, 'video') : undefined;
  const unsupportedDialogue = findUnsupportedPromptDialogue({
    videoPrompt: normalizedVideo,
    audioPrompts: patch.audioPrompts,
    canonicalDialogue: shot.dialogue,
  });
  if (unsupportedDialogue.length > 0) {
    return {
      ok: false,
      warnings: [],
      error: `分镜 ${shotNo} 的提示词出现原分镜 dialogue 中不存在的对白：${unsupportedDialogue.map((line) => `“${line}”`).join('、')}。提示词优化不得创作新台词；如用户确实要改剧本，请先明确修改分镜对白，再重新生成提示词。`,
    };
  }
  const unsupportedRelationships = findUnsupportedRelationshipClaims({
    prompts: [normalizedImage, normalizedVideo, ...(patch.audioPrompts ?? []).map((item) => item.prompt)],
    canonicalFacts: [shot.sourceExcerpt, shot.description, shot.dialogue].filter(Boolean).join('\n'),
  });
  if (unsupportedRelationships.length > 0) {
    return {
      ok: false,
      warnings: [],
      error: `分镜 ${shotNo} 的提示词新增了原剧本不存在的人物关系：${unsupportedRelationships.join('、')}。电影级导演表达可以丰富，但人物关系必须来自 sourceExcerpt/description/dialogue。`,
    };
  }
  const unlinkedCharacters = collectUnlinkedCharacterWarnings(
    shotNo,
    shot,
    ws.data,
    [normalizedImage, normalizedVideo],
  );
  if (unlinkedCharacters.length > 0) {
    return { ok: false, warnings: [], error: unlinkedCharacters.join('\n') };
  }
  if (normalizedVideo) {
    const narrativeAudit = auditVideoPromptNarrative(shot, normalizedVideo, ws.data.characters);
    if (narrativeAudit.errors.length > 0) {
      return {
        ok: false,
        warnings: narrativeAudit.warnings,
        error: `分镜 ${shotNo} 的剧情覆盖检查未通过：\n${narrativeAudit.errors.join('\n')}`,
      };
    }
  }
  const validation = validatePromptPatch(shotNo, shot, ws.data, normalizedImage, normalizedVideo);
  const promptPatch: Partial<WsShot> = {};
  if (normalizedImage !== undefined) promptPatch.imagePrompt = normalizedImage;
  // 与 workshop_set_prompts 同一套槽位路由：新版（通用）写 universalVideoPrompt，经典版写 videoPrompt
  const promptTemplate = shot.videoPromptTemplate || ws.data.videoPromptTemplate || 'legacy';
  if (normalizedVideo !== undefined) {
    if (promptTemplate === 'universal') promptPatch.universalVideoPrompt = normalizedVideo;
    else promptPatch.videoPrompt = normalizedVideo;
  }
  if (patch.audioPrompts !== undefined) {
    promptPatch.audioPrompts = mergeAudioPrompts(shot.audioPrompts, patch.audioPrompts);
  }
  if (normalizedImage !== undefined || normalizedVideo !== undefined) {
    // 写入即刷新：软警告仍回报给调用方，但"建议重写"标记不再留在镜头上
    promptPatch.promptNeedsRefresh = false;
  }

  if (options.dryRun) {
    return { ok: true, warnings: validation.warnings, appliedPatch: promptPatch };
  }

  ws.updateShot(shotNo, promptPatch);
  ws.markStepStatus('prompts', 'in-progress');
  ws.logChange('prompts', `更新 ${shotNo} 提示词字段${validation.warnings.length ? `，检查警告 ${validation.warnings.length} 条` : ''}`);
  await ws.commitNow();

  const latest = useWorkshopStore.getState().data?.shots.find((x) => x.shotNo === shotNo);
  if (!latest) return { ok: false, warnings: validation.warnings, error: `分镜 ${shotNo} 写入后无法读取` };
  if (normalizedImage !== undefined && latest.imagePrompt !== normalizedImage) {
    return { ok: false, warnings: validation.warnings, error: 'imagePrompt 写入校验失败：保存后内容没有变化，请改用 workshop_set_prompts 重试' };
  }
  const writtenVideo = promptTemplate === 'universal' ? latest.universalVideoPrompt : latest.videoPrompt;
  if (normalizedVideo !== undefined && writtenVideo !== normalizedVideo) {
    return { ok: false, warnings: validation.warnings, error: `${promptTemplate === 'universal' ? 'universalVideoPrompt' : 'videoPrompt'} 写入校验失败：保存后内容没有变化，请改用 workshop_set_prompts 重试` };
  }
  if (promptPatch.audioPrompts !== undefined && JSON.stringify(latest.audioPrompts ?? []) !== JSON.stringify(promptPatch.audioPrompts)) {
    return { ok: false, warnings: validation.warnings, error: 'audioPrompts 写入校验失败：保存后的配音提示词不完整，请重试' };
  }
  return { ok: true, warnings: validation.warnings, appliedPatch: promptPatch };
}



function requireOpen(): { ok: true } | { ok: false; error: string } {
  const { project, data } = useWorkshopStore.getState();
  if (!project || !data) return { ok: false, error: '当前没有打开的工坊项目，请让用户先在创作工坊中打开或新建项目' };
  return { ok: true };
}




/**
 * get_state step 详情里的资产对象瘦身：candidates 是只增不减的历史（每条还带 prompt 全文），
 * 全量序列化会让单次回执到 100-400KB。候选只保留定位/来源/用途 + prompt 80 字预览；
 * 实体本身保留名称、id、assetImagePath（最终图/选中状态）等 Agent 判断信息。
 */
function slimAssetForState<T extends { candidates?: AssetCandidate[] }>(asset: T): T {
  return {
    ...asset,
    candidates: asset.candidates?.map((c) => ({
      path: c.path,
      source: c.source,
      role: c.role,
      promptPreview: c.prompt ? (c.prompt.length > 80 ? `${c.prompt.slice(0, 80)}...` : c.prompt) : undefined,
    })),
  };
}

const getStateTool: Tool = {
  definition: {
    name: 'workshop_get_state',
    description: '获取创作工坊状态。任何操作前必须先调用。section 可显式指定读取区域，避免用户切换页面后 currentStep 改变导致 Agent 读错数据；修改某一镜时请传 shot_no。',
    parameters: {
      type: 'object',
      properties: {
        detail: { type: 'string', enum: ['summary', 'step'], description: 'summary=概要（默认），step=附当前步骤完整数据' },
        section: { type: 'string', enum: ['current', 'breakdown', 'assets', 'prompts', 'generate'], description: '显式读取区域，默认 current。Agent 不应依赖用户当前打开的标签页猜状态。' },
        shot_no: { type: 'string', description: '可选。detail=step 且在提示词/生成步骤时，只返回该分镜的完整数据，避免一次塞入全片提示词。' },
      },
      required: [],
    },
  },
  risk: 'safe',
  async execute(params) {
    const s = useWorkshopStore.getState();
    const summary = s.getStateSummary();
    const generationTasks = useCanvasTaskStore.getState().tasks
      .filter((t) => t.workshopShotNo)
      .slice(-30)
      .map((t) => ({
        id: t.id,
        shotNo: t.workshopShotNo,
        kind: t.workshopShotKind,
        engineId: t.engineId,
        status: t.status,
        progress: t.progress,
        rhTaskId: t.rhTaskId,
        resultPaths: t.resultPaths,
        resultUrls: t.resultUrls,
        error: t.error,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        finishedAt: t.finishedAt,
      }));
    const preview = (text?: string, max = 220) => {
      if (!text) return undefined;
      return text.length > max ? `${text.slice(0, max)}...` : text;
    };
    if (params.detail === 'step' && s.data) {
      const requestedSection = typeof params.section === 'string' ? params.section : 'current';
      const step = requestedSection === 'current' ? s.data.currentStep : requestedSection;
      const requestedShotNo = typeof params.shot_no === 'string' ? params.shot_no.trim() : '';
      const detail = step === 'breakdown'
        ? {
            synopsis: s.data.synopsis,
            sourceEvidence: s.data.breakdownSourceEvidence ?? [],
            storyFacts: s.data.storyFacts ?? [],
            episodes: s.data.episodes,
            characters: s.data.characters,
            scenes: s.data.scenes,
            props: s.data.props ?? [],
          }
        : step === 'assets'
          ? {
              characters: s.data.characters.map(slimAssetForState),
              scenes: s.data.scenes.map(slimAssetForState),
              props: (s.data.props ?? []).map(slimAssetForState),
              colorPalettes: (s.data.colorPalettes ?? []).map(slimAssetForState),
              globalColorPaletteId: s.data.globalColorPaletteId,
              // 绑定断链清单：没有定版图（assetImagePath 为空）的资产，agent 据此主动补图或采用候选
              unboundAssets: [
                ...s.data.characters.filter((c) => !c.assetImagePath).map((c) => `character:${c.id} ${c.name}（候选 ${c.candidates?.length ?? 0} 张）`),
                ...s.data.scenes.filter((sc) => !sc.assetImagePath).map((sc) => `scene:${sc.id} ${sc.name}（候选 ${sc.candidates?.length ?? 0} 张）`),
                ...(s.data.props ?? []).filter((p) => !p.assetImagePath).map((p) => `prop:${p.id} ${p.name}（候选 ${p.candidates?.length ?? 0} 张）`),
              ],
            }
          : step === 'prompts' || step === 'generate'
            ? {
                shots: s.data.shots
                  .filter((shot) => !requestedShotNo || shot.shotNo === requestedShotNo)
                  .map((shot) => {
                  const { refs, sceneRefCount } = buildShotRequiredRefs(shot, s.data!);
                  const full = !!requestedShotNo;
                  const base = full ? shot : {
                    shotNo: shot.shotNo,
                    episode: shot.episode,
                    sceneId: shot.sceneId,
                    description: shot.description,
                    sourceExcerpt: shot.sourceExcerpt,
                    dialogue: shot.dialogue,
                    shotType: shot.shotType,
                    camera: shot.camera,
                    mood: shot.mood,
                    durationSec: shot.durationSec,
                    characterIds: shot.characterIds,
                    propIds: shot.propIds,
                    videoRatio: shot.videoRatio,
                    videoModel: shot.videoModel,
                    imagePath: shot.imagePath,
                    videoPath: shot.videoPath,
                    genStatus: shot.genStatus,
                    genError: shot.genError,
                    promptNeedsRefresh: shot.promptNeedsRefresh,
                    referenceRevision: shot.referenceRevision ?? 0,
                    imagePromptLength: shot.imagePrompt?.length ?? 0,
                    videoPromptLength: shot.videoPrompt?.length ?? 0,
                    imagePromptPreview: preview(shot.imagePrompt),
                    videoPromptPreview: preview(shot.videoPrompt),
                    storyboardFrameCount: shot.storyboardFrames?.length ?? 0,
                    storyboardBoardCount: shot.storyboardBoards?.length ?? 0,
                    // 故事板帧/分镜板只给计数和 id；完整内容传 shot_no 单镜读取。
                    storyboardFrameIds: (shot.storyboardFrames ?? []).map((frame) => frame.id),
                    storyboardBoardIds: (shot.storyboardBoards ?? []).map((board) => board.id),
                    hasDirectorConstraintCard: Boolean(shot.directorConstraintCard?.imagePath),
                    directorConstraintAppliedFrameCount: (shot.storyboardFrames ?? []).filter((frame) => frame.useDirectorConstraintCard === true).length,
                  };
                  return {
                    ...base,
                    referenceSignature: shotReferenceSignature(shot, s.data!),
                    // 新流程不把历史故事板加入参考；视频与静帧只使用当前显式参考。
                    videoReferenceOrder: refs.map((ref) => `@图片${numToCn(ref.index)}=${ref.label}`),
                    imageReferenceOrder: buildImageRefBindings(shot, s.data!).map((ref) => `@图片${numToCn(ref.index)}=${ref.label}`),
                    videoReferenceBindings: buildVideoRefBindings(shot, s.data!).map((ref) => ({
                      ref: `@图片${numToCn(ref.index)}`,
                      kind: ref.kind,
                      label: ref.label,
                      id: ref.id,
                      path: ref.path,
                    })),
                    imageReferenceBindings: buildImageRefBindings(shot, s.data!).map((ref) => ({
                      ref: `@图片${numToCn(ref.index)}`,
                      kind: ref.kind,
                      label: ref.label,
                      id: ref.id,
                      path: ref.path,
                    })),
                    sceneReferenceCount: sceneRefCount,
                    legacyHistoricalStoryboards: {
                      frameCount: shot.storyboardFrames?.length ?? 0,
                      boardCount: shot.storyboardBoards?.length ?? 0,
                      participatesInGeneration: false,
                      occupiesReferenceNumber: false,
                    },
                    directorConstraintCard: shot.directorConstraintCard?.imagePath
                      ? {
                          id: shot.directorConstraintCard.id,
                          imagePath: shot.directorConstraintCard.imagePath,
                          prompt: shot.directorConstraintCard.prompt,
                          useInVideo: shot.directorConstraintCard.useInVideo === true,
                          rule: '导演约束卡是镜头“空间与调度”的可选参考。只有 useInVideo=true 时才进入当前镜头的视频参考和 @图片N 顺序。',
                        }
                      : null,
                  };
                }),
                characters: s.data.characters.map(slimAssetForState),
                scenes: s.data.scenes.map(slimAssetForState),
                props: (s.data.props ?? []).map(slimAssetForState),
                colorPalettes: (s.data.colorPalettes ?? []).map(slimAssetForState),
                globalColorPaletteId: s.data.globalColorPaletteId,
              }
            : {};
      return { success: true, output: `${summary}\n\n生成任务:\n${JSON.stringify(generationTasks)}\n\n当前步骤数据:\n${JSON.stringify(detail)}` };
    }
    return { success: true, output: `${summary}\n\n生成任务:\n${JSON.stringify(generationTasks)}` };
  },
};

const getShotRefsTool: Tool = {
  definition: {
    name: 'workshop_get_shot_refs',
    description: '读取单镜真实参考顺序和快照签名。修改参考资产或写提示词前调用；写回 workshop_set_prompts 时原样传 expectedRefSignature，防止用户换图后 Agent 仍按旧 @图片N 覆盖。',
    parameters: {
      type: 'object',
      properties: {
        shot_no: { type: 'string', description: '分镜编号' },
      },
      required: ['shot_no'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const data = useWorkshopStore.getState().data!;
    const shotNo = String(params.shot_no ?? '').trim();
    const shot = data.shots.find((item) => item.shotNo === shotNo);
    if (!shot) return { success: false, output: '', error: `未找到分镜 ${shotNo}` };
    const serialize = (binding: ShotRefBinding) => ({
      ref: `@图片${numToCn(binding.index)}`,
      kind: binding.kind,
      id: binding.id,
      label: binding.label,
      path: binding.path,
    });
    return {
      success: true,
      output: JSON.stringify({
        shotNo,
        referenceRevision: shot.referenceRevision ?? 0,
        referenceSignature: shotReferenceSignature(shot, data),
        imageReferenceBindings: buildImageRefBindings(shot, data).map(serialize),
        videoReferenceBindings: buildVideoRefBindings(shot, data).map(serialize),
        promptNeedsRefresh: shot.promptNeedsRefresh === true,
      }),
    };
  },
};

const readSourceTool: Tool = {
  definition: {
    name: 'workshop_read_source',
    description: '列出工坊项目的剧本源文件（sources/ 目录），返回绝对路径。docx/pdf 等非纯文本请用对应 skill 或工具读取内容。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  risk: 'safe',
  async execute() {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const { project } = useWorkshopStore.getState();
    const files = await listProjectFiles(project!.id, 'sources');
    const home = await homeDir();
    const base = projectAbsPath(project!.id).replace('~/', home);
    const links = project!.sources.filter((s) => s.type === 'link');
    return {
      success: true,
      output: JSON.stringify({
        files: files.map((f) => `${base}/sources/${f}`),
        feishuLinks: links.map((l) => l.url),
      }),
    };
  },
};

const saveScriptTool: Tool = {
  definition: {
    name: 'workshop_save_script',
    description: '把与用户讨论后定稿的剧本/大纲写入项目文档（文档页「原剧本」区实时可见、可编辑）。仅在剧本内容已与用户对齐后调用；同名文件再次调用会覆盖更新；后续拆解必须以写入的定稿文件为准。',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '剧本定稿全文（Markdown）' },
        name: { type: 'string', description: '可选文件名，默认「剧本定稿.md」' },
      },
      required: ['content'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const content = String(params.content ?? '').trim();
    if (!content) return { success: false, output: '', error: '剧本内容为空，未写入' };
    const project = useWorkshopStore.getState().project!;
    const rawName = String(params.name ?? '').trim() || '剧本定稿.md';
    const name = /\.(md|txt)$/i.test(rawName) ? rawName : `${rawName}.md`;
    try {
      await writeProjectFile(project.id, `sources/${name}`, content, { requireSuccess: true });
      const state = useWorkshopStore.getState();
      if (state.project?.id !== project.id) return { success: false, output: '', error: '项目已切换，文件已写入磁盘但未登记到当前项目' };
      if (!state.project!.sources.some((s) => s.name === name)) {
        useWorkshopStore.setState({
          project: { ...state.project!, sources: [...state.project!.sources, { name, type: 'md', size: content.length, uploadedAt: Date.now() }] },
        });
        state.scheduleSave();
      }
      return { success: true, output: JSON.stringify({ saved: name, bytes: content.length }) };
    } catch (error) {
      return { success: false, output: '', error: error instanceof Error ? error.message : '剧本写入失败' };
    }
  },
};

const saveDocumentTool: Tool = {
  definition: {
    name: 'workshop_save_document',
    description: '把项目工作文档写入项目 docs/ 目录（文档页「项目文档」区实时可见、可编辑），用于讨论纪要、分镜说明、角色小传、创作规则等。剧本定稿请用 workshop_save_script。同名文件再次调用会覆盖更新。',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '文档全文（Markdown）' },
        name: { type: 'string', description: '文件名，如「讨论纪要.md」；缺省自动命名为 项目文档-时间戳.md' },
      },
      required: ['content'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const content = String(params.content ?? '').trim();
    if (!content) return { success: false, output: '', error: '文档内容为空，未写入' };
    const project = useWorkshopStore.getState().project!;
    const rawName = String(params.name ?? '').trim() || `项目文档-${Date.now()}.md`;
    const name = /\.(md|txt)$/i.test(rawName) ? rawName : `${rawName}.md`;
    try {
      await writeProjectFile(project.id, `docs/${name}`, content, { requireSuccess: true });
      return { success: true, output: JSON.stringify({ saved: `docs/${name}`, bytes: content.length }) };
    } catch (error) {
      return { success: false, output: '', error: error instanceof Error ? error.message : '文档写入失败' };
    }
  },
};

const setBreakdownTool: Tool = {
  definition: {
    name: 'workshop_set_breakdown',
    description: '写入第②步拆解结果：故事梗概、逐字证据、逐场剧情事实账本、分集分场和角色档案。首次拆解必须先建立 storyFacts，再写分镜；司机、乘客、店员、保安等参与事件的功能角色也必须进入 characters 和 participantIds。已有拆解默认受事实锁保护：重新分析只能补漏纠错，不得凭空改故事、对白或人物。',
    parameters: {
      type: 'object',
      properties: {
        sourceEvidence: {
          type: 'array',
          items: { type: 'string' },
          description: '3-30 条从剧本逐字摘录的短句，覆盖主要人物和事件。禁止润色、概括或填写提示词。',
        },
        storyFacts: {
          type: 'array',
          description: '逐场剧情事实账本。每个有事件的段落至少一条，先于分镜设计建立。',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '稳定事实 ID，如 scene-01-event-01' },
              sceneId: { type: 'string', description: '对应场景 ID' },
              sourceExcerpt: { type: 'string', description: '能证明该事实的剧本逐字原文' },
              participantIds: { type: 'array', items: { type: 'string' }, description: '事件所有参与者 ID，含功能角色' },
              event: { type: 'string', description: '谁触发了什么可见事件' },
              result: { type: 'string', description: '事件结束时已成立的可见结果；无明确结果写“未交代”' },
              entryState: { type: 'string', description: '事件开始前已成立的人物位置、关系、道具和动作状态；供内部接戏检查' },
              exitState: { type: 'string', description: '事件结束后必须延续的人物位置、关系、道具和动作状态；供内部接戏检查' },
            },
            required: ['id', 'sourceExcerpt', 'participantIds', 'event', 'result'],
          },
        },
        synopsis: { type: 'string', description: '故事梗概（200-500字）' },
        episodes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              no: { type: 'string', description: '集号，如 "1"' },
              title: { type: 'string' },
              sceneList: { type: 'string', description: '本集场次概览，分号分隔' },
            },
            required: ['no', 'title', 'sceneList'],
          },
        },
        characters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '英文短 id，如 "linfeng"' },
              name: { type: 'string' },
              personality: { type: 'string', description: '性格' },
              appearance: { type: 'string', description: '外形（年龄/身材/服饰/面部特征，生图可用的具体描述）' },
              lifecycleStages: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { stage: { type: 'string' }, appearance: { type: 'string' } },
                  required: ['stage', 'appearance'],
                },
                description: '形象随剧情变化时填写（如 少年期/中年期）',
              },
            },
            required: ['id', 'name', 'personality', 'appearance'],
          },
        },
        scenes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              description: { type: 'string', description: '场景视觉描述（环境/光线/氛围）' },
            },
            required: ['id', 'name', 'description'],
          },
        },
        props: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              description: { type: 'string', description: '道具视觉描述' },
            },
            required: ['id', 'name', 'description'],
          },
        },
      },
      required: ['synopsis'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const s = useWorkshopStore.getState();
    const { data } = s;
    const { scope, request } = currentWorkshopEditScope();
    const hasExistingBreakdown = Boolean(
      data?.synopsis?.trim()
      || data?.episodes?.length
      || data?.characters?.length
      || data?.scenes?.length
      || data?.props?.length,
    );
    const sourceEvidence = Array.isArray(params.sourceEvidence)
      ? [...new Set(params.sourceEvidence
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean))]
      : [];
    const hasSourceMaterial = Boolean(s.project?.sources?.length);
    const storyFacts = Array.isArray(params.storyFacts)
      ? (params.storyFacts as WorkshopStoryFact[]).filter((fact) => fact && typeof fact.id === 'string')
      : [];
    if (!hasExistingBreakdown && hasSourceMaterial && (sourceEvidence.length < 3 || sourceEvidence.length > 30)) {
      return {
        success: false,
        output: '',
        error: '首次剧本拆解必须提交 3-30 条 sourceEvidence，逐字摘录并覆盖主要人物与事件。电影化表达可以丰富，但故事事实必须先有原文收据。',
      };
    }
    if (!hasExistingBreakdown && hasSourceMaterial && storyFacts.length === 0) {
      return {
        success: false,
        output: '',
        error: '首次剧本拆解必须提交 storyFacts。请先逐场记录“逐字原文、参与者、事件、结果”，再设计分镜，避免把人物事件拆成空镜。',
      };
    }
    if (storyFacts.length > 0) {
      const incomingCharacterIds = new Set([
        ...(data?.characters ?? []).map((character) => character.id),
        ...(Array.isArray(params.characters) ? (params.characters as WsCharacter[]).map((character) => character.id) : []),
      ]);
      const invalidFacts = storyFacts.flatMap((fact) => {
        const issues: string[] = [];
        if (!fact.sourceExcerpt?.trim()) issues.push(`${fact.id}: 缺少逐字 sourceExcerpt`);
        if (!fact.event?.trim()) issues.push(`${fact.id}: 缺少可见事件 event`);
        if (!fact.result?.trim()) issues.push(`${fact.id}: 缺少事件结果 result`);
        for (const participantId of fact.participantIds ?? []) {
          if (!incomingCharacterIds.has(participantId)) issues.push(`${fact.id}: participantIds 引用了未建档角色 ${participantId}`);
        }
        const factText = `${fact.sourceExcerpt ?? ''}\n${fact.event ?? ''}`;
        for (const role of findFunctionalRoles(factText)) {
          const roleCharacter = [
            ...(data?.characters ?? []),
            ...(Array.isArray(params.characters) ? params.characters as WsCharacter[] : []),
          ].find((character) => character.name.includes(role));
          if (!roleCharacter) issues.push(`${fact.id}: 原文出现功能角色“${role}”，但 characters 未建档。请把参与事件的功能角色作为正式角色保存。`);
          else if (!(fact.participantIds ?? []).includes(roleCharacter.id)) issues.push(`${fact.id}: 原文出现“${role}”，但 participantIds 未包含 ${roleCharacter.id}`);
        }
        return issues;
      });
      if (invalidFacts.length > 0) {
        return { success: false, output: '', error: `剧情事实账本检查未通过：\n${invalidFacts.join('\n')}` };
      }
    }
    if (hasExistingBreakdown && scope !== 'story') {
      const conflicts: string[] = [];
      if (typeof params.synopsis === 'string' && data?.synopsis?.trim() && params.synopsis.trim() !== data.synopsis.trim()) {
        conflicts.push('故事梗概');
      }
      if (Array.isArray(params.episodes) && data?.episodes?.length && !valuesEqual(params.episodes, data.episodes)) {
        conflicts.push('分集分场');
      }
      const checkCoreEntities = (
        incoming: unknown,
        existing: Array<{ id: string; name: string }>,
        label: string,
      ) => {
        if (!Array.isArray(incoming) || existing.length === 0) return;
        const oldById = new Map(existing.map((item) => [item.id, item]));
        const changed = (incoming as Array<{ id?: string; name?: string }>).some((item) => {
          if (!item.id) return true;
          const old = oldById.get(item.id);
          return !old || (typeof item.name === 'string' && item.name !== old.name);
        });
        if (changed) conflicts.push(label);
      };
      checkCoreEntities(params.characters, data?.characters ?? [], '角色名单');
      checkCoreEntities(params.scenes, data?.scenes ?? [], '场景名单');
      checkCoreEntities(params.props, data?.props ?? [], '道具名单');
      if (conflicts.length > 0) {
        return {
          success: false,
          output: '',
          error: `${guardError(`已有拆解中的${conflicts.join('、')}`, request)}\n如果只是重新分析，请保留既有故事事实和实体 ID，只补充外形、性格或视觉描述。`,
        };
      }
    }
    if (params.synopsis || sourceEvidence.length > 0 || storyFacts.length > 0) {
      useWorkshopStore.setState({
        data: {
          ...useWorkshopStore.getState().data!,
          ...(params.synopsis ? { synopsis: params.synopsis as string } : {}),
          ...(sourceEvidence.length > 0 ? { breakdownSourceEvidence: sourceEvidence } : {}),
          ...(storyFacts.length > 0 ? { storyFacts: storyFacts.map((fact) => ({ ...fact, participantIds: [...(fact.participantIds ?? [])] })) } : {}),
        },
      });
    }
    if (Array.isArray(params.episodes)) s.setEpisodes(params.episodes as { no: string; title: string; sceneList: string }[]);
    if (Array.isArray(params.characters)) s.upsertCharacters(params.characters as WsCharacter[]);
    if (Array.isArray(params.scenes)) s.upsertScenes(params.scenes as WsScene[]);
    if (Array.isArray(params.props)) s.upsertProps(params.props as WsProp[]);
    s.invalidateDownstream('breakdown');
    s.markStepStatus('breakdown', 'in-progress');
    s.logChange('breakdown', `写入拆解：角色 ${(params.characters as unknown[])?.length ?? data?.characters.length ?? 0}，场景 ${(params.scenes as unknown[])?.length ?? 0}`);
    await useWorkshopStore.getState().commitNow();
    return {
      success: true,
      output: `拆解结果已写入工坊（梗概/分集/角色/场景）${sourceEvidence.length ? `，保存 ${sourceEvidence.length} 条原文证据` : ''}${storyFacts.length ? `、${storyFacts.length} 条剧情事实` : ''}，UI 已更新`,
    };
  },
};

const setShotsTool: Tool = {
  definition: {
    name: 'workshop_set_shots',
    description: `写入分镜表。已有分镜默认受事实锁保护：改提示词时禁止调用本工具改 description/dialogue/角色/场景；重新拆分镜头可以调整结构，但对白只能逐字继承已有剧本；只有用户本轮明确要求改剧本/对白时才允许创作性修改。

⚠ mode 选择极其重要：merge（默认推荐）按 shotNo 合并，只更新传入字段不影响其他分镜；replace 会全量替换所有分镜——除非是新项目初始建立分镜骨架，否则禁止使用 replace。长剧本分批调用（每批 ≤15 镜，mode="merge"）。

【先拆事件，再设计镜头——禁止把剧情拆成空镜合集】
- 先从剧本逐场列出“人物/功能角色 → 触发动作 → 事件结果”的事实链，再为事实链分配镜头。司机、乘客、店员、保安、路人等只要参与事件，都必须建立角色并写入 characterIds，不能因为没有姓名就省略。
- 每个剧本事件至少有一条 narrativeFunction="event" 的人物承载镜头；关键后果用 consequence，人物接收信息后的变化用 reaction。建立镜头只负责快速交代空间，不能代替事件镜头。
- 无人物镜头是例外：只有空间建立、必要转场、线索细节、事件余波或结果状态才允许，并填写 emptyShotPurpose。禁止连续两条空镜，禁止把“公路上司机遇到事件”拆成只有道路、车辆和尘土的纯空镜。
- 同一场景按信息推进组织：必要时短暂建立空间 → 事件人物与动作 → 反应/关键细节 → 事件结果。不要机械套固定景别顺序，但也不要让单一信息距离承包剧情；同场连续三条远景/全景、连续三条近景/特写、无递进的连续大特写都会被拒绝。多人事件必须有中景、过肩、双人同框或等价关系镜头。

【必填字段纪律——每条分镜必须填齐】
- sceneId: 必须关联场景（从 breakdown 步骤的 scenes 中选），不允许留空
- characterIds: 必须列出该镜头中出现的所有角色 ID，不允许留空数组（除非确实无人物的空镜）
- propIds: 如果镜头中有道具（从 breakdown 步骤的 props 中选），必须填入
- shotType: 该分镜的主景别（大远景/远景/全景/中景/近景/特写/大特写）
- camera: 主运镜（推/拉/摇/移/升/降/甩/跟/环绕/固定 等）
- mood: 情绪必填（紧张/悲伤/温馨/激昂/平静/压抑/释然 等）
- narrativeFunction: 叙事职能必填（establish/event/reaction/detail/consequence/transition）
- emptyShotPurpose: 仅 characterIds=[] 时必填，说明该空镜不可替代的叙事用途
- durationSec: 时长必填，每条分镜 8-15 秒（Seedance 2.5 项目可到 30 秒；禁止 3-5 秒的短分镜！）

【分镜结构——每条分镜是一段完整片段】
每条分镜是一个 8-15 秒（2.5 项目可到 30 秒）的完整视频片段，内部包含多个子镜头（在 videoPrompt 里用多镜头模板实现）：
- 格式：镜头N-1 Xs [{景别}/{运镜}] xxx，镜头N-2 Xs [{景别}/{运镜}] xxx，…
- 子镜头景别跟随信息距离变化：先看清事件关系，再进入动作、反应或结果。正反打可保持近景，但连续大全景/全景或连续近景/特写都不得承包整段剧情；大特写只用于关键触点、线索和情绪峰值
- 禁止一条分镜只写一个子镜头！8-15 秒必须有 2-4 个子镜头（2.5 项目的长分镜按比例增加切点）

【画面描述质量要求】
description 字段要有电影感：
- 必须包含：人物动作（具体肢体+力度）、表情/情绪外化（低头/握拳/颤抖，不用抽象形容词"悲伤""愤怒"）、环境光线氛围
- 必须包含当前空间站位：人物相对稳定场景锚点的位置、彼此前后/左右/距离、身体朝向和视线方向。同一 sceneId 的连续镜头继承 continuity.blockingContinuity，不能因正反打、特写或机位变化自动镜像换位
- 只有剧情明确发生移动时才改站位，并写清“从哪个锚点、沿什么路径、到哪个锚点”；本镜结尾位置是下一关联镜头的起始状态
- 优先保证：剧本事件承担者、触发动作和可见结果。前景遮幅、路人反应、细节道具只能服务事件，不能挤掉事件本身
- 单个子镜头只用 1 种运镜（官方要求：不要同一镜头同时推拉摇移）`,
    parameters: {
      type: 'object',
      properties: {
        shots: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              shotNo: { type: 'string', description: '镜号，如 "01-01"（集-镜）' },
              episode: { type: 'string' },
              sceneId: { type: 'string', description: '【必填】关联场景 id（从 breakdown 的 scenes 中选）' },
              description: { type: 'string', description: '画面描述（需有电影感：具体动作+情绪外化+环境光线）' },
              sourceExcerpt: { type: 'string', description: '新建分镜时填写对应的剧本原文短句，必须逐字摘录，不要润色。它是事实锁证据，不是提示词。' },
              sourceFactIds: { type: 'array', items: { type: 'string' }, description: '【有 storyFacts 时必填】本镜覆盖的剧情事实 ID；至少一条事件镜必须覆盖每个事实。' },
              dialogue: { type: 'string', description: '对白' },
              shotType: { type: 'string', description: '【必填】主景别（大远景/远景/全景/中景/近景/特写/大特写），内部子镜头可在 videoPrompt 里各自标 [景别/运镜]' },
              camera: { type: 'string', description: '【必填】主运镜（推/拉/摇/移/升/降/甩/跟/环绕/固定）' },
              mood: { type: 'string', description: '【必填】情绪（紧张/悲伤/温馨/激昂/平静/压抑/释然 等）' },
              narrativeFunction: {
                type: 'string',
                enum: ['establish', 'event', 'reaction', 'detail', 'consequence', 'transition'],
                description: '【必填】叙事职能：建立空间/推进事件/人物反应/关键细节/事件结果/必要转场',
              },
              emptyShotPurpose: { type: 'string', description: 'characterIds=[] 时必填。说明空镜用于空间建立、必要转场、线索、余波或结果状态，不能只写“氛围”。' },
              directorDecision: {
                type: 'object',
                description: 'Agent 内部镜头决策，不在普通界面额外展示。用于保证每镜有新信息、景别有理由、切点明确且前后接戏。',
                properties: {
                  entryState: { type: 'string', description: '本镜开始时继承的人物位置、朝向、视线、手中物和动作进度' },
                  newInformation: { type: 'string', description: '本镜相比上一镜新增的唯一主要信息' },
                  shotScaleReason: { type: 'string', description: '为什么观众此刻需要这个景别/观察距离' },
                  cutTrigger: { type: 'string', description: '触发切镜的动作、视线、声音、揭示或情绪变化' },
                  exitState: { type: 'string', description: '本镜结束时下一镜必须继承的状态' },
                  soundRole: { type: 'string', description: '声音承担的叙事作用；没有特殊作用可省略' },
                },
                required: ['entryState', 'newInformation', 'shotScaleReason', 'cutTrigger', 'exitState'],
              },
              durationSec: { type: 'number', description: '【必填】时长 8-15 秒（Seedance 2.5 项目可到 30 秒；禁止 3-5s 短分镜）' },
              characterIds: { type: 'array', items: { type: 'string' }, description: '【必填】该镜头中出现的所有角色 ID（空镜除外不允许留空）' },
              propIds: { type: 'array', items: { type: 'string' }, description: '【有道具必填】关联道具 ID（参考图排在角色之后）' },
              videoRatio: { type: 'string', description: '视频生成比例（必填才能生成视频），如 "16:9"/"9:16"/"4:3"/"3:4"/"1:1"/"21:9"' },
            },
            required: ['shotNo', 'description', 'sceneId', 'shotType', 'characterIds', 'narrativeFunction'],
          },
        },
        mode: { type: 'string', enum: ['replace', 'merge'], description: '默认 merge（按 shotNo 合并）；replace 全量替换——仅限新项目初建' },
      },
      required: ['shots'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const s = useWorkshopStore.getState();
    const mode = (params.mode as 'replace' | 'merge') ?? 'merge';
    const incoming = params.shots as Partial<WsShot>[];
    const { scope, request } = currentWorkshopEditScope();
    const existingShots = s.data!.shots;

    if (existingShots.length > 0) {
      const existingByNo = new Map(existingShots.map((shot) => [shot.shotNo, shot]));
      const canonicalDialogue = existingShots.map((shot) => shot.dialogue ?? '').filter(Boolean).join('\n');
      const conflicts: string[] = [];
      if (mode === 'replace' && scope !== 'story' && scope !== 'shots') {
        conflicts.push('全量替换分镜表');
      }
      for (const candidate of incoming) {
        const shotNo = candidate.shotNo ?? '未知镜号';
        const existing = candidate.shotNo ? existingByNo.get(candidate.shotNo) : undefined;
        if (!existing) {
          if (scope !== 'story' && scope !== 'shots') conflicts.push(`${shotNo} 新增分镜`);
        } else {
          const structuralFields: Array<keyof WsShot> = ['description', 'episode', 'sceneId', 'characterIds', 'propIds', 'sourceFactIds', 'narrativeFunction', 'emptyShotPurpose', 'directorDecision'];
          const changed = structuralFields.filter((field) =>
            candidate[field] !== undefined && !valuesEqual(candidate[field], existing[field]));
          if (changed.length > 0 && scope !== 'story' && scope !== 'shots') {
            conflicts.push(`${shotNo} ${changed.join('/')}`);
          }
        }

        if (candidate.dialogue !== undefined) {
          const oldDialogue = existing?.dialogue ?? '';
          const dialogueChanged = candidate.dialogue !== oldDialogue;
          const supportedRedistribution = scope === 'shots'
            && Boolean(candidate.dialogue.trim())
            && isTextSupportedByCanonical(candidate.dialogue, canonicalDialogue);
          if (dialogueChanged && scope !== 'story' && !supportedRedistribution) {
            conflicts.push(`${shotNo} 对白`);
          }
        }
      }
      if (mode === 'replace' && scope === 'shots') {
        const nextDialogue = incoming.map((shot) => shot.dialogue ?? '').filter(Boolean).join('\n');
        if (
          canonicalDialogue.trim()
          && (!isTextSupportedByCanonical(nextDialogue, canonicalDialogue)
            || !isTextSupportedByCanonical(canonicalDialogue, nextDialogue))
        ) {
          conflicts.push('replace 后的对白总量与原剧本不一致');
        }
      }
      if (conflicts.length > 0) {
        return {
          success: false,
          output: '',
          error: `${guardError(`分镜事实字段：${[...new Set(conflicts)].slice(0, 12).join('、')}`, request)}\n重新拆分镜头可以调整画面描述和资产关系，但原对白必须逐字来自现有剧本；需要改台词时请让用户明确提出。`,
        };
      }
    }

    const warnings: string[] = [];
    for (const shot of incoming) {
      if (!shot.sceneId) warnings.push(`${shot.shotNo}: 缺少 sceneId`);
      if (!shot.shotType) warnings.push(`${shot.shotNo}: 缺少景别 shotType`);
      if (!shot.camera) warnings.push(`${shot.shotNo}: 缺少运镜 camera`);
      if (!shot.mood) warnings.push(`${shot.shotNo}: 缺少情绪 mood`);
      if (shot.durationSec && shot.durationSec < 8) warnings.push(`${shot.shotNo}: 时长 ${shot.durationSec}s 过短，每条分镜应 8-15 秒（Seedance 2.5 项目可到 30 秒）`);
      if (
        (shot.characterIds?.length ?? 0) > 0
        && !/(?:位于|站在|坐在|倚在|躺在|靠近|面向|背对|左侧|右侧|前方|后方|对面|旁边|门口|窗边|桌前|桌后|台前|台后|相距|视线|朝向|前景|中景|后景|从.{0,16}(?:走|跑|移|退|绕|穿过).{0,16}(?:到|至|向))/u.test(shot.description ?? '')
      ) {
        warnings.push(`${shot.shotNo}: description 缺少可继承的空间站位。请写人物相对场景锚点的位置、朝向/视线及彼此关系；发生走位时写清起点和终点`);
      }
      if (
        !existingShots.some((item) => item.shotNo === shot.shotNo)
        && s.project?.sources?.length
        && !shot.sourceExcerpt?.trim()
      ) {
        warnings.push(`${shot.shotNo}: 缺少 sourceExcerpt。当前项目有源剧本，新建分镜必须附对应原文证据，不能只凭模型概括。`);
      }
      const narrativeAudit = auditShotNarrative(shot, s.data!.characters);
      warnings.push(...narrativeAudit.errors, ...narrativeAudit.warnings);
      if ((s.data!.storyFacts?.length ?? 0) > 0) {
        if (!shot.sourceFactIds?.length) {
          warnings.push(`${shot.shotNo}: 缺少 sourceFactIds，无法证明本镜覆盖了哪条剧情事实。`);
        } else {
          const knownFactIds = new Set(s.data!.storyFacts!.map((fact) => fact.id));
          const unknownFactIds = shot.sourceFactIds.filter((id) => !knownFactIds.has(id));
          if (unknownFactIds.length > 0) warnings.push(`${shot.shotNo}: sourceFactIds 不存在：${unknownFactIds.join('、')}`);
        }
      }
    }

    const projectedShots = mode === 'replace'
      ? incoming.map((shot) => ({ characterIds: [], ...shot }) as WsShot)
      : (() => {
          const incomingByNo = new Map(incoming.map((shot) => [shot.shotNo, shot]));
          const merged = existingShots.map((shot) => ({
            ...shot,
            ...(incomingByNo.get(shot.shotNo) ?? {}),
          }));
          const existingNos = new Set(existingShots.map((shot) => shot.shotNo));
          return merged.concat(
            incoming
              .filter((shot) => !existingNos.has(shot.shotNo ?? ''))
              .map((shot) => ({ characterIds: [], ...shot }) as WsShot),
          );
        })();
    projectedShots.sort((a, b) => a.shotNo.localeCompare(b.shotNo, 'zh-CN', { numeric: true }));

    const sequenceAudit = auditShotSequence(incoming, s.data!.characters, { validateShots: false });
    warnings.push(...sequenceAudit.errors, ...sequenceAudit.warnings);
    if (mode === 'merge' && existingShots.length > 0 && incoming.length > 0) {
      const projectedAudit = auditShotSequence(projectedShots, s.data!.characters, { validateShots: false });
      warnings.push(...projectedAudit.errors, ...projectedAudit.warnings);
    }
    if ((s.data!.storyFacts?.length ?? 0) > 0) {
      const factAudit = auditStoryFactCoverage(projectedShots, s.data!.storyFacts!);
      warnings.push(...factAudit.errors, ...factAudit.warnings);
    }

    const uniqueWarnings = [...new Set(warnings)];
    if (uniqueWarnings.length > 0) {
      return {
        success: false,
        output: '',
        error: `分镜数据质量检查未通过，请修正后重试：\n${uniqueWarnings.join('\n')}`,
      };
    }

    if (mode === 'replace') {
      const existing = s.data!.shots.length;
      if (existing > 5 && incoming.length < existing * 0.5) {
        return {
          success: false,
          output: '',
          error: `安全阀：replace 模式会把现有 ${existing} 条分镜替换为仅 ${incoming.length} 条，将删除 ${existing - incoming.length} 条分镜。如果你要分批写入请用 mode="merge"；如果确实要全量重建请先用 workshop_get_state 确认并告知用户。`,
        };
      }
    }

    const shots = incoming.map((x) => ({
      characterIds: [],
      ...x,
    })) as WsShot[];
    s.setShots(shots, mode);
    s.logChange('breakdown', `写入分镜 ${shots.length} 条（${mode}）`);
    await useWorkshopStore.getState().commitNow();
    return { success: true, output: `已写入 ${shots.length} 条分镜（${mode}），当前共 ${useWorkshopStore.getState().data!.shots.length} 镜` };
  },
};

const setBiblesTool: Tool = {
  definition: {
    name: 'workshop_set_bibles',
    description: `写入项目四圣经：导演圣经、角色圣经、场景圣经、连续性圣经。
用于剧本拆解完成后，把全项目必须继承的镜头/光影/角色/场景/连续性规则固化下来。
后续资产提示词、分镜提示词、Seedance 视频提示词都必须继承这些规则。
不要把单镜临时创意写进四圣经；只写跨全片稳定生效的约束。
continuity.blockingContinuity 专门记录每一幕/每一场景的世界空间站位基准和剧情触发的走位递进：场景锚点、人物相对位置/朝向/距离、180度轴线、出入口、上一状态→触发动作→下一状态。不要只写“画面左/右”，因为换机位后屏幕方位会变化。`,
    parameters: {
      type: 'object',
      properties: {
        bibles: {
          type: 'object',
          description: 'WorkshopProjectBibles 对象，可包含 director/character/scene/continuity 四段。每段必须带 updatedAt（毫秒时间戳）；没有则工具自动补齐。',
        },
      },
      required: ['bibles'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const now = Date.now();
    const incoming = params.bibles as WorkshopProjectBibles;
    const bibles: WorkshopProjectBibles = {
      director: incoming.director ? { ...incoming.director, updatedAt: incoming.director.updatedAt || now } : undefined,
      character: incoming.character ? { ...incoming.character, updatedAt: incoming.character.updatedAt || now } : undefined,
      scene: incoming.scene ? { ...incoming.scene, updatedAt: incoming.scene.updatedAt || now } : undefined,
      continuity: incoming.continuity ? { ...incoming.continuity, updatedAt: incoming.continuity.updatedAt || now } : undefined,
    };
    const store = useWorkshopStore.getState();
    store.setBibles(bibles);
    const projectId = store.project?.id;
    if (projectId) {
      await writeProjectFile(projectId, 'bibles/index.json', JSON.stringify(bibles, null, 2));
      if (bibles.director) await writeProjectFile(projectId, 'bibles/director-bible.json', JSON.stringify(bibles.director, null, 2));
      if (bibles.character) await writeProjectFile(projectId, 'bibles/character-bible.json', JSON.stringify(bibles.character, null, 2));
      if (bibles.scene) await writeProjectFile(projectId, 'bibles/scene-bible.json', JSON.stringify(bibles.scene, null, 2));
      if (bibles.continuity) await writeProjectFile(projectId, 'bibles/continuity-bible.json', JSON.stringify(bibles.continuity, null, 2));
    }
    await useWorkshopStore.getState().commitNow();
    const active = [
      bibles.director && '导演圣经',
      bibles.character && '角色圣经',
      bibles.scene && '场景圣经',
      bibles.continuity && '连续性圣经',
    ].filter(Boolean).join('、') || '空';
    return { success: true, output: `已写入项目四圣经：${active}` };
  },
};

const updateShotTool: Tool = {
  definition: {
    name: 'workshop_update_shot',
    description: `修改单条分镜的字段。调用前必须用 project_get_objects 读取该镜头稳定对象的 version，并把它作为 expected_version 传回；版本变化或对象锁定时不会覆盖用户修改。事实锁：用户只要求改提示词时，不得修改 description/dialogue/sourceExcerpt/characterIds/sceneId/propIds；只有用户明确要求改剧本、对白或重排分镜时才放行。force_edit 不能绕过事实锁。

patch 可用的字段名（必须严格一致）：description（画面描述）、sourceExcerpt（对应剧本逐字原文）、sourceFactIds（覆盖的剧情事实 ID）、narrativeFunction（叙事职能）、emptyShotPurpose（无人物镜头的必要用途）、dialogue（对白）、shotType（景别）、camera（运镜）、mood（情绪）、durationSec（时长 8-15s）、characterIds（关联角色ID数组，必填！）、propIds（关联道具ID数组）、sceneId（关联场景ID，必填！）、voiceCharacterIds（本镜显式启用的角色音色资产ID数组；只有这里列出的角色 voicePath 才会传入视频生成；没有台词/不需要音色时传 []）、audioInjected（是否把 generatedAudios 作为本镜配音资产传入）、generatedAudios（已生成配音文件）、imagePrompt（生图提示词）、videoPrompt（视频提示词，默认必须用多镜头模板格式含 3-5 个子镜头；只有明确声明长镜头/一镜到底时才允许 1 个连续调度镜头）、expectedRefSignature（写提示词时从 workshop_get_shot_refs 原样带回的参考签名，不会存入分镜）、videoRatio（视频比例，如 "16:9"）、imagePath（生成图路径）、videoPath（视频路径）、genStatus。注意：不要用 prompt，必须用 imagePrompt 或 videoPrompt。批量或长文本提示词优先用 workshop_set_prompts；如果这里传 imagePrompt/videoPrompt，本工具会自动走同一套提示词校验与写后校验，videoPrompt 会按项目或单镜 videoPromptTemplate 写入经典版（videoPrompt）或新版（universalVideoPrompt）独立槽位，互不覆盖。

⚠ videoPrompt 写作要求（和 workshop_set_prompts 一致）：
- 每镜必须独立可读，禁止"承接上一镜"，首句重建空间锚点
- 默认按好莱坞导演分镜写到 700-950 字、约 800 字；不要写成一段很短的剧情概括
- 非长镜头必须包含 3-5 个子镜头，写出景别变化、机位/焦点、表演节拍、可见的剪辑触发点；适合长镜头时必须明确写"长镜头/一镜到底"，并写清演员走位、焦点转移和节奏段落。禁止在 videoPrompt 正文里写"理由"说明或"切换到某镜头的理由"。
- 人物名后必须紧跟 @图片N（如"陈墨@图片二"），禁止只写名字不带图引用
- 物理反馈：核心动作→材质变化→环境响应，禁止抽象形容词
- 禁止冒号标签（"前景：""画面："），写自然句
- 跨镜衔接用"已经+结果状态"（动作延续）或起始亮度过渡（光影突变）`,
    parameters: {
      type: 'object',
      properties: {
        shot_no: { type: 'string' },
        expected_version: { type: 'number', description: 'project_get_objects 刚读取到的镜头对象版本号。' },
        patch: {
          type: 'object',
          description: '要更新的字段子集，如 {"durationSec": 10}。长文本提示词建议用 workshop_set_prompts；这里传 videoPrompt/imagePrompt 时会自动走提示词管线。',
        },
      },
      required: ['shot_no', 'expected_version', 'patch'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const s = useWorkshopStore.getState();
    const shotNo = params.shot_no as string;
    const expectedVersion = Number(params.expected_version);
    if (!Number.isFinite(expectedVersion)) {
      return { success: false, output: '', error: 'expected_version 必填。请先调用 project_get_objects 读取该镜头的当前版本。' };
    }
    if (!s.data!.shots.some((x) => x.shotNo === shotNo)) {
      return { success: false, output: '', error: `分镜 ${shotNo} 不存在` };
    }
    const rawPatch = params.patch as Record<string, unknown>;
    const forceEdit = rawPatch.force_edit === true;
    const expectedRefSignature = typeof rawPatch.expectedRefSignature === 'string'
      ? rawPatch.expectedRefSignature
      : typeof rawPatch.expected_ref_signature === 'string'
        ? rawPatch.expected_ref_signature
        : undefined;
    const promptPatch: Pick<Partial<WsShot>, 'imagePrompt' | 'videoPrompt' | 'audioPrompts'> = {};
    const patch: Partial<WsShot> = {};
    for (const [k, v] of Object.entries(rawPatch)) {
      if (k === 'force_edit' || k === 'expectedRefSignature' || k === 'expected_ref_signature') continue;
      if (k === 'imagePrompt' || k === 'image_prompt') {
        if (typeof v === 'string') promptPatch.imagePrompt = v;
        continue;
      }
      if (k === 'videoPrompt' || k === 'video_prompt') {
        if (typeof v === 'string') promptPatch.videoPrompt = v;
        continue;
      }
      if (k === 'audioPrompts' || k === 'audio_prompts') {
        if (Array.isArray(v)) promptPatch.audioPrompts = v as WsShot['audioPrompts'];
        continue;
      }
      if (k === 'character_ids') {
        if (Array.isArray(v)) patch.characterIds = v.filter((x): x is string => typeof x === 'string');
        continue;
      }
      if (k === 'characterIds') {
        if (Array.isArray(v)) patch.characterIds = v.filter((x): x is string => typeof x === 'string');
        continue;
      }
      if (k === 'prop_ids') {
        if (Array.isArray(v)) patch.propIds = v.filter((x): x is string => typeof x === 'string');
        continue;
      }
      if (k === 'propIds') {
        if (Array.isArray(v)) patch.propIds = v.filter((x): x is string => typeof x === 'string');
        continue;
      }
      if (k === 'scene_id') {
        if (typeof v === 'string') patch.sceneId = v;
        continue;
      }
      if (k === 'sceneId') {
        if (typeof v === 'string') patch.sceneId = v;
        continue;
      }
      if (k === 'scene_image_paths') {
        if (Array.isArray(v)) patch.sceneImagePaths = v.filter((x): x is string => typeof x === 'string');
        continue;
      }
      if (k === 'sceneImagePaths') {
        if (Array.isArray(v)) patch.sceneImagePaths = v.filter((x): x is string => typeof x === 'string');
        continue;
      }
      if (k === 'extra_ref_images') {
        if (Array.isArray(v)) patch.extraRefImages = v.filter((x): x is string => typeof x === 'string');
        continue;
      }
      if (k === 'extraRefImages') {
        if (Array.isArray(v)) patch.extraRefImages = v.filter((x): x is string => typeof x === 'string');
        continue;
      }
      if (k === 'voiceCharacterIds' || k === 'voice_character_ids') {
        if (Array.isArray(v)) patch.voiceCharacterIds = v.filter((x): x is string => typeof x === 'string');
        continue;
      }
      if (v !== undefined) (patch as Record<string, unknown>)[k] = v;
    }

    // Protection: warn when modifying shots that already have generated output
    const existingShot = s.data!.shots.find((x) => x.shotNo === shotNo)!;
    const { scope, request } = currentWorkshopEditScope();
    const structuralFields: Array<keyof WsShot> = ['description', 'sourceExcerpt', 'sourceFactIds', 'narrativeFunction', 'emptyShotPurpose', 'episode', 'sceneId', 'characterIds', 'propIds'];
    const changedStructural = structuralFields.filter((field) =>
      patch[field] !== undefined && !valuesEqual(patch[field], existingShot[field]));
    const changesDialogue = patch.dialogue !== undefined && patch.dialogue !== existingShot.dialogue;
    if (
      (changedStructural.length > 0 && scope !== 'story' && scope !== 'shots')
      || (changesDialogue && scope !== 'story')
    ) {
      const fields = [
        ...changedStructural,
        ...(changesDialogue ? ['dialogue'] : []),
      ];
      return {
        success: false,
        output: '',
        error: guardError(`分镜 ${shotNo} 的 ${fields.join('、')}`, request),
      };
    }
    const protectedFields = ['characterIds', 'propIds', 'sceneId', 'durationSec'];
    const touchesPrompt = promptPatch.imagePrompt !== undefined || promptPatch.videoPrompt !== undefined || promptPatch.audioPrompts !== undefined;
    if (touchesPrompt && expectedRefSignature) {
      const currentRefSignature = shotReferenceSignature(existingShot, s.data!);
      if (expectedRefSignature !== currentRefSignature) {
        return {
          success: false,
          output: '',
          error: `分镜 ${shotNo} 的参考资产已在读取后发生变化。请重新调用 workshop_get_shot_refs，并按当前签名 ${currentRefSignature} 重写提示词。`,
        };
      }
    }
    const touchesProtected = touchesPrompt || protectedFields.some((f) => f in patch);
    if (!forceEdit && touchesProtected && (existingShot.videoPath || existingShot.imagePath)) {
      const hasVideo = !!existingShot.videoPath;
      const hasImage = !!existingShot.imagePath;
      const what = [hasVideo && '视频', hasImage && '分镜图'].filter(Boolean).join('和');
      return {
        success: false,
        output: '',
        error: `分镜 ${shotNo} 已有生成的${what}。修改 ${Object.keys(patch).join('/')} 后现有产物将与新内容不一致。请先确认用户同意修改，然后在 patch 中额外传入 force_edit: true 来覆盖保护。`,
      };
    }

    const latestStore = useWorkshopStore.getState();
    const oldShot = latestStore.data!.shots.find((x) => x.shotNo === shotNo)!;
    const nextShot = { ...oldShot, ...patch };
    const refRemap = touchesReferenceFields(patch) ? remapPromptRefsForShot(oldShot, nextShot, latestStore.data!) : {};
    let finalPatch: Partial<WsShot> = { ...refRemap, ...patch };
    let promptWarnings: string[] = [];
    if (touchesPrompt) {
      const result = await applySinglePromptPatch(shotNo, promptPatch, {
        dryRun: true,
        shotOverride: { ...nextShot, ...refRemap },
      });
      if (!result.ok) return { success: false, output: '', error: result.error ?? `分镜 ${shotNo} 提示词写入失败` };
      finalPatch = { ...finalPatch, ...(result.appliedPatch ?? {}) };
      promptWarnings = result.warnings;
    }
    const status = useUnifiedProjectStore.getState().applyAgentShotPatch({
      shotNo,
      expectedVersion,
      patch: finalPatch,
    });
    if (status === 'locked') return { success: false, output: '', error: `分镜 ${shotNo} 已锁定，Agent 不能修改。` };
    if (status === 'conflict') return { success: false, output: '', error: `分镜 ${shotNo} 已被用户修改，已创建可见冲突，未自动覆盖。` };
    if (status !== 'applied') return { success: false, output: '', error: `分镜 ${shotNo} 的统一对象不存在，请重新打开项目后再试。` };
    if (touchesPrompt) {
      useWorkshopStore.getState().markStepStatus('prompts', 'in-progress');
      useWorkshopStore.getState().logChange('prompts', `更新 ${shotNo} 提示词字段${promptWarnings.length ? `，检查警告 ${promptWarnings.length} 条` : ''}`);
    }
    await useWorkshopStore.getState().commitNow();
    const latest = useWorkshopStore.getState().data?.shots.find((x) => x.shotNo === shotNo);
    if (!latest) return { success: false, output: '', error: `分镜 ${shotNo} 写入后无法读取` };
    const verifyFailures = verifyShotPatch(latest, finalPatch);
    if (verifyFailures.length > 0) {
      return { success: false, output: '', error: `分镜 ${shotNo} 字段写入校验失败：${verifyFailures.join('、')} 保存后未生效。请刷新工坊状态后重试。` };
    }
    const changed = Object.keys(finalPatch);
    const warningText = promptWarnings.length
      ? `\n检查警告（已写入并标记建议重写）：\n${promptWarnings.slice(0, 12).join('\n')}${promptWarnings.length > 12 ? `\n…还有 ${promptWarnings.length - 12} 条` : ''}`
      : '';
    return { success: true, output: `分镜 ${shotNo} 已更新：${changed.join('、') || '无字段变化'}；改动可审阅并撤销本轮。${warningText}` };
  },
};

const updateShotRefsTool: Tool = {
  definition: {
    name: 'workshop_update_shot_refs',
    description: `专门管理单条分镜实际传入生成的参考资产。用于添加/删除/替换 @图片N 背后的真实引用，避免只改提示词但资产没有传入。

常用：
- 给某镜加入角色参考：{"shot_no":"05-04","add_character_ids":["winged_beast_flying_bronze"]}
- 从某镜移除角色参考：{"shot_no":"05-04","remove_character_ids":["winged_beast_flying_bronze"]}
- 删除当前 @图片七：{"shot_no":"05-04","remove_refs":["@图片七"]}
- 替换当前 @图片七 为角色：{"shot_no":"05-04","replace_ref":"@图片七","to_kind":"character","to_id":"winged_beast_flying_bronze"}
- 单独指定本镜场景参考图：{"shot_no":"05-04","set_scene_image_paths":["/abs/a.png"]}；传 [] 表示本镜不传场景图；不传表示跟随场景默认图。

注意：这个工具改的是实际参考资产，并会按图片路径自动重排 imagePrompt/videoPrompt/storyboardFrames 里的 @图片N。语义内容仍可能需要用 workshop_set_prompts 进一步重写。`,
    parameters: {
      type: 'object',
      properties: {
        shot_no: { type: 'string' },
        add_character_ids: { type: 'array', items: { type: 'string' } },
        remove_character_ids: { type: 'array', items: { type: 'string' } },
        set_character_ids: { type: 'array', items: { type: 'string' } },
        add_prop_ids: { type: 'array', items: { type: 'string' } },
        remove_prop_ids: { type: 'array', items: { type: 'string' } },
        set_prop_ids: { type: 'array', items: { type: 'string' } },
        set_scene_image_paths: { type: 'array', items: { type: 'string' }, description: '本镜场景参考图路径。[] 表示本镜不传场景图；不传则不修改。' },
        add_extra_ref_images: { type: 'array', items: { type: 'string' } },
        remove_extra_ref_images: { type: 'array', items: { type: 'string' } },
        remove_refs: { type: 'array', items: { type: 'string' }, description: '按当前 @图片N 删除引用，如 ["@图片七"]。' },
        replace_ref: { type: 'string', description: '要替换的当前引用编号，如 @图片七。' },
        to_kind: { type: 'string', enum: ['character', 'prop', 'scene', 'extra'] },
        to_id: { type: 'string', description: 'to_kind 为 character/prop 时使用。' },
        to_path: { type: 'string', description: 'to_kind 为 scene/extra 时使用，也可用于把某角色/道具的资产图作为 extra 传入。' },
      },
      required: ['shot_no'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const ws = useWorkshopStore.getState();
    const data = ws.data!;
    const shotNo = String(params.shot_no ?? '').trim();
    const shot = data.shots.find((x) => x.shotNo === shotNo);
    if (!shot) return { success: false, output: '', error: `分镜 ${shotNo} 不存在` };

    const charIds = new Set(shot.characterIds ?? []);
    const propIds = new Set(shot.propIds ?? []);
    let sceneImagePaths = shot.sceneImagePaths ? [...shot.sceneImagePaths] : undefined;
    const extraRefImages = new Set(shot.extraRefImages ?? []);
    let storyboardBoards = shot.storyboardBoards;
    let colorPaletteId = shot.colorPaletteId;
    const changed: string[] = [];
    const warnings: string[] = [];

    const ensureCharacter = (id: string): string | null => {
      const c = data.characters.find((x) => x.id === id);
      if (!c) return `角色 ID 不存在：${id}`;
      if (!c.assetImagePath) warnings.push(`角色"${c.name}"还没有资产图，加入后生成时仍可能缺参考图`);
      return null;
    };
    const ensureProp = (id: string): string | null => {
      const p = (data.props ?? []).find((x) => x.id === id);
      if (!p) return `道具 ID 不存在：${id}`;
      if (!p.assetImagePath) warnings.push(`道具"${p.name}"还没有资产图，加入后生成时仍可能缺参考图`);
      return null;
    };
    const refCtx = {
      scenes: data.scenes,
      characters: data.characters,
      props: data.props ?? [],
      colorPalettes: data.colorPalettes ?? [],
      globalColorPaletteId: data.globalColorPaletteId,
    };
    // 额外参考 vs 资产定版：path 归属的资产已绑定本镜时，旧版本图与定版图都不再
    // 以 extra 重复占号（资产绑定本身已把定版图传入）。
    const skipConflictingExtra = (path: string): boolean => {
      const effectivePaletteId = colorPaletteId === '__none__' ? undefined : colorPaletteId ?? data.globalColorPaletteId;
      const conflict = findExtraRefAssetConflict(path, data.projectObjects?.media, {
        characterIds: charIds,
        propIds,
        sceneId: shot.sceneId,
        paletteId: effectivePaletteId,
      }, refCtx);
      if (!conflict) return false;
      warnings.push(conflict.reason === 'already-covered'
        ? `已跳过额外参考 ${path}：已绑定资产「${conflict.name}」的定版图已随资产绑定传入，重复添加会多占一个 @图片N 编号`
        : `已跳过额外参考 ${path}：该路径是已绑定资产「${conflict.name}」的旧版本图，本镜已通过资产绑定使用其定版图`);
      return true;
    };
    const addTarget = (kind: unknown, id: unknown, path: unknown) => {
      if (kind === 'character') {
        if (typeof id !== 'string' || !id.trim()) throw new Error('to_kind=character 需要 to_id');
        const err = ensureCharacter(id.trim());
        if (err) throw new Error(err);
        charIds.add(id.trim());
        changed.push('characterIds');
      } else if (kind === 'prop') {
        if (typeof id !== 'string' || !id.trim()) throw new Error('to_kind=prop 需要 to_id');
        const err = ensureProp(id.trim());
        if (err) throw new Error(err);
        propIds.add(id.trim());
        changed.push('propIds');
      } else if (kind === 'scene') {
        if (typeof path !== 'string' || !path.trim()) throw new Error('to_kind=scene 需要 to_path');
        sceneImagePaths = [...new Set([...(sceneImagePaths ?? getSceneReferencePaths(shot, data.scenes)), path.trim()])];
        changed.push('sceneImagePaths');
      } else if (kind === 'extra') {
        if (typeof path !== 'string' || !path.trim()) throw new Error('to_kind=extra 需要 to_path');
        if (skipConflictingExtra(path.trim())) return;
        extraRefImages.add(path.trim());
        changed.push('extraRefImages');
      }
    };
    const removeBinding = (binding: ShotRefBinding) => {
      if (binding.kind === 'storyboardBoard') {
        storyboardBoards = (storyboardBoards ?? []).filter((b) => b.id !== binding.id);
        changed.push('storyboardBoards');
      } else if (binding.kind === 'scene') {
        const current = sceneImagePaths ?? getSceneReferencePaths(shot, data.scenes);
        sceneImagePaths = current.filter((p) => p !== binding.path);
        changed.push('sceneImagePaths');
      } else if (binding.kind === 'character') {
        if (binding.id) charIds.delete(binding.id);
        changed.push('characterIds');
      } else if (binding.kind === 'prop') {
        if (binding.id) propIds.delete(binding.id);
        changed.push('propIds');
      } else if (binding.kind === 'extra') {
        extraRefImages.delete(binding.path);
        changed.push('extraRefImages');
      } else if (binding.kind === 'palette') {
        colorPaletteId = '__none__';
        changed.push('colorPaletteId');
      }
    };

    try {
      if (Array.isArray(params.set_character_ids)) {
        const ids = uniqStrings(params.set_character_ids);
        for (const id of ids) {
          const err = ensureCharacter(id);
          if (err) return { success: false, output: '', error: err };
        }
        charIds.clear();
        ids.forEach((id) => charIds.add(id));
        changed.push('characterIds');
      }
      for (const id of uniqStrings(Array.isArray(params.add_character_ids) ? params.add_character_ids : [])) {
        const err = ensureCharacter(id);
        if (err) return { success: false, output: '', error: err };
        charIds.add(id);
        changed.push('characterIds');
      }
      for (const id of uniqStrings(Array.isArray(params.remove_character_ids) ? params.remove_character_ids : [])) {
        charIds.delete(id);
        changed.push('characterIds');
      }

      if (Array.isArray(params.set_prop_ids)) {
        const ids = uniqStrings(params.set_prop_ids);
        for (const id of ids) {
          const err = ensureProp(id);
          if (err) return { success: false, output: '', error: err };
        }
        propIds.clear();
        ids.forEach((id) => propIds.add(id));
        changed.push('propIds');
      }
      for (const id of uniqStrings(Array.isArray(params.add_prop_ids) ? params.add_prop_ids : [])) {
        const err = ensureProp(id);
        if (err) return { success: false, output: '', error: err };
        propIds.add(id);
        changed.push('propIds');
      }
      for (const id of uniqStrings(Array.isArray(params.remove_prop_ids) ? params.remove_prop_ids : [])) {
        propIds.delete(id);
        changed.push('propIds');
      }

      if (Array.isArray(params.set_scene_image_paths)) {
        sceneImagePaths = uniqStrings(params.set_scene_image_paths);
        changed.push('sceneImagePaths');
      }
      uniqStrings(Array.isArray(params.add_extra_ref_images) ? params.add_extra_ref_images : []).forEach((path) => {
        if (skipConflictingExtra(path)) return;
        extraRefImages.add(path);
        changed.push('extraRefImages');
      });
      uniqStrings(Array.isArray(params.remove_extra_ref_images) ? params.remove_extra_ref_images : []).forEach((path) => {
        extraRefImages.delete(path);
        changed.push('extraRefImages');
      });

      const bindings = buildShotRefBindings(shot, data);
      const removeRefs = Array.isArray(params.remove_refs) ? params.remove_refs : [];
      for (const ref of removeRefs) {
        const index = parseImageRefIndex(ref);
        if (!index) return { success: false, output: '', error: `无法识别引用编号：${String(ref)}` };
        const binding = bindings.find((b) => b.index === index);
        if (!binding) return { success: false, output: '', error: `当前分镜没有 @图片${numToCn(index)} 对应的参考资产` };
        removeBinding(binding);
      }

      if (params.replace_ref) {
        const index = parseImageRefIndex(params.replace_ref);
        if (!index) return { success: false, output: '', error: `无法识别 replace_ref：${String(params.replace_ref)}` };
        const binding = bindings.find((b) => b.index === index);
        if (!binding) return { success: false, output: '', error: `当前分镜没有 @图片${numToCn(index)} 对应的参考资产` };
        removeBinding(binding);
        addTarget(params.to_kind, params.to_id, params.to_path);
      }
    } catch (err) {
      return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
    }

    const uniqueChanged = [...new Set(changed)];
    if (uniqueChanged.length === 0) {
      return { success: true, output: `分镜 ${shotNo} 参考资产未变化` };
    }

    const patch: Partial<WsShot> = {
      characterIds: [...charIds],
      propIds: [...propIds],
      extraRefImages: [...extraRefImages],
      promptNeedsRefresh: true,
    };
    if (sceneImagePaths !== undefined) patch.sceneImagePaths = sceneImagePaths;
    if (storyboardBoards !== shot.storyboardBoards) patch.storyboardBoards = storyboardBoards;
    if (colorPaletteId !== shot.colorPaletteId) patch.colorPaletteId = colorPaletteId;
    // 参考字段有变化时解除"显式清空"锁定：选角按新状态能产出引用的层清掉
    // explicitEmpty 标记（projection 作为解锁意图经 draft 保存路径整层重建），
    // 产出不了引用的层保留锁定。
    const unlock = clearExplicitEmptyLocks(shot, { ...shot, ...patch }, refCtx);
    if (unlock) patch.workspaceReferenceProjection = unlock.projection;
    const nextShot = { ...shot, ...patch };
    const refRemap = remapPromptRefsForShot(shot, nextShot, data);
    const finalPatch = { ...refRemap, ...patch };
    useWorkshopStore.getState().updateShot(shotNo, finalPatch);
    useWorkshopStore.getState().markStepStatus('prompts', 'in-progress');
    useWorkshopStore.getState().logChange('prompts', `更新 ${shotNo} 参考资产：${uniqueChanged.join('、')}`);
    await useWorkshopStore.getState().commitNow();

    const latest = useWorkshopStore.getState().data?.shots.find((x) => x.shotNo === shotNo);
    if (!latest) return { success: false, output: '', error: `分镜 ${shotNo} 写入后无法读取` };
    const verifyFailures = verifyShotPatch(latest, patch);
    if (verifyFailures.length > 0) {
      return {
        success: false,
        output: '',
        error: `分镜 ${shotNo} 参考资产写入校验失败：${verifyFailures.join('、')} 保存后未生效。请刷新工坊状态后重试。`,
      };
    }
    const formatRefs = (list: ShotRefBinding[]) => list.map((ref) => `@图片${numToCn(ref.index)}=${ref.label}`).join('；');
    const imageSummary = formatRefs(buildImageRefBindings(latest, refCtx)) || '无图片参考';
    const videoSummary = formatRefs(buildVideoRefBindings(latest, refCtx)) || '无视频参考';
    const unlockNote = unlock
      ? `\n已解除${unlock.unlocked.map((type) => (type === 'image' ? '图片' : '视频')).join('、')}参考层的清空锁定，按当前选角重建参考。`
      : '';
    return {
      success: true,
      output: `分镜 ${shotNo} 参考资产已更新：${uniqueChanged.join('、')}\n图片参考层：${imageSummary}\n视频参考层：${videoSummary}${warnings.length ? `\n提醒：${warnings.join('；')}` : ''}${unlockNote}\n已按真实图片路径同步重排 @图片N；如画面语义也变了，请继续用 workshop_set_prompts 重写。`,
    };
  },
};

const setPromptsTool: Tool = {
  definition: {
    name: 'workshop_set_prompts',
    description: `批量写入分镜的生图/视频提示词。此工具只写提示词，绝不修改剧本事实。传入字段仍叫 videoPrompt，工具会根据项目全局或单镜 videoPromptTemplate 自动写入“经典版”或“新版”的独立存储，切换版本不会互相覆盖。imagePrompt/videoPrompt/audioPrompts 中的对白必须逐字来自该镜 dialogue；原分镜没有对白时禁止补写台词、VO 或旁白。用户要改剧本时，先明确更新 dialogue，再调用本工具。

【电影级细节与事实锁同时成立】
- 剧情事实层不可创作：出场人物、人物关系、对白、关键动作目标和剧情结果，只能来自 sourceExcerpt / description / dialogue / 已关联角色与道具。
- 导演表达层可以充分创作：景别、机位、运镜、焦点、光影、材质、空间层次、呼吸、视线、手部细节和剪辑节奏可以写到电影级。
- 不得为了凑够“微表情、材质、运镜、剪辑”等项目，新增亲属/恋爱/师徒等关系，新增台词、旁白、人物，或让角色完成原分镜没有的剧情事件。
- 微表演只能解释既有动作和情绪，不能改变剧情。例如可写“指节收紧、呼吸变浅”，不可凭空写“拥抱、亲吻、交付密信、揭露身份”。
- 写提示词前先复述本镜的“事件主体 → 触发动作 → 可见结果”。所有 characterIds 里的剧情参与者必须在 videoPrompt 中按姓名出现；功能角色（司机、乘客、店员等）不能被环境镜头吞掉。
- 空间、光影、材质和前景装饰只能辅助剧情。只要本镜有人物或事件，子镜头必须先保证人物动作、反应和结果，不得写成道路、建筑、车辆、烟尘等连续纯空镜。
- 写前必须调用 workshop_get_shot_refs；写回时把 referenceSignature 原样放进 expectedRefSignature。

【videoPrompt 版本】
- videoPromptTemplate=legacy（经典版）：严格按下面的 Seedance 2.0 多镜头模板。
- videoPromptTemplate=universal（新版）：使用【素材身份】【空间与初始站位】【一句话概述】【时间戳动作与机位】【物理与一致性】【视觉与声音】六段式结构；下面的引用、事实锁、镜头数量、声音和连续性规则仍然适用。

【经典版 Seedance 2.0 多镜头模板】
格式（不允许自由发挥）：
  分镜场景设定在：{场景描述} @图片一（默认只用最终场景资产；如 videoReferenceOrder 中确实有多张场景参考图，继续写 @图片二/@图片三…）
  仅当确实有旁白/画外内心独白时才写：{人物}@图片N（VO）："旁白内容"
  分镜具体动作描述：
  镜头N-1 Xs [{景别}/{运镜}] {画面描述} {人物@图片N} …
  镜头N-2 Xs [{景别}/{运镜}] {画面描述} {人物@图片N} …
  镜头N-3 Xs [{景别}/{运镜}] {画面描述} …
  如有色卡，仅在全文最后一句写：全片画面配色严格参考 @图片N（色卡），用于统一色彩风格。

【每镜必须独立可读——视频模型不知道上一镜拍了什么】
- 禁止写"承接上一镜""继续刚才动作""和前面一样"
- 每镜首句必须重建空间锚点：地点+光源（必写），角色站位/距离/朝向（多人场景必写）
- 锚点要精简：动作即站位（"特木尔抱着查干跪在雪地里"同时交代位置+姿态+动作）、光源只写增量变化、距离用比较级（"几步之外"而非"三米"）
- 单角色场景锚点 10-20 字，双角色 30-50 字，三角色+ 50-70 字；锚点不能挤占画面描述空间

【@图片N 引用纪律——漏引=废片】
- 参考顺序只以 workshop_get_state 返回的 videoReferenceOrder / imageReferenceOrder 为准。旧故事板只是历史素材，默认不进入参考、不占 @图片N 编号。
- 如果 videoReferenceOrder 中出现“导演约束卡”，它必须是用户已显式启用的当前镜头约束。在提示词开头明确写“以 @导演约束卡（对应 @图片N）锁定本镜人物站位、视线、机位和动作关系”，并把 directorConstraintCard.prompt 中的有效调度约束落实到各子镜头；不复制灰模材质或僵硬姿势。
- 导演约束卡之后依次是场景图、角色、道具、额外参考、色卡。场景图、角色、道具和额外参考必须在场景设定行或对应镜头行中点名，不能只写 @图片一。
- 色卡是唯一例外：色卡只作为全局配色参考，必须在全文最后一句点名一次（如"全片画面配色严格参考 @图片七（色卡），用于统一色彩风格。"），禁止在每个子镜头/每句画面描述里反复写"画面配色严格参考..."或"色调参考色卡"。
- 每个出场的角色/道具在每个子镜头行都必须用 @图片N 引用，不能只写名字不带图
- 人物名字后面必须紧跟对应 @图片N，如"陈墨@图片四"，禁止只写"陈墨"
- 引用必须用中文数字（@图片一/二/三…），禁止文件名引用

【子镜头数量与质量——禁止一句话镜头】
- 每条分镜 8-15 秒，默认必须包含 3-5 个子镜头（镜头N-1、N-2、N-3…），并让景别、机位、焦点和剪辑节奏发生真实变化
- 只有剧情本身适合长镜头/一镜到底时，才允许 1 个连续调度镜头；此时必须明确写"长镜头/一镜到底"，并写清演员走位、焦点转移、空间调度、节奏段落和情绪递进
- 各子镜头时长之和 = durationSec
- 子镜头景别根据内容灵活选择（正反打可以全用近景，不要机械套远中近特写）
- 建立空间后要进入事件主体、反应或关键细节；两个以上子镜头全部使用远景/全景会被拒绝。相同近景用于正反打时，必须有不同人物、视线和信息职能。
- 整条提示词要达到电影级细节；各子镜头按剧情需要分配具体动作、微表情、环境光线、空间层次、镜头/焦点和剪辑触发点，不要为让每个子镜头机械凑齐全部项目而新增剧情事实
- 禁止把分析说明写进提示词正文，例如"切换到镜头10-4的理由：..."、"切换理由："、"这样切是因为..."；剪辑动机必须改写成画面内可见的动作、视线、声音、遮挡或情绪落点
- 单个子镜头只用 1 种运镜（官方：不要同一镜头同时推拉摇移）
- 禁止冒号标签格式（"前景：""中景：""画面："），会被台词解析器误判为说话人，必须写自然句
- videoPrompt 默认写到 700-950 中文字、约 800 字；长镜头例外也不少于 520 字。过短会被标记为需要重写。不要只写"某人走进房间/看向窗外"这类剧情梗概。

【好莱坞剪辑/导演节奏——每条都要有】
- 写出开场建立、推进、反应、情绪落点或悬念收束；不能所有子镜头都是同一种"人物看向/走向"。
- “开场建立”不是每镜强制大全景。前一镜已建立空间，当前镜可直接从事件人物、动作触发点或反应进入；任何建立镜头都应尽快让位给剧情信息。
- 根据内容使用：建立镜头、过肩反打、插入镜头、反应镜头、动作接动作、视线引导、慢推压迫、手持不稳定、移焦揭示、遮挡转场、声音或台词触发切换。
- 如果本镜适合长镜头，仍要写出连续调度内部的节奏段落，例如"从背影跟拍到侧脸近景，焦点从手中物件移到眼神，人物停顿后再越过前景遮挡"。

【物理反馈——情绪必须落到材质碰撞】
- 禁止写抽象形容词（"他很痛苦""她很悲伤"）
- 关键情绪动作优先用三层法：核心动作 → 已存在接触材质的变化 → 周边环境被动响应。没有发生接触时不要硬造破裂、碎片或新道具
- 关键情绪时刻按已有剧情写足反馈，过场镜头写一层核心动作即可
- 空间层次不能只写主体：前景遮挡+中景主体+背景环境至少写两层

【人物表演——表演层次 + 行为目的】
- ${PERFORMANCE_BRIEF}

【跨镜衔接——模型能理解的技法】
- 动作延续：用"已经+结果状态"作为新镜起点（如"十指已经插进雪里"而非重新"把手伸进雪里"）
- 光影突变：用起始亮度状态过渡（如"从过曝的白光中恢复——场景渐渐显现"）
- 视线匹配/图形匹配：模型不理解，这些是剪辑语言，不写进 prompt

【VO 行 vs 画面内声音】
- VO 行仅用于真实存在的旁白/画外内心独白；没有旁白时必须整行省略，绝对不要写"本句没有VO""本镜没有旁白""无画外音""无需VO"等占位说明
- 当 dialogue/description 明确写了"旁白"、"画外音"、"内心独白"、"解说"、"旁白念"时，必须写 VO 行，不要因为禁止占位而漏写真实旁白
- 有配音资产/音色资产不等于一定要写 VO；画面内人物说话、唱词、喊话、问答仍写进对应子镜头描述行或台词括号中
- 画面内人物当场说/唱 → 写进对应子镜头描述行，不另起 VO 行
- 台词格式：角色名说："台词内容"，情绪不写修饰词（如"冷声说"），必须用画面动作表达

imagePrompt 为中文（gpt-image-2），建议 80-220 中文字，必须写成可生成的首帧画面：@图片N 参考、空间锚点、主体站位、景别构图、表演瞬间、光线色温、材质细节和统一画风。如有色卡，只在最后一句写一次"画面配色严格参考 @图片N（色卡），用于统一整体色彩"，不要每个短句重复。`,
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              shotNo: { type: 'string' },
              imagePrompt: { type: 'string' },
              videoPrompt: { type: 'string' },
              audioPrompts: {
                type: 'array',
                description: '按 characterId 增量合并；连续调用不会清空其他角色。',
                items: {
                  type: 'object',
                  properties: {
                    characterId: { type: 'string' },
                    prompt: { type: 'string' },
                  },
                  required: ['characterId', 'prompt'],
                },
              },
              replaceAudioPrompts: {
                type: 'boolean',
                description: '仅在明确需要整组替换或清空配音提示词时设为 true，默认 false。',
              },
              expectedRefSignature: {
                type: 'string',
                description: '从 workshop_get_shot_refs 或 workshop_get_state 读取的 referenceSignature。参考顺序变化后旧签名会被拒绝。',
              },
            },
            required: ['shotNo'],
          },
        },
      },
      required: ['items'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    let rawItems = params.items as unknown;
    if (typeof rawItems === 'string') {
      try { rawItems = JSON.parse(rawItems) as unknown; } catch { /* keep invalid */ }
    }
    if (!Array.isArray(rawItems)) {
      return { success: false, output: '', error: 'workshop_set_prompts 参数错误：items 必须是数组。请用 { items: [{ shotNo, imagePrompt, videoPrompt }] } 调用。' };
    }
    const items = rawItems
      .map((raw) => {
        const it = raw as Record<string, unknown>;
        const shotNo = String(it.shotNo ?? it.shot_no ?? it.shot ?? it.id ?? '').trim();
        const rawAudio = it.audioPrompts ?? it.audio_prompts;
        return {
          shotNo,
          imagePrompt: typeof it.imagePrompt === 'string' ? it.imagePrompt : typeof it.image_prompt === 'string' ? it.image_prompt : undefined,
          videoPrompt: typeof it.videoPrompt === 'string' ? it.videoPrompt : typeof it.video_prompt === 'string' ? it.video_prompt : undefined,
          audioPrompts: Array.isArray(rawAudio) ? (rawAudio as { characterId: string; prompt: string }[]) : undefined,
          replaceAudioPrompts: it.replaceAudioPrompts === true || it.replace_audio_prompts === true,
          expectedRefSignature: typeof it.expectedRefSignature === 'string'
            ? it.expectedRefSignature
            : typeof it.expected_ref_signature === 'string'
              ? it.expected_ref_signature
              : undefined,
        };
      })
      .filter((it) => it.shotNo && (it.imagePrompt !== undefined || it.videoPrompt !== undefined || it.audioPrompts !== undefined));

    const warnings: string[] = [];
    const fatalErrors: string[] = [];
    const ws = useWorkshopStore.getState();
    const knownShotNos = new Set(ws.data!.shots.map((x) => x.shotNo));
    const warningByShot = new Set<string>();
    for (const it of items) {
      if (!knownShotNos.has(it.shotNo)) {
        warnings.push(`${it.shotNo}: 未找到对应分镜，已跳过`);
        continue;
      }
      const shot = ws.data!.shots.find((x) => x.shotNo === it.shotNo);
      if (!shot) continue;
      const currentRefSignature = shotReferenceSignature(shot, ws.data!);
      if (it.expectedRefSignature && it.expectedRefSignature !== currentRefSignature) {
        fatalErrors.push(`${it.shotNo}: 参考资产已在读取后发生变化。请重新调用 workshop_get_shot_refs，并按当前签名 ${currentRefSignature} 的编号重写`);
        continue;
      }

      const normalizedImageForCheck = it.imagePrompt !== undefined ? normalizePromptRefs(it.shotNo, it.imagePrompt, 'image') : undefined;
      const normalizedVideoForCheck = it.videoPrompt !== undefined ? normalizePromptRefs(it.shotNo, it.videoPrompt, 'video') : undefined;
      const unsupportedDialogue = findUnsupportedPromptDialogue({
        videoPrompt: normalizedVideoForCheck,
        audioPrompts: it.audioPrompts,
        canonicalDialogue: shot.dialogue,
      });
      if (unsupportedDialogue.length > 0) {
        fatalErrors.push(`${it.shotNo}: 出现原分镜对白中不存在的台词 ${unsupportedDialogue.map((line) => `“${line}”`).join('、')}`);
      }
      const unsupportedRelationships = findUnsupportedRelationshipClaims({
        prompts: [
          normalizedImageForCheck,
          normalizedVideoForCheck,
          ...(it.audioPrompts ?? []).map((item) => item.prompt),
        ],
        canonicalFacts: [shot.sourceExcerpt, shot.description, shot.dialogue].filter(Boolean).join('\n'),
      });
      if (unsupportedRelationships.length > 0) {
        fatalErrors.push(`${it.shotNo}: 新增了剧本事实中不存在的人物关系：${unsupportedRelationships.join('、')}。电影级光影、运镜、材质和微表演可以丰富，但人物关系不能补写`);
      }
      const directorWarnings = collectDirectorPromptWarnings(it.shotNo, normalizedImageForCheck, normalizedVideoForCheck);
      if (directorWarnings.length > 0) {
        warnings.push(...directorWarnings);
        warningByShot.add(it.shotNo);
      }
      const characterWarnings = collectUnlinkedCharacterWarnings(
        it.shotNo,
        shot,
        ws.data!,
        [normalizedImageForCheck, normalizedVideoForCheck],
      );
      if (characterWarnings.length > 0) {
        fatalErrors.push(...characterWarnings);
      }
      if (normalizedVideoForCheck) {
        const narrativeAudit = auditVideoPromptNarrative(shot, normalizedVideoForCheck, ws.data!.characters);
        if (narrativeAudit.errors.length > 0) fatalErrors.push(...narrativeAudit.errors);
        if (narrativeAudit.warnings.length > 0) {
          warnings.push(...narrativeAudit.warnings);
          warningByShot.add(it.shotNo);
        }
      }
      const emptyAudioSlots = (it.audioPrompts ?? []).filter((item) => typeof item?.prompt === 'string' && !item.prompt.trim()).length;
      if (emptyAudioSlots > 0) {
        warnings.push(`${it.shotNo}: ${emptyAudioSlots} 条配音提示词内容为空（空配音槽），已剔除不写入；需要占位时请先写具体配音文案`);
      }
      for (const audioPrompt of it.audioPrompts ?? []) {
        if (!ws.data!.characters.some((character) => character.id === audioPrompt.characterId)) {
          warnings.push(`${it.shotNo}: 配音提示词引用了不存在的角色 ID “${audioPrompt.characterId}”，数据会保留并显示，但生成配音前需要改成有效角色 ID。`);
        }
      }
      if (!normalizedVideoForCheck) continue;

      const { refs: requiredRefs, sceneRefCount, sceneRefIndices } = buildShotRequiredRefs(shot, ws.data!);
      const validation = validateSeedancePrompt(normalizedVideoForCheck, {
        refCount: requiredRefs.length,
        requiredRefs,
        requireSceneRef: sceneRefCount > 0,
        sceneRefIndices,
      });
      if (!validation.ok || validation.warnings.length > 0) {
        warnings.push(`${it.shotNo}: Seedance 提示词检查\n${formatSeedanceValidation(validation)}`);
        warningByShot.add(it.shotNo);
      }
      const promptTemplate = shot.videoPromptTemplate || ws.data!.videoPromptTemplate || 'legacy';
      const subShotCount = promptTemplate === 'universal'
        ? (normalizedVideoForCheck.match(/\d+(?:\.\d+)?\s*(?:-|–|—|~|至)\s*\d+(?:\.\d+)?\s*(?:秒|s)/gi) || []).length
        : (normalizedVideoForCheck.match(/镜头\S+-\d+/g) || []).length;
      const longTake = isDeclaredLongTake(normalizedVideoForCheck);
      if (!longTake && subShotCount < 3) {
        warnings.push(`${it.shotNo}: videoPrompt 只有 ${subShotCount} 个子镜头；非长镜头的 8-15 秒分镜默认应包含 3-5 个子镜头，并写出剪辑切换、机位/焦点变化和表演节奏`);
        warningByShot.add(it.shotNo);
      }
      if (longTake && subShotCount > 1) {
        warnings.push(`${it.shotNo}: videoPrompt 声明了长镜头/一镜到底，但又写了 ${subShotCount} 个子镜头；请二选一：要么多镜头剪辑，要么写成单个连续调度镜头`);
        warningByShot.add(it.shotNo);
      }

      // Asset readiness: check referenced assets have images
      if (shot.sceneId) {
        const scene = ws.data!.scenes.find((s) => s.id === shot.sceneId);
        const sceneRefs = getSceneReferencePaths(shot, ws.data!.scenes);
        if (scene && sceneRefs.length === 0) {
          warnings.push(`${it.shotNo}: 场景"${scene.name}"还没有可用参考图，生成视频时场景 @图片 引用将缺失`);
          warningByShot.add(it.shotNo);
        }
      }
      for (const cid of (shot.characterIds ?? [])) {
        const char = ws.data!.characters.find((c) => c.id === cid);
        if (char && !char.assetImagePath) {
          warnings.push(`${it.shotNo}: 角色"${char.name}"还没有资产图，生成视频时参考图将缺失`);
          warningByShot.add(it.shotNo);
        }
      }
    }

    if (fatalErrors.length > 0) {
      return {
        success: false,
        output: '',
        error: [
          '事实锁拒绝写入：电影级导演表达可以丰富，但不得补写剧本中没有的对白、人物或人物关系。',
          ...fatalErrors.slice(0, 20),
          '如果用户明确要求改剧本，请先更新分镜事实；否则删除新增事实后重试。',
        ].join('\n'),
      };
    }

    let n = 0;
    let skipped = 0;
    for (const it of items) {
      const s = useWorkshopStore.getState();
      if (!s.data!.shots.some((x) => x.shotNo === it.shotNo)) {
        skipped++;
        continue;
      }
      const patch: Partial<WsShot> = {};
      if (it.imagePrompt !== undefined) patch.imagePrompt = normalizePromptRefs(it.shotNo, it.imagePrompt, 'image');
      if (it.videoPrompt !== undefined) {
        const currentShot = s.data!.shots.find((shot) => shot.shotNo === it.shotNo)!;
        const template = currentShot.videoPromptTemplate || s.data!.videoPromptTemplate || 'legacy';
        const normalized = normalizePromptRefs(it.shotNo, it.videoPrompt, 'video');
        if (template === 'universal') patch.universalVideoPrompt = normalized;
        else patch.videoPrompt = normalized;
      }
      if (it.audioPrompts !== undefined) {
        const currentShot = s.data!.shots.find((shot) => shot.shotNo === it.shotNo)!;
        patch.audioPrompts = it.replaceAudioPrompts
          ? mergeAudioPrompts([], it.audioPrompts)
          : mergeAudioPrompts(currentShot.audioPrompts, it.audioPrompts);
      }
      if (it.imagePrompt !== undefined || it.videoPrompt !== undefined) {
        // 写入即刷新：软警告仍回报给调用方，但"建议重写"标记不再留在镜头上
        patch.promptNeedsRefresh = false;
      }
      if (Object.keys(patch).length > 0) {
        s.updateShot(it.shotNo, patch);
        n++;
      }
    }
    const s = useWorkshopStore.getState();
    s.markStepStatus('prompts', 'in-progress');
    s.logChange('prompts', `写入提示词 ${n} 条${warnings.length ? `，检查警告 ${warnings.length} 条` : ''}`);
    await s.commitNow();
    if (n === 0) {
      return { success: false, output: '', error: `没有可写入的提示词。${skipped ? `跳过 ${skipped} 条未知分镜。` : '请确认 items 内含 shotNo 和 imagePrompt/videoPrompt。'}` };
    }
    return {
      success: true,
      output: [
        `已写入 ${n}/${items.length} 条提示词${skipped ? `，跳过 ${skipped} 条` : ''}`,
        warnings.length ? `\n检查警告（已写入，不阻塞执行；对应分镜已标记“建议重写提示词”。不要把 prompts 标记为 done，请立刻二次调用 workshop_set_prompts 重写这些分镜）：\n${warnings.slice(0, 20).join('\n')}${warnings.length > 20 ? `\n…还有 ${warnings.length - 20} 条` : ''}` : '',
      ].join(''),
    };
  },
};

// Legacy compatibility only. Kept callable by migration tests, but intentionally
// omitted from allWorkshopTools so new Agent runs cannot recreate storyboard flows.


const setDirectorConstraintCardTool: Tool = {
  definition: {
    name: 'workshop_set_director_constraint_card',
    description: '为某一镜设置、替换或删除可选的导演约束卡。它属于镜头详情中的“空间与调度”，用于锁定人物站位、视线、机位和动作关系；默认不进入生成，需再显式开启视频引用。',
    parameters: {
      type: 'object',
      properties: {
        shot_no: { type: 'string', description: '分镜编号' },
        image_path: { type: 'string', description: '导演约束卡本地图片路径。remove=true 时可省略。' },
        prompt: { type: 'string', description: '可选，卡片的空间/动作约束说明。' },
        source: { type: 'string', enum: ['generate', 'upload', 'artifact', 'canvas', 'external'], description: '来源，默认 external。' },
        remove: { type: 'boolean', description: '删除约束卡并关闭视频引用。旧故事板历史数据不会被删除。' },
      },
      required: ['shot_no'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const ws = useWorkshopStore.getState();
    const shotNo = String(params.shot_no ?? '').trim();
    const shot = ws.data!.shots.find((item) => item.shotNo === shotNo);
    if (!shot) return { success: false, output: '', error: `分镜 ${shotNo} 不存在` };
    const remove = params.remove === true;
    const imagePath = String(params.image_path ?? '').trim();
    if (!remove && !imagePath) return { success: false, output: '', error: 'image_path 不能为空' };

    const nextFrames = remove
      ? (shot.storyboardFrames ?? []).map((frame) => ({
          ...frame,
          useDirectorConstraintCard: false,
          prompt: stripDirectorConstraintMention(frame.prompt),
          refImagePaths: frame.refImagePaths?.filter((path) => path !== shot.directorConstraintCard?.imagePath),
          revision: (frame.revision ?? 0) + 1,
        }))
      : shot.storyboardFrames;
    const nextCard = remove
      ? undefined
      : {
          id: shot.directorConstraintCard?.id ?? `director-card-${shotNo}-${Date.now()}`,
          imagePath,
          prompt: String(params.prompt ?? '').trim() || shot.directorConstraintCard?.prompt,
          createdAt: shot.directorConstraintCard?.createdAt ?? Date.now(),
          source: (params.source as 'generate' | 'upload' | 'artifact' | 'canvas' | 'external' | undefined) ?? 'external',
          useInVideo: shot.directorConstraintCard?.useInVideo ?? false,
          candidates: [
            ...(shot.directorConstraintCard?.candidates ?? []),
            {
              path: imagePath,
              source: ((params.source === 'artifact' || params.source === 'canvas' || params.source === 'generate' || params.source === 'upload')
                ? params.source
                : 'external') as AssetCandidate['source'],
              prompt: String(params.prompt ?? '').trim() || undefined,
              createdAt: Date.now(),
            },
          ],
        };
    const nextShot = { ...shot, directorConstraintCard: nextCard, storyboardFrames: nextFrames };
    const remapped = remapShotPromptRefs(shot, nextShot, ws.data!);
    ws.updateShot(shotNo, {
      ...remapped,
      directorConstraintCard: nextCard,
      storyboardFrames: nextFrames,
      videoPrompt: applyVideoPlanningReferencePrefixes(nextShot, remapped.videoPrompt ?? shot.videoPrompt),
    });
    ws.logChange('prompts', remove ? `删除 ${shotNo} 导演约束卡` : `设置 ${shotNo} 导演约束卡`);
    await ws.commitNow();
    return { success: true, output: remove ? `已删除 ${shotNo} 的导演约束卡，并关闭视频引用` : `已设置 ${shotNo} 的导演约束卡；当前不会自动参与生成，需要时请显式开启视频引用` };
  },
};

const updateDirectorConstraintPromptTool: Tool = {
  definition: {
    name: 'workshop_update_director_constraint_prompt',
    description: '只修改某一镜现有导演约束卡的空间与调度提示词，不替换图片、不新增候选图，也不改变视频引用开关。',
    parameters: {
      type: 'object',
      properties: {
        shot_no: { type: 'string', description: '分镜编号' },
        prompt: { type: 'string', description: '完整的导演约束卡提示词。应描述素模站位、视线、机位、动线和动作关系；不得要求复刻具体人物外观。' },
      },
      required: ['shot_no', 'prompt'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const ws = useWorkshopStore.getState();
    const shotNo = String(params.shot_no ?? '').trim();
    const prompt = String(params.prompt ?? '').trim();
    const shot = ws.data!.shots.find((item) => item.shotNo === shotNo);
    if (!shot) return { success: false, output: '', error: `分镜 ${shotNo} 不存在` };
    if (!shot.directorConstraintCard?.imagePath) {
      return { success: false, output: '', error: `分镜 ${shotNo} 还没有导演约束卡` };
    }
    if (!prompt) return { success: false, output: '', error: 'prompt 不能为空' };

    ws.updateShot(shotNo, {
      directorConstraintCard: {
        ...shot.directorConstraintCard,
        prompt,
      },
    });
    ws.logChange('prompts', `修改 ${shotNo} 导演约束卡提示词`);
    await ws.commitNow();
    return { success: true, output: `已更新 ${shotNo} 的导演约束卡提示词；图片和应用范围保持不变` };
  },
};

const setDirectorConstraintUsageTool: Tool = {
  definition: {
    name: 'workshop_set_director_constraint_usage',
    description: '显式控制导演约束卡是否进入本镜视频生成。开启后会按当前稳定引用顺序写入 @导演约束卡 及对应 @图片N；旧故事板历史素材不受影响。',
    parameters: {
      type: 'object',
      properties: {
        shot_no: { type: 'string', description: '分镜编号' },
        use_in_video: { type: 'boolean', description: '是否把导演约束卡作为本镜视频生成的显式参考。' },
      },
      required: ['shot_no', 'use_in_video'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const ws = useWorkshopStore.getState();
    const shotNo = String(params.shot_no ?? '').trim();
    const shot = ws.data!.shots.find((item) => item.shotNo === shotNo);
    if (!shot) return { success: false, output: '', error: `分镜 ${shotNo} 不存在` };
    if (!shot.directorConstraintCard?.imagePath) return { success: false, output: '', error: `分镜 ${shotNo} 还没有导演约束卡` };

    const useInVideo = params.use_in_video === true;
    const directorConstraintCard = { ...shot.directorConstraintCard, useInVideo };
    const nextShot = { ...shot, directorConstraintCard };
    const remapped = remapShotPromptRefs(shot, nextShot, ws.data!);
    ws.updateShot(shotNo, {
      ...remapped,
      directorConstraintCard,
      videoPrompt: applyVideoPlanningReferencePrefixes(nextShot, remapped.videoPrompt ?? shot.videoPrompt),
    });
    ws.logChange('prompts', `${useInVideo ? '启用' : '关闭'} ${shotNo} 导演约束卡视频引用`);
    await ws.commitNow();
    return {
      success: true,
      output: `已更新 ${shotNo}：视频${useInVideo ? '已启用' : '未启用'}导演约束卡`,
    };
  },
};

const setAssetPromptTool: Tool = {
  definition: {
    name: 'workshop_set_asset_prompt',
    description: '设置角色/场景/道具/色卡资产图的生图提示词。GPT（prompt）和 MJ（mjPrompt）应同时写入两条提示词，用户切引擎即用对应的版本。角色GPT=中文三视图组合图格式（左侧正脸大图+右侧三视图并排），角色MJ=英文 character design sheet 短语式。场景=无人物概念图。色卡=16:9 扁平数字色卡参考设计图。统一画风关键词。',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['character', 'scene', 'prop', 'colorPalette'] },
        id: { type: 'string' },
        prompt: { type: 'string', description: 'GPT 中文提示词（角色必须用三视图组合图格式）' },
        mjPrompt: { type: 'string', description: 'Midjourney 专用英文提示词（逗号短语式，不含 --ar 等后缀）' },
      },
      required: ['kind', 'id', 'prompt'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const ws = useWorkshopStore.getState();
    if (params.prompt) {
      ws.setAssetPrompt(params.kind as WorkshopAssetKind, params.id as string, params.prompt as string, 'gpt');
    }
    if (params.mjPrompt) {
      ws.setAssetPrompt(params.kind as WorkshopAssetKind, params.id as string, params.mjPrompt as string, 'mj');
    }
    await useWorkshopStore.getState().commitNow();
    return { success: true, output: `${params.kind} ${params.id} 提示词已设置${params.mjPrompt ? '（含 MJ 英文版）' : ''}` };
  },
};

const generateTool: Tool = {
  definition: {
    name: 'workshop_generate',
    description: '触发工坊生成（花钱操作）。kind=asset 生成角色/场景资产图；kind=image/video 生成分镜图/分镜视频。targets="missing" 只补缺失项；targets="all" 全量生成；targets="01-01,01-02,01-03" 逗号分隔多镜号一次提交（并行生成，最多 6 个同时跑）。force=true 时忽略已有图强制重新生成。allow_missing_refs=true 时允许 Seedance 提示词缺少 @图片 引用仍继续生成，默认 false。Seedance 视频默认通过筷子丽帧（Kuaizi）API 通道生成，后端自动路由，无需额外处理。⚠ 音色/音频资产只来自本镜 voiceCharacterIds 或已注入 generatedAudios，不会因为角色库有 voicePath 自动传入；需要移除时用 workshop_clear_shot_audio。⚠ 生成视频前必须确保每条分镜都已设置 videoRatio（通过 workshop_update_shot 设置），未设置比例的分镜会生成失败。⚠ 当要生成多个分镜视频时（≥2 个），先用 ask_user_question 问用户："检测到 N 个分镜待生成视频，是否并行一起生成（更快，最多 6 个同时跑）？"选项：并行生成（推荐）/ 逐个确认。用户选并行后，把所有镜号合并成一次调用（targets="01-01,01-02,..."）一次性提交，不要逐个调用。⚠ 生成是后台异步任务，工具返回后请直接告知用户"已排队，可在任务面板查看进度"然后停止——不要用 workshop_get_state 轮询进度，不要等待完成。用户看到结果后会主动来找你。',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['asset', 'image', 'video'] },
        targets: {
          type: 'string',
          description: '"all" | "missing"，或逗号分隔的镜号列表如 "01-01,01-02"（kind=image/video 时）',
        },
        asset_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'kind=asset 时要生成的角色/场景 id；省略=全部缺图资产',
        },
        force: { type: 'boolean', description: '强制重新生成，即使已有图/视频也重新生成' },
        allow_missing_refs: { type: 'boolean', description: '视频提示词缺少 @图片 引用时仍继续生成。默认 false；只有用户明确要求继续时使用。' },
      },
      required: ['kind'],
    },
  },
  risk: 'ask',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const s = useWorkshopStore.getState();
    const kind = params.kind as 'asset' | 'image' | 'video';
    const force = !!params.force;
    const generateOptions = { skipPromptValidation: !!params.allow_missing_refs };

    if (kind === 'asset') {
      const data = s.data!;
      const wanted = params.asset_ids as string[] | undefined;
      const targets: { kind: WorkshopAssetKind; id: string }[] = [];
      for (const c of data.characters) {
        if ((wanted ? wanted.includes(c.id) : (force || !c.assetImagePath))) targets.push({ kind: 'character', id: c.id });
      }
      for (const sc of data.scenes) {
        if ((wanted ? wanted.includes(sc.id) : (force || !sc.assetImagePath))) targets.push({ kind: 'scene', id: sc.id });
      }
      for (const p of (data.props ?? [])) {
        if ((wanted ? wanted.includes(p.id) : (force || !p.assetImagePath))) targets.push({ kind: 'prop', id: p.id });
      }
      const selectedPaletteIds = new Set([
        data.globalColorPaletteId,
        ...data.shots.map((shot) => shot.colorPaletteId),
      ].filter(Boolean) as string[]);
      for (const cp of (data.colorPalettes ?? [])) {
        if (wanted ? wanted.includes(cp.id) : (selectedPaletteIds.has(cp.id) && (force || !cp.assetImagePath))) {
          targets.push({ kind: 'colorPalette', id: cp.id });
        }
      }
      if (targets.length === 0) return { success: true, output: '没有需要生成的资产（都已有图）' };
      const { prepareWorkspaceAssetGeneration } = await import('../../workspace/assetGeneration');
      if (useWorkshopStore.getState().data !== data) return { success: false, output: '', error: '项目已更新，请刷新资产后再生成' };
      const errors = targets.flatMap((target) => {
        const prepared = prepareWorkspaceAssetGeneration(data, target.kind, target.id);
        return 'error' in prepared ? [`${target.kind} ${target.id}：${prepared.error}`] : [];
      });
      if (errors.length) return { success: false, output: '', error: `资产草稿未准备好，未提交本批生成：\n${errors.join('\n')}` };
      s.markStepStatus('assets', 'in-progress');
      void Promise.allSettled(targets.map((t) => s.generateAsset(t.kind, t.id)));
      return { success: true, output: `已准备 ${targets.length} 个资产生成草稿，按项目偏好进入确认队列；确认后提交，结果进入候选版本，不自动采用。请告知用户后结束本轮对话，不要轮询等待。` };
    }

    // 已在队列/生成中的分镜跳过（不重复触发），但允许向进行中的批次追加新分镜并行生成。
    // 并发上限由 canvasTaskStore 的 MAX_CONCURRENT_CANVAS_TASKS（6）控制，超出自动排队。
    const activeShotNos = new Set(s.data!.shots
      .filter((x) => x.genStatus === 'queued' || x.genStatus === 'generating')
      .map((x) => x.shotNo));

    const targetsRaw = (params.targets as string | undefined) ?? 'missing';
    if (targetsRaw !== 'all' && targetsRaw !== 'missing') {
      const nos = targetsRaw.split(',').map((x) => x.trim()).filter(Boolean)
        .filter((no) => !activeShotNos.has(no));
      if (nos.length === 0) return { success: true, output: '指定的分镜都已在生成中，已跳过。' };
      void Promise.allSettled(nos.map((no) => s.generateShot(no, kind, generateOptions)));
      return { success: true, output: `已排队 ${nos.length} 个分镜${kind === 'image' ? '图' : '视频'}生成任务（并行执行）。进度在分镜网格实时可见，请告知用户后结束本轮对话，不要轮询等待。${kind === 'video' ? '如果视频已在产物库但分镜未更新，使用 workshop_set_shot_media(shot_no, video_path) 手动关联。' : ''}` };
    }
    const onlyMissing = !force && targetsRaw !== 'all';
    const pendingShots = s.data!.shots.filter((x) => (onlyMissing ? (kind === 'image' ? !x.imagePath : !x.videoPath) : true) && !activeShotNos.has(x.shotNo));
    if (pendingShots.length === 0) return { success: true, output: '没有需要新生成的分镜（都已有产物或在生成中）。' };
    const count = pendingShots.length;
    s.markStepStatus('generate', 'in-progress');
    // generateAll 内部用 Promise.allSettled 并行；但它会重新计算 pending，这里直接对 pending 镜号并行触发更稳。
    void Promise.allSettled(pendingShots.map((x) => s.generateShot(x.shotNo, kind, generateOptions)));
    return { success: true, output: `已排队 ${count} 个分镜${kind === 'image' ? '图' : '视频'}生成任务（并行执行）。进度在分镜网格实时可见，请告知用户后结束本轮对话，不要轮询等待。${kind === 'video' ? '如果视频已在产物库但分镜未更新，使用 workshop_set_shot_media(shot_no, video_path) 手动关联。' : ''}` };
  },
};

const renderExportTool: Tool = {
  definition: {
    name: 'workshop_render_export',
    description: '把指定步骤渲染成统一格式的 markdown 文档并写入项目 export/ 目录，返回文件绝对路径与标题。随后请用 bash 调用 lark-cli（lark-doc skill 流程）把该 markdown 导入飞书云文档，拿到 URL 后调用 workshop_mark_exported 回填。',
    parameters: {
      type: 'object',
      properties: {
        step: { type: 'string', enum: STEP_IDS },
      },
      required: ['step'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const { project, data } = useWorkshopStore.getState();
    const step = params.step as WorkshopStepId;
    const md = renderStepExport(project!, data!, step);
    const rel = `export/step-${step}-${Date.now()}.md`;
    await writeProjectFile(project!.id, rel, md);
    const home = await homeDir();
    const abs = `${home}.kunpeng/aigc-memory/projects/${project!.id}/${rel}`;
    const title = md.split('\n')[0].replace(/^#\s*/, '');
    return {
      success: true,
      output: JSON.stringify({ path: abs, title, hint: '请用 lark-cli 将此 markdown 导入飞书云文档（lark-doc skill），完成后调用 workshop_mark_exported 回填 URL' }),
    };
  },
};

const markExportedTool: Tool = {
  definition: {
    name: 'workshop_mark_exported',
    description: '飞书云文档创建成功后，把 URL 回填到对应步骤。',
    parameters: {
      type: 'object',
      properties: {
        step: { type: 'string', enum: STEP_IDS },
        doc_url: { type: 'string' },
      },
      required: ['step', 'doc_url'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const s = useWorkshopStore.getState();
    s.setStepLarkDoc(params.step as WorkshopStepId, params.doc_url as string);
    s.logChange(params.step as WorkshopStepId, `导出飞书文档 ${params.doc_url}`);
    return { success: true, output: '已回填飞书文档链接' };
  },
};

const setAssetImageTool: Tool = {
  definition: {
    name: 'workshop_set_asset_image',
    description: '直接设置角色/场景/道具资产图路径（跳过生成流程）。当 AI 已通过其他方式获得图片（如 canvas_generate、降级链、用户上传等）时使用。',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['character', 'scene', 'prop', 'colorPalette'] },
        id: { type: 'string', description: '角色/场景/道具/色卡 ID' },
        image_path: { type: 'string', description: '图片本地绝对路径' },
      },
      required: ['kind', 'id', 'image_path'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    useWorkshopStore.getState().setAssetImage(
      params.kind as 'character' | 'scene' | 'prop',
      params.id as string,
      params.image_path as string,
    );
    await useWorkshopStore.getState().commitNow();
    return { success: true, output: `${params.kind} ${params.id} 资产图已设置` };
  },
};

const setShotMediaTool: Tool = {
  definition: {
    name: 'workshop_set_shot_media',
    description: '直接设置分镜的图片/视频路径（跳过生成流程）。典型场景：(1) 产物库/画布中已有视频/图片需关联到分镜；(2) 生成流程异常恢复。传入绝对路径，自动设 genStatus=done。',
    parameters: {
      type: 'object',
      properties: {
        shot_no: { type: 'string' },
        image_path: { type: 'string', description: '分镜图片路径（可选）' },
        video_path: { type: 'string', description: '分镜视频路径（可选）' },
      },
      required: ['shot_no'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const s = useWorkshopStore.getState();
    const shotNo = params.shot_no as string;
    if (!s.data!.shots.some((x) => x.shotNo === shotNo)) {
      return { success: false, output: '', error: `分镜 ${shotNo} 不存在` };
    }
    const patch: Partial<WsShot> = {};
    if (params.image_path) patch.imagePath = params.image_path as string;
    if (params.video_path) {
      patch.videoPath = params.video_path as string;
      const thumb = await ensureVideoThumb(patch.videoPath).catch(() => null);
      if (thumb?.path) patch.videoThumbPath = thumb.path;
    }
    patch.genStatus = 'done';
    patch.genError = undefined;
    patch.genTaskId = undefined;
    s.updateShot(shotNo, patch);
    await s.commitNow();
    return { success: true, output: `分镜 ${shotNo} 媒体路径已设置` };
  },
};

const clearShotAudioTool: Tool = {
  definition: {
    name: 'workshop_clear_shot_audio',
    description: '清空某个分镜的视频音频资产引用。用于用户说“这镜不要音色/不要配音/去掉声音资产”或生成报错提示音频过长时。它会把 voiceCharacterIds 清空，并关闭 audioInjected；默认保留已生成配音文件以便之后重新启用。',
    parameters: {
      type: 'object',
      properties: {
        shot_no: { type: 'string', description: '分镜编号' },
        clear_generated: { type: 'boolean', description: '是否同时删除 generatedAudios 引用。默认 false，仅停止传入，不删除历史文件。' },
      },
      required: ['shot_no'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const s = useWorkshopStore.getState();
    const shotNo = params.shot_no as string;
    if (!s.data!.shots.some((x) => x.shotNo === shotNo)) {
      return { success: false, output: '', error: `分镜 ${shotNo} 不存在` };
    }
    s.updateShot(shotNo, {
      voiceCharacterIds: [],
      audioInjected: false,
      ...(params.clear_generated ? { generatedAudios: [] } : {}),
    });
    await s.commitNow();
    return { success: true, output: `已清空分镜 ${shotNo} 的音色/配音传入引用` };
  },
};

const addCandidateTool: Tool = {
  definition: {
    name: 'workshop_add_candidate',
    description: '把本地文件注册为资产候选图（不花钱、不调生成接口）。典型场景：用户上传了新图片、外部工具生成了图、画布传回工坊。select=true 立即设为当前使用图。',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['character', 'scene', 'prop'] },
        id: { type: 'string', description: '角色/场景/道具 ID' },
        image_path: { type: 'string', description: '图片本地绝对路径' },
        source: { type: 'string', enum: ['upload', 'external', 'canvas', 'artifact'], description: '来源标记（默认 external）' },
        select: { type: 'boolean', description: '是否立即设为当前使用图（默认 true）' },
      },
      required: ['kind', 'id', 'image_path'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const s = useWorkshopStore.getState();
    const kind = params.kind as WorkshopAssetKind;
    const id = params.id as string;
    const source = (params.source as AssetCandidate['source']) ?? 'external';
    const select = params.select !== false;
    s.addAssetCandidate(kind, id, {
      path: params.image_path as string,
      source,
      createdAt: Date.now(),
    }, select);
    await s.commitNow();
    return { success: true, output: `${kind} ${id} 候选图已注册${select ? '并设为当前图' : ''}` };
  },
};

const removeAssetTool: Tool = {
  definition: {
    name: 'workshop_remove_asset',
    description: '删除工坊角色/场景/道具。会同步从所有分镜中移除引用，受影响分镜的提示词会被标记需刷新；删除后可在界面撤销一次。',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['character', 'scene', 'prop'] },
        id: { type: 'string' },
      },
      required: ['kind', 'id'],
    },
  },
  risk: 'ask',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const s = useWorkshopStore.getState();
    const kind = params.kind as 'character' | 'scene' | 'prop';
    if (kind === 'character') s.removeCharacter(params.id as string);
    else if (kind === 'scene') s.removeScene(params.id as string);
    else s.removeProp(params.id as string);
    await s.commitNow();
    return { success: true, output: `${kind} ${params.id} 已删除` };
  },
};

const upsertAssetsTool: Tool = {
  definition: {
    name: 'workshop_upsert_assets',
    description: '增量新增/更新角色、场景或道具（按 id 合并）。可用来修改名称、外观、性格等字段而不影响其他数据。',
    parameters: {
      type: 'object',
      properties: {
        characters: { type: 'array', items: { type: 'object' }, description: '角色数组（id 必填，其他字段按需）' },
        scenes: { type: 'array', items: { type: 'object' }, description: '场景数组（id 必填，其他字段按需）' },
        props: { type: 'array', items: { type: 'object' }, description: '道具数组（id 必填，其他字段按需）' },
      },
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const s = useWorkshopStore.getState();
    if (Array.isArray(params.characters)) s.upsertCharacters(params.characters as WsCharacter[]);
    if (Array.isArray(params.scenes)) s.upsertScenes(params.scenes as WsScene[]);
    if (Array.isArray(params.props)) s.upsertProps(params.props as WsProp[]);
    await s.commitNow();
    return { success: true, output: '资产已更新' };
  },
};

const setStepStatusTool: Tool = {
  definition: {
    name: 'workshop_set_step_status',
    description: '标记步骤状态（done=完成 / in-progress=进行中）。一键全流程时每完成一步调用一次。',
    parameters: {
      type: 'object',
      properties: {
        step: { type: 'string', enum: STEP_IDS },
        status: { type: 'string', enum: ['done', 'in-progress', 'pending'] },
      },
      required: ['step', 'status'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    useWorkshopStore.getState().markStepStatus(
      params.step as WorkshopStepId,
      params.status as 'done' | 'in-progress' | 'pending',
    );
    return { success: true, output: `步骤 ${params.step} 已标记为 ${params.status}` };
  },
};

const refreshUiTool: Tool = {
  definition: {
    name: 'workshop_refresh_ui',
    description: '强制同步当前工坊内存态和界面显示。当前台没有立刻显示 agent 刚刚添加、替换、删除的提示词资产、故事板图片、分镜媒体或候选图时调用。mode=memory 只刷新当前内存引用并保存；mode=disk 从项目文件重新读取。',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['memory', 'disk'], description: '默认 memory；如果怀疑另一个进程直接改了 workshop.json，用 disk。' },
      },
    },
  },
  risk: 'safe',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const mode = params.mode === 'disk' ? 'disk' : 'memory';
    const store = useWorkshopStore.getState();
    if (mode === 'disk') await store.reloadCurrent();
    else await store.commitNow();
    const latest = useWorkshopStore.getState();
    return {
      success: true,
      output: `工坊界面已同步：${latest.project?.name ?? latest.project?.id ?? '当前项目'}，分镜 ${latest.data?.shots.length ?? 0} 条。`,
    };
  },
};

const removeShotsTool: Tool = {
  definition: {
    name: 'workshop_remove_shots',
    description: '按 shotNo 删除指定分镜。删除前会确认每个 shotNo 存在。用于用户要求删除特定镜头的场景。',
    parameters: {
      type: 'object',
      properties: {
        shot_nos: {
          type: 'array',
          items: { type: 'string' },
          description: '要删除的分镜编号列表，如 ["06-06", "06-07"]',
        },
      },
      required: ['shot_nos'],
    },
  },
  risk: 'ask',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const s = useWorkshopStore.getState();
    const nos = params.shot_nos as string[];
    const existing = nos.filter((no) => s.data!.shots.some((x) => x.shotNo === no));
    const missing = nos.filter((no) => !existing.includes(no));
    for (const no of existing) {
      s.removeShot(no);
    }
    s.logChange('breakdown', `删除分镜 ${existing.join(', ')}`);
    await useWorkshopStore.getState().commitNow();
    const parts = [`已删除 ${existing.length} 条分镜，当前共 ${useWorkshopStore.getState().data!.shots.length} 镜`];
    if (missing.length > 0) parts.push(`以下编号不存在已跳过：${missing.join(', ')}`);
    return { success: true, output: parts.join('。') };
  },
};


const generateAudioTool: Tool = {
  definition: {
    name: 'workshop_generate_audio',
    description: '为指定分镜生成台词配音（Doubao Seed-Audio-1.0）。需先用 workshop_set_prompts 设置 audioPrompts。',
    parameters: {
      type: 'object',
      properties: {
        shot_no: { type: 'string', description: '分镜编号' },
        auto_trim: { type: 'boolean', description: '超过模型上限自动裁剪（Seedance 2.0 限 15s、2.5 限 30s）' },
        inject: { type: 'boolean', description: '生成后自动注入 videoPrompt 音频资产' },
      },
      required: ['shot_no'],
    },
  },
  risk: 'ask',
  async execute(params) {
    const check = requireOpen();
    if (!check.ok) return { success: false, output: '', error: check.error };
    const ws = useWorkshopStore.getState();
    const shot = ws.data!.shots.find((s) => s.shotNo === params.shot_no);
    if (!shot) return { success: false, output: '', error: `未找到分镜 ${params.shot_no}` };
    if (!shot.audioPrompts?.length) return { success: false, output: '', error: '该分镜没有 audioPrompts，请先用 workshop_set_prompts 写入' };
    const { useSettingsStore } = await import('@/stores/settingsStore');
    const { resolveApiKey } = await import('@/lib/credentials');
    const speechSettings = useSettingsStore.getState();
    if (!resolveApiKey(speechSettings, 'doubaoSpeech', speechSettings.doubaoSpeechApiKey).trim()) return { success: false, output: '', error: '未配置豆包语音 API Key' };
    try {
      const { generateShotAudio } = await import('@/lib/doubaoSpeech/generate');
      let results = await generateShotAudio(shot, ws.data!.characters, ws.data!.projectId);
      // 音频总时长上限按当前分镜有效模型分档：Seedance 2.0 限 15s、2.5 限 30s
      const audioLimitSec = (shot.videoModel || ws.data!.videoModel) === 'seedance-2.5' ? 30 : 15;
      const total = results.reduce((s, a) => s + a.duration, 0);
      if (total > audioLimitSec && params.auto_trim !== false) {
        const { trimAudiosToFit } = await import('@/lib/doubaoSpeech/trim');
        results = await trimAudiosToFit(results, audioLimitSec, ws.data!.projectId);
      }
      const patch: Partial<WsShot> = { generatedAudios: results };
      if (params.inject !== false) {
        const effectiveTotal = results.reduce((s, a) => s + (a.trimmedDuration ?? a.duration), 0);
        if (effectiveTotal <= audioLimitSec) patch.audioInjected = true;
      }
      ws.updateShot(shot.shotNo, patch);
      await useWorkshopStore.getState().commitNow();
      const summary = results.map((r) => `${r.characterName} ${(r.trimmedDuration ?? r.duration).toFixed(1)}s`).join(', ');
      return { success: true, output: `配音生成完成：${summary}，总计 ${results.reduce((s, a) => s + (a.trimmedDuration ?? a.duration), 0).toFixed(1)}s${patch.audioInjected ? '，已注入视频提示词' : ''}` };
    } catch (err) {
      return { success: false, output: '', error: `配音生成失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

export const allWorkshopTools: Tool[] = [
  getStateTool,
  getShotRefsTool,
  readSourceTool,
  saveScriptTool,
  saveDocumentTool,
  setBreakdownTool,
  setShotsTool,
  setBiblesTool,
  updateShotTool,
  updateShotRefsTool,
  setPromptsTool,
  setDirectorConstraintCardTool,
  updateDirectorConstraintPromptTool,
  setDirectorConstraintUsageTool,
  setAssetPromptTool,
  generateTool,
  renderExportTool,
  markExportedTool,
  setStepStatusTool,
  setAssetImageTool,
  setShotMediaTool,
  clearShotAudioTool,
  addCandidateTool,
  removeAssetTool,
  upsertAssetsTool,
  refreshUiTool,
  removeShotsTool,
  generateAudioTool,
];
