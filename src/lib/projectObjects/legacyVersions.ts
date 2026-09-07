import type { UnifiedProjectRegistry } from './types.ts';

/** Old outputs may predate version records. Preserve identity and unknown history. */
export function reconcileLegacyMediaVersions(registry: UnifiedProjectRegistry): UnifiedProjectRegistry {
  const versions = [...registry.versions];
  const owners = new Set(registry.objects.filter((item) => !item.archived).map((item) => item.id));
  let changed = false;
  const media = registry.media.map((item) => {
    if (!item.ownerObjectId || !owners.has(item.ownerObjectId) || item.archived
      || (item.purpose !== 'candidate-version' && item.purpose !== 'current-version')
      || item.source === 'legacy-storyboard' || !['image', 'video', 'audio'].includes(item.mediaType)) return item;
    const existing = versions.find((version) => version.mediaObjectId === item.id && version.ownerObjectId === item.ownerObjectId);
    if (existing) {
      if (item.versionObjectId === existing.id) return item;
      changed = true;
      return { ...item, versionObjectId: existing.id };
    }
    // Never label a freshly reconciled generated output as adopted implicitly.
    const selected = item.purpose === 'current-version' && !versions.some((version) => version.ownerObjectId === item.ownerObjectId
      && version.selected && registry.media.some((media) => media.id === version.mediaObjectId && media.mediaType === item.mediaType));
    const id = `asset-version:legacy:${item.id}`;
    versions.push({ id, projectId: item.projectId, kind: 'asset-version', source: item.source, sourceId: item.id,
      label: '历史版本', relationIds: [item.ownerObjectId, item.id], version: 1, updatedAt: item.updatedAt,
      ownerObjectId: item.ownerObjectId, mediaObjectId: item.id,
      ordinal: Math.max(0, ...versions.filter((version) => version.ownerObjectId === item.ownerObjectId).map((version) => version.ordinal)) + 1,
      selected, locked: item.locked,
    });
    changed = true;
    return { ...item, versionObjectId: id };
  });
  return changed ? { ...registry, media, versions } : registry;
}
