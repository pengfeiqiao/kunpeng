import type { WorkshopData, WsShot } from '../workshop/types.ts';
import { buildImageRefBindings, buildVideoRefBindings, remapShotPromptRefs } from '../workshop/shotRefs.ts';
import { migrateWorkshopProjectObjects, stableProjectObjectId } from '../projectObjects/migrate.ts';
import { changeWorkspaceReferences, initialWorkspaceDraft, saveWorkspaceDraft } from './drafts.ts';
import { editWorkspaceShot } from './shotEdits.ts';
import type { WorkspaceDraft, WorkspaceReference } from './types.ts';

function legacyReferences(data: WorkshopData, shot: WsShot, type: 'image' | 'video'): WorkspaceReference[] {
  const raw = { ...shot, workspaceReferenceProjection: undefined };
  const ctx = { ...data, props: data.props ?? [], colorPalettes: data.colorPalettes ?? [] };
  const images = type === 'image' ? buildImageRefBindings(raw, ctx) : buildVideoRefBindings(raw, ctx);
  const refs: WorkspaceReference[] = images.map((ref) => {
    const kind = ref.kind === 'palette' ? 'scene-asset' : ref.kind === 'directorConstraintCard' ? 'director-constraint' : ref.kind;
    const objectId = ref.id && kind !== 'extra' && kind !== 'storyboardBoard' ? `${kind}:${ref.id}` : undefined;
    const media = data.projectObjects?.media.find((item) => item.path === ref.path && (!objectId || item.ownerObjectId === objectId));
    return { id: `legacy:${ref.kind}:${ref.id ?? ''}:${ref.path}`, type: 'image', path: ref.path, label: ref.label,
      objectId, versionId: media?.versionObjectId, ...(kind === 'director-constraint' ? { role: 'director-constraint' as const } : {}) };
  });
  if (type === 'video') {
    for (const path of shot.directorPrevisVideoPaths ?? []) refs.push({ id: `legacy:video:${path}`, type: 'video', path, label: '导演预演视频' });
    if (shot.audioInjected) {
      for (const audio of shot.generatedAudios ?? []) {
        const path = audio.trimmedPath || audio.path;
        refs.push({ id: `legacy:audio:${path}`, type: 'audio', path, label: audio.characterName });
      }
    } else for (const id of shot.voiceCharacterIds ?? []) {
      const character = data.characters.find((item) => item.id === id);
      if (character?.voicePath) refs.push({ id: `legacy:voice:${id}`, objectId: stableProjectObjectId('character', id),
        type: 'audio', path: character.voicePath, label: character.name });
    }
  }
  return refs.filter((ref, index) => refs.findIndex((item) => item.type === ref.type && item.path === ref.path) === index);
}

export function legacyShotDraft(data: WorkshopData, shot: WsShot, type: 'image' | 'video', now = Date.now()): WorkspaceDraft | null {
  const draft = initialWorkspaceDraft(data, stableProjectObjectId('shot', shot.id ?? shot.shotNo), type, now);
  if (!draft || data.workspaceDrafts?.[draft.id]) return draft;
  return { ...draft, references: shot.workspaceReferenceProjection?.[type] ?? legacyReferences(data, shot, type) };
}

const GROUPS = [
  ['sceneId', 'sceneImagePaths'], ['characterIds'], ['propIds'], ['extraRefImages'], ['colorPaletteId'],
  ['directorConstraintCard'], ['directorPrevisVideoPaths'], ['voiceCharacterIds', 'audioInjected', 'generatedAudios'],
] as const;
const PREFIXES = ['scene', 'character', 'prop', 'extra', 'palette', 'directorConstraintCard', 'video', 'audio|voice'];
const sameRef = (a: WorkspaceReference, b: WorkspaceReference) => a.type === b.type && a.path === b.path;

