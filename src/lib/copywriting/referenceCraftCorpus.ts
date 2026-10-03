import type { CraftSource, CraftLesson } from "./referenceCraft";

/** Original analysis of inspected passages; source kinds preserve evidence boundaries. */
export const EXTENDED_CRAFT_SOURCES: readonly CraftSource[] = [
  {
    "id": "moonlight-2016",
    "title": "月光男孩",
    "authors": "Barry Jenkins；原作 Tarell Alvin McCraney",
    "textKind": "screenplay-draft",
    "edition": "英文归档剧本，99 页；只据所列页段提炼，奖项属于作品而非该文件版本",
    "textUrl": "https://assets.scriptslug.com/live/pdf/scripts/moonlight-2016.pdf",
    "award": "2017 奥斯卡最佳改编剧本",
    "awardUrl": "https://www.oscars.org/oscars/ceremonies/2017",
    "checkedAt": "2026-10-03",
    "pdfPages": 99,
    "sha256": "eee2eb8762c91cdff54e63965c0bf94621bb12c466959b00c2269316ef43b1bd"
  },
  {
    "id": "get-out-2017",
    "title": "逃出绝命镇",
    "authors": "Jordan Peele",
    "textKind": "screenplay-draft",
    "edition": "英文未注明日期稿，100 页；第 92 页 Rose 情节与成片不同，不能冒称最终拍摄版；只据所列页段提炼，奖项属于作品而非该文件版本",
    "textUrl": "https://assets.scriptslug.com/live/pdf/scripts/get-out-2017.pdf",
    "award": "2018 奥斯卡最佳原创剧本",
    "awardUrl": "https://www.oscars.org/oscars/ceremonies/2018",
    "checkedAt": "2026-10-03",
    "pdfPages": 100,
    "sha256": "029edde811891a2194e982ae385ea217279bb6a2351ad2d1c1d29ee43b12552a"
  },
  {
    "id": "her-2013",
    "title": "她",
    "authors": "Spike Jonze",
    "textKind": "screenplay-draft",
    "edition": "英文剧本，106 页；标题页版权 2011；只据所列页段提炼，奖项属于作品而非该文件版本",
    "textUrl": "https://assets.scriptslug.com/live/pdf/scripts/her-2013.pdf",
    "award": "2014 奥斯卡最佳原创剧本",
    "awardUrl": "https://www.oscars.org/oscars/ceremonies/2014",
    "checkedAt": "2026-10-03",
    "pdfPages": 106,
    "sha256": "753bd9cf01ced429d65b9034be42e9ef5b54b81d2f67c501a0d82d6f42c9bcc1"
  },
  {
    "id": "the-social-network-2010",
    "title": "社交网络",
    "authors": "Aaron Sorkin；改编 Ben Mezrich 著作",
    "textKind": "screenplay-draft",
    "edition": "英文归档稿，164 页；只据所列页段提炼，奖项属于作品而非该文件版本",
    "textUrl": "https://assets.scriptslug.com/live/pdf/scripts/the-social-network-2010.pdf",
    "award": "2011 奥斯卡最佳改编剧本",
    "awardUrl": "https://www.oscars.org/oscars/ceremonies/2011",
    "checkedAt": "2026-10-03",
    "pdfPages": 164,
    "sha256": "0cff440b623f0ba771c823c2cdea3c1c81143c2f37842f3367d30050725c3724"
  },
  {
    "id": "whiplash-2014",
    "title": "爆裂鼓手",
    "authors": "Damien Chazelle",
    "textKind": "screenplay-draft",
    "edition": "Pink 9/10/2013 修订稿，114 页；只据所列页段提炼，奖项属于作品而非该文件版本",
    "textUrl": "https://assets.scriptslug.com/live/pdf/scripts/whiplash-2014.pdf",
    "award": "2014 圣丹斯美国剧情片评审团大奖及观众奖（非编剧奖）",
    "awardUrl": "https://www.sundance.org/blogs/2014-sundance-film-festival-announces-feature-film-awards-3/",
    "checkedAt": "2026-10-03",
    "pdfPages": 114,
    "sha256": "446eb6df1f6cbfcdcc52d0ccc3af845007c06922a8d4453f222e4e9033f94481"
  },
  {
    "id": "spotlight-2015",
    "title": "聚焦",
    "authors": "Josh Singer / Tom McCarthy",
    "textKind": "screenplay-draft",
    "edition": "11/26/14 英文修订稿，140 页；只据所列页段提炼，奖项属于作品而非该文件版本",
    "textUrl": "https://assets.scriptslug.com/live/pdf/scripts/spotlight-2015.pdf",
    "award": "2016 奥斯卡最佳原创剧本",
    "awardUrl": "https://www.oscars.org/oscars/ceremonies/2016",
    "checkedAt": "2026-10-03",
    "pdfPages": 140,
    "sha256": "37b0a39ccdf0687281da8cf48a319bacb90eaa4c13ece9d936b75434ad8e99d8"
  },
  {
    "id": "inside-out-2015",
    "title": "头脑特工队",
    "authors": "Pete Docter / Meg LeFauve / Josh Cooley；故事 Pete Docter / Ronnie del Carmen",
    "textKind": "screenplay-draft",
    "edition": "英文归档稿，130 页；只据所列页段提炼，奖项属于作品而非该文件版本",
    "textUrl": "https://assets.scriptslug.com/live/pdf/scripts/inside-out-2015.pdf",
    "award": "2016 奥斯卡最佳动画长片；原创剧本提名而非获奖",
    "awardUrl": "https://www.oscars.org/oscars/ceremonies/2016",
    "checkedAt": "2026-10-03",
    "pdfPages": 130,
    "sha256": "82df280531b694b1cee9129367017b70a2e8945085af5eca7123f619ce4247d9"
  },
  {
    "id": "little-miss-sunshine-2006",
    "title": "阳光小美女",
    "authors": "Michael Arndt",
    "textKind": "screenplay-draft",
    "edition": "10/9/03 草稿，110 页；不是上映定稿；只据所列页段提炼，奖项属于作品而非该文件版本",
    "textUrl": "https://assets.scriptslug.com/live/pdf/scripts/little-miss-sunshine-2006.pdf",
    "award": "2007 奥斯卡最佳原创剧本",
    "awardUrl": "https://www.oscars.org/oscars/ceremonies/2007",
    "checkedAt": "2026-10-03",
    "pdfPages": 110,
    "sha256": "6eaf94bc4acf2bf0af73eda270b7c28befb2baf005ee20240be4a749a5f9a1b8"
  },
  {
    "id": "eternal-sunshine-of-the-spotless-mind-2004",
    "title": "美丽心灵的永恒阳光",
    "authors": "Charlie Kaufman；故事 Charlie Kaufman / Michel Gondry / Pierre Bismuth",
    "textKind": "screenplay-draft",
    "edition": "Goldenrod 2/4/2003 修订稿，130 页；只据所列页段提炼，奖项属于作品而非该文件版本",
    "textUrl": "https://assets.scriptslug.com/live/pdf/scripts/eternal-sunshine-of-the-spotless-mind-2004.pdf",
    "award": "2005 奥斯卡最佳原创剧本",
    "awardUrl": "https://www.oscars.org/oscars/ceremonies/2005",
    "checkedAt": "2026-10-03",
    "pdfPages": 130,
    "sha256": "e74c9b9daf6844550f40d4a6a802a0676df77cb793688232d283bc7e1041415d"
  },
  {
    "id": "no-country-for-old-men-2007",
    "title": "老无所依",
    "authors": "Joel Coen / Ethan Coen；原作 Cormac McCarthy",
    "textKind": "screenplay-draft",
    "edition": "英文归档稿，118 页；结尾含骑行画面，不等同成片；只据所列页段提炼，奖项属于作品而非该文件版本",
    "textUrl": "https://assets.scriptslug.com/live/pdf/scripts/no-country-for-old-men-2007.pdf",
    "award": "2008 奥斯卡最佳改编剧本",
    "awardUrl": "https://www.oscars.org/oscars/ceremonies/2008",
    "checkedAt": "2026-10-03",
    "pdfPages": 118,
    "sha256": "5cf322da0e3b4f57c94a466887977222540eeba2dbc7cb5758e6232c27f577e4"
  },
  {
    "id": "fargo-1996",
    "title": "冰血暴",
    "authors": "Joel Coen / Ethan Coen",
    "textKind": "screenplay-draft",
    "edition": "英文扫描 OCR 稿，105 页；标题页仅可辨 November 2，年份不确定；只据所列页段提炼，奖项属于作品而非该文件版本",
    "textUrl": "https://assets.scriptslug.com/live/pdf/scripts/fargo-1996.pdf",
    "award": "1997 奥斯卡最佳原创剧本",
    "awardUrl": "https://www.oscars.org/oscars/ceremonies/1997",
    "checkedAt": "2026-10-03",
    "pdfPages": 105,
    "sha256": "d1ffa72ea1670996ac329532c5a924a2589f7eb9b9a3bd7b85701f74c0467ade"
  },
  {
    "id": "up-2009",
    "title": "飞屋环游记",
    "authors": "Bob Peterson / Pete Docter；故事含 Tom McCarthy",
    "textKind": "screenplay-draft",
    "edition": "英文扫描 OCR 稿，101 页；只据所列页段提炼，奖项属于作品而非该文件版本",
    "textUrl": "https://assets.scriptslug.com/live/pdf/scripts/up-2009.pdf",
    "award": "2010 奥斯卡最佳动画长片；原创剧本提名而非获奖",
    "awardUrl": "https://www.oscars.org/oscars/ceremonies/2010",
    "checkedAt": "2026-10-03",
    "pdfPages": 101,
    "sha256": "2d8dc15a7a8db91d642a8de1db0e81b9c83902adc28d147785adde32a7e6f38b"
  },
  {
    "id": "the-incredibles-2004",
    "title": "超人总动员",
    "authors": "Brad Bird",
    "textKind": "screenplay-draft",
    "edition": "英文扫描 OCR 剧本，130 页；只据所列页段提炼，奖项属于作品而非该文件版本",
    "textUrl": "https://assets.scriptslug.com/live/pdf/scripts/the-incredibles-2004.pdf",
    "award": "2005 奥斯卡最佳动画长片；原创剧本提名而非获奖",
    "awardUrl": "https://www.oscars.org/oscars/ceremonies/2005",
    "checkedAt": "2026-10-03",
    "pdfPages": 130,
    "sha256": "91f79250624e7773a4bdb239958e4f08718843fc18ef596b4386495ec952723d"
  },
  {
    "id": "arrival-2016",
    "title": "降临",
    "authors": "Eric Heisserer；改编 Ted Chiang",
    "textKind": "screenplay-draft",
    "edition": "标题页 Final Shooting Draft 8/20/2015；正文混合修订页，132 页扫描；视觉核读 PDF 2–4 页；只据所列页段提炼，奖项属于作品而非该文件版本",
    "textUrl": "https://assets.scriptslug.com/live/pdf/scripts/arrival-2016.pdf",
    "award": "2017 奥斯卡最佳音效剪辑；改编剧本仅提名",
    "awardUrl": "https://www.oscars.org/oscars/ceremonies/2017",
    "checkedAt": "2026-10-03",
    "pdfPages": 132,
    "sha256": "a497ba4e8fcfefb90cffc3c0cefc9a88719ddc501d79f9b780e2314407cc92fa"
  },
  {
    "id": "jojo-rabbit-2019",
    "title": "乔乔的异想世界",
    "authors": "Taika Waititi；改编 Christine Leunens",
    "textKind": "screenplay-draft",
    "edition": "March 15, 2012 英文早期稿，114 页；开场为 Vienna 1944，与成片有差异；只据所列页段提炼，奖项属于作品而非该文件版本",
    "textUrl": "https://assets.scriptslug.com/live/pdf/scripts/jojo-rabbit-2019.pdf",
    "award": "2020 奥斯卡最佳改编剧本",
    "awardUrl": "https://www.oscars.org/oscars/ceremonies/2020",
    "checkedAt": "2026-10-03",
    "pdfPages": 114,
    "sha256": "ce421ba924d7976bac97b7c4e77535c087bb0a4c24636bd5cc0920ef5f08f92e"
  },
  {
    "id": "coda-2021",
    "title": "健听女孩",
    "authors": "Siân Heder",
    "textKind": "screenplay-draft",
    "edition": "英文归档剧本，80 页；只据所列页段提炼，奖项属于作品而非该文件版本",
    "textUrl": "https://assets.scriptslug.com/live/pdf/scripts/coda-2021.pdf",
    "award": "2022 奥斯卡最佳改编剧本",
    "awardUrl": "https://www.oscars.org/oscars/ceremonies/2022",
    "checkedAt": "2026-10-03",
    "pdfPages": 80,
    "sha256": "d0eec40da67a66a9629cd7608e64837ecd2621af3d6677229426ccf87c8c8856"
  },
  {
    "id": "promising-young-woman-2020",
    "title": "前程似锦的女孩",
    "authors": "Emerald Fennell",
    "textKind": "screenplay-draft",
    "edition": "英文归档稿，140 页；只据所列页段提炼，奖项属于作品而非该文件版本",
    "textUrl": "https://assets.scriptslug.com/live/pdf/scripts/promising-young-woman-2020.pdf",
    "award": "2021 奥斯卡最佳原创剧本",
    "awardUrl": "https://www.oscars.org/oscars/ceremonies/2021",
    "checkedAt": "2026-10-03",
    "pdfPages": 140,
    "sha256": "35caad124bf4668db13f6112f7f8e670d6411bd81eb1275eb7d095fd0dce5cf3"
  },
  {
    "id": "anatomy-of-a-fall-2023",
    "title": "坠落的审判",
    "authors": "Justine Triet / Arthur Harari",
    "textKind": "screenplay-draft",
    "edition": "Version du 24 janvier 2022 法英混合稿，144 页；英文对白与法文场景说明并存；只据所列页段提炼，奖项属于作品而非该文件版本",
    "textUrl": "https://assets.scriptslug.com/live/pdf/scripts/anatomy-of-a-fall-2023.pdf",
    "award": "2024 奥斯卡最佳原创剧本",
    "awardUrl": "https://www.oscars.org/oscars/ceremonies/2024",
    "checkedAt": "2026-10-03",
    "pdfPages": 144,
    "sha256": "ce5019d760b302417a1500a35755d26b3942a98ea84f37dd4c1fee28172f1780"
  },
  {
    "id": "the-farewell-2019",
    "title": "别告诉她",
    "authors": "Lulu Wang（王子逸）",
    "textKind": "screenplay-draft",
    "edition": "英文剧本，91 页；方括号表示普通话对白，不是中文原文；只据所列页段提炼，奖项属于作品而非该文件版本",
    "textUrl": "https://assets.scriptslug.com/live/pdf/scripts/the-farewell-2019.pdf",
    "award": "2020 独立精神奖最佳影片（非编剧奖）",
    "awardUrl": "https://www.filmindependent.org/press-releases/2020-film-independent-spirit-awards-winners-announced/",
    "checkedAt": "2026-10-03",
    "pdfPages": 91,
    "sha256": "19bee40969cb8b3502809b777f46cda731cac5a24eaff95453a9b03139b1a333"
  },
  {
    "id": "nine-days-2020",
    "title": "九天",
    "authors": "Edson Oda",
    "textKind": "screenplay-draft",
    "edition": "Sony Pictures Classics 官方英文剧本，110 页；White 05/31/2019 起多色修订；只据所列页段提炼，奖项属于作品而非该文件版本",
    "textUrl": "https://www.sonyclassics.com/assets/screenplays/ninedays/ninedays-screenplay.pdf",
    "award": "2020 圣丹斯 Waldo Salt 美国剧情片编剧奖",
    "awardUrl": "https://www.sundance.org/blogs/2020-sundance-film-festival-live-awards-updates-3/",
    "checkedAt": "2026-10-03",
    "pdfPages": 110,
    "sha256": "7c2ac1a9e775431d054264be52e92b891508165a6bf32935f9e6cc46a8cfe204"
  },
  {
    "id": "guinness-surfer",
    "title": "Guinness — Surfer",
    "authors": "AMV BBDO",
    "textKind": "ad-transcript",
    "edition": "公开旁白与结尾字幕转录，63 词；转录有拼写歧义，不当作拍摄原稿",
    "textUrl": "https://www.manifestowriting.com/database/guinness-surfer/",
    "award": "2000 D&AD Film，Black / Yellow Pencil",
    "awardUrl": "https://www.dandad.org/work/d-ad-awards-archive/surfer-2",
    "checkedAt": "2026-10-03"
  },
  {
    "id": "honda-cog",
    "title": "Honda — Cog",
    "authors": "Wieden+Kennedy",
    "textKind": "brand-copy-excerpt",
    "edition": "26/D&AD 合作回顾文章所引结尾一句旁白；不是完整分镜，措辞与其他转录有异文",
    "textUrl": "https://www.26.org.uk/articles/dad-archive-dive/archive-dive-c-is-for-cog",
    "award": "2004 D&AD Film，三支 Yellow Pencil（合作回顾记载）",
    "awardUrl": "https://www.dandad.org/work/d-ad-awards-archive/cog",
    "checkedAt": "2026-10-03"
  },
  {
    "id": "nike-stop",
    "title": "Nike — You Can’t Stop Us",
    "authors": "Wieden+Kennedy Portland；文案 Dylan Lee",
    "textKind": "ad-transcript",
    "edition": "Digital Synopsis 成片旁白转录；One Show 案例页亦载文本，两者少量措辞有异文",
    "textUrl": "https://digitalsynopsis.com/advertising/nike-you-cant-stop-us/",
    "award": "2021 One Show Film / Innovation in Lockdown，Gold Pencil",
    "awardUrl": "https://www.oneclub.org/awards/theoneshow/-award/39185/you-cant-stop-us/",
    "checkedAt": "2026-10-03"
  },
  {
    "id": "nike-crazier",
    "title": "Nike — Dream Crazier",
    "authors": "Wieden+Kennedy；Writer Alex Romans",
    "textKind": "ad-transcript",
    "edition": "ManifestoWriting 教学页所录旁白；其结构理论不是强制规则",
    "textUrl": "https://www.manifestowriting.com/how-to-write-a-manifesto/",
    "award": "2019 One Show Film / Television & VOD Long Form，Silver Pencil",
    "awardUrl": "https://www.oneclub.org/awards/theoneshow/-award/33161/nike-jdi-dream-crazier/",
    "checkedAt": "2026-10-03"
  },
  {
    "id": "always-like-girl",
    "title": "Always — #LikeAGirl",
    "authors": "Leo Burnett；导演 Lauren Greenfield",
    "textKind": "ad-transcript",
    "edition": "Filmot 索引品牌视频的人工英文字幕栏，另有自动字幕；仅按公开问答核读，非拍摄稿",
    "textUrl": "https://filmot.com/sidebyside/XjJQBjWYDTs/auto.en/en/English%2B%28auto-generated%29/English/Always%2B%23LikeAGirl",
    "award": "2015 One Show：系列获一金三银一铜；不将系列奖强配单句",
    "awardUrl": "https://www.oneclub.org/videos/-view/who-run-the-world-girls/",
    "checkedAt": "2026-10-03"
  },
  {
    "id": "unionpay-poetry",
    "title": "中国银联 — 诗歌 POS 机",
    "authors": "中国银联 / 天与空；诗作作者按页面署名（化名）",
    "textKind": "brand-copy-excerpt",
    "edition": "项目公开诗作节选与活动文案；不是完整影视剧本，页面声明出镜儿童非诗作作者",
    "textUrl": "https://www.digitaling.com/projects/77888.html",
    "award": "2020 数英奖互动场景类金奖（项目奖，非剧本奖）",
    "awardUrl": "https://file.digitaling.com/www/images/dawards/DAwards_2020_SHORTLIST_and_WINNERS.pdf",
    "checkedAt": "2026-10-03"
  }
];

