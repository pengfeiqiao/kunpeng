/**
 * workshopPrompts — 工坊各步骤的预制 agent prompt（仿 projectPrompts.ts）。
 * 由步骤组件的按钮触发，经 WorkshopChatPanel 发给 agent。
 */
import type { WorkshopData, WorkshopStepId } from './types';
import { PERFORMANCE_BRIEF } from '../videoPrompt/performance.ts';
import { HIDDEN_DIRECTOR_REASONING } from './directorReasoning.ts';

/** 把风格关键词格式化为 prompt 附加段（兜底用，主路径走 StyleSelector.buildStyleSection） */
export function formatStyleSection(style?: WorkshopData['style']): string {
  const kw = [...(style?.keywords ?? []), style?.customText ?? ''].filter(Boolean).join('，');
  if (!kw) return '';
  return `\n## 风格关键词（所有提示词统一携带）\n${kw}`;
}

/** 第②步：剧本拆解 */
export function buildBreakdownPrompt(styleSection = ''): string {
  return `请对当前工坊项目执行剧本拆解（第②步）：

${HIDDEN_DIRECTOR_REASONING}

1. 先调用 workshop_get_state 了解项目状态，再调用 workshop_read_source 拿到剧本文件路径
2. 读取剧本内容（docx/pdf 用相应 skill 或工具；纯文本直接 read）
   - 事实优先：所有人物、事件、人物关系、场景和对白都必须能在剧本源文中找到依据
   - 选取 3-30 条能覆盖主要人物、关系和事件的原文短句，逐字放入 workshop_set_breakdown.sourceEvidence；不要润色或概括
   - 逐场建立 storyFacts：每条记录稳定 id、sceneId、逐字 sourceExcerpt、participantIds、可见 event、可见 result，以及可承接的 entryState/exitState。先把剧本事实列完整，再设计镜头
   - 司机、乘客、店员、保安、警察、医生、路人等只要参与事件，即使没有姓名也必须建立角色档案并进入 participantIds；不能把功能角色省略后只保留道路、建筑、车辆或环境
   - 如果项目已有拆解，本次只是“重新拆解/重新分析”，默认保留既有剧情事实和对白，只补漏、纠错或完善视觉描述
   - 只有用户本轮明确要求改剧本、改剧情、改对白或增删人物时，才允许创作性改写；“优化提示词”绝不等于“改剧本”
3. 深度理解剧本后，调用 workshop_set_breakdown 一次性写入：
   - sourceEvidence：3-30 条剧本原文短句，作为本次拆解的事实收据
   - storyFacts：逐场剧情事实账本。每个有动作、信息变化、人物反应或结果变化的段落至少一条，必须覆盖所有显式人物和功能角色
   - synopsis：故事梗概（200-500字，讲清主线冲突与结局走向）
   - episodes：分集分场（每集标题 + 场次概览）
   - characters：角色档案（id 用英文短名；性格、外形必须是生图可直接使用的具体描述——年龄/身材/发型/服饰/面部特征；形象随剧情变化的角色填 lifecycleStages）
   - scenes：主要场景（环境/光线/氛围的视觉描述）
4. 调用 workshop_set_bibles 写入项目四圣经：
   - director：全片镜头、光影、色彩、节奏和禁忌
   - character：角色外观、服装、音色、阶段变化的不可漂移规则
   - scene：场景空间、材质、光源方向、色温和可变边界
   - continuity：跨镜头参考图顺序、服化道、道具、光源、剪辑连续性；blockingContinuity 必须按“幕/场景”建立站位基准：稳定空间锚点、人物相对位置/朝向/距离、180度轴线、出入口，以及只有剧本事件触发时才发生的走位变化
5. 再调用 workshop_set_shots 写入分镜表（每镜：shotNo 用"集-镜"如 01-01、sourceFactIds、narrativeFunction、画面描述、对白、景别、运镜、情绪、时长 8-15 秒（Seedance 2.5 项目可到 30 秒）、关联 characterIds/sceneId，以及仅供 Agent 使用的 directorDecision）。**长剧本分批写，每批 ≤15 镜，第二批起用 mode:"merge"**
   - directorDecision 必须填写 entryState、newInformation、shotScaleReason、cutTrigger、exitState；它只用于内部校验，不要在给用户的分镜文案里显示这些字段名
   - 先逐条检查 storyFacts 是否被分镜覆盖：每个事件至少有一条 event 镜头呈现人物、触发动作和结果；反应与后果可拆为 reaction/consequence，但不能只保留空镜
   - 同一场景按“必要时短暂建立空间 → 人物承担事件 → 反应/关键细节 → 结果”推进。不要机械套远中近特写，也不要让单一信息距离承包剧情：禁止连续两条空镜、同场连续三条远景/全景、同场连续三条近景/特写；连续两条大特写必须有明确的线索递进、匹配剪辑、动作连接或先细节后揭示
   - 景别按叙事任务选择：远景/全景交代空间与规模，中景/过肩交代人物关系和完整动作，近景承载反应与表演，大特写只用于关键触点、线索或情绪峰值。多人事件至少安排一个能看清关系的中景、过肩、双人同框或等价关系镜头
   - characterIds=[] 仅限真正必要的空间建立、转场、线索、余波或结果状态，并填写 emptyShotPurpose。公路上有司机、有事故时，司机和事故必须进入人物事件镜头，不能拆成纯公路空镜
   - 同一场景的第一镜先建立世界空间站位；后续镜头默认继承，不因景别、正反打或机位变化交换人物左右/前后关系
   - 每条 description 都要写出当前站位状态。若剧情发生走位，必须写成“角色从空间锚点A移动到锚点B”的有因果变化，并把新状态传递给本场后续镜头；没有明确动作就禁止换位、镜像或瞬移
   - 特写仍要保留视线方向、身体朝向或画外对象方位，使它能和全景/中景剪接一致
6. 完成后调用 workshop_set_step_status 把 breakdown 标记为 done，并向我汇报拆解结果概况${styleSection}`;
}

