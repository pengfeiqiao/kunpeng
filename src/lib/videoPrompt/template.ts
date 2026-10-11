/** Prompt format is independent of the paid generation engine. */
export type VideoPromptTemplate = 'legacy' | 'universal';
export const VIDEO_PROMPT_TEMPLATE_STORAGE_KEY = 'kunpeng.videoPromptTemplate';
export function resolveVideoPromptTemplate(value: unknown): VideoPromptTemplate {
  return value === 'legacy' ? 'legacy' : 'universal';
}
export function readGlobalVideoPromptTemplate(): VideoPromptTemplate {
  try {
    return resolveVideoPromptTemplate(typeof window === 'undefined' ? undefined : window.localStorage.getItem(VIDEO_PROMPT_TEMPLATE_STORAGE_KEY));
  } catch { return 'universal'; }
}
export function writeGlobalVideoPromptTemplate(template: VideoPromptTemplate): void {
  if (typeof window !== 'undefined') window.localStorage.setItem(VIDEO_PROMPT_TEMPLATE_STORAGE_KEY, template);
}
export const VIDEO_PROMPT_DRAFTING_POLICY = `视频提示词格式：普通对话写作、改写或续写 Seedance 提示词，未明确指定版本时默认 Seedance 2.5 新版（universal），依次写【素材身份】【空间与初始站位】【一句话概述】【时间戳动作与机位】【物理与一致性】【视觉与声音】；简单内容简写，不为凑字数扩写。参考素材按实际传入顺序映射，未提供就写无参考，不虚构附件。用户明确要经典版或项目/单镜已选择 legacy 时保留旧格式；仅指定2.0模型不等于要求旧版排版。历史示例和旧记忆不覆盖本次默认。模板入口为 aigc-memory/prompt-templates/seedance/README.md，新版详情为 universal.md，single-shot.md/multi-shot.md 仅为经典版。格式选择不更改用户选定的生成模型、渠道或付费行为；用户只要提示词时不调用生成。`;
