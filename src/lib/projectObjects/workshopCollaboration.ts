import type { WorkshopData, WsShot } from '../workshop/types.ts';
import { stableProjectObjectId } from './migrate.ts';
import type { ProjectChangeSet, ProjectWriteConflict } from './collaboration.ts';
import type { ProjectObjectRecord, UnifiedProjectRegistry } from './types.ts';
import { editLegacyShotReferences } from '../workspace/legacyShotReferences.ts';

export type ApplyWorkshopShotPatchResult =
  | { status: 'applied'; data: WorkshopData; changeSet: ProjectChangeSet }
  | { status: 'not-found'; data: WorkshopData }
  | { status: 'locked'; data: WorkshopData; object: ProjectObjectRecord }
  | { status: 'conflict'; data: WorkshopData; conflict: ProjectWriteConflict };

function equalValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function replaceShotObject(
  registry: UnifiedProjectRegistry,
  objectId: string,
  replacement: ProjectObjectRecord,
  now: number,
): UnifiedProjectRegistry {
  return {
    ...registry,
    updatedAt: now,
    objects: registry.objects.map((item) => item.id === objectId ? replacement : item),
  };
}

export function workshopShotObject(data: WorkshopData, shotNo: string): ProjectObjectRecord | undefined {
  const shot = data.shots.find((item) => item.shotNo === shotNo);
  if (!shot || !data.projectObjects) return undefined;
  const objectId = stableProjectObjectId('shot', shot.id ?? shot.shotNo);
  return data.projectObjects.objects.find((item) => item.id === objectId);
}

export function applyWorkshopShotPatch(
  data: WorkshopData,
  input: {
    shotNo: string;
    expectedVersion: number;
    patch: Partial<WsShot>;
    actor: 'agent' | 'user';
    now?: number;
  },
): ApplyWorkshopShotPatchResult {
  const shot = data.shots.find((item) => item.shotNo === input.shotNo);
  const registry = data.projectObjects;
  const current = workshopShotObject(data, input.shotNo);
  if (!shot || !registry || !current) return { status: 'not-found', data };
  if (input.actor === 'agent' && current.locked) return { status: 'locked', data, object: current };
  if (current.version !== input.expectedVersion) {
    const keys = Object.keys(input.patch) as Array<keyof WsShot>;
    return {
      status: 'conflict',
      data,
      conflict: {
        objectId: current.id,
        expectedVersion: input.expectedVersion,
        currentVersion: current.version,
        current,
        intended: input.patch as Record<string, unknown>,
        currentValues: Object.fromEntries(keys.map((key) => [String(key), shot[key]])),
        choices: ['keep-user', 'apply-agent'],
        target: 'workshop-shot',
        sourceId: shot.shotNo,
      },
    };
  }
  const changes = Object.entries(input.patch)
    .filter(([, value]) => value !== undefined)
    .filter(([field, value]) => !equalValue(shot[field as keyof WsShot], value))
    .map(([field, after]) => ({ field, before: shot[field as keyof WsShot], after }));
  const now = input.now ?? Date.now();
  const edited = editLegacyShotReferences(data, input.shotNo, Object.fromEntries(changes.map((item) => [item.field, item.after])), now);
  if (edited === data && current.locked) return { status: 'locked', data, object: current };
  const nextObject = { ...current, version: current.version + 1, updatedAt: now };
  return {
    status: 'applied',
    data: {
      ...edited,
      projectObjects: replaceShotObject(edited.projectObjects!, current.id, nextObject, now),
    },
    changeSet: {
      id: `change:${current.id}:${now}`,
      objectId: current.id,
      actor: input.actor,
      baseVersion: current.version,
      appliedVersion: nextObject.version,
      changes,
      createdAt: now,
      target: 'workshop-shot',
      sourceId: shot.shotNo,
    },
  };
}

/** Undo only fields that still equal the Agent-written value. */
export function undoWorkshopShotChange(
  data: WorkshopData,
  changeSet: ProjectChangeSet,
  now = Date.now(),
): { data: WorkshopData; revertedFields: string[]; skippedFields: string[] } {
  const shotNo = changeSet.sourceId;
  const shot = shotNo ? data.shots.find((item) => item.shotNo === shotNo) : undefined;
  const registry = data.projectObjects;
  const current = shotNo ? workshopShotObject(data, shotNo) : undefined;
  if (!shot || !registry || !current) {
    return { data, revertedFields: [], skippedFields: changeSet.changes.map((item) => item.field) };
  }
  const patch: Partial<WsShot> = {};
  const revertedFields: string[] = [];
  const skippedFields: string[] = [];
  for (const change of changeSet.changes) {
    if (equalValue(shot[change.field as keyof WsShot], change.after)) {
      (patch as Record<string, unknown>)[change.field] = change.before;
      revertedFields.push(change.field);
    } else {
      skippedFields.push(change.field);
    }
  }
  if (revertedFields.length === 0) return { data, revertedFields, skippedFields };
  const nextObject = { ...current, version: current.version + 1, updatedAt: now };
  const edited = editLegacyShotReferences(data, shotNo!, patch, now);
  if (edited === data) return { data, revertedFields: [], skippedFields: changeSet.changes.map((item) => item.field) };
  return {
    data: {
      ...edited,
      projectObjects: replaceShotObject(edited.projectObjects!, current.id, nextObject, now),
    },
    revertedFields,
    skippedFields,
  };
}
