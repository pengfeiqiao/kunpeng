export interface MicrocompactPolicy {
  preserveFullToolHistory: boolean;
  recentToolKeep: number;
  protectedToolHardLimit: number;
  protectedToolHeadChars: number;
  protectedToolTailChars: number;
}

const SMALL_WINDOW_RECENT_TOOL_KEEP = 4;
const MEDIUM_WINDOW_RECENT_TOOL_KEEP = 10;
const LARGE_WINDOW_RECENT_TOOL_KEEP = 48;
const RECENT_COMPACTABLE_TOOL_HARD_LIMIT = 12_000;
const LARGE_WINDOW_TOOL_HARD_LIMIT = 160_000;
const RECENT_COMPACTABLE_TOOL_HEAD_CHARS = 7_000;
const RECENT_COMPACTABLE_TOOL_TAIL_CHARS = 1_800;
const LARGE_WINDOW_TOOL_HEAD_CHARS = 112_000;
const LARGE_WINDOW_TOOL_TAIL_CHARS = 24_000;
const LARGE_WINDOW_FULL_HISTORY_PRESSURE = 0.82;

/**
 * Decide how much reproducible tool history to retain for the active model.
 * This is deliberately pure so changes to context policy stay testable.
 */
export function getMicrocompactPolicy(
  maxTokens: number,
  estimatedTokens: number,
): MicrocompactPolicy {
  const pressure = maxTokens > 0 ? estimatedTokens / maxTokens : 1;
  const isLargeWindow = maxTokens >= 900_000;
  return {
    preserveFullToolHistory: isLargeWindow && pressure < LARGE_WINDOW_FULL_HISTORY_PRESSURE,
    recentToolKeep: isLargeWindow
      ? LARGE_WINDOW_RECENT_TOOL_KEEP
      : maxTokens >= 240_000
        ? MEDIUM_WINDOW_RECENT_TOOL_KEEP
        : SMALL_WINDOW_RECENT_TOOL_KEEP,
    protectedToolHardLimit: isLargeWindow
      ? LARGE_WINDOW_TOOL_HARD_LIMIT
      : RECENT_COMPACTABLE_TOOL_HARD_LIMIT,
    protectedToolHeadChars: isLargeWindow
      ? LARGE_WINDOW_TOOL_HEAD_CHARS
      : RECENT_COMPACTABLE_TOOL_HEAD_CHARS,
    protectedToolTailChars: isLargeWindow
      ? LARGE_WINDOW_TOOL_TAIL_CHARS
      : RECENT_COMPACTABLE_TOOL_TAIL_CHARS,
  };
}
