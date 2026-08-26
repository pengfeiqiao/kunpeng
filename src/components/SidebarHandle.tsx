/**
 * SidebarHandle — 侧栏收起后全局唯一的展开把手，挂在所有视图共同的父级（App 层），子视图零感知：
 * 任何视图忘了（或没来得及）提供返回路径都不会再出现死路。
 * 位置统一左上角（与原剪辑/画布/工坊收起把手一致）；原把手在顶栏占位的视图以等宽占位符让位。
 * 图标与配色沿用原各视图把手：画布系用 --canvas-panel（即其顶栏底色）、文案与 chat 系用透明
 * 幽灵钮（透出页面底色）、产物库/项目用 stone 系。主题 CSS 变量定义在主题类本身，故把手自带主题类。
 */
import type { ComponentType } from 'react';
import { Menu, PanelLeftOpen } from 'lucide-react';
import { useChatStore } from '@/stores';
import type { ActiveView } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';

/** 画布原把手的图标：方形 + 左侧分割线（原 CanvasView 内联 SVG） */
const CanvasIcon = ({ size = 16 }: { size?: number | string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" />
  </svg>
);

type ViewSkin = {
  /** 主题类（提供 CSS 变量）+ 原把手配色 */
  cls: string;
  Icon: ComponentType<{ size?: number | string }>;
};

// 画布/工坊/剪辑：原 cv-panel cv-btn 把手（bg=--canvas-panel，恰为其顶栏底色）
const CANVAS_SKIN_CLS =
  'canvas-dark border border-[var(--canvas-node-border)] bg-[var(--canvas-panel)] text-[var(--canvas-text-2)] hover:bg-[var(--canvas-controls-hover)] hover:text-[var(--canvas-text-1)]';
// chat/微信/飞书：原幽灵把手，透明底透出页面底色
const CHAT_SKIN_CLS =
  'text-[rgb(var(--c-text-muted))] hover:text-[rgb(var(--c-text))] hover:bg-[rgb(var(--c-border))]';

// 视图 → 把手皮肤（图标+配色，沿用原把手）；不登记的视图走默认。改这里，不动任何视图。
const VIEW_SKINS: Partial<Record<ActiveView, ViewSkin>> = {
  chat: { cls: CHAT_SKIN_CLS, Icon: Menu },
  wechat: { cls: CHAT_SKIN_CLS, Icon: Menu },
  lark: { cls: CHAT_SKIN_CLS, Icon: Menu },
  canvas: { cls: CANVAS_SKIN_CLS, Icon: CanvasIcon },
  workshop: { cls: CANVAS_SKIN_CLS, Icon: PanelLeftOpen },
  editor: { cls: CANVAS_SKIN_CLS, Icon: PanelLeftOpen },
  copywriting: {
    cls: 'copywriting-light text-[var(--cw-text-muted)] hover:text-[var(--cw-text-2)] hover:bg-[var(--cw-card)]',
    Icon: PanelLeftOpen,
  },
  library: { cls: 'bg-white text-stone-500 hover:bg-stone-100', Icon: PanelLeftOpen },
  projects: { cls: 'bg-stone-50 text-stone-500 hover:bg-stone-100', Icon: PanelLeftOpen },
};
const DEFAULT_SKIN: ViewSkin = {
  cls: 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-500/10',
  Icon: PanelLeftOpen,
};

export default function SidebarHandle() {
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar);
  const activeView = useChatStore((s) => s.activeView);

  if (!sidebarCollapsed) return null;
  const { cls, Icon } = VIEW_SKINS[activeView] ?? DEFAULT_SKIN;

  return (
    <button
      onClick={toggleSidebar}
      className={`absolute left-3 top-3 z-30 flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${cls}`}
      title="展开侧边栏"
    >
      <Icon size={16} />
    </button>
  );
}
