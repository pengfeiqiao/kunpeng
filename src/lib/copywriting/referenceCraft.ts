import { readWorkspaceMessage } from '../agent/workspaceMessage.ts';
import { EXTENDED_CRAFT_SOURCES, EXTENDED_CRAFT_LESSONS } from "./referenceCraftCorpus.ts";
import { MAINLAND_CRAFT_SOURCES, MAINLAND_CRAFT_LESSONS } from "./referenceCraftMainland.ts";

/** Curated textual evidence, not user preferences or model-training data.
 * Research scope/version: docs/reviews/screenplay-text-craft-2026-10-03.md.
 * Store original analysis only; never bundle copyrighted screenplays. */
export interface CraftSource {
  id: string;
  title: string;
  authors: string;
  textKind: 'screenplay' | 'screenplay-draft' | 'ad-transcript' | 'brand-copy-excerpt' | 'author-craft-essay' | 'author-outline' | 'author-interview';
  edition: string;
  textUrl: string;
  award: string;
  awardUrl: string;
  checkedAt: string;
  /** Curatorial subset, not a nationality inferred from language or title. */
  collection?: 'mainland-film';
  verificationUrl?: string;
  pdfPages?: number;
  sha256?: string;
}
export const CRAFT_SOURCES: readonly CraftSource[] = [
  { id:'eeaao', title:'瞬息全宇宙', authors:'Daniel Kwan / Daniel Scheinert', textKind:'screenplay', edition:'英文拍摄剧本，126 页 PDF；部分对白含中文；Script Slug 镜像，非 A24 当前官网', textUrl:'https://assets.scriptslug.com/live/pdf/scripts/everything-everywhere-all-at-once-2022.pdf', award:'2023 奥斯卡最佳原创剧本', awardUrl:'https://www.oscars.org/oscars/ceremonies/2023', checkedAt:'2026-10-03' },
  { id:'parasite', title:'寄生虫', authors:'Bong Joon Ho / Han Jin Won', textKind:'screenplay', edition:'英文 FYC 剧本，144 页 PDF；不是韩文原稿；Script Slug 镜像', textUrl:'https://assets.scriptslug.com/live/pdf/scripts/parasite-2019.pdf', award:'2019 戛纳金棕榈（影片奖）', awardUrl:'https://www.festival-cannes.com/en/press/press-releases/parasite-the-2019-palme-d-or-winner-triumphs-at-the-oscars-2020/', checkedAt:'2026-10-03' },
  { id:'crouching-tiger', title:'卧虎藏龙', authors:'王蕙玲 / James Schamus / 蔡国荣；改编自王度庐小说', textKind:'screenplay-draft', edition:'IMSDb 英文未注明日期稿；不当作中文定稿或逐字成片对白', textUrl:'https://imsdb.com/scripts/Crouching-Tiger,-Hidden-Dragon.html', award:'2000 金马最佳剧情片、2000 多伦多影展观众票选奖（影片奖，非编剧奖）', awardUrl:'https://www.goldenhorse.org.tw/film/programme/films/detail/3894?search_category=FF&search_year=2024', checkedAt:'2026-10-03' },
  { id:'epic-split', title:'Volvo Trucks — The Epic Split', authors:'Forsman & Bodenfors（代理商）', textKind:'ad-transcript', edition:'Velocity Partners 文章转录成片旁白及片尾字幕；不是拍摄原稿；仅分析所引文本', textUrl:'https://velocitypartners.com/blog/lets-steal-from-epic-split/', award:'2014 D&AD Black Pencil / Yellow Pencil', awardUrl:'https://www.dandad.org/work/d-ad-awards-archive/the-epic-split', checkedAt:'2026-10-03' },
  { id:'tang-transfer', title:'大唐漠北的最后一次转账', authors:'中国银联 / 胜加 SG', textKind:'brand-copy-excerpt', edition:'品牌官网发布的宣传文案片段与结句；不是完整影片剧本。获奖名单 PDF 由数英托管', textUrl:'https://www.cup.com.cn/upowhtml/cn/templates/brandActivities/brandActivities.html', award:'2019 One Show Greater China：Copywriting/Scriptwriting Silver；Online Film & Video Gold；Best of Show', awardUrl:'https://file.digitaling.com/eImg/uimages/20191203/1575364127912882.pdf', checkedAt:'2026-10-03' },
  { id:'old-spice', title:'Old Spice — The Man Your Man Could Smell Like', authors:'Wieden+Kennedy Portland（代理商）', textKind:'ad-transcript', edition:'Wizard of Ads 访谈所引成片独白转录，非拍摄原稿；奖项出处为 D&AD 系列案例页', textUrl:'https://wizardofads.org/how-old-spice-saved-their-brand/', award:'D&AD 官方系列案例页记载 2011 Yellow Pencil / Writing for Film Advertising；不将系列奖细化成未核实的单片奖', awardUrl:'https://www.dandad.org/insights/awards/old-spice-case-study-insights', checkedAt:'2026-10-03' },
  ...EXTENDED_CRAFT_SOURCES,
  ...MAINLAND_CRAFT_SOURCES,
];
export interface CraftLesson {
  id: string;
  sourceId: string;
  medium: 'film' | 'ad';
  tags: readonly string[];
  location: string;
  observation: string;
  useWhen: string;
  method: string;
  avoid: string;
}
export const CRAFT_LESSONS: readonly CraftLesson[] = [
  { id:'material-pressure', sourceId:'parasite', medium:'film', tags:['现实','生活','开场','处境'], location:'PDF 第 3–6 页，半地下室开场（正文页码与 PDF 页码不同）', observation:'寻找网络、折纸盒和是否关窗的选择，让生计压力进入身体动作与家人争执。', useWhen:'需要交代生活处境而开场像人物简介时', method:'选择人物今天必须完成的小事，让空间、物件和资源限制实际阻碍它；人物怎样应对同时暴露性格与关系。', avoid:'为显真实随意添加穷困、脏乱细节，或照搬原片的生活道具。' },
  { id:'dialogue-probe', sourceId:'crouching-tiger', medium:'film', tags:['对白','台词','试探','潜台词','武侠'], location:'INT. BO’S ROOM - DAY，玉娇龙练字、俞秀莲来访段', observation:'谈书法转向剑术，短暂迟疑和否认使礼貌交谈成为试探。', useWhen:'人物有所隐瞒，台词却把真实意图全说出时', method:'给交谈一个双方愿意维持的表面活动；一方用可观察线索试探，另一方用动作或话题应对，下一句根据反应推进。', avoid:'所有人都说谜语；英文译稿只借鉴动作逻辑，不照搬译腔当中文人物声音。' },
  { id:'earned-declaration', sourceId:'eeaao', medium:'film', tags:['情感','关系','结尾','告白','家庭'], location:'PDF 第 104–106 页，场 97–103（正文 103–105 页）', observation:'韦蒙的劝阻、扫碎玻璃与另一个人生里的日常愿望相互呼应；情感转变随后落实为放下拳头、拥抱。', useWhen:'高潮只剩主题宣言或抽象告白时', method:'让前文具体生活重新获得意义；重要直说前有行动依据，后有选择变化。主题句可以保留，不必一律删掉。', avoid:'每次都和解升华，或把原作日常物件和名台词移植进新稿。' },
  { id:'quiet-contrast', sourceId:'eeaao', medium:'film', tags:['节奏','留白','科幻','奇幻','静场'], location:'PDF 第 100–101 页，场 94 ROCK UNIVERSE（正文 99–100 页）', observation:'高密度变化后切入静止石头与安静环境，用明显减法改变观看节奏。', useWhen:'奇观或冲突连续堆叠、观众没有感受时间时', method:'在关系需要被感知的位置降低事件密度，保留一个清楚的关系问题；停顿长短服务表演与前后反差。', avoid:'把慢、空镜或石头意象当作电影感配方；普通说明文不套静场。' },
  { id:'product-proof', sourceId:'epic-split', medium:'ad', tags:['产品','卖点','汽车','演示','TVC','tvc'], location:'文章 Write simple 段旁白及片尾测试说明', observation:'旁白建立身体控制的预期，片尾文字才把测试明确归因于转向技术。', useWhen:'技术卖点抽象、广告只有形容词时', method:'选一个观众能理解的可见结果证明一个已核实卖点；旁白负责设置期待，画面负责兑现，品牌与证据之间有明确因果。', avoid:'照搬危险特技或虚构产品性能；AI 模拟画面不得宣称真实测试，驾驶画面仍须系安全带。' },
  { id:'brand-specific-ending', sourceId:'tang-transfer', medium:'ad', tags:['中文','中国','品牌片','历史','使命','结句'], location:'中国银联品牌活动页「大唐漠北的最后一次转账」两段正文与承诺结句', observation:'官网文本把具体的钱与使命相连，再对应支付品牌的服务承诺；这里只分析这段品牌文字，不推断完整剧作。', useWhen:'中文品牌片结尾像任何公司都能套用的励志口号时', method:'把结句落回本品牌具体服务对象、行为和承诺；抽象价值需要一个专属名词与可理解的行动支撑，不能换掉品牌仍原封不动成立。', avoid:'把历史虚构当史实；沿用旧活动价格或权益当现行承诺；根据宣传文案编造原剧本场次。' },
  { id:'address-and-payoff', sourceId:'old-spice', medium:'ad', tags:['幽默','喜剧','口播','节奏','受众','品牌'], location:'访谈中 Isaiah Mustafa 成片独白引用段', observation:'反复指令观众转移注意，后续每次转移给出新信息；气味主张贯穿其中。', useWhen:'喜剧广告或口播的排比只是换词、没有信息增加时', method:'先明确在对谁说话和为何听；用稳定语言动作建立期待，再用不同视觉结果兑现。重复可形成角色声音，但每一拍要增加内容。', avoid:'把夸张当功效承诺、复制原片转场，或把该片性别预设推广为所有品牌的受众洞察。' },
  ...EXTENDED_CRAFT_LESSONS,
  ...MAINLAND_CRAFT_LESSONS,
];