/** Canonical character-sheet templates shared by workshop and internal Agent flows. */
export const WORKSHOP_CHARACTER_TEMPLATE_ZH = '角色设计三视图组合图：画面左侧为{角色}的正脸肖像大图——{面部特征/表情/神态}；画面右侧为同一角色的三视图——正面、侧面、背面全身视图并排，{服饰描述}，完整展示服装结构与体态。背景统一为{背景/纯色浅灰}。{布光色调}。超高细节，电影级角色设计图格式，画面无任何文字。';
export const WORKSHOP_CHARACTER_TEMPLATE_EN = 'character design sheet, large front face portrait on the left, full-body three-view turnaround (front, side, back) on the right, consistent identity, facial features, body proportions and clothing, plain light grey background, cinematic character sheet, high detail, no text';

/** 第③步：资产提示词 */
export function buildAssetPromptsPrompt(styleSection = ''): string {
  return `请为当前工坊项目的所有角色和场景编写资产图提示词（第③步）：

1. 先 workshop_get_state（detail:"step"）查看角色/场景档案——**注意每个资产的 assetEngine 字段，引擎决定提示词语言和格式**：
   - 若 bibles 已存在，资产提示词必须继承 director/character/scene/continuity 里的稳定规则

【GPT-Image-2】（默认引擎）→ **中文段落式**，参考结构：
   - **角色 = 三视图组合图（固定格式）**：「${WORKSHOP_CHARACTER_TEMPLATE_ZH}」
   - 角色示例：「角色设计三视图组合图：画面左侧为林风的正脸肖像大图——28岁男性，面部轮廓分明，眼神冷静。画面右侧为同一角色的三视图——正面、侧面、背面全身视图并排，瘦高身材，黑色短发，深灰色风衣，完整展示服装结构与体态。背景统一为纯色浅灰。柔和顶光，低饱和冷色调。超高细节，电影级角色设计图格式，画面无任何文字。」
   - 场景 = 无人物空景：主体描述 → 布光色调 → 约束（画面无任何文字）

【Midjourney】→ **英文逗号短语式**（subject, pose, lighting, style, quality 渐进排列），不要写 --ar 等后缀参数（比例由 API 参数传递）：
   角色模板：「${WORKSHOP_CHARACTER_TEMPLATE_EN}」

2. 风格统一：全项目同一套画风关键词；中文 prompt 拼中文关键词，英文 prompt 拼英文（导演 DNA 的 prompt_suffix 本身是英文可直接复用）
3. 为每个角色/场景调用 workshop_set_asset_prompt，**一次同时写入两个版本**：
   - prompt：GPT 中文版（角色必须用上面的三视图组合图固定格式；场景=无人物空景概念图）
   - mjPrompt：MJ 英文版（角色=逗号短语式 "character design sheet, large front face portrait on the left, full-body three-view turnaround…"；场景同样英文短语式）
   无论该资产当前选的什么引擎，两个版本都要写——用户随时切引擎即用。
4. 完成后向我确认是否立即生成（workshop_generate kind:"asset"，会消耗额度）${styleSection}`;
}

