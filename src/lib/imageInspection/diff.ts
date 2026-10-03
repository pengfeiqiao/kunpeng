export interface ImageRegion { x: number; y: number; width: number; height: number }
export function validateRegion(region: ImageRegion, width: number, height: number): void {
  if (![region.x, region.y, region.width, region.height].every(Number.isInteger)
    || region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0
    || region.x + region.width > width || region.y + region.height > height) throw new Error('区域必须是原图像素坐标，且完整位于图内');
}
export function comparePixels(before: Uint8ClampedArray, after: Uint8ClampedArray, width: number, height: number, region?: ImageRegion, threshold = 0) {
  if (before.length !== after.length || before.length !== width * height * 4) throw new Error('必须比较同尺寸RGBA图片，不自动缩放或对齐');
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 255) throw new Error('threshold 必须为0–255整数');
  if (region) validateRegion(region, width, height);
  let changed = 0, outsideChanged = 0, absoluteError = 0;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  const heatmap = new Uint8ClampedArray(before.length);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const offset = pixel * 4; let delta = 0;
    for (let channel = 0; channel < 4; channel++) { const d = Math.abs(before[offset + channel] - after[offset + channel]); delta = Math.max(delta, d); absoluteError += d; }
    const x = pixel % width, y = Math.floor(pixel / width);
    if (delta > threshold) {
      changed++; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      if (region && !(x >= region.x && x < region.x + region.width && y >= region.y && y < region.y + region.height)) outsideChanged++;
    }
    heatmap[offset] = delta; heatmap[offset + 3] = 255;
  }
  return { heatmap, metrics: { width, height, threshold, changed_pixels: changed, changed_ratio: changed / (width * height), mean_absolute_rgba_error: absoluteError / before.length,
    changed_bounds: changed ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null,
    outside_region_changed_pixels: region ? outsideChanged : null,
    outside_region_unchanged: region ? outsideChanged === 0 : null,
    note: '比较解码后RGBA像素，不自动配准。压缩/色彩变化也计入差异；threshold=0才是严格像素相同。像素指标不能证明语义或物理合理。' } };
}
