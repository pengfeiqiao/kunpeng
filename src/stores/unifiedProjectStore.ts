/**
 * unifiedProjectStore — Adobe 式统一项目协调层。
 *
 * 一个 AIGC 项目 = 工坊数据 + 专属画布（aigcProjectId 关联）+ 专属剪辑
 * 时间轴（editor.json）+ 专属对话集（Session.projectId）。
 * openUnified() 一次切齐四者；closeUnified() 回自由模式。
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeLocalStorage } from '@/lib/safeStorage';
import { useWorkshopStore } from './workshopStore';
import { useProjectStore } from './projectStore';
import { switchEditorProject } from '@/lib/editor/editorPersist';
import { ensureProjectSession } from '@/lib/projectSessions';
import {
  registerCanvasGeneration,
  type CanvasGenerationRegistration,
} from '@/lib/projectObjects/selectors';
import { stableProjectObjectId } from '@/lib/projectObjects/migrate';
import { selectProjectVersionCommand, deleteProjectObjectCommand, type ProjectCommandState } from '@/lib/projectObjects/projectCommands';
import { useCanvasStore } from './canvasStore';
import {
  applyProjectObjectPatch,
  undoProjectChangeSet,
  type ConflictResolution,
  type ProjectChangeSet,
  type ProjectWriteConflict,
} from '@/lib/projectObjects/collaboration';
import type { ProjectObjectRecord, UnifiedProjectRegistry } from '@/lib/projectObjects/types';
import type { WsShot } from '@/lib/workshop/types';
import {
  applyWorkshopShotPatch,
  undoWorkshopShotChange,
  workshopShotObject,
} from '@/lib/projectObjects/workshopCollaboration';
import {
  appendProjectSnapshot,
  createProjectBranch,
  createProjectSnapshot,
  pendingTaskIdsForCanvas,
  restoreProjectSnapshot,
  type SnapshotRestoreResult,
} from '@/lib/projectObjects/snapshots';
import type { Edge, Node } from 'reactflow';
import {
  assessProjectObjectDeletion,
  type ProjectDeletionImpact,
} from '@/lib/projectObjects/deletion';

export interface RegisterCanvasGenerationInput extends Omit<CanvasGenerationRegistration, 'ownerObjectId'> {
  ownerObjectId?: string;
  workshopRef?: {
    kind?: string;
    id?: string;
    shotId?: string;
  };
}

export interface RegisteredCanvasGeneration {
  mediaIds: string[];
  versionIds: Array<string | undefined>;
  ownerObjectId?: string;
}

export type ProjectDeletionStoreResult =
  | { status: 'deleted'; impact: ProjectDeletionImpact; snapshotId: string }
  | { status: 'confirmation-required'; impact: ProjectDeletionImpact; pendingTaskIds: string[] }
  | { status: 'not-found' | 'invalid'; reason: string };

function ownerObjectIdForCanvasGeneration(
  input: RegisterCanvasGenerationInput,
  projectId: string,
): string | undefined {
  if (input.ownerObjectId) return input.ownerObjectId;
  const ref = input.workshopRef;
  if (!ref?.kind || !ref.id) return undefined;
  if (ref.kind === 'character') return stableProjectObjectId('character', ref.id);
  if (ref.kind === 'scene') return stableProjectObjectId('scene', ref.id);
  if (ref.kind === 'prop') return stableProjectObjectId('prop', ref.id);
  if (ref.kind === 'colorPalette') return stableProjectObjectId('scene-asset', ref.id);
  if (ref.kind === 'directorConstraintCard') return stableProjectObjectId('director-constraint', ref.id);
  if (ref.kind === 'shot') {
    const data = useWorkshopStore.getState().data;
    if (!data || data.projectId !== projectId) return undefined;
    const shot = data.shots.find((item) => (
      item.id === ref.shotId || item.shotNo === ref.id
    ));
    return shot ? stableProjectObjectId('shot', shot.id ?? shot.shotNo) : undefined;
  }
  return undefined;
}

interface UnifiedProjectState {
  /** 当前打开的统一项目（= AIGC 项目 id）；null = 自由模式 */
  activeId: string | null;
  opening: boolean;
  recentChangeSets: ProjectChangeSet[];
  pendingConflicts: ProjectWriteConflict[];

  openUnified: (aigcProjectId: string) => Promise<void>;
  /** 轻量恢复：只在已知项目上下文断开时调用，避免顶部切换栏丢失 */
  recoverUnified: (aigcProjectId?: string | null) => Promise<void>;
  closeUnified: () => Promise<void>;
  /** 找到（或创建）该 AIGC 项目的专属画布项目并切换 */
  ensureCanvasProject: (aigcProjectId: string, name: string) => Promise<string>;
  /** Register a finished canvas output without making it a generation ref. */
  registerCanvasGenerationResult: (input: RegisterCanvasGenerationInput) => RegisteredCanvasGeneration | null;
  /** Select one immutable asset version and project it into workshop + canvas. */
  selectProjectAssetVersion: (ownerObjectId: string, versionObjectId: string) => boolean;
  applyAgentObjectPatch: (input: {
    objectId: string;
    expectedVersion: number;
    patch: Partial<ProjectObjectRecord>;
  }) => 'applied' | 'not-found' | 'locked' | 'conflict';
  applyAgentShotPatch: (input: {
    shotNo: string;
    expectedVersion: number;
    patch: Partial<WsShot>;
  }) => 'applied' | 'not-found' | 'locked' | 'conflict';
  setProjectObjectLocked: (objectId: string, locked: boolean) => boolean;
  resolveProjectObjectConflict: (objectId: string, resolution: ConflictResolution) => boolean;
  undoProjectChange: (changeSetId: string) => boolean;
  captureProjectSnapshot: (options?: {
    messageId?: string;
    label?: string;
    changedObjectIds?: string[];
  }) => string | null;
  restoreProjectSnapshot: (
    snapshotId: string,
    confirmPending?: boolean,
  ) => Promise<SnapshotRestoreResult>;
  createProjectBranch: (snapshotId: string, name: string) => string | null;
  restoreProjectBranch: (
    branchId: string,
    confirmPending?: boolean,
  ) => Promise<SnapshotRestoreResult>;
  assessProjectDeletion: (targetId: string) => ProjectDeletionImpact | null;
  deleteProjectObject: (targetId: string, confirmPending?: boolean) => Promise<ProjectDeletionStoreResult>;
}