/** 第④步：分镜提示词 */
export function buildShotPromptsPrompt(styleSection = '', template: 'legacy' | 'universal' = 'legacy'): string {
  const templateRule = template === 'universal'
    ? `当前项目选择【新版】。videoPrompt 必须使用以下段落：
【素材身份】说明每张参考素材的身份和用途；
【空间与初始站位】锁定场景锚点、人物相对位置/朝向/距离和轴线；
【一句话概述】概括本镜可见事件；
【时间戳动作与机位】按时间顺序写动作、表演、运镜、焦点和声音；
【物理与一致性】约束主体、材质、空间关系及起点→路径→终点；
【视觉与声音】统一影调、声音和禁止项。
新版仍须遵守参考图编号、事实锁、分镜板和导演约束卡规则；不再强制套用经典版的“分镜场景设定在/分镜具体动作描述”标题。`
    : '当前项目选择【经典版】。videoPrompt 沿用 Seedance 多镜头模板，使用“分镜场景设定在/分镜具体动作描述/镜头N-X”结构。';
  return `请为当前工坊项目的所有分镜编写生图与视频提示词（第④步）：

${HIDDEN_DIRECTOR_REASONING}

${templateRule}

1. 先 workshop_get_state（detail:"step"）查看分镜表、角色/场景/道具/色卡资产和 bibles。色卡也是图片资产，若 referenceOrder / imageReferenceOrder / videoReferenceOrder 里出现「色卡」，必须使用它对应的 @图片N 编号，禁止写 @色卡；但色卡是全局配色参考，只能在提示词末尾统一点名一次，不要在每个画面/每个子镜头反复写色调色卡。
   - 本任务只改提示词：不得调用 workshop_update_shot/workshop_set_shots 改 description、dialogue、角色、场景或道具关系
   - 所有画面内对白、VO、旁白必须逐字来自该镜 dialogue；dialogue 没有对应内容就整段不写，禁止为了“更电影化”自行补台词
   - 写每镜前先核对 sourceFactIds 对应的 storyFacts 和 directorDecision。内部确认“接戏状态 → 唯一新增信息 → 切点 → 出镜状态”；videoPrompt 必须完整呈现事实链，且 characterIds 中每个剧情参与者都要按姓名出现
   - 环境、材质、光影、前景遮挡只服务事件。已有角色或事件时，禁止把提示词写成道路、建筑、车辆、烟尘等连续纯空镜
2. 读取 aigc-memory/prompt-templates/seedance/README.md 和 aigc-memory/prompt-templates/seedance/multi-shot.md。Seedance 规范以该目录为唯一准则。
3. 如果发现某镜需要新增/删除/替换参考图（例如换角色图、删除 @图片七、把某个已有角色加入本镜），必须先调用 workshop_update_shot_refs 修改真实资产引用；不要只在提示词里删字或保留空 @图片 编号。
4. 调用 workshop_set_prompts 批量写入（每批 ≤15 条）：

   - imagePrompt（中文，gpt-image-2 生分镜图）：本镜首帧画面。
     **必须用 @图片N 引用场景和角色参考图**（编号规则同 videoPrompt：以 workshop_get_state 返回的 referenceOrder 为准；默认只有最终场景资产占用 @图片一；仅用户明确启用多角度参考时，多张场景图才会连续占用 @图片一/@图片二/@图片三…，角色/道具从后续编号开始）。
     必须继承 bibles 中的导演、角色、场景、连续性规则。
     强调「复刻参考图中的人物形象，保持人脸、服饰、体态高度一致」。
     如启用色卡，只在 imagePrompt 最后追加一句「画面配色严格参考 @图片N（色卡），用于统一整体色彩。」；色卡占用真实 @图片N 编号，必须按 imageReferenceOrder 写。正文不要在每个动作短句反复写「画面配色严格参考」或「色调参考色卡」。
     必须写成导演可执行的首帧画面：先保证事件人物与触发动作可见，再写空间锚点 + 主体站位 + 景别构图 + 表演瞬间 + 光线色温 + 材质细节 + 画风约束。不要只写剧情梗概，也不要用空景替代有人的剧情。
     示例：「@图片一 深夜便利店内冷白灯光场景，@图片二 林风站在货架前，复刻参考图中人物形象保持人脸一致。中景，柔和冷色调顶光，电影感构图」

   - videoPrompt：按上方当前版本规则书写。经典版严格遵守 aigc-memory/prompt-templates/seedance/README.md 和 multi-shot.md；新版使用六段式结构，但继续遵守其中的多镜头调度、引用、声音和安全规范。每条 8-15 秒分镜（Seedance 2.5 项目可到 30 秒）默认包含 3-5 个子镜头，并按好莱坞导演/剪辑师可执行标准写到 700-950 中文字、约 800 字。只有剧情本身适合长镜头/一镜到底时，才允许减少切点；此时必须明确写“长镜头/一镜到底”，并写清连续调度、演员走位、焦点转移和节奏段落。
     必须继承 bibles 中的导演、角色、场景、连续性规则。子镜头先覆盖 sourceFactIds 对应的事件主体、动作、反应与结果，再补电影级表达；两个以上子镜头不得全部使用远景/全景，也不得全部使用近景/特写。连续大特写必须有线索或剪辑递进，多人物事件必须出现关系镜头。前一镜已建立空间时，本镜可以直接进入人物或事件，不要每镜都用大全景重新开场。
     写每一镜前先调用 workshop_get_shot_refs，严格使用返回的 videoReferenceBindings / imageReferenceBindings，并在 workshop_set_prompts 中回传 expectedRefSignature。如果本镜有高清故事板/分镜板，它们永远排在最前面，@图片一、@图片二…先对应所有启用的分镜板；分镜板不是场景图，必须作为“分镜板/导演分镜参考”处理。此时 videoPrompt 开头第一句话必须写：以分镜板 @图片一 @图片二 … 作为本镜景别变化和画面参考；所有分镜板都要在第一句话中 @ 到。若 videoReferenceOrder 中还有“导演约束卡”，它紧随全部分镜板之后，必须在开头继续明确写「以 @导演约束卡（对应 @图片N）锁定本镜人物站位、视线、机位和动作关系」，并读取 directorConstraintCard.prompt，把其中有效的站位、视线、机位、动线和动作关系落实进各子镜头；只继承调度约束，不复制灰模材质或僵硬姿势。没有分镜板但启用了导演约束卡时，导演约束卡直接是 @图片一；即使本镜没有其它参考图，也允许只传导演约束卡完成视频生成。之后再写场景、角色、道具。只有分镜板和导演约束卡都未启用时，场景参考才排在最前面；默认只引用最终场景资产，如果本镜或场景明确选择了多角度参考，必须全部写入 prompt，并分别引用 @图片一/@图片二/@图片三…；角色/道具按 characterIds+propIds 顺序继续编号。不得出现文件名引用或 @人一/@物一。色卡如果出现在 referenceOrder，只在 videoPrompt 最后一句统一写「全片画面配色严格参考 @图片N（色卡），用于统一色彩风格。」；禁止把这句话写进每个子镜头。

【两层写作契约】
- 剧情事实层锁定：人物、人物关系、对白、关键动作目标、剧情结果只能来自 sourceExcerpt、description、dialogue 和已关联资产。没有写出的事实不得补。
- 导演表达层开放：机位、运镜、焦点、光影、材质、空间层次、微表演和剪辑节奏继续按电影级标准充分展开。
- 不要为了凑够材质、微表情、运镜和剪辑项目，新增人物、亲属/恋爱/师徒关系、对白、旁白或原分镜没有的剧情事件。

【导演级写作标准：每条 videoPrompt 都必须达到】
- 按导演给 DP、演员、剪辑师下达可拍摄指令的标准写，不要把 description 简单改写成长句。
- 每条分镜先重建空间：地点、光源方向/色温、人物站位/距离/朝向，不能写“承接上一镜”。同场景必须继承 bibles.continuity.blockingContinuity：世界坐标和人物关系不因正反打、景别变化或摄影机换边而改变；特写也要保留视线/朝向连续性。只有 description/sourceExcerpt 明确发生走位时才更新站位，并写清起点、路径、终点和更新后的关系。
- 非长镜头默认 3-5 个子镜头：建立/推进/反应/情绪落点/悬念收束至少覆盖其中三类，不能所有子镜头都是同一种“人物看向/走向”。
- 整条提示词必须完整覆盖景别/运镜、机位或焦点、人物动作与微表演、环境或既有道具反馈；各子镜头按剧情需要分配，不要求每个子镜头机械凑齐全部栏目。
- 每条都要写出剪辑节奏：切换点为什么发生，使用建立镜头、过肩反打、插入镜头、反应镜头、动作接动作、视线引导、慢推压迫、手持不稳定、移焦揭示、遮挡转场等适合本镜的技巧。
- 情绪必须通过表演外化：眼神停顿、下颌收紧、手指发白、肩背塌下、呼吸变浅、嘴角克制等；禁止只写“悲伤/愤怒/紧张”。
- ${PERFORMANCE_BRIEF}
- 关键动作优先写三层反馈：动作本身 → 已存在接触材质变化 → 环境响应；没有接触或道具时不要硬造破裂、碎片和新物件。
- 对话镜头要有表演节奏：说话前停顿、听到后的反应、视线回避/逼视、手部小动作；台词写在对应镜头行的 {} 内。
- 每条 videoPrompt 默认 700-950 中文字、约 800 字；长镜头例外也要不少于 520 字。imagePrompt 建议 80-220 中文字。过短说明没有达到导演级细节。
- 如果 workshop_set_prompts 返回检查警告，必须立刻按警告二次重写对应分镜；没有警告后再调用 workshop_set_step_status 把 prompts 标记为 done。

5. 完成且无质量警告后调用 workshop_set_step_status 把 prompts 标记为 done，向我汇报${styleSection}`;
}

