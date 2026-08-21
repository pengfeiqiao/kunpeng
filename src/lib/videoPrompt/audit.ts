export interface VideoPromptAuditResult {
  errors: string[];
  warnings: string[];
}

export function auditUniversalVideoPrompt(prompt: string, duration?: number): VideoPromptAuditResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const text = prompt.trim();
  if (!text) return { errors: ['提示词为空'], warnings };

  if (/(?:img_v\d|image-\d{8,}|[a-f\d]{8}-[a-f\d-]{20,})/i.test(text)) {
    errors.push('提示词中包含内部文件名或素材 ID，应转换为 @图片N/@视频N/@音频N');
  }
  if (duration && duration >= 8 && !/\d+(?:\.\d+)?\s*(?:s|秒)?\s*[-—–~至]\s*\d+(?:\.\d+)?\s*(?:s|秒)/i.test(text)) {
    warnings.push('较长视频没有可识别的时间段，建议按秒拆分动作和机位');
  }
  if (/固定(?:镜头|机位|全景)[\s\S]{0,80}(?:快切|快速切镜|连续环绕)|(?:快切|快速切镜|连续环绕)[\s\S]{0,80}固定(?:镜头|机位|全景)/.test(text)) {
    warnings.push('同时出现固定镜头和快切/环绕要求，请把不同镜头分配到明确时间段');
  }
  if (/(?:胶片颗粒|颗粒感)[\s\S]{0,100}禁止(?:画面)?噪点|禁止(?:画面)?噪点[\s\S]{0,100}(?:胶片颗粒|颗粒感)/.test(text)) {
    warnings.push('胶片颗粒与禁止噪点容易冲突，应区分稳定胶片颗粒和数字噪点');
  }
  const sections = ['【素材身份】', '【空间与初始站位】', '【一句话概述】', '【时间戳动作与机位】', '【物理与一致性】', '【视觉与声音】'];
  const missing = sections.filter((section) => !text.includes(section));
  if (missing.length > 0) warnings.push(`通用模板缺少：${missing.join('、')}`);
  return { errors, warnings };
}
