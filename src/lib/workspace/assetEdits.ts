import type { WorkshopAssetKind, WorkshopData } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects, stableProjectObjectId } from '../projectObjects/migrate.ts';
import { calibrateWorkspaceDraft, initialWorkspaceDraft, saveWorkspaceDraft } from './drafts.ts';
import { assetPromptField, patchWorkspaceAsset, readAssetPrompt, workspaceAsset } from './assetDraftModel.ts';
import { workspaceEngine } from './engineCatalog.ts';

export function editWorkspaceAssetSettings(input: WorkshopData, kind: WorkshopAssetKind, id: string,
  settings: { engineId?: string; resolution?: string; aspectRatio?: string }, now = Date.now()): WorkshopData {
  const data = input.projectObjects ? input : migrateWorkshopProjectObjects(input, now);
  const objectId = stableProjectObjectId(kind === 'colorPalette' ? 'scene-asset' : kind, id);
  const target = workspaceAsset(data, objectId);
  const draft = target && initialWorkspaceDraft(data, objectId, 'image', now);
  if (!draft || !target) return input;
  let updated = draft;
  if (settings.engineId && settings.engineId !== draft.engineId) {
    const engine = workspaceEngine(settings.engineId);
    updated = engine ? calibrateWorkspaceDraft(draft, engine).draft : { ...draft, engineId: settings.engineId };
    if (assetPromptField(kind, draft.engineId) !== assetPromptField(kind, settings.engineId)) {
      updated = { ...updated, prompt: readAssetPrompt(target.asset, assetPromptField(kind, settings.engineId)) ?? updated.prompt };
    }
  }
  updated = { ...updated, params: { ...updated.params,
    ...(settings.resolution !== undefined ? { resolution: settings.resolution } : {}),
    ...(settings.aspectRatio !== undefined ? { aspectRatio: settings.aspectRatio } : {}),
  } };
  return saveWorkspaceDraft(data, updated, draft.revision, now) ?? input;
}

export function editWorkspaceAssetPrompt(input: WorkshopData, kind: WorkshopAssetKind, id: string, prompt: string, engine: 'gpt' | 'mj' = 'gpt', now = Date.now()): WorkshopData {
  const data = input.projectObjects ? input : migrateWorkshopProjectObjects(input, now);
  const objectId = stableProjectObjectId(kind === 'colorPalette' ? 'scene-asset' : kind, id);
  const owner = data.projectObjects!.objects.find((item) => item.id === objectId);
  const target = workspaceAsset(data, objectId);
  if (!target || owner?.locked || owner?.archived) return input;
  const draft = initialWorkspaceDraft(data, objectId, 'image', now)!;
  const field = assetPromptField(kind, engine === 'mj' ? 'midjourney' : 'gpt');
  if (field === assetPromptField(kind, draft.engineId)) {
    return saveWorkspaceDraft(data, { ...draft, prompt }, draft.revision, now) ?? input;
  }
  // Inactive template is retained but must not replace the currently selected model's draft.
  const patched = patchWorkspaceAsset(data, kind, id, { [field]: prompt });
  return { ...patched, projectObjects: { ...data.projectObjects!, updatedAt: now,
    objects: data.projectObjects!.objects.map((item) => item.id === objectId ? { ...item, version: item.version + 1, updatedAt: now } : item),
  } };
}