/** 单条分镜 AI 优化 */
export function buildOptimizeShotPrompt(shotNo: string): string {
  return `请优化工坊分镜 ${shotNo} 的提示词：先 workshop_get_state（detail:"step", section:"prompts", shot_no:"${shotNo}"）查看该镜事实，再调用 workshop_get_shot_refs 读取当前引用顺序和 referenceSignature。若用户要求换参考图、删除已引用参考图、加入角色/道具引用，必须先用 workshop_update_shot_refs 更新真实资产引用，再重新读取签名；不要只改提示词文字。
${HIDDEN_DIRECTOR_REASONING}
事实锁：本任务只优化提示词，不得修改 description、dialogue 或剧本人物关系。人物、人物关系、对白、关键动作目标和剧情结果只能来自 sourceExcerpt/description/dialogue；所有台词、VO、旁白必须逐字来自该镜 dialogue，没有就不写。电影级细节继续保留并加强：可以丰富机位、运镜、焦点、光影、材质、空间层次、呼吸、视线、手部细节和剪辑节奏，但不能为了凑项目新增人物关系、对白或剧情事件。只有用户明确说要改剧本/对白时，才先修改分镜事实再重写提示词。
imagePrompt：必须继承 bibles，用 @图片N 引用场景和角色参考图；编号严格按 workshop_get_state 的 imageReferenceOrder，默认只使用最终场景资产，只有 imageReferenceOrder 中确实出现多张场景图时才全部写入；强调复刻参考图人物形象保持人脸一致，含景别/构图/光线/画风关键词；如启用色卡，只在最后一句写「画面配色严格参考 @图片N（色卡），用于统一整体色彩」，禁止写 @色卡，也禁止在多个短句反复写色卡/色调。
videoPrompt：先读取项目和本镜 videoPromptTemplate。经典版按 aigc-memory/prompt-templates/seedance/README.md 的既有多镜头结构；新版使用【素材身份】【空间与初始站位】【一句话概述】【时间戳动作与机位】【物理与一致性】【视觉与声音】六段式结构。参考图编号严格按 videoReferenceOrder。若本镜有高清分镜板，第一句话必须把所有分镜板 @图片一/@图片二… 全部写出，并明确它们是“本镜景别变化和画面参考”，不要当场景图处理，也不要写成必须完全按每格逐镜切分。若 videoReferenceOrder 出现导演约束卡，必须在开头以“@导演约束卡（对应 @图片N）”明确引用，并读取 directorConstraintCard.prompt，把站位、视线、机位、动线和动作关系落实进正文；不能只把图片放进请求却不在提示词中使用。若有色卡，只在全文最后一句统一点名一次，例如「全片画面配色严格参考 @图片N（色卡），用于统一色彩风格。」不要在每个子镜头重复写。VO 只在真实存在旁白/画外内心独白/解说时才写；当 dialogue/description 明确写了旁白、画外音、内心独白、解说时必须写 VO 行。没有旁白就整行省略，禁止写“本句没有VO/本镜没有旁白/无画外音”等占位说明。有配音/音色资产不等于一定要写 VO，画面内人物说话/唱词仍写进镜头描述行；台词/音效/音乐符号按模板执行。默认写成 700-950 字、约 800 字的导演分镜；非长镜头含 3-5 个子镜头，必须写出建立/推进/反应/情绪落点/悬念收束的节奏变化。只有明确适合长镜头/一镜到底时才减少切点，并写清连续调度、走位、移焦和节奏段落。
必须补足导演级表演调度：空间锚点、人物站位、景别/机位/焦点设计、剪辑切换点、微表情/呼吸/手部细节、已有材质反馈、环境响应；不要扩写剧情。${PERFORMANCE_BRIEF}
站位连续性：先读取 bibles.continuity.blockingContinuity 和本镜 description。提示词必须明确固定人物相对场景锚点、彼此方位、朝向和视线；正反打只改变摄影机观察方向，不得把世界空间关系镜像。若本镜发生走位，必须写明从何处经何路径到何处，并把结果作为结尾状态。
调用 workshop_set_prompts 时必须传 expectedRefSignature。保持与前后镜头的画风、光线、角色形象连贯。完成后简述改了什么。`;
}