function publishProjectCommand(base: ProjectCommandState, next: ProjectCommandState): boolean {
  const ws = useWorkshopStore.getState();
  const canvas = useCanvasStore.getState();
  const project = useProjectStore.getState();
  const activeId = useUnifiedProjectStore.getState().activeId;
  const canvasProject = project.projects.find((item) => item.id === project.activeProjectId);
  if (!activeId || activeId !== base.workshop.projectId || ws.data !== base.workshop
    || canvas.nodes !== base.canvas.nodes || canvas.edges !== base.canvas.edges
    || !(base.workshop.canvasProjectId === project.activeProjectId || canvasProject?.aigcProjectId === activeId)) return false;
  // No await between business publication and its compatibility projection.
  useWorkshopStore.setState({ data: next.workshop });
  useCanvasStore.setState({
    nodes: next.canvas.nodes,
    edges: next.canvas.edges,
    selectedNodeId: next.canvas.nodes.some((node) => node.id === canvas.selectedNodeId) ? canvas.selectedNodeId : null,
  });
  useWorkshopStore.getState().scheduleSave();
  return true;
}

function allRegistryRecords(registry: UnifiedProjectRegistry): ProjectObjectRecord[] {
  return [...registry.objects, ...registry.media, ...registry.versions];
}

function appendRegistryRecord(
  registry: UnifiedProjectRegistry,
  record: ProjectObjectRecord,
  now = Date.now(),
): UnifiedProjectRegistry {
  if (record.kind === 'media-file') {
    return { ...registry, updatedAt: now, media: [...registry.media, record as typeof registry.media[number]] };
  }
  if (record.kind === 'asset-version') {
    return { ...registry, updatedAt: now, versions: [...registry.versions, record as typeof registry.versions[number]] };
  }
  return { ...registry, updatedAt: now, objects: [...registry.objects, record] };
}

function saveRegistry(registry: UnifiedProjectRegistry): void {
  const ws = useWorkshopStore.getState();
  if (!ws.data) return;
  useWorkshopStore.setState({ data: { ...ws.data, projectObjects: registry } });
  useWorkshopStore.getState().scheduleSave();
}

