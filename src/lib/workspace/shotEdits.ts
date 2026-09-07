import type { WorkshopData, WsShot } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects, stableProjectObjectId } from '../projectObjects/migrate.ts';
import { calibrateWorkspaceDraft, changeWorkspaceReferences, initialWorkspaceDraft, saveWorkspaceDraft, workspaceDraftKey } from './drafts.ts';
import { workspaceEngine } from './engineCatalog.ts';
import { shotVideoSettings } from './shotDraftModel.ts';

/** Validate the whole merge before publishing; shot numbers are labels, not object identity. */
export function mergeWorkspaceShots(input: WorkshopData, incoming: WsShot[], createId: () => string, now = Date.now()): WorkshopData {
  if (!incoming.length) return input;
  const normalized = input.shots.some((shot) => !shot.id)
    ? { ...input, shots: input.shots.map((shot) => shot.id ? shot : { ...shot, id: shot.shotNo }) } : input;
  const data = normalized.projectObjects ? normalized : migrateWorkshopProjectObjects(normalized, now);
  const usedIds = new Set<string>();
  const planned = incoming.map((patch) => {
    const existing = patch.id
      ? data.shots.find((shot) => shot.id === patch.id)
      : data.shots.find((shot) => shot.shotNo === patch.shotNo);
    const id = existing?.id ?? patch.id ?? createId();
    if (usedIds.has(id) || (!existing && data.shots.some((shot) => shot.id === id))) throw new Error('批量镜头包含重复对象，请刷新后重试');
    usedIds.add(id);
    const owner = data.projectObjects?.objects.find((item) => item.id === stableProjectObjectId('shot', id));
    if (owner?.locked || owner?.archived) throw new Error(`镜头 ${existing?.shotNo ?? patch.shotNo} 已锁定或归档，未写入本批修改`);
    return { existing, patch: { ...patch, id,
      characterIds: patch.characterIds ?? existing?.characterIds ?? [],
      voiceCharacterIds: patch.voiceCharacterIds ?? existing?.voiceCharacterIds ?? [],
    } };
  });
  const finalNos = data.shots.filter((shot) => !planned.some((item) => item.existing === shot)).map((shot) => shot.shotNo);
  for (const { patch } of planned) {
    if (finalNos.includes(patch.shotNo)) throw new Error(`镜号 ${patch.shotNo} 已被其他对象使用，未写入本批修改`);
    finalNos.push(patch.shotNo);
  }
  // Apply edits against original labels first, allowing simultaneous renumbering.
  let next = data;
  for (const { existing, patch } of planned) {
    if (existing) next = editWorkspaceShot(next, existing.shotNo, { ...patch, shotNo: existing.shotNo }, now);
  }
  next = { ...next, shots: next.shots.map((shot) => {
    const plannedShot = planned.find((item) => item.existing?.id === shot.id && item.existing);
    return plannedShot ? { ...shot, shotNo: plannedShot.patch.shotNo } : shot;
  }).concat(planned.filter((item) => !item.existing).map(({ patch }) => ({
    ...patch, characterIds: patch.characterIds ?? [], voiceCharacterIds: patch.voiceCharacterIds ?? [], workspaceReferenceProjection: undefined,
  }))) };
  next = migrateWorkshopProjectObjects(next, now);
  for (const { existing, patch } of planned) {
    if (!existing) next = editWorkspaceShot(next, patch.shotNo, patch, now);
  }
  return next;
}