/** 单条分镜 AI 写配音提示词 */
export function buildAudioPromptsPrompt(shotNo: string): string {
  return `请为工坊分镜 ${shotNo} 编写台词配音提示词（audioPrompts）：

1. 先 workshop_get_state（detail:"step"）查看该分镜数据：对白(dialogue)、角色列表(characterIds)、画面描述(description)、情绪(mood)、videoPrompt
2. 根据对白内容，为每个出场角色拆分各自的配音提示词

配音提示词写作规则（Doubao Seed-Audio-1.0）：
- 每个角色一条 audioPrompt，写成可直接交给语音合成模型的完整指令
- 只有本镜 voiceCharacterIds 已显式启用该角色音色时，才在开头写「用@音频N的音色」（N 按本镜已启用音色资产排序）；不要因为角色库有 voicePath 就自动使用
- 如果角色没有音色：开头用自然语言描述声线特征（如「用沙哑中年男声」「用清脆少女声线」），根据角色 personality/appearance 推断
- 台词内容用引号包裹
- 可加表演指令控制语气节奏，如：（压低音量，唏嘘口吻）、（语速放慢）、（前留0.3秒停顿）、（哽咽）、（怒吼）
- 根据分镜 mood 和上下文情绪自动添加合适的表演指令
- 如果对白中该角色没有台词但出场了，可以写呼吸声、叹息等非语言声音，或跳过该角色
- 总配音时长需控制在模型上限内（Seedance 2.0 限 15 秒、2.5 限 30 秒），每条台词建议 2-8 秒

3. 调用 workshop_set_prompts 写入该分镜的 audioPrompts：
   items: [{ shotNo: "${shotNo}", audioPrompts: [{ characterId: "xxx", prompt: "..." }, ...] }]

4. 完成后简述写了什么`;
}

