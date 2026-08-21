/**
 * transitionPresets — 转场预设包（ffmpeg xfade transition 名直映射）。
 * 预览只对 fade 族做实时模拟，其余在切点显示角标（导出保真）。
 */
export interface TransitionPreset {
  id: string;
  label: string;
  /** ffmpeg xfade transition 名 */
  xfade: string;
  defaultDuration: number;
}

export const TRANSITION_PRESETS: TransitionPreset[] = [
  { id: 'fade', label: '叠化', xfade: 'fade', defaultDuration: 0.5 },
  { id: 'fadeblack', label: '闪黑', xfade: 'fadeblack', defaultDuration: 0.5 },
  { id: 'fadewhite', label: '闪白', xfade: 'fadewhite', defaultDuration: 0.4 },
  { id: 'wipeleft', label: '左擦除', xfade: 'wipeleft', defaultDuration: 0.5 },
  { id: 'wiperight', label: '右擦除', xfade: 'wiperight', defaultDuration: 0.5 },
  { id: 'slideleft', label: '左推移', xfade: 'slideleft', defaultDuration: 0.5 },
  { id: 'slideright', label: '右推移', xfade: 'slideright', defaultDuration: 0.5 },
  { id: 'slideup', label: '上推移', xfade: 'slideup', defaultDuration: 0.5 },
  { id: 'circleopen', label: '圆形展开', xfade: 'circleopen', defaultDuration: 0.6 },
  { id: 'circleclose', label: '圆形闭合', xfade: 'circleclose', defaultDuration: 0.6 },
  { id: 'radial', label: '时钟扫描', xfade: 'radial', defaultDuration: 0.6 },
  { id: 'smoothleft', label: '平滑左移', xfade: 'smoothleft', defaultDuration: 0.5 },
  { id: 'zoomin', label: '中心放大', xfade: 'zoomin', defaultDuration: 0.5 },
  { id: 'pixelize', label: '像素化', xfade: 'pixelize', defaultDuration: 0.5 },
  { id: 'dissolve', label: '噪点溶解', xfade: 'dissolve', defaultDuration: 0.6 },
  { id: 'distance', label: '景深拉远', xfade: 'distance', defaultDuration: 0.6 },
];

export function findTransition(id: string): TransitionPreset | undefined {
  return TRANSITION_PRESETS.find((t) => t.id === id);
}

/** TransitionType('cut'|'fade'|preset id) → xfade 名（cut 返回 null） */
export function xfadeNameOf(type: string): string | null {
  if (type === 'cut') return null;
  return findTransition(type)?.xfade ?? 'fade';
}
