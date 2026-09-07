import type { WorkshopAssetKind, WorkshopData } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects, stableProjectObjectId } from '../projectObjects/migrate.ts';
import { initialWorkspaceDraft, saveWorkspaceDraft, workspaceDraftErrors } from './drafts.ts';
import { editWorkspaceAssetSettings } from './assetEdits.ts';
import { workspaceAsset } from './assetDraftModel.ts';
import type { WorkspaceDraft } from './types.ts';

/** Legacy buttons prepare the same visible draft. No hidden rewriting or paid execution here. */
export function prepareWorkspaceAssetGeneration(input: WorkshopData, kind: WorkshopAssetKind, id: string, engineId?: string,
  now = Date.now()): { data: WorkshopData; draft: WorkspaceDraft } | { error: string } {
  const objectId = stableProjectObjectId(kind === 'colorPalette' ? 'scene-asset' : kind, id);
  let data = input.projectObjects ? input : migrateWorkshopProjectObjects(input, now);
  const target = workspaceAsset(data, objectId);
  const owner = data.projectObjects!.objects.find((item) => item.id === objectId);
  if (!target || !owner || owner.archived) return { error: '资产不存在或已归档，请刷新项目' };
  if (owner.locked) return { error: '资产已锁定，请先解锁' };
  if (engineId) data = editWorkspaceAssetSettings(data, kind, id, { engineId }, now);
  const draft = initialWorkspaceDraft(data, objectId, 'image', now);
  if (!draft) return { error: '无法读取资产草稿' };
  const errors = workspaceDraftErrors(draft);
  if (errors.length) return { error: errors.join('；') };
  // Materialize on first use; do not bump a saved draft merely by opening confirmation.
  if (!data.workspaceDrafts?.[draft.id]) data = saveWorkspaceDraft(data, draft, 0, now)!;
  return { data, draft: data.workspaceDrafts![draft.id] };
}