/** 批量 AI 写配音提示词 */
export function buildBatchAudioPromptsPrompt(): string {
  return `请为工坊所有有对白的分镜编写台词配音提示词（audioPrompts）：

1. 先 workshop_get_state（detail:"step"）查看全部分镜数据
2. 筛选有 dialogue（对白）且有 characterIds 的分镜
3. 为每条分镜的每个出场角色编写配音提示词

配音提示词写作规则（Doubao Seed-Audio-1.0）：
- 每个角色一条 audioPrompt，写成可直接交给语音合成模型的完整指令
- 只有本镜 voiceCharacterIds 已显式启用该角色音色时，才在开头写「用@音频N的音色」（N 按本镜已启用音色资产排序）；不要因为角色库有 voicePath 就自动使用
- 如果角色没有音色：用自然语言描述声线特征（根据角色 personality/appearance 推断）
- 台词内容用引号包裹
- 根据分镜 mood 和上下文自动添加表演指令：（压低音量）、（语速放慢）、（哽咽）、（怒吼）等
- 如果对白中该角色没有台词但出场了，可写呼吸声/叹息，或跳过
- 总配音时长需控制在模型上限内（Seedance 2.0 限 15 秒、2.5 限 30 秒）

4. 调用 workshop_set_prompts 批量写入（每批 ≤15 条）：
   items: [{ shotNo: "1", audioPrompts: [...] }, { shotNo: "2", audioPrompts: [...] }, ...]

5. 完成后汇报写了几条分镜的配音提示词`;
}

