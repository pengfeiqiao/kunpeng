import { quickChat } from '@/lib/agent/quickChat';
import { rewriteVideoPrompt } from '@/lib/videoPrompt/prompt';
import { referenceMention, workspaceDraftErrors } from './drafts';
import type { WorkspaceDraft } from './types';
import type { StylePreset } from '@/lib/styleLibrary';
import { rewritePromptWithStyle } from '@/lib/styleRewriter';

/** Reuse the original style system; style selection never changes reference order or the chosen engine. */
export async function restyleWorkspacePrompt(draft: WorkspaceDraft, style: StylePreset, signal: AbortSignal): Promise<string> {
  if (signal.aborted) throw new Error('已取消');
  if (!draft.prompt.trim()) throw new Error('请先填写提示词，再应用风格。');
  if ((style.library === 'midjourney') !== draft.engineId.startsWith('midjourney')) {
    throw new Error('风格库与当前模型不匹配，请重新选择风格。');
  }
  const prompt = await rewritePromptWithStyle(draft.prompt, style, { signal });
  if (signal.aborted) throw new Error('已取消');
  const errors = workspaceDraftErrors({ ...draft, prompt });
  if (errors.length) throw new Error(errors.join('；'));
  return prompt;
}

/** Read-only rewrite. The caller must compare the captured revision before saving. */
export async function optimizeWorkspacePrompt(draft: WorkspaceDraft, template: 'legacy' | 'universal', signal: AbortSignal): Promise<string> {
  if (signal.aborted) throw new Error('已取消');
  const references = draft.references.map((ref) => ({ label: `${referenceMention(ref, draft.references)} ${ref.label}`, kind: ref.type }));
  const result = draft.outputType === 'video'
    ? await rewriteVideoPrompt({ prompt: draft.prompt, references, duration: Number(draft.params.duration ?? 5),
      ratio: String(draft.params.ratio ?? draft.params.aspectRatio ?? '16:9') }, template, { signal })
    : await quickChat([
      { role: 'system', content: `你是专业图像提示词编辑。只输出单张图像的最终提示词，不生成图片、不解释、不输出代码块。
保留原文的剧情事实、主体身份、人物关系、动作目标和关键道具；仅优化构图、镜头、光线、材质与视觉层次，不新增人物、对白或剧情。
参考素材按提供的 @图片N 编号描述用途，不改编号，不虚构素材，不输出路径或内部ID。
${draft.engineId.startsWith('midjourney') ? '使用 Midjourney 擅长的精炼视觉描述，以主体、环境、构图、光线、材质、风格组织；不要附加 -- 参数，参数由界面负责。' : '使用清晰的自然语言描述，明确主体与参考图的关系。'}
${template === 'legacy' ? '保持原文段落与语言习惯，适度强化电影级视觉细节。' : '先主体和动作，再空间与构图，再光线材质；删去重复和互相冲突的视觉要求。'}` },
      { role: 'user', content: `实际参考：\n${references.map((ref) => ref.label).join('\n') || '无'}\n画幅：${String(draft.params.aspectRatio ?? draft.params.ratio ?? '16:9')}\n原始要求：\n${draft.prompt}` },
    ], { maxTokens: 16000, continueOnTruncation: true, signal });
  if (signal.aborted) throw new Error('已取消');
  const prompt = result.trim().replace(/^```(?:text|markdown)?\s*/i, '').replace(/\s*```$/, '').trim();
  const errors = workspaceDraftErrors({ ...draft, prompt });
  if (errors.length) throw new Error(errors.join('；'));
  return prompt;
}
