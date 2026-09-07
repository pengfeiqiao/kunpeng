import type { AssetCandidate, WorkshopAssetKind, WorkshopData } from '../workshop/types.ts';
import { stableProjectObjectId } from '../projectObjects/migrate.ts';
import { assetCollection } from './assetDraftModel.ts';
import { workspaceMediaVersions } from './mediaView.ts';

/** Read projection for compatibility dialogs; never copies generated versions back into arrays. */
export function workspaceAssetCandidates(data: Pick<WorkshopData, 'characters' | 'scenes' | 'props' | 'colorPalettes' | 'projectObjects' | 'shots' | 'workspaceSubmissions'>, kind: WorkshopAssetKind, id: string): AssetCandidate[] {
  const objectId = stableProjectObjectId(kind === 'colorPalette' ? 'scene-asset' : kind, id);
  const legacy = data[assetCollection[kind]].find((item) => item.id === id)?.candidates ?? [];
  const current = workspaceMediaVersions(data, objectId, 'image');
  const candidates = current.map(({ media, version, snapshot }): AssetCandidate => ({
    ...legacy.find((item) => item.path === media.path), path: media.path,
    source: media.source === 'generated' ? 'generate' : media.source === 'canvas' ? 'canvas' : 'upload',
    prompt: snapshot?.prompt ?? version?.prompt, engineId: snapshot?.engineId ?? version?.engineId,
    createdAt: media.updatedAt, revision: version?.version,
  }));
  const knownPaths = new Set(data.projectObjects?.media.filter((item) => item.ownerObjectId === objectId).map((item) => item.path));
  // Some old upload/variant writers are not indexed until save/load. Keep those visible;
  // an indexed archived/historical file must not reappear via its old cached candidate.
  return candidates.concat(legacy.filter((item) => !knownPaths.has(item.path)));
}