/** AI 分析角色特征，生成音色描述 */
export function buildVoiceDescPrompt(characterId: string): string {
  return `请为工坊角色（id: ${characterId}）生成一段音色描述，用于 Doubao Seed-Audio-1.0 语音合成：

1. 先 workshop_get_state（detail:"step"）查看该角色的 personality（性格）、appearance（外貌）、name（名字）
2. 根据角色特征推断最匹配的声线描述，考虑：
   - 性别、年龄段 → 基础音域（如：低沉中年男声、清脆少女声、沙哑老者声）
   - 性格特点 → 说话风格（如：慵懒、干练、温柔、冷峻、活泼）
   - 外貌暗示 → 气质声线（如：魁梧→浑厚有力、瘦弱→细而轻柔）
   - 如果有 lifecycleStages（生命周期），以当前阶段为准
3. 输出一段 10-20 字的音色描述，直接可用于语音合成提示词。不要解释，只输出描述本身。
   格式示例：「沙哑低沉的中年男声，带一点疲惫感」「清脆明亮的少女声线，语速偏快」

请直接回复音色描述文字，不需要调用任何工具。`;
}

/** 导出飞书 */
export function buildExportPrompt(step: WorkshopStepId): string {
  return `请把工坊当前的「${step}」步骤导出为飞书云文档：

1. 调用 workshop_render_export（step:"${step}"）拿到渲染好的 markdown 文件路径
2. 用 bash 执行 \`npx lark-cli auth status\` 检查登录态；未登录则把授权指引告诉我后停止
3. 按 lark-doc skill 的流程把该 markdown 导入为新的飞书云文档（文档标题用工具返回的 title）
4. 拿到文档 URL 后调用 workshop_mark_exported 回填，并把链接发给我`;
}

