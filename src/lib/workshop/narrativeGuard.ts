export type WorkshopEditScope = 'story' | 'shots' | 'prompts' | 'unknown';

const NEGATED_STORY_EDIT_RE =
  /(?:不要|不得|禁止|别|无需|不需要|不能|不可).{0,10}(?:改|修改|重写|调整|增删|新增|删除|替换|改编).{0,8}(?:剧本|剧情|故事|情节|对白|台词|人物关系|角色关系|人物设定|角色设定|画面描述|分镜描述)/gi;

const STORY_EDIT_PATTERNS = [
  /(?:改|修改|重写|调整|重构|续写|扩写|删减|删除|增加|新增|替换|改编).{0,10}(?:剧本|剧情|故事|情节|对白|台词|人物关系|角色关系|人物设定|角色设定)/i,
  /(?:剧本|剧情|故事|情节|对白|台词|人物关系|角色关系|人物设定|角色设定).{0,10}(?:要改|改成|修改|重写|调整|重构|续写|扩写|删减|删除|增加|新增|替换|改编)/i,
  /把.{0,24}(?:台词|对白).{0,8}(?:改成|换成|删掉|删除|增加|补上)/i,
  /(?:让|改成让).{0,16}(?:说|问|回答|喊|念|旁白)/i,
];

const SHOT_EDIT_PATTERNS = [
  /(?:重做|重排|重新|修改|调整|拆分|合并|增加|新增|删除|替换|优化).{0,10}(?:分镜表|分镜结构|镜头结构|分镜头|镜头拆分|镜头顺序|镜号)/i,
  /(?:分镜表|分镜结构|镜头结构|分镜头|镜头拆分|镜头顺序|镜号).{0,10}(?:重做|重排|重新|修改|调整|拆分|合并|增加|新增|删除|替换|优化)/i,
  /(?:修改|调整|修正|补充).{0,10}(?:角色关联|人物关联|场景关联|道具关联|参考资产)/i,
];

const PROMPT_EDIT_RE = /(?:提示词|prompt|生图词|视频词|配音词|生成词)/i;

export function classifyWorkshopEditScope(request: string): WorkshopEditScope {
  const text = request.trim();
  if (!text) return 'unknown';
  const positiveText = text.replace(NEGATED_STORY_EDIT_RE, ' ');
  if (STORY_EDIT_PATTERNS.some((pattern) => pattern.test(positiveText))) return 'story';
  if (SHOT_EDIT_PATTERNS.some((pattern) => pattern.test(positiveText))) return 'shots';
  if (PROMPT_EDIT_RE.test(text)) return 'prompts';
  return 'unknown';
}

function normalizeEvidenceText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s"'“”‘’「」『』《》【】（）()，。！？、；：:,.!?;…—_-]+/g, '');
}

export function isTextSupportedByCanonical(candidate: string | undefined, canonical: string | undefined): boolean {
  const next = normalizeEvidenceText(candidate ?? '');
  if (!next) return true;
  const source = normalizeEvidenceText(canonical ?? '');
  return Boolean(source) && (source.includes(next) || next.includes(source));
}

function quoteCandidates(text: string): Array<{ value: string; index: number }> {
  const results: Array<{ value: string; index: number }> = [];
  const patterns = [
    /[“"「『]([^”"」』]{1,160})[”"」』]/g,
    /\{([^{}]{1,160})\}/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = match[1]?.trim();
      if (value) results.push({ value, index: match.index ?? 0 });
    }
  }
  return results;
}

function looksLikeSpokenText(text: string, index: number): boolean {
  const prefix = text.slice(Math.max(0, index - 36), index);
  return /(?:说|问|回答|答道|喊|吼|念|开口|回应|对白|台词|旁白|画外音|内心独白|解说|vo|voice[\s-]?over|@图片[一二三四五六七八九十百\d]+.{0,10}[：:])[^。！？\n]*$/i.test(prefix);
}

export function findUnsupportedPromptDialogue(args: {
  videoPrompt?: string;
  audioPrompts?: Array<{ prompt: string }>;
  canonicalDialogue?: string;
}): string[] {
  const evidence = normalizeEvidenceText(args.canonicalDialogue ?? '');
  const candidates: string[] = [];

  if (args.videoPrompt) {
    for (const candidate of quoteCandidates(args.videoPrompt)) {
      if (looksLikeSpokenText(args.videoPrompt, candidate.index)) candidates.push(candidate.value);
    }
  }
  for (const audio of args.audioPrompts ?? []) {
    candidates.push(...quoteCandidates(audio.prompt).map((candidate) => candidate.value));
  }

  return [...new Set(candidates.filter((candidate) => {
    const normalized = normalizeEvidenceText(candidate);
    if (!normalized) return false;
    return !evidence || !evidence.includes(normalized);
  }))];
}

const RELATIONSHIP_TERMS = [
  '父亲', '母亲', '父子', '父女', '母子', '母女', '兄长', '弟弟', '姐姐', '妹妹',
  '兄弟', '姐妹', '夫妻', '丈夫', '妻子', '恋人', '情侣', '未婚夫', '未婚妻',
  '师父', '师傅', '徒弟', '师徒', '主仆', '主人', '仆人', '同胞', '亲生',
];

/** 提示词可以丰富导演表达，但不得凭空建立剧本中没有的人物关系。 */
export function findUnsupportedRelationshipClaims(args: {
  prompts: Array<string | undefined>;
  canonicalFacts: string;
}): string[] {
  const promptText = args.prompts.filter(Boolean).join('\n');
  const canonical = normalizeEvidenceText(args.canonicalFacts);
  if (!promptText) return [];
  return RELATIONSHIP_TERMS.filter((term) =>
    promptText.includes(term) && !canonical.includes(normalizeEvidenceText(term)));
}

export function valuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return a === b;
}
