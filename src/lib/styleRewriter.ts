import { quickChat } from './agent/quickChat';
import type { StylePreset } from './styleLibrary';
import { stripMidjourneyControlledFlags } from './midjourney/prompt';
import { applyMidjourneyStylePrompt, type MidjourneyStylePreset } from './midjourney/styles';

/** 剥离模型偶尔输出的 markdown 代码块包裹 / 引号 / 多余空白 */
function cleanRewrite(raw: string): string {
  let s = raw.trim();
  // 去掉首尾 ```...``` 或 ```text 包裹
  s = s.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '');
  // 去掉首尾成对引号
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  return s.trim();
}

/**
 * 用选定风格的视觉基因/镜头语言/英文后缀，改写用户提示词。
 * 走鲲鹏自己的 provider 体系（多链路降级），不再绑死单个可能下线的模型。
 * 保留用户原始内容（人物/场景/动作），叠加风格视觉语言。
 */
export async function rewritePromptWithStyle(
  originalPrompt: string,
  style: StylePreset,
): Promise<string> {
  const userPrompt = originalPrompt.trim() || '一个年轻女孩站在阳光下微笑';

  // 视觉基因（DNA）提供风格细节，promptTemplate 提供输出格式骨架。
  // 两者结合：既精准（DNA）又有结构化输出（模版的三段式）。
  const dnaText = [style.visualDNA, style.cameraLanguage].filter(Boolean).join('\n\n');
  const template = style.promptTemplate ?? '';

  const isMidjourney = style.library === 'midjourney';
  const messages = [
    {
      role: 'system',
      content: isMidjourney
        ? `你是 Midjourney V8 系列的视觉导演。把用户内容改写为紧凑、可直接生成的英文提示词。

风格：${style.name}
视觉机制：${style.visualDNA ?? ''}
镜头机制：${style.cameraLanguage ?? ''}
风格短语：${style.promptTemplate ?? ''}

按这个固定顺序组织：subject identity and action, environment and spatial relationship, composition and camera, lighting and color, materials and medium, finish and exclusions。
规则：
- 用户的主体、人数、身份、动作、产品结构、画幅和文字要求是事实锁，不能新增或改写。
- 有参考图时，只描述要生成的内容，不写“改成/参考某图/模仿”。
- 每块只留最有效的视觉词，避免同义词堆叠和空泛的 masterpiece/best quality。
- 平面、插画、工艺类风格必须把媒介放在句首；电影与摄影类把主体和动作放在句首。
- 不使用在世艺术家姓名、受保护 IP 名称或无法验证的 sref code。
- 不输出 --v、--ar、--stylize、--chaos、--style 等参数，参数由鲲鹏结构化传递。
- 只输出一段英文提示词，不解释，不加标题。`
        : `你是 AIGC 提示词风格改写专家。参考以下风格信息，把用户的提示词改写成专业影视提示词。

${dnaText ? `风格视觉基因与镜头语言：\n${dnaText}\n\n` : ''}输出格式范例（严格按此结构，不要照搬范例的具体人物/场景，要替换成用户的内容）：
${template}

改写原则：
- 严格按范例的"角色设定 / 镜头描述 / 技术参数"结构输出（若范例无此结构，则输出一段连贯的镜头描述）
- 角色设定：写出风格定位（参考范例的写法）
- 镜头描述：完整描述用户要的画面，必须保留用户提示词里的所有内容，包括格式/布局/数量要求（如九宫格、故事板、分屏、多角度、三视图等），一个都不能丢
- 技术参数：景别/拍摄角度/布光/色调等，用风格的视觉基因填充
- 只输出改写后的提示词，不要解释`,
    },
    { role: 'user', content: userPrompt },
  ];

  const result = await quickChat(messages, {
    maxTokens: 6000,
    directDeepseek: true,
    continueOnTruncation: true,
  });
  const cleaned = cleanRewrite(result)
    || (isMidjourney ? applyMidjourneyStylePrompt(userPrompt, style as MidjourneyStylePreset) : userPrompt);
  return isMidjourney ? stripMidjourneyControlledFlags(cleaned) : cleaned;
}
