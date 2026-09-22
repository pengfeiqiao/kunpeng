import type { WorkshopData } from './types';

// View selection and immutable history do not alter the object/media registry.
const presentationKeys = new Set(['projectViewState', 'projectSnapshots', 'projectBranches']);
export function createWorkshopSaveNormalizer(normalize: (data: WorkshopData) => WorkshopData) {
  let previous: WorkshopData | undefined;
  return (data: WorkshopData): WorkshopData => {
    if (previous && data.projectViewState) {
      const keys = new Set([...Object.keys(previous), ...Object.keys(data)]);
      if ([...keys].every(key => presentationKeys.has(key)
        || previous![key as keyof WorkshopData] === data[key as keyof WorkshopData])) return data;
    }
    const normalized = normalize(data);
    // Do not retain tens of MB of historical payloads just to compare live fields.
    const { projectSnapshots: _snapshots, projectBranches: _branches, ...live } = normalized;
    previous = live;
    return normalized;
  };
}
