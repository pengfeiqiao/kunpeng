/**
 * workshop — 创作工坊数据模型（小云雀/火山剧创式 6 步流水线）。
 *
 * 持久化在 ~/.kunpeng/aigc-memory/projects/<id>/workshop.json，
 * 复用 lib/aigc/projectStore 的目录与原子写。
 */

export type WorkshopStepId = 'script' | 'breakdown' | 'assets' | 'prompts' | 'generate' | 'handoff';

/** stale = 上游步骤在本步完成后被修改过，提示需要重做 */
export type StepStatus = 'pending' | 'in-progress' | 'done' | 'stale';

export const WORKSHOP_STEPS: { id: WorkshopStepId; label: string; hint: string }[] = [
  { id: 'script', label: '剧本', hint: '上传剧本/文档' },
  { id: 'breakdown', label: '拆解', hint: '梗概·分集分场·角色档案' },
  { id: 'assets', label: '资产', hint: '角色图·场景图（一致性锚定）' },
  { id: 'prompts', label: '提示词', hint: '分镜表 + 生图/视频提示词' },
  { id: 'generate', label: '生成', hint: '逐镜生成 · 可并行 · 可重做' },
  { id: 'handoff', label: '交付', hint: '导入画布 / 剪辑' },
];

/** 资产候选图：生成/上传/产物库/画布回流都 append，永不删除 */
export interface AssetCandidate {
  path: string;
  source: 'generate' | 'upload' | 'artifact' | 'canvas' | 'external' | 'default';
  engineId?: string;
  prompt?: string;
  /** 场景迭代标签，如 wide/medium/close/detail，便于多景别资产管理 */
  role?: string;
  /** 跨画布回传的幂等键；同一操作重试时不重复追加版本。 */
  clientToken?: string;
  originNodeId?: string;
  revision?: number;
  createdAt: number;
}

export type WorkshopAssetKind = 'character' | 'scene' | 'prop' | 'colorPalette';

export interface PaletteColor {
  hex: string;
  label: string;
}

export interface WsCharacter {
  id: string;
  name: string;
  personality: string;
  appearance: string;
  /** 全生命周期形象变化（年龄/服饰/面部特征按阶段） */
  lifecycleStages?: { stage: string; appearance: string }[];
  /** 当前选定的最终图（从 candidates 中选） */
  assetImagePath?: string;
  /** GPT 中文提示词（角色必须是三视图组合图格式）；MJ 英文提示词见 assetPromptMj */
  assetPrompt?: string;
  /** MJ 专用英文提示词（字符画短语式，不含 --ar 等后缀） */
  assetPromptMj?: string;
  candidates?: AssetCandidate[];
  /** 生图引擎偏好：GPT、Seedream 或 Midjourney V8.2/V8.1。 */
  assetEngine?: string;
  /** 生图分辨率偏好：GPT=1k/2k/4k，Seedream=1k/2k */
  assetResolution?: string;
  /** 生图比例偏好 */
  assetAspectRatio?: string;
  /** 角色音色样本文件路径（上传/画布导入的 .mp3/.wav） */
  voicePath?: string;
  /** 音色来源 */
  voiceSource?: 'upload' | 'canvas' | 'tts';
  /** 音色引擎 id（如 minimax-speech） */
  voiceEngineId?: string;
}

export interface WsScene {
  id: string;
  name: string;
  description: string;
  assetImagePath?: string;
  /** 多角度场景参考组：仅用户明确选择时启用；默认只使用 assetImagePath 这张最终场景资产 */
  selectedImagePaths?: string[];
  sceneReferenceMode?: 'multi';
  /** GPT 中文提示词；MJ 英文提示词见 assetPromptMj */
  assetPrompt?: string;
  assetPromptMj?: string;
  candidates?: AssetCandidate[];
  assetEngine?: string;
  assetResolution?: string;
  assetAspectRatio?: string;
}

export interface WsProp {
  id: string;
  name: string;
  description: string;
  assetImagePath?: string;
  assetPrompt?: string;
  assetPromptMj?: string;
  candidates?: AssetCandidate[];
  assetEngine?: string;
  assetResolution?: string;
  assetAspectRatio?: string;
}

