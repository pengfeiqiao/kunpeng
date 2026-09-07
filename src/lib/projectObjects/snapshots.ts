import type { WorkshopData } from '@/lib/workshop/types';
import type {
  ProjectBranchRecord,
  ProjectCanvasSnapshot,
  ProjectSnapshotRecord,
} from './types';

const MAX_PROJECT_SNAPSHOTS = 40;
const EMBEDDED_MEDIA_RE = /^data:(?:image|video|audio)\/[a-z0-9.+-]+;base64,/i;

export function projectSnapshotList(data: Pick<WorkshopData, 'projectSnapshots'>): ProjectSnapshotRecord[] {
  return [...(data.projectSnapshots ?? [])].sort((a, b) => b.createdAt - a.createdAt);
}

function stableId(prefix: string, now: number): string {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${now}-${suffix}`;
}

function withoutHistory(data: WorkshopData): WorkshopData {
  const { projectSnapshots: _snapshots, projectBranches: _branches, ...rest } = data;
  return rest as WorkshopData;
}

function serializeWithoutEmbeddedMedia(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === 'string' && EMBEDDED_MEDIA_RE.test(item)) return undefined;
    return item;
  });
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])];
}

function collectMediaPaths(data: WorkshopData, canvas: ProjectCanvasSnapshot): string[] {
  const registryPaths = data.projectObjects?.media.map((item) => item.path) ?? [];
  const canvasPaths = canvas.nodes.flatMap((value) => {
    const node = value as { data?: Record<string, unknown> };
    const d = node.data ?? {};
    return [d.localPath, d.generatedImageUrl, d.generatedVideoUrl, d.referenceImage, d.audioPath]
      .filter((item): item is string => typeof item === 'string');
  });
  return uniqueStrings([...registryPaths, ...canvasPaths]);
}

export function pendingTaskIdsForCanvas(canvas: ProjectCanvasSnapshot): string[] {
  return uniqueStrings(canvas.nodes.flatMap((value) => {
    const node = value as { data?: Record<string, unknown> };
    const d = node.data ?? {};
    if (!d.isGenerating) return [];
    return [d.taskId, d.rhTaskId, d.backgroundTaskId, d.generationTaskId]
      .filter((item): item is string => typeof item === 'string');
  }));
}

export function createProjectSnapshot(
  data: WorkshopData,
  canvas: ProjectCanvasSnapshot,
  options: { now?: number; label?: string; messageId?: string; changedObjectIds?: string[] } = {},
): ProjectSnapshotRecord {
  const now = options.now ?? Date.now();
  return {
    id: stableId('snapshot', now),
    label: options.label?.trim() || 'Agent 完成一次修改',
    createdAt: now,
    messageId: options.messageId,
    workshopPayload: serializeWithoutEmbeddedMedia(withoutHistory(data)),
    canvasPayload: serializeWithoutEmbeddedMedia(canvas),
    mediaPaths: collectMediaPaths(data, canvas),
    pendingTaskIds: pendingTaskIdsForCanvas(canvas),
    changedObjectIds: uniqueStrings(options.changedObjectIds ?? []),
  };
}

export function appendProjectSnapshot(
  existing: ProjectSnapshotRecord[] | undefined,
  snapshot: ProjectSnapshotRecord,
): ProjectSnapshotRecord[] {
  return [snapshot, ...(existing ?? []).filter((item) => item.id !== snapshot.id)]
    .slice(0, MAX_PROJECT_SNAPSHOTS);
}

export interface SnapshotRestoreResult {
  status: 'restored' | 'confirmation-required' | 'invalid';
  workshop?: WorkshopData;
  canvas?: ProjectCanvasSnapshot;
  reason?: string;
}

export function restoreProjectSnapshot(
  current: WorkshopData,
  snapshot: ProjectSnapshotRecord,
  options: { confirmPending?: boolean; activePendingTaskIds?: string[] } = {},
): SnapshotRestoreResult {
  const pendingTaskIds = options.activePendingTaskIds ?? snapshot.pendingTaskIds;
  if (pendingTaskIds.length > 0 && !options.confirmPending) {
    return {
      status: 'confirmation-required',
      reason: '这个快照包含仍在生成中的任务。回退不会取消供应商任务，需要再次确认。',
    };
  }
  try {
    const stored = JSON.parse(snapshot.workshopPayload) as WorkshopData;
    const canvas = JSON.parse(snapshot.canvasPayload) as ProjectCanvasSnapshot;
    if (!stored || stored.projectId !== current.projectId || !Array.isArray(canvas.nodes) || !Array.isArray(canvas.edges)) {
      return { status: 'invalid', reason: '快照与当前项目不匹配或内容已损坏。' };
    }
    return {
      status: 'restored',
      workshop: {
        ...stored,
        projectSnapshots: current.projectSnapshots,
        projectBranches: current.projectBranches,
      },
      canvas,
    };
  } catch {
    return { status: 'invalid', reason: '快照内容无法读取。' };
  }
}

export function createProjectBranch(
  snapshot: ProjectSnapshotRecord,
  name: string,
  now = Date.now(),
): ProjectBranchRecord {
  return {
    id: stableId('branch', now),
    name: name.trim() || '未命名分支',
    createdAt: now,
    sourceSnapshotId: snapshot.id,
    workshopPayload: snapshot.workshopPayload,
    canvasPayload: snapshot.canvasPayload,
    mediaPaths: [...snapshot.mediaPaths],
  };
}
