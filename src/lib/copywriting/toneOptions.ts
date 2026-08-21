import { withCopywritingStyleGuard } from './antiAiStyle';

export const TONE_OPTIONS = [
  { label: '沉稳克制', desc: '更冷静、有分寸，减少夸张表达' },
  { label: '诗意留白', desc: '增加意象、节奏和余韵' },
  { label: '犀利直接', desc: '观点更锋利，表达更短促' },
  { label: '轻松友好', desc: '更口语、更亲近，降低距离感' },
  { label: '高级品牌感', desc: '更精炼、有质感，适合品牌片' },
  { label: '电影旁白感', desc: '更有画面、镜头和叙事感' },
  { label: '小红书种草', desc: '更自然、有体验感和推荐感' },
  { label: '抖音钩子感', desc: '开头更抓人，节奏更快' },
  { label: '纪录片质感', desc: '更真实、冷静，有观察感' },
  { label: '幽默松弛', desc: '更有轻微反差和趣味' },
];

export function buildTonePrompt(tone: string, text: string) {
  const toneRule = (() => {
    if (tone === '诗意留白') return '保留文学性，用意象、节奏、空白和未说尽的余韵来写；不要堆华丽词，不要硬升华。';
    if (tone === '电影旁白感') return '像电影旁白一样有画面、时间感和情绪推进；优先镜头、声音、动作和潜台词。';
    if (tone === '纪录片质感') return '保持观察感和事实质地，克制但有判断；不要煽情，不要宣传片腔。';
    if (tone === '高级品牌感') return '保持精炼和质感，但必须落到具体场景、动作或材质；不要写奢侈品空话。';
    if (tone === '犀利直接') return '观点更明确，有取舍，可以指出问题；不要用圆滑平衡句稀释判断。';
    if (tone === '轻松友好') return '更像真人说话，允许短句和轻微停顿；不要公众号腔。';
    if (tone === '小红书种草') return '强调真实体验、使用场景和推荐理由；不要模板化夸赞。';
    if (tone === '抖音钩子感') return '开头要抓人，有冲突或反差，节奏快；不要标题党空喊。';
    if (tone === '幽默松弛') return '用轻微反差和生活化吐槽，不要为了好笑硬造梗。';
    return '保持核心信息不变，只调整表达方式。';
  })();
  return withCopywritingStyleGuard(`请将以下文字改为「${tone}」语气。
${toneRule}

原文：
${text}`);
}
