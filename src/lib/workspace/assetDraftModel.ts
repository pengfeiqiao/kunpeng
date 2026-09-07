import type { WorkshopAssetKind, WorkshopData, WsCharacter, WsScene, WsProp, WsColorPalette } from '../workshop/types.ts';

export type WorkspaceAsset = WsCharacter | WsScene | WsProp | WsColorPalette;
export const assetCollection = { character: 'characters', scene: 'scenes', prop: 'props', colorPalette: 'colorPalettes' } as const;
export function workspaceAsset(data: WorkshopData, objectId: string): { kind: WorkshopAssetKind; asset: WorkspaceAsset } | undefined {
  const owner = data.projectObjects?.objects.find((item) => item.id === objectId);
  const kind = owner?.kind === 'scene-asset' ? 'colorPalette' : owner?.kind;
  if (!kind || !(kind in assetCollection)) return undefined;
  const asset = data[assetCollection[kind as WorkshopAssetKind]].find((item) => item.id === owner!.sourceId);
  return asset ? { kind: kind as WorkshopAssetKind, asset } : undefined;
}
export function assetPromptField(kind: WorkshopAssetKind, engine: string): 'assetPrompt' | 'assetPromptMj' {
  return kind !== 'colorPalette' && engine.startsWith('midjourney') ? 'assetPromptMj' : 'assetPrompt';
}
export function readAssetPrompt(asset: WorkspaceAsset, field: 'assetPrompt' | 'assetPromptMj'): string | undefined {
  return field === 'assetPrompt' ? asset.assetPrompt : (asset as WsCharacter).assetPromptMj;
}
export function patchWorkspaceAsset(data: WorkshopData, kind: WorkshopAssetKind, id: string, patch: Partial<WorkspaceAsset>): WorkshopData {
  const key = assetCollection[kind];
  return { ...data, [key]: data[key].map((item) => item.id === id ? { ...item, ...patch } : item) };
}