export interface WsColorPalette {
  id: string;
  name: string;
  description?: string;
  /** 当前选定的色卡参考图 */
  assetImagePath?: string;
  /** 用于生成「色卡参考图」本身的提示词 */
  assetPrompt?: string;
  /** 用于后续分镜/视频生成时附加的色彩约束提示词 */
  usagePrompt?: string;
  candidates?: AssetCandidate[];
  assetEngine?: string;
  assetResolution?: string;
  assetAspectRatio?: string;
  colors?: PaletteColor[];
  source?: 'default' | 'upload' | 'canvas' | 'generate' | 'custom';
  createdAt: number;
}

/** 拆解阶段从剧本逐场提取的可追溯剧情事实，供分镜和提示词做覆盖校验。 */
export interface WorkshopStoryFact {
  id: string;
  sceneId?: string;
  /** 剧本逐字原文，不得润色。 */
  sourceExcerpt: string;
  /** 参与事件的角色 ID，包含司机/乘客/店员等功能角色。 */
  participantIds: string[];
  /** 原文中实际发生的可见事件。 */
  event: string;
  /** 事件结束时已成立的状态；无明确结果时写“未交代”。 */
  result: string;
  /** 事件开始前已成立的状态，供内部接戏检查；旧项目可为空。 */
  entryState?: string;
  /** 事件结束后必须延续的状态，供内部接戏检查；旧项目可为空。 */
  exitState?: string;
}

export type ShotGenStatus = 'idle' | 'queued' | 'generating' | 'done' | 'failed';

/** 镜头在剧情推进中的职责；用于防止分镜退化为连续空镜或重复景别。 */
export type ShotNarrativeFunction =
  | 'establish'
  | 'event'
  | 'reaction'
  | 'detail'
  | 'consequence'
  | 'transition';

/** Agent 内部使用的镜头决策记录，不作为额外表单展示给用户。 */
export interface ShotDirectorDecision {
  /** 本镜开始时必须承接的空间、人物、道具和动作状态。 */
  entryState: string;
  /** 相比上一镜，本镜让观众新知道或新感受到的唯一主要信息。 */
  newInformation: string;
  /** 为什么此刻需要这个观察距离，而不是机械套景别。 */
  shotScaleReason: string;
  /** 由动作、视线、声音、揭示或情绪变化触发的剪切理由。 */
  cutTrigger: string;
  /** 本镜结束时留给下一镜继承的状态。 */
  exitState: string;
  /** 声音在本镜承担的作用；无特殊作用可省略。 */
  soundRole?: string;
}

export interface GeneratedAudio {
  characterId: string;
  characterName: string;
  path: string;
  duration: number;
  trimmedPath?: string;
  trimmedDuration?: number;
}

export interface StoryboardFrame {
  id: string;
  prompt: string;
  /** 该 prompt 写入时 @图片一/二/三... 对应的真实图片路径快照，用于参考图重排后稳定重编号 */
  refImagePaths?: string[];
  /** 是否在本格生成时追加导演约束卡。默认 false，避免旧项目和普通分镜被隐式改变。 */
  useDirectorConstraintCard?: boolean;
  /** 历史生成候选图。imagePath 是当前选定的最终图。 */
  candidates?: AssetCandidate[];
  imagePath?: string;
  selected?: boolean;
  status?: ShotGenStatus;
  error?: string;
  /** 每次提示词或候选版本写回递增，用于 Agent 冲突检测。 */
  revision?: number;
}

export interface StoryboardBoard {
  id: string;
  frameIds: string[];
  imagePath: string;
  createdAt: number;
  /** false 时仅保存为资产，不参与视频生成参考图传入 */
  useInVideo?: boolean;
  sourceCanvasNodeIds?: string[];
  layout?: string;
  fit?: 'contain' | 'cover';
  clientToken?: string;
}

/** 单镜导演约束卡：空间走位、机位和动作关系的可选参考资产。 */
export interface DirectorConstraintCard {
  id: string;
  imagePath: string;
  /** 生成或人工补充的约束说明，供 Agent 和提示词编排读取。 */
  prompt?: string;
  createdAt: number;
  source?: 'generate' | 'upload' | 'artifact' | 'canvas' | 'external';
  /** true 时作为视频生成参考图传入；默认 false。 */
  useInVideo?: boolean;
  /** 替换/重生成历史，当前 imagePath 仍是唯一生效版本。 */
  candidates?: AssetCandidate[];
}

