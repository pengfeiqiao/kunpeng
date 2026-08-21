export const GPT_IMAGE_2_ALLOWED_SIZES = new Set([
  'auto',
  '1024x1024',
  '1536x1024',
  '1024x1536',
  '2048x2048',
  '2048x1152',
  '1536x864',
  '1536x1152',
  '1152x1536',
  '1280x1024',
  '1024x1280',
  '1152x2048',
  '3840x2160',
  '2160x3840',
]);

const GPT_IMAGE_2_RATIO_SIZES: Record<string, string> = {
  '16:9': '2048x1152',
  '9:16': '1152x2048',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
  '4:3': '1536x1152',
  '3:4': '1152x1536',
  '4:5': '1024x1280',
  '5:4': '1280x1024',
  // GPT Image 2 routes currently have no native 21:9 size. Use the widest
  // supported landscape canvas and keep 21:9 composition inside the prompt.
  '21:9': '2048x1152',
  '1:1': '1024x1024',
};

/**
 * Resolve GPT Image 2's pixel size from the requested aspect ratio.
 * `auto` means no explicit pixel size, so it must not override aspectRatio.
 */
export function normalizeGptImage2Size(size?: string, aspectRatio?: string): string {
  const raw = String(size || '').trim().toLowerCase();
  if (raw && raw !== 'auto' && GPT_IMAGE_2_ALLOWED_SIZES.has(raw)) return raw;
  const ratio = String(aspectRatio || '').trim();
  return GPT_IMAGE_2_RATIO_SIZES[ratio] || (raw && raw !== 'auto' ? raw : '1024x1024');
}

export function normalizeSeedreamProSize(size?: string, aspectRatio?: string, resolution?: string): string {
  if (size && /^\d+x\d+$/i.test(size)) return size.toLowerCase();
  const table: Record<'1k' | '2k' | '4k', Record<string, [number, number]>> = {
    '1k': {
      '1:1': [1024, 1024], '4:3': [1152, 864], '3:4': [864, 1152],
      '16:9': [1424, 800], '9:16': [800, 1424], '3:2': [1248, 832],
      '2:3': [832, 1248], '21:9': [1568, 672],
    },
    '2k': {
      '1:1': [2048, 2048], '4:3': [2368, 1776], '3:4': [1776, 2368],
      '16:9': [2816, 1584], '9:16': [1584, 2816], '3:2': [2496, 1664],
      '2:3': [1664, 2496], '21:9': [3136, 1344],
    },
    '4k': {
      '1:1': [4096, 4096], '4:3': [4096, 3072], '3:4': [3072, 4096],
      '16:9': [4096, 2304], '9:16': [2304, 4096], '3:2': [4096, 2720],
      '2:3': [2720, 4096], '21:9': [4096, 1760],
    },
  };
  const requested = String(resolution || '2k').toLowerCase();
  const res: '1k' | '2k' | '4k' = requested === '1k' || requested === '4k' ? requested : '2k';
  const [w, h] = table[res][String(aspectRatio || '16:9')] ?? table[res]['16:9'];
  return `${w}x${h}`;
}

/**
 * Seedream 渠道（DMXAPI / APIMart 等中转）对单次生成的总像素有上限
 * （DMXAPI 为 4,194,304）。超限时处理分两级：
 *  - 只需轻度缩小（scale ≥ minScale）→ 按比例缩到上限内（取偶数）；
 *  - 需要缩得太狠（如 4K 请求）→ 返回 null，调用方退用渠道档位
 *    （DMXAPI 的 2K tier / APIMart 的 auto），不要交出远小于预期的图。
 */
export function fitSeedreamProPixelSize(
  size: string,
  opts?: { maxPixels?: number; minScale?: number },
): string | null {
  const maxPixels = opts?.maxPixels ?? 4194304;
  const minScale = opts?.minScale ?? 0.75;
  const match = size.toLowerCase().match(/^(\d+)x(\d+)$/);
  if (!match) return size;
  let w = Number(match[1]);
  let h = Number(match[2]);
  if (w * h <= maxPixels) return `${w}x${h}`;
  const scale = Math.sqrt(maxPixels / (w * h));
  if (scale < minScale) return null;
  w = Math.max(2, Math.floor((w * scale) / 2) * 2);
  h = Math.max(2, Math.floor((h * scale) / 2) * 2);
  return `${w}x${h}`;
}
