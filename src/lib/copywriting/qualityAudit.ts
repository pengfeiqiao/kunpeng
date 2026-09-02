export type WritingKind = 'screenplay' | 'spoken' | 'commercial' | 'general';

export type WritingIssueSeverity = 'blocker' | 'warning' | 'note';

export interface WritingQualityIssue {
  ruleId: string;
  label: string;
  severity: WritingIssueSeverity;
  count: number;
  excerpts: string[];
  suggestion: string;
}

export interface WritingQualityAudit {
  score: number;
  grade: 'clean' | 'review' | 'rewrite';
  kind: WritingKind;
  charCount: number;
  sentenceCount: number;
  blockerCount: number;
  warningCount: number;
  issues: WritingQualityIssue[];
  summary: string;
}

interface AuditOptions {
  kind?: WritingKind;
}

const CONNECTIVES = [
  '首先', '其次', '再次', '最后', '此外', '同时', '与此同时', '然而', '因此', '所以',
  '总之', '总的来说', '换句话说', '值得注意的是', '不可否认', '从某种意义上说',
  '事实上', '也就是说', '归根结底', '正因如此', '更重要的是',
];

const GENERIC_PHRASES = [
  '真正的', '这背后', '重新定义', '不难发现', '毋庸置疑', '显而易见', '值得一提的是',
  '在这个时代', '在当下', '某种意义上', '高质量', '沉浸式', '赋能', '闭环', '打造',
  '助力', '引领', '革新', '焕新', '价值感', '松弛感',
  // 模型惯用的提示语与洞察路标（human-writing skill 禁用项，MIT © KKKKhazix）
  '说白了', '说穿了', '先说结论', '一句话总结', '更微妙的是', '还有一层', '只说对了一半',
];

const METAPHOR_WORDS = [
  '种子', '土壤', '花园', '桥梁', '钥匙', '灯塔', '浪潮', '引擎', '底色', '入口',
  '答案', '齿轮', '拼图', '火花', '航标', '容器', '镜子', '回声', '坐标',
];

