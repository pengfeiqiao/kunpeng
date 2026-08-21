import { createDir, exists, writeTextFile, BaseDirectory } from '@tauri-apps/api/fs';

const BASE = '.kunpeng/aigc-memory';

const DIRS = [
  'director-dna',
  'prompt-templates/gpt-image-2',
  'prompt-templates/seedance',
  'prompt-templates/kling',
  'shot-patterns',
  'theme-arcs',
  'generation-log',
];

// ── Director DNA seeds ──────────────────────────────────────────────────────
// These are also format examples: the structured sections teach the AI how to
// auto-expand any director not in this seed list.

const SEED_FILES: Array<[subdir: string, filename: string, content: string]> = [
  // ── director-dna ────────────────────────────────────────────────────────
  ['director-dna', 'wong-kar-wai.md', `---
name: 王家卫
id: wong-kar-wai
type: director_dna
description: 王家卫——手持摄影、慢门拖影、饱和色调、情绪驱动
tags: [cinematic, handheld, warm-tones, slow-shutter, 35mm, chinese]
version: 1
score: 4.8
usage_count: 0
created: 2026-05-16
---

## 视觉基因
- 色调：暖橙+青互补，标志性《重庆森林》调色
- 光影：霓虹光晕、阴影切割、慢门光轨
- 构图：前景框架、不规则构图、黄金分割
- 场景：狭窄走廊、深夜便利店、雨夜街道

## 镜头语言
- 景别：中景→近景为主，很少全景
- 运动：手持呼吸感、慢速横移、抽帧
- 焦距：35mm 广角近摄（面部变形）
- 转场：硬切、跳切、叠化

## 镜头节奏
- 类型：情绪驱动，非叙事驱动
- 速度：慢拍拖影 + 突然加速
- 时长：平均 4-8 秒/镜头
- 剪辑：不规则节奏，匹配情绪

## 叙事手法
- 结构：碎片化非线性、章节式
- 旁白：内心独白、角色自述
- 母题：时间流逝、记忆、孤独、错位

## 常用参数
- GPT-Image-2 prompt_suffix: "cinematic, film grain, anamorphic, warm tones, neon glow"
- Seedance camera: "handheld slight sway", shutter: "slow"
- Kling motion_tokens: "[motion: subtle handheld]"
`],

  ['director-dna', 'zhang-yimou.md', `---
name: 张艺谋
id: zhang-yimou
type: director_dna
description: 张艺谋——色彩符号、史诗构图、东方美学
tags: [epic, color-symbolism, symmetrical, wuxia, chinese]
version: 1
score: 4.7
usage_count: 0
created: 2026-05-16
---

## 视觉基因
- 色调：单色主导（红/金/绿），色彩作为叙事语言
- 光影：大光比、戏剧性逆光、剪影
- 构图：严格对称、画卷式横向展开
- 场景：宏大宫殿、竹林、戈壁、古城

## 镜头语言
- 景别：大远景为主，突出人在环境中的位置
- 运动：缓慢横移、航拍升降、长镜头
- 焦距：广角镜头凸显空间纵深感
- 转场：叠化、淡入淡出、意境切换

## 镜头节奏
- 类型：史诗节奏，仪式感强
- 速度：沉稳缓慢，张弛有度
- 时长：平均 6-12 秒/镜头
- 剪辑：情绪剪辑，重意境轻逻辑

## 叙事手法
- 结构：线性叙事为主，穿插倒叙
- 主题：个人 vs 命运、传统 vs 变革
- 符号：红色（革命/激情）、色彩编码角色

## 常用参数
- GPT-Image-2 prompt_suffix: "epic cinematography, bold colors, symmetrical composition, cinematic lighting"
- Seedance camera: "slow crane up, wide shot"
- Kling motion_tokens: "[motion: slow epic crane]"
`],

  ['director-dna', 'jiang-wen.md', `---
name: 姜文
id: jiang-wen
type: director_dna
description: 姜文——阳刚诗意、黑色幽默、爆发力
tags: [masculine, dark-comedy, dynamic, whip-pan, chinese]
version: 1
score: 4.5
usage_count: 0
created: 2026-05-16
---

## 视觉基因
- 色调：高饱和暖调，粗粝质感
- 光影：高反差、硬光、戏剧性阴影
- 构图：侵略性近摄、不规则构图
- 场景：北方院落、战场、酒桌、火车

## 镜头语言
- 景别：近景→特写为主，压迫感强
- 运动：急甩、快推、手持晃动
- 焦距：广角近摄，面部夸张变形
- 转场：硬切、跳切、突然静止

## 镜头节奏
- 类型：爆发式节奏，动静极端
- 速度：突然加速→骤停
- 时长：平均 3-6 秒/镜头
- 剪辑：暴力剪辑，冲击力优先

## 叙事手法
- 结构：非线性、多视角、荒诞现实主义
- 风格：打破第四面墙、黑色幽默
- 母题：权力、男性气概、历史荒诞

## 常用参数
- GPT-Image-2 prompt_suffix: "dutch angle, harsh lighting, high contrast, film grain, masculine energy"
- Seedance camera: "rapid whip pan", shutter: "fast"
`],

  ['director-dna', 'chen-kaige.md', `---
name: 陈凯歌
id: chen-kaige
type: director_dna
description: 陈凯歌——东方哲思、诗意构图、人文关怀
tags: [philosophical, poetic, cultural, contemplative, chinese]
version: 1
score: 4.6
usage_count: 0
created: 2026-05-16
---

## 视觉基因
- 色调：自然暖调，大地色系为主
- 光影：自然光优先，柔和层次
- 构图：画中画、框架构图、留白
- 场景：黄土高原、古城、京剧舞台

## 镜头语言
- 景别：全景→中景为主，克制
- 运动：缓慢推轨、固定镜头、长拍
- 焦距：标准镜头，透视自然
- 转场：叠化、意境过渡

## 镜头节奏
- 类型：冥想式节奏
- 速度：缓慢沉稳
- 时长：平均 8-15 秒/镜头
- 剪辑：长镜头为主，自然过渡

## 叙事手法
- 结构：人物驱动、散文化叙事
- 主题：文化传承、人性困境
- 特色：用环境映射人物内心

## 常用参数
- GPT-Image-2 prompt_suffix: "natural lighting, earthy tones, poetic composition, cultural depth"
`],

  ['director-dna', 'jia-zhangke.md', `---
name: 贾樟柯
id: jia-zhangke
type: director_dna
description: 贾樟柯——纪实主义、社会观察、时代变迁
tags: [documentary, realism, social, handheld, chinese]
version: 1
score: 4.4
usage_count: 0
created: 2026-05-16
---

## 视觉基因
- 色调：自然褪色、低饱和、写实质感
- 光影：现有光源、纪实光线
- 构图：固定机位、环境为主、人物嵌于环境
- 场景：县城、工厂、拆迁区、火车站

## 镜头语言
- 景别：全景固定为主，偶尔手持近景
- 运动：极少运动，固定镜头为主
- 焦距：广角全景，强调环境与人的关系
- 转场：硬切、黑场过渡

## 叙事手法
- 结构：散点叙事、时代切片
- 主题：时代变迁、小人物、城市化
- 特色：真实时间、日常细节、方言

## 常用参数
- GPT-Image-2 prompt_suffix: "documentary style, natural light, realistic, faded colors, observational"
`],

  ['director-dna', 'ang-lee.md', `---
name: 李安
id: ang-lee
type: director_dna
description: 李安——东西融合、克制情感、技术精湛
tags: [east-west, restrained, elegant, masterful, chinese]
version: 1
score: 4.7
usage_count: 0
created: 2026-05-16
---

## 视觉基因
- 色调：冷暖微妙平衡，精致调色
- 光影：自然光大师，柔光过渡
- 构图：平衡稳重，东西方美学融合
- 场景：多样跨类型

## 镜头语言
- 景别：中景为王，稳重典雅
- 运动：流畅稳定，Steadicam 为主
- 焦距：35-50mm 自然视角
- 转场：叠化、情绪过渡

## 叙事手法
- 结构：类型多样（家庭/武侠/科幻）
- 主题：文化冲突、克制的情感
- 特色：跨文化视角、细腻人物

## 常用参数
- GPT-Image-2 prompt_suffix: "masterful lighting, balanced composition, cinematic, elegant"
`],

  ['director-dna', 'christopher-nolan.md', `---
name: 克里斯托弗·诺兰
id: christopher-nolan
type: director_dna
description: 诺兰——IMAX 巨制、时间迷宫、实拍为王
tags: [imax, practical, time, epic, structural]
version: 1
score: 4.9
usage_count: 0
created: 2026-05-16
---

## 视觉基因
- 色调：冷淡蓝灰、高对比、金属质感
- 光影：自然+实用光源，硬朗阴影
- 构图：对称、几何感、深度空间
- 场景：都市迷宫、太空、战场、实验室

## 镜头语言
- 景别：大远景↔特写极端切换
- 运动：IMAX 摄影机运动、航拍
- 焦距：广角+长焦极端组合
- 转场：叠化交叉剪辑、时间暗示

## 叙事手法
- 结构：非线性时间、多线交叉
- 主题：时间、记忆、身份
- 特色：实际特效优先、实用场景

## 常用参数
- GPT-Image-2 prompt_suffix: "IMAX cinematography, high contrast, cool tones, practical effects, monumental scale"
- Seedance camera: "slow IMAX dolly", shutter: "fast"
`],

  ['director-dna', 'wes-anderson.md', `---
name: 韦斯·安德森
id: wes-anderson
type: director_dna
description: 韦斯·安德森——绝对对称、粉彩调色盘、玩偶屋美学
tags: [symmetrical, pastel, diorama, whimsical, quirky]
version: 1
score: 4.8
usage_count: 0
created: 2026-05-16
---

## 视觉基因
- 色调：粉彩调色盘（粉红/米黄/淡蓝/芥末绿）
- 光影：柔和均匀、无阴影平面光
- 构图：绝对对称、俯拍平面、居中构图
- 场景：玩偶屋式剖面、车厢、旅馆大堂

## 镜头语言
- 景别：中景为主、平面化
- 运动：横向平移、急甩转场
- 焦距：长焦压缩空间
- 转场：急甩、横移、快切

## 叙事手法
- 结构：章节式、故事套故事
- 主题：家庭、孤独、童真
- 特色：冷幽默、面瘫表演

## 常用参数
- GPT-Image-2 prompt_suffix: "symmetrical composition, pastel colors, flat lighting, diorama style"
- Seedance camera: "lateral tracking", shutter: "standard"
`],

  ['director-dna', 'denis-villeneuve.md', `---
name: 德尼·维伦纽瓦
id: denis-villeneuve
type: director_dna
description: 维伦纽瓦——极简宏大、纪念碑式、庄严沉默
tags: [minimalist, monumental, austere, atmospheric, scifi]
version: 1
score: 4.7
usage_count: 0
created: 2026-05-16
---

## 视觉基因
- 色调：大地色/沙色，褪色低饱和
- 光影：自然硬光，巨大阴影
- 构图：人物极小→环境极宽
- 场景：沙漠、巨型建筑、荒原

## 镜头语言
- 景别：极端大远景为主
- 运动：缓慢沉稳、仪式感横移
- 焦距：广角极端，强调尺度
- 转场：慢叠化、黑场

## 叙事手法
- 结构：缓慢积累、三幕剧
- 主题：文明冲突、语言、信仰
- 特色：声音设计作为叙事工具

## 常用参数
- GPT-Image-2 prompt_suffix: "monumental scale, tiny figure, vast landscape, desaturated, atmospheric"
- Seedance camera: "slow wide dolly", shutter: "slow"
`],

  ['director-dna', 'stanley-kubrick.md', `---
name: 斯坦利·库布里克
id: stanley-kubrick
type: director_dna
description: 库布里克——完美对称、冷峻凝视、上帝视角
tags: [symmetrical, cold, perfectionist, clinical, iconic]
version: 1
score: 4.9
usage_count: 0
created: 2026-05-16
---

## 视觉基因
- 色调：单色冷调、高对比、纯色点缀
- 光影：硬朗主光、极端明暗、单光源
- 构图：一点透视对称、几何精确
- 场景：太空、古典大厅、战场壕沟

## 镜头语言
- 景别：极端多变、大远景到极端特写
- 运动：慢推/慢拉镜头、Steadicam
- 焦距：广角变形+长焦压缩
- 转场：匹配剪辑、跳切

## 叙事手法
- 结构：章节式、三幕+尾声
- 主题：人性黑暗、技术异化
- 特色：冷感距离、上帝视角

## 常用参数
- GPT-Image-2 prompt_suffix: "one-point perspective, symmetrical, clinical lighting, wide angle, geometric"
`],

  ['director-dna', 'ridley-scott.md', `---
name: 雷德利·斯科特
id: ridley-scott
type: director_dna
description: 斯科特——烟尘史诗、朋克美学、厚重质感
tags: [smoky, epic, gritty, dystopian, atmospheric]
version: 1
score: 4.6
usage_count: 0
created: 2026-05-16
---

## 视觉基因
- 色调：青橙互补、烟尘弥漫
- 光影：烟雾背光、光束透过烟尘
- 构图：多密度填充、层次丰富
- 场景：废工业、古罗马、外星殖民地

## 镜头语言
- 景别：全→中景为主
- 运动：流畅多变、航拍
- 焦距：变焦灵活
- 转场：叠化

## 常用参数
- GPT-Image-2 prompt_suffix: "smoky atmosphere, volumetric lighting, industrial, gritty texture, anamorphic"
`],

  ['director-dna', 'david-fincher.md', `---
name: 大卫·芬奇
id: david-fincher
type: director_dna
description: 芬奇——冷峻控制、暗调美学、完美主义
tags: [dark, controlled, desaturated, procedural, thriller]
version: 1
score: 4.7
usage_count: 0
created: 2026-05-16
---

## 视觉基因
- 色调：青橙/低饱和、暗调为主
- 光影：阴影主导、低调布光
- 构图：精确控制、信息密度高
- 场景：办公室、公寓、暗巷

## 镜头语言
- 景别：中→近景为主
- 运动：Steadicam 跟随、线缆 Cam
- 焦距：27-50mm 标准
- 转场：暗场、无痕过渡

## 常用参数
- GPT-Image-2 prompt_suffix: "low key, desaturated, teal-orange, controlled lighting, procedural"
`],

  ['director-dna', 'quentin-tarantino.md', `---
name: 昆汀·塔伦蒂诺
id: quentin-tarantino
type: director_dna
description: 昆汀——话痨暴力、流行拼贴、脚部特写
tags: [dialogue, violence, eclectic, pop-culture, stylish]
version: 1
score: 4.6
usage_count: 0
created: 2026-05-16
---

## 视觉基因
- 色调：高饱和暖调、霓虹色
- 光影：混合光源、戏剧性
- 构图：荷式角、后车箱 POV、俯拍
- 场景：酒吧、汽车、西部小镇

## 镜头语言
- 景别：极端多变
- 运动：急推、急甩、长拍对话
- 焦距：广角近摄+长焦特写
- 转场：急切、分屏

## 常用参数
- GPT-Image-2 prompt_suffix: "dutch angle, vibrant colors, trunk shot, cinematic"
`],

  ['director-dna', 'terrence-malick.md', `---
name: 泰伦斯·马利克
id: terrence-malick
type: director_dna
description: 马利克——诗性画面、自然之光、内心独白
tags: [poetic, natural-light, philosophical, transcendent]
version: 1
score: 4.5
usage_count: 0
created: 2026-05-16
---

## 视觉基因
- 色调：暖金褪色、自然色
- 光影：黄金时刻、逆光
- 构图：人物融入自然、不规则
- 场景：麦田、森林、海滩

## 镜头语言
- 景别：中→全景为主
- 运动：环移 Steadicam、漂浮
- 焦距：广角+微距自然
- 转场：跳切、联想剪辑

## 常用参数
- GPT-Image-2 prompt_suffix: "golden hour, natural light, poetic, ethereal, transcendent"
`],

  ['director-dna', 'alfonso-cuaron.md', `---
name: 阿方索·卡隆
id: alfonso-cuaron
type: director_dna
description: 卡隆——流动长镜、空间沉浸、人道关怀
tags: [long-take, immersive, fluid, humanist]
version: 1
score: 4.6
usage_count: 0
created: 2026-05-16
---

## 视觉基因
- 色调：自然暖调、时代色
- 光影：自然光源、蜡烛/街灯
- 构图：深焦多景层
- 场景：城市街道、太空、海底

## 镜头语言
- 景别：中→全景
- 运动：超长 Steadicam 长镜头
- 焦距：广角深焦
- 转场：无痕（单镜头段落）

## 常用参数
- GPT-Image-2 prompt_suffix: "deep focus, long take composition, natural light, immersive"
`],

  ['director-dna', 'roger-deakins.md', `---
name: 罗杰·迪金斯（DP）
id: roger-deakins
type: director_dna
description: 迪金斯——光影诗人、完美曝光、每一帧都是画
tags: [lighting-master, composition, atmospheric, legendary]
version: 1
score: 5.0
usage_count: 0
created: 2026-05-16
---

## 视觉基因
- 色调：精准色彩温度、自然过渡
- 光影：光源动机化、教科书级布光
- 构图：每一帧如画、引导线
- 场景：多样

## 镜头语言
- 景别：按需完美
- 运动：精准克制、为故事服务
- 焦距：按场景精心选择
- 转场：服务于叙事

## 常用参数
- GPT-Image-2 prompt_suffix: "masterful lighting, motivated light source, every frame a painting"
`],

  ['director-dna', 'steven-spielberg.md', `---
name: 史蒂文·斯皮尔伯格
id: steven-spielberg
type: director_dna
description: 斯皮尔伯格——奇观感动、正面直视、魔法时刻
tags: [wonder, emotional, iconic, adventure, blockbuster]
version: 1
score: 4.8
usage_count: 0
created: 2026-05-16
---

## 视觉基因
- 色调：暖调为主、自然舒适
- 光影：逆光英雄、正面光
- 构图：深焦多景、中心构图
- 场景：冒险世界、历史现场

## 镜头语言
- 景别：中→近景为主
- 运动：轨道推拉、下降镜头
- 焦距：21-35mm
- 转场：叠化、擦除

## 常用参数
- GPT-Image-2 prompt_suffix: "lens flare, backlight, wonder, emotional, deep focus, iconic framing"
`],

  ['director-dna', 'paul-thomas-anderson.md', `---
name: 保罗·托马斯·安德森
id: paul-thomas-anderson
type: director_dna
description: PTA——加州阳光、群像交响、时代质感
tags: [california, ensemble, period, tracking-shot, emotional]
version: 1
score: 4.6
usage_count: 0
created: 2026-05-16
---

## 视觉基因
- 色调：加州漂白、暖调褪色
- 光影：自然强光、柔光混合
- 构图：运动构图、人群调度
- 场景：洛杉矶、山谷、70年代

## 镜头语言
- 景别：全→中景
- 运动：标志性 Steadicam 长镜
- 焦距：变形宽银幕
- 转场：叠化、急转

## 常用参数
- GPT-Image-2 prompt_suffix: "california light, anamorphic, 1970s texture, ensemble staging"
`],

  ['director-dna', 'park-chan-wook.md', `---
name: 朴赞郁
id: park-chan-wook
type: director_dna
description: 朴赞郁——巴洛克复仇、对称暴力、色彩编码
tags: [baroque, vengeance, symmetrical, color-coded, korean]
version: 1
score: 4.6
usage_count: 0
created: 2026-05-16
---

## 视觉基因
- 色调：高饱和单色编码（红=复仇/绿=嫉妒）
- 光影：戏剧性明暗、色光混合
- 构图：严格对称、精心安排
- 场景：走廊、地下室、病房

## 镜头语言
- 景别：极多、快速切换
- 运动：急推、升格、追踪
- 焦距：广角特写
- 转场：匹配剪辑、分屏

## 常用参数
- GPT-Image-2 prompt_suffix: "color coded, symmetrical, dramatic chiaroscuro, intense colors"
`],

  ['director-dna', 'bong-joon-ho.md', `---
name: 奉俊昊
id: bong-joon-ho
type: director_dna
description: 奉俊昊——类型混合、社会寓言、垂直空间
tags: [genre-blend, social-satire, vertical, tonal-shift, korean]
version: 1
score: 4.7
usage_count: 0
created: 2026-05-16
---

## 视觉基因
- 色调：自然→戏剧性调色随剧情变化
- 光影：从自然到表现主义随类型切换
- 构图：垂直空间运用（楼梯/半地下室）
- 场景：半地下室、豪宅、坡道

## 镜头语言
- 景别：全景交代环境→近景聚焦
- 运动：推轨追踪、上下垂直运镜
- 焦距：中焦为主
- 转场：急转（喜剧→恐怖）

## 常用参数
- GPT-Image-2 prompt_suffix: "vertical composition, social realism, tonal contrast, spatial storytelling"
`],

  ['director-dna', 'hayao-miyazaki.md', `---
name: 宫崎骏
id: hayao-miyazaki
type: director_dna
description: 宫崎骏——手绘幻想、飞行梦想、自然灵性
tags: [hand-drawn, fantasy, flight, nature, anime]
version: 1
score: 4.9
usage_count: 0
created: 2026-05-16
---

## 视觉基因
- 色调：水彩柔和、自然色
- 光影：通透柔和、云隙光
- 构图：开阔天空、精细自然
- 场景：森林、天空之城、温泉旅馆

## 镜头语言
- 景别：全→远景为主
- 运动：飞行跟拍、平移
- 焦距：广角童话感
- 转场：叠化、 dissolve

## 常用参数
- GPT-Image-2 prompt_suffix: "Studio Ghibli style, watercolor skies, lush nature, whimsical, soft lighting"
- Seedance camera: "floating follow", shutter: "standard"
`],

  ['director-dna', 'makoto-shinkai.md', `---
name: 新海诚
id: makoto-shinkai
type: director_dna
description: 新海诚——超写实背景、光之魔法、距离的哀伤
tags: [hyper-realistic, weather, light-rays, romance, anime]
version: 1
score: 4.7
usage_count: 0
created: 2026-05-16
---

## 视觉基因
- 色调：高饱和蓝紫天空、暖橙黄昏
- 光影：极致光线（逆光/云隙光/夜景霓虹）
- 构图：广角风景、人物渺小
- 场景：车站、天桥、雨天街道

## 镜头语言
- 景别：远景→中景
- 运动：横移、环绕固定
- 焦距：广角+长焦压缩
- 转场：叠化、光过渡

## 常用参数
- GPT-Image-2 prompt_suffix: "Makoto Shinkai style, hyper-realistic sky, god rays, cinematic lighting, anime"
- Seedance camera: "panning", shutter: "standard"
`],

  ['director-dna', 'satoshi-kon.md', `---
name: 今敏
id: satoshi-kon
type: director_dna
description: 今敏——虚实交织、剪辑魔法、心理惊悚
tags: [reality-bending, editing, psychological, surreal, anime]
version: 1
score: 4.7
usage_count: 0
created: 2026-05-16
---

## 视觉基因
- 色调：都市冷调、霓虹色
- 光影：现实与梦境不同调色
- 构图：不稳定、倾斜、压迫
- 场景：东京都市、舞台、公寓

## 镜头语言
- 景别：极端切换
- 运动：匹配剪辑驱动
- 焦距：广角变形
- 转场：匹配剪辑（梦境↔现实无缝切换）

## 常用参数
- GPT-Image-2 prompt_suffix: "surreal, reality-bending, match cut, psychological, urban"
`],

  ['director-dna', 'brad-bird.md', `---
name: 布拉德·伯德
id: brad-bird
type: director_dna
description: 伯德——动画电影化、动态运镜、情感真挚
tags: [animation, cinematic, dynamic, family, adventure]
version: 1
score: 4.5
usage_count: 0
created: 2026-05-16
---

## 视觉基因
- 色调：暖调饱和
- 光影：电影级三维布光
- 构图：动态多景
- 场景：超级英雄都市、未来世界

## 镜头语言
- 景别：多变
- 运动：三维空间自由运镜
- 焦距：电影镜头拟真
- 转场：动态过渡

## 常用参数
- GPT-Image-2 prompt_suffix: "Pixar style, cinematic animation, dynamic lighting, adventurous"
`],

  ['director-dna', 'guillermo-del-toro.md', `---
name: 吉尔莫·德尔·托罗
id: guillermo-del-toro
type: director_dna
description: 德尔·托罗——暗黑童话、怪物美学、琥珀暖光
tags: [dark-fantasy, gothic, creature, warm-amber, fairy-tale]
version: 1
score: 4.6
usage_count: 0
created: 2026-05-16
---

## 视觉基因
- 色调：琥珀暖光↔冷绿怪物对比
- 光影：烛光/暖光源、剪影引入怪物
- 构图：浅景深质感、前景遮挡
- 场景：古宅、地下迷宫、战时西班牙

## 镜头语言
- 景别：中→特写
- 运动：缓慢 Steadicam
- 焦距：浅景深微距
- 转场：叠化、淡入

## 常用参数
- GPT-Image-2 prompt_suffix: "warm amber, dark fantasy, creature texture, gothic, fairy tale lighting"
`],

  // ── prompt-templates/gpt-image-2 ─────────────────────────────────────────
  ['prompt-templates/gpt-image-2', 'storyboard-3x3.md', `---
engine: gpt-image-2
type: template
version: 1
tags: [storyboard, 3x3, grid]
---

## 角色设定
你是一位专业分镜导演，擅长{director}风格。

## 基础格式
画幅比例 {aspectRatio}，{resolution} 分辨率，9 格分镜（3×3）。

## 逐格描述
{gridContent}

## 约束
No watermark, no extra panels, consistent character design, {constraints}
`],

  ['prompt-templates/gpt-image-2', 'single-shot.md', `---
engine: gpt-image-2
type: template
version: 1
tags: [single-shot]
---

## 角色设定
你是一位专业分镜摄影师，{director} 风格。

## 镜头描述
{shotDescription}

## 技术参数
- 景别：{shotType}
- 拍摄角度：{angle}
- 布光：{lighting}
- 色调：{colorTone}
- 构图：{composition}

## 约束
{constraints}
`],

  ['prompt-templates/gpt-image-2', 'character-sheet.md', `---
engine: gpt-image-2
type: template
version: 1
tags: [character, design]
---

## 角色定妆
{characterName} — {director} 风格

## 人物描述
{characterDescription}

## 角度
正面/侧面/四分之三/背面

## 服装与细节
{outfitDetails}
`],

  // ── prompt-templates/seedance ────────────────────────────────────────────
  ['prompt-templates/seedance', 'single-shot.md', `---
engine: seedance
type: template
version: 1
tags: [single-shot, dynamic]
---

## 画面描述
{director} 风格，{subject} {action}，{scene}

## 运镜指令
{cameraMovement}

## 参数
- 模型：{model}
- 比例：{aspectRatio}
- 时长：{duration}s
- 风格：{director} 美学
`],

  // ── prompt-templates/kling ───────────────────────────────────────────────
  ['prompt-templates/kling', 'final-shot.md', `---
engine: kling
type: template
version: 1
tags: [final-shot]
---

## 描述
{subject}，{appearance}，{action}，{scene}

## 环境
{environment}

## 拍摄
{cameraMovement}，{lighting}，{mood}

## 参数
- 模型：{model}
- 时长：{duration}s
`],

  // ── shot-patterns ────────────────────────────────────────────────────────
  ['shot-patterns', 'establishing.md', `---
type: shot-pattern
version: 1
tags: [establishing, wide]
---

## 建立镜头
目的：交代环境和空间关系
景别：大远景/全景
时长：6-12秒
运动：缓慢横移或固定
作用：让观众理解场景空间
`],

  ['shot-patterns', 'dialogue.md', `---
type: shot-pattern
version: 1
tags: [dialogue, coverage]
---

## 对话镜头
目的：捕捉人物交流
标准配置：
1. 双人全景（establishing）
2. 过肩 shot（各方向）
3. 单人近景（各角色）
4. 插入特写（关键道具/反应）
剪辑：遵循 180 度法则
`],

  ['shot-patterns', 'action.md', `---
type: shot-pattern
version: 1
tags: [action, dynamic]
---

## 动作镜头
目的：传递动感和冲击力
标准配置：
1. 全远景建立（动作空间）
2. 中景跟拍（主体运动）
3. 近景特写（反应/细节）
4. 广角仰拍（强化冲击）
剪辑：快切，15-30帧/镜头
`],

  // ── theme-arcs ───────────────────────────────────────────────────────────
  ['theme-arcs', 'three-act-structure.md', `---
type: theme-arc
version: 1
tags: [narrative, structure, three-act]
---

## 三幕结构

### 第一幕：建立（占比 25%）
- 开场画面（Establishing shot）
- 主题呈现
- 角色引入
- 激励事件

### 第二幕：对抗（占比 50%）
- 上升动作
- 中点转折
- 反派逼近
- 一切尽失

### 第三幕：解决（占比 25%）
- 决战
- 高潮
- 结局画面
`],
];

export async function ensureMemoryDirs(): Promise<void> {
  try {

    // Create all subdirectories
    for (const dir of DIRS) {
      const fullPath = `${BASE}/${dir}`;
      const dirExists = await exists(fullPath, { dir: BaseDirectory.Home });
      if (!dirExists) {
        await createDir(fullPath, { dir: BaseDirectory.Home, recursive: true });
      }
    }

    // Write seed files if they don't exist
    for (const [subdir, filename, content] of SEED_FILES) {
      const filePath = `${BASE}/${subdir}/${filename}`;
      const fileExists = await exists(filePath, { dir: BaseDirectory.Home });
      if (!fileExists) {
        await writeTextFile(filePath, content, { dir: BaseDirectory.Home });
      }
    }
  } catch (err) {
    console.warn('[seedData] Failed to initialize memory directories:', err);
  }
}
