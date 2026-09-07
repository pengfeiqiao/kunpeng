import type { ProjectObjectRecord, UnifiedProjectRegistry } from './types';

export type ConflictResolution = 'keep-user' | 'apply-agent' | 'keep-both';

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface ProjectChangeSet {
  id: string;
  objectId: string;
  actor: 'agent' | 'user';
  baseVersion: number;
  appliedVersion: number;
  changes: FieldChange[];
  createdAt: number;
  target?: 'registry' | 'workshop-shot';
  sourceId?: string;
}

export interface ProjectWriteConflict {
  objectId: string;
  expectedVersion: number;
  currentVersion: number;
  current: ProjectObjectRecord;
  intended: Record<string, unknown>;
  choices: ConflictResolution[];
  target?: 'registry' | 'workshop-shot';
  sourceId?: string;
  currentValues?: Record<string, unknown>;
}

export type ApplyProjectObjectPatchResult =
  | { status: 'applied'; registry: UnifiedProjectRegistry; changeSet: ProjectChangeSet }
  | { status: 'not-found'; registry: UnifiedProjectRegistry }
  | { status: 'locked'; registry: UnifiedProjectRegistry; object: ProjectObjectRecord }
  | { status: 'conflict'; registry: UnifiedProjectRegistry; conflict: ProjectWriteConflict };

function allRecords(registry: UnifiedProjectRegistry): ProjectObjectRecord[] {
  return [...registry.objects, ...registry.media, ...registry.versions];
}

function changedFields(current: ProjectObjectRecord, patch: Partial<ProjectObjectRecord>): FieldChange[] {
  return Object.entries(patch)
    .filter(([field, value]) => !['id', 'projectId', 'kind', 'source', 'version', 'updatedAt', 'includeAsReference'].includes(field)
      && !(field === 'purpose' && value === 'generation-reference'))
    .filter(([field, after]) => !Object.is(current[field as keyof ProjectObjectRecord], after))
    .map(([field, after]) => ({ field, before: current[field as keyof ProjectObjectRecord], after }));
}

function replaceRecord(
  registry: UnifiedProjectRegistry,
  objectId: string,
  replacement: ProjectObjectRecord,
  now: number,
): UnifiedProjectRegistry {
  return {
    ...registry,
    updatedAt: now,
    objects: registry.objects.map((item) => item.id === objectId ? replacement : item),
    media: registry.media.map((item) => item.id === objectId ? replacement as typeof item : item),
    versions: registry.versions.map((item) => item.id === objectId ? replacement as typeof item : item),
  };
}

export function applyProjectObjectPatch(
  registry: UnifiedProjectRegistry,
  input: {
    objectId: string;
    expectedVersion: number;
    patch: Partial<ProjectObjectRecord>;
    actor: 'agent' | 'user';
    now?: number;
  },
): ApplyProjectObjectPatchResult {
  const current = allRecords(registry).find((item) => item.id === input.objectId);
  if (!current) return { status: 'not-found', registry };
  if (input.actor === 'agent' && current.locked) return { status: 'locked', registry, object: current };
  if (current.version !== input.expectedVersion) {
    return {
      status: 'conflict',
      registry,
      conflict: {
        objectId: input.objectId,
        expectedVersion: input.expectedVersion,
        currentVersion: current.version,
        current,
        intended: input.patch as Record<string, unknown>,
        choices: ['keep-user', 'apply-agent', 'keep-both'],
      },
    };
  }
  const now = input.now ?? Date.now();
  const changes = changedFields(current, input.patch);
  const next = {
    ...current,
    ...Object.fromEntries(changes.map((item) => [item.field, item.after])),
    version: current.version + 1,
    updatedAt: now,
  } as ProjectObjectRecord;
  return {
    status: 'applied',
    registry: replaceRecord(registry, current.id, next, now),
    changeSet: {
      id: `change:${current.id}:${now}`,
      objectId: current.id,
      actor: input.actor,
      baseVersion: current.version,
      appliedVersion: next.version,
      changes,
      createdAt: now,
    },
  };
}

/** Undo only fields that still equal the Agent-written value. Later user edits survive. */
export function undoProjectChangeSet(
  registry: UnifiedProjectRegistry,
  changeSet: ProjectChangeSet,
  now = Date.now(),
): { registry: UnifiedProjectRegistry; revertedFields: string[]; skippedFields: string[] } {
  const current = allRecords(registry).find((item) => item.id === changeSet.objectId);
  if (!current) return { registry, revertedFields: [], skippedFields: changeSet.changes.map((item) => item.field) };
  const patch: Record<string, unknown> = {};
  const revertedFields: string[] = [];
  const skippedFields: string[] = [];
  for (const change of changeSet.changes) {
    if (Object.is(current[change.field as keyof ProjectObjectRecord], change.after)) {
      patch[change.field] = change.before;
      revertedFields.push(change.field);
    } else {
      skippedFields.push(change.field);
    }
  }
  if (revertedFields.length === 0) return { registry, revertedFields, skippedFields };
  const next = {
    ...current,
    ...patch,
    version: current.version + 1,
    updatedAt: now,
  } as ProjectObjectRecord;
  return { registry: replaceRecord(registry, current.id, next, now), revertedFields, skippedFields };
}

export function summarizeChangeSets(changeSets: ProjectChangeSet[]): string[] {
  const objectCount = new Set(changeSets.map((item) => item.objectId)).size;
  const fieldCount = changeSets.reduce((sum, item) => sum + item.changes.length, 0);
  return [
    `修改了 ${objectCount} 个对象`,
    `更新了 ${fieldCount} 个字段`,
  ];
}