export interface WsShot {
  /** 不随镜号、排序或标题修改而变化的内部身份；旧项目打开时自动补齐。 */
  id?: string;
  shotNo: string;
  episode?: string;
  sceneId?: string;
  /** 画面描述 */
  description: string;
  /** 该镜对应的剧本原文证据。用于事实锁，禁止提示词凭空补剧情。 */
  sourceExcerpt?: string;
  /** 本镜覆盖的剧情事实 ID；允许多镜共同覆盖一个事实。 */
  sourceFactIds?: string[];
  /** 对白 */
  dialogue?: string;
  /** 景别 */
  shotType?: string;
  /** 运镜 */
  camera?: string;
  /** 情绪 */
  mood?: string;
  /** 本镜承担的叙事职责，而不是视觉风格标签。 */
  narrativeFunction?: ShotNarrativeFunction;
  /** 无人物镜头必须说明其不可替代的叙事用途；旧项目可为空。 */
  emptyShotPurpose?: string;
  /** 隐藏的导演决策记录，由 Agent 用于信息推进和接戏校验。 */
  directorDecision?: ShotDirectorDecision;
  durationSec?: number;
  characterIds: string[];
  propIds?: string[];
  /** 单镜场景参考图覆盖；undefined=跟随场景参考组，[]=本镜不传场景参考 */
  sceneImagePaths?: string[];
  /** 场景参考图发生人工调整后，提示用户重新生成提示词以同步 @图片 顺序 */
  promptNeedsRefresh?: boolean;
  /** 最近一次确认的参考资产顺序版本。旧项目为空时按 0 处理。 */
  referenceRevision?: number;
  /** 额外参考图（手动添加的上传/产物库图，独立于场景/角色/道具资产） */
  extraRefImages?: string[];
  /** 导演台导出的白模动态预演，仅作为视频运动参考，不占 @图片N 编号。 */
  directorPrevisVideoPaths?: string[];
  /** 视频生成比例（如 "16:9"），生成视频时必填 */
  videoRatio?: string;
  /** 单镜视频模型覆盖；undefined = 跟随全局 */
  videoModel?: string;
  /** 单镜视频提示词模板覆盖；undefined = 跟随项目全局 */
  videoPromptTemplate?: 'legacy' | 'universal';
  imagePrompt?: string;
  /** Seedance 视频提示词：遵守 aigc-memory/prompt-templates/seedance/README.md */
  videoPrompt?: string;
  /** Seedance 2.5 专用提示词。与普通视频提示词分开保存，切换模型时互不覆盖。 */
  seedance25VideoPrompt?: string;
  /** 新版提示词。保留 videoPrompt 的经典版，切换时互不覆盖。 */
  universalVideoPrompt?: string;
  /** 高清故事板：8 张独立电影分镜图提示词和生成结果 */
  storyboardFrames?: StoryboardFrame[];
  /** 高清故事板拼合资产：通常每 4 张拼成 1 张 2x2 分镜板 */
  storyboardBoards?: StoryboardBoard[];
  /** 可选导演约束卡，不参与普通生图；由单格或视频开关显式启用。 */
  directorConstraintCard?: DirectorConstraintCard;
  /** 单镜色卡覆盖；为空时使用全局色卡 */
  colorPaletteId?: string;
  /** 本镜显式启用的角色音色资产。只有这里列出的角色 voicePath 才会作为视频音频参考传入。 */
  voiceCharacterIds?: string[];
  imagePath?: string;
  videoPath?: string;
  /** 视频封面缩略图。它只用于生成页/列表展示，不作为视频参考资产传入。 */
  videoThumbPath?: string;
  genStatus?: ShotGenStatus;
  genError?: string;
  /** 进行中任务 ID（取消用） */
  genTaskId?: string;
  /** 同步到画布后对应的视频节点 ID */
  canvasNodeId?: string;
  /** 每个角色的台词配音提示词 */
  audioPrompts?: { characterId: string; prompt: string }[];
  /** 生成的配音文件 */
  generatedAudios?: GeneratedAudio[];
  /** 配音是否已注入到 videoPrompt 的资产中 */
  audioInjected?: boolean;
}

export interface WorkshopStepState {
  status: StepStatus;
  updatedAt: number;
  larkDocUrl?: string;
}

