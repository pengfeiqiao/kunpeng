/**
 * filterPresets — 滤镜调色预设（四滑杆参数组，-100..100，0=原始）。
 * 预览 CSS filter 近似，导出 ffmpeg eq/colortemperature 保真。
 */
import type { ClipFilter } from '@/stores/editorStore';

export interface FilterPreset {
  id: string;
  label: string;
  values: Omit<ClipFilter, 'preset'>;
}

export const FILTER_PRESETS: FilterPreset[] = [
  { id: 'none', label: '原始', values: { brightness: 0, contrast: 0, saturation: 0, temperature: 0 } },
  { id: 'cinematic', label: '电影感', values: { brightness: -5, contrast: 18, saturation: -12, temperature: -10 } },
  { id: 'film', label: '胶片', values: { brightness: 4, contrast: 10, saturation: -20, temperature: 12 } },
  { id: 'fresh', label: '清新', values: { brightness: 10, contrast: 4, saturation: 10, temperature: -6 } },
  { id: 'blackgold', label: '黑金', values: { brightness: -8, contrast: 25, saturation: -30, temperature: 25 } },
  { id: 'cyber', label: '赛博', values: { brightness: -4, contrast: 22, saturation: 24, temperature: -25 } },
  { id: 'warmsun', label: '暖阳', values: { brightness: 8, contrast: 6, saturation: 12, temperature: 22 } },
  { id: 'coldsteel', label: '冷冽', values: { brightness: 0, contrast: 14, saturation: -8, temperature: -22 } },
  { id: 'retro', label: '复古', values: { brightness: 2, contrast: -6, saturation: -25, temperature: 16 } },
  { id: 'bw', label: '黑白', values: { brightness: 0, contrast: 15, saturation: -100, temperature: 0 } },
  { id: 'vivid', label: '浓郁', values: { brightness: 2, contrast: 12, saturation: 28, temperature: 4 } },
  { id: 'milkfog', label: '奶雾', values: { brightness: 12, contrast: -12, saturation: -10, temperature: 8 } },
];

/** 预览近似：四滑杆 → CSS filter 字符串 */
export function filterToCss(f?: Omit<ClipFilter, 'preset'> | null): string {
  if (!f) return 'none';
  const b = 1 + f.brightness / 100;
  const c = 1 + f.contrast / 100;
  const s = Math.max(0, 1 + f.saturation / 100);
  // 色温近似：暖 → sepia 微量，冷 → hue-rotate 反向
  const warm = f.temperature > 0 ? `sepia(${(f.temperature / 100) * 0.35})` : '';
  const cold = f.temperature < 0 ? `hue-rotate(${(f.temperature / 100) * 18}deg)` : '';
  return `brightness(${b.toFixed(2)}) contrast(${c.toFixed(2)}) saturate(${s.toFixed(2)}) ${warm} ${cold}`.trim();
}

/** 导出保真：四滑杆 → ffmpeg 滤镜片段（eq + colortemperature） */
export function filterToFfmpeg(f?: Omit<ClipFilter, 'preset'> | null): string | null {
  if (!f || (f.brightness === 0 && f.contrast === 0 && f.saturation === 0 && f.temperature === 0)) return null;
  const eq = `eq=brightness=${(f.brightness / 250).toFixed(3)}:contrast=${(1 + f.contrast / 100).toFixed(2)}:saturation=${Math.max(0, 1 + f.saturation / 100).toFixed(2)}`;
  // 6500K 中性，±100 → ±2000K
  const temp = f.temperature !== 0 ? `,colortemperature=temperature=${Math.round(6500 - f.temperature * 20)}` : '';
  return eq + temp;
}
