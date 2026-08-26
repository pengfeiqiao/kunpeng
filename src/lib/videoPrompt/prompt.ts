import { quickChat } from '@/lib/agent/quickChat';
import { auditUniversalVideoPrompt } from './audit';
import { AI_DRAMA_BAN, PERFORMANCE_GUIDE } from './performance.ts';

export { auditUniversalVideoPrompt } from './audit';
export type { VideoPromptAuditResult } from './audit';

export type VideoPromptTemplate = 'legacy' | 'universal';

export const VIDEO_PROMPT_TEMPLATE_STORAGE_KEY = 'kunpeng.videoPromptTemplate';

export function readGlobalVideoPromptTemplate(): VideoPromptTemplate {
  if (typeof window === 'undefined') return 'legacy';
  return window.localStorage.getItem(VIDEO_PROMPT_TEMPLATE_STORAGE_KEY) === 'universal'
    ? 'universal'
    : 'legacy';
}

export function writeGlobalVideoPromptTemplate(template: VideoPromptTemplate): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(VIDEO_PROMPT_TEMPLATE_STORAGE_KEY, template);
}

export interface VideoPromptReference {
  label: string;
  kind?: string;
}

export interface RewriteUniversalVideoPromptInput {
  prompt: string;
  references: VideoPromptReference[];
  duration: number;
  ratio: string;
}

const SYSTEM_PROMPT = `你是专业影视导演与视频生成提示词编辑器。只输出可直接提交视频模型的最终提示词，不解释，不使用 Markdown 代码块。

目标：把用户要求整理成清楚、可执行、无内部矛盾的通用视频提示词。保留电影级摄影、材质、光影、表演和物理细节，但不得为了丰富而新增原文没有的人物、人物关系、事件、对白、旁白或关键道具。

输出结构依次为：
【素材身份】
【空间与初始站位】
【一句话概述】
【时间戳动作与机位】
【物理与一致性】
【视觉与声音】

严格遵守：
1. 素材身份必须按实际提交顺序写清 @图片N、@视频N、@音频N 的用途。不得输出文件名、内部 ID、路径，不得虚构素材。
2. 同一人物、动物、物品只能有一个身份、阵营、初始位置和身体结构。重复信息必须合并为唯一事实；发生冲突时优先保留原文最先明确锁定的设定，无法确认的内容宁可删减，不自行补写。
3. 空间层必须写清主体相对位置、朝向、距离或前后景关系。后续时间段只能通过明确动作改变位置，不允许瞬移或无原因换边。
3.1 站位优先使用场景中的稳定锚点和人物相对关系描述世界坐标，不只写“画面左/右”。正反打、特写和换机位只改变观察方向，不改变人物实际方位；只有原文明确发生走位时，才按“起点→路径→终点”更新关系。
4. 时间轴覆盖完整时长，不重叠、不留空。每段只保留一个主要状态变化；同一时段最多两条同时发生的核心互动。复杂内容应拆段，不为追求热闹堆叠动作。
5. 动作按“起势→接触→受力→位移→恢复”描述。被占用、受伤或固定的肢体在释放前不能执行另一动作；武器、道具和攻击目标不得中途交换。
6. 每个时间段指定一个主要机位和一种主要运镜。四机位、多机位等方案必须分配到具体时间段；禁止同时要求固定镜头、快速切镜和连续环绕。
7. 导演约束卡只锁定站位、视线、机位和动作关系，不复制灰模材质。分镜板只作为镜头顺序、构图和画面变化参考。
8. 人物、文物、商品等主体必须保持身份、外观、结构和关键细节一致；真人参考不得擅自改变五官、口型、动作或声音。
9. 保留原文明确要求的对白、旁白和声音；没有则不得新增。默认无字幕、贴纸、水印、随机文字和无关背景音乐。
10. 不输出“潜台词”、创作解释、教程、候选方案或自检过程。简单镜头可以缩短各节，但不得省略素材关联、时间轴和一致性要求。

${PERFORMANCE_GUIDE}

${AI_DRAMA_BAN}

提交前在内部完成一致性检查：素材编号、左右/前后方位、阵营、攻击目标、身体部位数量、肢体占用、动作因果、机位切换、时间段总长必须互相一致。只输出检查后的最终版本。`;

