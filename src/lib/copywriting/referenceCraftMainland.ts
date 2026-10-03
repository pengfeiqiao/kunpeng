import type { CraftSource, CraftLesson } from "./referenceCraft";

/** Original analysis of inspected passages; source kinds preserve evidence boundaries. */
export const MAINLAND_CRAFT_SOURCES: readonly CraftSource[] = [
  {
    "id": "myth-of-love-essay",
    "title": "爱情神话",
    "authors": "邵艺辉",
    "textKind": "author-craft-essay",
    "edition": "文汇报刊发作者署名写作文章；不是剧本原稿，不使用来源不明的 OCR 剧本作背书",
    "textUrl": "https://wenhui.whb.cn/zhuzhan/yingshi/20220105/442687.html",
    "award": "2022 金鸡最佳编剧（奖项属于影片剧本，不属于本文）",
    "awardUrl": "https://www.cgrhfff.com/goldenroosteraward/winners-list/winners-list-2022/",
    "checkedAt": "2026-10-03",
    "collection": "mainland-film"
  },
  {
    "id": "dying-to-survive-outline",
    "title": "我不是药神",
    "authors": "钟伟口述；影片编剧韩家女、钟伟、文牧野",
    "textKind": "author-outline",
    "edition": "影视工业网编剧专访中的序列大纲及解释；不是完整剧本。网页序号缺 8，开场楔子未进入成片，不补造缺文",
    "textUrl": "https://cinehello.com/stream/114130",
    "award": "2018 金马最佳原著剧本（影片剧本获奖）",
    "awardUrl": "https://www.goldenhorse.org.tw/film/about/archive/detail/1976",
    "checkedAt": "2026-10-03",
    "collection": "mainland-film"
  },
  {
    "id": "piano-author-interview",
    "title": "钢的琴",
    "authors": "张猛；北京首场点映现场问答",
    "textKind": "author-interview",
    "edition": "影视工业网 2011-07-08 现场文字实录；提炼主创解释，不冒称读过拍摄剧本",
    "textUrl": "https://cinehello.com/stream/1920",
    "award": "2010 东京国际电影节最佳男演员：王千源（表演奖，非编剧奖）",
    "awardUrl": "https://history.tiff-jp.net/ja/prizes.html",
    "checkedAt": "2026-10-03",
    "collection": "mainland-film"
  },
  {
    "id": "balloon-author-interview",
    "title": "气球",
    "authors": "万玛才旦；北京青年报采访，中国作家网转载",
    "textKind": "author-interview",
    "edition": "2020-11-19 访谈，涉及气球结局及饭桌新闻的具体设计；非剧本原稿",
    "textUrl": "https://www.chinawriter.com.cn/n1/2020/1119/c404102-31936417.html",
    "award": "2019 海南岛国际电影节金椰奖最佳影片（非编剧奖）",
    "awardUrl": "https://ent.people.com.cn/n1/2019/1209/c1012-31495707.html",
    "checkedAt": "2026-10-03",
    "collection": "mainland-film"
  },
  {
    "id": "coffin-author-interview",
    "title": "心迷宫",
    "authors": "忻钰坤；搜狐娱乐哈麦专访",
    "textKind": "author-interview",
    "edition": "2015-10-16 专访；只分析主创对结构的说明，不当作分场剧本",
    "textUrl": "https://yule.sohu.com/20151016/n423387983.shtml",
    "award": "2014 FIRST 两项大奖；官方历史页未细列奖名，本条不细化成编剧奖",
    "awardUrl": "https://www.firstfilm.org.cn/about/history/",
    "checkedAt": "2026-10-03",
    "collection": "mainland-film"
  },
  {
    "id": "black-coal-early-draft",
    "title": "白日焰火",
    "authors": "刁亦男",
    "textKind": "screenplay-draft",
    "edition": "第三方公开转录，标注登记号 01-2010-A-020931；仅核读场 2–7、99–100。片方已说明流传稿与成片不同；镜像逐字准确性未获作者认证",
    "textUrl": "https://www.diaoshanghai.com/nd.jsp?id=995",
    "award": "2014 柏林金熊最佳影片（非编剧奖；不代表此早期稿获奖）",
    "awardUrl": "https://www.berlinale.de/media/download/preise-jurys/64_berlinale_awards.pdf",
    "checkedAt": "2026-10-03",
    "collection": "mainland-film",
    "verificationUrl": "https://www.chinanews.com/yl/2014/03-20/5972465.shtml"
  },
  {
    "id": "so-long-author-class",
    "title": "地久天长",
    "authors": "阿美；导演帮公开课整理",
    "textKind": "author-interview",
    "edition": "2019-03-29 公开课的编辑整理，含转述；非完整逐字实录、非剧本。区分初稿与最终叙事方案",
    "textUrl": "https://www.sohu.com/a/304680139_662944",
    "award": "2019 金鸡最佳编剧：阿美、王小帅",
    "awardUrl": "https://www.cgrhfff.com/goldenroosteraward/winners-list/winners-list-2019/",
    "checkedAt": "2026-10-03",
    "collection": "mainland-film"
  },
  {
    "id": "no-problem-author-interview",
    "title": "不成问题的问题",
    "authors": "梅峰；徐枫访谈；影片编剧梅峰、黄石",
    "textKind": "author-interview",
    "edition": "《当代电影》2017 年第 6 期创作谈，杂志账号发布；非剧本原稿",
    "textUrl": "https://www.sohu.com/a/146827482_662038",
    "award": "2016 金马最佳改编剧本",
    "awardUrl": "https://www.goldenhorse.org.tw/film/programme/films/detail/1409",
    "checkedAt": "2026-10-03",
    "collection": "mainland-film"
  },
  {
    "id": "wandering-earth-author-essay",
    "title": "流浪地球",
    "authors": "杨治学；《当代电影》2024 年第 2 期创作谈",
    "textKind": "author-craft-essay",
    "edition": "作者回顾系列剧本创作的文章，经第三方转载；只提炼设定集与人物关系段，不冒称已读两部完整剧本",
    "textUrl": "https://www.sohu.com/a/757035483_121124735",
    "award": "《流浪地球》2019 金鸡最佳故事片（非编剧奖；不延伸到续集）",
    "awardUrl": "https://www.cgrhfff.com/goldenroosteraward/winners-list/winners-list-2019/",
    "checkedAt": "2026-10-03",
    "collection": "mainland-film"
  }
];