/** Compatibility edits only change explicitly addressed prompt/parameter fields of the shared draft. */
export function editWorkspaceShot(input: WorkshopData, shotNo: string, patch: Partial<WsShot>, now = Date.now()): WorkshopData {
  const data = input.projectObjects ? input : migrateWorkshopProjectObjects(input, now);
  const shot = data.shots.find((item) => item.shotNo === shotNo);
  if (!shot) return input;
  const objectId = stableProjectObjectId('shot', shot.id ?? shot.shotNo);
  const owner = data.projectObjects?.objects.find((item) => item.id === objectId);
  const runtimeOnly = Object.keys(patch).every((key) => ['genStatus', 'genError', 'genTaskId', 'canvasNodeId'].includes(key));
  if (owner?.archived || (owner?.locked && !runtimeOnly)) return input;
  const nextShot = { ...shot, ...patch, workspaceReferenceProjection: shot.workspaceReferenceProjection };
  let next = { ...data, shots: data.shots.map((item) => item === shot ? nextShot : item) };
  const template = nextShot.videoPromptTemplate ?? data.videoPromptTemplate ?? 'legacy';
  const videoChanged = Object.prototype.hasOwnProperty.call(patch, 'videoPromptTemplate')
    || (template === 'legacy' ? patch.videoPrompt !== undefined
      : patch.universalVideoPrompt !== undefined || patch.seedance25VideoPrompt !== undefined);
  const has = (key: keyof WsShot) => Object.prototype.hasOwnProperty.call(patch, key);
  const settingsChanged = has('videoModel') || has('videoRatio') || has('durationSec');
  for (const type of ['image', 'video'] as const) {
    if (type === 'image' ? patch.imagePrompt === undefined : !videoChanged && !settingsChanged) continue;
    const key = workspaceDraftKey(objectId, type);
    const existing = data.workspaceDrafts?.[key];
    const drafts = { ...next.workspaceDrafts }; delete drafts[key];
    const source = initialWorkspaceDraft({ ...next, workspaceDrafts: drafts }, objectId, type, now);
    if (!source) continue;
    // A legacy @ ordinal refers to that legacy entry's collection. Rebase it
    // by original path, without silently adding missing references to the draft.
    const sourceRefs = source.references.map((ref) => ({ ...ref, id: existing?.references.find((item) => item.path === ref.path && item.type === ref.type)?.id ?? ref.id }));
    const rebased = existing ? changeWorkspaceReferences({ ...source, references: sourceRefs }, existing.references) : source;
    let updated = { ...(existing ?? source),
      ...(type === 'image' || videoChanged ? { prompt: rebased.prompt } : {}),
      ...(type === 'video' ? { promptTemplate: template } : {}) };
    if (type === 'video' && settingsChanged) {
      const settings = shotVideoSettings(next, nextShot);
      updated = { ...updated, ...(has('videoModel') ? { engineId: settings.engineId } : {}), params: { ...updated.params,
        ...(has('videoRatio') ? { ratio: settings.ratio } : {}),
        ...(has('durationSec') ? { duration: settings.duration } : {}),
      } };
      const engine = workspaceEngine(updated.engineId);
      if (engine) updated = calibrateWorkspaceDraft(updated, engine).draft;
    }
    const saved = saveWorkspaceDraft(next, updated, existing?.revision ?? 0, now);
    if (saved) next = saved;
  }
  return { ...next, ...(next.projectObjects && owner && !runtimeOnly ? { projectObjects: { ...next.projectObjects, updatedAt: now,
    objects: next.projectObjects.objects.map((item) => item.id === owner.id ? { ...item, version: owner.version + 1, updatedAt: now } : item),
  } } : {}) };
}

export function editWorkspaceProjectVideoSettings(input: WorkshopData, settings: Pick<Partial<WorkshopData>, 'videoModel' | 'videoRatio'>, now = Date.now()): WorkshopData {
  const keys = (['videoModel', 'videoRatio'] as const).filter((key) => Object.prototype.hasOwnProperty.call(settings, key) && settings[key] !== input[key]);
  if (!keys.length) return input;
  const data = input.projectObjects ? input : migrateWorkshopProjectObjects(input, now);
  const inherited = data.shots.map((shot) => ({ shot, keys: keys.filter((key) => !shot[key]) }));
  for (const { shot, keys: fields } of inherited) {
    const owner = data.projectObjects!.objects.find((item) => item.id === stableProjectObjectId('shot', shot.id ?? shot.shotNo));
    if (fields.length && owner?.locked) throw new Error(`镜头 ${shot.shotNo} 已锁定且继承项目设置，请先解除锁定或仅修改其他镜头`);
  }
  let next = { ...data, ...settings };
  for (const { shot, keys: fields } of inherited) {
    if (fields.length && data.workspaceDrafts?.[workspaceDraftKey(stableProjectObjectId('shot', shot.id ?? shot.shotNo), 'video')]) {
      next = editWorkspaceShot(next, shot.shotNo, Object.fromEntries(fields.map((key) => [key, undefined])), now);
    }
  }
  return next;
}

export function editWorkspaceProjectTemplate(data: WorkshopData, template: 'legacy' | 'universal', now = Date.now()): WorkshopData {
  let next: WorkshopData = { ...data, videoPromptTemplate: template };
  for (const shot of data.shots) {
    if (!shot.videoPromptTemplate && next.workspaceDrafts?.[workspaceDraftKey(stableProjectObjectId('shot', shot.id ?? shot.shotNo), 'video')]) {
      next = editWorkspaceShot(next, shot.shotNo, { videoPromptTemplate: undefined }, now);
    }
  }
  return next;
}
