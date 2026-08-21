/**
 * Canvas dark-theme color constants for JS-side consumers (MiniMap props,
 * NodeResizer color, SVG attrs that can't read CSS vars at render time).
 *
 * ⚠️ MUST stay in sync with the `.canvas-dark` variable block in
 * src/index.css — values are lifted from TapNow/LibTV production CSS.
 */
export const CANVAS_THEME = {
  bg: '#0a0a0a',
  bgDot: '#2a2a2a',
  nodeBg: '#191e26',
  nodeBorder: '#363636',
  nodeBorderSelected: '#a8a8a8',
  handle: '#86909c',
  edge: '#86909c',
  edgeHover: '#c0c8d0',
  edgeSelected: '#e0e4e8',
  panel: '#262626',
  panelElevated: '#2e2e2e',
  text1: '#e6e6e6',
  text2: '#9c9c9c',
  text3: '#737373',
  accent: '#1fa2dc',
  danger: '#ff6163',
  minimapBg: 'rgba(31, 31, 31, 0.9)',
  minimapNode: '#525252',
  minimapMask: 'rgba(60, 60, 60, 0.6)',
  minimapMaskStroke: 'rgba(255, 255, 255, 0.35)',
} as const;