/** Small shared policy for every provider and creative surface. No network or learning writes. */
export const REFERENCE_CRAFT_HARNESS = `### 文本案例提炼（仅在电影、剧情与广告创作时使用）
这是对指定文本片段和主创创作谈的编辑性提炼，不是获奖公式、用户偏好或模型训练。当前委托和用户确认的声线优先；本轮附带案例时只选适用的一两种方法，不把所有方法塞进每稿。
电影感来自可表演的行动、信息分配和关系后果，不靠镜头术语或形容词密度。先判断人物当下要什么、为什么这样做、付出什么，再修改结构和句子。中国生活题材从具体关系、职业与处境出发，不把苦难、饭局、乡音当本土感模板。方言先顾人物身份、说话对象和当下目的，再校正词汇；允许直说、重复、旁白、风格化和不圆满结局。
广告先判断销售、品牌表达或公益目的；卖点须有证据，品牌结句回到具体服务行为。不强制反转、煽情、三秒钩子或每片购买号召。写后检查因果、人物声音、时空和信息是否连续，删空泛判断，不机械删修辞。
案例只学机制，不复制人物、情节、标志性道具或句子；英文稿不照搬译腔。区分剧本稿、成片转录、品牌片段、作者大纲和主创访谈；不声称读过全文，不把主创解释当剧本原句。公开方法与本用户经验分开，只有用户反馈才可支持用户偏好。生图视频提示词、代码与事实问答不套此流程。`;

