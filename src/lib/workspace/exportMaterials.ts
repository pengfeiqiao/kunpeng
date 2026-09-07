import type { WorkshopData } from '../workshop/types.ts';

export interface MaterialExportGroup { folder: string; paths: string[] }

/** Collect project media into categorized folders: 资产图 / 镜头图片 / 视频 / 音频 / 其他素材. */
export function collectProjectMaterials(data: WorkshopData): MaterialExportGroup[] {
  const registry = data.projectObjects;
  if (!registry) return [];
  const ownersById = new Map(registry.objects.map((item) => [item.id, item]));
  const groups: Record<string, Set<string>> = {
    '资产图': new Set(), '镜头图片': new Set(), '视频': new Set(), '音频': new Set(), '其他素材': new Set(),
  };
  for (const media of registry.media) {
    if (media.archived || !media.path || media.purpose === 'historical') continue;
    const owner = media.ownerObjectId ? ownersById.get(media.ownerObjectId) : undefined;
    if (media.mediaType === 'audio') groups['音频'].add(media.path);
    else if (media.mediaType === 'video') groups['视频'].add(media.path);
    else if (owner && ['character', 'scene', 'prop', 'scene-asset'].includes(owner.kind)) groups['资产图'].add(media.path);
    else if (owner?.kind === 'shot') groups['镜头图片'].add(media.path);
    else groups['其他素材'].add(media.path);
  }
  return Object.entries(groups).map(([folder, paths]) => ({ folder, paths: [...paths] })).filter((group) => group.paths.length);
}
