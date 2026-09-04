export type PipelineStageId = 'script' | 'storyboard' | 'image' | 'video' | 'edit' | 'voice';

export interface PipelineStageCard {
  id: PipelineStageId;
  title: string;
  keywords: RegExp[];
  entryTools: string[];
  prerequisites: string[];
  handoff: string;
  fallback: string;
}

export interface PipelineRunState {
  completedTools?: string[];
  unfinishedTodos?: string[];
}

export const PIPELINE_STAGES: PipelineStageCard[] = [
  {
    id: 'script', title: '剧本',
    keywords: [/剧本|口播稿|文案/, /写.{0,8}(短片|故事|广告片|广告文案|广告剧本)/],
    entryTools: ['skill_invoke', 'write_file'],
    prerequisites: ['确认题材、时长、受众与不得改写的事实'],
    handoff: '保存完整剧本路径，并交接时长、场次、人物和对白清单。',
    fallback: '信息不足时只询问真正阻塞的一项；已有文本时先保留原意再修改。',
  },
  {
    id: 'storyboard', title: '分镜',
    keywords: [/分镜|故事板|镜头表|镜头拆解/, /拆.{0,6}(剧本|脚本|镜头)/],
    entryTools: ['workshop_get_state', 'storyboard_list_targets'],
    prerequisites: ['读取剧本或画面描述，核对人物、场景、事件和连续性'],
    handoff: '按稳定 shotId/frameId 交接镜号、画面、景别、机位、动作和引用资产。',
    fallback: '无法进入工坊时先产出结构化分镜文档，不猜造剧情或人物关系。',
  },
  {
    id: 'image', title: '生图',
    keywords: [/生图|生成.{0,4}(图片|海报|画面)|出图|画一张/, /分镜图|角色图|场景图|概念图/],
    entryTools: ['image_generate'],
    prerequisites: ['确认画幅、模型、参考素材及主体保护要求'],
    handoff: '交接本地产物路径、模型、尺寸、参考素材和对应镜号。',
    fallback: '失败先按错误类型换路由或修正输入；同参数付费请求不得重复提交。',
  },
  {
    id: 'video', title: '生视频',
    keywords: [/生视频|生成.{0,4}视频|图生视频|文生视频|视频生成/, /omni|seedance|minimax|海螺/i],
    entryTools: ['video_generate', 'task_status'],
    prerequisites: ['确认时长、画幅、引擎和图片/视频参考是否属于本次任务'],
    handoff: '交接任务 ID、落地视频路径、实际时长、模型和参考素材。',
    fallback: '异步结果先查 task_status；提交状态不明时禁止原参数重提。',
  },
  {
    id: 'edit', title: '剪辑',
    keywords: [/剪辑|成片|时间线|配乐|转场|导出视频/, /把.{0,8}(片段|视频).{0,8}(拼|剪|合成)/],
    entryTools: ['timeline_get_state', 'timeline_add_clip', 'timeline_export_video'],
    prerequisites: ['确认时间线已水合，并核对素材路径、时长和目标画幅'],
    handoff: '交接工程状态、时间线结构、导出设置和成片路径。',
    fallback: '工具未显示时先查看能力并切换剪辑视图；禁止凭空重建已有时间线。',
  },
  {
    id: 'voice', title: '配音',
    keywords: [/配音|旁白|朗读|台词音频|生成.{0,4}音频/, /豆包.{0,4}(声音|语音)|seed.?audio/i],
    entryTools: ['doubao_speech_generate'],
    prerequisites: ['核对台词、角色、语气，以及本轮明确提供的参考音频'],
    handoff: '交接音频路径、角色、台词、时长和参考音频来源。',
    fallback: '缺少付费通道要求的参考音频时明确说明，不编造素材或 URL。',
  },
];

const PIPELINE_OVERVIEW = '全链路顺序：剧本 → 分镜 → 生图 → 生视频 → 剪辑 → 配音。只执行当前必要阶段；跨阶段任务先用 todo_write 建立可验证计划，并持续交接真实产物路径。';

const EXPLICIT_STAGE_INTENTS: Array<[PipelineStageId, RegExp]> = [
  ['script', /(?:写|改|润色|创作).{0,24}(?:剧本|口播稿|文案)/],
  ['storyboard', /(?:把|将)?.{0,12}(?:剧本|脚本).{0,8}(?:拆|转|改).{0,8}(?:分镜|故事板)|(?:拆|生成|制作).{0,12}(?:分镜|故事板)/],
  ['video', /(?:生成|制作|做|出).{0,16}(?:视频|动态片段)|(?:图生|文生)视频/],
  ['image', /(?:生成|制作|做|出|画).{0,8}(?:图片|画面|海报|分镜图|角色图|场景图|概念图)/],
  ['voice', /(?:生成|制作|做).{0,8}(?:配音|旁白|语音|台词音频)/],
  ['edit', /(?:剪|拼|合成|导出).{0,8}(?:片段|视频|成片)|(?:进入|放到|加入).{0,8}时间线/],
];

export function detectPipelineStage(message: string, state: PipelineRunState = {}): PipelineStageCard | null {
  const text = message.trim();
  if (!text || text.length < 2) return null;
  const completed = new Set(state.completedTools ?? []);
  const explicitIds = new Set(
    EXPLICIT_STAGE_INTENTS
      .filter(([, pattern]) => pattern.test(text))
      .map(([id]) => id),
  );
  if (explicitIds.size > 0) {
    const explicitStage = PIPELINE_STAGES.find((stage) => (
      explicitIds.has(stage.id)
      && !stage.entryTools.every((tool) => completed.has(tool))
    ));
    if (explicitStage) return explicitStage;
  }
  const matches = PIPELINE_STAGES.filter((stage) => stage.keywords.some((pattern) => pattern.test(text)));
  if (matches.length === 0) return null;
  const unfinished = matches.filter((stage) => !stage.entryTools.every((tool) => completed.has(tool)));
  return unfinished[0] ?? null;
}

export function buildPipelineStagePrefix(message: string, state: PipelineRunState = {}): string | null {
  const stage = detectPipelineStage(message, state);
  if (!stage) return null;
  return [
    '[普通对话阶段卡，仅用于本轮执行，不要复述给用户]',
    PIPELINE_OVERVIEW,
    `当前阶段：${stage.title}`,
    `入口工具：${stage.entryTools.join('、')}`,
    `前置检查：${stage.prerequisites.join('；')}`,
    `产物交接：${stage.handoff}`,
    `失败兜底：${stage.fallback}`,
    state.unfinishedTodos?.length ? `已有未完成事项：${state.unfinishedTodos.join('；')}` : '',
  ].filter(Boolean).join('\n');
}

export function resolveTodoAwareMaxTurns(configured: number | undefined, hasUnfinishedTodo: boolean): number {
  const base = Math.max(1, configured ?? 30);
  return hasUnfinishedTodo ? Math.max(base, 60) : base;
}
