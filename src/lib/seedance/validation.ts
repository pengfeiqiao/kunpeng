const CN_NUMS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const CN_TO_NUM = new Map(CN_NUMS.map((n, i) => [n, i + 1]));

export interface SeedanceRequiredRef {
  index: number;
  label?: string;
}

export interface SeedanceValidationOptions {
  refCount?: number;
  requiredRefs?: SeedanceRequiredRef[];
  requireSceneRef?: boolean;
  /** 场景图在实际参考队列中的编号；视频有分镜板时场景不再固定为第一张。 */
  sceneRefIndices?: number[];
  allowVideoRefs?: boolean;
  /** 模型允许的最大图片参考数；2.5 为 30，旧模型默认 10。 */
  maxImageRefs?: number;
}

export interface SeedanceValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  usedImageRefs: number[];
}

export function numToCn(n: number): string {
  return n >= 1 && n <= CN_NUMS.length ? CN_NUMS[n - 1] : String(n);
}

function parseRefIndex(raw: string): number | null {
  if (/^\d+$/.test(raw)) return Number(raw);
  return CN_TO_NUM.get(raw) ?? null;
}

export function extractImageRefs(prompt: string): number[] {
  const refs = new Set<number>();
  for (const match of prompt.matchAll(/@图片([一二三四五六七八九十]|\d+)/g)) {
    const idx = parseRefIndex(match[1]);
    if (idx) refs.add(idx);
  }
  return [...refs].sort((a, b) => a - b);
}

export function validateSeedancePrompt(
  prompt: string,
  options: SeedanceValidationOptions = {},
): SeedanceValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const usedImageRefs = extractImageRefs(prompt);
  const refCount = options.refCount ?? 0;
  const maxImageRefs = options.maxImageRefs ?? 10;

  if (/@[^\s@,;，；]+\.(png|jpe?g|webp|gif|bmp|tiff?)/i.test(prompt)) {
    errors.push('提示词中残留 @具体文件名，请在提交 API 前转换为 @图片一/@图片二 这类位置编号');
  }

  if (/@(?:人|人物|角色|物|道具|场景)[一二三四五六七八九十\d]/.test(prompt)) {
    errors.push('提示词中残留 @人/@物/@场景 等旧式占位，请改为 @图片一/@图片二 位置编号');
  }

  if (/@色卡/.test(prompt)) {
    errors.push('提示词中残留 @色卡；色卡也是图片资产，请按 referenceOrder 使用对应的 @图片N 编号');
  }

  if (/@图片N/.test(prompt)) {
    errors.push('提示词中残留 @图片N 占位，请替换为 @图片一/@图片二 等实际编号');
  }

  if (/\.(png|jpe?g|webp|gif|bmp|tiff?)\b/i.test(prompt)) {
    errors.push('提示词中仍包含图片文件名后缀（如 .png/.jpg），提交 Seedance 前必须移除');
  }

  if (refCount > 0 && usedImageRefs.length === 0) {
    errors.push(`已传入 ${refCount} 张参考图，但提示词中没有任何 @图片N 引用，Seedance 无法关联素材`);
  }

  if (refCount > 0) {
    for (let i = 1; i <= Math.min(refCount, maxImageRefs); i++) {
      if (!usedImageRefs.includes(i)) {
        errors.push(`已传入第 ${i} 张参考图，但提示词缺少 @图片${numToCn(i)} 引用`);
      }
    }
  }

  for (const idx of usedImageRefs) {
    if (idx < 1 || idx > maxImageRefs) {
      errors.push(`@图片${idx} 超出支持范围，当前模型最多支持 ${maxImageRefs} 张参考图`);
    } else if (refCount > 0 && idx > refCount) {
      errors.push(`提示词引用了 @图片${numToCn(idx)}，但实际只传入 ${refCount} 张参考图`);
    }
  }

  if (options.requireSceneRef !== false && refCount > 0) {
    const sceneRefIndices = options.sceneRefIndices?.filter((idx) => idx >= 1 && idx <= refCount) ?? [1];
    if (sceneRefIndices.length > 0 && !sceneRefIndices.some((idx) => usedImageRefs.includes(idx))) {
      errors.push(`视频提示词缺少场景图引用（${sceneRefIndices.map((idx) => `@图片${numToCn(idx)}`).join(' 或 ')}）`);
    }
  }

  for (const ref of options.requiredRefs ?? []) {
    if (!usedImageRefs.includes(ref.index)) {
      errors.push(`提示词缺少 @图片${numToCn(ref.index)}${ref.label ? `（${ref.label}）` : ''}`);
    }
  }

  if (/@音频[一二三四五六七八九十\d]/.test(prompt) && /@图片[一二三四五六七八九十\d].*@音频|@音频.*@图片/s.test(prompt)) {
    warnings.push('@音频引用只表示音色/音乐素材，不占 @图片N 编号，请确认图片顺序未把音频算进去');
  }

  const voLines = prompt.split('\n').filter((line) => /（VO）|^\s*VO[:：]/i.test(line));
  for (const line of voLines) {
    if (/[说唱喊问答][:："]|[说唱喊问答]\{/.test(line)) {
      warnings.push('VO 行疑似包含画面内对白/唱词；画面内声音应写入镜头行，VO 只用于旁白或画外内心独白');
      break;
    }
  }

  if (/镜头\S+.*(?:推|拉|摇|移).*(?:推|拉|摇|移)/.test(prompt)) {
    warnings.push('单个镜头疑似包含多种运镜；Seedance 更稳定的写法是每个镜头只指定一种主要运镜');
  }

  if (!options.allowVideoRefs && /@视频[一二三四五六七八九十\d]/.test(prompt)) {
    warnings.push('检测到 @视频 引用；普通 Seedance 图生视频不需要 @视频，占位前请确认当前引擎支持视频参考');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    usedImageRefs,
  };
}

export function formatSeedanceValidation(result: SeedanceValidationResult): string {
  const parts: string[] = [];
  if (result.errors.length) parts.push(`错误：\n${result.errors.map((x) => `- ${x}`).join('\n')}`);
  if (result.warnings.length) parts.push(`提醒：\n${result.warnings.map((x) => `- ${x}`).join('\n')}`);
  return parts.join('\n\n');
}