const SOURCE_BY_ID = new Map(CRAFT_SOURCES.map(source => [source.id, source]));
export const REFERENCE_CRAFT_CONTEXT_LIMIT = 2400;

export function selectReferenceLessons(task: string): readonly CraftLesson[] {
  const signal = task.toLowerCase();
  if (/修复.*(?:编辑器|接口|代码|\bbug\b)|(?:接口|编译).*?(?:报错|失败)/.test(signal)) return [];
  const writing = /剧本|对白|台词|故事|编剧|短片脚本|screenplay|dialogue|文案|口播/.test(signal);
  if (/提示词|prompt|生图|视频生成|typescript|\bbug\b|代码|接口|编译/.test(signal) && !writing) return [];
  const ad = /广告|品牌|卖点|商业片|\btvc\b|campaign|commercial|advert/.test(signal);
  // A one-character title such as 她 must not match ordinary pronouns.
  const named = new Set(CRAFT_SOURCES.filter(source => {
    const title = source.title.toLowerCase();
    return title.length >= 3 ? signal.includes(title) : signal.includes(`《${title}》`) || signal.trim() === title;
  }).map(source => source.id));
  const film = /剧本|对白|台词|电影|故事|短剧|短片|编剧|screenplay|dialogue|screenwriting/.test(signal);
  if (!ad && !film && !named.size) return [];
  const mainland = /大陆|内地|国产|本土|中国|国内|中文|华语|方言|市井|乡土|沪语|藏地|东北/.test(signal);
  const namedAd = CRAFT_LESSONS.some(lesson => named.has(lesson.sourceId) && lesson.medium === 'ad');
  const namedFilm = CRAFT_LESSONS.some(lesson => named.has(lesson.sourceId) && lesson.medium === 'film');
  const candidates = CRAFT_LESSONS.filter(lesson => lesson.medium === (ad || (namedAd && !namedFilm) ? 'ad' : 'film'));
  // Explicit titles focus on the named works; generic requests diversify sources.
  const namedCandidates = candidates.filter(lesson => named.has(lesson.sourceId));
  const ranked = (namedCandidates.length ? namedCandidates : candidates)
    .map((lesson, index) => {
      const tagScore = lesson.tags.filter(tag => signal.includes(tag.toLowerCase())).length * 2;
      return { lesson, index, tagScore, score: tagScore
        + (mainland && SOURCE_BY_ID.get(lesson.sourceId)?.collection === 'mainland-film' ? 8 : 0) };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const selected: CraftLesson[] = [];
  const usedSources = new Set<string>();
  const matches = ranked.filter(candidate => candidate.tagScore > 0);
  const regionalMatches = mainland ? matches.filter(candidate => SOURCE_BY_ID.get(candidate.lesson.sourceId)?.collection === 'mainland-film') : [];
  const relevant = regionalMatches.length ? regionalMatches : matches.length ? matches : ranked;
  for (const { lesson } of relevant) {
    if (!namedCandidates.length && usedSources.has(lesson.sourceId)) continue;
    selected.push(lesson);
    usedSources.add(lesson.sourceId);
    if (selected.length === 3) break;
  }
  return selected;
}

export function buildReferenceCraftContext(task: string): string {
  const lessons = selectReferenceLessons(task);
  if (!lessons.length) return '';
  const header = '## 本次可参考的真实文本证据\n以下是编辑性提炼，不是本项目事实或用户认可的经验。按适用条件参考；screenplay-draft 为版本有限的剧本稿，ad-transcript 为成片转录，brand-copy-excerpt 为品牌片段，author-outline 为作者大纲，author-craft-essay/author-interview 为创作谈而非剧本。不要冒称读过完整作品或获得作者认证，成稿不附方法讲解。\n';
  const records: object[] = [];
  for (const lesson of lessons) {
    const source = SOURCE_BY_ID.get(lesson.sourceId)!;
    const record = { sourceId:source.id, title:source.title, textKind:source.textKind, edition:source.edition,
      textUrl:source.textUrl, ...(source.verificationUrl ? { verificationUrl: source.verificationUrl } : {}),
      location:lesson.location, observation:lesson.observation, useWhen:lesson.useWhen, method:lesson.method, avoid:lesson.avoid };
    // Drop whole records, never truncate JSON or remove provenance to fit the budget.
    if (header.length + JSON.stringify([...records, record]).length < REFERENCE_CRAFT_CONTEXT_LIMIT) records.push(record);
  }
  return records.length ? header + JSON.stringify(records) : '';
}

/** Workspace metadata and embedded writing policies are not the user's genre request. */
export function buildReferenceCraftTurnContext(message: string): string {
  const envelope = readWorkspaceMessage(message);
  if (envelope.status === 'invalid') return '';
  const request = envelope.status === 'valid' ? envelope.request : message;
  // The copywriting panel/guide already embeds the same bounded packet.
  if (request.startsWith('[用户正在鲲鹏文案工作室]') || request.includes('## 本次可参考的真实文本证据\n')) return '';
  return buildReferenceCraftContext(request);
}