/** 一键全流程 */
export function buildAutoRunPrompt(): string {
  return `请对当前工坊项目执行一键全流程（从拆解到生成）。按顺序完成，每步完成后调用 workshop_set_step_status 标记 done 再进入下一步：

${HIDDEN_DIRECTOR_REASONING}

第②步 拆解：${'\n'}- workshop_read_source 读剧本 → workshop_set_breakdown 写梗概/分集/角色/场景、sourceEvidence 和 storyFacts → workshop_set_shots 写分镜表（分批 ≤15 镜）
- 所有人物、关系、对白、事件和结果以原剧本事实为准。功能角色也必须保留；只有用户明确修改剧本时，才以用户修改后的文本为新事实
- 每镜内部填写 directorDecision（entryState、newInformation、shotScaleReason、cutTrigger、exitState），只用于 Agent 校验，不向用户展示字段名
- 每镜只承担一个主要新增信息，景别由观众需要看清的内容决定；同场景承接人物站位、视线、手中物和动作进度，不机械套远中近特写

第③步 资产：
- 为每个角色/场景 workshop_set_asset_prompt 编写提示词（统一画风）
- workshop_generate（kind:"asset"）生成资产图，等待我确认

第④步 提示词：
- workshop_set_prompts 为全部分镜写 imagePrompt（中文，必须按 imageReferenceOrder 用 @图片N 引用场景和角色参考图；默认只使用最终场景资产，只有 imageReferenceOrder 中确实出现多张场景图时才全部写入；强调复刻参考图人物形象保持人脸一致，写成导演可执行首帧画面）+ videoPrompt（遵守 aigc-memory/prompt-templates/seedance/README.md 和 multi-shot.md；严格使用 videoReferenceOrder；如果本镜有高清分镜板，第一句话必须全部 @ 并明确作为本镜景别变化和画面参考；如果出现导演约束卡，必须按其真实 @图片N 明确引用并把 directorConstraintCard.prompt 的空间调度落实进子镜头；默认每镜 3-5 个子镜头、700-950 字约 800 字，必须有好莱坞导演/剪辑师级的景别变化、机位/焦点设计、表演节奏、剪辑切换、光线、材质反馈、环境响应；只有明确适合长镜头/一镜到底时才减少切点；${PERFORMANCE_BRIEF}；MJ 资产卡的提示词用英文短语式）
- 写提示词时以 sourceFactIds 对应事实和 directorDecision 为边界。允许充分扩展导演表达，但不得新增剧本没有的人物、关系、对白、旁白、动作目标或剧情结果

第⑤步 生成：
- workshop_generate（kind:"image", targets:"missing"）生成分镜图，再 workshop_generate（kind:"video", targets:"missing"）生成视频，等待我确认

注意：生成步骤是花钱操作会弹确认；任何一步出错先向我汇报再继续。现在开始第②步。`;
}