export const useUnifiedProjectStore = create<UnifiedProjectState>()(persist((set, get) => ({
  activeId: null,
  opening: false,
  recentChangeSets: [],
  pendingConflicts: [],

  ensureCanvasProject: async (aigcProjectId, name) => {
    const ps = useProjectStore.getState();
    let canvas = ps.projects.find((p) => p.aigcProjectId === aigcProjectId);
    // 文件侧兜底：localStorage 关联丢失（曾因配额满写不进）时用 workshop.json 恢复
    if (!canvas) {
      const wsCanvasId = useWorkshopStore.getState().data?.canvasProjectId;
      if (wsCanvasId) {
        const byFile = ps.projects.find((p) => p.id === wsCanvasId);
        if (byFile) {
          ps.linkAigcProject(byFile.id, aigcProjectId);
          canvas = byFile;
        }
      }
    }
    // 领养幽灵画布：同名且未关联的画布（历史 bug 产物）直接收编，不再新建
    if (!canvas) {
      const orphan = ps.projects.find((p) => !p.aigcProjectId && p.name === name);
      if (orphan) {
        ps.linkAigcProject(orphan.id, aigcProjectId);
        canvas = orphan;
      }
    }
    if (!canvas) {
      const canvasId = await ps.createProject(name);
      ps.linkAigcProject(canvasId, aigcProjectId);
      canvas = useProjectStore.getState().projects.find((p) => p.id === canvasId);
    }
    // 兜底同步画布名跟随工坊名（修：在外部改了项目名后，画布 ProjectSwitcher 仍显示旧名）
    if (canvas && canvas.name !== name) {
      useProjectStore.getState().renameProject(canvas.id, name);
    }
    // canvasProjectId 写回 workshop.json（文件为源，双向自愈）
    const ws = useWorkshopStore.getState();
    if (ws.data && ws.data.projectId === aigcProjectId && ws.data.canvasProjectId !== canvas!.id) {
      useWorkshopStore.setState({ data: { ...ws.data, canvasProjectId: canvas!.id } });
      ws.scheduleSave();
    }
    return canvas!.id;
  },

  registerCanvasGenerationResult: (input) => {
    const activeId = get().activeId;
    const ws = useWorkshopStore.getState();
    if (!activeId || !ws.data || ws.data.projectId !== activeId) return null;
    const ownerObjectId = ownerObjectIdForCanvasGeneration(input, activeId);
    const registered = registerCanvasGeneration(ws.data, {
      ...input,
      ownerObjectId,
    });
    useWorkshopStore.setState({ data: registered.data });
    useWorkshopStore.getState().scheduleSave();
    return {
      mediaIds: registered.mediaIds,
      versionIds: registered.versionIds,
      ownerObjectId,
    };
  },

  selectProjectAssetVersion: (ownerObjectId, versionObjectId) => {
    const ws = useWorkshopStore.getState();
    if (!ws.data) return false;
    const canvas = useCanvasStore.getState();
    const base = { workshop: ws.data, canvas: { nodes: canvas.nodes, edges: canvas.edges } };
    const next = selectProjectVersionCommand(base, ownerObjectId, versionObjectId);
    return Boolean(next && publishProjectCommand(base, next));
  },

  applyAgentObjectPatch: ({ objectId, expectedVersion, patch }) => {
    const registry = useWorkshopStore.getState().data?.projectObjects;
    if (!registry) return 'not-found';
    const result = applyProjectObjectPatch(registry, {
      objectId,
      expectedVersion,
      patch,
      actor: 'agent',
    });
    if (result.status === 'applied') {
      saveRegistry(result.registry);
      set((state) => ({
        recentChangeSets: [result.changeSet, ...state.recentChangeSets].slice(0, 12),
        pendingConflicts: state.pendingConflicts.filter((item) => item.objectId !== objectId),
      }));
    } else if (result.status === 'conflict') {
      set((state) => ({
        pendingConflicts: [
          result.conflict,
          ...state.pendingConflicts.filter((item) => item.objectId !== objectId),
        ],
      }));
    }
    return result.status;
  },

  applyAgentShotPatch: ({ shotNo, expectedVersion, patch }) => {
    const ws = useWorkshopStore.getState();
    if (!ws.data) return 'not-found';
    const result = applyWorkshopShotPatch(ws.data, {
      shotNo,
      expectedVersion,
      patch,
      actor: 'agent',
    });
    if (result.status === 'applied') {
      useWorkshopStore.setState({ data: result.data });
      useWorkshopStore.getState().scheduleSave();
      set((state) => ({
        recentChangeSets: [result.changeSet, ...state.recentChangeSets].slice(0, 12),
        pendingConflicts: state.pendingConflicts.filter((item) => item.objectId !== result.changeSet.objectId),
      }));
    } else if (result.status === 'conflict') {
      set((state) => ({
        pendingConflicts: [
          result.conflict,
          ...state.pendingConflicts.filter((item) => item.objectId !== result.conflict.objectId),
        ],
      }));
    }
    return result.status;
  },

  setProjectObjectLocked: (objectId, locked) => {
    const registry = useWorkshopStore.getState().data?.projectObjects;
    if (!registry) return false;
    const current = allRegistryRecords(registry).find((item) => item.id === objectId);
    if (!current || current.locked === locked) return Boolean(current);
    const result = applyProjectObjectPatch(registry, {
      objectId,
      expectedVersion: current.version,
      patch: { locked },
      actor: 'user',
    });
    if (result.status !== 'applied') return false;
    saveRegistry(result.registry);
    set((state) => ({ recentChangeSets: [result.changeSet, ...state.recentChangeSets].slice(0, 12) }));
    return true;
  },

  resolveProjectObjectConflict: (objectId, resolution) => {
    const conflict = get().pendingConflicts.find((item) => item.objectId === objectId);
    const registry = useWorkshopStore.getState().data?.projectObjects;
    if (!conflict || !registry) return false;
    if (resolution === 'keep-user') {
      set((state) => ({ pendingConflicts: state.pendingConflicts.filter((item) => item.objectId !== objectId) }));
      return true;
    }
    if (conflict.target === 'workshop-shot') {
      if (resolution === 'keep-both') return false;
      const data = useWorkshopStore.getState().data;
      if (!data || !conflict.sourceId) return false;
      const current = workshopShotObject(data, conflict.sourceId);
      if (!current || current.locked) return false;
      const result = applyWorkshopShotPatch(data, {
        shotNo: conflict.sourceId,
        expectedVersion: current.version,
        patch: conflict.intended as Partial<WsShot>,
        actor: 'agent',
      });
      if (result.status !== 'applied') return false;
      useWorkshopStore.setState({ data: result.data });
      useWorkshopStore.getState().scheduleSave();
      set((state) => ({
        recentChangeSets: [result.changeSet, ...state.recentChangeSets].slice(0, 12),
        pendingConflicts: state.pendingConflicts.filter((item) => item.objectId !== objectId),
      }));
      return true;
    }
    if (resolution === 'apply-agent') {
      const current = allRegistryRecords(registry).find((item) => item.id === objectId);
      if (!current || current.locked) return false;
      const result = applyProjectObjectPatch(registry, {
        objectId,
        expectedVersion: current.version,
        patch: conflict.intended as Partial<ProjectObjectRecord>,
        actor: 'agent',
      });
      if (result.status !== 'applied') return false;
      saveRegistry(result.registry);
      set((state) => ({
        recentChangeSets: [result.changeSet, ...state.recentChangeSets].slice(0, 12),
        pendingConflicts: state.pendingConflicts.filter((item) => item.objectId !== objectId),
      }));
      return true;
    }
    const now = Date.now();
    const clone = {
      ...conflict.current,
      ...conflict.intended,
      ...(conflict.current.kind === 'asset-version' ? { selected: false } : {}),
      ...(conflict.current.kind === 'media-file'
        ? { purpose: 'candidate-version' as const }
        : {}),
      id: `${conflict.current.id}:agent-${now}`,
      source: 'generated' as const,
      sourceId: conflict.current.id,
      label: `${conflict.current.label ?? conflict.current.id} · Agent 版本`,
      relationIds: [...new Set([...conflict.current.relationIds, conflict.current.id])],
      version: 1,
      locked: false,
      updatedAt: now,
    } as ProjectObjectRecord;
    saveRegistry(appendRegistryRecord(registry, clone, now));
    set((state) => ({ pendingConflicts: state.pendingConflicts.filter((item) => item.objectId !== objectId) }));
    return true;
  },

  undoProjectChange: (changeSetId) => {
    const changeSet = get().recentChangeSets.find((item) => item.id === changeSetId);
    const registry = useWorkshopStore.getState().data?.projectObjects;
    if (!changeSet || !registry) return false;
    if (changeSet.target === 'workshop-shot') {
      const data = useWorkshopStore.getState().data;
      if (!data) return false;
      const undone = undoWorkshopShotChange(data, changeSet);
      if (undone.revertedFields.length === 0) return false;
      useWorkshopStore.setState({ data: undone.data });
      useWorkshopStore.getState().scheduleSave();
      set((state) => ({ recentChangeSets: state.recentChangeSets.filter((item) => item.id !== changeSetId) }));
      return true;
    }
    const undone = undoProjectChangeSet(registry, changeSet);
    if (undone.revertedFields.length === 0) return false;
    saveRegistry(undone.registry);
    set((state) => ({ recentChangeSets: state.recentChangeSets.filter((item) => item.id !== changeSetId) }));
    return true;
  },

  captureProjectSnapshot: (options = {}) => {
    const activeId = get().activeId;
    const ws = useWorkshopStore.getState();
    if (!activeId || !ws.data || ws.data.projectId !== activeId) return null;
    const canvas = useCanvasStore.getState();
    const snapshot = createProjectSnapshot(ws.data, {
      nodes: canvas.nodes,
      edges: canvas.edges,
    }, options);
    useWorkshopStore.setState({
      data: {
        ...ws.data,
        projectSnapshots: appendProjectSnapshot(ws.data.projectSnapshots, snapshot),
      },
    });
    useWorkshopStore.getState().scheduleSave();
    return snapshot.id;
  },

  restoreProjectSnapshot: async (snapshotId, confirmPending = false) => {
    const activeId = get().activeId;
    const ws = useWorkshopStore.getState();
    const canvas = useCanvasStore.getState();
    if (!activeId || !ws.data || ws.data.projectId !== activeId) {
      return { status: 'invalid', reason: '当前没有打开可回退的统一项目。' };
    }
    const snapshot = ws.data.projectSnapshots?.find((item) => item.id === snapshotId);
    if (!snapshot) return { status: 'invalid', reason: '找不到这个项目快照。' };
    const result = restoreProjectSnapshot(ws.data, snapshot, {
      confirmPending,
      activePendingTaskIds: pendingTaskIdsForCanvas({ nodes: canvas.nodes, edges: canvas.edges }),
    });
    if (result.status !== 'restored' || !result.workshop || !result.canvas) return result;
    useWorkshopStore.setState({ data: result.workshop });
    await useProjectStore.getState().replaceActiveCanvas(
      result.canvas.nodes as Node[],
      result.canvas.edges as Edge[],
    );
    useWorkshopStore.getState().scheduleSave();
    set({ recentChangeSets: [], pendingConflicts: [] });
    return result;
  },

  createProjectBranch: (snapshotId, name) => {
    const activeId = get().activeId;
    const ws = useWorkshopStore.getState();
    if (!activeId || !ws.data || ws.data.projectId !== activeId) return null;
    const snapshot = ws.data.projectSnapshots?.find((item) => item.id === snapshotId);
    if (!snapshot) return null;
    const branch = createProjectBranch(snapshot, name);
    useWorkshopStore.setState({
      data: {
        ...ws.data,
        projectBranches: [
          branch,
          ...(ws.data.projectBranches ?? []).filter((item) => item.id !== branch.id),
        ],
      },
    });
    useWorkshopStore.getState().scheduleSave();
    return branch.id;
  },

  restoreProjectBranch: async (branchId, confirmPending = false) => {
    const activeId = get().activeId;
    const ws = useWorkshopStore.getState();
    const canvas = useCanvasStore.getState();
    if (!activeId || !ws.data || ws.data.projectId !== activeId) {
      return { status: 'invalid', reason: '当前没有打开可切换分支的统一项目。' };
    }
    const branch = ws.data.projectBranches?.find((item) => item.id === branchId);
    if (!branch) return { status: 'invalid', reason: '找不到这个项目分支。' };
    const result = restoreProjectSnapshot(ws.data, {
      id: branch.sourceSnapshotId,
      label: branch.name,
      createdAt: branch.createdAt,
      workshopPayload: branch.workshopPayload,
      canvasPayload: branch.canvasPayload,
      mediaPaths: branch.mediaPaths,
      pendingTaskIds: [],
    }, {
      confirmPending,
      activePendingTaskIds: pendingTaskIdsForCanvas({ nodes: canvas.nodes, edges: canvas.edges }),
    });
    if (result.status !== 'restored' || !result.workshop || !result.canvas) return result;
    useWorkshopStore.setState({ data: result.workshop });
    await useProjectStore.getState().replaceActiveCanvas(
      result.canvas.nodes as Node[],
      result.canvas.edges as Edge[],
    );
    useWorkshopStore.getState().scheduleSave();
    set({ recentChangeSets: [], pendingConflicts: [] });
    return result;
  },

  assessProjectDeletion: (targetId) => {
    const data = useWorkshopStore.getState().data;
    return data ? assessProjectObjectDeletion(data, targetId) : null;
  },

  deleteProjectObject: async (targetId, confirmPending = false) => {
    const activeId = get().activeId;
    const ws = useWorkshopStore.getState();
    const canvas = useCanvasStore.getState();
    if (!activeId || !ws.data || ws.data.projectId !== activeId) {
      return { status: 'invalid', reason: '当前没有打开可编辑的统一项目。' };
    }
    const impact = assessProjectObjectDeletion(ws.data, targetId);
    if (!impact) return { status: 'not-found', reason: '这个项目对象已经不存在。' };
    const pendingTaskIds = pendingTaskIdsForCanvas({ nodes: canvas.nodes, edges: canvas.edges });
    if (pendingTaskIds.length > 0 && !confirmPending) {
      return { status: 'confirmation-required', impact, pendingTaskIds };
    }

    const base = { workshop: ws.data, canvas: { nodes: canvas.nodes, edges: canvas.edges } };
    const next = deleteProjectObjectCommand(base, targetId);
    if (!next) return { status: 'not-found', reason: '这个项目对象已经不存在。' };
    if (!publishProjectCommand(base, next)) return { status: 'invalid', reason: '项目或画布已经切换，未执行删除。' };
    set({ recentChangeSets: [], pendingConflicts: [] });
    await useProjectStore.getState().flushActiveCanvas();
    return { status: 'deleted', impact: next.impact, snapshotId: next.snapshotId };
  },

  openUnified: async (aigcProjectId) => {
    if (get().opening) return;
    set({ opening: true });
    try {
      // 1) 工坊
      await useWorkshopStore.getState().openProject(aigcProjectId);
      const project = useWorkshopStore.getState().project;
      if (!project) {
        throw new Error(`读取工坊项目失败：${aigcProjectId}`);
      }
      if (project.id !== aigcProjectId) {
        useWorkshopStore.setState({ project: { ...project, id: aigcProjectId } });
      }

      // 2) 画布（确保存在 + 切换）
      const canvasId = await get().ensureCanvasProject(aigcProjectId, project.name);
      await useProjectStore.getState().switchProject(canvasId);

      // 3) 剪辑时间轴
      await switchEditorProject(aigcProjectId);

      // 4) 项目会话（流式中失败也不阻塞打开）
      await ensureProjectSession(aigcProjectId, project.name).catch(() => null);

      set({ activeId: aigcProjectId, recentChangeSets: [], pendingConflicts: [] });
    } finally {
      set({ opening: false });
    }
  },

  recoverUnified: async (aigcProjectId) => {
    const targetId = aigcProjectId ?? get().activeId;
    if (!targetId || get().opening) return;

    const ws = useWorkshopStore.getState();
    const ps = useProjectStore.getState();
    const currentCanvas = ps.projects.find((p) => p.id === ps.activeProjectId);

    // 如果工坊、画布、剪辑都已经对齐，只补 activeId，避免无意义重切。
    if (ws.project?.id === targetId && ws.data?.projectId === targetId && currentCanvas?.aigcProjectId === targetId) {
      if (get().activeId !== targetId) set({ activeId: targetId });
      return;
    }

    // 当前画布已经是这个 AIGC 项目的专属画布时，也用 openUnified 统一补齐工坊/剪辑。
    // 这里不改 activeView，只恢复背后的项目链路。
    await get().openUnified(targetId);
  },

  closeUnified: async () => {
    useWorkshopStore.getState().close();
    await switchEditorProject(null);
    set({ activeId: null, recentChangeSets: [], pendingConflicts: [] });
  },
}), {
  name: 'kunpeng-unified-project',
  storage: createJSONStorage(() => safeLocalStorage),
  partialize: (s) => ({ activeId: s.activeId }),
  version: 1,
}));
