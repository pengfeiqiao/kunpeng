import type { WorkspaceLayoutWidths } from '../projectObjects/types.ts';

export const DEFAULT_WORKSPACE_LAYOUT_WIDTHS: Readonly<WorkspaceLayoutWidths> = { content: 320, assistant: 360 };
export const WORKSPACE_COLUMN_LIMITS = {
  content: { min: 220, max: 480 },
  assistant: { min: 280, max: 560 },
} as const;
export const WORKSPACE_CENTER_MIN = 420;
export const WORKSPACE_COLUMN_GAP = 8;
export const WORKSPACE_ASSISTANT_RAIL = 36;
export interface WorkspaceLayoutColumns {
  content: boolean;
  assistant: boolean;
  collapsed: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export function normalizeWorkspaceLayoutWidths(value?: Partial<WorkspaceLayoutWidths>): WorkspaceLayoutWidths {
  const width = (key: keyof WorkspaceLayoutWidths) => {
    const number = value?.[key];
    return typeof number === 'number' && Number.isFinite(number)
      ? clamp(Math.round(number), WORKSPACE_COLUMN_LIMITS[key].min, WORKSPACE_COLUMN_LIMITS[key].max)
      : DEFAULT_WORKSPACE_LAYOUT_WIDTHS[key];
  };
  return { content: width('content'), assistant: width('assistant') };
}

/** Fit the display only. Viewport changes must never overwrite a project's preferred widths. */
export function fitWorkspaceLayoutWidths(value: Partial<WorkspaceLayoutWidths> | undefined, availableWidth: number, columns: WorkspaceLayoutColumns) {
  const widths = normalizeWorkspaceLayoutWidths(value);
  const available = Number.isFinite(availableWidth) ? Math.max(0, Math.floor(availableWidth)) : 0;
  const rail = !columns.assistant && columns.collapsed ? WORKSPACE_ASSISTANT_RAIL : 0;
  const gap = WORKSPACE_COLUMN_GAP * (Number(columns.content) + Number(columns.assistant || Boolean(rail)));
  const minimum = WORKSPACE_CENTER_MIN + gap + rail
    + (columns.content ? WORKSPACE_COLUMN_LIMITS.content.min : 0)
    + (columns.assistant ? WORKSPACE_COLUMN_LIMITS.assistant.min : 0);
  if (available < minimum) return { ...widths, center: available, compact: true };
  const budget = available - WORKSPACE_CENTER_MIN - gap - rail;
  const used = (columns.content ? widths.content : 0) + (columns.assistant ? widths.assistant : 0);
  let deficit = Math.max(0, used - budget);
  // Reduce both panes toward their usable minimums, then give rounding slack back to the center.
  const contentSlack = columns.content ? widths.content - WORKSPACE_COLUMN_LIMITS.content.min : 0;
  const assistantSlack = columns.assistant ? widths.assistant - WORKSPACE_COLUMN_LIMITS.assistant.min : 0;
  const slack = contentSlack + assistantSlack;
  if (deficit && slack) {
    const reduction = Math.min(contentSlack, Math.ceil(deficit * contentSlack / slack));
    widths.content -= reduction;
    deficit -= reduction;
    widths.assistant -= Math.min(assistantSlack, deficit);
  }
  return { ...widths, compact: false, center: available - gap - rail
    - (columns.content ? widths.content : 0) - (columns.assistant ? widths.assistant : 0) };
}

export function workspaceColumnMaximum(column: keyof WorkspaceLayoutWidths, availableWidth: number,
  widths: WorkspaceLayoutWidths, columns: WorkspaceLayoutColumns): number {
  const other = column === 'content' ? (columns.assistant ? widths.assistant : columns.collapsed ? WORKSPACE_ASSISTANT_RAIL : 0)
    : columns.content ? widths.content : 0;
  const gaps = WORKSPACE_COLUMN_GAP * (Number(columns.content) + Number(columns.assistant || columns.collapsed));
  return Math.max(WORKSPACE_COLUMN_LIMITS[column].min,
    Math.min(WORKSPACE_COLUMN_LIMITS[column].max, Math.floor(availableWidth) - WORKSPACE_CENTER_MIN - other - gaps));
}

export function resizeWorkspaceColumn(value: WorkspaceLayoutWidths, column: keyof WorkspaceLayoutWidths,
  width: number, availableWidth: number, columns: WorkspaceLayoutColumns): WorkspaceLayoutWidths {
  const fitted = fitWorkspaceLayoutWidths(value, availableWidth, columns);
  if (fitted.compact || !columns[column] || !Number.isFinite(width)) return normalizeWorkspaceLayoutWidths(value);
  return { content: fitted.content, assistant: fitted.assistant,
    [column]: clamp(Math.round(width), WORKSPACE_COLUMN_LIMITS[column].min, workspaceColumnMaximum(column, availableWidth, fitted, columns)) };
}

export function workspaceColumnKeyboardDelta(column: keyof WorkspaceLayoutWidths, key: string, shiftKey = false): number | null {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
  return (key === 'ArrowRight' ? 1 : -1) * (column === 'content' ? 1 : -1) * (shiftKey ? 40 : 10);
}
