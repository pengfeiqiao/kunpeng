/**
 * editorHistory — 剪辑器独立撤销/重做栈（画布 history 只管 canvasStore，
 * 不能混用）。快照 editorStore 的内容字段，UI 在每次破坏性操作前调
 * captureEditorSnapshot()。
 */
import { useEditorStore } from '@/stores/editorStore';
import { useSyncExternalStore } from 'react';

const SNAP_FIELDS = [
  'clips', 'bgm', 'aspect', 'audioTracks', 'audioClips', 'subtitles',
  'overlayClips', 'textClips', 'fxClips', 'markers',
] as const;

type Snapshot = Record<string, unknown>;

const past: Snapshot[] = [];
const future: Snapshot[] = [];
const MAX = 50;
const listeners = new Set<() => void>();

function notify() { listeners.forEach((l) => l()); }

function take(): Snapshot {
  const s = useEditorStore.getState() as unknown as Record<string, unknown>;
  const snap: Snapshot = {};
  for (const f of SNAP_FIELDS) snap[f] = s[f];
  return snap;
}

function apply(snap: Snapshot) {
  useEditorStore.setState(snap as never);
}

export function captureEditorSnapshot(): void {
  past.push(take());
  if (past.length > MAX) past.shift();
  future.length = 0;
  notify();
}

export function undoEditor(): void {
  const prev = past.pop();
  if (!prev) return;
  future.push(take());
  apply(prev);
  notify();
}

export function redoEditor(): void {
  const next = future.pop();
  if (!next) return;
  past.push(take());
  apply(next);
  notify();
}

export function clearEditorHistory(): void {
  past.length = 0;
  future.length = 0;
  notify();
}

// getSnapshot 必须返回引用稳定的对象，否则 useSyncExternalStore 死循环
let memo = { canUndo: false, canRedo: false };
function getHistState() {
  const canUndo = past.length > 0;
  const canRedo = future.length > 0;
  if (memo.canUndo !== canUndo || memo.canRedo !== canRedo) memo = { canUndo, canRedo };
  return memo;
}

/** React hook：撤销/重做可用性（驱动按钮置灰） */
export function useEditorHistoryState(): { canUndo: boolean; canRedo: boolean } {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    getHistState,
  );
}
