export interface TailWindow<T> {
  startIndex: number;
  items: T[];
  hasEarlier: boolean;
}

/** Returns a stable tail window without copying the hidden prefix into the UI. */
export function tailWindow<T>(items: T[], visibleCount: number): TailWindow<T> {
  const safeCount = Math.max(0, Math.floor(visibleCount));
  const startIndex = Math.max(0, items.length - safeCount);
  return {
    startIndex,
    items: items.slice(startIndex),
    hasEarlier: startIndex > 0,
  };
}