function stripMarkdown(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+] |\d+[.)] )/gm, '')
    .replace(/[~*_`]/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?；;])|\n+/)
    .map((sentence) => sentence.trim().replace(/^\|+|\|+$/g, '').trim())
    .filter((sentence) => sentence.length >= 4 && !/^[\d\s:：|.-]+$/.test(sentence));
}

function compactExcerpt(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 54 ? `${normalized.slice(0, 51)}...` : normalized;
}

function uniqueExcerpts(values: string[]): string[] {
  return [...new Set(values.map(compactExcerpt).filter(Boolean))].slice(0, 3);
}

function countLiteral(text: string, phrase: string): number {
  if (!phrase) return 0;
  return text.split(phrase).length - 1;
}

function collectRegex(text: string, regex: RegExp): string[] {
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
  return Array.from(text.matchAll(new RegExp(regex.source, flags))).map((match) => match[0]);
}

function detectWritingKind(content: string, text: string): WritingKind {
  if (
    /(?:^|\n)\s*(?:INT\.|EXT\.|内景|外景|第\s*\d+\s*场|场景\s*\d+)/im.test(content)
    || /\|\s*(?:镜号|画面|景别|运镜)\s*\|/.test(content)
  ) return 'screenplay';
  if (/\|\s*(?:口播|旁白|VO|台词)\s*\|/i.test(content) || /(?:口播|旁白|VO)[:：]/i.test(text)) return 'spoken';
  if (/(?:品牌|产品|卖点|购买|转化|种草|广告|TVC|campaign)/i.test(text)) return 'commercial';
  return 'general';
}

function issue(
  ruleId: string,
  label: string,
  severity: WritingIssueSeverity,
  matches: string[],
  suggestion: string,
): WritingQualityIssue {
  return {
    ruleId,
    label,
    severity,
    count: matches.length,
    excerpts: uniqueExcerpts(matches),
    suggestion,
  };
}

export function auditCopywriting(content: string, options: AuditOptions = {}): WritingQualityAudit {
  const text = stripMarkdown(content);
  const sentences = splitSentences(text);
  const kind = options.kind ?? detectWritingKind(content, text);
  const issues: WritingQualityIssue[] = [];

  const repeatedDash = collectRegex(text, /—{2,}|-{3,}/g);
  const singleDash = collectRegex(text, /—/g);
  const allowedDash = Math.max(1, Math.ceil(text.length / 400));
  if (repeatedDash.length > 0) {
    issues.push(issue(
      'punctuation.long-dash-chain',
      '连续长破折号',
      'blocker',
      repeatedDash,
      '删除装饰性破折号。需要停顿就断句，需要解释就直接写清动作或因果。',
    ));
  } else if (singleDash.length > allowedDash) {
    issues.push(issue(
      'punctuation.em-dash-density',
      '破折号过密',
      'warning',
      singleDash,
      `全文保留不超过 ${allowedDash} 个真正承担语义的破折号，其余改成句号、逗号或直接删掉。`,
    ));
  }

  // 翻案腔家族（吸收 human-writing skill 的"禁修辞动作而非字面"原则，MIT © KKKKhazix）：
  // 命中一项即 blocker——先立一个读者并没有的误解再推翻它来抬价，换任何字面都算命中。
  const reversalMatches = [
    ...collectRegex(text, /不是[^。！？\n]{0,42}(?:而是|只是|却是)[^。！？\n]{0,42}/g),
    ...collectRegex(text, /并非[^。！？\n]{0,42}而是[^。！？\n]{0,42}/g),
    ...collectRegex(text, /不(?:只|仅)是[^。！？\n]{0,42}(?:更是|还是)[^。！？\n]{0,42}/g),
    // 不是A，是B（没有"而"字的直转）
    ...collectRegex(text, /不是[^。！？\n，,]{1,40}[，,]\s*是[^。！？\n]{0,42}/g),
    ...collectRegex(text, /不在于[^。！？\n]{0,42}而在于[^。！？\n]{0,42}/g),
    ...collectRegex(text, /与其说[^。！？\n]{0,42}不如说[^。！？\n]{0,42}/g),
    ...collectRegex(text, /表面(?:上)?[^。！？\n]{0,42}实际(?:上)?[^。！？\n]{0,42}/g),
    ...collectRegex(text, /看似[^。！？\n]{0,42}实则[^。！？\n]{0,42}/g),
    ...collectRegex(text, /你以为[^。！？\n]{0,42}其实[^。！？\n]{0,42}/g),
    ...collectRegex(text, /[^。！？\n]{0,42}不重要[^。！？\n]{0,12}重要的是[^。！？\n]{0,42}/g),
    ...collectRegex(text, /答案恰恰相反|回头才发现|说到底[^。！？\n]{0,42}/g),
  ];
  if (reversalMatches.length >= 1) {
    issues.push(issue(
      'syntax.forced-contrast',
      '翻案腔（不是…而是…同类话术）',
      'blocker',
      reversalMatches,
      '先立再推翻的抬价句式零容忍：不是A而是B、不是A，是B、并非…而是、不在于…而在于、表面…实际、看似…实则、你以为…其实、X不重要重要的是Y、说到底、答案恰恰相反，换字面也算。判断直接从正面下，先给判断再给依据；只有真的用材料走过了从误解到修正的过程才允许自我修正，且不套用以上任何句式。',
    ));
  }

  const breakBuildMatches = collectRegex(
    text,
    /(?:打破|破局|破除|破题|先破)[^。！？\n]{0,30}(?:建立|重建|重塑|立住|再立|后立)/g,
  );
  if (breakBuildMatches.length >= 1) {
    issues.push(issue(
      'syntax.break-and-build',
      '“破与立”套话',
      breakBuildMatches.length >= 2 ? 'warning' : 'note',
      breakBuildMatches,
      '说明究竟改变了什么，以及改变前后的可观察差异，不用“破局、重塑、立住”代替内容。',
    ));
  }

  const templatePatterns = [
    /从[^。！？\n]{1,24}到[^。！？\n]{1,24}/g,
    /当[^。！？\n]{1,24}时[^。！？\n]{1,32}/g,
    /只有[^。！？\n]{1,24}才[^。！？\n]{1,32}/g,
    /有人说[^。！？\n]{1,40}(?:但|可|其实)[^。！？\n]{1,40}/g,
  ];
  const templateMatches = templatePatterns.flatMap((pattern) => collectRegex(text, pattern));
  if (templateMatches.length >= 3) {
    issues.push(issue(
      'syntax.template-density',
      '模板句式过密',
      'warning',
      templateMatches,
      '打散句法。交替使用动作句、判断句、具体细节和短句，不要让段落都按同一副骨架展开。',
    ));
  }

  const connectorHits = CONNECTIVES.flatMap((word) => Array.from({ length: countLiteral(text, word) }, () => word));
  const repeatedConnectors = CONNECTIVES.filter((word) => countLiteral(text, word) >= 2);
  const connectorLimit = Math.max(3, Math.ceil(sentences.length * 0.28));
  if (connectorHits.length > connectorLimit || repeatedConnectors.length >= 2) {
    issues.push(issue(
      'logic.connector-dependence',
      '连接词依赖',
      'warning',
      repeatedConnectors.length > 0 ? repeatedConnectors : connectorHits,
      '让事实顺序、动作结果和段落位置承担逻辑。删除“首先、其次、然而、因此”等路标后，仍应能看懂推进关系。',
    ));
  }

  const openings = new Map<string, string[]>();
  for (const sentence of sentences) {
    const normalized = sentence
      .replace(/^[“”「」『』'"\s]+/, '')
      .replace(/^(?:但是|所以|因此|然而|同时|其实|如果|当|而|我认为|我们)/, '')
      .replace(/[，。！？、：；\s]/g, '');
    if (normalized.length < 6) continue;
    const opening = normalized.slice(0, 4);
    const values = openings.get(opening) ?? [];
    values.push(sentence);
    openings.set(opening, values);
  }
  const repeatedOpenings = [...openings.values()].filter((values) => values.length >= 3).flat();
  if (repeatedOpenings.length >= 3) {
    issues.push(issue(
      'rhythm.repeated-openings',
      '句首重复',
      'warning',
      repeatedOpenings,
      '保留最有力的一句，其余从人物动作、现场细节或结论切入，避免连续同起手。',
    ));
  }

  if (sentences.length >= 8) {
    const lengths = sentences.map((sentence) => sentence.replace(/\s/g, '').length);
    const mean = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
    const variance = lengths.reduce((sum, value) => sum + (value - mean) ** 2, 0) / lengths.length;
    const variation = mean > 0 ? Math.sqrt(variance) / mean : 1;
    if (variation < 0.2) {
      issues.push(issue(
        'rhythm.uniform-sentences',
        '句长过于整齐',
        'note',
        sentences.slice(0, 3),
        '按内容需要改变呼吸：关键判断用短句，复杂动作或观察允许长句。不要为了整齐把每句修成相同长度。',
      ));
    }
  }

  const metaphorRepeats = METAPHOR_WORDS
    .map((word) => ({ word, count: countLiteral(text, word) }))
    .filter(({ count }) => count >= 3);
  if (metaphorRepeats.length > 0) {
    issues.push(issue(
      'imagery.repeated-metaphor',
      '意象重复',
      'warning',
      metaphorRepeats.map(({ word, count }) => `${word} × ${count}`),
      '一个核心意象最多承担一条意义线。重复出现时应推进或变形，否则换成具体物件、动作或事实。',
    ));
  }

  const genericHits = GENERIC_PHRASES.flatMap((word) => Array.from({ length: countLiteral(text, word) }, () => word));
  const repeatedGeneric = GENERIC_PHRASES.filter((word) => countLiteral(text, word) >= 2);
  if (genericHits.length >= Math.max(3, Math.ceil(text.length / 220)) || repeatedGeneric.length > 0) {
    issues.push(issue(
      'wording.generic-abstraction',
      '空泛词与 AI 惯用语',
      genericHits.length >= 7 ? 'warning' : 'note',
      repeatedGeneric.length > 0 ? repeatedGeneric : genericHits,
      '把抽象评价换成可验证的信息：谁在什么场景做了什么，观众能看到什么，结果或代价是什么。',
    ));
  }

  if (kind !== 'screenplay') {
    const quoteMarks = collectRegex(text, /[“”「」『』]/g);
    const quotePairs = Math.floor(quoteMarks.length / 2);
    const quoteLimit = Math.max(3, Math.ceil(sentences.length * 0.35));
    if (quotePairs > quoteLimit) {
      issues.push(issue(
        'punctuation.quote-density',
        '引号过密',
        'note',
        sentences.filter((sentence) => /[“”「」『』]/.test(sentence)),
        '只为真实引语、专名或必须强调的词保留引号。普通概念直接写，避免用引号制造虚假重点。',
      ));
    }
  }

  const penalty = issues.reduce((sum, current) => {
    if (current.severity === 'blocker') return sum + 18;
    if (current.severity === 'warning') return sum + 8;
    return sum + 3;
  }, 0);
  const score = text.length === 0 ? 0 : Math.max(35, 100 - penalty);
  const blockerCount = issues.filter((current) => current.severity === 'blocker').length;
  const warningCount = issues.filter((current) => current.severity === 'warning').length;
  const grade: WritingQualityAudit['grade'] = blockerCount > 0 || score < 72
    ? 'rewrite'
    : warningCount > 0 || score < 90
      ? 'review'
      : 'clean';
  const summary = text.length === 0
    ? '当前文档为空。'
    : issues.length === 0
      ? '未发现明显的模板化表达和标点滥用。仍需人工确认事实、观点与戏剧效果。'
      : `发现 ${issues.length} 类表达问题，其中 ${blockerCount} 项必须处理、${warningCount} 项建议处理。`;

  return {
    score,
    grade,
    kind,
    charCount: text.length,
    sentenceCount: sentences.length,
    blockerCount,
    warningCount,
    issues,
    summary,
  };
}

export function formatWritingAuditForAgent(audit: WritingQualityAudit): string {
  const status = audit.grade === 'clean' ? '通过' : audit.grade === 'review' ? '需要精修' : '需要重写问题段';
  const lines = [
    `文风审校：${audit.score}/100，${status}，类型=${audit.kind}。`,
    audit.summary,
  ];
  for (const current of audit.issues) {
    const evidence = current.excerpts.length > 0 ? `  证据：${current.excerpts.join('；')}` : '';
    lines.push(`- [${current.severity}] ${current.label}（${current.count}）：${current.suggestion}${evidence}`);
  }
  return lines.join('\n');
}

export function buildTargetedRewritePrompt(audit: WritingQualityAudit): string {
  const issueBrief = audit.issues
    .map((current) => `- ${current.label}：${current.suggestion}${current.excerpts.length > 0 ? ` 例：${current.excerpts.join('；')}` : ''}`)
    .join('\n');
  return `请对当前文档做一次定向精修。只修改下列被审校命中的段落，不要把全文换一种风格，也不要改变事实、人物关系、品牌信息和用户已经写好的好句。\n\n${issueBrief || '- 暂无机械问题，请只检查观点是否具体、场景是否成立、开头是否有压力。'}\n\n修改后再次调用 copywriting_review_doc 复查。不要输出分析过程，直接用 copywriting_patch_doc 写回最小必要改动。`;
}
