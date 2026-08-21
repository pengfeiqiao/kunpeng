export interface TemplateContext {
  director?: string;
  shotType?: string;
  cameraMovement?: string;
  subject?: string;
  scene?: string;
  lighting?: string;
  colorTone?: string;
  mood?: string;
  composition?: string;
  constraints?: string[];
  aspectRatio?: string;
  resolution?: string;
  duration?: string;
  model?: string;
  action?: string;
  appearance?: string;
  environment?: string;
  [key: string]: unknown;
}

const VARIABLE_RE = /\{(\w+)(?::([^}]*))?\}/g;

/**
 * Render a template string by replacing {variable} placeholders.
 * Supports: {variable} and {variable:defaultValue}
 * Unresolved variables are replaced with empty string.
 */
export function renderTemplateString(
  template: string,
  ctx: Record<string, string | undefined>,
): string {
  return template.replace(VARIABLE_RE, (_match, key: string, defaultVal?: string) => {
    // Direct key lookup
    const value = ctx[key];
    if (value !== undefined && value !== '') return value;
    // Fallback to default
    if (defaultVal !== undefined) return defaultVal;
    // Handle array-type keys (constraints → join)
    if (key === 'constraints' && Array.isArray(ctx.__raw_constraints)) {
      return (ctx.__raw_constraints as string[]).join(', ');
    }
    return '';
  });
}

/**
 * Select the prompt formula for a given engine and inject director DNA.
 * Returns a human-readable guidance string for the agent/system prompt.
 */
export function getEngineFormula(engine: 'gpt-image-2' | 'seedream-v5-pro' | 'seedance' | 'kling' | 'midjourney'): string {
  switch (engine) {
    case 'gpt-image-2':
    case 'seedream-v5-pro':
      return `GPT-Image-2 提示词公式：用途 + 主体 + 版式 + 风格 + 细节 + 文字 + 约束
- 视觉风格放开头
- 字面文字用引号包裹
- 结构化段落式写法`;
    case 'seedance':
      return `Seedance 提示词以 ~/.kunpeng/aigc-memory/prompt-templates/seedance/README.md 为唯一权威入口。
- 单镜头读取 single-shot.md
- 多镜头合并/VO 读取 multi-shot.md
- @图片按实际参考图顺序用中文数字引用
- 提交 API 前必须通过 Seedance 质量检查`;
    case 'midjourney':
      return `Midjourney 提示词公式：英文逗号短语式（subject, pose/composition, lighting, style, quality）
- 全英文，渐进式短语排列
- 不写 --ar 等后缀（比例由 API 参数传递）
- 风格词靠后（cinematic, high detail, film grain…）`;
    case 'kling':
      return `Kling 提示词公式：谁 + 长相 + 动作 + 场景 + 环境细节 + 怎么拍 + 光线 + 情绪
- 简洁句式
- 5-10秒内可完成
- 首尾帧技巧可用`;
  }
}
