/**
 * promptTemplates — built-in slash-menu templates (LibTV "/" pattern).
 * Contents are distilled from aigc-memory/prompt-templates; the async
 * accessor keeps the door open to read from disk later without changing
 * call sites.
 */
export interface PromptTemplate {
  id: string;
  /** Menu label, e.g. "多机位九宫格" */
  label: string;
  /** Short description shown in the menu. */
  hint: string;
  /** Inserted at the slash position. {subject} marks where the cursor lands. */
  body: string;
  /** Which node kinds the template applies to. */
  kinds: ('image' | 'video')[];
}

const TEMPLATES: PromptTemplate[] = [
  {
    id: 'multi-cam-9',
    label: '多机位九宫格',
    hint: '同一场景 9 个机位/景别',
    body: '生成一张 3x3 九宫格图，同一场景的 9 个不同机位与景别：大远景、远景、全景、中全景、中景、中近景、近景、特写、大特写。场景：',
    kinds: ['image'],
  },
  {
    id: 'storyboard-25',
    label: '25 宫格连贯分镜',
    hint: '5x5 连续剧情分镜',
    body: '生成一张 5x5 二十五宫格连贯分镜图，按时间顺序展现完整剧情段落，镜头景别有节奏变化（建立镜头→中景对话→特写情绪→动作→收尾），统一画风与色调。剧情：',
    kinds: ['image'],
  },
  {
    id: 'char-3view',
    label: '角色三视图',
    hint: '正面/侧面/背面立绘',
    body: '生成角色三视图（正面、侧面、背面），全身立绘，白色背景，角色细节（服装/发型/配饰）三视图完全一致。角色描述：',
    kinds: ['image'],
  },
  {
    id: 'relight',
    label: '电影级打光',
    hint: '光影氛围重塑',
    body: '保持画面主体与构图完全不变，重新设计电影级光影：主光源方向明确，明暗对比有层次，氛围光（黄金时刻/蓝调时刻/霓虹/烛光可选）。打光要求：',
    kinds: ['image'],
  },
  {
    id: 'derive-after',
    label: '画面推演（后5秒）',
    hint: '推演 5 秒后的画面',
    body: '基于 @图片1 推演 5 秒之后的画面：保持场景、人物、光线完全一致，仅推进剧情动作。动作描述：',
    kinds: ['image'],
  },
  {
    id: 'story-derive-grid-4',
    label: '剧情推演四宫格',
    hint: '前5s/前3s/后3s/后5s 时间线拼图',
    body: '基于 @图片1 生成一张 2x2 四宫格图：左上=前5秒画面，右上=前3秒画面，左下=后3秒画面，右下=后5秒画面。场景人物光线画风完全一致，格线干净严格等分无文字。',
    kinds: ['image'],
  },
  {
    id: 'story-branch-grid-4',
    label: '剧情分支四宫格',
    hint: '4 种剧情走向分支',
    body: '基于 @图片1 推演 4 种截然不同的剧情走向，生成 2x2 四宫格：冲突升级 / 和解温情 / 意外转折 / 悬念留白。每格是独立故事线的下一个关键画面，画风一致，格线严格等分无文字。',
    kinds: ['image'],
  },
  {
    id: 'derive-before',
    label: '画面推演（前3秒）',
    hint: '推演 3 秒前的画面',
    body: '基于 @图片1 推演 3 秒之前的画面：保持场景、人物、光线完全一致，回溯剧情起点。',
    kinds: ['image'],
  },
  {
    id: 'derive-before-5',
    label: '画面推演（前5秒）',
    hint: '推演 5 秒前的画面',
    body: '基于 @图片1 推演 5 秒之前的画面：保持场景、人物、光线完全一致，回溯更早的剧情起点。',
    kinds: ['image'],
  },
  {
    id: 'derive-after-3',
    label: '画面推演（后3秒）',
    hint: '推演 3 秒后的画面',
    body: '基于 @图片1 推演 3 秒之后的画面：保持场景、人物、光线完全一致，仅推进剧情动作。动作描述：',
    kinds: ['image'],
  },
  {
    id: 'shot-establish',
    label: '建立镜头',
    hint: '大远景交代环境',
    body: '大远景建立镜头，缓慢推进（Dolly-in），交代环境全貌与空间关系，时长 8 秒。场景：',
    kinds: ['video'],
  },
  {
    id: 'shot-dialogue',
    label: '对话镜头',
    hint: '中景+台词（{}包裹）',
    body: '中景对话镜头，人物@图片1 说：{台词内容}，面部表情自然，口型与台词同步，镜头微微晃动模拟手持感。保持无字幕，不要生成Logo，不要生成水印。',
    kinds: ['video'],
  },
  {
    id: 'shot-action',
    label: '动作镜头',
    hint: '快节奏+跟拍',
    body: '动作镜头：广角跟拍，动作连贯流畅（低缓连续小动作优先），人物面部稳定不变形，无穿模无卡顿。动作描述：。保持无字幕，不要生成Logo，不要生成水印。',
    kinds: ['video'],
  },
  {
    id: 'video-style-transfer',
    label: '视频风格迁移',
    hint: '参考 @视频1 的风格/运镜复刻',
    body: '参考 @视频1 的画面风格、运镜方式和色调节奏，用 @图片1 的场景与人物复刻这段视频，场景和人物保持不变。',
    kinds: ['video'],
  },
  {
    id: 'tapnow-video-structure',
    label: '导演级分段提示词骨架',
    hint: 'TapNow 式：总述→按秒分段→美学收尾',
    body: '一镜到底，15秒，【题材】。0-3秒：【主体+动作+镜头方式】。3-7秒：【剧情推进+镜头运动】。7-12秒：【高潮动作+镜头运动】。12-15秒：【收尾+镜头缓慢推近/拉远】。【美学参考风格】，【光线描述】，【色调】，浅景深锁定主体，动作流畅连贯，一镜到底无剪辑感。保持无字幕，不要生成Logo，不要生成水印。',
    kinds: ['video'],
  },
  {
    id: 'video-constraints',
    label: '约束词收尾',
    hint: '官方防瑕疵约束串',
    body: '保持无字幕，不要生成Logo，不要生成水印，人物面部稳定不变形，动作自然流畅，无穿模无卡顿，禁止出现外形着装完全一致的人物。',
    kinds: ['video'],
  },
];

export async function getPromptTemplates(kind: 'image' | 'video'): Promise<PromptTemplate[]> {
  return TEMPLATES.filter((t) => t.kinds.includes(kind));
}
