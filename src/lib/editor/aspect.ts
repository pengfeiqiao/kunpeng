export const EDITOR_ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] as const;

export type EditorAspect = typeof EDITOR_ASPECTS[number];

export const EDITOR_ASPECT_OPTIONS: { id: EditorAspect; label: string; shortLabel: string }[] = [
  { id: '16:9', label: '16:9 横屏', shortLabel: '16:9' },
  { id: '9:16', label: '9:16 竖屏', shortLabel: '9:16' },
  { id: '1:1', label: '1:1 方形', shortLabel: '1:1' },
  { id: '4:3', label: '4:3 横屏', shortLabel: '4:3' },
  { id: '3:4', label: '3:4 竖屏', shortLabel: '3:4' },
  { id: '21:9', label: '21:9 宽银幕', shortLabel: '21:9' },
];

const ASPECT_RATIOS: Record<EditorAspect, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:3': 4 / 3,
  '3:4': 3 / 4,
  '21:9': 21 / 9,
};

function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

export function isEditorAspect(value: unknown): value is EditorAspect {
  return EDITOR_ASPECTS.includes(value as EditorAspect);
}

export function aspectRatioValue(aspect: EditorAspect): number {
  return ASPECT_RATIOS[aspect] ?? ASPECT_RATIOS['16:9'];
}

export function aspectCssRatio(aspect: EditorAspect): string {
  return aspect.replace(':', ' / ');
}

export function isPortraitAspect(aspect: EditorAspect): boolean {
  return aspectRatioValue(aspect) < 1;
}

export function aspectOutputSize(aspect: EditorAspect, base: { w: number; h: number }): { width: number; height: number } {
  const ratio = aspectRatioValue(aspect);
  if (Math.abs(ratio - 1) < 0.001) return { width: base.h, height: base.h };
  if (ratio > 1) {
    const naturalW = even(base.h * ratio);
    if (naturalW <= base.w) return { width: naturalW, height: base.h };
    return { width: base.w, height: even(base.w / ratio) };
  }
  return { width: base.h, height: even(base.h / ratio) };
}
