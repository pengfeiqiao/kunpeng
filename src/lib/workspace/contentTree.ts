import type { WorkspaceContentGroup } from './contentModel.ts';

export interface WorkspaceContentSection { id: string; label: string; groups: WorkspaceContentGroup[]; nested: boolean }

/** Navigation is a projection; scene runs retain narrative order. */
export function workspaceContentTree(groups: WorkspaceContentGroup[]): WorkspaceContentSection[] {
  const assets = groups.filter((group) => group.id === 'assets').flatMap((group) => group.items);
  const assetGroups = ([['character', '角色'], ['scene', '场景'], ['prop', '道具'], ['scene-asset', '其他元素']] as const)
    .map(([kind, label]) => ({ id: `assets:${kind}`, label, items: assets.filter((item) => item.kind === kind) })).filter((group) => group.items.length);
  return [
    ...(assetGroups.length ? [{ id: 'elements', label: '项目元素', groups: assetGroups, nested: true }] : []),
    { id: 'shots', label: '分镜', groups: groups.filter((group) => group.id.startsWith('scene-run:')), nested: true },
    ...groups.filter((group) => group.id !== 'assets' && !group.id.startsWith('scene-run:'))
      .map((group) => ({ id: group.id, label: group.label, groups: [group], nested: false })),
  ];
}