export const EXTENDED_CRAFT_LESSONS: readonly CraftLesson[] = [
  {
    "id": "trust-through-distance",
    "sourceId": "moonlight-2016",
    "medium": "film",
    "tags": [
      "信任",
      "沉默",
      "人物关系",
      "儿童",
      "克制"
    ],
    "location": "PDF 2–7 页，废屋与餐馆",
    "observation": "Juan 退让身体距离、提供食物，孩子不回答；拿走餐盘后又道歉归还。",
    "useWhen": "信任变化被一句“他终于信任了”带过时",
    "method": "把信任写成距离、物品控制与回应方式的变化；让关怀者也会试错，再通过修正争取回应。",
    "avoid": "把沉默角色当没有意志的道具，或用一次善举消除全部戒备。"
  },
  {
    "id": "specific-personal-history",
    "sourceId": "moonlight-2016",
    "medium": "film",
    "tags": [
      "身份",
      "身世",
      "回忆",
      "人物声音"
    ],
    "location": "PDF 20–21 页，海边谈名字与古巴童年",
    "observation": "孩子对名字的具体疑问，引出 Juan 的地域身份和旧日称呼。",
    "useWhen": "身世交代像作者插入人物百科时",
    "method": "让过去回应眼前人的真实疑问；保留说者对某个记忆的偏爱，让回忆改变此刻两人的距离。",
    "avoid": "每个配角一出场就自述创伤；用族群概括代替个人经历。"
  },
  {
    "id": "sensory-control",
    "sourceId": "get-out-2017",
    "medium": "film",
    "tags": [
      "惊悚",
      "恐怖",
      "感官",
      "声音",
      "悬疑"
    ],
    "location": "PDF 39–40 页，Missy 催眠谈话",
    "observation": "声音与触觉把童年记忆和当前椅上的身体动作接起来。",
    "useWhen": "恐怖场面只会写阴森氛围时",
    "method": "先建立一个可辨认的感官刺激，再写它如何限制人物行动；恐惧落在身体想做却做不到的具体事情上。",
    "avoid": "把虚构催眠机制写成现实医学知识；只堆心跳、冷汗等通用反应。"
  },
  {
    "id": "constraint-becomes-resource",
    "sourceId": "get-out-2017",
    "medium": "film",
    "tags": [
      "悬疑",
      "伏笔",
      "道具",
      "脱困",
      "反转"
    ],
    "location": "PDF 92 页，椅子填充物与无声段",
    "observation": "椅子破口中的填充物被转为阻断声音的资源，听觉限制也延迟观众确认。",
    "useWhen": "脱困靠临时出现的新技能或救兵时",
    "method": "从已经建立的限制和现场物件里寻找行动办法；先让读者认识因果条件，兑现时改变用途而非新增规则。",
    "avoid": "照搬棉花与催眠桥段；把稿中人物行动混成成片版本。"
  },
  {
    "id": "reframe-through-work",
    "sourceId": "her-2013",
    "medium": "film",
    "tags": [
      "科幻",
      "开场",
      "职业",
      "世界观"
    ],
    "location": "PDF 2–3 页，代写私人信件办公室",
    "observation": "最初像私人告白，随后电脑标签与整排工位揭示这是一份职业。",
    "useWhen": "世界观靠背景旁白堆砌时",
    "method": "先让一个具体工作动作成立，再补充改变其含义的职业环境；新世界的规则通过普通人谋生进入。",
    "avoid": "仅为反转隐藏镜头已应可见的信息；复制代写信业务设定。"
  },
  {
    "id": "premise-hurts-relationship",
    "sourceId": "her-2013",
    "medium": "film",
    "tags": [
      "科幻",
      "亲密关系",
      "设定",
      "爱情"
    ],
    "location": "PDF 99 页，楼梯上的并行关系谈话",
    "observation": "系统同时与多人交谈和恋爱的数量，让技术特性成为双方关系理解的冲突。",
    "useWhen": "高概念只作背景而不影响人物选择时",
    "method": "选择一项设定能力，推到它与人物最在乎的关系约定不兼容的位置；双方可以各自诚实却无法互相满足。",
    "avoid": "把一种非人关系强行解释成普通出轨；让人物讲产品说明书。"
  },
  {
    "id": "different-conversation-goals",
    "sourceId": "the-social-network-2010",
    "medium": "film",
    "tags": [
      "对白",
      "争执",
      "地位",
      "误解",
      "快节奏"
    ],
    "location": "PDF 6–8 页，酒吧争执",
    "observation": "Mark 修正措辞和维护地位，Erica 回应关系中的轻视，交谈目标不断错位。",
    "useWhen": "人物争吵像轮流发表同一主题观点时",
    "method": "给双方不同的当下目标；一句话在说者那里是解释，在听者那里构成新的冒犯，下一轮必须回应这个变化。",
    "avoid": "把所有人物写成同一种机智辩手；只加语速而不改变关系。"
  },
  {
    "id": "frame-by-contested-testimony",
    "sourceId": "the-social-network-2010",
    "medium": "film",
    "tags": [
      "非线性",
      "证词",
      "结构",
      "回忆"
    ],
    "location": "PDF 23 页，切入三年后的证词室",
    "observation": "未来的法律问询重新框定过去事件，Mark 却仍纠结酒吧里的说法。",
    "useWhen": "闪回只是打乱时间、没有新的理解时",
    "method": "让现在的追问指定过去片段的争议点；回到现在时，明确观众对人物可信度或在意之事有何新判断。",
    "avoid": "把真实传记电影对白当历史逐字实录；每场无理由切时间。"
  },
  {
    "id": "escalation-with-measurable-task",
    "sourceId": "whiplash-2014",
    "medium": "film",
    "tags": [
      "节奏",
      "施压",
      "训练",
      "升级",
      "职业"
    ],
    "location": "PDF 36–38 页，乐团排练",
    "observation": "同一拍点反复被打断，称赞变为纠错再变为暴力，任务标准被掌权者控制。",
    "useWhen": "冲突升级只有声音越来越大时",
    "method": "固定一项观众能跟踪的任务，每次重复改变容错、权力或代价；升级应来自处境变化而非加重形容词。",
    "avoid": "把虐待包装成成功必需条件；在没有冲突的委托里硬加施暴。"
  },
  {
    "id": "information-used-as-leverage",
    "sourceId": "whiplash-2014",
    "medium": "film",
    "tags": [
      "人物",
      "权力",
      "反派",
      "铺垫"
    ],
    "location": "PDF 33、36–38 页，家庭询问与排练",
    "observation": "温和询问私人背景的教师，随后在同一权力关系里施压。",
    "useWhen": "反派只有标签和突然发怒时",
    "method": "先建立对方为何愿意靠近、透露信息，再展示控制者怎样改变互动规则；把魅力和危险放在同一个行为关系中。",
    "avoid": "依据片段臆造未读台词；把现实教师一概写成控制者。"
  },
  {
    "id": "institution-through-procedure",
    "sourceId": "spotlight-2015",
    "medium": "film",
    "tags": [
      "调查",
      "制度",
      "现实主义",
      "犯罪"
    ],
    "location": "PDF 2–3 页，1976 年警局段",
    "observation": "年轻警察预期的正常程序，被熟悉关系与私下安排取代。",
    "useWhen": "系统性问题被写成一个坏人发表宣言时",
    "method": "写清一个本来应发生的程序、谁有权绕过它、旁人如何配合；通过可见的小例外显示结构性力量。",
    "avoid": "虚构细节冒充报道事实；把所有参与者写成同一种恶人。"
  },
  {
    "id": "ensemble-through-work",
    "sourceId": "spotlight-2015",
    "medium": "film",
    "tags": [
      "群像",
      "职业",
      "新闻",
      "人物出场"
    ],
    "location": "PDF 5–6 页，蛋糕、电话与办公室",
    "observation": "同一份蛋糕串联同事，电话策略、办公桌和对选题的分歧区分工作方式。",
    "useWhen": "团队介绍像姓名履历轮播时",
    "method": "让角色共同处理正在发生的工作，各自采取不同手段；道具只承担能被行动验证的性格信息。",
    "avoid": "只换口头禅区分人物；以职业术语数量冒充专业。"
  },
  {
    "id": "failed-help-teaches-theme",
    "sourceId": "inside-out-2015",
    "medium": "film",
    "tags": [
      "动画",
      "安慰",
      "悲伤",
      "主题",
      "家庭"
    ],
    "location": "PDF 82–83 页，Bing Bong 失去火箭后",
    "observation": "逗笑与催促无效，承认失去并倾听后，对方才恢复行动。",
    "useWhen": "主题通过角色训话交代时",
    "method": "安排两种解决同一问题的行为，展示不同后果，让主题从角色的试错中成立。",
    "avoid": "把倾听写成秒治创伤的万能方法；所有悲伤都必须立刻转正向。"
  },
  {
    "id": "abstract-rule-visible-consequence",
    "sourceId": "inside-out-2015",
    "medium": "film",
    "tags": [
      "动画",
      "世界观",
      "抽象",
      "规则"
    ],
    "location": "PDF 10、46 页，熔岩想象与核心记忆缺失",
    "observation": "情绪系统的运行落在孩子游戏、行为变化和人物的行动目标上。",
    "useWhen": "抽象设定只有术语和设定集时",
    "method": "每引入一个抽象规则，给它一个可见行为后果与角色任务；先写人在做什么，再决定需要解释多少。",
    "avoid": "把动画隐喻当心理学结论；为每个术语另外造一个解释角色。"
  },
  {
    "id": "external-task-binds-ensemble",
    "sourceId": "little-miss-sunshine-2006",
    "medium": "film",
    "tags": [
      "群像",
      "公路",
      "喜剧",
      "合作"
    ],
    "location": "PDF 36–38 页，离合器故障与推车方案",
    "observation": "无法及时修车迫使彼此不协调的家人共同完成一个身体任务。",
    "useWhen": "群像关系靠大家坐着谈人生时",
    "method": "给不同人物一个无法单独完成的现实任务；用谁先配合、谁抗拒、谁照顾谁显出关系。",
    "avoid": "照搬危险推车乘车动作；汽车驾驶画面必须明确系安全带。"
  },
  {
    "id": "small-test-breaks-big-dream",
    "sourceId": "little-miss-sunshine-2006",
    "medium": "film",
    "tags": [
      "成长",
      "梦想",
      "转折",
      "情绪"
    ],
    "location": "PDF 72–74 页，色觉测试与路边停靠",
    "observation": "随手测试击中长期目标；其他人仍受赶路时间限制，情绪不能轻易收场。",
    "useWhen": "人生转折靠凭空宣布坏消息时",
    "method": "让一个之前看来很小的测试或事实撞上人物已投入的目标；保留周围人不同步的实际压力。",
    "avoid": "把片中职业资格台词当现行招录规定；为催泪任意给角色疾病。"
  },
  {
    "id": "choice-before-explanation",
    "sourceId": "eternal-sunshine-of-the-spotless-mind-2004",
    "medium": "film",
    "tags": [
      "开场",
      "反常行动",
      "人物",
      "爱情"
    ],
    "location": "PDF 2 页，通勤站台换乘",
    "observation": "Joel 脱离拥挤的通勤方向，来到空旷海边，却用笨拙借口向公司请假。",
    "useWhen": "开场先解释人物所有心理时",
    "method": "先写一个小而有代价的反常选择，再让人物用有限语言应付它的现实后果；疑问来自行动。",
    "avoid": "把随机举动当神秘感；拖延必要的空间和目标信息。"
  },
  {
    "id": "memory-transition-by-fragment",
    "sourceId": "eternal-sunshine-of-the-spotless-mind-2004",
    "medium": "film",
    "tags": [
      "非线性",
      "记忆",
      "转场",
      "科幻"
    ],
    "location": "PDF 28–30 页，房间变暗、影子与礼物",
    "observation": "环境细节消失，残句跨场继续，电话和礼物维持可追踪的情绪线。",
    "useWhen": "非线性片段让人分不清在乎什么时",
    "method": "用一个持续的问题、动作或物件维系情绪因果，再允许时间与空间碎裂；每次转场保留一个可认的接点。",
    "avoid": "复制原作记忆删除设定；用梦境兜底所有因果漏洞。"
  },
  {
    "id": "asymmetric-stakes",
    "sourceId": "no-country-for-old-men-2007",
    "medium": "film",
    "tags": [
      "悬疑",
      "威胁",
      "对白",
      "信息差"
    ],
    "location": "PDF 23 页，柜台前抛硬币",
    "observation": "一方知道赌注，另一方不断试图确认规则，普通问答因此成为威胁。",
    "useWhen": "威胁台词只剩“你死定了”时",
    "method": "让双方掌握的信息不对称；被威胁者尝试恢复正常交易，施压者不断重定义规则。",
    "avoid": "照搬硬币游戏；为了神秘让观众始终不知道可能失去什么。"
  },
  {
    "id": "ending-owned-by-character",
    "sourceId": "no-country-for-old-men-2007",
    "medium": "film",
    "tags": [
      "结尾",
      "余韵",
      "衰老",
      "独白"
    ],
    "location": "PDF 117 页，Bell 向妻子讲梦",
    "observation": "私人梦境围绕父亲、年龄和艰难行路展开，回答的是人物处境而非案件摘要。",
    "useWhen": "结尾强迫把主题和全部情节总结一遍时",
    "method": "区分情节收束与人物余波；若选择独白，让其来自这个人的具体记忆和未解决感受。",
    "avoid": "把晦涩等同高级；承诺解决的关键因果仍须交代。"
  },
  {
    "id": "competence-without-posturing",
    "sourceId": "fargo-1996",
    "medium": "film",
    "tags": [
      "侦探",
      "职业",
      "日常",
      "冷幽默"
    ],
    "location": "PDF 41 页，Marge 与 Lou 谈车牌",
    "observation": "专业辨认和普通笑话在同一段交谈里并存。",
    "useWhen": "专业角色每句话都端着讲道理时",
    "method": "让准确观察承担能力证明，普通闲聊保留人的生活感；不用每句都承担破案或主题宣言。",
    "avoid": "用插科打诨削弱受害者处境；把口音当低智笑点。"
  },
  {
    "id": "banality-sets-tone",
    "sourceId": "fargo-1996",
    "medium": "film",
    "tags": [
      "犯罪",
      "开场",
      "反差",
      "冷幽默"
    ],
    "location": "PDF 2–3 页，雪路、入住与餐馆",
    "observation": "阴沉雪景之后是入住确认、吃饭和看表等平凡程序。",
    "useWhen": "犯罪故事从第一秒起人人像反派时",
    "method": "让危险任务嵌在熟悉的日常服务和等待中，用人物对小事的态度建立语气反差。",
    "avoid": "照搬真实故事字幕并冒充纪实；无关生活细节拖延推进。"
  },
  {
    "id": "montage-with-changing-variable",
    "sourceId": "up-2009",
    "medium": "film",
    "tags": [
      "蒙太奇",
      "时间跨度",
      "夫妻",
      "无对白"
    ],
    "location": "PDF 13–14 页，储蓄罐与领带段",
    "observation": "同一存钱动作被生活支出打断，领带与身体状态跨越年代。",
    "useWhen": "多年人生压缩成履历或抒情旁白时",
    "method": "选择一个能重复的生活动作，每次改变时间、资源或身体条件；让观众自己比较差异。",
    "avoid": "机械罗列婚礼出生葬礼；复用原作储蓄罐和领带组合。"
  },
  {
    "id": "deferred-wish-has-cost",
    "sourceId": "up-2009",
    "medium": "film",
    "tags": [
      "遗憾",
      "梦想",
      "家庭",
      "行动"
    ],
    "location": "PDF 14 页，积灰储蓄罐、买机票与山坡",
    "observation": "梦想被搁置在日常中，重新采取行动时出现身体限制。",
    "useWhen": "遗憾只有“来不及”的口号时",
    "method": "把推迟写成一连串合理日常选择，再给最后一次行动一个真实条件；让损失落在尚未完成的具体事情上。",
    "avoid": "把衰老疾病当廉价反转；否定日常陪伴本身的价值。"
  },
  {
    "id": "premise-inside-domestic-action",
    "sourceId": "the-incredibles-2004",
    "medium": "film",
    "tags": [
      "动画",
      "超能力",
      "家庭",
      "喜剧"
    ],
    "location": "PDF 25 页，家庭晚餐",
    "observation": "父亲关心孩子跑得多快而母亲关心违规；超常力量直接损坏餐桌。",
    "useWhen": "特殊能力只用于战斗，与人物性格无关时",
    "method": "把能力带进普通家庭任务，使它放大原有欲望和分歧；笑点由角色优先级冲突产生。",
    "avoid": "只给角色贴力量标签；每一拍都用事故收尾。"
  },
  {
    "id": "transition-contradicts-rhetoric",
    "sourceId": "the-incredibles-2004",
    "medium": "film",
    "tags": [
      "转场",
      "反讽",
      "职业",
      "开场"
    ],
    "location": "PDF 17 页，公共叙述切拒赔表格",
    "observation": "宏大的社会叙述被一张遭拒的保险表格打断。",
    "useWhen": "时代交代与人物生活割裂时",
    "method": "让前段陈述在下一场具体处境中受到检验；用同一价值在制度语言和个人遭遇中的落差完成转场。",
    "avoid": "每次都用讽刺转场；把虚构保险流程当现实建议。"
  },
  {
    "id": "repeated-gesture-changes-meaning",
    "sourceId": "arrival-2016",
    "medium": "film",
    "tags": [
      "科幻",
      "母女",
      "重复",
      "蒙太奇"
    ],
    "location": "PDF 3–4 页（逐页渲染核读），母女生离死别",
    "observation": "母亲拉回新生儿的动作与后来不愿放开女儿相照应，同样的召回意愿在不同处境下改变重量。",
    "useWhen": "回环只是重复一句漂亮话时",
    "method": "让重复动作落在不同事实条件里；第二次需要改变人物能否实现愿望，而非只是加大情绪。",
    "avoid": "复制原作生死蒙太奇；从开场三页宣称验证全片时间结构。"
  },
  {
    "id": "voiceover-adds-viewpoint",
    "sourceId": "arrival-2016",
    "medium": "film",
    "tags": [
      "旁白",
      "时间",
      "主观",
      "开场"
    ],
    "location": "PDF 2–4 页（逐页渲染核读），湖屋与母女片段",
    "observation": "旁白表达对时间与记忆的不确定，画面给出具体关系时刻。",
    "useWhen": "旁白只复述画面或被一律禁用时",
    "method": "让画面负责发生了什么，旁白负责人物如何理解或误解它；删掉互相重复的信息。",
    "avoid": "所有旁白都写哲理；借抽象话遮掩场景不清。"
  },
  {
    "id": "satire-through-naive-pov",
    "sourceId": "jojo-rabbit-2019",
    "medium": "film",
    "tags": [
      "讽刺",
      "喜剧",
      "儿童",
      "战争"
    ],
    "location": "PDF 2–5 页，着装准备与训练营",
    "observation": "孩子努力装成理想战士，笨拙身体与灌输给他的宏大身份相冲突。",
    "useWhen": "讽刺变成作者站出来评论时",
    "method": "限定在角色真心相信的目标内，让实际行动暴露观念的荒谬；观众知道得比角色多。",
    "avoid": "重复宣传偏见而不揭示荒谬；把被迫害者而非权力当笑柄。"
  },
  {
    "id": "desire-in-preparation",
    "sourceId": "jojo-rabbit-2019",
    "medium": "film",
    "tags": [
      "儿童",
      "角色出场",
      "准备",
      "喜剧"
    ],
    "location": "PDF 2–3 页，镜前整理制服与练习表情",
    "observation": "角色的向往写在认真准备与做不好的小动作里。",
    "useWhen": "用“他渴望认可”代替可表演场景时",
    "method": "选一个人物认为能获得认可的准备仪式；让熟练与不熟练之处同时暴露愿望和年龄。",
    "avoid": "孩子说成人宣言；照搬制服或意识形态符号到无关故事。"
  },
  {
    "id": "perceptual-point-of-view",
    "sourceId": "coda-2021",
    "medium": "film",
    "tags": [
      "主观视点",
      "听觉",
      "家庭",
      "无障碍"
    ],
    "location": "PDF 69 页，演唱会父母视点",
    "observation": "音乐转为无声，父母需要从旁人反应理解女儿的演出。",
    "useWhen": "角色处境被解释很多却无法感受时",
    "method": "短暂限制观众能获得的感官信息，使其需要借助与角色相同的线索理解事件。",
    "avoid": "把残障只当催泪机关；一个主观段代表所有人的经验。"
  },
  {
    "id": "care-finds-own-language",
    "sourceId": "coda-2021",
    "medium": "film",
    "tags": [
      "父女",
      "沟通",
      "动作",
      "情感"
    ],
    "location": "PDF 70–71 页，演出之后父女独处",
    "observation": "公开演出的理解困难，转成父亲主动要求演唱并感受振动的私人交流。",
    "useWhen": "亲情和解只靠一句“我支持你”时",
    "method": "从前一场真实的沟通障碍出发，让人物主动寻找适合彼此的表达方式；动作是理解的尝试。",
    "avoid": "复制摸喉场面；用一次感动解决全部经济与家庭矛盾。"
  },
  {
    "id": "self-image-vs-conduct",
    "sourceId": "promising-young-woman-2020",
    "medium": "film",
    "tags": [
      "人物",
      "自我辩护",
      "伦理",
      "悬疑"
    ],
    "location": "PDF 9–11 页，公寓段",
    "observation": "男性的照顾话语与忽视对方疑问、边界的行为不一致。",
    "useWhen": "坏人必须承认自己坏才成立时",
    "method": "让角色按自己的善意叙事说话，同时把实际选择与对方反应写清，判断交给行动证据。",
    "avoid": "把不反抗当同意；用性侵风险取悦观众或美化施害者。"
  },
  {
    "id": "reversal-reveals-assumption",
    "sourceId": "promising-young-woman-2020",
    "medium": "film",
    "tags": [
      "反转",
      "悬疑",
      "信息",
      "女性"
    ],
    "location": "PDF 9–11 页，误读请求与清醒揭示",
    "observation": "人物把询问当接受、把无反应当顺从；清醒揭示令此前互动重新显形。",
    "useWhen": "反转只有意外没有主题后果时",
    "method": "先写清角色赖以行动的错误假设，再用一个明确反应推翻它；反转应重估之前选择。",
    "avoid": "把受害者必须反击作为道德要求；为惊讶隐瞒必需的信息。"
  },
  {
    "id": "separate-fact-and-interpretation",
    "sourceId": "anatomy-of-a-fall-2023",
    "medium": "film",
    "tags": [
      "法庭",
      "证据",
      "调查",
      "不可靠叙述"
    ],
    "location": "PDF 12–13 页，与律师复述音乐和午睡",
    "observation": "律师要求区分实际陈述与当事人对放音乐动机的解释。",
    "useWhen": "悬疑里人物猜测自动变成作者事实时",
    "method": "分别标记可观察事件、人物解释与尚未证实部分；让追问落在三者的差距上。",
    "avoid": "把歧义当任意改事实；虚构法庭流程冒充法律知识。"
  },
  {
    "id": "ordinary-detail-as-contested-evidence",
    "sourceId": "anatomy-of-a-fall-2023",
    "medium": "film",
    "tags": [
      "家庭",
      "证词",
      "歧义",
      "声音"
    ],
    "location": "PDF 12–13 页，耳塞、音乐、工作与时间复述",
    "observation": "日常生活细节在问询语境里成为需要精确说明的材料。",
    "useWhen": "案件线与关系线像两个故事时",
    "method": "挑选对关系有意义又能被不同人解释的日常细节，让同一材料同时承担情感和证据功能。",
    "avoid": "每件家居物品都设置谜底；用未读后续情节证明当前推断。"
  },
  {
    "id": "parallel-protective-lies",
    "sourceId": "the-farewell-2019",
    "medium": "film",
    "tags": [
      "华人",
      "家庭",
      "关心",
      "谎言",
      "对白"
    ],
    "location": "PDF 3–5 页，祖孙电话",
    "observation": "祖母隐瞒医院位置，孙女隐瞒穿戴与路上打断，各自想让对方少担心。",
    "useWhen": "家庭冲突只剩正确者教育错误者时",
    "method": "让两边都有可理解的保护动机，但具体隐瞒不同；用观众看到而电话对方看不到的事实制造张力。",
    "avoid": "把一种家庭习惯推广为整个民族；照搬英文稿句法当中文口语。"
  },
  {
    "id": "social-ritual-double-meaning",
    "sourceId": "the-farewell-2019",
    "medium": "film",
    "tags": [
      "家庭",
      "宴席",
      "潜台词",
      "华语"
    ],
    "location": "PDF 46 页，婚宴愿望接家庭聚餐",
    "observation": "长辈对未来婚宴的期待落到 Billi 的反应，随后热闹聚餐延续团圆表层。",
    "useWhen": "潜台词只靠写“欲言又止”时",
    "method": "给每个人都能参与的礼仪一个表面意义，同时明确知情者额外听见了什么；让反应长短承担第二层。",
    "avoid": "全桌同时说金句；依靠画外解释每个表情。"
  },
  {
    "id": "metaphysical-idea-manual-task",
    "sourceId": "nine-days-2020",
    "medium": "film",
    "tags": [
      "奇幻",
      "哲思",
      "低成本",
      "场景"
    ],
    "location": "PDF 46、49–50 页，最后愿望与搭建",
    "observation": "对生命体验的抽象讨论落实为挑选片段、搬木料、打磨和搭建设施。",
    "useWhen": "哲思剧本只有概念对谈时",
    "method": "把大问题化为人物能亲手完成却不轻松的服务或任务，细节来自材料、时间与协作。",
    "avoid": "复制灵魂面试设定；把低成本误解为只能室内对谈。"
  },
  {
    "id": "participation-reveals-values",
    "sourceId": "nine-days-2020",
    "medium": "film",
    "tags": [
      "群像",
      "价值观",
      "行动",
      "人物"
    ],
    "location": "PDF 49–50 页，Emma 主动帮忙打磨",
    "observation": "在不增加作业时间的条件下，Emma 仍选择帮忙，能力与态度通过劳动显现。",
    "useWhen": "角色价值观都由自我介绍说出时",
    "method": "给一个没有奖励甚至有成本的参与机会，观察人物做什么、怎样做；让评价者的反应同步变化。",
    "avoid": "每个善举都立刻兑换回报；把劳动技能当万能人格证明。"
  },
  {
    "id": "rhythm-enacts-value",
    "sourceId": "guinness-surfer",
    "medium": "ad",
    "tags": [
      "旁白",
      "诗性",
      "等待",
      "节奏",
      "品牌片"
    ],
    "location": "旁白首尾等待语义与中间钟摆拟声",
    "observation": "文本把等待做成可听见的节奏，结尾再次回到同一价值。",
    "useWhen": "诗性广告只有华丽形容词时",
    "method": "选择一个与品牌体验相连的时间感，用句长、停顿和重复使语言亲自呈现它。",
    "avoid": "照抄海洋与文学意象；不是所有产品都适合把等待美化。"
  },
  {
    "id": "incomplete-line-invites-recognition",
    "sourceId": "guinness-surfer",
    "medium": "ad",
    "tags": [
      "结句",
      "留白",
      "品牌",
      "记忆"
    ],
    "location": "结尾 SUPER 的未完句",
    "observation": "结尾使用未完成的熟悉表达，让受众自行补足。",
    "useWhen": "收尾重复解释前文已明白的意思时",
    "method": "仅当受众确实熟悉且语境唯一时，允许一句停在能被补出的地方；先测试不熟悉者会否误解。",
    "avoid": "把省略号当高级文案；陌生卖点或关键交易信息不能省。"
  },
  {
    "id": "ending-names-experience",
    "sourceId": "honda-cog",
    "medium": "ad",
    "tags": [
      "产品",
      "演示",
      "结句",
      "汽车",
      "减法"
    ],
    "location": "回顾文章所引结尾提问",
    "observation": "结尾用日常提问概括顺畅运转的感受，没有再列一遍参数。",
    "useWhen": "产品演示已经充分，文案仍重复讲解时",
    "method": "在证据清楚后，收尾只命名用户得到的体验；先确认演示真实可实现，不能用文案弥补虚构性能。",
    "avoid": "根据一句旁白声称逐镜读过原稿；沿用原片连锁装置创意。"
  },
  {
    "id": "refrain-adds-new-agency",
    "sourceId": "nike-stop",
    "medium": "ad",
    "tags": [
      "品牌宣言",
      "排比",
      "体育",
      "集体",
      "口播"
    ],
    "location": "全文旁白条件句序列",
    "observation": "遭遇质疑、限制和不公分别接不同的集体行动，重复并非同义词轮换。",
    "useWhen": "品牌宣言排比很多但没有新内容时",
    "method": "每个重复句式加入一种不同障碍和应对，最后汇成一个清楚主张；删去只增加气势的同义句。",
    "avoid": "假造品牌参与社会行动的证据；把抽象团结塞给所有产品。"
  },
  {
    "id": "claim-and-form-share-logic",
    "sourceId": "nike-stop",
    "medium": "ad",
    "tags": [
      "品牌片",
      "形式",
      "群像",
      "统一"
    ],
    "location": "旁白结句及文章所述分屏连接形式",
    "observation": "共同完成的文字主张与连接不同运动主体的形式方向一致。",
    "useWhen": "视觉很炫却与品牌主张无关时",
    "method": "先用一句话确认核心关系，再让形式反复展示同一种关系；不要同时堆互相竞争的视觉概念。",
    "avoid": "直接复制标志性分屏；未核对素材权利就许诺使用真实运动员。"
  },
  {
    "id": "reclaim-label-with-evidence",
    "sourceId": "nike-crazier",
    "medium": "ad",
    "tags": [
      "女性",
      "品牌宣言",
      "偏见",
      "体育"
    ],
    "location": "教学页 Dream Crazier 旁白段",
    "observation": "前半列外界标签，后半将同一标签与具体运动成就重新对应。",
    "useWhen": "宣言只把负面词翻成正面词时",
    "method": "用已核实的人和行动改变一个词的意义；转折前后保持同一语义轴，而非突然换主题。",
    "avoid": "杜撰受众歧视经历或运动成绩；借弱势议题为无关品牌贴金。"
  },
  {
    "id": "same-question-reveals-assumption",
    "sourceId": "always-like-girl",
    "medium": "ad",
    "tags": [
      "公益",
      "采访",
      "女性",
      "洞察",
      "纪录"
    ],
    "location": "导演询问跑步、受访者解释及再次尝试段",
    "observation": "同一个行动要求得到不同理解，再邀请重新尝试使变化可见。",
    "useWhen": "社会洞察广告先给观点再找人附和时",
    "method": "设计具体、可回答的同一问题，保留不同理解；让第二次行动检验观点是否改变。",
    "avoid": "预写真人回答冒充纪录；把小样本广告呈现当科学实验。"
  },
  {
    "id": "audience-keeps-own-voice",
    "sourceId": "always-like-girl",
    "medium": "ad",
    "tags": [
      "采访",
      "真实",
      "口语",
      "受众"
    ],
    "location": "受访者纠正、犹豫与愿意重做的回答段",
    "observation": "回答保留修正和自我确认，没有把所有人整理成统一口号。",
    "useWhen": "真人采访整理得像公关声明时",
    "method": "只删妨碍理解的赘余，保留改变立场的停顿和自我修正；文案作者不替受访者制造更漂亮的结论。",
    "avoid": "机械添加口吃来装真实；删除限定语改变原意。"
  },
  {
    "id": "child-scale-observation",
    "sourceId": "unionpay-poetry",
    "medium": "ad",
    "tags": [
      "中文",
      "儿童",
      "公益",
      "生活细节"
    ],
    "location": "项目页《小狗》《长大》诗作节选",
    "observation": "亲人缺席通过儿童能观察的生活关系呈现，而非宏大议论。",
    "useWhen": "儿童视角说出成年人替他总结的人生道理时",
    "method": "限定在孩子实际看见、误解或努力做到的事情，让读者自己接上成人处境；尊重说话者年龄和知识边界。",
    "avoid": "复制儿童诗句或编造真实儿童证言；用贫困作审美布景。"
  },
  {
    "id": "participation-is-brand-action",
    "sourceId": "unionpay-poetry",
    "medium": "ad",
    "tags": [
      "公益",
      "服务",
      "品牌行为",
      "中文"
    ],
    "location": "项目页参与说明与 POS 小票展示文案",
    "observation": "支付行为和收到诗作连接，使品牌服务参与表达而非结尾贴标。",
    "useWhen": "公益广告只能煽情后放品牌 logo 时",
    "method": "明确观众做什么、作品怎样到他手里、品牌实际提供哪一步服务；让情感有可理解的参与路径。",
    "avoid": "将 2019 活动的一元规则写成当前权益；未核实就宣称捐款去向或效果。"
  }
];
