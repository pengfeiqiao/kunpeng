/**
 * Suno 专业提示词模板（配合 APIMart Suno 接口，docs.apib.ai/audios/suno）。
 *
 * Suno 的两块核心输入：
 *  - style：风格标签行，决定编曲与质感。推荐结构：
 *    流派/子流派 + 情绪氛围 + 核心配器 + 人声类型 + 速度(BPM) + 制作质感
 *    例："synthwave, 深夜都市感, 模拟合成器+电子鼓, 女声气声, 82 BPM, 电影感混响"
 *  - prompt（custom=true 时作歌词）：用结构标记组织段落：
 *    [Intro] [Verse] [Pre-Chorus] [Chorus] [Bridge] [Outro]
 *    每段 2-4 行，副歌要有可记忆的 hook；可在标记后写演奏提示（如 [Chorus: 鼓点全开]）。
 *  - negative_tags：只写明确不要的（如 "metal, screaming,  autotune"），宁少勿滥。
 */

export interface SunoPromptDraft {
  style: string;
  lyrics: string;
}

/** 给 Agent / 画布改写功能使用的专业写法说明。 */
export const SUNO_PROMPT_GUIDE = `Suno 提示词专业写法：
1. 风格行（style）按「流派+情绪+配器+人声+BPM+制作质感」组织，用英文或中英混合标签，逗号分隔；
   例：cinematic pop, 史诗感, 弦乐群+钢琴+定音鼓, 女声高亢, 92 BPM, 宽声场混音。
2. 歌词用结构标记分段：[Intro] [Verse] [Pre-Chorus] [Chorus] [Bridge] [Outro]；
   每段 2-4 行；副歌写最有记忆点的一句 hook 并适当重复；避免大段散文。
3. 中文歌用中文歌词，风格行可中英混合；想指定人声性别用 vocal_gender 而不是写进风格行。
4. negative_tags 只列明确排斥项（如 metal, screaming），不写无关内容。`;

/** 画布「提示词改写」的 LLM 系统提示。输出格式必须便于程序化拆分。 */
export const SUNO_REWRITE_SYSTEM_PROMPT = `你是专业音乐制作人与 Suno 提示词专家。把用户的粗略想法改写成可直接提交 Suno 的专业提示词。

要求：
1. 严格按以下格式输出，不要输出任何其他内容、解释或代码块标记：
风格：<一行风格标签，按「流派+情绪+核心配器+人声类型+BPM+制作质感」，逗号分隔，中英混合均可>
歌词：<用 [Intro] [Verse] [Pre-Chorus] [Chorus] [Bridge] [Outro] 结构标记组织的完整歌词>

2. 歌词每段 2-4 行，副歌必须有一句高记忆度 hook；语言与用户输入一致（默认中文）；
3. 如果用户说要做纯音乐/BGM，歌词部分改为以「 instrumental 」开头的一行编曲说明（不写人声歌词）；
4. 风格行不要写歌名、不要写「不要 XX」；
5. 贴合用户原意的题材与情绪，不要擅自更换主题。`;

/** 解析 LLM 改写结果为 { style, lyrics }。解析失败返回 null。 */
export function parseSunoRewrite(text: string): SunoPromptDraft | null {
  const styleMatch = text.match(/风格[:：]\s*(.+)/);
  const lyricsMatch = text.match(/歌词[:：]\s*([\s\S]+)/);
  if (!styleMatch || !lyricsMatch) return null;
  const style = styleMatch[1].trim();
  const lyrics = lyricsMatch[1].trim();
  if (!style || !lyrics) return null;
  return { style, lyrics };
}

/** 拼装给 Agent 的 Suno 工具调用提示（生成/改写共用）。 */
export function buildSunoAgentHint(draft: SunoPromptDraft): string {
  return `风格标签：${draft.style}\n\n歌词：\n${draft.lyrics}`;
}