const CLASSIC_SYSTEM_PROMPT = `你是专业影视导演与多镜头视频提示词编辑器。只输出可直接提交视频模型的最终提示词，不解释，不使用 Markdown 代码块。

请沿用鲲鹏经典版多镜头写法，结构依次为：
分镜场景设定在：交代地点、时间、空间、光线、人物和道具的初始关系。
分镜具体动作描述：概括本镜完整动作、表演和结果。
镜头1-1、镜头1-2……：按时间顺序写清景别、机位、运镜、焦点、人物动作、物理反馈、台词与声音。

严格遵守：
1. @图片N、@视频N、@音频N 必须按实际提交顺序引用，不得虚构素材或暴露文件名、路径、内部 ID。
2. 保留电影级机位、运镜、焦点、光影、材质、表演和剪辑节奏，但不得新增原文没有的人物、人物关系、剧情事件、对白、旁白或关键道具。
3. 人物和物品的身份、外观、站位、朝向及动作目标必须前后一致。换机位只改变观察方向，不得无原因换边、瞬移或交换道具。
4. 动作按起势、接触、受力、位移、恢复组织；复杂互动拆成连续镜头，不堆叠互相冲突的动作。
5. 时间轴覆盖完整时长。每个镜头只采用一种主要机位和一种主要运镜，镜头切换要有明确叙事原因。
6. 原文有台词、VO、音效或音乐时准确保留；没有则不新增。默认无字幕、贴纸、水印、随机文字和无关背景音乐。
7. 导演约束卡只约束站位、视线、机位和动作关系，不复制灰模材质；分镜板只作为镜头顺序、构图和景别变化参考。

${PERFORMANCE_GUIDE}

${AI_DRAMA_BAN}

提交前在内部检查素材编号、人物关系、对白、站位、动作因果、机位轴线和时间总长。只输出最终版本。`;

function clampDuration(value: number): number {
  return Math.min(180, Math.max(4, Math.round(value || 5)));
}

export async function rewriteUniversalVideoPrompt(input: RewriteUniversalVideoPromptInput): Promise<string> {
  const refs = input.references.length > 0
    ? input.references.map((ref, index) => `${index + 1}. ${ref.label}${ref.kind ? `（${ref.kind}）` : ''}`).join('\n')
    : '无参考素材';
  const duration = clampDuration(input.duration);
  const userPrompt = `输出参数：${duration} 秒，${input.ratio || '16:9'}。

实际提交素材（顺序不可改变）：
${refs}

原始要求：
${input.prompt.trim()}

请先在内部消除重复和冲突，再按通用视频模板输出。严格保留原始剧情事实、人物关系、已有对白和明确动作目标。`;
  // max_tokens 在该端点与 thinking 共享预算（已实测 output_tokens 内含 thinking_tokens），
  // 6000 易被推理占满导致正文截断失败，给到 16000。
  const result = await quickChat([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ], { maxTokens: 16000, continueOnTruncation: true });
  const cleaned = result.trim().replace(/^```(?:text|markdown)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (!cleaned) throw new Error('模型没有返回可用的通用视频提示词');
  const audit = auditUniversalVideoPrompt(cleaned, duration);
  if (audit.errors.length > 0) throw new Error(audit.errors.join('；'));
  return cleaned;
}

export async function rewriteVideoPrompt(
  input: RewriteUniversalVideoPromptInput,
  template: VideoPromptTemplate,
): Promise<string> {
  if (template === 'universal') return rewriteUniversalVideoPrompt(input);

  const refs = input.references.length > 0
    ? input.references.map((ref, index) => `${index + 1}. ${ref.label}${ref.kind ? `（${ref.kind}）` : ''}`).join('\n')
    : '无参考素材';
  const duration = clampDuration(input.duration);
  const userPrompt = `输出参数：${duration} 秒，${input.ratio || '16:9'}。

实际提交素材（顺序不可改变）：
${refs}

原始要求：
${input.prompt.trim()}

请按经典版多镜头结构优化。保留原始剧情事实、人物关系、已有对白、明确动作目标和参考素材编号；只丰富可执行的摄影、表演、光影、材质、物理反馈和剪辑细节。`;
  const result = await quickChat([
    { role: 'system', content: CLASSIC_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ], { maxTokens: 16000, continueOnTruncation: true });
  const cleaned = result.trim().replace(/^```(?:text|markdown)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (!cleaned) throw new Error('模型没有返回可用的经典版视频提示词');
  return cleaned;
}
