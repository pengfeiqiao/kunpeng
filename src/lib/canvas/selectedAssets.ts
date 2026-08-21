/**
 * selectedAssets — session-scoped selection of library assets to attach to
 * the NEXT generation (NodeInfoBar reads it when building referenceUrls /
 * audioUrls / style prompt). Kept outside zustand persist deliberately.
 */
import { useSyncExternalStore } from 'react';

export interface AttachedAsset {
  id: string;
  name: string;
  type: 'character' | 'product' | 'scene' | 'voice' | 'style';
  images?: string[];
  audioPath?: string;
  stylePrompt?: string;
}

let selection: AttachedAsset[] = [];
const listeners = new Set<() => void>();

function emit() { for (const l of listeners) l(); }

export function toggleAsset(a: AttachedAsset): void {
  const i = selection.findIndex((x) => x.id === a.id);
  if (i >= 0) selection = selection.filter((x) => x.id !== a.id);
  else selection = [...selection, a];
  emit();
}

export function clearAssets(): void {
  if (selection.length === 0) return;
  selection = [];
  emit();
}

export function getSelectedAssets(): AttachedAsset[] { return selection; }

export function useSelectedAssets(): AttachedAsset[] {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => selection,
  );
}