/** Legacy reference controls edit the same draft, preserving references outside the requested field group. */
export function editLegacyShotReferences(input: WorkshopData, shotNo: string, patch: Partial<WsShot>, now = Date.now(), referenceData?: WorkshopData): WorkshopData {
  input = input.projectObjects ? input : migrateWorkshopProjectObjects(input, now);
  const shot = input.shots.find((item) => item.shotNo === shotNo);
  if (!shot) return input;
  if (patch.id !== undefined && patch.id !== (shot.id ?? shot.shotNo)) throw new Error('不能通过镜头编辑更改稳定 ID');
  const groups = GROUPS.map((fields, index) => ({ fields, prefixes: PREFIXES[index].split('|') }))
    .filter(({ fields }) => fields.some((key) => Object.prototype.hasOwnProperty.call(patch, key)));
  if (!groups.length) return editWorkspaceShot(input, shotNo, patch, now);
  const owner = input.projectObjects?.objects.find((item) => item.id === stableProjectObjectId('shot', shot.id ?? shot.shotNo));
  if (owner?.locked || owner?.archived) throw new Error('镜头已锁定或归档，未修改参考');
  // Apply facts/parameters first; prompt patches are handled against their explicitly supplied reference order below.
  let next = editWorkspaceShot(referenceData ?? input, shotNo, { ...patch, referenceRevision: (shot.referenceRevision ?? 0) + 1 }, now);
  for (const type of ['image', 'video'] as const) {
    const before = legacyShotDraft(input, shot, type, now);
    if (!before) continue;
    let references = before.references;
    for (const group of groups) {
      const fields = Object.fromEntries(group.fields.map((key) => [key, patch[key as keyof WsShot] === undefined && !Object.prototype.hasOwnProperty.call(patch, key)
        ? shot[key as keyof WsShot] : patch[key as keyof WsShot]]));
      const belongs = (ref: WorkspaceReference) => group.prefixes.some((prefix) => ref.id.startsWith(`legacy:${prefix}:`));
      const oldRefs = legacyReferences(input, shot, type).filter(belongs);
      const newRefs = legacyReferences(next, { ...shot, ...fields }, type).filter(belongs);
      const added = newRefs.filter((ref) => !oldRefs.some((item) => sameRef(ref, item)));
      const managed = references.filter((ref) => oldRefs.some((old) => sameRef(old, ref)));
      const replacements = newRefs.filter((ref) => added.some((item) => sameRef(item, ref)) || managed.some((item) => sameRef(item, ref)))
        .map((ref) => ({ ...ref, id: references.find((item) => sameRef(item, ref))?.id ?? ref.id }));
      const insertion = references.findIndex((ref) => managed.includes(ref));
      const retained = references.filter((ref) => !managed.includes(ref));
      retained.splice(insertion < 0 ? retained.length : insertion, 0, ...replacements);
      references = retained;
    }
    const rebased = changeWorkspaceReferences(before, references);
    const current = next.workspaceDrafts?.[before.id];
    const template = patch.videoPromptTemplate ?? shot.videoPromptTemplate ?? input.videoPromptTemplate ?? 'legacy';
    const explicitPrompt = type === 'image' ? patch.imagePrompt : template === 'legacy' ? patch.videoPrompt : patch.universalVideoPrompt ?? patch.seedance25VideoPrompt;
    const legacyRemap = remapShotPromptRefs(shot, { ...shot, ...patch }, input, input);
    const remappedPrompt = type === 'image' ? legacyRemap.imagePrompt : template === 'legacy'
      ? legacyRemap.videoPrompt : legacyRemap.universalVideoPrompt ?? legacyRemap.seedance25VideoPrompt;
    const isCompatibilityRemap = explicitPrompt === remappedPrompt || explicitPrompt === before.prompt;
    const draft = { ...(current ?? before), references: rebased.references,
      prompt: explicitPrompt !== undefined && !isCompatibilityRemap ? explicitPrompt : rebased.prompt };
    const saved = saveWorkspaceDraft(next, draft, current?.revision ?? 0, now);
    if (!saved) throw new Error('参考草稿已改变，未写入修改');
    next = saved;
  }
  return next;
}

export function setLegacySceneReferences(input: WorkshopData, sceneId: string, paths: string[], now = Date.now()): WorkshopData {
  const data = input.projectObjects ? input : migrateWorkshopProjectObjects(input, now);
  const owner = data.projectObjects!.objects.find((item) => item.id === stableProjectObjectId('scene', sceneId));
  if (!owner || owner.locked || owner.archived) throw new Error('场景不存在、已锁定或归档');
  const clean = [...new Set(paths.filter(Boolean))];
  let next: WorkshopData = { ...data, scenes: data.scenes.map((scene) => scene.id === sceneId
    ? { ...scene, selectedImagePaths: clean, sceneReferenceMode: clean.length ? 'multi' : undefined } : scene) };
  for (const shot of data.shots.filter((item) => item.sceneId === sceneId && !item.sceneImagePaths)) {
    next = editLegacyShotReferences({ ...next, scenes: data.scenes }, shot.shotNo, { sceneImagePaths: undefined }, now, next);
  }
  return next;
}

export function setLegacyGlobalPalette(input: WorkshopData, paletteId?: string, now = Date.now()): WorkshopData {
  const data = input.projectObjects ? input : migrateWorkshopProjectObjects(input, now);
  if (paletteId && !data.colorPalettes.some((palette) => palette.id === paletteId)) throw new Error('色卡不存在');
  let next: WorkshopData = { ...data, globalColorPaletteId: paletteId || undefined };
  for (const shot of data.shots.filter((item) => !item.colorPaletteId)) {
    next = editLegacyShotReferences({ ...next, globalColorPaletteId: data.globalColorPaletteId }, shot.shotNo, { colorPaletteId: undefined }, now, next);
  }
  return next;
}

/** Adoption changes a display slot, not an already chosen generation reference. Freeze legacy defaults on first change. */
export function preserveLegacyReferenceDrafts(before: WorkshopData, after: WorkshopData, now = Date.now()): WorkshopData {
  const source = before.projectObjects ? before : migrateWorkshopProjectObjects(before, now);
  let next = after.projectObjects ? after : migrateWorkshopProjectObjects(after, now);
  for (const shot of source.shots) {
    const target = next.shots.find((item) => (item.id ?? item.shotNo) === (shot.id ?? shot.shotNo));
    if (!target) continue;
    for (const type of ['image', 'video'] as const) {
      if (JSON.stringify(legacyReferences(source, shot, type)) === JSON.stringify(legacyReferences(next, target, type))) continue;
      const draft = legacyShotDraft(source, shot, type, now);
      if (!draft) continue;
      const existing = next.workspaceDrafts?.[draft.id];
      if (!existing) {
        // 尚无草稿：用最新投影创建（原行为）
        const saved = saveWorkspaceDraft(next, draft, 0, now);
        if (!saved) throw new Error('受影响镜头已锁定，未更改其参考默认值');
        next = saved;
        continue;
      }
      // 只回填"创建时资产未定版导致引用为空"的草稿：资产后绑定图片时把当前投影灌进去。
      // 已有引用的草稿遵循采用冻结——换定版图绝不静默改写既有参考（原设计契约）。
      const afterRefs = legacyReferences(next, target, type);
      if (existing.references.length > 0 || !afterRefs.length) continue;
      const rebased = changeWorkspaceReferences(existing, afterRefs);
      const saved = saveWorkspaceDraft(next, { ...existing, references: rebased.references, prompt: rebased.prompt }, existing.revision, now);
      if (saved) next = saved; // 草稿并发修改/锁定时放弃本次自动回填，不覆盖
    }
  }
  return next;
}