export interface WorkshopProjectBibles {
  /** 导演圣经：全片统一的镜头、光影、色彩、节奏和禁忌 */
  director?: {
    styleIntent: string;
    cameraRules: string[];
    lightingRules: string[];
    colorRules: string[];
    pacingRules: string[];
    forbidden: string[];
    updatedAt: number;
  };
  /** 角色圣经：角色不可漂移的外观、服装、声音、变化阶段 */
  character?: {
    rules: Array<{
      characterId: string;
      lockedAppearance: string;
      costumeRules: string[];
      voiceRules?: string;
      lifecycleRules?: string[];
    }>;
    globalRules: string[];
    updatedAt: number;
  };
  /** 场景圣经：空间、材质、光源方向、色温和可变边界 */
  scene?: {
    rules: Array<{
      sceneId: string;
      spatialLayout: string;
      lighting: string;
      palette: string;
      textureRules: string[];
    }>;
    globalRules: string[];
    updatedAt: number;
  };
  /** 连续性圣经：跨镜头必须保持一致的资产顺序、服化道、空间方向、光源和禁改项 */
  continuity?: {
    lockedItems: string[];
    /** Per act/scene world-space blocking baselines and explicit transition rules. */
    blockingContinuity?: string[];
    referenceOrderRules: string[];
    costumeContinuity: string[];
    propContinuity: string[];
    lightingContinuity: string[];
    editContinuity: string[];
    updatedAt: number;
  };
}

export interface WorkshopData {
  projectId: string;
  currentStep: WorkshopStepId;
  steps: Record<WorkshopStepId, WorkshopStepState>;
  /** 故事梗概 */
  synopsis: string;
  /** 首次拆解时从源剧本逐字摘录的事实证据，用于阻止模型凭概括另写剧情。 */
  breakdownSourceEvidence?: string[];
  /** 逐场剧情事实账本，防止后续分镜遗漏事件人物或把剧情改成空镜。 */
  storyFacts?: WorkshopStoryFact[];
  /** 分集分场 */
  episodes: { no: string; title: string; sceneList: string }[];
  characters: WsCharacter[];
  scenes: WsScene[];
  props: WsProp[];
  colorPalettes: WsColorPalette[];
  /** 一键用于所有画面的全局色卡；单镜 colorPaletteId 可覆盖 */
  globalColorPaletteId?: string;
  shots: WsShot[];
  style?: {
    keywords: string[];
    directorRef?: string;
    customText?: string;
    styleLibraryRef?: string;
    styleLibraryPrompt?: string;
    library?: 'general' | 'midjourney';
    midjourneyStyleId?: string;
    midjourneyVersion?: string;
    midjourneyStylize?: number;
    midjourneyChaos?: number;
    midjourneyRaw?: boolean;
    midjourneyStyleWeight?: number;
    midjourneyImageWeight?: number;
    midjourneyWeird?: number;
  };
  /** 项目级导演/角色/场景/连续性圣经，后续拆解、提示词和生成必须继承 */
  bibles?: WorkshopProjectBibles;
  /** 全局视频比例（各分镜可单独覆盖） */
  videoRatio?: string;
  /** 全局视频模型：'seedance-2.0' | 'seedance-2.0-mini' | 'minimax-h3'，默认 'seedance-2.0' */
  videoModel?: string;
  /** 全局生图模型：默认走 'gpt-image-2' 智能路由池；可选自定义图片插件 custom-media:{id}（issue #7） */
  imageModel?: string;
  /** 全局视频提示词模板；默认 legacy，分镜可单独覆盖。 */
  videoPromptTemplate?: 'legacy' | 'universal';
  /** 关联的画布项目（Adobe 式统一项目） */
  canvasProjectId?: string;
  /** 修改记录（飞书导出模板第三节） */
  changelog: { at: number; step: WorkshopStepId; summary: string }[];
}

export function emptyWorkshopData(projectId: string): WorkshopData {
  const now = Date.now();
  const steps = {} as Record<WorkshopStepId, WorkshopStepState>;
  for (const s of WORKSHOP_STEPS) steps[s.id] = { status: 'pending', updatedAt: now };
  return {
    projectId,
    currentStep: 'script',
    steps,
    synopsis: '',
    episodes: [],
    characters: [],
    scenes: [],
    props: [],
    colorPalettes: [],
    shots: [],
    changelog: [],
  };
}

/** 步骤顺序索引，用于 invalidateDownstream */
export const STEP_ORDER: WorkshopStepId[] = WORKSHOP_STEPS.map((s) => s.id);
