import type { WorkshopData } from '../workshop/types.ts';

/** Entry depends on hydrated project identity, never on having assets or unarchived objects. */
export function canOpenProjectWorkspace(activeId: string | null, projectId: string | undefined, data: WorkshopData | null): boolean {
  return Boolean(activeId && activeId === projectId && data?.projectId === activeId
    && data.projectSpec && data.projectObjects?.projectId === activeId);
}