export const MAINLAND_CRAFT_LESSONS: readonly CraftLesson[] = [
  {
    "id": "voice-before-dialect",
    "sourceId": "myth-of-love-essay",
    "medium": "film",
    "tags": [
      "中文",
      "方言",
      "人物声音",
      "华语",
      "对白"
    ],
    "location": "作者文章“内容部分”段",
    "observation": "作者说明先按身份、性格、习惯和当下目的写人物，再处理方言表达。",
    "useWhen": "地方性只靠堆方言词和口头禅时",
    "method": "先写清这个人想让对方做什么、怎样维护体面，再校正地方语序与词汇；以本地使用者朗读检查自然度。",
    "avoid": "拿作者自述当通用语言学定律；把不熟悉的方言写成刻板笑料。"
  },
  {
    "id": "desire-relay",
    "sourceId": "dying-to-survive-outline",
    "medium": "film",
    "tags": [
      "人物弧光",
      "动机",
      "转变",
      "现实主义",
      "尊严"
    ],
    "location": "“表面欲望和潜在欲望”及雨夜、工厂段",
    "observation": "作者解释赚钱愿望满足后，受他人依赖激活的尊严和责任继续推动人物。",
    "useWhen": "人物突然舍己为人，转变只靠一句顿悟时",
    "method": "列出转变前后人物愿付的代价，让具体关系逐步改变选择；目标完成后检查还有什么没有解决。",
    "avoid": "用连续死亡机械催泪；给所有小人物预设英雄结局。"
  },
  {
    "id": "sequence-before-jokes",
    "sourceId": "dying-to-survive-outline",
    "medium": "film",
    "tags": [
      "大纲",
      "结构",
      "喜剧",
      "黑色幽默",
      "序列"
    ],
    "location": "16 序列展示及“骨架—材质—色彩”工作说明",
    "observation": "作者先确定段落任务、梳理动作逻辑，最后处理幽默；后半部还改变了团队任务形式。",
    "useWhen": "剧本有许多段子却没有行动推进时",
    "method": "先为每段写清局面如何变化及下一步的原因，再让笑点来自人物处理问题的方式。",
    "avoid": "照抄四幕十六序列；把创作顺序当成唯一流程。"
  },
  {
    "id": "rewrite-dialogue-chain",
    "sourceId": "myth-of-love-essay",
    "medium": "film",
    "tags": [
      "对白",
      "改稿",
      "口语",
      "方言",
      "接话"
    ],
    "location": "围读改词后续写回应；探戈俱乐部台词修改段",
    "observation": "作者换掉拗口词后连同下一句回应一起改写，也把抽象权利表述换成角色自然口吻。",
    "useWhen": "单句润色后接话断裂，或者人物像在念说明书时",
    "method": "朗读连续两三轮交锋；修改一个词后复查对方为何这样回应，删改书面结构但保留人物的主张。",
    "avoid": "只做同义词替换；把所有角色统一改成俏皮话。"
  },
  {
    "id": "lived-material-becomes-task",
    "sourceId": "piano-author-interview",
    "medium": "film",
    "tags": [
      "劳动",
      "工人",
      "东北",
      "群像",
      "职业",
      "现实"
    ],
    "location": "观众 D 询问最初灵感，钢材市场与自制木琴段",
    "observation": "张猛把失业工人延续原有手艺的见闻与父辈制作木琴的经历结合成故事。",
    "useWhen": "职业背景只有称谓，群像缺少共同事情时",
    "method": "让人物现有的技能、材料和关系共同完成一个具体愿望；协作中的分歧表现处境，不靠职业标签介绍。",
    "avoid": "把东北人物等同于贫穷笑料；把虚构钢琴说成真实原型。"
  },
  {
    "id": "stylization-has-reason",
    "sourceId": "piano-author-interview",
    "medium": "film",
    "tags": [
      "风格",
      "舞台感",
      "开场",
      "形式",
      "年代"
    ],
    "location": "观众 C 质疑舞台感，导演解释检斤站开场段",
    "observation": "导演解释开场空间来自现场发现，并主动选择向观众呈现离婚关系的舞台感。",
    "useWhen": "为了去 AI 感把所有风格化表达都删掉时",
    "method": "先判断形式能否清楚呈现人物关系；允许有意的舞台感和直说，删的是无功能装饰。",
    "avoid": "把自然主义当唯一正确风格；照搬原片构图。"
  },
  {
    "id": "image-needs-causality",
    "sourceId": "balloon-author-interview",
    "medium": "film",
    "tags": [
      "意象",
      "结尾",
      "乡土",
      "藏地",
      "诗意"
    ],
    "location": "红气球结局的构思问答",
    "observation": "作者先想到最终意象，再思考孩子争抢、气球爆掉等行为如何使它发生。",
    "useWhen": "结尾突然出现唯美意象，与人物行动无关时",
    "method": "为意象找到故事内的使用者、用途与发生原因；先建立它和人物的关系，再决定是否需要解释。",
    "avoid": "照搬红气球；把超现实段落硬解释成物理现实。"
  },
  {
    "id": "belief-tested-by-cost",
    "sourceId": "balloon-author-interview",
    "medium": "film",
    "tags": [
      "人物",
      "信仰",
      "矛盾",
      "家庭",
      "女性",
      "选择"
    ],
    "location": "饭桌试管婴儿新闻与后来选择的问答",
    "observation": "导演指出人物在谈论科学和涉及自己家庭的选择中表现出矛盾。",
    "useWhen": "人物只是传统或现代观念的代言人时",
    "method": "比较人物谈别人时的立场与自己承担代价时的选择，让行动显露犹疑和矛盾。",
    "avoid": "用族群标签代替个体动机；替女性人物预写统一觉醒结论。"
  },
  {
    "id": "shared-event-motivates-structure",
    "sourceId": "coffin-author-interview",
    "medium": "film",
    "tags": [
      "悬疑",
      "多线",
      "结构",
      "乡村",
      "信息差",
      "非线性"
    ],
    "location": "“大家赞最多的就是觉得电影结构好”问答",
    "observation": "导演解释多线结构来自一具棺材涉及三家人的原型，也警惕沉迷技巧让观众不信服。",
    "useWhen": "多线悬疑只靠打乱时间装复杂时",
    "method": "先写清共享事件和各线人物的利益，再选择揭示次序；每次重访应改变对动机或因果的理解。",
    "avoid": "为了反转隐瞒角色理应知道的事实；套用三家人或棺材情节。"
  },
  {
    "id": "behavior-before-relationship-label",
    "sourceId": "black-coal-early-draft",
    "medium": "film",
    "tags": [
      "开场",
      "关系",
      "动作",
      "信息",
      "潜台词"
    ],
    "location": "早期稿场 2–7：旅馆与离别段",
    "observation": "稿本先写打牌和亲近行为，再让证件改变读者对两人关系的理解。",
    "useWhen": "开场用人物小传直接解释全部关系时",
    "method": "先给可观察的互动，再用有情节作用的物件或行为校正理解；隐去信息必须有合理视角。",
    "avoid": "美化强迫行为；拿早期稿断言成片细节；机械拖延身份交代。"
  },
  {
    "id": "clue-inside-intimacy",
    "sourceId": "black-coal-early-draft",
    "medium": "film",
    "tags": [
      "悬疑",
      "线索",
      "爱情",
      "试探",
      "潜台词"
    ],
    "location": "早期稿场 99–100：见面与摩天轮段",
    "observation": "表面约会中出现指向线索的招牌，人物短暂反应使亲近与调查相互牵制。",
    "useWhen": "侦查线和情感线各演各的时",
    "method": "让同一个选择同时影响信任与信息获取，写对方可见的反应，不追加解释性独白。",
    "avoid": "照搬约会地点、招牌或原作情节；把所有亲密关系写成阴谋。"
  },
  {
    "id": "history-through-lived-change",
    "sourceId": "so-long-author-class",
    "medium": "film",
    "tags": [
      "年代",
      "家庭",
      "群像",
      "历史",
      "现实主义",
      "生活"
    ],
    "location": "时代事件如何进入创作及生活经验段",
    "observation": "公开课介绍先构思人物几十年中经历什么，再带出时代事件，人物素材取自生活经验。",
    "useWhen": "年代剧像历史大事记，人物只负责见证时",
    "method": "沿工作、住处、照料和关系追踪人的变化，只保留实际改变选择的时代条件。",
    "avoid": "把所有大事件塞入一家人的人生；把创作者推测的疾病原因当医学事实。"
  },
  {
    "id": "chronology-before-reordering",
    "sourceId": "so-long-author-class",
    "medium": "film",
    "tags": [
      "非线性",
      "时间",
      "结构",
      "留白",
      "改稿"
    ],
    "location": "线性初稿到非线性方案及结局变化段",
    "observation": "整理稿说明初期采用线性叙事，后来随创作条件与导演取舍改成非线性。",
    "useWhen": "将非线性叙事或圆满结尾当作电影感标配时",
    "method": "先校验时间与因果，再评估重排能带来何种情感或信息效果；结尾服从人物经历。",
    "avoid": "把导演后来的改动冒称编剧初始意图；为高级感强行打乱时间。"
  },
  {
    "id": "social-action-replaces-exposition",
    "sourceId": "no-problem-author-interview",
    "medium": "film",
    "tags": [
      "人情",
      "职场",
      "讽刺",
      "改编",
      "空间",
      "关系"
    ],
    "location": "“主题与空间”关于新增深宅大院及麻将办事的问答",
    "observation": "梅峰把小说略写的人情关系扩为具体空间，使人物在社交时完成事务。",
    "useWhen": "人物用旁白解释关系网，场景却不发生事情时",
    "method": "选择可以同时社交和办事的场合，让谁开口、谁应允、谁获益表现权力关系。",
    "avoid": "把饭局麻将当万能中国元素；仅为换景增加无关支线。"
  },
  {
    "id": "private-public-register",
    "sourceId": "no-problem-author-interview",
    "medium": "film",
    "tags": [
      "对白",
      "方言",
      "身份",
      "公共",
      "私下"
    ],
    "location": "“演员与表演”许老板与三姨太的语言切换段",
    "observation": "导演说明人物在公共场合与私下使用不同语言，服务身份和关系。",
    "useWhen": "同一人物面对所有人都用相同语气时",
    "method": "按对象与场合安排称呼、语气和信息省略；语言转换要有交往动机。",
    "avoid": "用方言给角色贴阶层优劣标签；凭空制造自己不熟悉的方言。"
  },
  {
    "id": "world-rules-bound-action",
    "sourceId": "wandering-earth-author-essay",
    "medium": "film",
    "tags": [
      "科幻",
      "世界观",
      "规则",
      "设定",
      "一致性"
    ],
    "location": "第一部创作中设定集、词汇统一及冰原取舍段",
    "observation": "作者解释设定集约束技术与世界运行，且不需要全部出现在影片中。",
    "useWhen": "设定篇幅巨大，人物却能随意突破规则时",
    "method": "明确当前场景可用资源、限制及代价；统一术语，只呈现影响行动的设定，核对前后约束。",
    "avoid": "用伪科学包装逻辑漏洞；为讲设定中断人物行动。"
  },
  {
    "id": "spectacle-needs-human-relationship",
    "sourceId": "wandering-earth-author-essay",
    "medium": "film",
    "tags": [
      "科幻",
      "团队",
      "人物关系",
      "亲情",
      "群像"
    ],
    "location": "第一部核心人物关系讨论及后续编剧加入段",
    "observation": "作者回顾事件节点较早形成，人物关系却仍需长期梳理，后来明确父子关系的核心作用。",
    "useWhen": "奇观任务清楚但谁来完成都一样时",
    "method": "给团队分工之外的关系、分歧与依赖；检查关键任务如何改变双方，而不是另插一段煽情对白。",
    "avoid": "所有科幻强制父子和解或牺牲；把亲情写成通用捷径。"
  }
];
