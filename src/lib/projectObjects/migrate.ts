import { reconcileLegacyMediaVersions } from './legacyVersions.ts';
import { projectWorkspacePrompt } from '../workspace/draftProjection.ts';
import type {
  AssetCandidate,
  DirectorConstraintCard,
  WorkshopData,
  WsCharacter,
  WsColorPalette,
  WsProp,
  WsScene,
  WsShot,
} from '../workshop/types.ts';
import {
  PROJECT_OBJECT_SCHEMA_VERSION,
  defaultProjectSpec,
  type AssetVersionRecord,
  type MediaFileRecord,
  type MediaPurpose,
  type ProjectObjectRecord,
  type ProjectObjectSource,
  type UnifiedProjectRegistry,
} from './types.ts';
import { videoPromptForShot, type ShotRefsContext } from '../workshop/shotRefs.ts';

export function stableProjectHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function stableProjectObjectId(kind: ProjectObjectRecord['kind'], sourceId: string): string {
  return `${kind}:${sourceId}`;
}

function mediaType(path: string): MediaFileRecord['mediaType'] {
  const clean = path.split(/[?#]/)[0].toLowerCase();
  if (/\.(png|jpe?g|webp|gif|heic|avif)$/.test(clean)) return 'image';
  if (/\.(mp4|mov|m4v|webm|avi|mkv)$/.test(clean)) return 'video';
  if (/\.(mp3|wav|m4a|aac|flac|ogg)$/.test(clean)) return 'audio';
  if (/\.(pdf|docx?|md|txt|rtf)$/.test(clean)) return 'document';
  return 'unknown';
}

function sourceForCandidate(candidate: AssetCandidate): ProjectObjectSource {
  if (candidate.source === 'generate') return 'generated';
  if (candidate.source === 'upload' || candidate.source === 'default') return 'uploaded';
  if (candidate.source === 'canvas') return 'canvas';
  return 'imported';
}

function makeObject(
  data: WorkshopData,
  kind: ProjectObjectRecord['kind'],
  sourceId: string,
  label: string,
  relationIds: string[],
  now: number,
  source: ProjectObjectSource = 'workshop',
): ProjectObjectRecord {
  return {
    id: stableProjectObjectId(kind, sourceId),
    projectId: data.projectId,
    kind,
    source,
    sourceId,
    label,
    relationIds: [...new Set(relationIds.filter(Boolean))],
    version: 1,
    updatedAt: now,
  };
}

interface RegistryBuilder {
  objects: ProjectObjectRecord[];
  media: MediaFileRecord[];
  versions: AssetVersionRecord[];
  seenMedia: Set<string>;
}

function addMedia(
  builder: RegistryBuilder,
  data: WorkshopData,
  path: string | undefined,
  ownerObjectId: string | undefined,
  purpose: MediaPurpose,
  source: ProjectObjectSource,
  now: number,
  options: { label?: string; existingId?: string } = {},
): MediaFileRecord | undefined {
  if (!path) return undefined;
  const key = `${ownerObjectId ?? 'project'}\u0000${purpose}\u0000${path}`;
  if (builder.seenMedia.has(key)) {
    return builder.media.find((item) => `${item.ownerObjectId ?? 'project'}\u0000${item.purpose}\u0000${item.path}` === key);
  }
  builder.seenMedia.add(key);
  const id = options.existingId ?? `media-file:${stableProjectHash(key)}`;
  const record: MediaFileRecord = {
    id,
    projectId: data.projectId,
    kind: 'media-file',
    source,
    sourceId: path,
    label: options.label ?? path.split('/').pop() ?? path,
    relationIds: ownerObjectId ? [ownerObjectId] : [],
    version: 1,
    updatedAt: now,
    path,
    mediaType: mediaType(path),
    purpose,
    ownerObjectId,
  };
  builder.media.push(record);
  return record;
}

function addCandidateVersions(
  builder: RegistryBuilder,
  data: WorkshopData,
  ownerObjectId: string,
  selectedPath: string | undefined,
  candidates: AssetCandidate[] | undefined,
  now: number,
): void {
  const list = [...(candidates ?? [])];
  if (selectedPath && !list.some((item) => item.path === selectedPath)) {
    list.unshift({ path: selectedPath, source: 'upload', createdAt: now });
  }
  let nextOrdinal = Math.max(0, ...(data.projectObjects?.versions.filter((item) => item.ownerObjectId === ownerObjectId).map((item) => item.ordinal) ?? []));
  list.forEach((candidate, index) => {
    const selected = Boolean(selectedPath && candidate.path === selectedPath);
    const candidateVersionId = `asset-version:${stableProjectHash(`${ownerObjectId}\u0000${candidate.clientToken ?? candidate.path}`)}`;
    // A generated version is already authoritative. The selected legacy path is
    // its projection, not an instruction to create a second uploaded version.
    const previousVersion = data.projectObjects?.versions.find((item) => item.id === candidateVersionId)
      ?? data.projectObjects?.versions.find((item) => item.ownerObjectId === ownerObjectId
        && data.projectObjects?.media.some((media) => media.id === item.mediaObjectId && media.path === candidate.path));
    const versionId = previousVersion?.id ?? candidateVersionId;
    const previousMedia = data.projectObjects?.media.find((item) => item.id === previousVersion?.mediaObjectId && item.path === candidate.path);
    const media = addMedia(
      builder,
      data,
      candidate.path,
      ownerObjectId,
      selected ? 'current-version' : 'candidate-version',
      sourceForCandidate(candidate),
      candidate.createdAt || now,
      { existingId: previousMedia?.id },
    );
    if (!media) return;
    if (previousMedia) Object.assign(media, previousMedia, { purpose: selected ? 'current-version' : 'candidate-version' });
    const ordinal = previousVersion?.ordinal ?? ++nextOrdinal;
    const version: AssetVersionRecord = {
      id: versionId,
      projectId: data.projectId,
      kind: 'asset-version',
      source: sourceForCandidate(candidate),
      sourceId: candidate.clientToken ?? candidate.path,
      label: `版本 ${ordinal}`,
      relationIds: [ownerObjectId, media.id],
      version: candidate.revision ?? index + 1,
      updatedAt: candidate.createdAt || now,
      ownerObjectId,
      mediaObjectId: media.id,
      ordinal,
      selected,
      prompt: previousVersion?.prompt ?? candidate.prompt,
      engineId: previousVersion?.engineId ?? candidate.engineId,
      ...(previousVersion ? { source: previousVersion.source, sourceId: previousVersion.sourceId,
        generationSnapshot: previousVersion.generationSnapshot } : {}),
    };
    media.versionObjectId = version.id;
    builder.versions.push(version);
  });
}

function addAsset<T extends WsCharacter | WsScene | WsProp | WsColorPalette>(
  builder: RegistryBuilder,
  data: WorkshopData,
  kind: 'character' | 'scene' | 'prop' | 'scene-asset',
  item: T,
  now: number,
): void {
  const id = stableProjectObjectId(kind, item.id);
  builder.objects.push(makeObject(data, kind, item.id, item.name, [], now));
  addCandidateVersions(builder, data, id, item.assetImagePath, item.candidates, now);
}

function addDirectorConstraint(
  builder: RegistryBuilder,
  data: WorkshopData,
  subject: { id?: string; shotNo: string },
  card: DirectorConstraintCard,
  now: number,
  ownerKind: 'shot' | 'scene' = 'shot',
): void {
  const shotId = stableProjectObjectId(ownerKind, subject.id ?? subject.shotNo);
  const id = stableProjectObjectId('director-constraint', card.id);
  builder.objects.push(makeObject(data, 'director-constraint', card.id, `导演约束 ${subject.shotNo}`, [shotId], card.createdAt || now));
  addMedia(
    builder,
    data,
    card.imagePath,
    id,
    card.useInVideo ? 'generation-reference' : 'ordinary-material',
    card.source === 'generate' ? 'generated' : card.source === 'canvas' ? 'canvas' : 'imported',
    card.createdAt || now,
  );
  addCandidateVersions(builder, data, id, card.imagePath, card.candidates, now);
}

function addShotMedia(builder: RegistryBuilder, data: WorkshopData, shot: WsShot, now: number): void {
  const shotObjectId = stableProjectObjectId('shot', shot.id ?? shot.shotNo);
  const addOutput = (path: string | undefined, label: string) => {
    const previous = data.projectObjects?.media.find((media) => media.ownerObjectId === shotObjectId && media.path === path
      && media.versionObjectId && media.purpose !== 'historical')
      ?? data.projectObjects?.media.find((media) => media.ownerObjectId === shotObjectId && media.path === path
        && (media.purpose === 'candidate-version' || media.purpose === 'current-version'));
    const media = addMedia(builder, data, path, shotObjectId, previous?.purpose ?? 'candidate-version', previous?.source ?? 'generated', now,
      { label, existingId: previous?.id });
    if (!media || !previous) return;
    Object.assign(media, previous);
    const version = data.projectObjects?.versions.find((item) => item.id === previous.versionObjectId);
    if (version && !builder.versions.some((item) => item.id === version.id)) builder.versions.push(version);
  };
  addOutput(shot.imagePath, `${shot.shotNo} 分镜图`);
  addOutput(shot.videoPath, `${shot.shotNo} 视频`);
  (shot.extraRefImages ?? []).forEach((path) => addMedia(
    builder,
    data,
    path,
    shotObjectId,
    'generation-reference',
    'imported',
    now,
  ));
  (shot.directorPrevisVideoPaths ?? []).forEach((path) => addMedia(
    builder,
    data,
    path,
    shotObjectId,
    'ordinary-material',
    'editor',
    now,
  ));
  (shot.generatedAudios ?? []).forEach((audio) => addMedia(
    builder,
    data,
    audio.path,
    shotObjectId,
    'candidate-version',
    'generated',
    now,
    { label: `${shot.shotNo} ${audio.characterName} 配音` },
  ));

  // Legacy storyboards remain downloadable and viewable, but never enter
  // generation references or request-local @图片N numbering by default.
  (shot.storyboardFrames ?? []).forEach((frame) => {
    addMedia(builder, data, frame.imagePath, shotObjectId, 'historical', 'legacy-storyboard', now, { label: `${shot.shotNo} 历史分镜 ${frame.id}` });
    (frame.candidates ?? []).forEach((candidate) => addMedia(
      builder,
      data,
      candidate.path,
      shotObjectId,
      'historical',
      'legacy-storyboard',
      candidate.createdAt || now,
    ));
  });
  (shot.storyboardBoards ?? []).forEach((board) => addMedia(
    builder,
    data,
    board.imagePath,
    shotObjectId,
    'historical',
    'legacy-storyboard',
    board.createdAt || now,
    { label: `${shot.shotNo} 历史故事板` },
  ));
}

function preserveMutableMetadata(
  next: UnifiedProjectRegistry,
  previous: UnifiedProjectRegistry | undefined,
): UnifiedProjectRegistry {
  // Preserve IDs, files and per-shot references. The unused global flag never
  // affected submissions, so migrating it must not create new reference edges.
  const normalizeMedia = (item: MediaFileRecord): MediaFileRecord => {
    const { includeAsReference: _legacyFlag, ...rest } = item;
    return { ...rest, purpose: item.purpose === 'generation-reference' ? 'ordinary-material' : item.purpose };
  };
  next = { ...next, media: next.media.map(normalizeMedia) };
  if (previous) previous = { ...previous, media: previous.media.map(normalizeMedia) };
  if (!previous) return next;
  const oldById = new Map([
    ...previous.objects,
    ...previous.media,
    ...previous.versions,
  ].map((item) => [item.id, item]));
  const comparable = (item: ProjectObjectRecord): string => {
    const { version: _version, updatedAt: _updatedAt, locked: _locked, archived: _archived, ...rest } = item;
    return JSON.stringify(rest);
  };
  const merge = <T extends ProjectObjectRecord>(item: T): T => {
    const old = oldById.get(item.id);
    if (!old) return item;
    if (item.kind === 'media-file' && old.kind === 'media-file') {
      const nextMedia = item as unknown as MediaFileRecord;
      const oldMedia = old as MediaFileRecord;
      if (!nextMedia.versionObjectId && oldMedia.versionObjectId && nextMedia.path === oldMedia.path
        && nextMedia.ownerObjectId === oldMedia.ownerObjectId) {
        item = { ...item, versionObjectId: oldMedia.versionObjectId };
      }
    }
    const unchanged = comparable(item) === comparable(old);
    return {
      ...item,
      version: unchanged ? old.version : Math.max(item.version, old.version + 1),
      updatedAt: unchanged ? old.updatedAt : item.updatedAt,
      locked: old.locked,
      archived: old.archived,
    } as T;
  };
  const nextObjectIds = new Set(next.objects.map((item) => item.id));
  const preservedObjects = previous.objects.filter((item) => (
    !nextObjectIds.has(item.id)
    && item.source !== 'workshop'
    && item.source !== 'system'
    && item.source !== 'legacy-storyboard'
  ));
  const allObjectIds = new Set([
    ...nextObjectIds,
    ...preservedObjects.map((item) => item.id),
  ]);
  const nextMediaIds = new Set(next.media.map((item) => item.id));
  const preservedMedia = previous.media.filter((item) => (
    !nextMediaIds.has(item.id)
    && item.source !== 'legacy-storyboard'
    && Boolean(
      item.canvasNodeId
      || item.generationTaskId
      || item.purpose === 'unclassified'
      || (item.ownerObjectId && allObjectIds.has(item.ownerObjectId))
    )
  ));
  const allMediaIds = new Set([
    ...nextMediaIds,
    ...preservedMedia.map((item) => item.id),
  ]);
  const nextVersionIds = new Set(next.versions.map((item) => item.id));
  const preservedVersions = previous.versions.filter((item) => (
    !nextVersionIds.has(item.id)
    && allObjectIds.has(item.ownerObjectId)
    && allMediaIds.has(item.mediaObjectId)
  ));

  const merged = {
    ...next,
    objects: [...next.objects, ...preservedObjects].map(merge),
    media: [...next.media, ...preservedMedia].map(merge),
    versions: [...next.versions, ...preservedVersions].map(merge),
    migratedLegacyStoryboardAt: previous.migratedLegacyStoryboardAt ?? next.migratedLegacyStoryboardAt,
  };
  const unchanged = (
    JSON.stringify(merged.objects) === JSON.stringify(previous.objects)
    && JSON.stringify(merged.media) === JSON.stringify(previous.media)
    && JSON.stringify(merged.versions) === JSON.stringify(previous.versions)
    && merged.migratedLegacyStoryboardAt === previous.migratedLegacyStoryboardAt
  );
  return unchanged ? { ...merged, updatedAt: previous.updatedAt } : merged;
}

function migrateLegacyStoryboardPrompts(data: WorkshopData): WorkshopData {
  const isFirstRegistryMigration = (
    !data.projectObjects
    || (data.schemaVersion ?? 0) < PROJECT_OBJECT_SCHEMA_VERSION
  );
  if (!isFirstRegistryMigration) return data;

  const ctx: ShotRefsContext = {
    scenes: data.scenes,
    characters: data.characters,
    props: data.props,
    colorPalettes: data.colorPalettes,
    globalColorPaletteId: data.globalColorPaletteId,
  };
  let changed = false;
  const shots = data.shots.map((shot) => {
    const hasActiveLegacyBoard = (shot.storyboardBoards ?? []).some((board) => (
      Boolean(board.imagePath) && board.useInVideo !== false
    ));
    if (!hasActiveLegacyBoard) return shot;

    const videoPrompt = videoPromptForShot(shot, ctx, {
      template: 'legacy',
      includeStoryboardBoards: false,
    });
    const universalVideoPrompt = shot.universalVideoPrompt?.trim()
      ? videoPromptForShot(shot, ctx, {
          template: 'universal',
          includeStoryboardBoards: false,
        })
      : shot.universalVideoPrompt;
    if (videoPrompt === shot.videoPrompt && universalVideoPrompt === shot.universalVideoPrompt) return shot;
    changed = true;
    return { ...shot, videoPrompt, universalVideoPrompt };
  });
  return changed ? { ...data, shots } : data;
}

/** Reconcile legacy workshop data into the stable registry. Idempotent. */
export function migrateWorkshopProjectObjects(data: WorkshopData, now = Date.now()): WorkshopData {
  const migratedData = migrateLegacyStoryboardPrompts(data);
  const builder: RegistryBuilder = { objects: [], media: [], versions: [], seenMedia: new Set() };
  const specId = stableProjectObjectId('project-spec', migratedData.projectId);
  builder.objects.push(makeObject(migratedData, 'project-spec', migratedData.projectId, '项目规格', [], now, 'system'));
  builder.objects.push(makeObject(migratedData, 'script', migratedData.projectId, '项目剧本', [specId], now));
  migratedData.characters.forEach((item) => addAsset(builder, migratedData, 'character', item, now));
  migratedData.scenes.forEach((item) => addAsset(builder, migratedData, 'scene', item, now));
  migratedData.scenes.forEach((item) => {
    if (item.directorConstraintCard) addDirectorConstraint(builder, migratedData, { id: item.id, shotNo: item.name }, item.directorConstraintCard, now, 'scene');
  });
  migratedData.props.forEach((item) => addAsset(builder, migratedData, 'prop', item, now));
  migratedData.colorPalettes.forEach((item) => addAsset(builder, migratedData, 'scene-asset', item, now));

  let hasLegacyStoryboards = false;
  migratedData.shots.forEach((shot) => {
    const sourceId = shot.id ?? shot.shotNo;
    const relations = [
      shot.sceneId ? stableProjectObjectId('scene', shot.sceneId) : '',
      ...shot.characterIds.map((id) => stableProjectObjectId('character', id)),
      ...(shot.propIds ?? []).map((id) => stableProjectObjectId('prop', id)),
    ];
    builder.objects.push(makeObject(migratedData, 'shot', sourceId, `镜头 ${shot.shotNo}`, relations, now));
    if (shot.directorConstraintCard) addDirectorConstraint(builder, migratedData, shot, shot.directorConstraintCard, now);
    if ((shot.storyboardFrames?.length ?? 0) > 0 || (shot.storyboardBoards?.length ?? 0) > 0) hasLegacyStoryboards = true;
    addShotMedia(builder, migratedData, shot, now);
  });

  const registry = preserveMutableMetadata({
    schemaVersion: PROJECT_OBJECT_SCHEMA_VERSION,
    projectId: migratedData.projectId,
    objects: builder.objects,
    media: builder.media,
    versions: builder.versions,
    migratedLegacyStoryboardAt: hasLegacyStoryboards
      ? migratedData.projectObjects?.migratedLegacyStoryboardAt ?? now
      : migratedData.projectObjects?.migratedLegacyStoryboardAt,
    updatedAt: now,
  }, migratedData.projectObjects);

  const result = {
    ...migratedData,
    schemaVersion: Math.max(migratedData.schemaVersion ?? 0, PROJECT_OBJECT_SCHEMA_VERSION),
    projectSpec: migratedData.projectSpec ?? defaultProjectSpec(now),
    projectObjects: reconcileLegacyMediaVersions(registry),
    projectViewState: migratedData.projectViewState ?? {},
  };
  return Object.values(result.workspaceDrafts ?? {}).reduce(projectWorkspacePrompt, result);
}
